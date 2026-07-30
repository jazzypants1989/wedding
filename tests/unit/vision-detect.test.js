/** @file Unit test: detection geometry — IoU, frame scaling, post-NMS dedup.
 *
 *  The load-bearing test in this file is order independence. `dedupeDetections`
 *  runs on whatever order the engine emitted, and if that order can change which
 *  of two duplicate boxes survives, then a face's crop — and therefore its
 *  descriptor, and therefore every distance it appears in — depends on an
 *  implementation detail of the runtime. The shuffle test pins that down.
 *
 *  Imports browser vision modules, so this file is excluded from the server
 *  tsconfig (see tsconfig.json) — same pattern as vision-align.test.js.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { boxIou, dedupeDetections, scaleDetections } from "../../public/vision/detect.js"

/** A detection with plausible five-point landmarks inside its box. */
function detection(x, y, w, h, score) {
  const landmarks = [
    x + w * 0.3,
    y + h * 0.35, // right eye
    x + w * 0.7,
    y + h * 0.35, // left eye
    x + w * 0.5,
    y + h * 0.55, // nose
    x + w * 0.35,
    y + h * 0.75, // right mouth
    x + w * 0.65,
    y + h * 0.75, // left mouth
  ]
  return { box: { x, y, w, h }, landmarks, score }
}

/** Deterministic shuffle, so a failure is reproducible rather than flaky. */
function shuffle(items, seed) {
  const out = items.slice()
  let state = seed
  for (let i = out.length - 1; i > 0; i--) {
    // Numerical Recipes LCG. Any generator does; determinism is the requirement.
    state = (state * 1664525 + 1013904223) % 4294967296
    const j = state % (i + 1)
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

function boxKeys(detections) {
  return detections.map((d) => `${d.box.x},${d.box.y},${d.box.w},${d.box.h}@${d.score}`)
}

// --- boxIou ---

test("boxIou of a box with itself is exactly 1", () => {
  const box = { x: 12, y: 34, w: 56, h: 78 }
  assert.equal(boxIou(box, box), 1)
  assert.equal(boxIou(box, { x: 12, y: 34, w: 56, h: 78 }), 1)
})

test("boxIou is 0 for disjoint boxes, including ones that merely touch", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 }
  assert.equal(boxIou(a, { x: 40, y: 40, w: 10, h: 10 }), 0)
  // Sharing an edge is not overlap: the intersection has zero area.
  assert.equal(boxIou(a, { x: 10, y: 0, w: 10, h: 10 }), 0)
  assert.equal(boxIou(a, { x: 0, y: 10, w: 10, h: 10 }), 0)
  // Disjoint on one axis only, overlapping on the other.
  assert.equal(boxIou(a, { x: 5, y: 20, w: 10, h: 10 }), 0)
})

test("boxIou matches a hand-computed half overlap", () => {
  // Two 10x10 boxes offset by 5 in x: intersection 5x10 = 50, union
  // 100 + 100 - 50 = 150, so 1/3.
  const iou = boxIou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 })
  assert.ok(Math.abs(iou - 1 / 3) < 1e-12, `expected 1/3, got ${iou}`)

  // One box wholly inside another, 4x the area: 25/100.
  const nested = boxIou({ x: 0, y: 0, w: 20, h: 20 }, { x: 5, y: 5, w: 10, h: 10 })
  assert.ok(Math.abs(nested - 0.25) < 1e-12, `expected 0.25, got ${nested}`)
})

test("boxIou is symmetric", () => {
  const a = { x: 3, y: 7, w: 21, h: 13 }
  const b = { x: 11, y: 2, w: 9, h: 30 }
  assert.equal(boxIou(a, b), boxIou(b, a))
})

test("boxIou returns 0 for zero-area boxes rather than NaN", () => {
  const real = { x: 0, y: 0, w: 10, h: 10 }
  const flat = { x: 0, y: 0, w: 0, h: 10 }
  const thin = { x: 0, y: 0, w: 10, h: 0 }
  const empty = { x: 0, y: 0, w: 0, h: 0 }

  // NaN would compare false against every cutoff and silently keep every
  // duplicate, which is the failure this guard exists to prevent.
  for (const degenerate of [flat, thin, empty]) {
    assert.equal(boxIou(real, degenerate), 0)
    assert.equal(boxIou(degenerate, real), 0)
    assert.equal(boxIou(degenerate, degenerate), 0)
  }
  // Negative extents are nonsense too, and must not produce a positive score.
  assert.equal(boxIou(real, { x: 0, y: 0, w: -10, h: -10 }), 0)
})

