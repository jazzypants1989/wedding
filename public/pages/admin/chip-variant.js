/** @file Which stored variant a face chip should load: the 400px `thumb` when it
 *  already holds enough pixels for the chip, else the 1600px+ `display`.
 *
 *  Pure arithmetic over the variant size, the face box and the chip's size —
 *  no photograph is looked at, and nothing measured from one is recorded. It
 *  matters once the admin runs against the VPS: a chip of a large face does not
 *  need a multi-megabyte `display` fetch over a slow link.
 */
/** @import * as Types from "./types.js" */

/** `thumb`'s long edge. Both writers agree (public/components/media-processing.js
 *  and scripts/lib/media-variants.js), and neither ever upscales. */
export const THUMB_LONG_EDGE = 400

/** @type {Types.chipVariant} */
export function chipVariant(entry, pad, cssPx, dpr) {
  const box = entry.box
  const longEdge = Math.max(entry.width ?? 0, entry.height ?? 0)
  // Unknown geometry: nothing to reason from, so take the sharp copy.
  if (!box || box.w <= 0 || box.h <= 0 || longEdge <= 0 || !Number.isFinite(cssPx)) {
    return "display"
  }
  const thumbScale = Math.min(1, THUMB_LONG_EDGE / longEdge)
  // positionFaceChipImage scales the padded box to COVER the chip, so its
  // shorter side is what gets stretched across the chip.
  const facePxInThumb = Math.min(box.w, box.h) * Math.max(pad, 1) * thumbScale
  return facePxInThumb >= cssPx * Math.max(dpr, 1) ? "thumb" : "display"
}
