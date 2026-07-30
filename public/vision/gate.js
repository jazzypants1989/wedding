/** @file The quality gate — in two halves, deliberately.
 *
 *  `gateSignals` MEASURES. `applyGate` DECIDES. They are separate functions
 *  because the spec requires every cutoff to be derived from the distribution of
 *  your own input, and a batch that filters as it runs has to guess those
 *  cutoffs before that distribution exists. Guess tight and you throw away faces
 *  and re-run detection to get them back; guess loose and the gate did nothing.
 *
 *  So session 1 records every signal unthresholded, describes every face, and
 *  sweeps the cutoffs offline against the labels. Describing a face the gate
 *  would have rejected costs about 5ms. Discovering the cutoff was wrong costs
 *  the whole run.
 *
 *  Discarding bad crops improves grouping more than any downstream threshold
 *  tuning. A gate that rejects a third of detections is doing its job.
 */
/** @import * as Types from './types.js' */

/** Rec.601 luma. Any reasonable weighting works; this one is conventional. */
const LUMA_R = 0.299
const LUMA_G = 0.587
const LUMA_B = 0.114

/** @type {Types.sharpness} */
export function sharpness(crop) {
  const { width, height, rgb } = crop
  if (width < 3 || height < 3) return 0

  const gray = new Float32Array(width * height)
  let sum = 0
  for (let i = 0, p = 0; i < gray.length; i++, p += 3) {
    const g = LUMA_R * rgb[p] + LUMA_G * rgb[p + 1] + LUMA_B * rgb[p + 2]
    gray[i] = g
    sum += g
  }
  const mean = sum / gray.length

  let variance = 0
  for (let i = 0; i < gray.length; i++) {
    const d = gray[i] - mean
    variance += d * d
  }
  variance /= gray.length

  // 4-neighbour Laplacian over the interior.
  let lapEnergy = 0
  let n = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
      lapEnergy += l * l
      n++
    }
  }
  if (n === 0) return 0

  // Two normalisations, both of which the spec insists on and both of which are
  // easy to leave out:
  //   - by COUNT (means, not sums), so the measure does not scale with crop area
  //     and reject small sharp faces while keeping large soft ones;
  //   - by local CONTRAST, so a high-contrast subject does not read as sharp.
  // Laplacian energy and variance both scale as the square of intensity, so the
  // ratio is invariant to exposure — which is the point.
  return lapEnergy / n / (variance + 1e-6)
}

/** @type {Types.gateSignals} */
export function gateSignals(input) {
  const { box, landmarks, imageWidth, imageHeight } = input

  const eyeDx = landmarks[2] - landmarks[0]
  const eyeDy = landmarks[3] - landmarks[1]
  const eyeSeparation = Math.hypot(eyeDx, eyeDy)

  return {
    score: input.score,
    boxPx: Math.min(box.w, box.h),
    // Negative when the box extends past the frame, which happens: the decode
    // has no clamp and a face at the edge gets a box that runs off it.
    borderPx: Math.min(box.x, box.y, imageWidth - (box.x + box.w), imageHeight - (box.y + box.h)),
    // Doubles as the pose proxy. A face turned away has one eye occluded or
    // foreshortened, so its eyes crowd together relative to the box — and those
    // are precisely the crops whose five-point alignment is poor, which is what
    // pollutes grouping. Well below the band it is more likely a mirrored
    // landmark order than a profile, and both must go.
    eyeRatio: box.w > 0 ? eyeSeparation / box.w : 0,
    // Tilt of the eye line. Not a rejection on its own — alignment corrects
    // rotation — but extreme values pair with bad landmarks.
    eyeAngle: Math.atan2(eyeDy, eyeDx),
    alignScale: input.alignScale,
    residual: input.residual,
    outsideFraction: input.outsideFraction,
    sharpness: sharpness(input.crop),
  }
}

/**
 * Checks in cost order, cheapest first. The order is what `primaryReason`
 * reports, so a face rejected for three things is attributed to the one that
 * would have caught it first.
 * @type {Array<{ key: string, test: (s: Types.GateSignals, c: Record<string, number>) => boolean }>}
 */
const CHECKS = [
  { key: "score", test: (s, c) => s.score < (c.minScore ?? 0) },
  { key: "boxPx", test: (s, c) => s.boxPx < c.minBoxPx },
  { key: "border", test: (s, c) => s.borderPx < c.minBorderPx },
  { key: "eyeRatioLow", test: (s, c) => s.eyeRatio < c.minEyeRatio },
  { key: "eyeRatioHigh", test: (s, c) => s.eyeRatio > c.maxEyeRatio },
  { key: "residual", test: (s, c) => s.residual > c.maxResidual },
  { key: "alignScale", test: (s, c) => s.alignScale > c.maxAlignScale },
  { key: "outside", test: (s, c) => s.outsideFraction > c.maxOutside },
  { key: "sharpness", test: (s, c) => s.sharpness < c.minSharpness },
]

/** @type {Types.applyGate} */
export function applyGate(signals, cutoffs) {
  /** @type {string[]} */
  const reasons = []
  for (const check of CHECKS) {
    if (check.test(signals, cutoffs)) reasons.push(check.key)
  }
  return { pass: reasons.length === 0, reasons, primaryReason: reasons[0] ?? null }
}

/** @type {Types.gateCheckKeys} */
export function gateCheckKeys() {
  return CHECKS.map((c) => c.key)
}
