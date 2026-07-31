#!/usr/bin/env node
/** @file Rebuild `label-data.js` for a run that has already been detected —
 *  version 2 of the labelling page's input, from the run's own JSONL files, with
 *  nothing re-detected and no photograph read.
 *
 *  It exists because the labelling page grew three things the batch did not
 *  write: context crops, a per-photograph time and duplicate-frame index (so the
 *  page can show "same shot" and "same evening" without shipping photos.jsonl to
 *  the browser), and an optional guest roster for autocomplete. Re-running the
 *  batch to get them would cost hours of inference and, far worse, renumber the
 *  faces.
 *
 *  Four properties this file is responsible for.
 *
 *  1. **Pool assignment and presentation order are CARRIED OVER, not
 *     re-derived.** They are read verbatim out of the existing label-data.js.
 *     Pool A is the only pool report A's headline number may be computed from,
 *     and a fresh shuffle would move faces between the pools — silently
 *     invalidating labels already collected and the honesty of the number they
 *     support. Re-deriving from the recorded seed is the fallback for a run with
 *     no label-data.js at all, and it says out loud that it did so.
 *  2. **Pool A may GROW, but never shrink or re-draw.** `--pool-a N` with an
 *     existing label-data.js re-derives pools at the larger size N from the
 *     same recorded seed. `assignPools` shuffles face POSITIONS keyed only by
 *     seed and face order, then takes a prefix of it — so the same seed over
 *     the same faces makes a larger pool A a strict superset of a smaller one
 *     (SESSION-2-vision.md §7 P0). `growAssignments` VERIFIES that superset
 *     holds rather than trusting the argument, and refuses if it does not:
 *     that only happens when the recorded seed does not reproduce the file's
 *     existing pools, meaning the two files are from different runs.
 *  3. **`datasetId` identifies the DATA, not its size.** sha256 over every
 *     face's id, photo id and box. The v1 fingerprint was a function of face
 *     count alone, so two different runs of the same length looked identical and
 *     a labels.json could be paired with the wrong run without complaint.
 *  4. **The file is written atomically.** A half-written label-data.js is a
 *     labelling page that will not load, and the labeller is usually the person
 *     least able to diagnose it. Temp file, then rename.
 *
 *  The photograph rules apply unchanged (CLAUDE.md; SPEC §15): nothing here
 *  opens an image, everything read and written is under the run directory in
 *  `tmp/`, and the summary prints counts only — no distribution, no breakdown,
 *  nothing that characterises the people in the photographs.
 *
 *  No regex: every string operation here is `indexOf`, `slice`, `split`,
 *  `startsWith` or `join`.
 */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { allDefaults } from "../../public/vision/defaults.js"

import { contextName } from "./context-crops.js"
import { computeDatasetId } from "./dataset-id.js"
import { assignPools, groupPoolB } from "./session1.js"
import { frameRoots, loadRun } from "./session1-report.js"

export { computeDatasetId } from "./dataset-id.js"

const USAGE = `
Usage: node scripts/vision/relabel-data.js <run-dir> [options]

  Rebuild <run-dir>/label-data.js at schema version 2 from the run's own
  faces.jsonl, photos.jsonl and timing.json. Nothing is re-detected and no
  photograph is read.

  Pool assignment, model grouping and presentation order are carried over from
  the existing label-data.js verbatim, so labelling already done stays valid.

  --roster            Read guest names from the database for autocomplete.
  --database PATH     Database path (default: $DATABASE_PATH or data/wedding.db).
  --no-context        Do not reference context crops even if context/ exists.
  --pool-a N          Grow pool A to N faces (must be >= its current size).
                      With a previous label-data.js, every existing label stays
                      valid: pool A only grows, and the faces already in it are
                      verified to still be in it before anything is written.
                      With no previous label-data.js, N is just the initial
                      pool size passed through to the re-derivation.
  --help
`

const BOOLEAN_FLAGS = ["roster", "no-context", "help"]
const VALUE_FLAGS = ["database", "pool-a"]

/** Exit codes, matching scripts/vision/session1.js. */
const EXIT = { CLEAN: 0, ABORTED: 2 }

