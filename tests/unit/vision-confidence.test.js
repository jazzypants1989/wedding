/** @file Unit test: crop confidence (gate-signal percentile ranking) and
 *  match confidence (margin -> P(correct) calibration lookup).
 *
 *  Every signal set here is hand-built — never a real gate.js measurement of
 *  a real photograph, per CLAUDE.md's photograph rule.
 *
 *  Imports browser vision modules, so this file is excluded from the server
 *  tsconfig (see tsconfig.json).
 */

import { test } from "node:test"
import assert from "node:assert"

import { cropConfidence, matchConfidence } from "../../public/vision/confidence.js"

/** @param {Partial<import("../../public/vision/types.js").GateSignals>} overrides */
function signals(overrides = {}) {
  return {
    score: 0.8,
    boxPx: 80,
    borderPx: 20,
    eyeRatio: 0.4,
    eyeAngle: 0,
    alignScale: 1.0,
    residual: 4,
    outsideFraction: 0,
    sharpness: 0.01,
    ...overrides,
  }
}

// --- cropConfidence: monotone signals -----------------------------------------

test("cropConfidence: low score (bad, low-is-bad) ranks worse than high score", () => {
  const population = [signals({ score: 0.1 }), signals({ score: 0.5 }), signals({ score: 0.9 })]
  const low = cropConfidence(population[0], population)
  const high = cropConfidence(population[2], population)
  assert.ok(low.signalRanks.score < high.signalRanks.score)
})

test("cropConfidence: high residual (bad, high-is-bad) ranks worse than low residual", () => {
  const population = [signals({ residual: 1 }), signals({ residual: 6 }), signals({ residual: 20 })]
  const low = cropConfidence(population[0], population)
  const high = cropConfidence(population[2], population)
  assert.ok(low.signalRanks.residual > high.signalRanks.residual)
})

// --- cropConfidence: band-shaped signals ---------------------------------------

test("cropConfidence: eyeAngle — equal-and-opposite tilts from the median score identically", () => {
  // Population median eyeAngle is 0. Two crops sit symmetrically off it.
  const population = [
    signals({ eyeAngle: -0.3 }),
    signals({ eyeAngle: -0.1 }),
    signals({ eyeAngle: 0 }),
    signals({ eyeAngle: 0.1 }),
    signals({ eyeAngle: 0.3 }),
  ]
  const left = cropConfidence(signals({ eyeAngle: -0.2 }), population)
  const right = cropConfidence(signals({ eyeAngle: 0.2 }), population)
  assert.ok(
    Math.abs(left.signalRanks.eyeAngle - right.signalRanks.eyeAngle) < 1e-9,
    `expected identical ranks, got ${left.signalRanks.eyeAngle} vs ${right.signalRanks.eyeAngle}`,
  )
})

test("cropConfidence: eyeRatio is band-shaped too — extreme in either direction ranks worse than the median", () => {
  const population = [
    signals({ eyeRatio: 0.2 }),
    signals({ eyeRatio: 0.3 }),
    signals({ eyeRatio: 0.4 }),
    signals({ eyeRatio: 0.5 }),
    signals({ eyeRatio: 0.6 }),
  ]
  const middle = cropConfidence(signals({ eyeRatio: 0.4 }), population)
  const extreme = cropConfidence(signals({ eyeRatio: 0.2 }), population)
  assert.ok(middle.signalRanks.eyeRatio > extreme.signalRanks.eyeRatio)
})

// --- cropConfidence: minimum aggregation ---------------------------------------

test("cropConfidence: a face that is median on everything scores higher than one extreme on one signal", () => {
  const population = []
  for (let i = 0; i < 9; i++) {
    const t = i / 8 // 0..1
    population.push(
      signals({
        score: 0.2 + 0.6 * t,
        boxPx: 40 + 80 * t,
        borderPx: 5 + 40 * t,
        sharpness: 0.002 + 0.02 * t,
        residual: 1 + 10 * t,
        alignScale: 0.8 + 0.8 * t,
        outsideFraction: 0.3 * t,
      }),
    )
  }
  const medianFace = population[4] // exactly the middle of every population
  const extremeOnOneSignal = signals({ ...medianFace, score: 0.2 }) // worst possible score, median elsewhere

  const medianConfidence = cropConfidence(medianFace, population).confidence
  const extremeConfidence = cropConfidence(extremeOnOneSignal, population).confidence
  assert.ok(
    medianConfidence > extremeConfidence,
    `median ${medianConfidence} should beat one-bad-signal ${extremeConfidence}`,
  )
})

test("cropConfidence: confidence is the minimum signal rank, not an average", () => {
  const population = [signals({ score: 0.2 }), signals({ score: 0.5 }), signals({ score: 0.9 })]
  // score is worst-in-population (rank 0), everything else is untouched (identical for all three, rank 0.5).
  const worstScore = cropConfidence(signals({ score: 0.2 }), population)
  const ranks = Object.values(worstScore.signalRanks)
  assert.ok(Math.abs(worstScore.confidence - Math.min(...ranks)) < 1e-9)
  assert.ok(worstScore.confidence <= worstScore.signalRanks.boxPx)
})

// --- matchConfidence -----------------------------------------------------------

test("matchConfidence: interpolates linearly between knots", () => {
  const table = [
    { margin: 0, p: 0.5 },
    { margin: 1, p: 0.9 },
    { margin: 2, p: 0.99 },
  ]
  assert.ok(Math.abs(matchConfidence(0.5, table) - 0.7) < 1e-9)
  assert.ok(Math.abs(matchConfidence(1.5, table) - 0.945) < 1e-9)
})

test("matchConfidence: clamps below the first knot and above the last", () => {
  const table = [
    { margin: 0, p: 0.5 },
    { margin: 1, p: 0.9 },
  ]
  assert.equal(matchConfidence(-5, table), 0.5)
  assert.equal(matchConfidence(5, table), 0.9)
  assert.equal(matchConfidence(Infinity, table), 0.9)
})

test("matchConfidence: NaN margin (matchFace's zero-prototype case) yields NaN, not a lookup", () => {
  const table = [
    { margin: 0, p: 0.5 },
    { margin: 1, p: 0.9 },
  ]
  assert.ok(Number.isNaN(matchConfidence(NaN, table)))
})

test("matchConfidence: rejects an empty calibration table", () => {
  assert.throws(() => matchConfidence(0.5, []))
})

test("matchConfidence: rejects p outside [0, 1]", () => {
  assert.throws(() => matchConfidence(0.5, [{ margin: 0, p: 1.2 }]))
})

test("matchConfidence: rejects knots that are not sorted strictly increasing by margin", () => {
  assert.throws(() =>
    matchConfidence(0.5, [
      { margin: 1, p: 0.5 },
      { margin: 0, p: 0.9 },
    ]),
  )
  assert.throws(() =>
    matchConfidence(0.5, [
      { margin: 0, p: 0.5 },
      { margin: 0, p: 0.9 },
    ]),
  )
})
