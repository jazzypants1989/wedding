/**
 * @file Re-grading stored faces under the current routing profile.
 *
 * `regrade-faces.js` is the deliberate second half of a routing revision: the
 * grade is computed at ingest and PERSISTED, so revising the rules does not
 * reach rows already in the database until this tool runs. It ran against the
 * real library before it had a single test, which is the wrong order and the
 * reason this file exists.
 *
 * Three of its promises are load-bearing enough that breaking one silently
 * would be expensive, and none of them is visible from reading the diff:
 *
 *  - **A row missing a signal is left ALONE, not graded.** `applyGate` compares
 *    every cutoff against `undefined` as false, so an ungraded row would sail
 *    through the gate and route `accept` — a face nobody measured, offered up
 *    to be named unprompted. `signalsFromRow` returning null is the guard.
 *  - **A stale PROFILE is a reason to write even when the state does not
 *    change.** That is the actual r1 → r2 case: most rows keep their state and
 *    every one of them still has to be re-stamped, or the database ends up
 *    split across two profiles with no record of where the boundary is.
 *  - **Naming is never touched.** Routing decides what an admin is SHOWN, never
 *    what is true. A stricter profile that cleared assignments would destroy
 *    exactly the human judgement this project exists to collect.
 *
 * The tests run against a real temp SQLite database rather than mocks: the
 * things worth catching here live in the WHERE clauses (`deleted_at IS NULL`,
 * the `route_profile <> ?` selection) and a mock would assert my reading of
 * them back to me.
 */

import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { createTables, runMigrations } from "../../db/schema.js"
import { useDatabase } from "../../scripts/vision/export-face-work.js"
import { regradeFaces, signalsFromRow } from "../../scripts/vision/regrade-faces.js"
import { PROFILE, routeCutoffs, routeFace } from "../../public/vision/route.js"

/** @import * as VisionTypes from '../../public/vision/types.js' */

const CUTOFFS = routeCutoffs()

/**
 * A face clearing every gate check and both accept bars. Individual tests
 * degrade one signal from here, so a failure names the signal it is about.
 * Same shape as vision-route.test.js's helper, deliberately.
 * @param {Partial<VisionTypes.GateSignals>} [overrides]
 * @returns {VisionTypes.GateSignals}
 */
function signals(overrides = {}) {
  return {
    score: 0.99,
    boxPx: 400,
    borderPx: 50,
    eyeRatio: 0.35,
    eyeAngle: 0.01,
    alignScale: 0.4,
    residual: 1.0,
    outsideFraction: 0,
    sharpness: 0.08,
    ...overrides,
  }
}

/** @type {DatabaseSync} */
let db
/** @type {number} */
let media

beforeEach(() => {
  db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  createTables(db)
  runMigrations(db)
  useDatabase(db)
  db.prepare(
    "INSERT INTO media (file_key, kind, section, status) VALUES ('k', 'image', 'guest', 'approved')",
  ).run()
  media = Number(
    /** @type {{ id: number }} */ (db.prepare("SELECT last_insert_rowid() AS id").get()).id,
  )
})

afterEach(() => {
  db.close()
})

/**
 * Insert one face row. `grade` is what the row already carries; passing null
 * for the profile is the never-graded case.
 * @param {object} options
 * @param {Partial<VisionTypes.GateSignals>} [options.signals]
 * @param {string | null} [options.state]
 * @param {string | null} [options.profile]
 * @param {number | null} [options.identityId]
 * @param {boolean} [options.deleted]
 * @param {string[]} [options.nullSignals] columns to store as NULL
 * @returns {number}
 */
function seedFace(options = {}) {
  const s = signals(options.signals)
  /** @type {Record<string, number | null>} */
  const cols = {
    signal_score: s.score,
    signal_boxPx: s.boxPx,
    signal_borderPx: s.borderPx,
    signal_eyeRatio: s.eyeRatio,
    signal_eyeAngle: s.eyeAngle,
    signal_alignScale: s.alignScale,
    signal_residual: s.residual,
    signal_outsideFraction: s.outsideFraction,
    signal_sharpness: s.sharpness,
  }
  for (const column of options.nullSignals ?? []) cols[column] = null

  const names = Object.keys(cols)
  db.prepare(
    `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, source,
       face_identity_id, deleted_at, route_state, route_profile, ${names.join(", ")})
     VALUES (?, 1, 2, 3, 4, 'test-model', 'cli', ?, ?, ?, ?, ${names.map(() => "?").join(", ")})`,
  ).run(
    media,
    options.identityId ?? null,
    options.deleted ? "2026-01-01 00:00:00" : null,
    options.state ?? null,
    options.profile ?? null,
    ...names.map((n) => cols[n]),
  )
  return Number(
    /** @type {{ id: number }} */ (db.prepare("SELECT last_insert_rowid() AS id").get()).id,
  )
}

