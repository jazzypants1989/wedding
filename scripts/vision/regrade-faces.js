#!/usr/bin/env node
/** @file CLI: re-grade stored faces under the CURRENT routing profile.
 *
 *  `media_faces.route_state` is computed at ingest and persisted, which is what
 *  makes the Faces tab's queue cheap and what makes an old queue page mean
 *  something stable. The cost of persisting it is that revising the routing
 *  rules does not reach rows already in the database — they keep the grade they
 *  were given, correctly labelled with the profile that gave it.
 *
 *  This tool is the deliberate second half of such a revision: it re-runs
 *  `routeFace` over stored signals and writes the new verdict. It reads nothing
 *  but the database, so it needs no run directory, no photographs and no
 *  weights — the nine `signal_` columns ARE the detection-time measurement, and
 *  re-grading is a pure function of them.
 *
 *  **It never re-detects and never re-describes.** Signals and descriptors are
 *  untouched; only `route_state`, `route_reason` and `route_profile` move. So a
 *  re-grade cannot lose work, and running it twice is a no-op.
 *
 *  **It does not touch naming.** A face that has been assigned to a person keeps
 *  its assignment whatever its new grade — routing decides what an admin is
 *  SHOWN, never what is true. That is worth stating because the reverse would be
 *  catastrophic and silent: a stricter profile that cleared assignments would
 *  destroy exactly the human judgement this project exists to collect.
 *
 *  ## The default is the stale rows only
 *
 *  By default it re-grades rows whose `route_profile` is not the current one.
 *  That is the honest unit of work: a row already graded under this profile
 *  would get an identical verdict, so touching it only churns `updated_at`.
 *  `--all` forces every live row, which is what to use if you suspect a row was
 *  written with a profile tag that does not match how it was actually graded.
 *
 *  Ungraded rows (`route_profile IS NULL`) are always included — they are stale
 *  by definition.
 */

/** @import * as Types from './types.js' */

import path from "node:path"

import { facesWithSignals, setFaceRoute } from "../../db/media-faces.js"
import { sql } from "../../db/sql.js"
import { PROFILE, routeCutoffs, routeFace } from "../../public/vision/route.js"
import { openDatabase } from "./ingest-faces.js"

/**
 * The nine signals `routeFace` grades against, and the column each arrives in.
 *
 * Spelled out rather than derived by trimming a `signal_` prefix: a row missing
 * one of these must be left UNGRADED rather than graded against an `undefined`,
 * which compares false against every cutoff and would quietly route the face
 * `set_aside` — the exact silent-wrong-answer this file exists to avoid.
 * @type {ReadonlyArray<[keyof import('../../public/vision/types.js').GateSignals, string]>}
 */
const SIGNAL_COLUMNS = [
  ["score", "signal_score"],
  ["boxPx", "signal_boxPx"],
  ["borderPx", "signal_borderPx"],
  ["eyeRatio", "signal_eyeRatio"],
  ["eyeAngle", "signal_eyeAngle"],
  ["alignScale", "signal_alignScale"],
  ["residual", "signal_residual"],
  ["outsideFraction", "signal_outsideFraction"],
  ["sharpness", "signal_sharpness"],
]

/** Rows read per batch. Bounded so a large library does not build one enormous
 *  `IN (...)` list, which SQLite has a hard parameter limit on. */
const BATCH = 500

const USAGE = `Usage: node scripts/vision/regrade-faces.js [options]

  Re-grade stored faces under the current routing profile (${PROFILE}).
  Reads only the database: no run directory, no photographs, no weights.

  --database PATH   SQLite file to re-grade. Default: $DATABASE_PATH, then
                     data/wedding.db. Always pass it explicitly for a scratch
                     database — the default is the real one.
  --all             Re-grade every live face, not only the stale-profile ones.
  --dry-run         Report what would change and write nothing.
  --help            This text.

  Signals, descriptors and every naming decision are left untouched. Only
  route_state, route_reason and route_profile move.
`

/**
 * Turn a signal row into the shape `routeFace` grades, or null when the row
 * cannot be graded honestly.
 * @param {Record<string, unknown>} row
 * @returns {import('../../public/vision/types.js').GateSignals | null}
 */
export function signalsFromRow(row) {
  /** @type {Record<string, number>} */
  const signals = {}
  for (const [key, column] of SIGNAL_COLUMNS) {
    const value = row[column]
    if (typeof value !== "number" || !Number.isFinite(value)) return null
    signals[key] = value
  }
  return /** @type {import('../../public/vision/types.js').GateSignals} */ (
    /** @type {unknown} */ (signals)
  )
}

/**
 * The live face ids this run is about, oldest first so a partial run is
 * resumable in a predictable order.
 * @param {boolean} all
 * @returns {number[]}
 */
