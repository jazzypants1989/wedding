/** @file The second level of duplicate detection: a perceptual frame hash.
 *
 *  `hashFile` in scripts/lib/import-manifest.js hashes raw file bytes, so it
 *  catches renames and byte-identical copies and nothing else. A photo delivery
 *  is full of the other case — the same frame exported twice, retouched, resized
 *  or re-encoded — and that case is the one that matters here. Two near-identical
 *  frames produce two near-identical descriptors, which collapses the same-person
 *  distance distribution toward zero and forges a good separation number
 *  (SPEC §7.2). The measurement would look better precisely because it measured
 *  less.
 *
 *  So: box-downsample to a `size`x`size` luma grid, threshold each cell at the
 *  grid's own mean, emit the bits as hex. Cheap, no frequency transform, and
 *  insensitive to exactly the things a re-encode changes — resolution, JPEG
 *  quality, a small global exposure shift — because the mean moves with them.
 *
 *  It is deliberately NOT a dedup filter. Near-duplicate pairs are recorded and
 *  kept; the report quantifies what excluding them was worth. A hash cannot tell
 *  a re-export from two frames of a burst, and the two deserve different
 *  treatment.
 *
 *  Rec.601 luma, matching `sharpness()` in gate.js — one luma convention in the
 *  pipeline, so two signals never disagree about what "bright" means.
 */
/** @import * as Types from './types.js' */

const LUMA_R = 0.299
const LUMA_G = 0.587
const LUMA_B = 0.114

/** Bits set per hex nibble, indexed by value. No regex, no string tricks. */
const NIBBLE_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

const HEX_DIGITS = "0123456789abcdef"

/**
 * Threshold slack, in luma units on a 0-255 scale.
 *
 * Cells do not all cover the same number of source pixels — 60 rows over 16
 * cells is a 3/4/3/4 pattern — so a perfectly flat frame produces cell means
 * that differ from each other, and from the overall mean, in the last few bits
 * of a double. Without slack those ulps become hash bits, and the "same wall,
 * two exports at different sizes" case scatters instead of matching. 1e-6 is
 * far below any difference a real frame carries and far above the error.
 */
const THRESHOLD_EPSILON = 1e-6

/**
 * Hex character to 0-15, or -1 for anything else. Accepts both cases: a hash
 * that has been round-tripped through an upper-casing tool is still a hash.
 * @param {number} code
 * @returns {number}
 */
function hexValue(code) {
  if (code >= 48 && code <= 57) return code - 48 // 0-9
  if (code >= 97 && code <= 102) return code - 87 // a-f
  if (code >= 65 && code <= 70) return code - 55 // A-F
  return -1
}

/** @type {Types.averageHash} */
export function averageHash(image, size = 16) {
  const { width, height, rgb } = image
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`averageHash needs a positive integer size, got ${size}`)
  }
  if (width < 1 || height < 1) {
    throw new Error(`averageHash needs a non-empty image, got ${width}x${height}`)
  }
  // Four bits per hex character, so an odd cell count would leave a half-written
  // nibble. size*size is even for every even size and odd for every odd one;
  // rather than pad, refuse — a 15x15 hash is nobody's requirement.
  const cells = size * size
  if (cells % 4 !== 0) {
    throw new Error(`averageHash needs size*size divisible by 4, got ${size}`)
  }

  // Area average over the source rectangle each cell covers, the same mapping
  // boxDownsample uses in scripts/vision/pixels-cli.js (inlined: public/vision/
  // may not import from scripts/). Nearest-neighbour sampling would alias, and
  // an aliased hash is unstable under exactly the resize a re-export applies —
  // which would defeat the entire point of the second level.
  const luma = new Float64Array(cells)
  let total = 0
  for (let cy = 0; cy < size; cy++) {
    const sy0 = Math.floor((cy * height) / size)
    const sy1 = Math.max(sy0 + 1, Math.floor(((cy + 1) * height) / size))
    for (let cx = 0; cx < size; cx++) {
      const sx0 = Math.floor((cx * width) / size)
      const sx1 = Math.max(sx0 + 1, Math.floor(((cx + 1) * width) / size))
      let sum = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        let si = (sy * width + sx0) * 3
        for (let sx = sx0; sx < sx1; sx++) {
          sum += LUMA_R * rgb[si] + LUMA_G * rgb[si + 1] + LUMA_B * rgb[si + 2]
          si += 3
          n++
        }
      }
      const value = sum / n
      luma[cy * size + cx] = value
      total += value
    }
  }

  const threshold = total / cells - THRESHOLD_EPSILON

  // MSB-first: cell 0 is the high bit of the first hex character, so two hashes
  // printed side by side line up with the grid read left to right, top to
  // bottom. A flat image is all-ones (every cell equals the mean, and the test
  // is >=), which is a recognisable "no information here" signature.
  let out = ""
  for (let i = 0; i < cells; i += 4) {
    let nibble = 0
    for (let b = 0; b < 4; b++) {
      nibble = (nibble << 1) | (luma[i + b] >= threshold ? 1 : 0)
    }
    out += HEX_DIGITS[nibble]
  }
  return out
}

/** @type {Types.hammingDistance} */
export function hammingDistance(a, b) {
  // -1 rather than a throw: comparing hashes of different sizes is a caller bug,
  // but it happens inside an O(n^2) pair loop where a throw would lose the run.
  // Every caller checks `>= 0` anyway, which also covers the malformed case.
  if (a.length !== b.length) return -1

  let bits = 0
  for (let i = 0; i < a.length; i++) {
    const va = hexValue(a.charCodeAt(i))
    const vb = hexValue(b.charCodeAt(i))
    if (va < 0 || vb < 0) return -1
    bits += NIBBLE_BITS[va ^ vb]
  }
  return bits
}