/**
 * The routing + naming columns of one face row.
 *
 * A `@typedef` plus a single-line cast, rather than the inline multi-line
 * `@type` cast this file first used. An inline JSDoc type-assertion whose type
 * is broken across lines — with a leading asterisk on the continuation —
 * silently mangles the parenthesised expression at runtime: `.get()` came back
 * `undefined` for a row that demonstrably existed, with no error anywhere.
 * Keep inline casts on one line; put long types in a typedef like this one.
 * @typedef {{ route_state: string | null, route_profile: string | null,
 *   route_reason: string | null, face_identity_id: number | null }} FaceRouteRow
 */

/** @param {number} id @returns {FaceRouteRow | undefined} */
function row(id) {
  const found = db
    .prepare(
      "SELECT route_state, route_profile, route_reason, face_identity_id FROM media_faces WHERE id = ?",
    )
    .get(id)
  return /** @type {FaceRouteRow | undefined} */ (/** @type {unknown} */ (found))
}

// --- signalsFromRow: the guard against grading an unmeasured face ------------

describe("signalsFromRow", () => {
  it("maps all nine signal columns onto the names routeFace reads", () => {
    const id = seedFace()
    const read = signalsFromRow(
      /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (db.prepare("SELECT * FROM media_faces WHERE id = ?").get(id))
      ),
    )
    assert.deepEqual(read, signals())
  })

  it("returns null when ANY signal column is absent", () => {
    // One at a time, because a loop over all nine would pass if the function
    // only ever checked the first.
    for (const column of [
      "signal_score",
      "signal_boxPx",
      "signal_borderPx",
      "signal_eyeRatio",
      "signal_eyeAngle",
      "signal_alignScale",
      "signal_residual",
      "signal_outsideFraction",
      "signal_sharpness",
    ]) {
      const id = seedFace({ nullSignals: [column] })
      const read = signalsFromRow(
        /** @type {Record<string, unknown>} */ (
          /** @type {unknown} */ (db.prepare("SELECT * FROM media_faces WHERE id = ?").get(id))
        ),
      )
      assert.equal(read, null, `${column} absent should refuse to grade`)
    }
  })

  it("returns null for a non-finite value rather than grading against it", () => {
    assert.equal(signalsFromRow({ ...columnsOf(signals()), signal_sharpness: NaN }), null)
    assert.equal(signalsFromRow({ ...columnsOf(signals()), signal_boxPx: Infinity }), null)
  })
})

/** @param {VisionTypes.GateSignals} s @returns {Record<string, unknown>} */
function columnsOf(s) {
  return {
    signal_score: s.score,
    signal_boxPx: s.boxPx,
    signal_borderPx: s.borderPx,
    signal_eyeRatio: s.eyeRatio,
    signal_eyeAngle: s.eyeAngle,
    signal_alignScale: s.alignScale,
    signal_residual: s.residual,
    signal_outsideFraction: s.outsideFraction,
    signal_sharpness: s.sharpness,
  }
}

// --- regradeFaces ------------------------------------------------------------