// --- dedupeDetections ---

test("dedupeDetections collapses two boxes on one face to the higher score", () => {
  const strong = detection(100, 100, 80, 80, 0.94)
  const weak = detection(104, 97, 78, 84, 0.71)
  assert.ok(boxIou(strong.box, weak.box) > 0.55, "fixture must actually overlap")

  const kept = dedupeDetections([weak, strong], 0.55)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].score, 0.94)
  assert.equal(kept[0].box.x, 100)
})

test("dedupeDetections keeps two genuinely separate faces", () => {
  const left = detection(40, 60, 90, 90, 0.88)
  const right = detection(400, 55, 85, 85, 0.81)
  assert.equal(boxIou(left.box, right.box), 0)

  const kept = dedupeDetections([left, right], 0.55)
  assert.equal(kept.length, 2)
  // Sorted by score descending regardless of input order.
  assert.deepEqual(
    kept.map((d) => d.score),
    [0.88, 0.81],
  )
})

test("dedupeDetections keeps neighbours that overlap below the cutoff", () => {
  // Two people standing close: the boxes touch but nowhere near 0.55.
  const a = detection(0, 0, 100, 100, 0.9)
  const b = detection(80, 0, 100, 100, 0.85)
  const iou = boxIou(a.box, b.box)
  assert.ok(iou > 0 && iou < 0.55, `fixture iou ${iou}`)
  assert.equal(dedupeDetections([a, b], 0.55).length, 2)
})

test("dedupeDetections is independent of input order", () => {
  const input = [
    detection(100, 100, 80, 80, 0.94), // face 1
    detection(104, 97, 78, 84, 0.71), // face 1 duplicate
    detection(400, 55, 85, 85, 0.81), // face 2
    detection(398, 58, 90, 82, 0.63), // face 2 duplicate
    detection(700, 300, 60, 60, 0.66), // face 3
    detection(40, 600, 120, 120, 0.99), // face 4
  ]
  const expected = boxKeys(dedupeDetections(input, 0.55))
  assert.equal(expected.length, 4)

  for (const seed of [1, 7, 12345, 99991, 2718281]) {
    const permuted = shuffle(input, seed)
    assert.deepEqual(boxKeys(dedupeDetections(permuted, 0.55)), expected, `seed ${seed}`)
  }
})

test("dedupeDetections breaks exact score ties deterministically", () => {
  // Equal scores are the case where a stable sort alone would leak input order.
  const a = detection(100, 100, 80, 80, 0.8)
  const b = detection(103, 102, 80, 80, 0.8)
  const first = dedupeDetections([a, b], 0.5)
  const second = dedupeDetections([b, a], 0.5)
  assert.equal(first.length, 1)
  assert.deepEqual(boxKeys(first), boxKeys(second))
})

test("dedupeDetections handles an empty array and a single detection", () => {
  assert.deepEqual(dedupeDetections([], 0.55), [])
  const only = detection(10, 10, 50, 50, 0.7)
  const kept = dedupeDetections([only], 0.55)
  assert.equal(kept.length, 1)
  assert.equal(kept[0], only)
})

test("dedupeDetections does not mutate its input", () => {
  const input = [
    detection(400, 55, 85, 85, 0.5),
    detection(100, 100, 80, 80, 0.94),
    detection(104, 97, 78, 84, 0.71),
  ]
  const before = JSON.stringify(input)
  dedupeDetections(input, 0.55)
  assert.equal(JSON.stringify(input), before, "input array was reordered or edited")
})

// --- scaleDetections ---

/**
 * The ratio `boxDownsample` in scripts/vision/pixels-cli.js actually achieves:
 * it rounds the destination dimensions, then reports width/sourceWidth. Inlined
 * rather than imported — that module is Node-side and this one is not.
 */
