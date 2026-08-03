/**
 * @file The routing columns and the queries that read them (plan §8).
 *
 * Two things here are load-bearing beyond ordinary CRUD.
 *
 * **`route_state IS NULL` is a state the code must handle, not one it may
 * drop.** Every `media_faces` row written before the `add_face_routing`
 * migration has it, and so will any future write path that forgets to grade.
 * A query that filters on `route_state` and quietly loses those rows is D8
 * again in a new costume — a number that looks complete and is not.
 *
 * **The signal columns are finally read by something.** D8 was that
 * `media_faces` had carried nine `signal_*` columns since it was created and no
 * query in db/media-faces.js selected one. `facesWithSignals` is the function
 * that closes it, so it is tested for actually returning them.
 */

import { describe, it, before, beforeEach, after } from "node:test"
import assert from "node:assert"

import { init, close, getDb } from "../../../db/connection.js"
import {
  insertFace,
  getFaceById,
  facesWithSignals,
  routeStatesOf,
  setFaceRoute,
  routeStateCounts,
  unidentifiedFacesWithDescriptors,
  descriptorToBlob,
} from "../../../db/media-faces.js"
import { PROFILE } from "../../../public/vision/route.js"

let fileKeySeq = 0

/** @returns {number} */
function makeMedia() {
  fileKeySeq++
  return Number(
    getDb()
      .prepare(`INSERT INTO media (file_key, kind, section, status) VALUES (?, 'image', 'guest', 'approved')`)
      .run(`routekey${fileKeySeq}`).lastInsertRowid,
  )
}

const SIGNALS = {
  score: 0.91,
  boxPx: 128,
  borderPx: 11,
  eyeRatio: 0.38,
  eyeAngle: 0.02,
  alignScale: 0.7,
  residual: 1.4,
  outsideFraction: 0,
  sharpness: 0.05,
}

/** @param {{ route?: { state: string, reason: string | null, profile: string } | null, withDescriptor?: boolean }} [opts] */
function makeFace(opts = {}) {
  return insertFace({
    mediaId: makeMedia(),
    bbox: { x: 1, y: 2, w: 100, h: 120 },
    landmarks: null,
    signals: SIGNALS,
    descriptor: opts.withDescriptor ? descriptorToBlob(Float32Array.from([1, 0, 0, 0])) : null,
    modelVersion: "test-v1",
    source: "cli",
    route: /** @type {any} */ (opts.route ?? null),
  })
}

function clearData() {
  const db = getDb()
  db.prepare("DELETE FROM media_faces").run()
  db.prepare("DELETE FROM media").run()
}

