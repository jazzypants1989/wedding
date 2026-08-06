#!/usr/bin/env node
/** @file CLI: join a session1 vision run's `photos.jsonl`/`faces.jsonl` to
 *  already-imported `media` rows by content hash, and insert `media_faces` rows
 *  (source='cli') for every face of a matched photo
 *  (docs/post-wedding/SPEC-vision-lab.md §10/§11).
 *
 *  Two jobs behind one entry point, either or both per invocation:
 *
 *   1. `--backfill-manifest PATH` populates `media.source_sha256`, VERIFIED
 *      against the stored originals rather than trusted from the manifest's row
 *      ids. A manifest id is only meaningful in the database it was created
 *      against, and the manifest outlives databases — a smoke DB was once
 *      rebuilt under a manifest that had already recorded another import, and
 *      the stale ids stamped 95 real photographs with another file's hash. So:
 *      every row's stored original is re-hashed, and a value is written only
 *      when that hash is one the manifest actually knows. (sink-local.js now
 *      stamps the hash at import time, so this pass is for rows that predate
 *      that.)
 *   2. The main pass: read `<run-dir>/photos.jsonl` + `faces.jsonl`, join each
 *      photo's sha256 to `media.source_sha256`, and insert one `media_faces`
 *      row per face of a matched photo. `--model-version` is required and never
 *      inferred — a model swap must never silently mix descriptor spaces
 *      (SPEC §10). Re-running for a (media_id, model_version) that already has
 *      live 'cli' rows is refused unless `--replace` is passed, which
 *      soft-deletes the old rows first.
 *
 *  PROVENANCE, and why it is one invocation and not two (plan §9a). Every face
 *  this writes carries `ingest_id`, and that `vision_ingests` row is created
 *  inside the SAME transaction as the face inserts. A two-step "record the
 *  provenance, then ingest against it" would leave a window in which the row
 *  exists and describes nothing, or faces exist describing a row that was
 *  rolled back — and every later fail-closed check ("which faces are stale?",
 *  "was this model_version ever used for another descriptor space?") is only
 *  answerable if that pairing is atomic.
 *
 *  The provenance itself is READ, never assembled from what this script
 *  believes: it comes from the run's own `timing.json` `provenance` block,
 *  which the batch writes from the engine that actually ran. If that block is
 *  absent the ingest REFUSES. That is not defensive padding — `redescribe-crops.js`
 *  deliberately DELETES a stale `provenance` key rather than updating it, so
 *  that a consumer of a re-describe output gets `undefined` and stops, instead
 *  of silently recording one model's digests against another model's vectors.
 *
 *  CONFIG_JSON IS AN ALLOWLIST, and it is one now rather than being called one.
 *  Three places describe it that way; what enforced it was a three-character
 *  blocklist ("/", "\", "$"), so a bare filename or a single directory segment
 *  went straight through. Every string that reaches `config_json` is now looked
 *  up by FIELD NAME in `CONFIG_STRING_RULES` and checked against that field's own
 *  value space — six enumerations, three sha256 digests, and one runtime whose
 *  NAME is enumerated and only whose version is free. A field with no rule is
 *  refused. `model_version`, the one value that comes from argv and the one hole
 *  in §4's "never argv, never a path", is validated as a tag in
 *  `requireModelVersion`, which `buildIngestInput` calls for itself so the check
 *  is not skippable by calling the assembler directly. This matters because
 *  `config_json` travels to production in the face-work artifact and this
 *  repository is public.
 *
 *  §15 (no photo snooping): this script's <run-dir>/manifest path is its own
 *  explicit argv, which is the one thing the rule permits — it is not
 *  searching a photo library. It never reads a photograph; only JSONL records
 *  session1.js already wrote. Console output is counts only — never a
 *  filename or path of an unmatched photo, which could itself identify
 *  someone.
 *
 *  Uses its own DatabaseSync + the db/ layer's `sql` template bound to it
 *  (bindExecutor), NOT db/connection.js's process-wide singleton — so
 *  `--database PATH` can point anywhere without an import-order dance, and the
 *  unit tests can point this exact logic at a disposable temp DB. Mirrors
 *  scripts/seed-preview.js / scripts/export-archive.js, which do the same with
 *  raw `db.prepare()` calls; this file additionally binds sql.js so it can
 *  reuse db/media-faces.js's insertFace() and db/vision-ingests.js's
 *  createIngest() rather than duplicating those statements.
 */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"

import { createTables, runMigrations } from "../../db/schema.js"
import { bindExecutor, sql } from "../../db/sql.js"
import { now } from "../../db/utils.js"
import { insertFace, descriptorToBlob } from "../../db/media-faces.js"
import { createIngest, assertModelVersionInvariant } from "../../db/vision-ingests.js"
import { routeFace, routeCutoffs, PROFILE } from "../../public/vision/route.js"
import { loadManifest } from "../lib/import-manifest.js"
import { computeDatasetId } from "./dataset-id.js"
import { frameRoots } from "./session1-report.js"

/**
 * Bumped whenever the SHAPE of `config_json` changes, so a reader can tell a
 * missing field from a field this version never wrote. Not the database schema
 * version and not the model version — just this object's.
 */
const CONFIG_SCHEMA_VERSION = 1

/**
 * The nine signals `routeFace` grades against. Named here rather than inferred
 * from whatever the record happens to carry: a face missing one of them must be
 * left UNGRADED, not graded against an undefined that compares false and quietly
 * routes it `set_aside`.
 * @type {ReadonlyArray<keyof import('../../public/vision/types.js').GateSignals>}
 */
const GATE_SIGNAL_KEYS = [
  "score",
  "boxPx",
  "borderPx",
  "eyeRatio",
  "eyeAngle",
  "alignScale",
  "residual",
  "outsideFraction",
  "sharpness",
]

