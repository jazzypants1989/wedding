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
 *  Three properties this file is responsible for.
 *
 *  1. **Pool assignment and presentation order are CARRIED OVER, not
 *     re-derived.** They are read verbatim out of the existing label-data.js.
 *     Pool A is the only pool report A's headline number may be computed from,
 *     and a fresh shuffle would move faces between the pools — silently
 *     invalidating labels already collected and the honesty of the number they
 *     support. Re-deriving from the recorded seed is the fallback for a run with
 *     no label-data.js at all, and it says out loud that it did so.
 *  2. **`datasetId` identifies the DATA, not its size.** sha256 over every
 *     face's id, photo id and box. The v1 fingerprint was a function of face
 *     count alone, so two different runs of the same length looked identical and
 *     a labels.json could be paired with the wrong run without complaint.
 *  3. **The file is written atomically.** A half-written label-data.js is a
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
  --help
`

const BOOLEAN_FLAGS = ["roster", "no-context", "help"]
const VALUE_FLAGS = ["database"]

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
 * The fallback when there is no label-data.js to carry: re-run the same seeded
 * sampling the batch did, from the seed and pool size timing.json recorded.
 *
 * Only correct if the run's own configuration is what timing.json says it is,
 * which is why the caller says so out loud. Carrying is always preferred.
 * @type {Types.derivedAssignments}
 */
export function derivedAssignments(faces, timing) {
  const config = timing?.config ?? {}
  const poolASize = asInteger(config.poolASize) ?? FALLBACK_POOL_A
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
  let carried = true
  /** @type {{ pools: Map<number, { pool: "A" | "B", group: number | null }>, order: number[] }} */
  let assignments
  if (previous) {
    assignments = carryAssignments(run.faces, previous)
  } else {
    carried = false
    log(
      "! No existing label-data.js — re-deriving the pools and order from timing.json's recorded\n" +
        "  seed. This reproduces the batch's own sampling only if the run's configuration is what\n" +
        "  timing.json says it is. Any labelling done against a different assignment is invalid.",
    )
    assignments = derivedAssignments(run.faces, run.timing)
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

  log("")
  log(`${data.faces.length} face(s) over ${data.photos?.length ?? 0} photograph(s).`)
  log(`Pool A ${poolA}, pool B ${poolB} — ${carried ? "carried over unchanged" : "RE-DERIVED"}.`)
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
    carried,
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