describe("regradeFaces", () => {
  it("writes the new grade and stamps the current profile", () => {
    const id = seedFace({ signals: { boxPx: 10 }, state: "accept", profile: "route-r0" })
    const report = regradeFaces([id], { apply: true })

    assert.equal(report.written, 1)
    const after = row(id)
    assert.equal(after?.route_state, "set_aside")
    assert.equal(after?.route_reason, "boxPx")
    assert.equal(after?.route_profile, PROFILE)
    assert.deepEqual(report.transitions, { "accept -> set_aside": 1 })
  })

  it("re-stamps a row whose STATE is unchanged but whose profile is stale", () => {
    // The actual r1 -> r2 shape, and the one most easily got wrong: most rows
    // keep their state. If the profile were not part of the comparison they
    // would keep an r1 stamp for ever and the queue would be split across two
    // profiles with nothing recording the boundary.
    const id = seedFace({ state: "accept", profile: "route-r1" })
    const report = regradeFaces([id], { apply: true })

    assert.equal(report.unchanged, 0, "a stale profile is a change even at the same state")
    assert.equal(report.written, 1)
    assert.equal(row(id)?.route_profile, PROFILE)
    assert.deepEqual(report.transitions, { "accept -> accept": 1 })
  })

  it("leaves a row already graded under this profile completely alone", () => {
    const verdict = routeFace(signals(), CUTOFFS)
    const id = seedFace({ state: verdict.state, profile: PROFILE })
    const report = regradeFaces([id], { apply: true })

    assert.equal(report.unchanged, 1)
    assert.equal(report.written, 0)
    assert.deepEqual(report.transitions, {})
  })

  it("grades a never-graded row and calls it what it is", () => {
    const id = seedFace({ state: null, profile: null })
    const report = regradeFaces([id], { apply: true })

    assert.equal(report.written, 1)
    assert.deepEqual(report.transitions, { "ungraded -> accept": 1 })
  })

  it("leaves a row with a missing signal at whatever grade it had", () => {
    const id = seedFace({
      nullSignals: ["signal_sharpness"],
      state: "ask",
      profile: "route-r1",
    })
    const report = regradeFaces([id], { apply: true })

    assert.equal(report.ungradable, 1)
    assert.equal(report.written, 0)
    const after = row(id)
    assert.equal(after?.route_state, "ask", "the old grade survives")
    assert.equal(after?.route_profile, "route-r1", "and so does the profile that gave it")
  })

  it("NEVER touches a naming decision, however the grade moves", () => {
    // The catastrophic-and-silent failure this tool could have: a stricter
    // profile that cleared assignments would destroy the one thing here that
    // does not regenerate. The face below goes accept -> set_aside and keeps
    // its person.
    db.prepare("INSERT INTO people (display_name) VALUES ('Test Person')").run()
    const personId = Number(
      /** @type {{ id: number }} */ (db.prepare("SELECT last_insert_rowid() AS id").get()).id,
    )
    db.prepare("INSERT INTO face_identities (person_id, provenance) VALUES (?, 'confirmed')").run(
      personId,
    )
    const identityId = Number(
      /** @type {{ id: number }} */ (db.prepare("SELECT last_insert_rowid() AS id").get()).id,
    )
    const id = seedFace({ signals: { boxPx: 10 }, state: "accept", profile: "route-r1", identityId })

    regradeFaces([id], { apply: true })

    const after = row(id)
    assert.equal(after?.route_state, "set_aside")
    assert.equal(after?.face_identity_id, identityId, "the assignment survives the re-grade")
  })

  it("reports what would change without writing it, under apply:false", () => {
    const id = seedFace({ signals: { boxPx: 10 }, state: "accept", profile: "route-r1" })
    const report = regradeFaces([id], { apply: false })

    assert.deepEqual(report.transitions, { "accept -> set_aside": 1 })
    assert.equal(report.written, 0, "a dry run writes nothing")
    const after = row(id)
    assert.equal(after?.route_state, "accept")
    assert.equal(after?.route_profile, "route-r1")
  })

  it("skips a soft-deleted row even when its id is handed in", () => {
    // `facesWithSignals` filters on deleted_at, so a deleted row is simply
    // absent from the batch. It is counted in `considered` and in nothing else,
    // which is why that number is the ids asked for and not the rows seen.
    const id = seedFace({ deleted: true, state: "accept", profile: "route-r1" })
    const report = regradeFaces([id], { apply: true })

    assert.equal(report.considered, 1)
    assert.equal(report.written, 0)
    assert.equal(report.unchanged, 0)
    assert.equal(report.ungradable, 0)
    assert.equal(row(id)?.route_profile, "route-r1")
  })

  it("counts resulting states over every gradable face, not only the changed ones", () => {
    const good = seedFace({ state: "accept", profile: PROFILE })
    const bad = seedFace({ signals: { boxPx: 10 }, profile: "route-r1" })
    const report = regradeFaces([good, bad], { apply: true })

    assert.deepEqual(report.after, { accept: 1, set_aside: 1 })
  })

  it("handles more ids than one batch, without an oversized IN list", () => {
    // BATCH exists because SQLite caps bound parameters; the slicing is easy to
    // write in a way that drops the tail. 600 crosses the 500 boundary.
    const ids = []
    for (let i = 0; i < 600; i++) ids.push(seedFace({ profile: "route-r1", state: "ask" }))
    const report = regradeFaces(ids, { apply: true })

    assert.equal(report.written, 600, "every id in every batch was written")
    assert.equal(report.considered, 600)
    assert.equal(row(ids[599])?.route_profile, PROFILE, "including the last one")
  })
})
