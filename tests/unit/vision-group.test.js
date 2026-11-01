/** @file Unit test: cosine distance, average-linkage grouping, cannot-link.
 *
 *  Imports browser vision modules, so this file is excluded from the server
 *  tsconfig (see tsconfig.json).
 */

import { test } from "node:test"
import assert from "node:assert"

import {
  centroid,
  cosineDistance,
  distanceMatrix,
  groupFaces,
  groupThenAttach,
  l2Normalize,
} from "../../public/vision/group.js"

/** Pack rows into the flat DescriptorSet layout. */
function set(rows) {
  const dim = rows[0].length
  const data = new Float32Array(rows.length * dim)
  rows.forEach((row, i) => data.set(row, i * dim))
  return { dim, data }
}

/** Unit vector at `angle` in the plane, so distances are exactly computable. */
function onCircle(angle) {
  return [Math.cos(angle), Math.sin(angle), 0, 0]
}

/** Members of each group, as sorted lists, so order of groups doesn't matter. */
function shape(groups) {
  return groups.map((g) => g.members.join(",")).sort()
}

test("cosineDistance is 1 - similarity, in that direction", () => {
  const a = new Float32Array([1, 0, 0])
  const same = new Float32Array([1, 0, 0])
  const orthogonal = new Float32Array([0, 1, 0])
  const opposite = new Float32Array([-1, 0, 0])

  // The whole point of this test: a sign flip here produces a clustering that
  // runs, terminates, and is exactly backwards.
  assert.ok(Math.abs(cosineDistance(a, same)) < 1e-6, "identical -> 0")
  assert.ok(Math.abs(cosineDistance(a, orthogonal) - 1) < 1e-6, "orthogonal -> 1")
  assert.ok(Math.abs(cosineDistance(a, opposite) - 2) < 1e-6, "opposite -> 2")
})

test("cosineDistance ignores magnitude", () => {
  const a = new Float32Array([3, 4])
  const b = new Float32Array([30, 40])
  assert.ok(Math.abs(cosineDistance(a, b)) < 1e-6)
})

test("cosineDistance reads at an offset, for the packed layout", () => {
  const s = set([
    [1, 0],
    [0, 1],
  ])
  assert.ok(Math.abs(cosineDistance(s.data, s.data, 0, 2, 2) - 1) < 1e-6)
})

test("l2Normalize produces unit length, and survives a zero vector", () => {
  const v = l2Normalize(new Float32Array([3, 4]))
  assert.ok(Math.abs(Math.hypot(v[0], v[1]) - 1) < 1e-6)
  const z = l2Normalize(new Float32Array([0, 0]))
  assert.deepEqual(Array.from(z), [0, 0])
})

test("distanceMatrix is symmetric with a zero diagonal", () => {
  const s = set([onCircle(0), onCircle(0.5), onCircle(2)])
  const { n, d } = distanceMatrix(s)
  assert.equal(n, 3)
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(d[i * n + i]) < 1e-6, `diagonal ${i}`)
    for (let j = 0; j < n; j++) {
      assert.ok(Math.abs(d[i * n + j] - d[j * n + i]) < 1e-6, `symmetry ${i},${j}`)
    }
  }
})

test("groupFaces merges tight clusters and keeps distant ones apart", () => {
  // Three tight pairs, far apart from each other on the circle.
  const s = set([
    onCircle(0),
    onCircle(0.02),
    onCircle(2),
    onCircle(2.02),
    onCircle(4),
    onCircle(4.02),
  ])
  const groups = groupFaces(s, { cutoff: 0.05 })
  assert.deepEqual(shape(groups), ["0,1", "2,3", "4,5"])
})

test("a loose cutoff collapses everything; a tight one splits everything", () => {
  const s = set([onCircle(0), onCircle(0.02), onCircle(2), onCircle(2.02)])
  assert.equal(groupFaces(s, { cutoff: 2.1 }).length, 1)
  assert.equal(groupFaces(s, { cutoff: 0 }).length, 4)
})

test("groups come back largest first", () => {
  const s = set([onCircle(0), onCircle(0.01), onCircle(0.02), onCircle(3)])
  const groups = groupFaces(s, { cutoff: 0.05 })
  assert.equal(groups[0].size, 3)
  assert.equal(groups[1].size, 1)
})

test("CANNOT-LINK: two faces in one photograph never merge, however close", () => {
  // Identical descriptors — nothing but the constraint can keep them apart.
  const s = set([onCircle(0), onCircle(0)])
  const free = groupFaces(s, { cutoff: 1, photoIds: [7, 9] })
  assert.equal(free.length, 1, "different photos: merges")

  const blocked = groupFaces(s, { cutoff: 1, photoIds: [7, 7] })
  assert.equal(blocked.length, 2, "same photo: refuses")
})

test("CANNOT-LINK is transitive through merges", () => {
  // 0 and 1 are near-identical and in different photos, so they merge. 2 shares
  // a photo with 0, so it must not join the merged group even though it is just
  // as close to 1 as 1 was to 0.
  const s = set([onCircle(0), onCircle(0.01), onCircle(0.02)])
  const groups = groupFaces(s, { cutoff: 1, photoIds: [1, 2, 1] })
  const members = shape(groups)
  assert.ok(
    !members.includes("0,1,2"),
    `constraint should have survived the merge, got ${members.join(" | ")}`,
  )
  for (const g of groups) {
    assert.ok(!(g.members.includes(0) && g.members.includes(2)), "0 and 2 share a photo")
  }
})