/** Schema version this script writes. The contract's version 2. */
const LABEL_DATA_VERSION = 2

/**
 * Pool A size to fall back on when timing.json records none. Only reachable on
 * the re-derivation path, which is already a warning; it matches session1.js's
 * own default so the two agree when neither was told otherwise.
 */
const FALLBACK_POOL_A = 150

/** @typedef {{ valid: true, value: Types.RelabelArgs } | { valid: false, error: string }} RelabelArgsResult */

/**
 * @typedef {object} RelabelDeps
 * @property {(line: string) => void} [log]
 * @property {(databasePath: string) => Types.RosterResult} [readRoster]
 */

// --- Small helpers -----------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asInteger(value) {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

// --- Arguments ---------------------------------------------------------------

/**
 * Both `--database PATH` and `--database=PATH` are accepted, matching
 * session1.js.
 * @param {readonly string[]} argv
 * @returns {RelabelArgsResult}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {}
  /** @type {Set<string>} */
  const flags = new Set()
  /** @type {string[]} */
  const positional = []

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith("--")) {
      positional.push(raw)
      continue
    }
    const body = raw.slice(2)
    const eq = body.indexOf("=")
    const name = eq === -1 ? body : body.slice(0, eq)
    let value = eq === -1 ? null : body.slice(eq + 1)

    if (BOOLEAN_FLAGS.includes(name)) {
      if (value !== null) return { valid: false, error: `--${name} takes no value` }
      flags.add(name)
      continue
    }
    if (!VALUE_FLAGS.includes(name)) return { valid: false, error: `Unknown option --${name}` }
    if (value === null) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        return { valid: false, error: `--${name} needs a value` }
      }
      value = next
      i++
    }
    if (value.length === 0) return { valid: false, error: `--${name} needs a value` }
    values[name] = value
  }

  if (flags.has("help")) return { valid: false, error: USAGE }

  if (positional.length === 0) {
    return { valid: false, error: "No run directory given.\n" + USAGE }
  }
  if (positional.length > 1) {
    return {
      valid: false,
      error:
        `Expected one run directory, got ${positional.length} (${positional.join(", ")}). ` +
        `Quote paths containing spaces.`,
    }
  }

  /** @type {number | null} */
  let poolA = null
  if (values["pool-a"] !== undefined) {
    const text = values["pool-a"]
    const n = Number(text)
    if (!Number.isInteger(n) || n < 1) {
      return { valid: false, error: `--pool-a must be a positive integer, got ${text}` }
    }
    poolA = n
  }

  return {
    valid: true,
    value: {
      dir: path.resolve(positional[0]),
      roster: flags.has("roster"),
      // Read from the environment rather than by loading .env: nothing in the
      // vision lab should pull the server's env module and its warnings in.
      databasePath: path.resolve(
        values.database ?? process.env.DATABASE_PATH ?? path.join("data", "wedding.db"),
      ),
      context: !flags.has("no-context"),
      poolA,
    },
  }
}

// --- The photo index ---------------------------------------------------------

/**
 * `photos[face.photoId]` — capture time and duplicate-frame root, one entry per
 * photograph including the ones with no faces so the index stays aligned.
 *
 * The array is positional, which is only safe if photo ids really are 0..n-1.
 * A `--limit`ed or interrupted run is exactly where that could stop being true,
 * so it is asserted rather than assumed: a silently misaligned index would show
 * the labeller one photograph's time beside another photograph's face, which is
 * a wrong answer that looks like a right one.
 *
 * `frame` comes from the report's own `frameRoots` — imported, not reimplemented,
 * because two union-finds that drift apart mean the page and the report disagree
 * about which faces came from the same shot.
 * @type {Types.buildPhotoIndex}
 */
