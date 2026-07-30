/** @file The pure-numeric half of detection: geometry the engine does not own.
 *
 *  The engine (a borrowed runtime, in `tmp/rig/`, never imported by this repo)
 *  produces boxes and landmarks in whatever frame it was run in. Everything that
 *  happens to those numbers afterwards lives here, so it is testable without a
 *  model file and ships unchanged when the hand-written kernels replace the
 *  borrowed runtime.
 *
 *  Two operations, both of which are easy to get almost right:
 *
 *  **Scaling back to source pixels.** Detection runs on a downsample; crops are
 *  taken from a larger buffer. The factor must be the ratio `boxDownsample`
 *  actually achieved, not the one it was asked for — rounding makes them differ,
 *  and the difference is a sub-pixel drift that grows with distance from the
 *  origin and reads as a badly-calibrated detector.
 *
 *  **De-duplicating after NMS.** NMS already ran inside the engine, so this looks
 *  redundant. It is not: two boxes that survive NMS on one face become a
 *  permanent cannot-link split in `groupFaces` (two faces in one photograph are
 *  by construction different people) AND a false different-person pair in the
 *  metrics, which quietly widens the same-person distribution. Both are worse
 *  than simply losing the second detection, which is why `duplicateIou` (0.55)
 *  is deliberately looser than `nmsIou` (0.3).
 */
/** @import * as Types from './types.js' */

/** @type {Types.boxIou} */
export function boxIou(a, b) {
  const areaA = a.w * a.h
  const areaB = b.w * b.h
  // A zero-area box has no meaningful overlap with anything, including itself.
  // Without this the union below is 0 for two degenerate boxes and the caller
  // gets NaN, which compares false against every cutoff and so silently keeps
  // every duplicate.
  if (!(areaA > 0) || !(areaB > 0)) return 0

  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)

  const iw = x1 - x0
  const ih = y1 - y0
  if (iw <= 0 || ih <= 0) return 0

  const intersection = iw * ih
  const union = areaA + areaB - intersection
  return union > 0 ? intersection / union : 0
}

/** @type {Types.scaleDetections} */
export function scaleDetections(detections, scale) {
  // 1/0 is Infinity and 1/NaN is NaN; both would propagate into boxes that look
  // like detections and fail every downstream check for the wrong reason.
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new Error(`scaleDetections needs a positive finite scale, got ${scale}`)
  }
  const inv = 1 / scale

  return detections.map((d) => {
    /** @type {number[]} */
    const landmarks = new Array(d.landmarks.length)
    for (let i = 0; i < d.landmarks.length; i++) landmarks[i] = d.landmarks[i] * inv
    return {
      box: { x: d.box.x * inv, y: d.box.y * inv, w: d.box.w * inv, h: d.box.h * inv },
      landmarks,
      score: d.score,
    }
  })
}

/** @type {Types.dedupeDetections} */
export function dedupeDetections(detections, iou) {
  // Score descending, then a fixed geometric tie-break. The tie-break is the
  // whole reason this is order-independent: `sort` is stable, so equal scores
  // would otherwise resolve to whatever order the engine happened to emit, and
  // "which of the two duplicates survived" would vary run to run.
  const ordered = detections.slice().sort((p, q) => {
    if (q.score !== p.score) return q.score - p.score
    if (p.box.x !== q.box.x) return p.box.x - q.box.x
    if (p.box.y !== q.box.y) return p.box.y - q.box.y
    if (p.box.w !== q.box.w) return p.box.w - q.box.w
    return p.box.h - q.box.h
  })

  /** @type {Types.Detection[]} */
  const kept = []
  for (const candidate of ordered) {
    let duplicate = false
    for (const k of kept) {
      if (boxIou(candidate.box, k.box) > iou) {
        duplicate = true
        break
      }
    }
    if (!duplicate) kept.push(candidate)
  }
  return kept
}