test("cannot-link can be turned off", () => {
  const s = set([onCircle(0), onCircle(0)])
  const groups = groupFaces(s, { cutoff: 1, photoIds: [7, 7], cannotLinkWithinPhoto: false })
  assert.equal(groups.length, 1)
})

test("average linkage does not chain the way a thresholded graph would", () => {
  // A ladder of points each 0.6 rad from the next. Single-linkage or a
  // connected-components pass at this cutoff would weld the whole chain into one
  // group; average linkage must not, because the ends are far apart.
  const s = set([onCircle(0), onCircle(0.6), onCircle(1.2), onCircle(1.8), onCircle(2.4)])
  const step = cosineDistance(s.data, s.data, 0, 4, 4)
  const groups = groupFaces(s, { cutoff: step * 1.05 })
  assert.ok(groups.length > 1, `chained into ${groups.length} group(s)`)
})

test("groupFaces validates the photo id list against the descriptor count", () => {
  const s = set([onCircle(0), onCircle(1)])
  assert.throws(() => groupFaces(s, { cutoff: 0.5, photoIds: [1] }), /photo ids/)
})

test("centroid is the re-normalised mean", () => {
  const s = set([
    [1, 0, 0, 0],
    [0, 1, 0, 0],
  ])
  const c = centroid(s, [0, 1])
  assert.ok(Math.abs(c[0] - Math.SQRT1_2) < 1e-6)
  assert.ok(Math.abs(c[1] - Math.SQRT1_2) < 1e-6)
  assert.ok(Math.abs(Math.hypot(c[0], c[1], c[2], c[3]) - 1) < 1e-6, "unit length")
})

test("grouping a few hundred descriptors stays quick", () => {
  // Not a benchmark — a guard that the O(n^2) matrix and the cached-best merge
  // loop have not quietly become O(n^3) in wall-clock terms.
  const rows = []
  for (let person = 0; person < 40; person++) {
    for (let shot = 0; shot < 10; shot++) {
      rows.push(onCircle(person * 0.15 + shot * 0.001))
    }
  }
  const started = Date.now()
  const groups = groupFaces(set(rows), { cutoff: 0.01 })
  assert.ok(Date.now() - started < 5000, "400 descriptors should not take seconds")
  assert.ok(groups.length >= 30 && groups.length <= 50, `got ${groups.length} groups`)
})

// --- groupThenAttach ---------------------------------------------------------
// On the unit circle the cosine distance at angle θ is 1 - cos θ, so 0.55 sits
// near 63°. A at 0° and B at 70° are two people (0.66 apart). J at 30° is junk
// close to both, which is exactly the face that chained people together.

const DEG = Math.PI / 180

test("groupFaces lets a junk face in the middle chain two people together", () => {
  // The failure groupThenAttach exists to prevent, pinned so the fixture stays honest.
  const s = set([onCircle(0), onCircle(30 * DEG), onCircle(70 * DEG)])
  assert.deepEqual(shape(groupFaces(s, { cutoff: 0.55, photoIds: [1, 2, 3] })), ["0,1,2"])
})

test("groupThenAttach: a non-seed face joins a group but never bridges two", () => {
  const s = set([onCircle(0), onCircle(30 * DEG), onCircle(70 * DEG)])
  const groups = groupThenAttach(s, [true, false, true], { cutoff: 0.55, photoIds: [1, 2, 3] })
  assert.deepEqual(shape(groups), ["0,1", "2"])
  const withJunk = groups.find((g) => g.members.includes(1))
  assert.deepEqual(withJunk?.seeds, [0])
  assert.deepEqual(withJunk?.attached, [1])
  assert.equal(withJunk?.size, 2)
})

test("groupThenAttach: a non-seed face far from every group attaches nowhere", () => {
  const s = set([onCircle(0), onCircle(150 * DEG)])
  const groups = groupThenAttach(s, [true, false], { cutoff: 0.55, photoIds: [1, 2] })
  assert.deepEqual(shape(groups), ["0"])
})

test("groupThenAttach: never attaches into a group holding a face from the same photo", () => {
  // J is nearest A, but shares A's photograph, so it goes to B (still in range).
  const s = set([onCircle(0), onCircle(30 * DEG), onCircle(75 * DEG)])
  const groups = groupThenAttach(s, [true, false, true], { cutoff: 0.55, photoIds: [1, 1, 3] })
  assert.deepEqual(shape(groups), ["0", "1,2"])
})

test("groupThenAttach: two non-seeds from one photo cannot both join one group", () => {
  const s = set([onCircle(0), onCircle(10 * DEG), onCircle(-10 * DEG)])
  const groups = groupThenAttach(s, [true, false, false], { cutoff: 0.55, photoIds: [1, 2, 2] })
  assert.equal(groups.length, 1)
  assert.equal(groups[0].attached.length, 1)
})

test("groupThenAttach with every face a seed is groupFaces", () => {
  const rows = [0, 5, 10, 80, 85, 170].map((a) => onCircle(a * DEG))
  const photoIds = [1, 2, 3, 4, 5, 6]
  assert.deepEqual(
    shape(groupThenAttach(set(rows), rows.map(() => true), { cutoff: 0.55, photoIds })),
    shape(groupFaces(set(rows), { cutoff: 0.55, photoIds })),
  )
})