function staleFaceIds(all) {
  /** @type {Array<{ id: number }>} */
  const rows = all
    ? sql`SELECT id FROM media_faces WHERE deleted_at IS NULL ORDER BY id`.all()
    : sql`SELECT id FROM media_faces
        WHERE deleted_at IS NULL
          AND (route_profile IS NULL OR route_profile <> ${PROFILE})
        ORDER BY id`.all()
  return rows.map((row) => row.id)
}

/**
 * Re-grade a set of faces. Pure enough to test: it takes the ids and returns
 * the transitions, and `apply` decides whether anything is written.
 * @param {number[]} faceIds
 * @param {{ apply: boolean }} options
 * @returns {Types.RegradeReport}
 */
export function regradeFaces(faceIds, options) {
  const cutoffs = routeCutoffs()
  /** @type {Record<string, number>} */
  const transitions = {}
  /** @type {Record<string, number>} */
  const after = {}
  let ungradable = 0
  let unchanged = 0
  let written = 0

  for (let offset = 0; offset < faceIds.length; offset += BATCH) {
    const batch = faceIds.slice(offset, offset + BATCH)
    for (const row of facesWithSignals(batch)) {
      const signals = signalsFromRow(/** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (row)
      ))
      // A row missing a signal keeps whatever grade it has. Grading it against
      // absent measurements would be a guess wearing a verdict's clothes.
      if (signals === null) {
        ungradable++
        continue
      }
      const verdict = routeFace(signals, cutoffs)
      after[verdict.state] = (after[verdict.state] ?? 0) + 1
      const from = row.route_state ?? "ungraded"
      if (from === verdict.state && row.route_profile === verdict.profile) {
        unchanged++
        continue
      }
      transitions[`${from} -> ${verdict.state}`] =
        (transitions[`${from} -> ${verdict.state}`] ?? 0) + 1
      if (options.apply && setFaceRoute(row.id, verdict)) written++
    }
  }

  return { considered: faceIds.length, ungradable, unchanged, written, transitions, after }
}

/** @param {string[]} argv @returns {Types.RegradeArgs} */
export function parseArgs(argv) {
  /** @type {Types.RegradeArgs} */
  const args = { database: null, all: false, dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") args.help = true
    else if (arg === "--all") args.all = true
    else if (arg === "--dry-run") args.dryRun = true
    else if (arg === "--database") {
      i++
      if (i >= argv.length) return { ...args, error: "--database needs a value" }
      args.database = argv[i]
    } else if (arg.startsWith("--database=")) {
      args.database = arg.slice("--database=".length)
    } else return { ...args, error: `unknown option: ${arg}` }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return 0
  }
  if (args.error) {
    console.error(args.error)
    console.error(USAGE)
    return 2
  }

  const dbPath = args.database
    ? path.resolve(args.database)
    : process.env.DATABASE_PATH ||
      path.join(import.meta.dirname, "..", "..", "data", "wedding.db")

  const db = openDatabase(dbPath)
  try {
    const ids = staleFaceIds(args.all)
    console.log(`profile:      ${PROFILE}`)
    console.log(`database:     ${dbPath}`)
    console.log(`faces to grade: ${ids.length}${args.all ? " (--all)" : " (stale profile only)"}`)
    if (ids.length === 0) {
      console.log("nothing to do — every live face is already graded under this profile.")
      return 0
    }

    // One transaction: a half-applied re-grade would leave the queue split
    // across two profiles with no record of where the boundary is.
    if (!args.dryRun) db.exec("BEGIN IMMEDIATE TRANSACTION")
    let committed = false
    /** @type {Types.RegradeReport} */
    let report
    try {
      report = regradeFaces(ids, { apply: !args.dryRun })
      if (!args.dryRun) {
        db.exec("COMMIT")
        committed = true
      }
    } finally {
      if (!args.dryRun && !committed) {
        try {
          db.exec("ROLLBACK")
        } catch {
          /* already rolled back */
        }
      }
    }

    console.log(`unchanged:    ${report.unchanged}`)
    console.log(`ungradable:   ${report.ungradable} (a signal column was absent; grade left alone)`)
    console.log(`written:      ${report.written}${args.dryRun ? " (dry run — nothing written)" : ""}`)
    console.log("transitions:")
    const keys = Object.keys(report.transitions).sort()
    if (keys.length === 0) console.log("  (none)")
    for (const key of keys) console.log(`  ${key}: ${report.transitions[key]}`)
    console.log("resulting states (over the faces considered):")
    for (const key of Object.keys(report.after).sort()) {
      console.log(`  ${key}: ${report.after[key]}`)
    }
    return 0
  } finally {
    db.close()
  }
}

if (process.argv[1] && process.argv[1].endsWith("regrade-faces.js")) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
}
