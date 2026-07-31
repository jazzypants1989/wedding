/** @file Unit test: must-link propagation across near-duplicate frames.
 *
 *  Every descriptor here is a hand-built 2-D unit vector on a circle and every
 *  box is a hand-written rectangle — nothing in this file came from a
 *  photograph, per CLAUDE.md's photograph rule.
 *
 *  The four rules of must-link.js each get a test that FAILS the propagation,
 *  because the failure direction is the one that matters: a rule that silently
 *  stops rejecting still passes any test that only checks the happy path.
 *
 *  Imports browser vision modules, so this file is excluded from the server
 *  tsconfig (see tsconfig.json).
 */

import { test } from "node:test"
import assert from "node:assert"

import { propagateWithinFrames } from "../../public/vision/must-link.js"

/** @param {number} angle */
function onCircle(angle) {
  return new Float32Array([Math.cos(angle), Math.sin(angle)])
}

/** @param {Float32Array[]} rows */
function set(rows) {
  const dim = rows.length > 0 ? rows[0].length : 2
  const data = new Float32Array(rows.length * dim)
  rows.forEach((row, i) => data.set(row, i * dim))
  return { dim, data }
}

/** Generous defaults; individual tests tighten whichever knob they are about. */
const OPTIONS = { minIou: 0.5, iouMargin: 0.2, corroborationCutoff: 0.64 }

/**
 * @param {object} spec
 * @param {number} spec.faceId
 * @param {number} spec.photoId
 * @param {import('../../public/vision/types.js').FaceBox} spec.box
 * @param {string | number} [spec.frame]
 * @param {number | null} [spec.identityId]
 * @param {number | null} [spec.descriptorRow]
 * @returns {import('../../public/vision/types.js').PropagationFace}
 */
function face(spec) {
  return {
    faceId: spec.faceId,
    frame: spec.frame ?? "F",
    photoId: spec.photoId,
    box: spec.box,
    identityId: spec.identityId ?? null,
    descriptorRow: spec.descriptorRow ?? null,
  }
}

// --- the happy path ----------------------------------------------------------