const USAGE = `Usage: node scripts/vision/ingest-faces.js <run-dir> [options]

  <run-dir>                 Directory holding photos.jsonl + faces.jsonl.
                             Required unless --backfill-manifest is given alone.

  --model-version TAG       Descriptor model tag. Required for the main pass —
                             refuses to guess; a model swap must never silently
                             mix descriptor spaces. Letters, digits, ".", "-"
                             and "_", at most 64 characters: it is written to
                             vision_ingests and travels from there to production.
  --replace                 Soft-delete this run's target (media_id, model_version)
                             pairs' previous 'cli' rows before inserting. Without
                             it, a pair that already has live 'cli' rows is refused.
  --database PATH            Override the SQLite file. Default: data/wedding.db.
  --backfill-manifest PATH   Populate (and repair) media.source_sha256. Each
                              row's stored original is re-hashed; a value is
                              written only when the hash is one this manifest
                              recorded. Rows the importer stamped at import
                              time verify and pass through untouched.
  --dry-run                  Report counts; write nothing.
  --help                     Show this message.
`

/**
 * No regex, per CLAUDE.md: a manual switch over known flags. Unknown `--flags`
 * are refused rather than silently ignored.
 * @param {string[]} argv
 * @returns {Types.IngestArgsResult}
 */
export function parseArgs(argv) {
  /** @type {string[]} */
  const positionals = []
  /** @type {string | null} */
  let database = null
  /** @type {string | null} */
  let modelVersion = null
  /** @type {string | null} */
  let backfillManifest = null
  let replace = false
  let dryRun = false
  let help = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      help = true
    } else if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--replace") {
      replace = true
    } else if (arg === "--database") {
      i++
      if (i >= argv.length) return { valid: false, error: "--database needs a value" }
      database = argv[i]
    } else if (arg === "--model-version") {
      i++
      if (i >= argv.length) return { valid: false, error: "--model-version needs a value" }
      modelVersion = argv[i]
    } else if (arg === "--backfill-manifest") {
      i++
      if (i >= argv.length) return { valid: false, error: "--backfill-manifest needs a value" }
      backfillManifest = argv[i]
    } else if (arg.startsWith("--")) {
      return { valid: false, error: `Unknown option: ${arg}` }
    } else {
      positionals.push(arg)
    }
  }

  if (help) return { valid: false, error: USAGE }

  const runDir = positionals[0] ?? null
  if (!runDir && !backfillManifest) {
    return { valid: false, error: "Nothing to do: pass a run directory, --backfill-manifest, or both.\n\n" + USAGE }
  }

  return {
    valid: true,
    value: { runDir, database, modelVersion, backfillManifest, replace, dryRun },
  }
}

/**
 * One JSONL file. A run killed part-way leaves a truncated final line; a
 * malformed line is counted and skipped, never fatal (same stance as
 * session1-report.js's own copy of this — duplicated rather than shared,
 * matching that file's own precedent of not factoring this out).
 * @template T
 * @param {string} file
 * @returns {{ records: T[], skipped: number, present: boolean }}
 */
export function readJsonl(file) {
  if (!fs.existsSync(file)) return { records: [], skipped: 0, present: false }
  const text = fs.readFileSync(file, "utf8")
  /** @type {T[]} */
  const records = []
  let skipped = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      records.push(/** @type {T} */ (JSON.parse(trimmed)))
    } catch {
      skipped++
    }
  }
  return { records, skipped, present: true }
}

/**
 * Open (creating if needed) a SQLite file, apply the same pragmas/schema the
 * server uses, and bind db/sql.js's `sql` template to THIS connection — not
 * db/connection.js's singleton, so a --database flag or a unit test's temp
 * file needs no import-order gymnastics.
 * @param {string} dbPath
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA busy_timeout = 5000")
  createTables(db)
  runMigrations(db)

  /** @type {Map<string, import('node:sqlite').StatementSync>} */
  const stmtCache = new Map()
  bindExecutor((text) => {
    let stmt = stmtCache.get(text)
    if (!stmt) {
      stmt = db.prepare(text)
      stmtCache.set(text, stmt)
    }
    return stmt
  })

  return db
}

/**
 * @param {string | null} databaseArg
 * @returns {string}
 */
function resolveDbPath(databaseArg) {
  if (databaseArg) return path.resolve(databaseArg)
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH
  return path.join(import.meta.dirname, "..", "..", "data", "wedding.db")
}

/**
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
function withTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE TRANSACTION")
  let committed = false
  try {
    const result = fn()
    db.exec("COMMIT")
    committed = true
    return result
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK")
      } catch {
        /* already rolled back */
      }
    }
  }
}

/** sha256 (content hash) -> media.id, for every media row that has one. */
export function loadMediaShaMap() {
  /** @type {Array<{ id: number, source_sha256: string }>} */
  const rows = sql`SELECT id, source_sha256 FROM media
    WHERE source_sha256 IS NOT NULL AND deleted_at IS NULL`.all()
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const row of rows) map.set(row.source_sha256, row.id)
  return map
}

/** media.id -> ORIGINAL pixel dimensions, for every live media row. Null when
 *  a row never recorded them (finalize always writes both, so that is a
 *  test-fixture shape more than a production one). */
export function loadMediaDims() {
  /** @type {Array<{ id: number, width: number | null, height: number | null }>} */
  const rows = sql`SELECT id, width, height FROM media WHERE deleted_at IS NULL`.all()
  /** @type {Map<number, { width: number | null, height: number | null }>} */
  const map = new Map()
  for (const row of rows) map.set(row.id, { width: row.width, height: row.height })
  return map
}

