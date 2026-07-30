/** @file Unit test: the quality gate's signals and the cutoff application.
 *
 *  The invariants that matter are the normalisations. An unnormalised sharpness
 *  measure discards small sharp faces and keeps large soft ones, which is a
 *  silent, plausible-looking way to make grouping worse — so both invariances
 *  are asserted rather than commented.
 *
 *  Imports browser vision modules, so this file is excluded from the server
 *  tsconfig (see tsconfig.json).
 */

import { test } from "node:test"
import assert from "node:assert"

import { applyGate, gateCheckKeys, gateSignals, sharpness } from "../../public/vision/gate.js"
import { getDefaults } from "../../public/vision/defaults.js"

/** Checkerboard of `cell`-pixel squares at a given contrast, as an RgbImage. */
function checker(size, cell, lo, hi) {
  const rgb = new Uint8Array(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
      const v = on ? hi : lo
      const i = (y * size + x) * 3
      rgb[i] = v
      rgb[i + 1] = v
      rgb[i + 2] = v
    }
  }
  return { width: size, height: size, rgb }
}

/** A smooth ramp — plenty of contrast, almost no high-frequency detail. */
function ramp(size) {
  const rgb = new Uint8Array(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round((x / (size - 1)) * 255)
      const i = (y * size + x) * 3
      rgb[i] = v
      rgb[i + 1] = v
      rgb[i + 2] = v
    }
  }
  return { width: size, height: size, rgb }
}

/** Landmarks laid out with a given eye separation, centred in a box. */
function landmarksWithEyes(cx, cy, eyeSeparation) {
  const half = eyeSeparation / 2
  return [cx - half, cy, cx + half, cy, cx, cy + 20, cx - half * 0.8, cy + 40, cx + half * 0.8, cy + 40]
}

function signalsFor(over = {}) {
  return gateSignals({
    box: { x: 100, y: 100, w: 100, h: 100 },
    landmarks: landmarksWithEyes(150, 130, 35),
    imageWidth: 800,
    imageHeight: 600,
    score: 0.9,
    crop: checker(112, 4, 40, 210),
    alignScale: 0.8,
    residual: 3,
    outsideFraction: 0,
    ...over,
  })
}

test("sharpness separates detail from smoothness", () => {
  assert.ok(sharpness(checker(64, 2, 0, 255)) > sharpness(ramp(64)) * 100)
})

test("sharpness is invariant to contrast", () => {
  // Same structure, a quarter of the amplitude. Laplacian energy and variance
  // both scale as the square of intensity, so the ratio must not move — this is
  // what stops a brightly lit face reading as sharper than a dim one.
  const bright = sharpness(checker(64, 4, 0, 240))
  const dim = sharpness(checker(64, 4, 90, 150))
  assert.ok(Math.abs(bright - dim) / bright < 0.02, `bright ${bright} vs dim ${dim}`)
})

test("sharpness is invariant to crop size at the same detail scale", () => {
  // Using means rather than sums is the whole reason this holds.
  const small = sharpness(checker(48, 4, 20, 220))
  const large = sharpness(checker(112, 4, 20, 220))
  assert.ok(Math.abs(small - large) / large < 0.15, `small ${small} vs large ${large}`)
})

test("sharpness survives a degenerate crop", () => {
  assert.equal(sharpness({ width: 1, height: 1, rgb: new Uint8Array(3) }), 0)
  // A flat crop has no contrast; the epsilon must keep this finite rather than
  // returning Infinity and passing every threshold ever set on it.
  assert.ok(Number.isFinite(sharpness(checker(32, 4, 128, 128))))
})

test("eyeRatio is eye separation over box width", () => {
  const s = signalsFor({ landmarks: landmarksWithEyes(150, 130, 40) })
  assert.ok(Math.abs(s.eyeRatio - 0.4) < 1e-6, `eyeRatio ${s.eyeRatio}`)
})

test("borderPx goes negative when the box runs off the frame", () => {
  assert.equal(signalsFor({ box: { x: 10, y: 40, w: 100, h: 100 } }).borderPx, 10)
  assert.equal(signalsFor({ box: { x: -12, y: 40, w: 100, h: 100 } }).borderPx, -12)
  // Off the right edge, which is the case a naive min(x, y) check would miss.
  assert.equal(signalsFor({ box: { x: 760, y: 40, w: 100, h: 100 } }).borderPx, -60)
})

test("boxPx is the shorter edge", () => {
  assert.equal(signalsFor({ box: { x: 0, y: 0, w: 120, h: 40 } }).boxPx, 40)
})

test("a good face passes the default cutoffs", () => {
  const cutoffs = getDefaults("gate")
  const verdict = applyGate(signalsFor(), cutoffs)
  assert.ok(verdict.pass, `rejected for: ${verdict.reasons.join(", ")}`)
  assert.equal(verdict.primaryReason, null)
})

test("each cutoff rejects for its own reason", () => {
  const cutoffs = getDefaults("gate")
  const cases = [
    ["boxPx", { box: { x: 100, y: 100, w: 20, h: 20 } }],
    ["border", { box: { x: -5, y: 100, w: 100, h: 100 } }],
    ["eyeRatioLow", { landmarks: landmarksWithEyes(150, 130, 5) }],
    ["eyeRatioHigh", { landmarks: landmarksWithEyes(150, 130, 90) }],
    ["residual", { residual: 40 }],
    ["alignScale", { alignScale: 3 }],
    ["outside", { outsideFraction: 0.5 }],
    ["sharpness", { crop: ramp(112) }],
  ]
  for (const [expected, over] of cases) {
    const verdict = applyGate(signalsFor(over), cutoffs)
    assert.ok(!verdict.pass, `${expected}: should have been rejected`)
    assert.ok(verdict.reasons.includes(expected), `${expected}: got ${verdict.reasons.join(",")}`)
  }
})

test("primaryReason follows cost order, and reasons lists everything", () => {
  const cutoffs = getDefaults("gate")
  // Tiny AND blurry AND badly aligned.
  const verdict = applyGate(
    signalsFor({ box: { x: 100, y: 100, w: 20, h: 20 }, residual: 99, crop: ramp(112) }),
    cutoffs,
  )
  assert.equal(verdict.primaryReason, "boxPx", "cheapest check attributed first")
  assert.ok(verdict.reasons.length >= 3, `got ${verdict.reasons.join(",")}`)
})

test("gateCheckKeys covers every reason the gate can give", () => {
  const keys = new Set(gateCheckKeys())
  const cutoffs = getDefaults("gate")
  const verdict = applyGate(
    signalsFor({ box: { x: -5, y: 100, w: 5, h: 5 }, residual: 99, crop: ramp(112) }),
    cutoffs,
  )
  for (const reason of verdict.reasons) {
    assert.ok(keys.has(reason), `"${reason}" missing from gateCheckKeys()`)
  }
})
