#!/usr/bin/env node
/** @file CLI: carry face-tagging work from the machine that did the naming to
 *  the machine that serves the site (plan §13). Four subcommands behind one
 *  entry point — `export`, `import`, `preflight`, `revoke`.
 *
 *  ⚠ **OPERATIONAL ORDER: deploy the schema change BEFORE moving any data.**
 *  `add_vision_provenance` runs wherever the new code first starts. Pushing a
 *  re-schema'd database under the old server breaks the admin faces endpoints
 *  outright — they read columns that code does not know about, and they read
 *  `media_faces.face_identity_id` as if it were authored rather than projected.
 *  So: deploy the code, let it migrate on boot, run the batch, and only then
 *  import. This note is here and in `--help` on purpose; it is not something
 *  the tool can enforce for you, because by the time this tool runs the
 *  decision has already been made.
 *
 *  ## What the artifact carries — and what it deliberately does not
 *
 *  **No descriptors.** Production has the photographs and re-runs the batch, so
 *  it derives its own. Shipping them would put a file containing biometric
 *  vectors *and* people's real names into transit for no gain at all.
 *
 *  **No filesystem paths, no photo filenames, no source-machine row ids.** A
 *  confirmation is keyed by `(photo content hash, box)` — content, on both
 *  sides. People are keyed by `p1..pN`, positions in a list ordered by the
 *  people's own content, never by `people.id`. Provenance travels as the
 *  *logical* ingest object (hashes, model version, normalisation, config), never
 *  as `vision_ingests.id`: the target creates its own row by running its own
 *  batch, and this tool maps the exported reference onto it.
 *
 *  **No `people.guest_id`, no `people.notes`.** The guest roster is the target's
 *  own business and its ids are its own; a newly created person arrives
 *  unlinked and is joined to a guest in the admin UI. Notes are free text about
 *  a person that nothing here needs.
 *
 *  **No actor.** `face_assignments.actor` is `core/utils.js`'s `actorId()` — the
 *  first eight characters of `session.token`. Note what that column actually
 *  holds: `withAdmin` passes the sessions ROW through, and `db/sessions.js`
 *  stores the SHA-256 HASH there, never the bearer token (`createSession`
 *  returns the plaintext to the client and writes `hashToken(token)`). So this
 *  is eight hex characters of a digest — it authenticates nobody, and calling
 *  it a leaked credential is a false alarm this project has raised before.
 *  It is omitted for the duller reason: it identifies one session on one
 *  machine and means nothing on the target. The import writes its own actor.
 *
 *  ## Projected state, plus enough ledger to be honest
 *
 *  The exported state of a face is `media_faces.face_identity_id` — the
 *  PROJECTION — not a replay of the ledger. That is deliberate, and it is the
 *  one place the two can disagree: a confirmation made before the ledger
 *  existed has a column value and zero events, and replaying it would export
 *  "nobody". The column is what every reader trusts, so the column is the state.
 *
 *  The ledger is then carried as an ANNOTATION on each confirmation —
 *  `events` (how many surviving events that face has), `kind` (the batch kind
 *  of the surviving one) and `decidedAt`. Enough for an operator to see that a
 *  confirmation came from a bulk propagate rather than a human, and enough to
 *  spot the pre-ledger rows (`events: 0`). Not the events themselves: replaying
 *  a source machine's history against target row ids is exactly the trust this
 *  format refuses.
 *
 *  A `not_a_face` verdict IS carried, and it is the one thing that requires a
 *  ledger event rather than a column: `media_faces.deleted_at` has a second
 *  author (schema.js §10 soft-deletes an upload-sourced row the CLI has
 *  superseded), so "soft-deleted" alone does not mean "a human said this is not
 *  a face".
 *
 *  ## Merged identities
 *
 *  A merged-away identity never exports as a live person, and its faces export
 *  under the person they resolve to. This falls out rather than being
 *  implemented twice: `db/face-assignments.js`'s `resolveIdentity` already
 *  follows `merged_into` transitively (with a cycle guard), and every identity
 *  read here goes through it.
 *
 *  ## A guess never arrives as ground truth
 *
 *  `face_identities.provenance` is what keeps a human's judgement ('confirmed')
 *  apart from the model's own guess ('propagated'), and `confirmedIdentityFaces`,
 *  `confirmedIdentitiesPerMedia` and `confirmedCooccurrence` all select the
 *  former. So both halves carry it: the export writes each confirmation's real
 *  provenance, and the import resolves each event to the person's identity OF
 *  THAT PROVENANCE, creating a second-class 'propagated' one where it must.
 *  `--include-propagated` widens what is carried; nothing anywhere promotes it.
 *  Writing every arrival as 'confirmed' would build, on the machine that serves
 *  the site, exactly the feedback loop the column exists to prevent.
 *
 *  ## Replay safety
 *
 *  The batch id is the artifact's own content digest — `face-work-<32 hex>` over
 *  the canonical JSON of the payload, excluding the export timestamp. So:
 *
 *   - re-exporting an unchanged source produces the same digest, so a
 *     re-export is a no-op too;
 *   - a hand-edited artifact produces a different digest than the one it
 *     declares, and is refused IN TRANSIT.
 *
 *  What the digest is NOT is an authentication: it is unkeyed, so re-sealing an
 *  edited file costs one line. Every claim the import acts on — the op, the
 *  provenance, the refs, the shape of a key — is therefore VALIDATED in
 *  `parseFaceWorkArtifact`, never asserted by a cast at the boundary.
 *
 *  Nor does an existing batch id mean "nothing to do". Production carries a
 *  curated SUBSET of the photographs, so the ordinary case is an import that
 *  applies what it can and a later one that finishes the job once the rest is
 *  ingested. A batch that already exists is APPENDED to, so a completed hand-off
 *  is still one revocable batch, and `alreadyApplied` means every confirmation
 *  is satisfied here rather than merely that the id has been seen.
 *
 *  A batch that was imported and then REVOKED is refused outright with no
 *  override. Revocation is a decision someone took; re-running the same file
 *  would silently undo it, and there is no flag whose name would make that
 *  obvious enough.
 *
 *  ## Where an export may be written
 *
 *  An artifact carries real display names, a content hash per photograph and a
 *  box per face, and this repository is PUBLIC. So a destination inside the repo
 *  is REFUSED unless `.gitignore` already covers it — enforced before the
 *  database is even opened, not warned about after the write. CLAUDE.md's
 *  framing for this class of rule is "enforced, not just written down".
 *
 *  ## Box matching
 *
 *  Automatic import requires a provenance-equivalent detector run, and under
 *  that requirement the boxes are byte-identical, so exact key matching is
 *  belt-and-braces. **Overlap matching is a reviewed exception behind
 *  `--match-overlap`**, because a detector threshold or resolution change can
 *  attach a real person's confirmation to the wrong face while still passing
 *  mutual-best matching. The overlap path is `boxIou` + mutual-best + a margin,
 *  the same shape as `rekey-labels.js`'s.
 *
 *  ## What "matched by content, not by key" turns out to mean
 *
 *  An incoming person matches an existing one by OVERLAP between their faces
 *  and that person's confirmed assignments — never by name. Two consequences
 *  are worth stating plainly, because they are not what a first reading
 *  suggests:
 *
 *   - A person whose only matched face the target has already confirmed IS that
 *     person, whatever the two machines call them. That is not a conflict and
 *     is not refused; refusing it would refuse the ordinary case where someone
 *     was named on both machines and the names differ.
 *   - Conversely, an incoming person who shares NO face with anyone here is a
 *     new person even when a live person of that exact name exists. The name
 *     collision is reported and the operator merges them in the admin UI.
 *
 *  So the contradictions worth refusing are the ones where the two databases
 *  disagree about which faces belong TOGETHER (`person-split`,
 *  `person-collapse`), plus the one decision that names nobody and so cannot be
 *  reconciled by overlap at all: `not_a_face` against a confirmed face.
 *
 *  ## Transactions
 *
 *  `db/utils.js`'s `withTransaction` is a bare `BEGIN IMMEDIATE` with no
 *  savepoints and does not nest, and `db/face-assignments.js`'s `revokeBatch`
 *  owns one. So this file opens exactly one transaction of its own around the
 *  whole import, calls only the non-transactional primitives inside it
 *  (`createBatch`, `createPerson`, `createIdentity`, `recordAssignment`), and
 *  never calls `revokeBatch` from inside that transaction.
 *
 *  Undoing an import is the `revoke` subcommand, which opens the same database
 *  and calls `revokeBatch` with no transaction of its own around it. That is
 *  only possible because `revokeBatch` now opens its transaction through the
 *  BOUND executor (`db/utils.js`'s `withBoundTransaction`) rather than through
 *  `db/connection.js`'s singleton — this file never calls `init()`, so the old
 *  version threw "Database not initialized" here, and the undo the import
 *  printed was not a thing an operator could run.
 *
 *  §15 (no photo snooping): nothing here opens a photograph. The database path,
 *  the artifact path, the weights directory and the engine are all explicit
 *  arguments; nothing is searched for.
 *
 *  Uses its own `DatabaseSync` + `bindExecutor`, never `db/connection.js`'s
 *  process-wide singleton — same reason `ingest-faces.js` does.
 */
/** @import * as Types from './types.js' */

import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import {
  createBatch,
  getBatch,
  recordAssignment,
  resolveIdentity,
  revokeBatch,
} from "../../db/face-assignments.js"
import { createIdentity, identitiesForPerson } from "../../db/media-faces.js"
import { createPerson, findLivePeopleByName, nameKey } from "../../db/people.js"
import { createTables, runMigrations } from "../../db/schema.js"
import { bindExecutor, sql } from "../../db/sql.js"
import { now } from "../../db/utils.js"
import { boxIou } from "../../public/vision/detect.js"
import { hashFile } from "../lib/import-manifest.js"
import { verifyWeights } from "./verify-weights.js"