export function buildPhotoIndex(photos) {
  /** @type {Map<number, Types.Session1PhotoRecord>} */
  const byId = new Map()
  for (const photo of photos) {
    if (byId.has(photo.id)) {
      throw new Error(
        `photos.jsonl: photo id ${photo.id} appears twice. The label data indexes photographs ` +
          `by id and cannot be built from a file with duplicate ids.`,
      )
    }
    byId.set(photo.id, photo)
  }
  for (let i = 0; i < photos.length; i++) {
    if (!byId.has(i)) {
      throw new Error(
        `photos.jsonl: ${photos.length} row(s) but no photo with id ${i}. Ids must be exactly ` +
          `0..${photos.length - 1} — label-data.js indexes photographs by position, and a gap ` +
          `would silently attach every later photograph's time to the wrong face.`,
      )
    }
  }

  const roots = frameRoots(photos)
  /** @type {Array<{ t: number | null, frame: number }>} */
  const index = []
  for (let i = 0; i < photos.length; i++) {
    const photo = /** @type {Types.Session1PhotoRecord} */ (byId.get(i))
    index.push({ t: photo.capturedAtMs, frame: roots.get(photo.id) ?? photo.id })
  }
  return index
}

// --- Carrying the pools across ------------------------------------------------

/**
 * The existing `label-data.js`, or null when there is none.
 *
 * The file is `window.SESSION1_DATA = { ... }` on one line — a script tag rather
 * than a fetch, because label.html is opened over file:// where fetch is
 * refused. Reading it back therefore means finding the object and parsing from
 * there, which is what the `indexOf("{")` is.
 * @type {Types.readPreviousLabelData}
 */
export function readPreviousLabelData(dir) {
  const file = path.join(dir, "label-data.js")
  if (!fs.existsSync(file)) return null
  const text = fs.readFileSync(file, "utf8")
  const brace = text.indexOf("{")
  if (brace === -1) {
    throw new Error(`${file}: no JSON object found — expected "window.SESSION1_DATA = { ... }".`)
  }
  try {
    return /** @type {Types.Session1LabelData} */ (JSON.parse(text.slice(brace)))
  } catch (err) {
    throw new Error(
      `${file}: could not parse the data object — ${err instanceof Error ? err.message : String(err)}\n` +
        `Move it aside to have the pools re-derived from timing.json's recorded seed instead.`,
    )
  }
}

/**
 * Pool, group and order lifted from a previous label-data.js, checked against
 * the faces the run actually recorded.
 *
 * Every check below is a refusal to guess. A face with no previous assignment
 * cannot be given one — dropping it would shrink the labelling set, and inventing
 * a pool for it would put a face into pool A that the uniform sample never drew.
 * @type {Types.carryAssignments}
 */
export function carryAssignments(faces, previous) {
  /** @type {Map<number, { pool: "A" | "B", group: number | null }>} */
  const pools = new Map()
  for (const face of previous.faces ?? []) {
    if (face.pool !== "A" && face.pool !== "B") {
      throw new Error(`label-data.js: face ${face.id} has pool ${JSON.stringify(face.pool)}`)
    }
    pools.set(face.id, { pool: face.pool, group: face.group ?? null })
  }

  /** @type {number[]} */
  const missing = []
  for (const face of faces) if (!pools.has(face.id)) missing.push(face.id)
  if (missing.length > 0) {
    throw new Error(
      `label-data.js covers ${pools.size} face(s) but faces.jsonl has ${faces.length}; ` +
        `${missing.length} have no pool assignment (first: ${missing[0]}).\n` +
        `The two files are from different runs. Pool A is a uniform sample and re-drawing it ` +
        `would invalidate every label already collected, so this is a refusal, not a warning.`,
    )
  }

  /** @type {Set<number>} */
  const known = new Set(faces.map((face) => face.id))
  const order = previous.order ?? []
  /** @type {Set<number>} */
  const seen = new Set()
  for (const id of order) {
    if (!known.has(id)) {
      throw new Error(
        `label-data.js: presentation order references face ${id}, which faces.jsonl has no row for.`,
      )
    }
    if (seen.has(id)) {
      throw new Error(`label-data.js: presentation order lists face ${id} twice.`)
    }
    seen.add(id)
  }
  if (seen.size !== known.size) {
    throw new Error(
      `label-data.js: presentation order covers ${seen.size} of ${known.size} face(s). ` +
        `The order is fixed so a labeller cannot cherry-pick easy crops; a partial one would ` +
        `hide the rest of the run rather than shuffle it.`,
    )
  }

  return { pools, order: order.slice() }
}

