/** @file Unit test: per-person prototypes and per-photo joint assignment.
 *
 *  All descriptors here are hand-built unit vectors on a circle (2-D, so the
 *  numbers are checkable by hand) — never real descriptors, per CLAUDE.md's
 *  photograph rule. That rule is about photographs of real people; nothing
 *  here is that.
 *
 *  Imports browser vision modules, so this file is excluded from the server
 *  tsconfig (see tsconfig.json).
 */

import { test } from "node:test"
import assert from "node:assert"

import { assignPhoto, buildPrototypes, matchFace, confidentMatch } from "../../public/vision/assign.js"
import { cosineDistance } from "../../public/vision/group.js"

/** @param {number} angle */
function onCircle(angle) {
  return new Float32Array([Math.cos(angle), Math.sin(angle)])
}

function set(rows) {
  const dim = rows[0].length
  const data = new Float32Array(rows.length * dim)
  rows.forEach((row, i) => data.set(row, i * dim))
  return { dim, data }
}

// --- buildPrototypes ---------------------------------------------------------

test("buildPrototypes: one centroid per confirmed label, unconfirmed rows excluded", () => {
  const s = set([onCircle(0), onCircle(0.02), onCircle(2), onCircle(2.02), onCircle(1)])
  const protos = buildPrototypes(s, ["a", "a", "b", "b", null])
  assert.equal(protos.length, 2)
  assert.deepEqual(
    protos.map((p) => p.label),
    ["a", "b"],
  )
  // Each centroid should sit close to its own cluster's angle.
  const a = protos.find((p) => p.label === "a")
  const near0 = Math.hypot(a.vector[0] - Math.cos(0.01), a.vector[1] - Math.sin(0.01))
  assert.ok(near0 < 0.05, `centroid a drifted: ${a.vector}`)
})

test("buildPrototypes: nobody confirmed yields no prototypes", () => {
  const s = set([onCircle(0), onCircle(1)])
  assert.deepEqual(buildPrototypes(s, [null, null]), [])
})

// --- matchFace ---------------------------------------------------------------

test("matchFace: zero prototypes gives no best and an unranked (NaN) margin", () => {
  const r = matchFace(onCircle(0), [])
  assert.equal(r.candidates.length, 0)
  assert.equal(r.best, null)
  assert.ok(Number.isNaN(r.margin))
})

test("matchFace: exactly one prototype gives Infinity margin — no competitor", () => {
  const proto = { label: "a", vector: onCircle(0) }
  const r = matchFace(onCircle(3), [proto]) // a bad match, distance-wise
  assert.equal(r.best.label, "a")
  assert.equal(r.margin, Infinity)
  // The margin says nothing about whether this is a GOOD match.
  assert.ok(r.best.distance > 1, `expected a poor match, got distance ${r.best.distance}`)
})

test("matchFace: margin is second-best minus best, always >= 0", () => {
  const protos = [
    { label: "near", vector: onCircle(0) },
    { label: "far", vector: onCircle(2) },
  ]
  const r = matchFace(onCircle(0.05), protos)
  assert.equal(r.best.label, "near")
  assert.ok(r.margin > 0, `expected a confident positive margin, got ${r.margin}`)
  assert.ok(
    Math.abs(r.margin - (r.candidates[1].distance - r.candidates[0].distance)) < 1e-9,
    "margin must equal second-best distance minus best distance",
  )
})

test("matchFace: a genuine tie gives margin 0, not a negative number", () => {
  // Two prototypes equidistant from the query.
  const protos = [
    { label: "left", vector: onCircle(-0.5) },
    { label: "right", vector: onCircle(0.5) },
  ]
  const r = matchFace(onCircle(0), protos)
  assert.ok(Math.abs(r.margin) < 1e-9, `expected ~0 margin, got ${r.margin}`)
})

// --- assignPhoto: abstaining ---------------------------------------------------

test("assignPhoto: a face with no good candidate abstains rather than force-matching", () => {
  const proto = { label: "a", vector: onCircle(0) }
  // Far from the only prototype — cosine distance for antipodal unit vectors is 2.
  const faces = [onCircle(Math.PI)]
  const result = assignPhoto(faces, [proto], { abstainCost: 0.5, sameFaceSuspicionCutoff: 0.05 })
  assert.equal(result.suspicious, false)
  assert.equal(result.assignments.length, 1)
  assert.equal(result.assignments[0].label, null)
  assert.equal(result.assignments[0].distance, null)
  assert.ok(Math.abs(result.totalCost - 0.5) < 1e-9)
})