const USAGE = `Usage: node scripts/vision/export-face-work.js <command> [options]

  DEPLOY THE SCHEMA CHANGE BEFORE MOVING ANY DATA. The add_vision_provenance
  migration runs wherever the new code first starts. Pushing a re-schema'd
  database under the old server breaks the admin faces endpoints outright.
  Order: deploy code -> it migrates on boot -> run the batch there -> import.

Commands:

  export <artifact-path>     Write the portable face-work artifact. The path is
                              REFUSED if it is inside this repository and not
                              under a directory .gitignore covers — the file
                              carries people's real names and this repo is public.
  import <artifact-path>     Apply one to this machine's database. Applies what
                              this machine has the photographs for; re-run it
                              after ingesting the rest and the remainder is
                              appended to the SAME batch.
  preflight                  Check weights + engine only, and stop.
  revoke --batch ID          Take an applied batch back: flag it revoked and
                              re-project every face it touched. Nothing is
                              deleted — the events stay in the ledger and stop
                              counting — and a face somebody corrected by hand
                              AFTER the batch keeps that correction. One-way:
                              reinstating a batch means importing it again.

Common options:

  --database PATH            SQLite file. Default: $DATABASE_PATH, else data/wedding.db.
  --ingest N                 vision_ingests row to work from. Default: the newest.
  --faces-from WHICH         Which faces belong to that ingest: "ingest" (the
                              ingest_id column, the default) or "model-version"
                              (model_version + source='cli', for rows written
                              before ingest provenance existed).
  --dry-run                  Report the plan; write nothing.
  --help, -h                 Show this message.

export options:

  --include-propagated       Also carry identities whose provenance is
                              'propagated' — unreviewed guesses. Off by default:
                              the artifact is called face WORK because it is
                              meant to be the human judgements. Carried ones
                              stay 'propagated' on the target; nothing promotes
                              a guess to a confirmation.

import options:

  --weights DIR              Directory holding the pinned .onnx weight files.
                              REQUIRED. Verified against the digests in
                              scripts/vision/verify-weights.js before the
                              database is touched.
  --engine PATH              The vision engine module (tmp/rig/engine.mjs).
                              REQUIRED. Hashed and compared to the engine the
                              artifact was produced under.
  --match-overlap            REVIEWED EXCEPTION. Accept a target ingest whose
                              provenance is not equivalent, and match boxes by
                              mutual-best IoU instead of exactly. A detector
                              threshold or resolution change can otherwise
                              attach a real person's confirmation to the wrong
                              face while still passing mutual-best matching.
  --force                    Proceed past reported conflicts by APPENDING (never
                              overwriting) the incoming decision. An existing
                              confirmation stays in the ledger and the whole
                              import stays revocable as one batch.
  --actor NAME               face_assignment_batches.actor. Letters, digits,
                              ".", "-", "_", "@"; at most 64 characters.
                              Default: face-work-import.
  --note TEXT                Note on the batch. Printable, one line, at most
                              200 characters.

preflight options:

  --weights DIR              Required.
  --engine PATH              Required.
  --expect-engine SHA256     Engine digest to require. Or pass an artifact with
                              --artifact PATH and take it from there.
  --artifact PATH            Read the expected engine digest from an artifact.

revoke options:

  --batch ID                 The batch to revoke. Required. Printed by import,
                              and listed in the admin Faces tab.
  --actor NAME               Recorded as face_assignment_batches.revoked_by.
                              Same character rules as --actor above.
`

/** The artifact's format tag and version. Both are checked on import. */
export const FORMAT = "wedding-face-work"
export const FORMAT_VERSION = 1

/** `face_assignment_batches.kind` for an import.
 *
 *  The vocabulary is fixed by the schema comment at four values and this is the
 *  nearest fit: a bulk arrival of decisions made elsewhere. A fifth value would
 *  be a schema change, and inventing one silently is how a documented enum
 *  stops being one. */
export const IMPORT_BATCH_KIND = "label-import"

/** Default `actor` for the batch and the identities an import creates. */
export const IMPORT_ACTOR = "face-work-import"

/** Default `revoked_by` for the `revoke` subcommand. A separate default from
 *  IMPORT_ACTOR because the two are different acts by possibly different
 *  people, and `revoked_by` reading "face-work-import" would attribute the undo
 *  to whoever did the thing being undone. Neither names a person: both say
 *  which tool ran, which is all an unattended CLI honestly knows. */
export const REVOKE_ACTOR = "face-work-revoke"

/** How many hex characters of the payload digest name the batch. 128 bits. */
const BATCH_ID_CHARS = 32

/** Overlap matching floor and margin. Same values and same reasoning as
 *  `rekey-labels.js`: below the floor there is no candidate at all, and the
 *  margin is what makes the outcome independent of iteration order. */
export const MATCH_IOU_FLOOR = 0.5
export const MATCH_IOU_MARGIN = 0.1

/**
 * The ops an artifact may carry, and the whole vocabulary an import understands.
 *
 * Deliberately NARROWER than `FaceAssignmentOp`. The ledger also has `clear`
 * ("this face is nobody") and `negative` ("this face is NOT that person"), and
 * neither survives a content-keyed hand-off: `negative` is a constraint against
 * one identity on one machine, and coercing it into an `assign` is the exact
 * INVERSION of the decision it records. An artifact carrying either is refused
 * at parse time rather than narrowed by a cast — the file is the boundary, and
 * a type assertion at a boundary is a claim, not a check.
 */
export const ARTIFACT_OPS = Object.freeze(["assign", "not_a_face"])

/** The identity provenances an artifact may carry, and the reason the column
 *  exists: `confirmed` is a human's judgement, `propagated` is the model's own
 *  guess. `db/media-faces.js`'s `confirmedIdentityFaces`,
 *  `confirmedIdentitiesPerMedia` and `confirmedCooccurrence` all select
 *  `confirmed`, so laundering one into the other is the model being fed its own
 *  output as ground truth. Both halves of this file keep them apart. */
export const ARTIFACT_PROVENANCES = Object.freeze(["confirmed", "propagated"])

/** The ops a carried ledger ANNOTATION may report. `negative` is excluded for
 *  the same reason `ledgerSummaries` excludes it: replay ignores it, so a
 *  summary naming it would describe a history nobody can reproduce. */
const ARTIFACT_LEDGER_OPS = Object.freeze(["assign", "clear", "not_a_face"])

/** A person's name is a name. Anything longer is not one, and `people.display_name`
 *  has no length constraint of its own to catch it. */
const MAX_DISPLAY_NAME = 200

/** `face_assignment_batches.actor` — a short label naming who ran the import,
 *  written on the target by the operator standing at it. */
const MAX_ACTOR = 64
const ACTOR_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_@"

/** `face_assignment_batches.note` — free text, but bounded and printable. */
const MAX_NOTE = 200

// ---------------------------------------------------------------------------
// Canonicalisation — the whole contract between the two halves
// ---------------------------------------------------------------------------

/**
 * Two decimal places, matching `round(value, 2)` in session1.js — which is what
 * wrote these boxes in the first place. Applied again so a key does not depend
 * on the writer having rounded.
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  if (!Number.isFinite(value)) return 0
  // `+ 0` collapses -0 to 0, so a box at the origin keys the same either way.
  return Math.round(value * 100) / 100 + 0
}

/**
 * The key a confirmation travels under: photograph content hash, then box.
 * Content on both sides — no row id, no filename, no path.
 * @type {Types.faceWorkBoxKey}
 */
export function faceWorkBoxKey(sha256, box) {
  return (
    `${sha256}:${round2(box.x)},${round2(box.y)},` + `${round2(box.w)},${round2(box.h)}`
  )
}

/**
 * Deterministic JSON: object keys sorted by code unit, no whitespace.
 *
 * `localeCompare` is deliberately NOT used — it is locale-dependent, so the
 * same payload could hash differently on two machines, which is the one thing
 * a content address may never do. No regex; this is string building.
 * @type {Types.canonicalJson}
 */
export function canonicalJson(value) {
  if (value === null || value === undefined) return "null"
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) {
    /** @type {string[]} */
    const items = []
    for (const item of value) items.push(canonicalJson(item))
    return `[${items.join(",")}]`
  }
  // Anything left that is not a plain object (a function, a symbol) has no JSON
  // form; "null" is what JSON.stringify puts in an array slot for one, so the
  // two agree rather than the canonical form inventing a third answer.
  if (typeof value !== "object") return "null"
  const record = /** @type {Record<string, unknown>} */ (value)
  const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  /** @type {string[]} */
  const parts = []
  for (const key of keys) {
    if (record[key] === undefined) continue
    parts.push(`${JSON.stringify(key)}:${canonicalJson(record[key])}`)
  }
  return `{${parts.join(",")}}`
}

/**
 * The artifact's content address, over the payload only — never the export
 * timestamp or the tool version. So re-exporting an unchanged source produces
 * the same digest, and re-importing it is a no-op rather than a second batch
 * that happens to change nothing.
 * @type {Types.faceWorkDigest}
 */
export function faceWorkDigest(payload) {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex")
}

/**
 * @param {string} digest
 * @returns {string}
 */
export function batchIdForDigest(digest) {
  return `face-work-${digest.slice(0, BATCH_ID_CHARS)}`
}

// ---------------------------------------------------------------------------
// Provenance equivalence
// ---------------------------------------------------------------------------

/**
 * The fields that must agree for two detector runs to be producing the same
 * boxes over the same photographs.
 *
 * `dataset_id` is NOT among them, deliberately. `dataset-id.js` hashes RUN-LOCAL
 * face and photo ids, which depend on the order the machine's filesystem
 * enumerated a directory — two honest runs of the same pipeline over the same
 * photographs routinely differ. Requiring it would refuse every real migration,
 * and would refuse it for a reason that has nothing to do with the geometry.
 *
 * `route_profile` is not among them either: it decides what an operator is
 * SHOWN, not where a box is. A difference is reported as an advisory.
 */
export const PROVENANCE_FIELDS = Object.freeze([
  "modelVersion",
  "detectorSha256",
  "embedderSha256",
  "engineSha256",
  "mirrorApplied",
  "normalisation",
])

/**
 * The `config_json` keys that move a box. Compared when present on either side;
 * absent from both is vacuously equal. Everything else in the config is
 * reported as an advisory rather than a refusal — an onnxruntime patch version
 * is worth knowing about and is not worth refusing a migration over.
 */
export const BOX_DETERMINING_CONFIG_KEYS = Object.freeze([
  "detectorChannelOrder",
  "detectionResolution",
  "detectionWidth",
  "detectionHeight",
  "scoreThreshold",
  "nmsThreshold",
  "topK",
  "duplicateIou",
])

/**
 * What differs between the ingest an artifact was produced under and a
 * `vision_ingests` row on this machine.
 *
 * Returns two lists rather than a boolean: `blocking` is what makes the boxes
 * different, `advisory` is what an operator should read and then decide about.
 * @type {Types.faceWorkProvenanceDiff}
 */
export function faceWorkProvenanceDiff(exported, targetRow) {
  /** @type {string[]} */
  const blocking = []
  /** @type {string[]} */
  const advisory = []

  /** @type {Record<string, unknown>} */
  const target = {
    modelVersion: targetRow.model_version,
    detectorSha256: targetRow.detector_sha256,
    embedderSha256: targetRow.embedder_sha256,
    engineSha256: targetRow.engine_sha256,
    mirrorApplied: targetRow.mirror_applied ? 1 : 0,
    normalisation: targetRow.normalisation,
  }
  /** @type {Record<string, unknown>} */
  const source = {
    modelVersion: exported.modelVersion,
    detectorSha256: exported.detectorSha256,
    embedderSha256: exported.embedderSha256,
    engineSha256: exported.engineSha256,
    mirrorApplied: exported.mirrorApplied ? 1 : 0,
    normalisation: exported.normalisation,
  }
  for (const field of PROVENANCE_FIELDS) {
    if (canonicalJson(source[field] ?? null) !== canonicalJson(target[field] ?? null)) {
      blocking.push(field)
    }
  }

  if (exported.routeProfile !== targetRow.route_profile) advisory.push("routeProfile")

  /** @type {Record<string, unknown>} */
  let targetConfig = {}
  try {
    const parsed = JSON.parse(targetRow.config_json)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) targetConfig = parsed
  } catch {
    advisory.push("config (target's config_json is not readable JSON)")
  }
  const sourceConfig = exported.config

  for (const key of BOX_DETERMINING_CONFIG_KEYS) {
    const inSource = Object.prototype.hasOwnProperty.call(sourceConfig, key)
    const inTarget = Object.prototype.hasOwnProperty.call(targetConfig, key)
    if (!inSource && !inTarget) continue
    if (canonicalJson(sourceConfig[key] ?? null) !== canonicalJson(targetConfig[key] ?? null)) {
      blocking.push(`config.${key}`)
    }
  }

  const otherKeys = new Set([...Object.keys(sourceConfig), ...Object.keys(targetConfig)])
  for (const key of BOX_DETERMINING_CONFIG_KEYS) otherKeys.delete(key)
  for (const key of [...otherKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (canonicalJson(sourceConfig[key] ?? null) !== canonicalJson(targetConfig[key] ?? null)) {
      advisory.push(`config.${key}`)
    }
  }

  return { equivalent: blocking.length === 0, blocking, advisory }
}