/**
 * Grow pool A from a previous label-data.js: re-derive pools at a larger size
 * from the seed timing.json recorded, and check the OLD pool A survives as a
 * subset of the new one before trusting any of it.
 *
 * `assignPools` does a full Fisher-Yates shuffle of face POSITIONS keyed only
 * by seed and face order, then takes the first `poolASize` of it (see
 * session1.js). Same seed, same faces, larger size: the new pool A is a
 * longer prefix of the same shuffled sequence, so it strictly contains every
 * shorter prefix drawn from it — which is the "sequential uniform sampling
 * without replacement is still uniform" property SESSION-2-vision.md §7 P0
 * rests the whole growth idea on. This function does not cite that argument
 * and trust it; it VERIFIES the prefix on every call. The only way the check
 * can fail is a seed or face set that does not match what produced the file
 * being grown — exactly the "these are two different runs" case
 * `carryAssignments` above already refuses rather than guesses through.
 *
 * Pool B's group ids are never re-derived here, on purpose. `groupPoolB`
 * renumbers group ids whenever pool-B membership changes — and it changes on
 * every growth, since the promoted faces leave it — so re-running it would
 * hand out fresh ids to a population that only shrank. labels.json's
 * `excluded` map is keyed by group id, so a renumbering would silently attach
 * an exclusion recorded against one cluster to a different one. Every face
 * that stays in pool B keeps the OLD group id it already had: stale but
 * stable, which is strictly safer than fresh but wrong.
 * @type {Types.growAssignments}
 */
export function growAssignments(faces, previous, timing, poolASize) {
  const carried = carryAssignments(faces, previous)

  let previousPoolASize = 0
  for (const assigned of carried.pools.values()) if (assigned.pool === "A") previousPoolASize++

  if (poolASize < previousPoolASize) {
    throw new Error(
      `--pool-a ${poolASize} is smaller than the ${previousPoolASize} face(s) already in pool A. ` +
        `Pool A only grows: shrinking it would orphan labels already collected on the faces dropped.`,
    )
  }
  if (poolASize > faces.length) {
    throw new Error(`--pool-a ${poolASize} exceeds the run's ${faces.length} face(s).`)
  }

  const seed = asInteger((timing?.config ?? {}).shuffleSeed)
  // groupPoolB is deliberately NOT passed: the re-derivation exists only to
  // learn which faces the LARGER pool A would contain, and its group ids are
  // never used (see the file header above).
  const derived = assignPools(
    faces.map((face) => ({ id: face.id, crop: face.crop, photoId: face.photoId })),
    { poolASize, seed: seed ?? undefined },
  )

  /** @type {Set<number>} */
  const newPoolA = new Set()
  for (const face of derived.faces) if (face.pool === "A") newPoolA.add(face.id)

  for (const [id, assigned] of carried.pools) {
    if (assigned.pool === "A" && !newPoolA.has(id)) {
      throw new Error(
        `label-data.js's existing pool A is not contained in the pool A re-derived from timing.json's ` +
          `recorded seed (face ${id} was pool A before and is not now). The recorded seed does not ` +
          `reproduce label-data.js's existing pools, so the two files are from different runs. ` +
          `Growing pool A safely requires the same seed and the same face order that produced the ` +
          `file being grown, and this is a refusal, not a guess.`,
      )
    }
  }

  /** @type {Map<number, { pool: "A" | "B", group: number | null }>} */
  const pools = new Map()
  /** @type {number[]} */
  const promoted = []
  for (const face of faces) {
    const old = /** @type {{ pool: "A" | "B", group: number | null }} */ (
      carried.pools.get(face.id)
    )
    if (old.pool === "B" && newPoolA.has(face.id)) {
      pools.set(face.id, { pool: "A", group: null })
      promoted.push(face.id)
    } else {
      // Carried verbatim, including a pool-B face's OLD group id — see the
      // file header on why that staleness is deliberate.
      pools.set(face.id, { pool: old.pool, group: old.group })
    }
  }
  promoted.sort((a, b) => a - b)

  // Presentation order is untouched. assignPools shuffles it from a stream
  // keyed by seed and face ids alone, independent of poolASize (see
  // session1.js and the "changing --pool-a does not reshuffle the
  // presentation order" test), so re-deriving it would only reproduce the same
  // array — carrying the recorded one over verbatim says so directly instead
  // of relying on that independence holding forever.
  return { pools, order: carried.order, promoted }
}

