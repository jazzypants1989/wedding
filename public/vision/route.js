/** @file Which faces are worth showing an admin, and in what order.
 *
 *  The Faces tab's queue is not "every detection". A batch over event
 *  photography produces a long tail of boxes that are technically faces and
 *  practically unnameable — someone's ear at the edge of frame, a face nine
 *  pixels across in the background of a wide shot, a smear where somebody
 *  turned. Showing those costs the one resource the whole feature spends:
 *  the owner's attention.
 *
 *  Three properties this has to have, and one it must not.
 *
 *  **Absolute, never population-relative.** `cropConfidence` ranks a face's
 *  signals against the whole population it arrived with, so the same face
 *  changes band as more faces are ingested — an admin who saw "accept"
 *  yesterday sees "ask" today, and a queue spanning two ingests is ordered by
 *  a quantity that means something different in each half. Every number here
 *  is a comparison against a fixed constant. Nothing in this file may take a
 *  population, a percentile or a rank.
 *
 *  **Deterministic.** Same signals in, same state out, forever. That is what
 *  makes `route_state` safe to persist rather than recompute.
 *
 *  **Versioned.** `PROFILE` names the cutoff set a stored grade was computed
 *  under. Storing it means a later revision of these constants is an explicit
 *  re-grade rather than a silent change to what an old queue page meant.
 *
 *  And the one it must not have: **this does not filter the clustering.**
 *  Routing decides what an admin is shown. A poor-quality face inside an
 *  otherwise clean cluster is information — it still constrains the grouping
 *  and still carries a descriptor — and removing it changes group composition
 *  and suggestion order for the faces that are worth naming. Filter the queue,
 *  not the input.
 */

/** @import * as Types from './types.js' */

import { allDefaults } from "./defaults.js"
import { applyGate } from "./gate.js"

/**
 * The cutoff set these grades were computed under.
 *
 * ⚠ **Bump this whenever any value in `defaults.gate` or `defaults.route`
 * changes.** `tests/unit/vision-route.test.js` pins every constant that feeds a
 * routing decision, so changing one without bumping the profile fails that test
 * rather than silently re-meaning every stored `route_state`. That is the whole
 * point of the column: an old row's grade should be readable as "graded under
 * r1", not as "graded under whatever the file says today".
 */
export const PROFILE = "route-r2"

/**
 * Order of attribution when more than one condition holds. Cheapest and most
 * decisive first, matching `gate.js`'s CHECKS ordering rationale: a face held
 * back for two reasons is attributed to the one a human would name first.
 * @type {ReadonlyArray<"boxPx" | "sharpness">}
 */
const ACCEPT_CHECKS = ["boxPx", "sharpness"]

/**
 * Gate failures that mean "hard to name", not "not a usable detection".
 *
 * The gate answers one question — is this a usable face — and everything that
 * fails it is hidden. That conflates two different failures, and the first pass
 * over a real labelled run showed the conflation is expensive in exactly one
 * place.
 *
 * `eyeRatioLow` fires when the eyes sit close together relative to the box,
 * which is the pose proxy: a head turned far enough that one eye is occluded.
 * A turned head is a perfectly nameable face to someone who knows the people in
 * the photographs — it is only unnameable to a recogniser. Hiding it spends the
 * one resource this feature has (the owner's attention) by REMOVING chances to
 * spend it.
 *
 * So a face whose ONLY gate failure is this one is asked about rather than set
 * aside. It can never reach `accept` — a turned face should not be named
 * unprompted — so this widens the queue, never the automatic decisions.
 *
 * The upper bound (`eyeRatioHigh`) is deliberately NOT here. Eyes further apart
 * than a face allows means the landmarks came out mirrored or the detection is
 * wrong, which is a broken detection rather than an awkward pose.
 *
 * **To re-derive this locally rather than trusting it:** take a run whose faces
 * a human has individually adjudicated, join it to the ingested rows, and for
 * each gate check cross-tabulate the faces it hid against what the human said —
 * named / declined to identify / not a face. A check that hides mostly faces a
 * human could name is miscategorised and belongs here; one that hides mostly
 * junk is doing its job and does not. Do the same before adding a second entry.
 * Do not record what that table said in this repository — it is a measurement of
 * identifiable people (CLAUDE.md's fourth photograph rule).
 * @type {ReadonlyArray<string>}
 */
const SOFT_GATE_FAILURES = ["eyeRatioLow"]

/**
 * Route one face. `signals` is `gateSignals()`'s output; `cutoffs` is
 * `defaults.gate` merged with `defaults.route`, so a caller tuning either
 * section gets both without a second argument.
 * @type {Types.routeFace}
 */