// ---------------------------------------------------------------------------
// Database plumbing — this script's own connection, never db/connection.js's
// ---------------------------------------------------------------------------

/** @type {WeakMap<import('node:sqlite').DatabaseSync, Map<string, import('node:sqlite').StatementSync>>} */
const statementCaches = new WeakMap()

/**
 * Point `db/sql.js`'s tagged template at THIS connection.
 *
 * `bindExecutor` sets one process-wide executor, so every entry point below
 * re-binds before it reads anything. That is what lets one process hold a
 * source and a target database at once — as the round-trip test does — without
 * the second one silently answering the first one's queries.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function useDatabase(db) {
  let cache = statementCaches.get(db)
  if (!cache) {
    cache = new Map()
    statementCaches.set(db, cache)
  }
  const stmtCache = cache
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
 * Open (creating if needed) a SQLite file with the server's pragmas and schema.
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
  return useDatabase(db)
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
 * The one transaction this file owns. `db/utils.js`'s does not nest and
 * `revokeBatch` owns its own, so nothing called from inside `fn` may open one.
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

// ---------------------------------------------------------------------------
// Reading one side's faces
// ---------------------------------------------------------------------------

/**
 * The ingest to work from: the one named, or the newest.
 * @param {number | null} ingestId
 * @returns {import('../../types.js').VisionIngest}
 */
function requireIngest(ingestId) {
  /** @type {import('../../types.js').VisionIngest | undefined} */
  const row =
    ingestId === null
      ? sql`SELECT * FROM vision_ingests ORDER BY id DESC LIMIT 1`.get()
      : sql`SELECT * FROM vision_ingests WHERE id = ${ingestId}`.get()
  if (!row) {
    throw new Error(
      ingestId === null
        ? "no vision_ingests rows on this database — run the detection batch here first, " +
          "so that this machine has provenance of its own to map onto"
        : `no vision_ingests row with id ${ingestId}`,
    )
  }
  return row
}

/**
 * The logical provenance object, as it travels. Never `row.id`, never
 * `created_at` — one is a source-machine primary key and the other is a fact
 * about when a machine ran, not about what it produced.
 * @param {import('../../types.js').VisionIngest} row
 * @returns {Types.FaceWorkIngest}
 */
export function ingestToLogical(row) {
  /** @type {Record<string, unknown>} */
  let config = {}
  try {
    const parsed = JSON.parse(row.config_json)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed
  } catch {
    config = {}
  }
  return {
    datasetId: row.dataset_id,
    modelVersion: row.model_version,
    detectorSha256: row.detector_sha256,
    embedderSha256: row.embedder_sha256,
    engineSha256: row.engine_sha256,
    mirrorApplied: row.mirror_applied ? 1 : 0,
    normalisation: row.normalisation,
    routeProfile: row.route_profile,
    config,
  }
}

/**
 * Every face row belonging to an ingest, with its photograph's content hash.
 *
 * Soft-deleted face rows come back too: a `not_a_face` verdict lives on one,
 * and dropping them here would silently lose the human judgement this whole
 * tool exists to move.
 * @param {import('../../types.js').VisionIngest} ingest
 * @param {Types.FaceWorkFacesFrom} facesFrom
 * @returns {Types.FaceWorkFaceRow[]}
 */
export function candidateFaces(ingest, facesFrom) {
  if (facesFrom === "model-version") {
    return sql`SELECT mf.id AS id, mf.bbox_x AS bbox_x, mf.bbox_y AS bbox_y,
        mf.bbox_w AS bbox_w, mf.bbox_h AS bbox_h,
        mf.face_identity_id AS face_identity_id, mf.deleted_at AS deleted_at,
        m.source_sha256 AS sha256
      FROM media_faces mf
      JOIN media m ON m.id = mf.media_id AND m.deleted_at IS NULL
      WHERE m.source_sha256 IS NOT NULL
        AND mf.model_version = ${ingest.model_version}
        AND mf.source = 'cli'
      ORDER BY mf.id`.all()
  }
  return sql`SELECT mf.id AS id, mf.bbox_x AS bbox_x, mf.bbox_y AS bbox_y,
      mf.bbox_w AS bbox_w, mf.bbox_h AS bbox_h,
      mf.face_identity_id AS face_identity_id, mf.deleted_at AS deleted_at,
      m.source_sha256 AS sha256
    FROM media_faces mf
    JOIN media m ON m.id = mf.media_id AND m.deleted_at IS NULL
    WHERE m.source_sha256 IS NOT NULL AND mf.ingest_id = ${ingest.id}
    ORDER BY mf.id`.all()
}

/**
 * Per-face ledger summary: how many surviving events, and what the newest one
 * was. Whole-table scan and a join in JS rather than an `IN` list — the ledger
 * is thousands of rows, and chunking an id list is machinery this does not need.
 *
 * `negative` is excluded and revoked batches are excluded, matching
 * `replayFace` exactly: a summary that counted events replay ignores would
 * describe a history nobody can reproduce.
 * @returns {Map<number, Types.FaceWorkLedgerSummary>}
 */
export function ledgerSummaries() {
  /** @type {Array<{ face_id: number, op: import('../../types.js').FaceAssignmentOp, created_at: string, batch_kind: string | null }>} */
  const rows = sql`SELECT fa.face_id AS face_id, fa.op AS op, fa.created_at AS created_at,
      b.kind AS batch_kind
    FROM face_assignments fa
    LEFT JOIN face_assignment_batches b ON b.batch_id = fa.batch_id
    WHERE fa.op != 'negative'
      AND (fa.batch_id IS NULL OR b.revoked_at IS NULL)
    ORDER BY fa.face_id, fa.id`.all()

  /** @type {Map<number, Types.FaceWorkLedgerSummary>} */
  const map = new Map()
  for (const row of rows) {
    const found = map.get(row.face_id)
    if (found) {
      found.events++
      found.op = row.op
      found.kind = row.batch_kind
      found.decidedAt = row.created_at
    } else {
      map.set(row.face_id, {
        events: 1,
        op: row.op,
        kind: row.batch_kind,
        decidedAt: row.created_at,
      })
    }
  }
  return map
}