/**
 * How far the two axes' scale factors may disagree before the join itself is
 * suspect. The batch decodes with one uniform long-edge scale, so a photo and
 * its media row can only differ by rounding. 2% is far outside rounding and far
 * inside "this is a different image".
 *
 * To re-derive locally rather than trusting that: over a run joined to a
 * populated gallery, take `(media.width / photo.width) / (media.height /
 * photo.height)` for every matched pair and look at how far the extreme values
 * sit from 1. A uniform decode puts the whole distribution within rounding of
 * it, and anything beyond this constant is a join that landed on the wrong
 * image — which is what the `mismatch` counter reports rather than "fixes".
 *
 * (No figure from that distribution belongs in this file. It is a measurement
 * of the owner's photographs and this repository is public — CLAUDE.md's fourth
 * photograph rule. State the method; derive the number where the photographs
 * are.)
 */
export const ASPECT_TOLERANCE = 0.02

/**
 * A face's box and landmarks, scaled from the run's DECODE space into the
 * media row's ORIGINAL pixels — the space `media_faces` promises (the Faces
 * tab positions its crops against `media.width`/`height`; see
 * public/pages/admin/face-assignment.js `positionFaceChipImage`).
 *
 * The batch never decodes a photograph above `--source-edge` (default 2000px),
 * so its boxes are in that smaller space and inserting them verbatim was the
 * bug that made every admin face chip a featureless zoomed patch.
 *
 * Three outcomes, pure and unit-testable:
 *  - `scaled`   — dimensions known, aspects agree: geometry multiplied up.
 *  - `unscaled` — the media row never recorded dimensions. The contract can't
 *    be expressed, but the tab also cannot crop without them (it falls back to
 *    an uncropped thumb), so the decode-space values are kept rather than the
 *    face dropped.
 *  - `mismatch` — dimensions known and the aspect ratios disagree beyond
 *    tolerance. That is not a scaling problem, it is evidence the sha256 join
 *    landed on a DIFFERENT image; writing either space's numbers would be
 *    wrong, so the face is skipped and counted.
 *
 * `signals` are deliberately NOT rescaled: they record what the gate measured
 * at detection time, in detection space, and `route_state` was graded against
 * exactly those numbers.
 * @type {Types.scaleFaceGeometry}
 */
export function scaleFaceGeometry(face, photo, media) {
  const landmarks = face.landmarks && face.landmarks.length > 0 ? face.landmarks : null
  if (
    !media ||
    typeof media.width !== "number" ||
    typeof media.height !== "number" ||
    !(media.width > 0) ||
    !(media.height > 0)
  ) {
    return { kind: "unscaled", box: face.box, landmarks }
  }
  if (!(photo.width > 0) || !(photo.height > 0)) {
    // A photo record with no usable dimensions cannot vouch for its own boxes.
    return { kind: "mismatch", box: null, landmarks: null }
  }
  const scaleX = media.width / photo.width
  const scaleY = media.height / photo.height
  if (Math.abs(scaleX - scaleY) > ASPECT_TOLERANCE * Math.max(scaleX, scaleY)) {
    return { kind: "mismatch", box: null, landmarks: null }
  }
  return {
    kind: "scaled",
    box: {
      x: face.box.x * scaleX,
      y: face.box.y * scaleY,
      w: face.box.w * scaleX,
      h: face.box.h * scaleY,
    },
    landmarks: landmarks ? landmarks.map((value, i) => (i % 2 === 0 ? value * scaleX : value * scaleY)) : null,
  }
}

/**
 * Pure join: which photos in this run match an already-imported media row, by
 * content hash. No DB access — `mediaBySha` is supplied already queried, so
 * this is unit-testable with a plain Map.
 * @type {Types.joinPhotosToMedia}
 */
export function joinPhotosToMedia(photos, mediaBySha) {
  /** @type {Array<{ photo: Types.Session1PhotoRecord, mediaId: number }>} */
  const matched = []
  let unmatchedCount = 0
  for (const photo of photos) {
    const mediaId = mediaBySha.get(photo.sha256)
    if (mediaId === undefined) {
      unmatchedCount++
      continue
    }
    matched.push({ photo, mediaId })
  }
  return { matched, unmatchedCount }
}

/**
 * Per-photo frame identity and capture time, as the columns want them. Pure —
 * no DB access — so the union-find resolution is unit-testable against plain
 * records.
 *
 * The frame root is the sha256 of the LOWEST-id photo in the duplicate
 * equivalence class, not the class's run-local id: content-addressed, so it
 * means the same thing after a re-run that numbered the photos differently.
 * `frameRoots` is imported from the report, never reimplemented — it is the
 * transitive closure (A->B, C->B puts A and C together), and a one-hop
 * pointer here would silently split exactly the classes it exists to join.
 *
 * A photo with no duplicates is its own root, so every ingested row gets a
 * non-null value and "group by frame" downstream needs no coalesce.
 * @type {Types.frameMetadataForPhotos}
 */
export function frameMetadataForPhotos(photos) {
  const roots = frameRoots(photos)
  /** @type {Map<number, string>} */
  const shaByPhotoId = new Map(photos.map((p) => [p.id, p.sha256]))

  /** @type {Map<number, { frameRootSha256: string, capturedAt: string | null }>} */
  const out = new Map()
  for (const photo of photos) {
    const rootId = roots.get(photo.id) ?? photo.id
    out.set(photo.id, {
      // A root that has no row of its own (a --limit'ed run referencing a
      // photo it never wrote) falls back to the photo's own hash rather than
      // leaving the column null: its own frame, which is the truthful reading.
      frameRootSha256: shaByPhotoId.get(rootId) ?? photo.sha256,
      capturedAt: photo.capturedAtMs === null ? null : new Date(photo.capturedAtMs).toISOString(),
    })
  }
  return out
}

