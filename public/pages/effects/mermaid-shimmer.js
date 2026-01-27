/** @file Mermaid shimmer effect — iridescent holographic overlay */
/** @import * as Types from './types.js' */

import { mapSlider } from "./effect-helpers.js"

const PALETTES = {
  iridescent: "#ff6b9d 0%, #c44dff 15%, #6bc5ff 30%, #45ffa5 45%, #ffe74d 60%, #ff6b9d 75%, #c44dff 90%, #6bc5ff 100%",
  ocean: "#006994 0%, #40e0d0 20%, #87ceeb 40%, #4169e1 60%, #00bfff 80%, #006994 100%",
  sunset: "#ff6b6b 0%, #ffa500 20%, #ff69b4 40%, #ff4500 60%, #ffd700 80%, #ff6b6b 100%",
}

/** @type {Types.createMermaidShimmer} */
export function createMermaidShimmer(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let overlay = null

  const opacityCfg = cfg.opacity !== undefined ? cfg.opacity : 50
  const gradientSpeed = cfg.gradientSpeed !== undefined ? cfg.gradientSpeed : 50
  const colorPalette = cfg.colorPalette || "iridescent"
  const scaleSize = cfg.scaleSize !== undefined ? cfg.scaleSize : 50

  function start() {
    if (overlay) return

    overlay = document.createElement("div")
    overlay.className = "mermaid-shimmer"

    const opacity = mapSlider(opacityCfg, 0.03, 0.15)
    overlay.style.opacity = String(opacity)

    const duration = mapSlider(gradientSpeed, 15, 3, true)
    overlay.style.animationDuration = duration + "s"

    const gradientColors = PALETTES[colorPalette] || PALETTES.iridescent
    overlay.style.background = "linear-gradient(135deg, " + gradientColors + ")"
    overlay.style.backgroundSize = "400% 400%"

    const patternSize = Math.round(mapSlider(scaleSize, 25, 60))
    overlay.style.setProperty("--scale-pattern-size", patternSize + "px")

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