/** identity id -> the person behind it, for every live identity. */
function livePersonByIdentity() {
  /** @type {Array<{ identity_id: number, provenance: import('../../types.js').FaceIdentityProvenance, person_id: number, display_name: string }>} */
  const rows = sql`SELECT fi.id AS identity_id, fi.provenance AS provenance,
      p.id AS person_id, p.display_name AS display_name
    FROM face_identities fi
    JOIN people p ON p.id = fi.person_id AND p.deleted_at IS NULL
    WHERE fi.deleted_at IS NULL
    ORDER BY fi.id`.all()
  /** @type {Map<number, { personId: number, displayName: string, provenance: import('../../types.js').FaceIdentityProvenance }>} */
  const map = new Map()
  for (const row of rows) {
    map.set(row.identity_id, {
      personId: row.person_id,
      displayName: row.display_name,
      provenance: row.provenance,
    })
  }
  return map
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Group candidate faces by their content key, resolving the two ways one key
 * can carry more than one row.
 *
 * The same `(photo content hash, box)` legitimately names several `media_faces`
 * rows: a photograph imported twice under two `media` ids, and — under
 * `--faces-from=model-version` — a `--replace` re-ingest whose superseded rows
 * are still present. Neither is ambiguity about WHO the face is, so neither is
 * an error. What IS an error is two rows under one key that disagree about it.
 * @param {Types.FaceWorkFaceRow[]} rows
 * @returns {Map<string, Types.FaceWorkFaceRow[]>}
 */
export function groupFacesByKey(rows) {
  /** @type {Map<string, Types.FaceWorkFaceRow[]>} */
  const map = new Map()
  for (const row of rows) {
    const key = faceWorkBoxKey(row.sha256, {
      x: row.bbox_x,
      y: row.bbox_y,
      w: row.bbox_w,
      h: row.bbox_h,
    })
    const found = map.get(key)
    if (found) found.push(row)
    else map.set(key, [row])
  }
  return map
}

/**
 * Order the people and give each a `p1..pN` ref.
 *
 * The order is derived from the people's own CONTENT — folded display name,
 * then the sorted list of their confirmation keys — so it is stable across
 * machines and carries no row id. Two people who share a display name are still
 * separated, by their faces.
 * @param {Array<{ displayName: string, keys: string[] }>} people
 * @returns {Array<{ ref: string, displayName: string, keys: string[] }>}
 */
export function assignPersonRefs(people) {
  const ordered = people
    .map((person) => ({
      person,
      sortKey: `${nameKey(person.displayName)}\n${[...person.keys].sort().join("\n")}`,
    }))
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
  return ordered.map((entry, index) => ({
    ref: `p${index + 1}`,
    displayName: entry.person.displayName,
    keys: entry.person.keys,
  }))
}

/** @type {Types.buildFaceWorkExport} */
export function buildFaceWorkExport({ db, ingestId, facesFrom, includePropagated }) {
  useDatabase(db)

  const ingestRow = requireIngest(ingestId)
  const rows = candidateFaces(ingestRow, facesFrom)
  const grouped = groupFacesByKey(rows)
  const ledger = ledgerSummaries()
  const identities = livePersonByIdentity()

  /** @type {Map<number, { displayName: string, keys: string[] }>} */
  const peopleByPersonId = new Map()
  /** @type {Array<{ key: string, op: "not_a_face", ledger: Types.FaceWorkLedgerSummary | null }>} */
  const notAFace = []
  /** @type {Map<string, { personId: number, provenance: import('../../types.js').FaceIdentityProvenance, ledger: Types.FaceWorkLedgerSummary | null }>} */
  const assigned = new Map()
  let disagreements = 0
  let skippedPropagated = 0

  for (const [key, group] of grouped) {
    /** @type {Set<string>} */
    const verdicts = new Set()
    /** @type {{ personId: number, provenance: import('../../types.js').FaceIdentityProvenance, ledger: Types.FaceWorkLedgerSummary | null } | null} */
    let assignment = null
    /** @type {Types.FaceWorkLedgerSummary | null} */
    let notAFaceLedger = null

    for (const row of group) {
      const summary = ledger.get(row.id) ?? null
      // A `not_a_face` verdict must come from the LEDGER, never from
      // `deleted_at` alone: schema.js §10 also soft-deletes an upload-sourced
      // row the CLI superseded, and that is not a human saying "not a face".
      if (summary && summary.op === "not_a_face") {
        verdicts.add("not_a_face")
        notAFaceLedger = summary
        continue
      }
      // The PROJECTION is the state (see the file header). A pre-ledger
      // confirmation has a column value and zero events; replaying it would
      // export "nobody".
      if (row.face_identity_id === null) continue
      // Defensive resolve: a pre-ledger column may point at an identity that
      // has since been merged away.
      const resolved = resolveIdentity(row.face_identity_id)
      if (resolved === null) continue
      const identity = identities.get(resolved)
      if (!identity) continue
      if (identity.provenance !== "confirmed" && !includePropagated) {
        skippedPropagated++
        continue
      }
      verdicts.add(`person:${identity.personId}`)
      assignment = { personId: identity.personId, provenance: identity.provenance, ledger: summary }
      if (!peopleByPersonId.has(identity.personId)) {
        peopleByPersonId.set(identity.personId, { displayName: identity.displayName, keys: [] })
      }
    }

    if (verdicts.size === 0) continue
    if (verdicts.size > 1) {
      // Counted, never described. Naming the photograph or the people would put
      // a measurement of real photographs into whatever the operator pastes.
      disagreements++
      continue
    }
    if (verdicts.has("not_a_face")) {
      notAFace.push({ key, op: "not_a_face", ledger: notAFaceLedger })
      continue
    }
    const settled = /** @type {{ personId: number, provenance: import('../../types.js').FaceIdentityProvenance, ledger: Types.FaceWorkLedgerSummary | null }} */ (
      assignment
    )
    assigned.set(key, settled)
    const person = peopleByPersonId.get(settled.personId)
    if (person) person.keys.push(key)
  }

  if (disagreements > 0) {
    throw new Error(
      `${disagreements} content key(s) carry more than one media_faces row and those rows ` +
        `disagree about who the face is. That is a real contradiction on this machine, not a ` +
        `transport problem — resolve it here (the admin Faces tab) before exporting.`,
    )
  }

  const people = assignPersonRefs(
    [...peopleByPersonId.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => ({ displayName: value.displayName, keys: value.keys })),
  )
  /** @type {Map<string, string>} */
  const refByKey = new Map()
  for (const person of people) for (const key of person.keys) refByKey.set(key, person.ref)

  /** @type {Types.FaceWorkConfirmation[]} */
  const confirmations = []
  for (const [key, value] of assigned) {
    confirmations.push({
      key,
      op: "assign",
      personRef: /** @type {string} */ (refByKey.get(key)),
      provenance: value.provenance,
      ledger: value.ledger,
    })
  }
  for (const entry of notAFace) {
    confirmations.push({ key: entry.key, op: "not_a_face", personRef: null, provenance: null, ledger: entry.ledger })
  }
  confirmations.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  /** @type {Types.FaceWorkPayload} */
  const payload = {
    formatVersion: FORMAT_VERSION,
    ingest: ingestToLogical(ingestRow),
    includesPropagated: includePropagated,
    people: people.map((person) => ({ ref: person.ref, displayName: person.displayName })),
    confirmations,
  }

  const digest = faceWorkDigest(payload)
  /** @type {Types.FaceWorkArtifact} */
  const artifact = {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    contentSha256: digest,
    batchId: batchIdForDigest(digest),
    payload,
  }

  return {
    artifact,
    stats: {
      candidateFaces: rows.length,
      contentKeys: grouped.size,
      people: people.length,
      assigned: assigned.size,
      notAFace: notAFace.length,
      skippedPropagated,
    },
  }
}

// ---------------------------------------------------------------------------
// Reading an artifact back
// ---------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * The ledger annotation on one confirmation, or the reason it is not one.
 * @param {unknown} ledger
 * @param {number} index
 * @returns {string | null}
 */
function faceWorkLedgerError(ledger, index) {
  const at = `payload.confirmations[${index}].ledger`
  if (ledger === null) return null
  if (!isPlainObject(ledger)) return `${at} must be an object or null`
  if (!Number.isInteger(ledger.events) || Number(ledger.events) < 0) {
    return `${at}.events must be a non-negative integer`
  }
  if (typeof ledger.op !== "string" || !ARTIFACT_LEDGER_OPS.includes(ledger.op)) {
    return `${at}.op is "${String(ledger.op)}" — a carried ledger summary reports ${ARTIFACT_LEDGER_OPS.join(", ")}`
  }
  if (ledger.kind !== null && typeof ledger.kind !== "string") {
    return `${at}.kind must be a string or null`
  }
  if (typeof ledger.decidedAt !== "string") return `${at}.decidedAt must be a string`
  return null
}

/**
 * Everything INSIDE the payload, or the first reason it is not an artifact this
 * build may act on. Returns a message rather than throwing, so a hand-edited
 * file is a clean refusal instead of a `TypeError` from four frames down.
 *
 * This is the boundary. The content digest is unkeyed — anyone who can edit the
 * file can re-seal it — so it proves the file has not been corrupted IN TRANSIT
 * and proves nothing at all about what it says. Every claim the import acts on
 * is checked here, once, before a single row is read.
 * @param {Record<string, unknown>} body
 * @returns {string | null}
 */
export function faceWorkPayloadError(body) {
  const ingest = body.ingest
  if (!isPlainObject(ingest)) return "payload.ingest must be an object"
  for (const field of [
    "datasetId",
    "modelVersion",
    "detectorSha256",
    "embedderSha256",
    "engineSha256",
    "normalisation",
    "routeProfile",
  ]) {
    if (typeof ingest[field] !== "string") return `payload.ingest.${field} must be a string`
  }
  if (ingest.mirrorApplied !== 0 && ingest.mirrorApplied !== 1) {
    return "payload.ingest.mirrorApplied must be 0 or 1"
  }
  if (!isPlainObject(ingest.config)) return "payload.ingest.config must be an object"
  if (typeof body.includesPropagated !== "boolean") {
    return "payload.includesPropagated must be a boolean"
  }

  /** @type {Set<string>} */
  const refs = new Set()
  const people = /** @type {unknown[]} */ (body.people)
  for (let i = 0; i < people.length; i++) {
    const person = people[i]
    if (!isPlainObject(person)) return `payload.people[${i}] must be an object`
    if (typeof person.ref !== "string" || person.ref.length === 0) {
      return `payload.people[${i}].ref must be a non-empty string`
    }
    if (refs.has(person.ref)) {
      return (
        `payload.people[${i}].ref "${person.ref}" appears twice. One ref names one person; two ` +
        `entries under it would create two people and name them both from whichever came last.`
      )
    }
    refs.add(person.ref)
    if (typeof person.displayName !== "string" || person.displayName.length === 0) {
      return `payload.people[${i}].displayName must be a non-empty string`
    }
    if (person.displayName.length > MAX_DISPLAY_NAME) {
      return `payload.people[${i}].displayName is longer than ${MAX_DISPLAY_NAME} characters`
    }
  }

  const confirmations = /** @type {unknown[]} */ (body.confirmations)
  /** @type {Set<string>} */
  const keys = new Set()
  for (let i = 0; i < confirmations.length; i++) {
    const at = `payload.confirmations[${i}]`
    const confirmation = confirmations[i]
    if (!isPlainObject(confirmation)) return `${at} must be an object`
    if (typeof confirmation.key !== "string" || parseBoxKey(confirmation.key) === null) {
      return `${at}.key is not a <photo sha256>:<x>,<y>,<w>,<h> content key`
    }
    if (keys.has(confirmation.key)) return `${at} repeats a content key — one box, one decision`
    keys.add(confirmation.key)
    if (typeof confirmation.op !== "string" || !ARTIFACT_OPS.includes(confirmation.op)) {
      return (
        `${at}.op is "${String(confirmation.op)}". This format carries ` +
        `${ARTIFACT_OPS.join(" or ")} and nothing else — a "negative" is the statement that a ` +
        `face is NOT that person, and treating it as an assignment would import the exact ` +
        `inversion of the decision it records.`
      )
    }
    if (confirmation.op === "assign") {
      if (typeof confirmation.personRef !== "string" || !refs.has(confirmation.personRef)) {
        return `${at}.personRef names nobody in payload.people`
      }
      if (
        typeof confirmation.provenance !== "string" ||
        !ARTIFACT_PROVENANCES.includes(confirmation.provenance)
      ) {
        return `${at}.provenance must be ${ARTIFACT_PROVENANCES.join(" or ")}`
      }
      if (confirmation.provenance === "propagated" && body.includesPropagated !== true) {
        return (
          `${at} is a propagated guess, but payload.includesPropagated is false. The header and ` +
          `the body disagree about what this artifact is.`
        )
      }
    } else {
      if (confirmation.personRef !== null) return `${at} is not_a_face and must name nobody`
      if (confirmation.provenance !== null) {
        return `${at} is not_a_face and so has no identity provenance`
      }
    }
    const ledgerError = faceWorkLedgerError(confirmation.ledger, i)
    if (ledgerError) return ledgerError
  }

  return null
}

/**
 * Parse and structurally validate an artifact, and check that it hashes to what
 * it says it does.
 *
 * The digest check is not integrity theatre: the batch id is derived from it,
 * so an artifact whose payload was edited after export would otherwise import
 * under the id of the file it used to be — and a later replay of the ORIGINAL
 * would then be treated as already applied. It is also not an AUTHENTICATION:
 * it is unkeyed, so re-sealing a hand-edited file costs one line. That is why
 * `faceWorkPayloadError` exists and why it runs on every field the import acts
 * on rather than on the two the header carries.
 * @type {Types.parseFaceWorkArtifact}
 */
export function parseFaceWorkArtifact(text) {
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { valid: false, error: "not valid JSON" }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, error: "not a JSON object" }
  }
  const candidate = /** @type {Record<string, unknown>} */ (parsed)
  if (candidate.format !== FORMAT) {
    return { valid: false, error: `not a ${FORMAT} artifact (format: ${String(candidate.format)})` }
  }
  const payload = candidate.payload
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, error: "missing payload" }
  }
  const body = /** @type {Record<string, unknown>} */ (payload)
  if (body.formatVersion !== FORMAT_VERSION) {
    return {
      valid: false,
      error:
        `formatVersion ${String(body.formatVersion)} — this build reads version ${FORMAT_VERSION}. ` +
        `Export again with the same build that imports.`,
    }
  }
  if (!Array.isArray(body.people) || !Array.isArray(body.confirmations)) {
    return { valid: false, error: "payload.people and payload.confirmations must both be arrays" }
  }
  if (!body.ingest || typeof body.ingest !== "object" || Array.isArray(body.ingest)) {
    return { valid: false, error: "payload.ingest missing" }
  }

  const interior = faceWorkPayloadError(body)
  if (interior !== null) {
    return { valid: false, error: `${interior}. The artifact is corrupt — export it again rather than repairing it.` }
  }

  const digest = faceWorkDigest(/** @type {Types.FaceWorkPayload} */ (payload))
  if (digest !== candidate.contentSha256) {
    return {
      valid: false,
      error:
        `content digest mismatch: the payload hashes to ${digest.slice(0, 16)}… but the file ` +
        `declares ${String(candidate.contentSha256).slice(0, 16)}…. The artifact was edited ` +
        `after it was exported — export it again rather than repairing it.`,
    }
  }
  if (candidate.batchId !== batchIdForDigest(digest)) {
    return { valid: false, error: "batchId does not match the content digest" }
  }

  return { valid: true, value: /** @type {Types.FaceWorkArtifact} */ (parsed) }
}