test("assignPhoto: two faces, one prototype — the better match wins it, the other abstains", () => {
  const proto = { label: "a", vector: onCircle(0) }
  const faces = [onCircle(0.02), onCircle(3)] // face 0 close, face 1 far
  const result = assignPhoto(faces, [proto], { abstainCost: 0.3, sameFaceSuspicionCutoff: 0.05 })
  assert.equal(result.suspicious, false)
  const byIndex = new Map(result.assignments.map((a) => [a.faceIndex, a]))
  assert.equal(byIndex.get(0).label, "a")
  assert.equal(byIndex.get(1).label, null)
})

test("assignPhoto: zero faces is a trivial success, not an error", () => {
  const result = assignPhoto([], [], { abstainCost: 0.3, sameFaceSuspicionCutoff: 0.05 })
  assert.deepEqual(result.assignments, [])
  assert.equal(result.suspicious, false)
  assert.equal(result.totalCost, 0)
})

// --- assignPhoto: twins/mirror guard -------------------------------------------

test("assignPhoto: near-identical faces in one photo are flagged, not force-split", () => {
  const protoA = { label: "a", vector: onCircle(0) }
  const protoB = { label: "b", vector: onCircle(2) }
  // Two faces that are nearly identical to EACH OTHER — same-face-in-frame or
  // true look-alikes, either way not a case to force apart.
  const faces = [onCircle(1), onCircle(1.01)]
  const result = assignPhoto(faces, [protoA, protoB], {
    abstainCost: 0.3,
    sameFaceSuspicionCutoff: 0.05,
  })
  assert.equal(result.suspicious, true)
  assert.equal(result.suspiciousPairs.length, 1)
  assert.deepEqual(result.suspiciousPairs[0], [0, 1])
  assert.equal(result.totalCost, null)
  for (const a of result.assignments) assert.equal(a.label, null)
})

test("assignPhoto: faces that are merely similar (above the cutoff) are not flagged", () => {
  const protoA = { label: "a", vector: onCircle(0) }
  const protoB = { label: "b", vector: onCircle(2) }
  const faces = [onCircle(0), onCircle(2)] // as far apart as the two prototypes
  const result = assignPhoto(faces, [protoA, protoB], {
    abstainCost: 0.3,
    sameFaceSuspicionCutoff: 0.05,
  })
  assert.equal(result.suspicious, false)
})

// --- assignPhoto: exact search (k <= 8) ----------------------------------------

test("assignPhoto: k=3 exact assignment matches a hand brute-forced expectation", () => {
  // Three faces, three prototypes, costs rigged so the naive "each face takes
  // its own nearest prototype" greedy choice is NOT the jointly optimal one:
  // face 0's nearest is proto Y (shared contention with face 1), but the
  // globally cheapest total comes from giving Y to face 1 and X to face 0.
  const protoX = { label: "x", vector: onCircle(0) }
  const protoY = { label: "y", vector: onCircle(0.1) }
  const protoZ = { label: "z", vector: onCircle(Math.PI) }

  const face0 = onCircle(0.05) // close to both X and Y, very slightly closer to Y
  const face1 = onCircle(0.09) // very close to Y, meaningfully farther from X
  const face2 = onCircle(Math.PI - 0.01) // close to Z

  const prototypes = [protoX, protoY, protoZ]
  const faces = [face0, face1, face2]

  // Brute force every bijection-with-abstain by hand, using the same cost
  // function the implementation uses, as the independent expectation.
  const abstainCost = 0.5
  const cost = faces.map((f) => prototypes.map((p) => cosineDistance(f, p.vector)))

  /** @param {number[]} arr */
  function permutations(arr) {
    if (arr.length <= 1) return [arr]
    /** @type {number[][]} */
    const out = []
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1))
      for (const p of permutations(rest)) out.push([arr[i], ...p])
    }
    return out
  }

  const ABSTAIN = -1
  const slots = [0, 1, 2] // 3 prototypes, 3 faces, no padding needed
  let expectedBest = Infinity
  for (const perm of permutations(slots)) {
    let total = 0
    for (let i = 0; i < 3; i++) total += cost[i][perm[i]]
    if (total < expectedBest) expectedBest = total
  }
  // Also consider assignments that abstain some faces instead of using all 3 prototypes.
  for (let mask = 0; mask < 8; mask++) {
    const usedFaces = [0, 1, 2].filter((i) => (mask & (1 << i)) !== 0)
    if (usedFaces.length === 0) continue
    for (const perm of permutations(slots.slice(0, usedFaces.length))) {
      let total = 0
      const usedProtoSet = new Set()
      usedFaces.forEach((face, idx) => {
        total += cost[face][perm[idx]]
        usedProtoSet.add(perm[idx])
      })
      // Skip combinations that reuse a prototype index across a differently-sized subset choice.
      if (usedProtoSet.size !== usedFaces.length) continue
      for (const face of [0, 1, 2]) if (!usedFaces.includes(face)) total += abstainCost
      if (total < expectedBest) expectedBest = total
    }
  }

  // face0/face1 are deliberately close (that's the contention this test is
  // about) but not the twins case — the cutoff sits below their actual
  // mutual distance so the suspicion guard does not fire here.
  const result = assignPhoto(faces, prototypes, { abstainCost, sameFaceSuspicionCutoff: 0.0001 })
  assert.equal(result.suspicious, false)
  assert.ok(Math.abs(result.totalCost - expectedBest) < 1e-6, `got ${result.totalCost}, expected ${expectedBest}`)
})