/**
 * The fallback when there is no label-data.js to carry: re-run the same seeded
 * sampling the batch did, from the seed and pool size timing.json recorded.
 *
 * Only correct if the run's own configuration is what timing.json says it is,
 * which is why the caller says so out loud. Carrying is always preferred.
 *
 * `poolASizeOverride` is `--pool-a`, when given: it takes precedence over
 * timing.json's recorded size, and becomes the initial pool size for a run
 * that has no label-data.js at all yet.
 * @type {Types.derivedAssignments}
 */
export function derivedAssignments(faces, timing, poolASizeOverride) {
  const config = timing?.config ?? {}
  const poolASize = asInteger(poolASizeOverride) ?? asInteger(config.poolASize) ?? FALLBACK_POOL_A
  const seed = asInteger(config.shuffleSeed)

  const defaults = allDefaults().group
  const recorded = config.group
  const groupConfig =
    recorded && typeof recorded === "object"
      ? {
          cutoff:
            typeof (/** @type {Record<string, unknown>} */ (recorded).cutoff) === "number"
              ? /** @type {number} */ (/** @type {Record<string, unknown>} */ (recorded).cutoff)
              : defaults.cutoff,
          cannotLinkWithinPhoto:
            /** @type {Record<string, unknown>} */ (recorded).cannotLinkWithinPhoto !== false,
        }
      : { cutoff: defaults.cutoff, cannotLinkWithinPhoto: defaults.cannotLinkWithinPhoto }

  /** @type {Map<number, number[]>} */
  const descriptorsById = new Map()
  for (const face of faces) {
    descriptorsById.set(face.id, face.mirrorDescriptor ?? face.descriptor)
  }

  const derived = assignPools(
    faces.map((face) => ({ id: face.id, crop: face.crop, photoId: face.photoId })),
    {
      poolASize,
      seed: seed ?? undefined,
      groupPoolB: (poolBFaces) => groupPoolB(poolBFaces, descriptorsById, groupConfig),
    },
  )

  /** @type {Map<number, { pool: "A" | "B", group: number | null }>} */
  const pools = new Map()
  for (const face of derived.faces) pools.set(face.id, { pool: face.pool, group: face.group })
  return { pools, order: derived.order }
}

// --- The roster --------------------------------------------------------------

/**
 * Live guests, for the labelling page's autocomplete only.
 *
 * Opened READ-ONLY, and deliberately not through db/connection.js: that module
 * creates tables and runs migrations on connect, which is not something a
 * scratch tool pointed at a production database may do.
 *
 * Names never reach labels.json — the measurement only needs "same person or
 * not". They exist so that the optional, separately-saved identities.json can be
 * typed with real names instead of guessed spellings.
 * @type {Types.readRoster}
 */