test("propagates a confirmed identity onto the same box in a duplicate frame", () => {
  const faces = [
    face({ faceId: 1, photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
    face({ faceId: 2, photoId: 11, box: { x: 2, y: 2, w: 100, h: 100 }, descriptorRow: 1 }),
  ]
  const { proposals, suppressed } = propagateWithinFrames(faces, set([onCircle(0), onCircle(0.05)]), OPTIONS)

  assert.equal(suppressed.length, 0)
  assert.equal(proposals.length, 1)
  assert.equal(proposals[0].fromFaceId, 1)
  assert.equal(proposals[0].toFaceId, 2)
  assert.equal(proposals[0].identityId, 7)
  assert.ok(proposals[0].iou > 0.9, "near-identical boxes should overlap almost completely")
})

test("a photo alone in its frame class has nowhere to propagate", () => {
  const faces = [face({ faceId: 1, photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 })]
  const result = propagateWithinFrames(faces, set([onCircle(0)]), OPTIONS)
  assert.deepEqual(result, { proposals: [], suppressed: [] })
})

test("faces in DIFFERENT frame classes never link, however well their boxes agree", () => {
  const faces = [
    face({ faceId: 1, frame: "A", photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
    face({ faceId: 2, frame: "B", photoId: 11, box: { x: 0, y: 0, w: 100, h: 100 }, descriptorRow: 1 }),
  ]
  const result = propagateWithinFrames(faces, set([onCircle(0), onCircle(0)]), OPTIONS)
  assert.deepEqual(result, { proposals: [], suppressed: [] })
})

// --- rule 1: frames resolve to a ROOT, not a neighbour -----------------------

test("rule 1: propagation reaches across a transitively-linked burst, not just adjacent frames", () => {
  // A -> B and C -> B upstream; frameRoots collapses all three to one key, so
  // A's identity must be able to reach C without A and C ever being linked
  // directly. If a caller passed one-hop pointers instead, C would sit in its
  // own class and this propagation would be the one that goes missing.
  const faces = [
    face({ faceId: 1, frame: "root", photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
    face({ faceId: 2, frame: "root", photoId: 11, box: { x: 1, y: 1, w: 100, h: 100 }, descriptorRow: 1 }),
    face({ faceId: 3, frame: "root", photoId: 12, box: { x: 3, y: 3, w: 100, h: 100 }, descriptorRow: 2 }),
  ]
  const { proposals } = propagateWithinFrames(faces, set([onCircle(0), onCircle(0.05), onCircle(0.08)]), OPTIONS)

  assert.equal(proposals.length, 2)
  assert.deepEqual(
    proposals.map((p) => p.toFaceId).sort((a, b) => a - b),
    [2, 3],
  )
})

// --- rule 2: geometry must be unambiguous ------------------------------------

test("rule 2: two boxes tying for the source's position suppress rather than pick one", () => {
  // Both targets overlap the source enough to clear minIou, and neither beats
  // the other by iouMargin. This is two guests shoulder to shoulder.
  const faces = [
    face({ faceId: 1, photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
    face({ faceId: 2, photoId: 11, box: { x: 0, y: 0, w: 100, h: 100 }, descriptorRow: 1 }),
    face({ faceId: 3, photoId: 11, box: { x: 1, y: 0, w: 100, h: 100 }, descriptorRow: 2 }),
  ]
  const { proposals, suppressed } = propagateWithinFrames(faces, set([onCircle(0), onCircle(0.02), onCircle(0.02)]), OPTIONS)

  assert.equal(proposals.length, 0)
  assert.equal(suppressed.length, 1)
  assert.equal(suppressed[0].reason, "ambiguous-box")
})

test("rule 2: a box that overlaps too little is not a candidate at all", () => {
  const faces = [
    face({ faceId: 1, photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
    face({ faceId: 2, photoId: 11, box: { x: 80, y: 80, w: 100, h: 100 }, descriptorRow: 1 }),
  ]
  const { proposals, suppressed } = propagateWithinFrames(faces, set([onCircle(0), onCircle(0)]), OPTIONS)

  assert.equal(proposals.length, 0)
  assert.equal(suppressed.length, 1)
  assert.equal(suppressed[0].reason, "no-overlap")
})

// --- rule 3: geometry is never trusted alone ---------------------------------

test("rule 3: perfect box agreement is refused when the descriptors disagree", () => {
  // The two-people-swapped-places case. Geometry alone would propagate with
  // total confidence; only the descriptor can see this.
  const faces = [
    face({ faceId: 1, photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
    face({ faceId: 2, photoId: 11, box: { x: 0, y: 0, w: 100, h: 100 }, descriptorRow: 1 }),
  ]
  const { proposals, suppressed } = propagateWithinFrames(faces, set([onCircle(0), onCircle(Math.PI / 2)]), OPTIONS)

  assert.equal(proposals.length, 0)
  assert.equal(suppressed.length, 1)
  assert.equal(suppressed[0].reason, "descriptor-disagrees")
  assert.ok(suppressed[0].distance !== null && suppressed[0].distance > OPTIONS.corroborationCutoff)
})

test("rule 3: a target with no descriptor is not a weak candidate, it is no candidate", () => {
  const faces = [
    face({ faceId: 1, photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
    face({ faceId: 2, photoId: 11, box: { x: 0, y: 0, w: 100, h: 100 }, descriptorRow: null }),
  ]
  const { proposals, suppressed } = propagateWithinFrames(faces, set([onCircle(0)]), OPTIONS)

  assert.equal(proposals.length, 0)
  assert.equal(suppressed.length, 1)
  assert.equal(suppressed[0].reason, "no-descriptor")
})

// --- never overwrite, never contradict ---------------------------------------

test("a target already carrying a different identity is flagged, never overwritten", () => {
  // Both faces are confirmed, so both act as sources and each finds the other
  // occupying the box geometry says is theirs. The disagreement is reported
  // once from each side — symmetric on purpose: whichever side the reviewer
  // opens, the contradiction is attached to it.
  const faces = [
    face({ faceId: 1, photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
    face({ faceId: 2, photoId: 11, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 9, descriptorRow: 1 }),
  ]
  const { proposals, suppressed } = propagateWithinFrames(faces, set([onCircle(0), onCircle(0.02)]), OPTIONS)

  assert.equal(proposals.length, 0, "an occupied box is never taken")
  assert.equal(suppressed.length, 2)
  assert.ok(suppressed.every((s) => s.reason === "already-identified"))
  assert.deepEqual(
    suppressed.map((s) => [s.fromFaceId, s.toFaceId]).sort(),
    [
      [1, 2],
      [2, 1],
    ],
  )
})

test("a person already placed in the target frame produces no proposal at all", () => {
  // Same identity, both frames — there is nothing to carry over, and a second
  // box claiming them would contradict the frame's own assignment.
  const faces = [
    face({ faceId: 1, photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
    face({ faceId: 2, photoId: 11, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 1 }),
  ]
  const result = propagateWithinFrames(faces, set([onCircle(0), onCircle(0.02)]), OPTIONS)
  assert.deepEqual(result, { proposals: [], suppressed: [] })
})

test("two sources claiming one target drop BOTH claims rather than picking a winner", () => {
  // Two confirmed people in two separate frames whose boxes both land on one
  // unidentified box in a third. Each claim cleared every per-pair rule; the
  // contradiction is only visible across claims.
  const faces = [
    face({ faceId: 1, photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
    face({ faceId: 2, photoId: 11, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 9, descriptorRow: 1 }),
    face({ faceId: 3, photoId: 12, box: { x: 0, y: 0, w: 100, h: 100 }, descriptorRow: 2 }),
  ]
  const { proposals, suppressed } = propagateWithinFrames(faces, set([onCircle(0), onCircle(0.1), onCircle(0.05)]), OPTIONS)

  assert.equal(proposals.length, 0)
  const conflicts = suppressed.filter((s) => s.reason === "conflicting-sources")
  assert.equal(conflicts.length, 2, "both claims on face 3 are dropped, neither wins")
  assert.deepEqual(
    conflicts.map((s) => s.fromFaceId).sort(),
    [1, 2],
  )
  // The two confirmed faces also each see the other occupying their box, which
  // is the previous test's symmetric already-identified pair, not a conflict.
  assert.ok(suppressed.filter((s) => s.reason === "already-identified").length === 2)
})

// --- determinism -------------------------------------------------------------

test("the proposal list does not depend on input ordering", () => {
  /** @param {number[]} order */
  const build = (order) => {
    const all = [
      face({ faceId: 1, photoId: 10, box: { x: 0, y: 0, w: 100, h: 100 }, identityId: 7, descriptorRow: 0 }),
      face({ faceId: 2, photoId: 11, box: { x: 1, y: 1, w: 100, h: 100 }, descriptorRow: 1 }),
      face({ faceId: 3, photoId: 12, box: { x: 2, y: 2, w: 100, h: 100 }, descriptorRow: 2 }),
    ]
    return order.map((i) => all[i])
  }
  const descriptors = set([onCircle(0), onCircle(0.05), onCircle(0.08)])

  const forward = propagateWithinFrames(build([0, 1, 2]), descriptors, OPTIONS)
  const reversed = propagateWithinFrames(build([2, 1, 0]), descriptors, OPTIONS)
  assert.deepEqual(forward.proposals, reversed.proposals)
})
