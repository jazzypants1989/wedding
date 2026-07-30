/** @file Five landmarks in, one 112x112 crop out.
 *
 *  Alignment matters more for this recogniser than for most. Its final layer
 *  flattens a 7x7 spatial grid instead of pooling it, so it has no translation
 *  invariance at the end: a crop off by a few pixels shifts every one of 50,176
 *  inputs to that layer. Getting this stage right is worth more than any
 *  downstream threshold.
 *
 *  Pure numeric JS — no node:*, no DOM. That is enforced rather than trusted:
 *  public/tsconfig.json declares no `types: ["node"]`, so a node: import fails
 *  `npm run typecheck`.
 */
/** @import * as Types from './types.js' */

/**
 * The canonical five-point template, in 112x112 output pixels, from
 * `getSimilarityTransformMatrix` in OpenCV's face_recognize.cpp.
 *
 * Order is right eye, left eye, nose tip, right mouth corner, left mouth corner
 * — where "right" means the SUBJECT's right, which is the image's left. It maps
 * onto the detector's landmark columns 4-13 with no permutation.
 *
 * This lives here as the default only. The real source is the tensor pack's
 * metadata (spec §3.1), so that a model swap cannot desynchronise the template
 * from the weights that were trained against it.
 */
export const SFACE_TEMPLATE = Object.freeze([
  38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041,
])

/** Landmark names, in the order the coordinates arrive. */
export const LANDMARK_ORDER = Object.freeze([
  "rightEye",
  "leftEye",
  "nose",
  "rightMouth",
  "leftMouth",
])

/** @type {Types.fitSimilarity} */
export function fitSimilarity(src, dst) {
  const n = src.length / 2
  if (n < 2 || dst.length !== src.length) {
    throw new Error(`fitSimilarity: need matching point lists of 2+, got ${src.length}/${dst.length}`)
  }

  let sx = 0
  let sy = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    sx += src[i * 2]
    sy += src[i * 2 + 1]
    dx += dst[i * 2]
    dy += dst[i * 2 + 1]
  }
  sx /= n
  sy /= n
  dx /= n
  dy /= n

  // The closed-form least-squares similarity (rotation + uniform scale +
  // translation, no shear and NO REFLECTION). Excluding reflection is what makes
  // the residual below a mirror detector: a mirrored point set cannot be fitted
  // by anything in this family, so the error has nowhere to hide.
  let denom = 0
  let aNum = 0
  let bNum = 0
  for (let i = 0; i < n; i++) {
    const px = src[i * 2] - sx
    const py = src[i * 2 + 1] - sy
    const qx = dst[i * 2] - dx
    const qy = dst[i * 2 + 1] - dy
    denom += px * px + py * py
    aNum += px * qx + py * qy
    bNum += px * qy - py * qx
  }
  if (denom === 0) throw new Error("fitSimilarity: all source points coincide")

  const a = aNum / denom
  const b = bNum / denom
  const tx = dx - a * sx + b * sy
  const ty = dy - b * sx - a * sy

  // RMS distance between each mapped source point and where the template wanted
  // it, in output pixels.
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const mx = a * src[i * 2] - b * src[i * 2 + 1] + tx
    const my = b * src[i * 2] + a * src[i * 2 + 1] + ty
    const ex = mx - dst[i * 2]
    const ey = my - dst[i * 2 + 1]
    sumSq += ex * ex + ey * ey
  }

  return {
    a,
    b,
    tx,
    ty,
    scale: Math.hypot(a, b),
    rotation: Math.atan2(b, a),
    residual: Math.sqrt(sumSq / n),
  }
}

/** @type {Types.alignFace} */
export function alignFace(image, landmarks, options = {}) {
  const size = options.size ?? 112
  const template = options.template ?? SFACE_TEMPLATE
  const transform = fitSimilarity(landmarks, template)

  const { a, b, tx, ty } = transform
  const det = a * a + b * b
  if (det === 0) throw new Error("alignFace: degenerate transform")

  const rgb = new Uint8Array(size * size * 3)
  const { width, height } = image
  const src = image.rgb
  let outside = 0

  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      // Destination integer coordinates through the inverse transform, matching
      // OpenCV's warpAffine convention (no half-pixel offset) so that our crops
      // and the reference implementation's are the same crops.
      const px = ox - tx
      const py = oy - ty
      const fx = (a * px + b * py) / det
      const fy = (a * py - b * px) / det

      if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1) outside++

      // Clamped bilinear. Clamping rather than zero-filling keeps a face that
      // runs slightly off-frame usable; `outside` is reported so the gate can
      // decide, instead of this function deciding for it.
      const cx = fx < 0 ? 0 : fx > width - 1 ? width - 1 : fx
      const cy = fy < 0 ? 0 : fy > height - 1 ? height - 1 : fy
      const x0 = Math.floor(cx)
      const y0 = Math.floor(cy)
      const x1 = x0 + 1 < width ? x0 + 1 : x0
      const y1 = y0 + 1 < height ? y0 + 1 : y0
      const wx = cx - x0
      const wy = cy - y0
      const w00 = (1 - wx) * (1 - wy)
      const w10 = wx * (1 - wy)
      const w01 = (1 - wx) * wy
      const w11 = wx * wy

      const i00 = (y0 * width + x0) * 3
      const i10 = (y0 * width + x1) * 3
      const i01 = (y1 * width + x0) * 3
      const i11 = (y1 * width + x1) * 3
      const out = (oy * size + ox) * 3

      for (let c = 0; c < 3; c++) {
        rgb[out + c] =
          src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11 + 0.5
      }
    }
  }

  return {
    crop: { width: size, height: size, rgb },
    transform,
    // Above 1, the template is larger than the face was in the source: we are
    // upsampling, inventing detail the recogniser will happily describe.
    scale: transform.scale,
    residual: transform.residual,
    outsideFraction: outside / (size * size),
  }
}

/** @type {Types.mirrorCrop} */
export function mirrorCrop(image) {
  const { width, height, rgb } = image
  const out = new Uint8Array(rgb.length)
  for (let y = 0; y < height; y++) {
    const row = y * width * 3
    for (let x = 0; x < width; x++) {
      const from = row + x * 3
      const to = row + (width - 1 - x) * 3
      out[to] = rgb[from]
      out[to + 1] = rgb[from + 1]
      out[to + 2] = rgb[from + 2]
    }
  }
  return { width, height, rgb: out }
}

/** @type {Types.swapEyeOrder} */
export function swapEyeOrder(landmarks) {
  // Only ever used to prove the residual check works. If a real pipeline needs
  // this, the landmark order is wrong somewhere upstream and should be fixed
  // there, in the pack metadata, not patched here.
  const out = landmarks.slice()
  out[0] = landmarks[2]
  out[1] = landmarks[3]
  out[2] = landmarks[0]
  out[3] = landmarks[1]
  return out
}