export function routeFace(signals, cutoffs) {
  const gate = applyGate(signals, cutoffs)
  // A gate failure hides the face UNLESS every reason it failed is one of the
  // "hard to name, still a face" kind — see SOFT_GATE_FAILURES. Checking that
  // ALL reasons are soft, rather than that the primary one is, matters: a face
  // that is both turned AND below the size floor is genuinely unusable, and
  // reading only the first reason would surface it on the strength of the
  // forgivable half of its problem.
  const hardReasons = gate.reasons.filter((reason) => !SOFT_GATE_FAILURES.includes(reason))
  if (hardReasons.length > 0) {
    return {
      state: "set_aside",
      reason: hardReasons[0],
      score: 0,
      profile: PROFILE,
    }
  }

  // Past the gate. The question is now not "is this a face" but "is it worth
  // an admin's attention", which is a higher and separate bar — hence its own
  // constants rather than a tightening of the gate's.
  const headroom = acceptHeadroom(signals, cutoffs)
  const weakest = ACCEPT_CHECKS.reduce((worst, key) =>
    headroom[key] < headroom[worst] ? key : worst,
  )
  const score = headroom[weakest]

  // A face that failed the gate softly is ALWAYS asked about, however well it
  // scores on size and sharpness. A big sharp face in profile is the easiest
  // possible case for a human and still the wrong thing to name unprompted, so
  // the score orders it within the queue and never promotes it out of one.
  // `gate.pass` is the test rather than a recomputation: everything hard has
  // already returned above, so a failed gate here can only be soft.
  if (!gate.pass) {
    return {
      state: "ask",
      reason: gate.primaryReason ?? "gate",
      score,
      profile: PROFILE,
    }
  }

  return score >= 1
    ? { state: "accept", reason: null, score: 1, profile: PROFILE }
    : { state: "ask", reason: weakest, score, profile: PROFILE }
}

/**
 * How far each accept condition is satisfied, as a fraction of its threshold,
 * clamped to [0, 1]. At or above the threshold is 1; exactly half of it is 0.5;
 * zero is 0.
 *
 * Both thresholds are strictly positive, which is what makes a plain ratio a
 * legitimate normalisation here. That is not true of every gate cutoff —
 * `minBorderPx` is 0 by default, and `(s - 0) / 0` is not a number — which is
 * why the ordering score is built from these two and not from all nine. The
 * plan's sketch was "the minimum of each signal's normalised distance from its
 * cutoff"; this is that, over the signals whose cutoffs can normalise anything,
 * and every face in `ask` has already cleared all nine gate checks anyway, so
 * the seven omitted ones are positive-by-construction and would not order
 * anything.
 * @param {Types.GateSignals} signals
 * @param {Record<string, number>} cutoffs
 * @returns {Record<"boxPx" | "sharpness", number>}
 */
function acceptHeadroom(signals, cutoffs) {
  return {
    boxPx: ratio(signals.boxPx, cutoffs.acceptMinBoxPx),
    sharpness: ratio(signals.sharpness, cutoffs.acceptMinSharpness),
  }
}

/**
 * `value / threshold`, clamped to [0, 1]. A non-positive threshold would make
 * the condition vacuous rather than normalising anything, so it is treated as
 * "satisfied" instead of producing an Infinity that sorts above everything.
 * @param {number} value
 * @param {number} threshold
 * @returns {number}
 */
function ratio(value, threshold) {
  if (!(threshold > 0)) return 1
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(1, value / threshold)
}

/**
 * The cutoff object `routeFace` expects: the gate's constants and the route
 * section's, in one flat table. Separate sections in `defaults.js` because they
 * answer different questions; one object here because a face is graded against
 * both at once.
 * @type {Types.routeCutoffs}
 */
export function routeCutoffs(overrides = {}) {
  const all = allDefaults()
  return { ...all.gate, ...all.route, ...overrides }
}

/**
 * Every state a face can be in, plus the "not yet graded" case callers have to
 * handle. `null` is not a state — it means the row predates routing or was
 * written by a path that did not grade it, and a query that drops it silently
 * loses faces rather than showing them.
 * @type {ReadonlyArray<Types.RouteState>}
 */
export const ROUTE_STATES = ["accept", "ask", "set_aside"]

/** @type {Types.isRouteState} */
export function isRouteState(value) {
  return typeof value === "string" && ROUTE_STATES.includes(/** @type {Types.RouteState} */ (value))
}