export function readRoster(databasePath) {
  if (!fs.existsSync(databasePath)) {
    return { ok: false, reason: `${databasePath}: no such database file` }
  }
  /** @type {DatabaseSync} */
  let db
  try {
    db = new DatabaseSync(databasePath, { readOnly: true })
  } catch (err) {
    return {
      ok: false,
      reason: `${databasePath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  try {
    const rows = db
      .prepare(
        "SELECT id, name FROM guests WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id",
      )
      .all()
    /** @type {Array<{ id: number, name: string }>} */
    const roster = []
    for (const row of rows) {
      const id = row.id
      const name = row.name
      if (typeof id !== "number" || typeof name !== "string") continue
      const trimmed = name.trim()
      if (trimmed.length === 0) continue
      roster.push({ id, name: trimmed })
    }
    if (roster.length === 0) {
      return { ok: false, reason: `${databasePath}: the guests table has no live rows` }
    }
    return { ok: true, roster }
  } catch (err) {
    return {
      ok: false,
      reason: `${databasePath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    db.close()
  }
}

// --- Assembly ----------------------------------------------------------------

/** @type {Types.buildLabelData} */
export function buildLabelData(input) {
  const { pools, order } = input.assignments
  const photos = buildPhotoIndex(input.photos)

  /** @type {Types.Session1LabelData} */
  const data = {
    version: LABEL_DATA_VERSION,
    datasetId: computeDatasetId(input.faces),
    faces: input.faces.map((face) => {
      const assigned = pools.get(face.id)
      if (!assigned) throw new Error(`buildLabelData: face ${face.id} has no pool assignment`)
      if (face.photoId < 0 || face.photoId >= photos.length) {
        throw new Error(
          `faces.jsonl: face ${face.id} references photo ${face.photoId}, but the run has ` +
            `${photos.length} photograph(s).`,
        )
      }
      /** @type {Types.Session1LabelData["faces"][number]} */
      const entry = {
        id: face.id,
        crop: face.crop,
        photoId: face.photoId,
        pool: assigned.pool,
        group: assigned.group,
      }
      // The key is omitted, not set to null: the page decides whether to offer
      // the wider view by asking whether the key is there, and a null would be
      // an offer of a file that does not exist.
      if (input.hasContext(face.id)) entry.context = contextName(face.id)
      return entry
    }),
    photos,
    order,
  }
  if (input.roster) data.roster = input.roster
  return data
}

/**
 * Temp file then rename, because rename is atomic within a directory. An
 * interrupted write must not leave label.html pointing at half a JSON object —
 * the page would fail to load with a syntax error, and the person holding it is
 * the least equipped to work out why.
 * @type {Types.writeLabelData}
 */
export function writeLabelData(file, data) {
  const temp = file + ".tmp"
  // A script tag, not a fetch: label.html is opened over file://, where fetch is
  // refused by every browser and there is deliberately no server.
  fs.writeFileSync(temp, "window.SESSION1_DATA = " + JSON.stringify(data) + "\n")
  fs.renameSync(temp, file)
}

/** @type {Types.runRelabel} */
export async function runRelabel(args, deps = {}) {
  const log = deps.log ?? ((line) => process.stdout.write(line + "\n"))
  const rosterReader = deps.readRoster ?? readRoster

  if (!fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
    throw new Error(`Not a run directory: ${args.dir}`)
  }

  // loadRun is the report's loader, reused so the tolerance for a truncated
  // final line — counted and warned about, never silently dropped — is the same
  // one the report applies to the same files.
  const run = loadRun(args.dir)
  if (run.photos.length === 0) throw new Error(`${args.dir}/photos.jsonl: missing or empty`)
  if (run.faces.length === 0) throw new Error(`${args.dir}/faces.jsonl: missing or empty`)

  const previous = readPreviousLabelData(args.dir)
  /** @type {"carried" | "derived" | "grown"} */
  let mode
  /** @type {{ pools: Map<number, { pool: "A" | "B", group: number | null }>, order: number[] }} */
  let assignments
  /** @type {number[]} */
  let promoted = []
  if (previous) {
    if (args.poolA !== null) {
      mode = "grown"
      const grown = growAssignments(run.faces, previous, run.timing, args.poolA)
      assignments = { pools: grown.pools, order: grown.order }
      promoted = grown.promoted
    } else {
      mode = "carried"
      assignments = carryAssignments(run.faces, previous)
    }
  } else {
    mode = "derived"
    log(
      "! No existing label-data.js — re-deriving the pools and order from timing.json's recorded\n" +
        "  seed. This reproduces the batch's own sampling only if the run's configuration is what\n" +
        "  timing.json says it is. Any labelling done against a different assignment is invalid.",
    )
    assignments = derivedAssignments(run.faces, run.timing, args.poolA)
  }

  // A promoted face may already carry a pool-B label in labels.json — most
  // often from a group keystroke, which answered for the whole group at once.
  // relabel-data.js does not rewrite labels.json, so it cannot fix this; it can
  // only say how many faces are affected. label.html does not read labels.json
  // back in either — it restores per-face labels from THIS BROWSER's
  // localStorage, keyed by a dataset id that pool growth does not change (it
  // hashes face id/photoId/box, not pool assignment). So on Resume, a promoted
  // face shows up already answered, as a unit of one, and is not flagged as
  // outstanding — nothing forces a fresh look at it.
  if (mode === "grown" && promoted.length > 0 && run.labels) {
    let alreadyLabelled = 0
    for (const id of promoted) {
      if (Object.prototype.hasOwnProperty.call(run.labels.labels, String(id))) alreadyLabelled++
    }
    if (alreadyLabelled > 0) {
      log(
        `! ${alreadyLabelled} of the ${promoted.length} face(s) promoted to pool A already carry a\n` +
          "  label in labels.json — most likely a pool-B group answer. label.html will not re-present\n" +
          "  them as outstanding on its own (it restores labels from this browser's localStorage, not\n" +
          "  from labels.json). Deliberately revisit each one in pool A and answer it fresh rather than\n" +
          "  trusting the group answer it inherited: the disagreement rate you find there is only an\n" +
          "  UPPER BOUND on pool-B contamination, since it also counts ordinary test-retest noise.",
      )
    }
  }

  /** @type {(id: number) => boolean} */
  let hasContext = () => false
  let contextCount = 0
  if (args.context) {
    const contextDir = path.join(args.dir, "context")
    if (fs.existsSync(contextDir)) {
      // Listed once rather than stat-ed per face: a run is thousands of faces and
      // one readdir is one syscall.
      /** @type {Set<string>} */
      const present = new Set(fs.readdirSync(contextDir))
      hasContext = (id) => present.has(contextName(id).slice("context/".length))
      for (const face of run.faces) if (hasContext(face.id)) contextCount++
    }
  }

  /** @type {Array<{ id: number, name: string }> | null} */
  let roster = null
  /** @type {string | null} */
  let rosterWarning = null
  if (args.roster) {
    const result = rosterReader(args.databasePath)
    if (result.ok) roster = result.roster
    else rosterWarning = result.reason
  }
  if (rosterWarning !== null) {
    log(`! --roster asked for names but none were available: ${rosterWarning}`)
    log("  Writing label-data.js without a roster; autocomplete will be off.")
  }

  const data = buildLabelData({
    faces: run.faces,
    photos: run.photos,
    assignments,
    hasContext,
    roster,
  })

  const target = path.join(args.dir, "label-data.js")
  writeLabelData(target, data)

  const poolA = data.faces.filter((face) => face.pool === "A").length
  const poolB = data.faces.length - poolA

  const modeLabel =
    mode === "carried"
      ? "carried over unchanged"
      : mode === "grown"
        ? `GROWN (${promoted.length} promoted B→A)`
        : "RE-DERIVED"

  log("")
  log(`${data.faces.length} face(s) over ${data.photos?.length ?? 0} photograph(s).`)
  log(`Pool A ${poolA}, pool B ${poolB} — ${modeLabel}.`)
  log(
    contextCount > 0
      ? `Context crops: ${contextCount} referenced.`
      : args.context
        ? "Context crops: none (run scripts/vision/context-crops.js to make them)."
        : "Context crops: not referenced (--no-context).",
  )
  log(roster ? `Roster: ${roster.length} name(s) for autocomplete.` : "Roster: not included.")
  log(`datasetId: ${data.datasetId}`)
  log(`Wrote ${target}`)

  return {
    exitCode: EXIT.CLEAN,
    data,
    poolA,
    poolB,
    mode,
    promoted: promoted.length,
    contextCrops: contextCount,
    rosterSize: roster ? roster.length : null,
  }
}

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const parsed = parseArgs(argv)
  if (!parsed.valid) {
    process.stderr.write(parsed.error + "\n")
    return EXIT.ABORTED
  }
  try {
    const result = await runRelabel(parsed.value)
    return result.exitCode
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n")
    return EXIT.ABORTED
  }
}

// `node scripts/vision/relabel-data.js ...` runs; `import` from a test does not.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2))
}
