/** @file Quality routing: which faces reach an admin, and in what order.
 *
 *  Two things are worth testing here beyond "does it return a string". The
 *  first is that the grade is ABSOLUTE — the same face routes the same way
 *  whatever it arrives alongside, because the alternative (a population-relative
 *  score, which the codebase already has in `cropConfidence`) makes a queue
 *  spanning two ingests incoherent. The second is that the constants are
 *  PINNED: a stored `route_state` is only readable if `route_profile` still
 *  names the table it was graded under, so changing a cutoff without bumping
 *  the profile has to fail something, and this file is that something.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { allDefaults } from "../../public/vision/defaults.js"
import {
  PROFILE,
  ROUTE_STATES,
  isRouteState,
  routeCutoffs,
  routeFace,
} from "../../public/vision/route.js"

/** @import * as Types from '../../public/vision/types.js' */

/**
 * A face that clears every gate check and both accept bars, comfortably.
 * Individual tests degrade one signal at a time from here, so a failure names
 * the signal it is about.
 * @param {Partial<Types.GateSignals>} [overrides]
 * @returns {Types.GateSignals}
 */
function face(overrides = {}) {
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

const CUTOFFS = routeCutoffs()

// --- The three states --------------------------------------------------------

test("a good face is accepted, with nothing held against it", () => {
  const verdict = routeFace(face(), CUTOFFS)
  assert.equal(verdict.state, "accept")
  assert.equal(verdict.reason, null)
  assert.equal(verdict.score, 1)
  assert.equal(verdict.profile, PROFILE)
})

test("failing a gate check sets the face aside, and names the check", () => {
  // Below gate.minBoxPx: not a judgement about whether it is worth naming, a
  // judgement about whether it is a usable detection at all.
  const verdict = routeFace(face({ boxPx: 10 }), CUTOFFS)
  assert.equal(verdict.state, "set_aside")
  assert.equal(verdict.reason, "boxPx")
  assert.equal(verdict.score, 0)
})

test("a face that passes the gate but not the accept bar is asked about", () => {
  // Between gate.minBoxPx and route.acceptMinBoxPx: a real detection that a
  // human should look at rather than one the machine should name unprompted.
  const between = (CUTOFFS.minBoxPx + CUTOFFS.acceptMinBoxPx) / 2
  const verdict = routeFace(face({ boxPx: between }), CUTOFFS)
  assert.equal(verdict.state, "ask")
  assert.equal(verdict.reason, "boxPx")
  assert.ok(verdict.score > 0 && verdict.score < 1)
})

test("exactly at the accept threshold is accepted, not asked", () => {
  const verdict = routeFace(
    face({ boxPx: CUTOFFS.acceptMinBoxPx, sharpness: CUTOFFS.acceptMinSharpness }),
    CUTOFFS,
  )
  assert.equal(verdict.state, "accept", "the threshold is a floor, not a strict inequality")
})

test("a hair under either accept threshold is asked", () => {
  const box = routeFace(face({ boxPx: CUTOFFS.acceptMinBoxPx - 1 }), CUTOFFS)
  assert.equal(box.state, "ask")
  assert.equal(box.reason, "boxPx")

  const sharp = routeFace(face({ sharpness: CUTOFFS.acceptMinSharpness * 0.99 }), CUTOFFS)
  assert.equal(sharp.state, "ask")
  assert.equal(sharp.reason, "sharpness")
})

test("the gate decides before the accept bar does", () => {
  // Big enough to accept on size, but below the gate's sharpness floor. The
  // gate is the outer test: an unusable detection is set aside whatever else
  // is true of it.
  const verdict = routeFace(
    face({ boxPx: 1000, sharpness: CUTOFFS.minSharpness / 2 }),
    CUTOFFS,
  )
  assert.equal(verdict.state, "set_aside")
  assert.equal(verdict.reason, "sharpness")
})

test("a face held back by both accept conditions is attributed to the weaker one", () => {
  // Box at 90% of its bar, sharpness at 50% of its — and both still above
  // their gate floors, so this really is an `ask` and not a disguised
  // `set_aside`. The reason should be the one furthest off, not the one
  // checked first.
  const sharpness = CUTOFFS.acceptMinSharpness * 0.5
  assert.ok(sharpness > CUTOFFS.minSharpness, "fixture must clear the gate to test the accept bar")

  const verdict = routeFace(
    face({ boxPx: CUTOFFS.acceptMinBoxPx * 0.9, sharpness }),
    CUTOFFS,
  )
  assert.equal(verdict.state, "ask")
  assert.equal(verdict.reason, "sharpness")
  assert.ok(Math.abs(verdict.score - 0.5) < 1e-9)
})

// --- Absolute, not population-relative ---------------------------------------

test("the same face routes identically whatever it arrives alongside", () => {
  // The property `cropConfidence` does NOT have, and the reason routing does
  // not use it. There is no population argument to pass, which is the design:
  // it is not possible to make this face's grade depend on its neighbours.
  const subject = face({ boxPx: 120 })
  const alone = routeFace(subject, CUTOFFS)

  for (const _ of [face({ boxPx: 10 }), face({ boxPx: 4000 }), face({ boxPx: 121 })]) {
    assert.deepEqual(routeFace(subject, CUTOFFS), alone)
  }
})

test("the ask score orders by how close a face came, and is stable across ingests", () => {
  const closer = routeFace(face({ boxPx: CUTOFFS.acceptMinBoxPx * 0.9 }), CUTOFFS)
  const further = routeFace(face({ boxPx: CUTOFFS.acceptMinBoxPx * 0.6 }), CUTOFFS)
  assert.equal(closer.state, "ask")
  assert.equal(further.state, "ask")
  assert.ok(closer.score > further.score, "the nearly-acceptable face is asked about first")

  // Same two faces, computed again: identical numbers, not merely the same
  // order. A percentile would give the same order and different numbers, and
  // the numbers are what a queue spanning two ingests sorts on.
  assert.equal(routeFace(face({ boxPx: CUTOFFS.acceptMinBoxPx * 0.9 }), CUTOFFS).score, closer.score)
})

test("routing is a pure function of the signals — repeated calls agree exactly", () => {
  const f = face({ boxPx: 77, sharpness: 0.006 })
  const first = routeFace(f, CUTOFFS)
  for (let i = 0; i < 5; i++) assert.deepEqual(routeFace(f, CUTOFFS), first)
})

// --- Degenerate input --------------------------------------------------------

test("a zero or negative signal scores zero rather than producing a NaN order", () => {
  // Below the gate, so the state is set_aside either way; what is asserted is
  // that the score is a number a sort can use.
  for (const sharpness of [0, -1]) {
    const verdict = routeFace(face({ sharpness }), CUTOFFS)
    assert.equal(verdict.state, "set_aside")
    assert.ok(Number.isFinite(verdict.score))
  }
})

test("a non-positive accept threshold makes its condition vacuous, not infinite", () => {
  // Guards the ordering score: `value / 0` is Infinity, which would sort a
  // face above every other and silently take over the queue.
  const verdict = routeFace(face({ boxPx: 50 }), { ...CUTOFFS, acceptMinBoxPx: 0 })
  assert.ok(Number.isFinite(verdict.score))
  assert.equal(verdict.state, "accept")
})

// --- The profile contract ----------------------------------------------------

test("PROFILE pins every constant a routing decision reads", () => {
  // ⚠ If this fails you changed a cutoff. That is fine — but every stored
  // route_state was graded under the OLD table, and route_profile is what says
  // so. Bump PROFILE in route.js and update the expectations here, together, in
  // one commit. Do not update one without the other.
  const { gate, route } = allDefaults()
  assert.equal(PROFILE, "route-r1")
  assert.deepEqual(gate, {
    minBoxPx: 40,
    minBorderPx: 0,
    minEyeRatio: 0.2,
    maxEyeRatio: 0.62,
    maxResidual: 12,
    maxAlignScale: 1.6,
    maxOutside: 0.02,
    minSharpness: 0.004,
  })
  assert.deepEqual(route, { acceptMinBoxPx: 96, acceptMinSharpness: 0.01 })
})

test("the accept bars sit above the gate floors they refine", () => {
  // Not a tuning assertion — a coherence one. An accept bar at or below its
  // gate floor would make the ask band empty and the whole three-way split a
  // two-way one, silently.
  const { gate, route } = allDefaults()
  assert.ok(route.acceptMinBoxPx > gate.minBoxPx)
  assert.ok(route.acceptMinSharpness > gate.minSharpness)
})

test("routeCutoffs merges both sections and honours overrides", () => {
  const merged = routeCutoffs()
  assert.equal(merged.minBoxPx, allDefaults().gate.minBoxPx)
  assert.equal(merged.acceptMinBoxPx, allDefaults().route.acceptMinBoxPx)
  assert.equal(routeCutoffs({ acceptMinBoxPx: 500 }).acceptMinBoxPx, 500)
})

// --- The state vocabulary ----------------------------------------------------

test("the three states are the three states, and null is not one of them", () => {
  assert.deepEqual([...ROUTE_STATES], ["accept", "ask", "set_aside"])
  for (const state of ROUTE_STATES) assert.ok(isRouteState(state))
  // null means "not yet graded", which callers must handle as a fourth case
  // rather than coerce into a state.
  for (const bad of [null, undefined, "", "pending", "rejected", 0]) {
    assert.equal(isRouteState(bad), false)
  }
})

test("every state routeFace can return is in ROUTE_STATES", () => {
  const seen = new Set(
    [
      face(),
      face({ boxPx: CUTOFFS.acceptMinBoxPx - 1 }),
      face({ boxPx: 1 }),
    ].map((f) => routeFace(f, CUTOFFS).state),
  )
  assert.deepEqual([...seen].sort(), ["accept", "ask", "set_aside"])
  for (const state of seen) assert.ok(ROUTE_STATES.includes(state))
})
