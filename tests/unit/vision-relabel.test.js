/** @file Unit test: relabel-data.js's pool-A GROWTH path.
 *
 *  Everything here is synthetic faces (no photograph, no real descriptor, no
 *  crop ever decoded) and exercises `growAssignments`/`carryAssignments`
 *  directly — no run directory, no label-data.js file on disk.
 *
 *  What matters here, from SESSION-2-vision.md §7 P0: `assignPools` shuffles
 *  face POSITIONS keyed only by seed and face order, then takes a prefix of
 *  it, so the same seed over the same faces makes a larger pool A a strict
 *  superset of a smaller one. `growAssignments` is built to VERIFY that
 *  superset on every call rather than trust it, and to leave everything else
 *  — carried pool, carried group ids, presentation order — untouched.
 */

/** @import * as Types from '../../scripts/vision/types.js' */

import assert from "node:assert/strict"
import { test } from "node:test"

import { assignPools } from "../../scripts/vision/session1.js"
import { carryAssignments, growAssignments } from "../../scripts/vision/relabel-data.js"

/**
 * A minimal but fully-typed Session1FaceRecord. Only `id`, `crop` and
 * `photoId` are ever read by anything under test here; the rest exists so the
 * fixture satisfies the real type `growAssignments`/`carryAssignments` take.
 * @param {number} id
 * @returns {Types.Session1FaceRecord}
 */
function face(id) {
  return {
    id,
    photoId: id,
    crop: `crops/${String(id).padStart(6, "0")}.png`,
    score: 0.9,
    box: { x: 0, y: 0, w: 100, h: 100 },
    landmarks: [10, 10, 20, 10, 15, 15, 10, 20, 20, 20],
    signals: {
      score: 0.9,
      boxPx: 100,
      borderPx: 30,
      eyeRatio: 0.35,
      eyeAngle: 0.01,
      alignScale: 0.8,
      residual: 1.2,
      outsideFraction: 0,
      sharpness: 0.02,
    },
    descriptor: [1, 0],
  }
}

/** @param {number} n @returns {Types.Session1FaceRecord[]} */
function faces(n) {
  return Array.from({ length: n }, (_v, i) => face(i))
}

/** @param {number} seed @returns {Types.Session1Timing} */
function timingWithSeed(seed) {
  return {
    photos: 1,
    faces: 1,
    stages: {},
    environment: {},
    config: { shuffleSeed: seed },
  }
}

// ---------------------------------------------------------------------------

test("growAssignments promotes exactly the delta and carries everything else verbatim", () => {
  const all = faces(60)
  const seed = 42
  // Two of the pool-B faces are grouped by the model; the rest are singletons.
  const before = assignPools(all, {
    poolASize: 10,
    seed,
    groupPoolB: (poolB) => poolB.map((_f, i) => (i < 2 ? 0 : null)),
  })

  const grown = growAssignments(all, before, timingWithSeed(seed), 20)

  const oldPoolA = new Set(before.faces.filter((f) => f.pool === "A").map((f) => f.id))
  /** @type {Set<number>} */
  const newPoolA = new Set()
  for (const [id, assigned] of grown.pools) if (assigned.pool === "A") newPoolA.add(id)

  assert.equal(oldPoolA.size, 10)
  assert.equal(newPoolA.size, 20)
  for (const id of oldPoolA) assert.ok(newPoolA.has(id), `face ${id} was pool A before and is not now`)

  // Promoted is exactly newPoolA minus oldPoolA.
  assert.equal(grown.promoted.length, 10)
  const promotedSet = new Set(grown.promoted)
  for (const id of newPoolA) assert.equal(promotedSet.has(id), !oldPoolA.has(id))
  for (const id of grown.promoted) {
    assert.equal(grown.pools.get(id)?.pool, "A")
    assert.equal(grown.pools.get(id)?.group, null, "a promoted face carries no group")
  }

  // Every face that was NOT promoted keeps its OLD pool and OLD group id,
  // untouched — including the two faces the model grouped together.
  for (const record of before.faces) {
    if (promotedSet.has(record.id)) continue
    assert.deepEqual(grown.pools.get(record.id), { pool: record.pool, group: record.group })
  }

  // Presentation order is carried verbatim, not re-derived.
  assert.deepEqual(grown.order, before.order)
})

test("group ids for faces that remain pool B are carried verbatim, not renumbered", () => {
  const all = faces(60)
  const seed = 42

  // Learn (from assignPools itself) which two faces will still be pool B
  // after growth, so the group can be pinned to faces guaranteed to survive
  // as pool B rather than guessed at.
  const afterPoolA = new Set(
    assignPools(all, { poolASize: 20, seed }).faces.filter((f) => f.pool === "A").map((f) => f.id),
  )
  const remainB = all.map((f) => f.id).filter((id) => !afterPoolA.has(id))
  const [gid1, gid2] = remainB.slice(0, 2)

  const before = assignPools(all, {
    poolASize: 10,
    seed,
    groupPoolB: (poolB) => poolB.map((f) => (f.id === gid1 || f.id === gid2 ? 0 : null)),
  })

  const grown = growAssignments(all, before, timingWithSeed(seed), 20)

  assert.equal(grown.pools.get(gid1)?.pool, "B")
  assert.equal(grown.pools.get(gid1)?.group, 0)
  assert.equal(grown.pools.get(gid2)?.pool, "B")
  assert.equal(grown.pools.get(gid2)?.group, 0)
})

test("a recorded seed that does not reproduce the file's existing pools is refused", () => {
  const all = faces(60)
  const before = assignPools(all, { poolASize: 10, seed: 42 })

  assert.throws(
    () => growAssignments(all, before, timingWithSeed(1), 20),
    (err) =>
      err instanceof Error &&
      err.message.includes("different runs") &&
      err.message.includes("pool A"),
  )
})

test("shrinking pool A is refused", () => {
  const all = faces(60)
  const seed = 42
  const before = assignPools(all, { poolASize: 20, seed })

  assert.throws(
    () => growAssignments(all, before, timingWithSeed(seed), 10),
    (err) => err instanceof Error && err.message.includes("smaller"),
  )
})

test("--pool-a larger than the face count is refused", () => {
  const all = faces(10)
  const seed = 42
  const before = assignPools(all, { poolASize: 5, seed })

  assert.throws(
    () => growAssignments(all, before, timingWithSeed(seed), 11),
    (err) => err instanceof Error && err.message.includes("exceeds"),
  )
})

test("carryAssignments still refuses a face missing from the previous file (unchanged by growth)", () => {
  const all = faces(10)
  const before = assignPools(faces(9), { poolASize: 3, seed: 42 })
  assert.throws(
    () => carryAssignments(all, before),
    (err) => err instanceof Error && err.message.includes("different runs"),
  )
})