// --- Ingest provenance (plan §9a, contract §4) --------------------------------

/**
 * `<run-dir>/timing.json`, or a refusal.
 *
 * Missing is fatal rather than "no provenance recorded": the batch always
 * writes one, so its absence means this is not a run directory this script
 * understands, and guessing what produced the descriptors is the one thing the
 * whole provenance mechanism exists to stop.
 * @type {Types.readTiming}
 */
export function readTiming(runDir) {
  const file = path.join(runDir, "timing.json")
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file}: not found. An ingest records which engine, which weights and which ` +
        `settings produced its faces, and that comes from the run's own timing.json — ` +
        `there is nothing to fall back on that would not be a guess.`,
    )
  }
  return /** @type {import('./types.js').Session1Timing} */ (
    JSON.parse(fs.readFileSync(file, "utf8"))
  )
}

// --- The config_json allowlist, and it is one ---------------------------------
//
// §4 promises "never a filesystem path, never argv, never an environment
// variable", and three places call this an ALLOWLIST. What stood here was a
// three-character BLOCKLIST: it rejected "/", "\" and "$", so anything without
// one rode straight through — a model filename (`det_10g.onnx`), a photo
// directory's name (`wedding-photos-raw`), an environment variable's NAME. On a
// public repository whose config_json travels to production, "does not contain a
// slash" is not a description of what may be recorded.
//
// So: a closed list of KEYS, each with its own value space. Six of the nine
// string fields have exactly two or three legal values and are enumerated; three
// are content digests and must be 64 hex characters. The one genuinely free
// field, `runtime`, is the engine's self-description — its NAME is enumerated
// and only its version is free, so a filename cannot be one.
//
// Adding a field means adding its rule here. A field with no rule is refused,
// which is the direction an allowlist is supposed to fail in.

const DIGITS = "0123456789"
const LOWER = "abcdefghijklmnopqrstuvwxyz"
const HEX = `${DIGITS}abcdef`

/** Inference runtimes this project's engine may report. `tmp/rig/engine.mjs`
 *  builds `` `onnxruntime-node ${version}` ``; the rest are here so a deliberate
 *  backend swap is a one-line reviewed change rather than a reason to loosen the
 *  rule back into a blocklist. */
const RUNTIME_NAMES = Object.freeze([
  "onnxruntime-node",
  "onnxruntime-web",
  "onnxruntime",
  "wasm",
  "webgpu",
  "coreml",
  "cpu",
  "cuda",
])

/** Version characters. Letters and dots and dashes ("1.22.0-rc.1"), plus the
 *  literal "unknown" the engine falls back to when ORT reports no version. */
const VERSION_CHARS = `${DIGITS}${LOWER}.-+`

/** @param {string} value @param {string} allowed @returns {boolean} */
function charsFrom(value, allowed) {
  for (const character of value) if (!allowed.includes(character)) return false
  return true
}

/** `<name>` or `<name> <version>`, name from the list above.
 *  @param {string} value @returns {boolean} */
function isRuntimeString(value) {
  const words = value.split(" ")
  if (words.length > 2) return false
  if (!RUNTIME_NAMES.includes(words[0])) return false
  if (words.length === 1) return true
  return words[1].length > 0 && words[1].length <= 32 && charsFrom(words[1], VERSION_CHARS)
}

/** @param {ReadonlyArray<string>} values
 *  @returns {{ describe: string, check: (value: string) => boolean }} */
function oneOf(values) {
  return {
    describe: values.map((value) => `"${value}"`).join(" or "),
    check: (value) => values.includes(value),
  }
}

/**
 * The closed list. Every string that reaches `config_json` is looked up here by
 * FIELD NAME and checked against that field's own value space.
 * @type {Readonly<Record<string, { describe: string, check: (value: string) => boolean }>>}
 */
const CONFIG_STRING_RULES = Object.freeze({
  runtime: {
    describe: `an inference runtime (${RUNTIME_NAMES.join(", ")}) with an optional version`,
    check: isRuntimeString,
  },
  detectChannels: oneOf(["rgb", "bgr"]),
  embedChannels: oneOf(["rgb", "bgr"]),
  topKStage: oneOf(["pre", "post"]),
  // `in-graph` — the network normalises its own input. `arcface` — the engine
  // applies (x − 127.5) / 127.5 first. There is no third answer: a fourth
  // normalisation is a new descriptor space and a schema-version bump.
  embedNorm: oneOf(["in-graph", "arcface"]),
  // Where the mode came from. `RIG_EMBED_NORM` is the engine's own sentinel for
  // "an override was used" — the variable's NAME, never its value, and listed
  // explicitly rather than admitted by a rule that would admit any token.
  embedNormSource: oneOf(["sha256-table", "digest-table", "override", "RIG_EMBED_NORM"]),
  detectorSha256: { describe: "a 64-character sha256", check: isSha256 },
  embedderSha256: { describe: "a 64-character sha256", check: isSha256 },
  engineSha256: { describe: "a 64-character sha256", check: isSha256 },
})

/** @param {string} value @returns {boolean} */
function isSha256(value) {
  return value.length === 64 && charsFrom(value, HEX)
}

