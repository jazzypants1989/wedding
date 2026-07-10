/** @file Aurora wash — a slow, soft gradient band drifting across the top of the
 *  page. Generalizes the mermaid-shimmer engine (an animated linear-gradient) with
 *  night-sky palettes and no scale texture, so it reads as northern lights. Pure CSS.
 */
/** @import * as Types from './types.js' */

import { isMobile } from "./main.js"

/** Named gradient stops. Cool aurora greens/teals/violets by default.
 *  @type {Record<string, string>} */
const PALETTES = {
  aurora: "#1f8a70 0%, #2ec4b6 22%, #4d6bff 45%, #8a4dff 68%, #2ec4b6 100%",
  polar: "#3ad6c5 0%, #6be0ff 30%, #b18cff 60%, #4d9bff 100%",
  dusk: "#5a4fcf 0%, #b06ab3 35%, #ff8fb1 70%, #5a4fcf 100%",
}

/** @type {Types.createAuroraWash} */
export function createAuroraWash(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let overlay = null

  const opacity = cfg.opacity !== undefined ? cfg.opacity : 0.16
  const speed = cfg.speed !== undefined ? cfg.speed : 24
  const palette = cfg.palette || "aurora"
  const height = cfg.height !== undefined ? cfg.height : 55
  const angle = cfg.angle !== undefined ? cfg.angle : 105

  function start() {
    if (overlay) return
    // Full-width animated gradient is too costly on small devices.
    if (isMobile()) return

    overlay = document.createElement("div")
    overlay.className = "aurora-wash"
    overlay.setAttribute("aria-hidden", "true")

    const stops = PALETTES[palette] || PALETTES.aurora
    overlay.style.opacity = String(opacity)
    overlay.style.height = height + "vh"
    overlay.style.animationDuration = speed + "s"
    overlay.style.background = "linear-gradient(" + angle + "deg, " + stops + ")"
    overlay.style.backgroundSize = "300% 300%"

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