// ---------------------------------------------------------------------------
// Box matching on the target
// ---------------------------------------------------------------------------

/**
 * Best and runner-up of one row of an IoU matrix. `second` is 0 when there is
 * no runner-up — a lone candidate has nobody to be confused with, so the margin
 * test passes trivially, which is the correct reading and not a loophole.
 * (Same helper, same reasoning, as `rekey-labels.js`.)
 * @param {readonly number[]} values
 * @returns {{ index: number, best: number, second: number }}
 */
function bestAndSecond(values) {
  let index = 0
  let best = -1
  for (let i = 0; i < values.length; i++) {
    if (values[i] > best) {
      best = values[i]
      index = i
    }
  }
  let second = 0
  for (let i = 0; i < values.length; i++) {
    if (i !== index && values[i] > second) second = values[i]
  }
  return { index, best, second }
}

/**
 * Resolve every incoming content key to the target face rows it names.
 *
 * Exact mode: string equality on the key. Under a provenance-equivalent ingest
 * the boxes are byte-identical, so this is the whole job.
 *
 * Overlap mode (`--match-overlap`, a reviewed exception): within one
 * photograph, mutual-best IoU with a margin on both sides. The margin is what
 * makes it order-independent AND what makes it refuse the case this flag exists
 * to be dangerous about — two plausible candidates for one box.
 * @type {Types.matchFaceWorkKeys}
 */
export function matchFaceWorkKeys(keys, targetRows, { overlap }) {
  const grouped = groupFacesByKey(targetRows)

  /** @type {Map<string, Types.FaceWorkFaceRow[]>} */
  const matched = new Map()
  /** @type {Map<string, Types.FaceWorkMatchFailure>} */
  const unmatched = new Map()

  if (!overlap) {
    /** Photo hashes the target has at all, so "photo missing" is distinguished
     *  from "photo present, box not found" — they want different reactions. */
    const shas = new Set(targetRows.map((row) => row.sha256))
    for (const key of keys) {
      // Parsed, not sliced. `key.indexOf(":")` on a colon-less key is -1, and
      // `slice(0, -1)` then yields the key minus its last character — which
      // matches no photograph and so reported a CORRUPT key as a merely absent
      // photograph, downgrading a refusal to an advisory. The overlap path has
      // always parsed; this one now does too.
      const parsed = parseBoxKey(key)
      if (!parsed) {
        unmatched.set(key, "malformed")
        continue
      }
      const found = grouped.get(key)
      if (found) matched.set(key, found)
      else unmatched.set(key, shas.has(parsed.sha256) ? "box" : "photo")
    }
    return { matched, unmatched }
  }

  /** @type {Map<string, Types.FaceWorkFaceRow[]>} */
  const targetsBySha = new Map()
  for (const row of targetRows) {
    const found = targetsBySha.get(row.sha256)
    if (found) found.push(row)
    else targetsBySha.set(row.sha256, [row])
  }
  for (const list of targetsBySha.values()) list.sort((a, b) => a.id - b.id)

  /** @type {Map<string, Array<{ key: string, box: Types.FaceWorkBox }>>} */
  const sourcesBySha = new Map()
  for (const key of keys) {
    const parsed = parseBoxKey(key)
    if (!parsed) {
      unmatched.set(key, "malformed")
      continue
    }
    const found = sourcesBySha.get(parsed.sha256)
    if (found) found.push({ key, box: parsed.box })
    else sourcesBySha.set(parsed.sha256, [{ key, box: parsed.box }])
  }
  for (const list of sourcesBySha.values()) list.sort((a, b) => (a.key < b.key ? -1 : 1))

  for (const [sha256, sources] of sourcesBySha) {
    const targets = targetsBySha.get(sha256)
    if (!targets || targets.length === 0) {
      for (const source of sources) unmatched.set(source.key, "photo")
      continue
    }
    /** @type {number[][]} */
    const iou = sources.map((source) =>
      targets.map((target) =>
        boxIou(source.box, {
          x: target.bbox_x,
          y: target.bbox_y,
          w: target.bbox_w,
          h: target.bbox_h,
        }),
      ),
    )
    const colStats = targets.map((_t, j) => bestAndSecond(iou.map((row) => row[j])))

    for (let i = 0; i < sources.length; i++) {
      const row = bestAndSecond(iou[i])
      if (row.best < MATCH_IOU_FLOOR) {
        unmatched.set(sources[i].key, "box")
        continue
      }
      const j = row.index
      const col = colStats[j]
      // Mutual best, phrased so it cannot depend on which index argmax picked
      // on a tie: the source must ACHIEVE the column's maximum.
      if (iou[i][j] < col.best) {
        unmatched.set(sources[i].key, "ambiguous")
        continue
      }
      if (row.best - row.second < MATCH_IOU_MARGIN || iou[i][j] - col.second < MATCH_IOU_MARGIN) {
        unmatched.set(sources[i].key, "ambiguous")
        continue
      }
      matched.set(sources[i].key, [targets[j]])
    }
  }

  return { matched, unmatched }
}

/**
 * Read a content key back into its parts. No regex — `indexOf`/`slice`/`split`.
 * @param {string} key
 * @returns {{ sha256: string, box: Types.FaceWorkBox } | null}
 */
export function parseBoxKey(key) {
  const colon = key.indexOf(":")
  if (colon <= 0) return null
  const sha256 = key.slice(0, colon)
  const parts = key.slice(colon + 1).split(",")
  if (parts.length !== 4) return null
  const numbers = parts.map((part) => Number(part))
  for (const value of numbers) if (!Number.isFinite(value)) return null
  return { sha256, box: { x: numbers[0], y: numbers[1], w: numbers[2], h: numbers[3] } }
}

// ---------------------------------------------------------------------------
// Import: plan, then apply
// ---------------------------------------------------------------------------

/** How many events already carry this batch id. The optimistic-concurrency
 *  token `applyFaceWorkImport` re-reads inside its transaction.
 *  @param {string} batchId
 *  @returns {number} */
function countBatchEvents(batchId) {
  /** @type {{ n: number } | undefined} */
  const row = sql`SELECT COUNT(*) AS n FROM face_assignments WHERE batch_id = ${batchId}`.get()
  return row ? row.n : 0
}

/**
 * Work out everything the import would do, and every reason it should not.
 *
 * Split from `applyFaceWorkImport` so `--dry-run` reports the SAME plan the
 * real run executes rather than a second approximation of it, and so the
 * refusals are testable without a write path.
 *
 * ⚠ An EXISTING batch is not, on its own, "nothing to do". The batch id is a
 * function of the artifact alone, and production carries a curated subset of
 * the photographs — so the ordinary case is an import that applies what it can,
 * and a later one that finishes the job once the rest of the library is
 * ingested. Short-circuiting on the id alone made that second run a silent
 * no-op and lost every confirmation the first could not place, and it could not
 * even report the gap because the short-circuit ran before the matching did. So
 * the whole plan is computed either way; an existing batch is APPENDED to,
 * which keeps the hand-off revocable as one decision.
 * @type {Types.planFaceWorkImport}
 */