/**
 * One allowlisted string, or a refusal naming the field and its value space.
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function safeString(value, field) {
  const rule = CONFIG_STRING_RULES[field]
  if (!rule) {
    throw new Error(
      `config_json: "${field}" has no allowlist rule. Add one to CONFIG_STRING_RULES in ` +
        `scripts/vision/ingest-faces.js — an unlisted field is refused, not admitted.`,
    )
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`timing.json: provenance.${field} is missing or not a string`)
  }
  if (!rule.check(value)) {
    throw new Error(
      `timing.json: provenance.${field} is "${value}", which is not ${rule.describe}. ` +
        `config_json is an ALLOWLIST of versions, digests and thresholds — it never carries ` +
        `a path or an environment reference, an argv value, or a filename, and "does not ` +
        `contain a slash" was never the same claim.`,
    )
  }
  return value
}

/** `model_version` characters. A tag, not a sentence: this project's is
 *  `sface128-n127.5d128-nomirror`. */
const MODEL_VERSION_CHARS = `${DIGITS}${LOWER}${LOWER.toUpperCase()}.-_`
const MODEL_VERSION_MAX = 64

/** A finite number, or null. Anything else — a path, a flag, an object — cannot
 *  be one, so this is the other half of the allowlist's mechanical enforcement.
 *  @param {unknown} value @returns {number | null} */
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Copy only the finite numbers under `keys` out of an unknown object. Used for
 *  the detector/align/gate blocks timing.json carries, so that a knob added to
 *  `defaults.js` as a string or a path can never ride into config_json on the
 *  back of a spread.
 *  @param {unknown} source
 *  @param {ReadonlyArray<string>} keys
 *  @returns {Record<string, number | null>} */
function numericFields(source, keys) {
  const from = /** @type {Record<string, unknown>} */ (
    source && typeof source === "object" ? source : {}
  )
  /** @type {Record<string, number | null>} */
  const out = {}
  for (const key of keys) out[key] = numberOrNull(from[key])
  return out
}

/**
 * The `vision_ingests` row this run will be recorded under, assembled from the
 * run's own timing.json and its faces. Pure — no database, no filesystem — so
 * every refusal below is unit-testable against a hand-built timing object.
 * @type {Types.buildIngestInput}
 */
export function buildIngestInput({ timing, faces, modelVersion }) {
  const provenance = timing.provenance
  if (!provenance) {
    // Named explicitly, because this is the case an operator will actually hit
    // and "provenance missing" alone would send them looking for a bug.
    const hint = timing.describeProvenance
      ? " This directory has `describeProvenance` instead, which means it came from " +
        "redescribe-crops.js: its boxes and its descriptors were made by different engines, " +
        "so no single provenance block describes it. Ingest the run that DETECTED and " +
        "DESCRIBED with one engine."
      : " Runs written before provenance existed have none, and it cannot be reconstructed."
    throw new Error(`timing.json carries no \`provenance\` block, so this run cannot be ingested.${hint}`)
  }

  // The mirror setting is the caller's, not the engine's, so it lives in
  // `config` — and it is one of the three facts `model_version` is a name for,
  // which is why an absent one is a refusal rather than a default of false.
  const mirrorTta = timing.config ? timing.config.mirrorTta : undefined
  if (typeof mirrorTta !== "boolean") {
    throw new Error(
      "timing.json: config.mirrorTta is missing or not a boolean. Mirror-averaging is one of " +
        "the three things a model_version names (embedder, normalisation, mirror), so it " +
        "cannot be assumed — a wrong guess makes two descriptor spaces share one name.",
    )
  }

  const detectorSha256 = safeString(provenance.detectorSha256, "detectorSha256")
  const embedderSha256 = safeString(provenance.embedderSha256, "embedderSha256")
  const engineSha256 = safeString(provenance.engineSha256, "engineSha256")
  const normalisation = safeString(provenance.embedNorm, "embedNorm")

  /** @type {import('../../types.js').VisionIngestConfig} */
  const config = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    runtime: safeString(provenance.runtime, "runtime"),
    detectorSha256,
    embedderSha256,
    engineSha256,
    detectChannels: safeString(provenance.detectChannels, "detectChannels"),
    embedChannels: safeString(provenance.embedChannels, "embedChannels"),
    topKStage: safeString(provenance.topKStage, "topKStage"),
    normalisation,
    normalisationSource: safeString(provenance.embedNormSource, "embedNormSource"),
    mirrorApplied: mirrorTta,
    // The resolutions and thresholds the boxes were actually drawn at. Numbers
    // only, by construction (`numericFields`), so the surrounding config object
    // — which also holds an output directory and a `--limit` — cannot leak.
    detectEdge: numberOrNull(timing.config.detectEdge),
    sourceEdge: numberOrNull(timing.config.sourceEdge),
    nearDuplicateBits: numberOrNull(timing.config.nearDuplicateBits),
    detect: numericFields(timing.config.detect, [
      "longEdge",
      "sourceEdge",
      "scoreThreshold",
      "nmsIou",
      "topK",
      "divisor",
      "duplicateIou",
    ]),
    align: numericFields(timing.config.align, ["size"]),
    // The cutoff table every `route_state` on this run's rows was graded
    // against. `route_profile` names it; these are the values, so a later
    // revision of defaults.js can be diffed against what actually ran rather
    // than against what the file says today.
    routeProfile: PROFILE,
    routeCutoffs: numericFields(routeCutoffs(), [
      "minBoxPx",
      "minBorderPx",
      "minEyeRatio",
      "maxEyeRatio",
      "maxResidual",
      "maxAlignScale",
      "maxOutside",
      "minSharpness",
      "acceptMinBoxPx",
      "acceptMinSharpness",
    ]),
  }

  return {
    // Content-addressed over every face's id, photo id and box — the same
    // digest labels.json carries, so an ingest and a labelling session can be
    // shown to be about the same data. Sixteen hex characters: not a path, not
    // a name, and not a measurement anyone can read a photograph out of.
    datasetId: computeDatasetId(faces),
    // Re-checked here as well as in main(): this is the assembler, and a caller
    // that reached it without going through the CLI (a test, a later script)
    // must not be the one path by which argv-shaped text lands on the row.
    modelVersion: requireModelVersion(modelVersion),
    detectorSha256,
    embedderSha256,
    engineSha256,
    mirrorApplied: mirrorTta,
    normalisation,
    routeProfile: PROFILE,
    config,
  }
}