function achievedScale(width, height, maxEdge) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return 1
  return Math.max(1, Math.round(width * (maxEdge / longest))) / width
}

test("scaleDetections round-trips a detection through a downsample", () => {
  const scale = achievedScale(4032, 3024, 1280)
  const source = detection(1580.5, 900.25, 244, 261, 0.87)

  // What the engine would have seen: the same face in the detection frame.
  const inDetectFrame = {
    box: {
      x: source.box.x * scale,
      y: source.box.y * scale,
      w: source.box.w * scale,
      h: source.box.h * scale,
    },
    landmarks: source.landmarks.map((v) => v * scale),
    score: source.score,
  }

  const [back] = scaleDetections([inDetectFrame], scale)
  for (const key of ["x", "y", "w", "h"]) {
    assert.ok(Math.abs(back.box[key] - source.box[key]) < 1e-9, `${key}: ${back.box[key]}`)
  }
  assert.equal(back.landmarks.length, 10)
  for (let i = 0; i < source.landmarks.length; i++) {
    assert.ok(
      Math.abs(back.landmarks[i] - source.landmarks[i]) < 1e-9,
      `landmark ${i}: ${back.landmarks[i]} vs ${source.landmarks[i]}`,
    )
  }
  assert.equal(back.score, 0.87)
})

test("the achieved scale is not the requested ratio, which is why it is returned", () => {
  // A portrait frame whose short edge does not divide evenly. Scaling back with
  // the requested ratio instead of the achieved one is a drift that grows with
  // distance from the origin and reads as a miscalibrated detector.
  const requested = 1280 / 4000
  const achieved = achievedScale(3001, 4000, 1280)
  assert.notEqual(achieved, requested)

  const x = 900
  const [withAchieved] = scaleDetections([detection(x, 0, 10, 10, 1)], achieved)
  const [withRequested] = scaleDetections([detection(x, 0, 10, 10, 1)], requested)
  assert.ok(
    Math.abs(withAchieved.box.x - withRequested.box.x) > 0.1,
    "the two factors should visibly disagree at this distance",
  )
})

test("scaleDetections scales landmarks as well as boxes", () => {
  const d = {
    box: { x: 10, y: 20, w: 30, h: 40 },
    landmarks: [11, 21, 31, 41, 16, 30, 13, 50, 27, 52],
    score: 0.5,
  }
  const [out] = scaleDetections([d], 0.5)
  assert.deepEqual(out.box, { x: 20, y: 40, w: 60, h: 80 })
  assert.deepEqual(out.landmarks, [22, 42, 62, 82, 32, 60, 26, 100, 54, 104])
  assert.equal(out.score, 0.5)
})

test("scaleDetections returns new objects and does not mutate the input", () => {
  const d = {
    box: { x: 10, y: 20, w: 30, h: 40 },
    landmarks: [11, 21, 31, 41, 16, 30, 13, 50, 27, 52],
    score: 0.5,
  }
  const input = [d]
  const before = JSON.stringify(input)
  const out = scaleDetections(input, 0.25)

  assert.equal(JSON.stringify(input), before, "input detection was mutated")
  assert.notEqual(out, input)
  assert.notEqual(out[0], d)
  assert.notEqual(out[0].box, d.box)
  assert.notEqual(out[0].landmarks, d.landmarks)
})

test("scaleDetections is identity at scale 1 and handles an empty batch", () => {
  const d = detection(5, 6, 7, 8, 0.42)
  const [out] = scaleDetections([d], 1)
  assert.deepEqual(out.box, d.box)
  assert.deepEqual(out.landmarks, d.landmarks)
  assert.deepEqual(scaleDetections([], 0.5), [])
})

test("scaleDetections refuses a scale that would produce Infinity or NaN", () => {
  const batch = [detection(1, 2, 3, 4, 0.5)]
  for (const bad of [0, -0.5, NaN, Infinity]) {
    assert.throws(
      () => scaleDetections(batch, bad),
      (error) => error instanceof Error && error.message.includes("positive finite scale"),
      `scale ${bad} should be refused`,
    )
  }
})
