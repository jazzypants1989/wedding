/** @file Frost shimmer — a frosted vignette at the page edges that gently
 *  breathes (opacity pulse). Single fixed overlay, pure CSS. */
/** @import * as Types from './types.js' */

/** @type {Types.createFrostShimmer} */
export function createFrostShimmer(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let overlay = null

  const opacity = cfg.opacity !== undefined ? cfg.opacity : 0.5
  const breatheSpeed = cfg.breatheSpeed !== undefined ? cfg.breatheSpeed : 9
  const color = cfg.color || "var(--fx-frost)"
  // How far the frost reaches in from the edges (transparent hole radius, %).
  const clearRadius = cfg.clearRadius !== undefined ? cfg.clearRadius : 42

  function start() {
    if (overlay) return

    overlay = document.createElement("div")
    overlay.className = "frost-shimmer"
    overlay.setAttribute("aria-hidden", "true")

    overlay.style.setProperty("--frost-opacity", String(opacity))
    overlay.style.animationDuration = breatheSpeed + "s"
    overlay.style.background =
      "radial-gradient(ellipse at center, transparent " +
      clearRadius +
      "%, " +
      color +
      " 130%)"

    document.body.appendChild(overlay)
  }

  function stop() {
    if (overlay) {
      overlay.remove()
      overlay = null
    }
  }

  return { start, stop }
}