/**
 * Grade one face for the admin queue, or leave it ungraded.
 *
 * This closes a live gap rather than adding a feature: `route_state` was
 * NULL on every row a real ingest would ever have written, so Phase 4 built the
 * queue's filter and nothing ever filled the column it filters on.
 *
 * A record missing any of the nine signals is left UNGRADED on purpose. `null`
 * means "not yet graded" everywhere downstream and is treated as showable;
 * grading against an absent signal would compare `undefined` and route the face
 * `set_aside`, which is the same value with the opposite meaning.
 * @type {Types.gradeFace}
 */
export function gradeFace(face, cutoffs) {
  const signals = face.signals
  if (!signals) return null
  for (const key of GATE_SIGNAL_KEYS) {
    if (!Number.isFinite(signals[key])) return null
  }
  const verdict = routeFace(signals, cutoffs)
  // The ordering score is deliberately dropped: it orders a live queue and is
  // recomputed, so persisting it would be a second copy to keep true.
  return { state: verdict.state, reason: verdict.reason, profile: verdict.profile }
}

/** @param {number} mediaId @param {string} modelVersion */
function existingCliFaceCount(mediaId, modelVersion) {
  /** @type {{ n: number } | undefined} */
  const row = sql`SELECT COUNT(*) AS n FROM media_faces
    WHERE media_id = ${mediaId} AND model_version = ${modelVersion}
      AND source = 'cli' AND deleted_at IS NULL`.get()
  return row ? row.n : 0
}

/** @param {number} mediaId @param {string} modelVersion */
function retireCliFaces(mediaId, modelVersion) {
  const result = sql`UPDATE media_faces SET deleted_at = ${now()}
    WHERE media_id = ${mediaId} AND model_version = ${modelVersion}
      AND source = 'cli' AND deleted_at IS NULL`.run()
  return result.changes
}

/**
 * Refuse a re-ingest that would leave two live 'cli' generations for the same
 * (media_id, model_version).
 *
 * ⚠ Called from INSIDE the transaction. It used to run before it, which was a
 * plain time-of-check/time-of-use hole: a concurrent ingest could insert
 * between the check and the writes, and both runs would then believe they were
 * the only one — the second silently doubling every face on the photos they
 * shared. BEGIN IMMEDIATE serialises writers, so checking within it makes the
 * refusal mean what it says.
 * @param {number[]} matchedMediaIds
 * @param {string} modelVersion
 */
function assertNoLiveCliFaces(matchedMediaIds, modelVersion) {
  const conflicts = matchedMediaIds.filter((id) => existingCliFaceCount(id, modelVersion) > 0)
  if (conflicts.length > 0) {
    throw new Error(
      `${conflicts.length} matched photo(s) already have live 'cli' rows for model_version ` +
        `"${modelVersion}". Pass --replace to soft-delete them and re-ingest, or use a ` +
        `different --model-version.`,
    )
  }
}

/**
 * The main pass: read the run's JSONL, join to media by sha256, refuse (or
 * --replace) a (media_id, model_version) re-run, and insert one media_faces
 * row per face of every matched photo — with its routing grade and its
 * `ingest_id` — all in one transaction, alongside the `vision_ingests` row
 * itself.
 * @type {Types.ingestRun}
 */