describe("media_faces quality routing", () => {
  before(() => init())
  beforeEach(() => clearData())
  after(() => {
    clearData()
    close()
  })

  it("a face inserted without a grade is ungraded, not defaulted into a state", () => {
    const face = makeFace()
    assert.strictEqual(face.route_state, null)
    assert.strictEqual(face.route_reason, null)
    assert.strictEqual(face.route_profile, null)
  })

  it("insertFace persists a grade when the caller has one", () => {
    const face = makeFace({ route: { state: "ask", reason: "boxPx", profile: PROFILE } })
    assert.strictEqual(face.route_state, "ask")
    assert.strictEqual(face.route_reason, "boxPx")
    assert.strictEqual(face.route_profile, PROFILE)
  })

  it("setFaceRoute records the grade AND the profile it was computed under", () => {
    // The profile is the point: without it, revising a cutoff silently
    // re-means every stored grade and you cannot tell which table an old row
    // was judged by.
    const face = makeFace()
    assert.strictEqual(setFaceRoute(face.id, { state: "accept", reason: null, profile: PROFILE }), true)

    const after = getFaceById(face.id)
    assert.strictEqual(after?.route_state, "accept")
    assert.strictEqual(after?.route_profile, PROFILE)
  })

  it("setFaceRoute re-grades, so a profile revision is an explicit sweep", () => {
    const face = makeFace({ route: { state: "ask", reason: "sharpness", profile: "route-r0" } })
    setFaceRoute(face.id, { state: "accept", reason: null, profile: "route-r1" })

    const after = getFaceById(face.id)
    assert.strictEqual(after?.route_state, "accept")
    assert.strictEqual(after?.route_reason, null)
    assert.strictEqual(after?.route_profile, "route-r1")
  })

  it("setFaceRoute will not grade a soft-deleted row", () => {
    const face = makeFace()
    getDb().prepare(`UPDATE media_faces SET deleted_at = '2026-01-01' WHERE id = ?`).run(face.id)
    assert.strictEqual(setFaceRoute(face.id, { state: "accept", reason: null, profile: PROFILE }), false)
  })

  it("setFaceRoute reports false for a face that does not exist", () => {
    assert.strictEqual(setFaceRoute(999999, { state: "accept", reason: null, profile: PROFILE }), false)
  })

  // --- The signal columns, finally read (D8) ---------------------------------

  it("facesWithSignals returns all nine signals and the routing grade", () => {
    const face = makeFace({ route: { state: "ask", reason: "boxPx", profile: PROFILE } })
    const [row] = facesWithSignals([face.id])

    assert.strictEqual(row.signal_score, SIGNALS.score)
    assert.strictEqual(row.signal_boxPx, SIGNALS.boxPx)
    assert.strictEqual(row.signal_borderPx, SIGNALS.borderPx)
    assert.strictEqual(row.signal_eyeRatio, SIGNALS.eyeRatio)
    assert.strictEqual(row.signal_eyeAngle, SIGNALS.eyeAngle)
    assert.strictEqual(row.signal_alignScale, SIGNALS.alignScale)
    assert.strictEqual(row.signal_residual, SIGNALS.residual)
    assert.strictEqual(row.signal_outsideFraction, SIGNALS.outsideFraction)
    assert.strictEqual(row.signal_sharpness, SIGNALS.sharpness)
    assert.strictEqual(row.route_state, "ask")
    assert.strictEqual(row.route_reason, "boxPx")
  })

  it("facesWithSignals never carries a descriptor — this shape goes to the UI", () => {
    const face = makeFace({ withDescriptor: true })
    const [row] = facesWithSignals([face.id])
    assert.ok(!("descriptor" in row), "a biometric vector must not ride along")
  })

  it("facesWithSignals skips soft-deleted rows and touches nothing on empty input", () => {
    const live = makeFace()
    const gone = makeFace()
    getDb().prepare(`UPDATE media_faces SET deleted_at = '2026-01-01' WHERE id = ?`).run(gone.id)

    assert.deepStrictEqual(
      facesWithSignals([live.id, gone.id]).map((r) => r.id),
      [live.id],
    )
    assert.deepStrictEqual(facesWithSignals([]), [])
  })

  // --- routeStatesOf: three outcomes, not two --------------------------------

  it("routeStatesOf distinguishes graded, ungraded and not-a-live-row", () => {
    // The distinction the bulk-assign check depends on. "set aside" and "that
    // id is not a face" want different errors, and a Map defaulted to null
    // could not tell them apart.
    const graded = makeFace({ route: { state: "set_aside", reason: "sharpness", profile: PROFILE } })
    const ungraded = makeFace()
    const deleted = makeFace()
    getDb().prepare(`UPDATE media_faces SET deleted_at = '2026-01-01' WHERE id = ?`).run(deleted.id)

    const states = routeStatesOf([graded.id, ungraded.id, deleted.id, 999999])
    assert.strictEqual(states.get(graded.id), "set_aside")
    assert.strictEqual(states.get(ungraded.id), null)
    assert.ok(states.has(ungraded.id), "ungraded is PRESENT with a null value")
    assert.ok(!states.has(deleted.id), "a soft-deleted row is not a live face")
    assert.ok(!states.has(999999), "a missing row is absent, not null")
  })

  it("routeStatesOf on empty input returns an empty map", () => {
    assert.strictEqual(routeStatesOf([]).size, 0)
  })

  // --- Counts ---------------------------------------------------------------

  it("routeStateCounts counts ungraded as its own bucket", () => {
    makeFace({ route: { state: "accept", reason: null, profile: PROFILE } })
    makeFace({ route: { state: "accept", reason: null, profile: PROFILE } })
    makeFace({ route: { state: "ask", reason: "boxPx", profile: PROFILE } })
    makeFace({ route: { state: "set_aside", reason: "sharpness", profile: PROFILE } })
    makeFace()
    makeFace()

    assert.deepStrictEqual(routeStateCounts(), { accept: 2, ask: 1, setAside: 1, ungraded: 2 })
  })

  it("routeStateCounts reads back as zeroes on an empty table, not SQLite's NULLs", () => {
    assert.deepStrictEqual(routeStateCounts(), { accept: 0, ask: 0, setAside: 0, ungraded: 0 })
  })

  it("routeStateCounts ignores soft-deleted rows", () => {
    const gone = makeFace({ route: { state: "accept", reason: null, profile: PROFILE } })
    getDb().prepare(`UPDATE media_faces SET deleted_at = '2026-01-01' WHERE id = ?`).run(gone.id)
    assert.deepStrictEqual(routeStateCounts(), { accept: 0, ask: 0, setAside: 0, ungraded: 0 })
  })

  // --- Routing filters the display, never the clustering ---------------------

  it("unidentifiedFacesWithDescriptors returns set-aside faces, and says so", () => {
    // The rule this whole phase turns on. A poor-quality face inside an
    // otherwise clean cluster still constrains that cluster and still occupies
    // its photograph; dropping it HERE would change the group composition and
    // the suggestion order for the faces that ARE worth naming. The filter
    // belongs at the display, one layer up.
    const shown = makeFace({ withDescriptor: true, route: { state: "accept", reason: null, profile: PROFILE } })
    const hidden = makeFace({ withDescriptor: true, route: { state: "set_aside", reason: "boxPx", profile: PROFILE } })
    const ungraded = makeFace({ withDescriptor: true })

    const rows = unidentifiedFacesWithDescriptors()
    const ids = rows.map((r) => r.id).sort((a, b) => a - b)
    assert.deepStrictEqual(ids, [shown.id, hidden.id, ungraded.id].sort((a, b) => a - b))

    // ...and it carries the state, so the layer above CAN filter.
    const byId = new Map(rows.map((r) => [r.id, r]))
    assert.strictEqual(byId.get(hidden.id)?.route_state, "set_aside")
    assert.strictEqual(byId.get(hidden.id)?.route_reason, "boxPx")
    assert.strictEqual(byId.get(ungraded.id)?.route_state, null)
  })

  // --- The database is the enforcement --------------------------------------

  it("the trigger refuses a route_state outside the vocabulary", () => {
    const media = makeMedia()
    assert.throws(
      () =>
        getDb()
          .prepare(
            `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, source, route_state)
             VALUES (?, 0, 0, 10, 10, 'v', 'cli', 'probably')`,
          )
          .run(media),
      /route_state/,
    )
  })

  it("the trigger refuses a bad route_state on UPDATE too, not only INSERT", () => {
    const face = makeFace()
    assert.throws(
      () => getDb().prepare(`UPDATE media_faces SET route_state = 'nope' WHERE id = ?`).run(face.id),
      /route_state/,
    )
  })

  it("the trigger permits NULL, because ungraded is legitimate", () => {
    const face = makeFace({ route: { state: "accept", reason: null, profile: PROFILE } })
    getDb().prepare(`UPDATE media_faces SET route_state = NULL WHERE id = ?`).run(face.id)
    assert.strictEqual(getFaceById(face.id)?.route_state, null)
  })

  it("the migration added all three columns", () => {
    const cols = new Set(
      /** @type {Array<{ name: string }>} */ (
        getDb().prepare("PRAGMA table_info(media_faces)").all()
      ).map((c) => c.name),
    )
    for (const col of ["route_state", "route_reason", "route_profile"]) {
      assert.ok(cols.has(col), `media_faces is missing ${col}`)
    }
  })

  it("the migration did not rebuild the table, so D1 was never in play", () => {
    // add_face_routing is three ALTER TABLE ADD COLUMNs. If it ever becomes a
    // rebuild, this is the reminder that DROP TABLE fires
    // media_faces.face_identity_id's ON DELETE SET NULL across the whole
    // database, silently, and needs rebuildTable's pragma dance.
    const sql = /** @type {{ sql: string } | undefined} */ (
      getDb()
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'media_faces'")
        .get()
    )?.sql
    assert.ok(sql?.includes("route_state"), "the column is on the original table, not a copy of it")
    assert.strictEqual(
      /** @type {Array<unknown>} */ (getDb().prepare("PRAGMA foreign_key_check").all()).length,
      0,
    )
  })
})