export function planFaceWorkImport({ db, artifact, ingestId, facesFrom, matchOverlap, force }) {
  useDatabase(db)

  const payload = artifact.payload
  const batchId = artifact.batchId

  const existing = getBatch(batchId)
  if (existing && existing.revoked_at !== null) {
    return {
      batchId,
      alreadyApplied: false,
      batchExists: true,
      existingBatchEvents: countBatchEvents(batchId),
      refusals: [
        `batch ${batchId} was imported and then REVOKED on this machine. Re-importing the ` +
          `same artifact would silently undo that decision. There is deliberately no flag ` +
          `for this — if the revocation was wrong, un-revoke it; if the work is wanted ` +
          `again, export it afresh so it arrives as its own batch.`,
      ],
      advisories: [],
      actions: [],
      unmatched: { photo: 0, box: 0, ambiguous: 0, malformed: 0 },
      peopleToCreate: [],
      peopleMatched: 0,
      satisfied: 0,
      conflicts: [],
    }
  }
  const batchExists = existing !== undefined
  const existingBatchEvents = batchExists ? countBatchEvents(batchId) : 0

  /** @type {string[]} */
  const refusals = []
  /** @type {string[]} */
  const advisories = []

  const ingestRow = requireIngest(ingestId)
  const diff = faceWorkProvenanceDiff(payload.ingest, ingestRow)
  if (!diff.equivalent && !matchOverlap) {
    refusals.push(
      `this machine's ingest ${ingestRow.id} is not provenance-equivalent to the one the ` +
        `artifact was produced under — ${diff.blocking.join(", ")} differ. Automatic import ` +
        `requires an equivalent detector run, because that is what makes the boxes ` +
        `byte-identical. Re-run the batch here with the same detector/engine/model, or pass ` +
        `--match-overlap to accept overlap matching as a reviewed exception.`,
    )
  }
  if (!diff.equivalent && matchOverlap) {
    advisories.push(
      `provenance differs (${diff.blocking.join(", ")}) and --match-overlap was given: boxes ` +
        `are being matched by IoU, not by content. Review the per-person counts below.`,
    )
  }
  for (const field of diff.advisory) advisories.push(`advisory: ${field} differs`)

  const targetRows = candidateFaces(ingestRow, facesFrom)
  if (targetRows.length === 0) {
    refusals.push(
      facesFrom === "ingest"
        ? `ingest ${ingestRow.id} has no media_faces rows on this machine. Run the detection ` +
          `batch here before importing, or pass --faces-from=model-version if these faces ` +
          `predate the ingest_id column.`
        : `no 'cli' media_faces rows with model_version "${ingestRow.model_version}" on this machine.`,
    )
  }

  const keys = payload.confirmations.map((confirmation) => confirmation.key)
  const { matched, unmatched } = matchFaceWorkKeys(keys, targetRows, { overlap: matchOverlap })

  const counts = { photo: 0, box: 0, ambiguous: 0, malformed: 0 }
  for (const reason of unmatched.values()) counts[reason]++

  // A photo this machine does not have is expected — production carries a
  // curated subset. A box it cannot find under an EQUIVALENT ingest is not:
  // the geometry was supposed to be identical, so something is wrong and the
  // belt-and-braces check just caught it.
  if (counts.box > 0 && diff.equivalent && !force) {
    refusals.push(
      `${counts.box} confirmation(s) name a photograph this machine has, at a box it does not. ` +
        `Under an equivalent ingest the boxes are supposed to be byte-identical, so this is a ` +
        `real disagreement rather than a transport gap. Re-run the batch here, or pass ` +
        `--match-overlap (reviewed) or --force (accept the loss).`,
    )
  }
  if (counts.photo > 0) {
    advisories.push(`${counts.photo} confirmation(s) name a photograph this machine does not have.`)
  }
  if (counts.ambiguous > 0) {
    advisories.push(
      `${counts.ambiguous} confirmation(s) had no unambiguous overlap match and were dropped.`,
    )
  }
  if (counts.malformed > 0) {
    refusals.push(`${counts.malformed} confirmation key(s) are malformed — the artifact is corrupt.`)
  }

  const propagatedIncoming = payload.confirmations.filter(
    (confirmation) => confirmation.provenance === "propagated",
  ).length
  if (propagatedIncoming > 0) {
    advisories.push(
      `${propagatedIncoming} confirmation(s) are 'propagated' — the model's own guesses, not ` +
        `anyone's judgement. They arrive under a second-class 'propagated' identity so they ` +
        `cannot seed a prototype; nothing here promotes them to 'confirmed'.`,
    )
  }

  // --- current state of every matched target face ---
  const identities = livePersonByIdentity()
  /** @type {Map<number, number | null>} person id currently on a target face id */
  const currentPersonByFace = new Map()
  for (const rows of matched.values()) {
    for (const row of rows) {
      if (currentPersonByFace.has(row.id)) continue
      if (row.face_identity_id === null) {
        currentPersonByFace.set(row.id, null)
        continue
      }
      const resolved = resolveIdentity(row.face_identity_id)
      const identity = resolved === null ? undefined : identities.get(resolved)
      currentPersonByFace.set(row.id, identity ? identity.personId : null)
    }
  }
  const ledger = ledgerSummaries()

  // --- person identity, matched BY CONTENT ---
  /** @type {Map<string, string>} */
  const nameByRef = new Map()
  for (const person of payload.people) nameByRef.set(person.ref, person.displayName)

  /** @type {Map<string, Map<number, number>>} ref -> person id -> overlapping faces */
  const overlapByRef = new Map()
  for (const confirmation of payload.confirmations) {
    if (confirmation.personRef === null) continue
    const rows = matched.get(confirmation.key)
    if (!rows) continue
    let tally = overlapByRef.get(confirmation.personRef)
    if (!tally) {
      tally = new Map()
      overlapByRef.set(confirmation.personRef, tally)
    }
    for (const row of rows) {
      const personId = currentPersonByFace.get(row.id) ?? null
      if (personId === null) continue
      tally.set(personId, (tally.get(personId) ?? 0) + 1)
    }
  }

  /** @type {Types.FaceWorkConflict[]} */
  const conflicts = []
  /** @type {Map<string, number>} ref -> existing target person id */
  const personIdByRef = new Map()
  /** @type {Set<string>} refs with no content match — a new person on this machine */
  const newPersonRefs = new Set()

  /**
   * The refs this import is actually about: those with at least one confirmation
   * that found a target face.
   *
   * A person whose photographs this machine does not have is not this import's
   * business at all. Deriving the person list from `payload.people` instead
   * created a `people` row AND a `confirmed` `face_identities` row for every
   * absent photograph's person — each one occupying the partial unique index on
   * `(person_id, provenance)` on behalf of a face nobody here can see.
   */
  /** @type {Set<string>} */
  const refsInScope = new Set()
  for (const confirmation of payload.confirmations) {
    if (confirmation.personRef === null) continue
    if (!matched.has(confirmation.key)) continue
    refsInScope.add(confirmation.personRef)
  }

  for (const person of payload.people) {
    if (!refsInScope.has(person.ref)) continue
    const tally = overlapByRef.get(person.ref)
    const candidates = tally ? [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]) : []
    if (candidates.length === 0) {
      newPersonRefs.add(person.ref)
      const collisions = findLivePeopleByName(person.displayName)
      if (collisions.length > 0) {
        advisories.push(
          `"${person.displayName}" already exists on this machine but shares none of these ` +
            `faces, so a SECOND person of that name is being created. People are matched by ` +
            `content, never by name — merge them in the admin UI if they are the same person.`,
        )
      }
      continue
    }
    if (candidates.length > 1) {
      conflicts.push({
        kind: "person-split",
        detail:
          `"${person.displayName}" arrives as one person, but their faces are already split ` +
          `across ${candidates.length} people on this machine ` +
          `(${candidates.map(([, n]) => n).join("/")} faces each).`,
      })
      if (!force) continue
    }
    personIdByRef.set(person.ref, candidates[0][0])
  }

  // Two incoming people landing on one existing person is the same
  // contradiction seen from the other side, and just as much a refusal.
  /** @type {Map<number, string[]>} */
  const refsByPersonId = new Map()
  for (const [ref, personId] of personIdByRef) {
    const found = refsByPersonId.get(personId)
    if (found) found.push(ref)
    else refsByPersonId.set(personId, [ref])
  }
  for (const [, refs] of refsByPersonId) {
    if (refs.length < 2) continue
    conflicts.push({
      kind: "person-collapse",
      detail:
        `${refs.length} people in the artifact (${refs
          .map((ref) => `"${nameByRef.get(ref) ?? ref}"`)
          .join(", ")}) match ONE person on this machine. The two databases disagree about ` +
        `whether these are the same person.`,
    })
  }

  // --- per-confirmation actions ---
  /** @type {Types.FaceWorkAction[]} */
  const actions = []
  let satisfied = 0

  for (const confirmation of payload.confirmations) {
    const rows = matched.get(confirmation.key)
    if (!rows) continue
    for (const row of rows) {
      const currentPerson = currentPersonByFace.get(row.id) ?? null
      const summary = ledger.get(row.id) ?? null

      if (confirmation.op === "not_a_face") {
        if (summary && summary.op === "not_a_face") {
          satisfied++
          continue
        }
        if (currentPerson !== null) {
          conflicts.push({
            kind: "confirmation",
            detail:
              `the artifact says a box is not a face; this machine has it confirmed as a ` +
              `person. (face ${row.id})`,
          })
          if (!force) continue
        }
        actions.push({
          faceId: row.id,
          op: "not_a_face",
          personRef: null,
          provenance: null,
          identityId: null,
        })
        continue
      }

      const ref = /** @type {string} */ (confirmation.personRef)
      const incomingPersonId = personIdByRef.get(ref) ?? null

      if (currentPerson !== null && incomingPersonId !== null && currentPerson === incomingPersonId) {
        satisfied++
        continue
      }
      if (currentPerson !== null && currentPerson !== incomingPersonId) {
        conflicts.push({
          kind: "confirmation",
          detail:
            `face ${row.id} is already confirmed as a different person than ` +
            `"${nameByRef.get(ref) ?? ref}".`,
        })
        if (!force) continue
      }
      if (incomingPersonId === null && !newPersonRefs.has(ref)) {
        // The person hit an unresolved conflict above; nothing to assign to.
        continue
      }
      actions.push({
        faceId: row.id,
        op: "assign",
        personRef: ref,
        // Carried, never assumed. `confirmed` here would be the model's guess
        // arriving as ground truth on the machine that serves the site.
        provenance: confirmation.provenance === "propagated" ? "propagated" : "confirmed",
        identityId: null,
      })
    }
  }

  // A person is created for a confirmation this import ACTUALLY applies, and
  // for no other reason. Derived after the actions rather than before them, so
  // a ref whose only matched confirmation hit an unresolved conflict does not
  // leave a person row behind for a face that was never assigned.
  /** @type {Set<string>} */
  const refsNeeded = new Set()
  for (const action of actions) {
    if (action.op === "assign" && action.personRef !== null) refsNeeded.add(action.personRef)
  }
  /** @type {string[]} */
  const peopleToCreate = []
  for (const person of payload.people) {
    if (refsNeeded.has(person.ref) && newPersonRefs.has(person.ref)) peopleToCreate.push(person.ref)
  }

  if (conflicts.length > 0 && !force) {
    refusals.push(
      `${conflicts.length} conflict(s) — nothing was written. Every one is listed above. ` +
        `Pass --force to APPEND the incoming decisions anyway: nothing is overwritten, the ` +
        `existing events stay in the ledger, and the whole import is revocable as batch ` +
        `${batchId}.`,
    )
  }

  // "Already applied" is a statement about the WORK, not about the batch id.
  const alreadyApplied = batchExists && actions.length === 0 && refusals.length === 0
  if (batchExists) {
    advisories.push(
      alreadyApplied
        ? `batch ${batchId} is already on this machine and everything it carries is satisfied ` +
          `here — nothing to do.`
        : `batch ${batchId} is already on this machine, but ${actions.length} of its ` +
          `confirmation(s) are not applied here — the photographs they name were missing when ` +
          `it was first imported. They are being APPENDED to that same batch, so the hand-off ` +
          `stays revocable as one decision.`,
    )
  }

  return {
    batchId,
    alreadyApplied,
    batchExists,
    existingBatchEvents,
    refusals,
    advisories,
    actions,
    unmatched: counts,
    peopleToCreate,
    peopleMatched: personIdByRef.size,
    satisfied,
    conflicts,
    personIdByRef,
    nameByRef,
  }
}

/**
 * Apply a plan. One transaction, one batch, `recordAssignment` for every event
 * — never a direct write to `media_faces.face_identity_id`, which is a
 * projection and has exactly one author.
 * @type {Types.applyFaceWorkImport}
 */