export function ingestRun({ db, runDir, modelVersion, replace, dryRun }) {
  const photosRead = readJsonl(path.join(runDir, "photos.jsonl"))
  const facesRead = readJsonl(path.join(runDir, "faces.jsonl"))
  if (!photosRead.present) throw new Error(`${runDir}/photos.jsonl: not found`)
  if (!facesRead.present) throw new Error(`${runDir}/faces.jsonl: not found`)
  if (photosRead.skipped > 0 || facesRead.skipped > 0) {
    console.warn(
      `warning: skipped ${photosRead.skipped + facesRead.skipped} unparseable JSONL line(s) — was the run interrupted?`,
    )
  }

  const photos = /** @type {Types.Session1PhotoRecord[]} */ (photosRead.records)
  const faces = /** @type {Types.Session1FaceRecord[]} */ (facesRead.records)

  // Read and validated BEFORE anything is queried, let alone written: a run
  // with no usable provenance is not ingestable at all, and finding that out
  // after half a join has run only makes the message arrive later.
  const ingestInput = buildIngestInput({ timing: readTiming(runDir), faces, modelVersion })

  const mediaBySha = loadMediaShaMap()
  const { matched, unmatchedCount } = joinPhotosToMedia(photos, mediaBySha)

  const matchedMediaIds = [...new Set(matched.map((m) => m.mediaId))]
  /** @type {Map<number, number>} */
  const mediaIdByPhotoId = new Map(matched.map((m) => [m.photo.id, m.mediaId]))
  /** @type {Map<number, Types.Session1PhotoRecord>} */
  const photoById = new Map(matched.map((m) => [m.photo.id, m.photo]))
  const facesToInsert = faces.filter((f) => mediaIdByPhotoId.has(f.photoId))

  const frameMeta = frameMetadataForPhotos(photos)
  const cutoffs = routeCutoffs()
  const mediaDims = loadMediaDims()

  /** Decode-space geometry -> the media row's original pixels, resolved once
   *  so the dry run counts exactly what the real pass would write. */
  const geometryFor = (/** @type {Types.Session1FaceRecord} */ face) => {
    const photo = photoById.get(face.photoId)
    const mediaId = /** @type {number} */ (mediaIdByPhotoId.get(face.photoId))
    return photo
      ? scaleFaceGeometry(face, photo, mediaDims.get(mediaId) ?? null)
      : /** @type {const} */ ({ kind: "mismatch", box: null, landmarks: null })
  }

  let framesWritten = 0
  let capturedAtWritten = 0
  let facesInserted = 0
  let facesGraded = 0
  let facesUnscaled = 0
  let facesSkippedAspect = 0
  /** @type {number | null} */
  let ingestId = null

  if (dryRun) {
    // Both refusals are reads, so a dry run can and should answer them — the
    // point of --dry-run is to find out whether the real one would work.
    assertModelVersionInvariant(modelVersion, ingestInput)
    if (!replace) assertNoLiveCliFaces(matchedMediaIds, modelVersion)
    for (const face of facesToInsert) {
      const geometry = geometryFor(face)
      if (geometry.kind === "mismatch") {
        facesSkippedAspect++
        continue
      }
      if (geometry.kind === "unscaled") facesUnscaled++
      facesInserted++
      if (gradeFace(face, cutoffs)) facesGraded++
    }
  } else {
    withTransaction(db, () => {
      // §9a's invariant, and it comes first: a model_version already recorded
      // against a different (embedder, normalisation, mirror) triple means this
      // run's descriptors would be compared against another space's under one
      // name. That failure looks like a slightly worse recogniser rather than a
      // bug, so it is refused at the only moment refusing is cheap.
      assertModelVersionInvariant(modelVersion, ingestInput)
      if (!replace) assertNoLiveCliFaces(matchedMediaIds, modelVersion)

      // Inside the transaction, in the same invocation, before the faces that
      // point at it — so provenance and faces are one atomic fact. A row here
      // with no faces, or faces pointing at a row that rolled back, is a state
      // no later "which faces are stale" query could interpret.
      ingestId = createIngest(ingestInput).id

      if (replace) {
        for (const mediaId of matchedMediaIds) retireCliFaces(mediaId, modelVersion)
      }
      // Frame identity and capture time are properties of the PHOTOGRAPH, not
      // of a descriptor model, so they are written on every run regardless of
      // --replace and are not scoped to model_version. The CLI is
      // authoritative for both (§10), so a re-run overwrites rather than
      // filling only nulls — that is what makes a corrected near-duplicate
      // cutoff take effect on a second pass.
      for (const { photo, mediaId } of matched) {
        const meta = frameMeta.get(photo.id)
        if (!meta) continue
        framesWritten += Number(
          sql`UPDATE media SET frame_root_sha256 = ${meta.frameRootSha256}
            WHERE id = ${mediaId}`.run().changes,
        )
        if (meta.capturedAt !== null) {
          capturedAtWritten += Number(
            sql`UPDATE media SET captured_at = ${meta.capturedAt}
              WHERE id = ${mediaId}`.run().changes,
          )
        }
      }
      for (const face of facesToInsert) {
        const mediaId = /** @type {number} */ (mediaIdByPhotoId.get(face.photoId))
        const geometry = geometryFor(face)
        if (geometry.kind === "mismatch") {
          facesSkippedAspect++
          continue
        }
        if (geometry.kind === "unscaled") facesUnscaled++
        facesInserted++
        const route = gradeFace(face, cutoffs)
        if (route) facesGraded++
        insertFace({
          mediaId,
          bbox: geometry.box,
          landmarks: geometry.landmarks,
          signals: face.signals ?? null,
          descriptor:
            face.descriptor && face.descriptor.length > 0
              ? descriptorToBlob(Float32Array.from(face.descriptor))
              : null,
          modelVersion,
          source: "cli",
          route,
          ingestId,
        })
      }
    })
  }

  return {
    photosInRun: photos.length,
    matched: matched.length,
    unmatched: unmatchedCount,
    facesInserted,
    facesGraded,
    facesUnscaled,
    facesSkippedAspect,
    framesWritten,
    capturedAtWritten,
    ingestId,
  }
}

/** @param {string} file @returns {string} sha256 hex of the file's bytes. */
function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

/**
 * Populate (and repair) media.source_sha256, verified against the stored
 * originals — the manifest is the AUTHORIZATION corpus, never the source of a
 * row mapping.
 *
 * Why not trust `entry.id`, which is exactly what this function used to do: a
 * manifest survives the database it was written against. Rebuild the database
 * under the same manifest path — which happened, once, for real — and every
 * old entry's id now names an arbitrary row in the new database. The old code
 * stamped 95 real photographs with another import's hashes that way, and the
 * sha256 join then silently dropped every face on them.
 *
 * So each live row's stored original is re-hashed, and that hash decides:
 *  - equals the stamped value            -> verified, nothing to do
 *  - row unstamped, hash manifest-known  -> stamp it (the hash, not the claim)
 *  - row stamped otherwise, hash known   -> the stamp is provably stale: fix it
 *  - hash unknown to the manifest        -> fail closed, count, write nothing
 *    (an import that modified originals — `--strip-original` — lands here; its
 *    rows are stamped at import time by sink-local.js and never need this pass)
 *
 * Counts only — never logs a filename (ManifestEntry.name is a relative path
 * at import time, which could itself identify a photo's subject).
 * @type {Types.backfillFromManifest}
 */
