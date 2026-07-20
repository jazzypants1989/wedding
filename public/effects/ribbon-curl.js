/** @file Silk ribbons — glossy ribbons unfurling down the left/right page edges
 *  only, so they never cross the center content. Each ribbon scales down from
 *  the top with a soft curl, then fades and repeats. */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, cappedCount } from "./effect-utils.js"

const DEFAULT_COLORS = [
  "var(--fx-rose-2)",
  "var(--fx-rose-1)",
  "var(--fx-warm-1)",
]

// Absolute ceiling regardless of config: ribbons are large edge-hugging,
// will-change'd nodes — a handful reads as elegant; the schema max would not.
const MAX_RIBBONS = 24

/** @type {Types.createRibbonCurl} */
export function createRibbonCurl(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null
  /** Scoped to the current container; aborted (removing its viewport listener)
   *  in stop(). @type {AbortController | null} */
  let viewportWatch = null

  const ribbonCount = cfg.ribbonCount !== undefined ? cfg.ribbonCount : 6
  const colors = cfg.colors || DEFAULT_COLORS
  const unfurlDurationRange = cfg.unfurlDurationRange || [8, 16]
  const delayRange = cfg.delayRange || [0, 6]
  const widthRange = cfg.widthRange || [10, 22]

  function getCount() {
    return cappedCount(isMobile() ? Math.round(ribbonCount * 0.5) : ribbonCount, MAX_RIBBONS)
  }

  // Below this width, a ribbon's inset (as a % of viewport) plus its pixel
  // width can eat into the text gutter — clamp both tighter than the normal
  // envelope so ribbons stay hugging the physical edge on small phones.
  const NARROW_VIEWPORT_PX = 420
  const NARROW_MAX_INSET_PCT = 3
  const NARROW_MAX_WIDTH_PX = 14

  function isNarrowViewport() {
    return window.innerWidth <= NARROW_VIEWPORT_PX
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer ribbons-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    const narrow = isNarrowViewport()
    const maxInset = narrow ? NARROW_MAX_INSET_PCT : 8
    const effectiveWidthRange = narrow
      ? [
          Math.min(widthRange[0], NARROW_MAX_WIDTH_PX),
          Math.min(widthRange[1], NARROW_MAX_WIDTH_PX),
        ]
      : widthRange
    for (let i = 0; i < count; i++) {
      const ribbon = document.createElement("div")
      ribbon.className = "silk-ribbon"
      // Alternate edges: even → left edge, odd → right edge. Anchored within
      // the outer ~8% of the viewport (tighter on narrow screens, see above)
      // so a ribbon never covers center content.
      const edgeInset = randomBetween(0, maxInset)
      if (i % 2 === 0) ribbon.style.left = edgeInset + "%"
      else ribbon.style.right = edgeInset + "%"
      const width = randomBetween(effectiveWidthRange[0], effectiveWidthRange[1])
      const curl = randomBetween(4, 12) * (i % 2 === 0 ? 1 : -1)
      ribbon.style.width = width + "px"
      ribbon.style.height = randomBetween(40, 78) + "vh"
      ribbon.style.setProperty("--ribbon-color", randomFrom(colors))
      ribbon.style.setProperty("--curl", curl + "deg")
      ribbon.style.setProperty("--ribbon-opacity", String(randomBetween(0.3, 0.6)))
      ribbon.style.animationDuration =
        randomBetween(unfurlDurationRange[0], unfurlDurationRange[1]) + "s"
      ribbon.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"
      container.appendChild(ribbon)
    }

    document.body.appendChild(container)

    // The narrow-viewport clamps above are frozen at build time, so rotating a
    // phone would otherwise keep stale insets/widths. Rebuild only when the
    // viewport crosses the narrow threshold (matchMedia fires just on the
    // transition — no per-pixel resize thrash).
    viewportWatch = new AbortController()
    window
      .matchMedia("(max-width: " + NARROW_VIEWPORT_PX + "px)")
      .addEventListener(
        "change",
        function () {
          stop()
          start()
        },
        { signal: viewportWatch.signal },
      )
  }

  function stop() {
    if (viewportWatch) {
      viewportWatch.abort()
      viewportWatch = null
    }
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