test("assignPhoto: restricts exact search to k closest prototypes when there are more prototypes than faces", () => {
  // 1 face, 3 prototypes far apart — only the closest one is ever relevant.
  const near = { label: "near", vector: onCircle(0) }
  const mid = { label: "mid", vector: onCircle(1.5) }
  const far = { label: "far", vector: onCircle(3) }
  const result = assignPhoto([onCircle(0.01)], [far, mid, near], {
    abstainCost: 0.5,
    sameFaceSuspicionCutoff: 0.05,
  })
  assert.equal(result.assignments[0].label, "near")
})

test("confidentMatch: offers the best only when it is close enough and clearly ahead", () => {
  const bar = { maxDistance: 0.64, minMargin: 0.05 }
  const cand = (/** @type {string} */ label, /** @type {number} */ distance) => ({ label, distance })
  // Close and clearly ahead -> offered.
  const good = { candidates: [cand("a", 0.2), cand("b", 0.5)], best: cand("a", 0.2), margin: 0.3 }
  assert.deepStrictEqual(confidentMatch(good, bar), cand("a", 0.2))
  // Nearest prototype but far away -> abstain. This is the group the
  // recogniser cannot place, which used to arrive with a wrong name on it.
  const far = { candidates: [cand("a", 0.9), cand("b", 1.1)], best: cand("a", 0.9), margin: 0.2 }
  assert.strictEqual(confidentMatch(far, bar), null)
  // Close, but a near-tie with the runner-up -> abstain.
  const tie = { candidates: [cand("a", 0.3), cand("b", 0.32)], best: cand("a", 0.3), margin: 0.02 }
  assert.strictEqual(confidentMatch(tie, bar), null)
  // Unopposed (one prototype, margin Infinity): the distance bar decides alone.
  assert.ok(confidentMatch({ candidates: [cand("a", 0.3)], best: cand("a", 0.3), margin: Infinity }, bar))
  assert.strictEqual(
    confidentMatch({ candidates: [cand("a", 0.8)], best: cand("a", 0.8), margin: Infinity }, bar),
    null,
  )
  // Nothing to rank, or a NaN anywhere -> abstain, never pass.
  assert.strictEqual(confidentMatch({ candidates: [], best: null, margin: NaN }, bar), null)
  assert.strictEqual(confidentMatch({ candidates: [cand("a", NaN)], best: cand("a", NaN), margin: 1 }, bar), null)
})

test("confidentMatch over real matchFace output: orthogonal person abstains, same person passes", () => {
  const bar = { maxDistance: 0.64, minMargin: 0.05 }
  const prototypes = [{ label: "A", vector: Float32Array.from([1, 0, 0, 0]) }]
  const sameish = matchFace(Float32Array.from([1, 0.05, 0, 0]), prototypes)
  assert.strictEqual(confidentMatch(sameish, bar)?.label, "A")
  const other = matchFace(Float32Array.from([0, 1, 0, 0]), prototypes)
  assert.strictEqual(other.best?.label, "A", "matchFace itself always names someone")
  assert.strictEqual(confidentMatch(other, bar), null)
})
