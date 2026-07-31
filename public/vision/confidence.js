/** @file Two independent notions of "how sure are we," kept separate on
 *  purpose: a crop can be a perfect photograph of the wrong person, and a
 *  blurry, edge-of-frame crop can still be an unambiguous match against the
 *  prototypes on file. Neither number substitutes for the other.
 *
 *  `cropConfidence` asks whether the DETECTION is trustworthy at all, from
 *  gate.js's nine signals, before identity ever enters the picture.
 *  `matchConfidence` asks, given a margin from `assign.js`'s `matchFace`,
 *  how often a margin that size has been right — a question this file
 *  cannot answer from first principles, so it evaluates a calibration table
 *  built elsewhere (report-side, from labelled data) rather than assuming one.
 */
/** @import * as Types from './types.js' */

import { percentile } from "./metrics.js"

/**
 * Every signal `gateSignals` (gate.js) produces, and how it is ranked here.
 * Read against gate.js's CHECKS (gate.js:104-114) and its comments — this
 * table exists because that file's cutoffs don't state the polarity in one
 * place, and getting one wrong silently rewards the worst crops.
 *
 *   signal            gate.js cutoff(s)              here
 *   ----------------  -----------------------------  --------------------------------
 *   score             min only (line 105)             low is bad -> rank ascending
 *   boxPx             min only (line 106)              low is bad -> rank ascending
 *   borderPx          min only (line 107)              low is bad -> rank ascending
 *   eyeRatio          min AND max (lines 108-109)      BAND -> rank -|v - median|
 *   eyeAngle          no cutoff at all (not in CHECKS; see gate.js:88-90 —
 *                     "extreme values pair with bad landmarks" in EITHER
 *                     direction)                       BAND -> rank -|v - median|
 *   alignScale        max only (line 111)               high is bad -> rank -v
 *   residual          max only (line 110)               high is bad -> rank -v
 *   outsideFraction   max only (line 112)               high is bad -> rank -v
 *   sharpness         min only (line 113)               low is bad -> rank ascending
 *
 * "rank ascending" ranks the raw value: a low value gets a low percentile
 * rank, and a low rank IS the bad outcome here, so the rank is used directly.
 * "rank -v" ranks the value's negation, so a low raw value (good) reads as a
 * high rank. "BAND" signals are non-monotonic — good sits in the MIDDLE of
 * the distribution, not at either end — so the raw value is first folded
 * around its own population median before ranking; the fold turns "close to
 * the middle" into "large," which ascending-rank then rewards correctly.
 * @type {Record<keyof Types.GateSignals, "ascending" | "descending" | "band">}
 */
const SIGNAL_POLARITY = {
  score: "ascending",
  boxPx: "ascending",
  borderPx: "ascending",
  eyeRatio: "band",
  eyeAngle: "band",
  alignScale: "descending",
  residual: "descending",
  outsideFraction: "descending",
  sharpness: "ascending",
}

/** @type {Array<keyof Types.GateSignals>} */
const SIGNAL_KEYS = /** @type {Array<keyof Types.GateSignals>} */ (Object.keys(SIGNAL_POLARITY))

/**
 * Fraction of `population` at or below `value`, ties split at the midpoint —
 * the same tie treatment `separation` (metrics.js) gives its Mann-Whitney
 * statistic, so a value tied with half the population reads as the middle of
 * the pack instead of snapping to whichever end the tie-break happened to favour.
 * @param {number} value
 * @param {readonly number[]} population
 * @returns {number}
 */
function percentileRank(value, population) {
  const n = population.length
  if (n === 0) return NaN
  let below = 0
  let equal = 0
  for (const v of population) {
    if (v < value) below++
    else if (v === value) equal++
  }
  return (below + equal * 0.5) / n
}

/** @type {Types.cropConfidence} */
export function cropConfidence(signals, allSignals) {
  /** @type {Record<string, number>} */
  const signalRanks = {}

  for (const key of SIGNAL_KEYS) {
    const polarity = SIGNAL_POLARITY[key]
    const population = allSignals.map((s) => s[key])

    if (polarity === "band") {
      const sortedPopulation = population.slice().sort((a, b) => a - b)
      const median = percentile(sortedPopulation, 0.5)
      const foldedValue = -Math.abs(signals[key] - median)
      const foldedPopulation = population.map((v) => -Math.abs(v - median))
      signalRanks[key] = percentileRank(foldedValue, foldedPopulation)
    } else if (polarity === "ascending") {
      signalRanks[key] = percentileRank(signals[key], population)
    } else {
      signalRanks[key] = percentileRank(-signals[key], population.map((v) => -v))
    }
  }

  const ranks = Object.values(signalRanks)
  // The minimum, not the mean: one catastrophic signal should not be diluted
  // by eight fine ones — a crop is only as trustworthy as its worst measurement.
  const confidence = ranks.length > 0 ? Math.min(...ranks) : NaN
  return { confidence, signalRanks: /** @type {Record<keyof Types.GateSignals, number>} */ (signalRanks) }
}

/** @type {Types.matchConfidence} */
export function matchConfidence(margin, calibration) {
  if (calibration.length === 0) {
    throw new Error("matchConfidence: empty calibration table")
  }
  for (let i = 0; i < calibration.length; i++) {
    const knot = calibration[i]
    if (!Number.isFinite(knot.margin)) {
      throw new Error(`matchConfidence: calibration knot ${i} has a non-finite margin`)
    }
    if (!(knot.p >= 0 && knot.p <= 1)) {
      throw new Error(`matchConfidence: calibration knot ${i} has p=${knot.p}, outside [0, 1]`)
    }
    if (i > 0 && knot.margin <= calibration[i - 1].margin) {
      throw new Error("matchConfidence: calibration knots must be sorted strictly increasing by margin")
    }
  }

  // An unranked margin (matchFace with zero prototypes) has nothing to
  // evaluate against a calibration built from ranked margins.
  if (Number.isNaN(margin)) return NaN

  const first = calibration[0]
  const last = calibration[calibration.length - 1]
  // Clamped at both ends, and Infinity (matchFace with exactly one prototype
  // — no competitor, so no upper bound on the margin) clamps to the highest
  // knot rather than needing a special case.
  if (margin <= first.margin) return first.p
  if (margin >= last.margin) return last.p

  for (let i = 1; i < calibration.length; i++) {
    const hi = calibration[i]
    if (margin <= hi.margin) {
      const lo = calibration[i - 1]
      const t = (margin - lo.margin) / (hi.margin - lo.margin)
      return lo.p + (hi.p - lo.p) * t
    }
  }
  // Unreachable: the clamps above cover margin <= first and margin >= last,
  // and every value between two knots is caught by the loop.
  return last.p
}