export function applyFaceWorkImport({ db, plan, actor, note }) {
  useDatabase(db)

  if (plan.alreadyApplied) {
    return { batchId: plan.batchId, applied: false, events: 0, peopleCreated: 0, identitiesCreated: 0 }
  }
  if (plan.refusals.length > 0) {
    throw new Error(plan.refusals.join("\n"))
  }

  const personIdByRef = new Map(plan.personIdByRef ?? [])
  const nameByRef = plan.nameByRef ?? new Map()

  return withTransaction(db, () => {
    // Re-check inside the transaction. Between planning and applying another
    // process could have imported the same artifact; BEGIN IMMEDIATE plus these
    // reads are what make replay safety true under concurrency rather than only
    // in a single-threaded test.
    //
    // The token is the batch's own event count, because "the batch exists" is no
    // longer the whole story: an import may legitimately APPEND to a batch a
    // previous, partial run created. So what has to be unchanged since planning
    // is the batch's presence AND its size — either moving means the plan was
    // computed against a state that no longer exists.
    const batch = getBatch(plan.batchId)
    if (Boolean(batch) !== plan.batchExists) {
      throw new Error(
        `batch ${plan.batchId} ${batch ? "appeared" : "disappeared"} between planning and ` +
          `applying — another import is running against this database. Nothing was written.`,
      )
    }
    if (batch && batch.revoked_at !== null) {
      throw new Error(
        `batch ${plan.batchId} was revoked between planning and applying. Nothing was written.`,
      )
    }
    if (countBatchEvents(plan.batchId) !== plan.existingBatchEvents) {
      throw new Error(
        `batch ${plan.batchId} gained or lost events between planning and applying — another ` +
          `import is running against this database. Nothing was written; re-run.`,
      )
    }

    if (!batch) {
      createBatch({
        batchId: plan.batchId,
        kind: IMPORT_BATCH_KIND,
        actor,
        note,
      })
    }

    let peopleCreated = 0
    for (const ref of plan.peopleToCreate) {
      const person = createPerson({
        displayName: nameByRef.get(ref) ?? ref,
        // guest_id stays null: the roster and its ids are this machine's own
        // business, and the artifact deliberately carries neither.
        guestId: null,
        createdBy: actor,
      })
      personIdByRef.set(ref, person.id)
      peopleCreated++
    }

    /** @type {Map<string, number>} `<ref> <provenance>` -> face_identities.id */
    const identityIdByRef = new Map()
    let identitiesCreated = 0
    const stamp = now()

    /**
     * The identity an action writes to, resolved by PROVENANCE as well as by
     * person.
     *
     * `face_identities` holds at most one live row per `(person_id, provenance)`
     * — so a person who arrives both confirmed and guessed gets two identities,
     * which is exactly the shape `api/admin/faces.js`'s propagate pass already
     * uses. Resolved lazily, so an identity is created only for a confirmation
     * this import actually applies.
     * @param {string} ref
     * @param {import('../../types.js').FaceIdentityProvenance} provenance
     * @returns {number | null}
     */
    const identityFor = (ref, provenance) => {
      const cacheKey = `${ref} ${provenance}`
      const cached = identityIdByRef.get(cacheKey)
      if (cached !== undefined) return cached
      const personId = personIdByRef.get(ref)
      if (personId === undefined) return null

      const rows = identitiesForPerson(personId)
      const live = rows.find(
        (identity) => identity.provenance === provenance && identity.merged_into === null,
      )
      if (live) {
        identityIdByRef.set(cacheKey, live.id)
        return live.id
      }
      // A person whose identity of this provenance has been merged away has no
      // live one to write to, and the partial UNIQUE index on (person_id,
      // provenance) will not let a second be created. That is a state to repair
      // by hand, not to guess at.
      const mergedAway = rows.find(
        (identity) => identity.provenance === provenance && identity.merged_into !== null,
      )
      if (mergedAway) {
        throw new Error(
          `person ${personId}'s ${provenance} identity ${mergedAway.id} has been merged into ` +
            `${mergedAway.merged_into}. Repair the merge before importing into this person.`,
        )
      }
      const created = createIdentity({
        personId,
        confirmedBy: actor,
        confirmedAt: stamp,
        provenance,
      })
      identityIdByRef.set(cacheKey, created.id)
      identitiesCreated++
      return created.id
    }

    let events = 0
    for (const action of plan.actions) {
      if (action.op === "not_a_face") {
        recordAssignment({
          faceId: action.faceId,
          op: "not_a_face",
          identityId: null,
          actor,
          batchId: plan.batchId,
          reason: "face-work import",
        })
        events++
        continue
      }
      const identityId = identityFor(
        /** @type {string} */ (action.personRef),
        action.provenance === "propagated" ? "propagated" : "confirmed",
      )
      if (identityId === null) continue
      recordAssignment({
        faceId: action.faceId,
        op: "assign",
        identityId,
        actor,
        batchId: plan.batchId,
        reason: "face-work import",
      })
      events++
    }

    return { batchId: plan.batchId, applied: true, events, peopleCreated, identitiesCreated }
  })
}

// ---------------------------------------------------------------------------
// Provisioning preflight
// ---------------------------------------------------------------------------

/**
 * Verify the weight files and the engine against pinned digests, and refuse on
 * any mismatch or absence.
 *
 * Runs BEFORE the database is opened and before anything reads a photograph.
 * That ordering is the point: a hash that only diagnoses drift after a batch has
 * already run over the library has told you something true far too late.
 * @type {Types.faceWorkPreflight}
 */
export async function faceWorkPreflight({ weightsDir, enginePath, expectedEngineSha256 }) {
  /** @type {string[]} */
  const failures = []

  if (!weightsDir) {
    failures.push("--weights DIR is required: the weight digests are the whole audit of files nobody can read.")
  }
  /** @type {import('./types.js').WeightCheck[]} */
  let checks = []
  if (weightsDir) {
    checks = await verifyWeights(weightsDir)
    for (const check of checks) {
      // An optional pin that is simply not here is neither a pass nor a
      // failure — verify-weights.js's own reading, kept identical.
      if (check.status === "ok" || check.status === "absent-optional") continue
      failures.push(`weights: ${check.name} — ${check.status}. ${check.detail}`)
    }
  }

  /** @type {string | null} */
  let engineSha256 = null
  if (!enginePath) {
    failures.push(
      "--engine PATH is required: the engine is the borrowed runtime that produced the boxes, " +
        "and an unverified one silently produces different ones.",
    )
  } else {
    try {
      engineSha256 = await hashFile(enginePath)
    } catch {
      failures.push(`engine: cannot read ${enginePath} — it is absent or unreadable.`)
    }
    if (engineSha256 !== null && expectedEngineSha256) {
      if (engineSha256 !== expectedEngineSha256) {
        failures.push(
          `engine: ${enginePath} hashes to ${engineSha256.slice(0, 16)}… but the work was ` +
            `produced under ${expectedEngineSha256.slice(0, 16)}…. A different engine draws ` +
            `different boxes, and every confirmation here is keyed by one.`,
        )
      }
    } else if (engineSha256 !== null && !expectedEngineSha256) {
      failures.push(
        "engine: nothing to compare against — pass --expect-engine SHA256 or an artifact to " +
          "take the expected digest from. An unpinned hash is a description, not a check.",
      )
    }
  }

  return { ok: failures.length === 0, failures, checks, engineSha256 }
}

// ---------------------------------------------------------------------------
// Where an export may be written
// ---------------------------------------------------------------------------

/** The directories `.gitignore` keeps out of this repository, as path prefixes.
 *
 *  Read from the file rather than hard-coded, so the one list git obeys is the
 *  one this obeys. No regex, per CLAUDE.md: a pattern carrying a wildcard is
 *  skipped rather than interpreted — git's globbing is not something to
 *  re-implement, and an unrecognised pattern erring towards "not ignored" errs
 *  towards refusing the write.
 *  @param {string} repoRoot
 *  @returns {string[]} */
function ignoredPrefixes(repoRoot) {
  /** @type {string} */
  let text
  try {
    text = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8")
  } catch {
    // No .gitignore to read is not permission to write into the repository.
    return ["data", "tmp", "node_modules", "public/vision/weights"]
  }
  /** @type {string[]} */
  const prefixes = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith("#") || trimmed.startsWith("!")) continue
    if (trimmed.includes("*") || trimmed.includes("?") || trimmed.includes("[")) continue
    let pattern = trimmed
    while (pattern.startsWith("/")) pattern = pattern.slice(1)
    while (pattern.endsWith("/")) pattern = pattern.slice(0, -1)
    if (pattern.length === 0) continue
    prefixes.push(pattern)
  }
  return prefixes
}

/**
 * Why this destination may not be written, or null.
 *
 * An artifact carries people's real display names, one content hash per
 * photograph and one box per face. This repository is PUBLIC, so a destination
 * inside it is refused unless it is somewhere git already ignores. CLAUDE.md's
 * framing for this class of rule is "enforced, not just written down" — a
 * `PreToolUse` hook already hard-blocks the analogous read, and a printed
 * warning after `fs.writeFileSync` has already lost.
 * @type {Types.exportDestinationRefusal}
 */
export function exportDestinationRefusal(outPath) {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..")
  const absolute = path.resolve(outPath)
  const relative = path.relative(repoRoot, absolute)
  if (relative.length === 0) return null
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null
  }
  const posix = relative.split(path.sep).join("/")
  const prefixes = ignoredPrefixes(repoRoot)
  for (const prefix of prefixes) {
    if (posix === prefix || posix.startsWith(`${prefix}/`)) return null
  }
  return (
    `${absolute} is inside this repository, and this repository is public. A face-work ` +
    `artifact carries people's real display names, one content hash per photograph and one box ` +
    `per face — none of which may be committed, and a file in a tracked directory is one ` +
    `\`git add .\` away from being. Write it outside the repository, or under a directory ` +
    `.gitignore already covers (${prefixes.slice(0, 4).join(", ")}), and move it over a channel ` +
    `you would move the guest list over.`
  )
}

/** Why this `--actor` may not go on the batch row, or null.
 *  @param {string} value
 *  @returns {string | null} */
function batchActorRefusal(value) {
  if (value.length === 0) return "must not be empty"
  if (value.length > MAX_ACTOR) return `must be at most ${MAX_ACTOR} characters`
  for (const character of value) {
    if (!ACTOR_CHARS.includes(character)) {
      return (
        `must be letters, digits, ".", "-", "_" or "@" — it names who ran the import, not a ` +
        `path, and it is written to a row this tool cannot later tell apart from a real one`
      )
    }
  }
  return null
}

/** Why this `--note` may not go on the batch row, or null.
 *  @param {string} value
 *  @returns {string | null} */
function batchNoteRefusal(value) {
  if (value.length > MAX_NOTE) return `must be at most ${MAX_NOTE} characters`
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      return "must be printable text on one line — no control characters, no newlines"
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * No regex, per CLAUDE.md: a manual switch over known flags. Unknown `--flags`
 * are refused rather than silently ignored.
 * @type {Types.parseFaceWorkArgs}
 */
export function parseFaceWorkArgs(argv) {
  /** @type {string[]} */
  const positionals = []
  /** @type {Types.FaceWorkArgs} */
  const args = {
    command: null,
    artifact: null,
    database: null,
    ingestId: null,
    facesFrom: "ingest",
    includePropagated: false,
    weights: null,
    engine: null,
    expectEngine: null,
    matchOverlap: false,
    force: false,
    actor: IMPORT_ACTOR,
    note: null,
    batch: null,
    dryRun: false,
  }
  let help = false
  // Whether `--actor` was GIVEN, not what it holds: `revoke` wants a different
  // default from `import`, and comparing against IMPORT_ACTOR would silently
  // rewrite an operator who typed that value out in full.
  let actorGiven = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      help = true
    } else if (arg === "--dry-run") {
      args.dryRun = true
    } else if (arg === "--include-propagated") {
      args.includePropagated = true
    } else if (arg === "--match-overlap") {
      args.matchOverlap = true
    } else if (arg === "--force") {
      args.force = true
    } else if (arg === "--database") {
      i++
      if (i >= argv.length) return { valid: false, error: "--database needs a value" }
      args.database = argv[i]
    } else if (arg === "--ingest") {
      i++
      if (i >= argv.length) return { valid: false, error: "--ingest needs a value" }
      const parsed = Number(argv[i])
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { valid: false, error: `--ingest needs a positive integer, got "${argv[i]}"` }
      }
      args.ingestId = parsed
    } else if (arg === "--faces-from") {
      i++
      if (i >= argv.length) return { valid: false, error: "--faces-from needs a value" }
      if (argv[i] !== "ingest" && argv[i] !== "model-version") {
        return { valid: false, error: `--faces-from must be "ingest" or "model-version"` }
      }
      args.facesFrom = argv[i] === "ingest" ? "ingest" : "model-version"
    } else if (arg === "--weights") {
      i++
      if (i >= argv.length) return { valid: false, error: "--weights needs a value" }
      args.weights = argv[i]
    } else if (arg === "--engine") {
      i++
      if (i >= argv.length) return { valid: false, error: "--engine needs a value" }
      args.engine = argv[i]
    } else if (arg === "--expect-engine") {
      i++
      if (i >= argv.length) return { valid: false, error: "--expect-engine needs a value" }
      args.expectEngine = argv[i]
    } else if (arg === "--artifact") {
      i++
      if (i >= argv.length) return { valid: false, error: "--artifact needs a value" }
      args.artifact = argv[i]
    } else if (arg === "--actor") {
      i++
      if (i >= argv.length) return { valid: false, error: "--actor needs a value" }
      const refusal = batchActorRefusal(argv[i])
      if (refusal) return { valid: false, error: `--actor ${refusal}` }
      args.actor = argv[i]
      actorGiven = true
    } else if (arg === "--batch") {
      i++
      if (i >= argv.length) return { valid: false, error: "--batch needs a value" }
      if (argv[i].length === 0) return { valid: false, error: "--batch needs a batch id" }
      args.batch = argv[i]
    } else if (arg === "--note") {
      i++
      if (i >= argv.length) return { valid: false, error: "--note needs a value" }
      const refusal = batchNoteRefusal(argv[i])
      if (refusal) return { valid: false, error: `--note ${refusal}` }
      args.note = argv[i]
    } else if (arg.startsWith("--")) {
      return { valid: false, error: `Unknown option: ${arg}` }
    } else {
      positionals.push(arg)
    }
  }

  if (help) return { valid: false, error: USAGE }

  const command = positionals[0] ?? null
  if (
    command !== "export" &&
    command !== "import" &&
    command !== "preflight" &&
    command !== "revoke"
  ) {
    return {
      valid: false,
      error:
        (command === null ? "No command given." : `Unknown command: ${command}`) +
        "\n\n" +
        USAGE,
    }
  }
  args.command = command

  // The two commands that MOVE an artifact. `preflight` checks the machine and
  // `revoke` names a batch already in the database; neither has a file to read.
  if (command === "export" || command === "import") {
    const artifact = positionals[1] ?? args.artifact
    if (!artifact) {
      return { valid: false, error: `${command} needs an artifact path.\n\n${USAGE}` }
    }
    args.artifact = artifact
  }

  if (command === "revoke") {
    if (!args.batch) {
      return { valid: false, error: `revoke needs --batch ID (import prints it).\n\n${USAGE}` }
    }
    if (!actorGiven) args.actor = REVOKE_ACTOR
  }

  if (command === "import") {
    if (!args.weights) return { valid: false, error: "import needs --weights DIR (the provisioning preflight)" }
    if (!args.engine) return { valid: false, error: "import needs --engine PATH (the provisioning preflight)" }
  }
  if (command === "preflight") {
    if (!args.weights) return { valid: false, error: "preflight needs --weights DIR" }
    if (!args.engine) return { valid: false, error: "preflight needs --engine PATH" }
  }

  return { valid: true, value: args }
}