export function backfillFromManifest({ db, manifest, uploadsMediaDir, dryRun }) {
  /** @type {Set<string>} */
  const manifestShas = new Set()
  for (const origin of Object.keys(manifest.origins)) {
    for (const sha256 of Object.keys(manifest.origins[origin])) manifestShas.add(sha256)
  }

  /** @type {Array<{ id: number, file_key: string, original_ext: string | null, source_sha256: string | null }>} */
  const rows = sql`SELECT id, file_key, original_ext, source_sha256 FROM media
    WHERE deleted_at IS NULL`.all()

  const counts = { rows: rows.length, verified: 0, stamped: 0, corrected: 0, unverified: 0, unreadable: 0 }
  /** @type {Array<{ id: number, sha256: string }>} */
  const writes = []

  for (const row of rows) {
    if (!row.original_ext) {
      counts.unreadable++
      continue
    }
    // Same layout core/media-storage.js's itemDir derives — but rooted at the
    // caller's database, not at the DATABASE_PATH env that module reads once at
    // import time. `--database` must win here.
    const file = path.join(
      uploadsMediaDir,
      row.file_key.slice(0, 2),
      row.file_key,
      `original.${row.original_ext}`,
    )
    /** @type {string} */
    let rehash
    try {
      rehash = sha256File(file)
    } catch {
      counts.unreadable++
      continue
    }
    if (row.source_sha256 === rehash) {
      counts.verified++
    } else if (!manifestShas.has(rehash)) {
      counts.unverified++
    } else if (row.source_sha256 === null) {
      counts.stamped++
      writes.push({ id: row.id, sha256: rehash })
    } else {
      counts.corrected++
      writes.push({ id: row.id, sha256: rehash })
    }
  }

  // Hashing happens outside the transaction — it can take seconds across a
  // real library, and nothing read above is a write dependency.
  if (!dryRun && writes.length > 0) {
    withTransaction(db, () => {
      for (const write of writes) {
        sql`UPDATE media SET source_sha256 = ${write.sha256} WHERE id = ${write.id}`.run()
      }
    })
  }

  return counts
}

/**
 * The main pass's non-negotiable: never guess a descriptor model. Pulled out
 * of `main()` as its own function so the refusal is unit-testable without
 * spinning up a database.
 *
 * It also VALIDATES, and that is not decoration. `model_version` is the one
 * value on `vision_ingests` that comes straight from argv — it was the single
 * hole in §4's "never argv, never a path", since it reaches `config_json`'s own
 * row and then travels onward in the portable artifact. A tag is a tag: letters,
 * digits, `.`, `-` and `_`, bounded. This project's is
 * `sface128-n127.5d128-nomirror`.
 * @type {Types.requireModelVersion}
 */
export function requireModelVersion(modelVersion) {
  if (!modelVersion) {
    throw new Error(
      "--model-version is required for the main pass (refusing to guess a descriptor model — " +
        "a model swap must never silently mix descriptor spaces)",
    )
  }
  if (modelVersion.length > MODEL_VERSION_MAX || !charsFrom(modelVersion, MODEL_VERSION_CHARS)) {
    throw new Error(
      `--model-version "${modelVersion}" is not a tag. It must be at most ${MODEL_VERSION_MAX} ` +
        `letters, digits, ".", "-" or "_" (this project's is ` +
        `"sface128-n127.5d128-nomirror"). It is written to vision_ingests and travels from ` +
        `there to production in the face-work artifact, so a path, an environment reference or ` +
        `a line of prose may not become one.`,
    )
  }
  return modelVersion
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.valid) {
    process.stderr.write(parsed.error + "\n")
    process.exitCode = 1
    return
  }
  const args = parsed.value

  const dbPath = resolveDbPath(args.database)
  const db = openDatabase(dbPath)
  try {
    if (args.backfillManifest) {
      const manifest = loadManifest(args.backfillManifest)
      // The stored originals live beside whichever database this invocation
      // targets — core/media-storage.js's layout, rooted here by the flag.
      const uploadsMediaDir = path.join(path.dirname(dbPath), "uploads", "media")
      const result = backfillFromManifest({ db, manifest, uploadsMediaDir, dryRun: args.dryRun })
      console.log(
        `backfill-manifest: ${result.rows} media rows — ${result.verified} verified, ` +
          `${result.stamped} stamped, ${result.corrected} corrected (stale id), ` +
          `${result.unverified} unverified (hash unknown to manifest — left alone), ` +
          `${result.unreadable} without a readable original` +
          (args.dryRun ? " (dry run — nothing written)" : ""),
      )
    }

    if (args.runDir) {
      const modelVersion = requireModelVersion(args.modelVersion)
      const result = ingestRun({
        db,
        runDir: args.runDir,
        modelVersion,
        replace: args.replace,
        dryRun: args.dryRun,
      })
      console.log(`photos in run: ${result.photosInRun}`)
      console.log(`matched to media: ${result.matched}`)
      console.log(`unmatched (no sha match): ${result.unmatched}`)
      console.log(`faces inserted: ${result.facesInserted}` + (args.dryRun ? " (dry run — nothing written)" : ""))
      console.log(`faces graded for the queue: ${result.facesGraded}`)
      if (result.facesUnscaled > 0) {
        console.log(
          `faces kept in decode-space coordinates (media row has no dimensions): ${result.facesUnscaled}`,
        )
      }
      if (result.facesSkippedAspect > 0) {
        console.log(
          `faces SKIPPED — media dimensions contradict the photo's aspect ratio ` +
            `(sha join suspect): ${result.facesSkippedAspect}`,
        )
      }
      if (!args.dryRun) {
        console.log(`ingest id: ${result.ingestId}`)
        console.log(`frame roots written: ${result.framesWritten}`)
        console.log(`capture times written: ${result.capturedAtWritten}`)
      }
    }
  } finally {
    db.close()
  }
}

// `node scripts/vision/ingest-faces.js ...` runs; `import` from a test does not.
// Same guard as scripts/import-media.js / scripts/vision/session1.js.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((err) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
}
