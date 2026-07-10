/** @file Pure dress-code content-image descriptor helpers — no DOM imports, so
 *  the srcset/width math is unit-testable in Node (tests/unit/dresscode-descriptor.test.js)
 *  and shared by the admin Site-content tab (site-content.js). No regex.
 */
/** @import * as Types from './types.js' */
/** @import * as Components from '../../components/types.js' */

/** Default `sizes` for uploaded figures (matches the shipped defaults in content.js). */
export const DRESSCODE_SIZES = "(min-width: 400px) 400px, 100vw"

// Responsive width ladder for content uploads. Names + long edges MUST match the
// server's CONTENT_IMAGE_LADDER (types.js) and VARIANT_SPEC (api/media.js).
/** @type {Components.ImageVariantSpec[]} */
export const DRESSCODE_LADDER = [
  { name: "w400", maxEdge: 400, quality: 0.72 },
  { name: "w800", maxEdge: 800, quality: 0.78 },
  { name: "w1600", maxEdge: 1600, quality: 0.82 },
]

/**
 * Build a SiteContentImage from a finished content upload. srcset carries each
 * ladder rung at its actual pixel width (computed from intrinsic dims, deduped
 * for small images that don't upscale); src is the largest rung. When every rung
 * collapses to the same width (a small image), srcset/sizes are null so the
 * browser just uses src.
 * @param {{ fileKey: string, width: number, height: number }} item
 * @returns {Types.SiteContentImage}
 */
export function buildDressCodeDescriptor(item) {
  const key = item.fileKey
  const w = item.width
  const h = item.height
  const longEdge = Math.max(w, h, 1)
  /** @type {Set<number>} */
  const seenWidths = new Set()
  const parts = []
  for (const rung of DRESSCODE_LADDER) {
    const scale = Math.min(1, rung.maxEdge / longEdge)
    const variantW = Math.max(1, Math.round(w * scale))
    if (seenWidths.has(variantW)) continue
    seenWidths.add(variantW)
    parts.push("/media/" + key + "/" + rung.name + " " + variantW + "w")
  }
  const hasSrcset = parts.length > 1
  return {
    src: "/media/" + key + "/w1600",
    srcset: hasSrcset ? parts.join(", ") : null,
    sizes: hasSrcset ? DRESSCODE_SIZES : null,
    alt: "",
    caption: null,
    width: w > 0 ? w : null,
    height: h > 0 ? h : null,
  }
}