/**
 * @param {Types.FaceWorkArgs} args
 * @returns {Promise<number>}
 */
async function runExport(args) {
  // Before the database is opened, and before anything is read: a refused
  // destination should cost nothing and should never depend on the export
  // having succeeded first.
  const destination = exportDestinationRefusal(/** @type {string} */ (args.artifact))
  if (destination) {
    console.error(`refused: ${destination}`)
    return 1
  }

  const db = openDatabase(resolveDbPath(args.database))
  try {
    const { artifact, stats } = buildFaceWorkExport({
      db,
      ingestId: args.ingestId,
      facesFrom: args.facesFrom,
      includePropagated: args.includePropagated,
    })
    console.log(`candidate faces:        ${stats.candidateFaces}`)
    console.log(`content keys:           ${stats.contentKeys}`)
    console.log(`people:                 ${stats.people}`)
    console.log(`assignments:            ${stats.assigned}`)
    console.log(`not-a-face verdicts:    ${stats.notAFace}`)
    if (stats.skippedPropagated > 0) {
      console.log(`skipped (propagated):   ${stats.skippedPropagated} — pass --include-propagated to carry them`)
    }
    console.log(`content digest:         ${artifact.contentSha256}`)
    console.log(`batch id on import:     ${artifact.batchId}`)
    if (args.dryRun) {
      console.log(`\ndry run — nothing written to ${args.artifact}`)
      return 0
    }
    const out = /** @type {string} */ (args.artifact)
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
    fs.writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
    console.log(`\nwrote ${out}`)
    console.log(
      "This file carries people's names. It is never committed; move it over a channel you " +
        "would move the guest list over, and delete it when the import is done.",
    )
    return 0
  } finally {
    db.close()
  }
}

/**
 * @param {Types.FaceWorkArgs} args
 * @returns {Promise<number>}
 */
async function runImport(args) {
  const text = fs.readFileSync(/** @type {string} */ (args.artifact), "utf8")
  const parsed = parseFaceWorkArtifact(text)
  if (!parsed.valid) {
    console.error(`artifact: ${parsed.error}`)
    return 1
  }
  const artifact = parsed.value

  // Preflight first, before the database is opened.
  const pre = await faceWorkPreflight({
    weightsDir: args.weights,
    enginePath: args.engine,
    expectedEngineSha256: artifact.payload.ingest.engineSha256,
  })
  for (const failure of pre.failures) console.error(`preflight: ${failure}`)
  if (!pre.ok) {
    console.error("\nprovisioning preflight failed — nothing was read and nothing was written.")
    return 1
  }
  console.log("preflight: weights and engine verified against the pinned digests.")

  const db = openDatabase(resolveDbPath(args.database))
  try {
    const plan = planFaceWorkImport({
      db,
      artifact,
      ingestId: args.ingestId,
      facesFrom: args.facesFrom,
      matchOverlap: args.matchOverlap,
      force: args.force,
    })

    // Printed BEFORE the no-op check, not after it. "Already imported" used to
    // return here without ever computing — let alone reporting — how many
    // confirmations this machine could not place, which is precisely the number
    // an operator staring at a partial import needs to see.
    console.log(`batch id:               ${plan.batchId}`)
    console.log(`people matched:         ${plan.peopleMatched}`)
    console.log(`people to create:       ${plan.peopleToCreate.length}`)
    console.log(`already satisfied:      ${plan.satisfied}`)
    console.log(`events to append:       ${plan.actions.length}`)
    console.log(
      `unmatched:              photo ${plan.unmatched.photo}, box ${plan.unmatched.box}, ` +
        `ambiguous ${plan.unmatched.ambiguous}, malformed ${plan.unmatched.malformed}`,
    )
    for (const advisory of plan.advisories) console.log(`  · ${advisory}`)
    for (const conflict of plan.conflicts) console.log(`  ! ${conflict.kind}: ${conflict.detail}`)

    if (plan.refusals.length > 0) {
      for (const refusal of plan.refusals) console.error(`\nrefused: ${refusal}`)
      return 1
    }
    if (plan.alreadyApplied) {
      console.log("\nalready imported and fully applied — no-op.")
      return 0
    }
    if (args.dryRun) {
      console.log("\ndry run — nothing written.")
      return 0
    }

    const result = applyFaceWorkImport({ db, plan, actor: args.actor, note: args.note })
    console.log(
      `\napplied: ${result.events} event(s), ${result.peopleCreated} person(s) created, ` +
        `${result.identitiesCreated} identity/identities created.`,
    )
    // A command line, not a function call. This used to print
    // `revokeBatch("<id>", "<actor>")`, which was not runnable from anywhere an
    // operator stands: it is a JS function, and until `withBoundTransaction` it
    // could not even run in THIS process, because `revokeBatch` opened its
    // transaction on a `db/connection.js` singleton this file never
    // initialises. `--database` is echoed only when it was given, so the line
    // stays copy-pasteable in the ordinary case.
    const databaseFlag = args.database ? ` --database ${args.database}` : ""
    console.log(
      `undo with: node scripts/vision/export-face-work.js revoke ` +
        `--batch ${result.batchId}${databaseFlag}`,
    )
    return 0
  } finally {
    db.close()
  }
}

/**
 * @param {Types.FaceWorkArgs} args
 * @returns {Promise<number>}
 */
async function runPreflight(args) {
  /** @type {string | null} */
  let expected = args.expectEngine
  if (!expected && args.artifact) {
    const parsed = parseFaceWorkArtifact(fs.readFileSync(args.artifact, "utf8"))
    if (!parsed.valid) {
      console.error(`artifact: ${parsed.error}`)
      return 1
    }
    expected = parsed.value.payload.ingest.engineSha256
  }
  const result = await faceWorkPreflight({
    weightsDir: args.weights,
    enginePath: args.engine,
    expectedEngineSha256: expected,
  })
  for (const check of result.checks) {
    console.log(`  ${check.status.padEnd(11)} ${check.name}`)
  }
  for (const failure of result.failures) console.error(`preflight: ${failure}`)
  console.log(result.ok ? "\npreflight passed." : "\npreflight FAILED.")
  return result.ok ? 0 : 1
}

/**
 * `revoke` — the undo the import prints, run for real.
 *
 * Deliberately thin: it opens the database, checks the batch exists, and calls
 * `revokeBatch`. It opens NO transaction of its own, because `revokeBatch` owns
 * one, and it can call it at all only because that transaction is now opened on
 * the bound executor rather than on `db/connection.js`'s singleton — see the
 * Transactions note at the top of this file.
 *
 * It refuses nothing beyond "no such batch". A revocation is not destructive:
 * the events stay in the ledger and stop counting, a face corrected by hand
 * after the batch keeps that correction, and re-revoking is a bare
 * re-projection that leaves the original `revoked_at`/`revoked_by` standing.
 * @param {Types.FaceWorkArgs} args
 * @returns {Promise<number>}
 */
async function runRevoke(args) {
  const batchId = /** @type {string} */ (args.batch)
  const dbPath = resolveDbPath(args.database)
  const db = openDatabase(dbPath)
  try {
    const batch = getBatch(batchId)
    if (!batch) {
      console.error(`no such batch: ${batchId}`)
      return 1
    }

    /** @type {{ events: number, faces: number } | undefined} */
    const counts = sql`SELECT COUNT(*) AS events, COUNT(DISTINCT face_id) AS faces
      FROM face_assignments WHERE batch_id = ${batchId}`.get()
    const events = counts ? counts.events : 0
    const faces = counts ? counts.faces : 0

    console.log(`batch ${batchId}: kind ${batch.kind}, actor ${batch.actor}, created ${batch.created_at}`)
    console.log(`${events} event(s) across ${faces} face(s)`)
    if (batch.revoked_at !== null) {
      console.log(`already revoked at ${batch.revoked_at} by ${batch.revoked_by}`)
    }

    if (args.dryRun) {
      console.log("\ndry run — nothing written.")
      return 0
    }

    const reprojected = revokeBatch(batchId, args.actor)
    console.log(
      `\nrevoked: ${reprojected} face(s) re-projected. Events are still on record and stop ` +
        `counting; any face corrected by hand after this batch keeps that correction.`,
    )
    return 0
  } finally {
    db.close()
  }
}

async function main() {
  const parsed = parseFaceWorkArgs(process.argv.slice(2))
  if (!parsed.valid) {
    process.stderr.write(`${parsed.error}\n`)
    process.exitCode = 1
    return
  }
  const args = parsed.value
  if (args.command === "export") {
    process.exitCode = await runExport(args)
    return
  }
  if (args.command === "import") {
    process.exitCode = await runImport(args)
    return
  }
  if (args.command === "revoke") {
    process.exitCode = await runRevoke(args)
    return
  }
  process.exitCode = await runPreflight(args)
}

// `node scripts/vision/export-face-work.js ...` runs; `import` from a test does not.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((err) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
}
