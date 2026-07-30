/** @file Unit test: the similarity fit and the 112x112 warp.
 *
 *  The headline test here is the mirror check. A swapped eye order produces a
 *  crop that looks entirely plausible to a human scanning a contact sheet and
 *  quietly degrades every single match downstream — it is the cheapest bug in
 *  the project to catch and the most expensive to catch late. Since it is caught
 *  by a number rather than by a glance, it can be a regression test, and this is
 *  it.
 *
 *  Imports browser vision modules, so this file is excluded from the server
 *  tsconfig (see tsconfig.json) — same pattern as effect-themes.test.js.
 */

import { test } from "node:test"
import assert from "node:assert"

import {
  SFACE_TEMPLATE,
  alignFace,
  fitSimilarity,
  mirrorCrop,
  swapEyeOrder,
} from "../../public/vision/align.js"

/** Apply a similarity transform to a flat point list. */
function applyTransform(points, { a, b, tx, ty }) {
  const out = []
  for (let i = 0; i < points.length; i += 2) {
    out.push(a * points[i] - b * points[i + 1] + tx, b * points[i] + a * points[i + 1] + ty)
  }
  return out
}

/** A solid-colour image with a distinguishable left half, for orientation checks. */
function twoToneImage(width, height) {
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      const left = x < width / 2
      rgb[i] = left ? 220 : 20
      rgb[i + 1] = 128
      rgb[i + 2] = left ? 20 : 220
    }
  }
  return { width, height, rgb }
}

test("fitSimilarity recovers a known rotation, scale and translation exactly", () => {
  const src = [0, 0, 10, 0, 10, 10, 0, 10]
  // 30 degrees, scale 2.5, shifted.
  const angle = Math.PI / 6
  const scale = 2.5
  const truth = {
    a: scale * Math.cos(angle),
    b: scale * Math.sin(angle),
    tx: 17,
    ty: -4,
  }
  const dst = applyTransform(src, truth)

  const fit = fitSimilarity(src, dst)
  assert.ok(Math.abs(fit.a - truth.a) < 1e-9, `a: ${fit.a}`)
  assert.ok(Math.abs(fit.b - truth.b) < 1e-9, `b: ${fit.b}`)
  assert.ok(Math.abs(fit.tx - truth.tx) < 1e-9, `tx: ${fit.tx}`)
  assert.ok(Math.abs(fit.ty - truth.ty) < 1e-9, `ty: ${fit.ty}`)
  assert.ok(Math.abs(fit.scale - scale) < 1e-9, `scale: ${fit.scale}`)
  assert.ok(Math.abs(fit.rotation - angle) < 1e-9, `rotation: ${fit.rotation}`)
  // An exactly-realisable transform leaves nothing behind.
  assert.ok(fit.residual < 1e-9, `residual: ${fit.residual}`)
})

test("residual is near zero for a landmark set the template can reach", () => {
  // The template itself, moved and rotated: a perfectly cooperative "face".
  const placed = applyTransform(SFACE_TEMPLATE, { a: 3, b: 1, tx: 400, ty: 250 })
  assert.ok(fitSimilarity(placed, SFACE_TEMPLATE).residual < 1e-6)
})

test("MIRROR CHECK: swapping the two eyes spikes the fit residual", () => {
  const placed = applyTransform(SFACE_TEMPLATE, { a: 3, b: 1, tx: 400, ty: 250 })
  const correct = fitSimilarity(placed, SFACE_TEMPLATE).residual
  const swapped = fitSimilarity(swapEyeOrder(placed), SFACE_TEMPLATE).residual

  // Not "a bit worse" — a different order of magnitude, which is what makes a
  // threshold on this signal easy to set rather than a judgement call.
  assert.ok(swapped > 5, `swapped residual should be large, got ${swapped}`)
  assert.ok(swapped > correct + 5, `swapped ${swapped} vs correct ${correct}`)
})

test("MIRROR CHECK: a fully reflected landmark set cannot be fitted", () => {
  // Reflection is excluded from the transform family, so mirroring every point
  // has nowhere to hide either. This is the failure mode where the landmark
  // ORDER is right but the coordinate convention is flipped.
  const placed = applyTransform(SFACE_TEMPLATE, { a: 3, b: 1, tx: 400, ty: 250 })
  const reflected = placed.slice()
  for (let i = 0; i < reflected.length; i += 2) reflected[i] = 1000 - reflected[i]

  assert.ok(fitSimilarity(reflected, SFACE_TEMPLATE).residual > 5)
})

test("alignFace lands the landmarks on the template points", () => {
  const image = twoToneImage(400, 300)
  const landmarks = applyTransform(SFACE_TEMPLATE, { a: 1.4, b: 0.35, tx: 120, ty: 60 })

  const result = alignFace(image, landmarks)
  assert.equal(result.crop.width, 112)
  assert.equal(result.crop.height, 112)
  assert.equal(result.crop.rgb.length, 112 * 112 * 3)
  assert.ok(result.residual < 1e-6, `residual ${result.residual}`)

  // scale is template pixels per source pixel: the inverse of how big the face
  // was. hypot(1.4, 0.35) placed it, so aligning must undo exactly that.
  assert.ok(Math.abs(result.scale - 1 / Math.hypot(1.4, 0.35)) < 1e-6, `scale ${result.scale}`)
  assert.ok(result.outsideFraction < 1e-9, `outsideFraction ${result.outsideFraction}`)
})

test("alignFace reports the fraction that fell outside the frame", () => {
  const image = twoToneImage(400, 300)
  // Push the face mostly off the top-left corner.
  const landmarks = applyTransform(SFACE_TEMPLATE, { a: 1, b: 0, tx: -40, ty: -40 })
  const result = alignFace(image, landmarks)
  assert.ok(result.outsideFraction > 0.2, `outsideFraction ${result.outsideFraction}`)
})

test("mirrorCrop is its own inverse and actually flips", () => {
  const image = twoToneImage(8, 4)
  const once = mirrorCrop(image)
  const twice = mirrorCrop(once)
  assert.deepEqual(Array.from(twice.rgb), Array.from(image.rgb))
  // Left column was bright red, so after flipping the right column must be.
  assert.equal(once.rgb[(7) * 3], 220)
  assert.equal(once.rgb[0], 20)
})

test("fitSimilarity refuses degenerate input rather than returning nonsense", () => {
  assert.throws(() => fitSimilarity([1, 1, 1, 1], [0, 0, 5, 5]), /coincide/)
  assert.throws(() => fitSimilarity([0, 0], [0, 0, 1, 1]), /matching point lists/)
})
