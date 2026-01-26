/** @file Aurora borealis effect — flowing bands of color across the top of the viewport */

import { mapSlider } from "./effect-helpers.js"

export function createAuroraBorealis(config) {
  const cfg = config || {}
  let container = null

  const colorPalette = cfg.colorPalette || "cool"
  const intensity = cfg.intensity !== undefined ? cfg.intensity : 50
  const speed = cfg.speed !== undefined ? cfg.speed : 50

  function getSpeedMultiplier() {
    return mapSlider(speed, 2, 0.4, true)
  }

  function start() {
    if (container) return
    container = document.createElement("div")
    container.className = "effect-layer aurora-container"
    document.body.appendChild(container)

    const opacity = mapSlider(intensity, 0.04, 0.14)
    const speedMul = getSpeedMultiplier()
    const baseSpeeds = [10, 14, 18]

    for (let i = 0; i < 3; i++) {
      const layer = document.createElement("div")
      layer.className = "aurora-layer aurora-layer--" + (i + 1)

      if (colorPalette === "cool") {
        if (i === 0) layer.style.background = "linear-gradient(180deg, #00ff87 0%, #60efff 40%, transparent 100%)"
        if (i === 1) layer.style.background = "linear-gradient(180deg, #60efff 0%, #c44dff 50%, transparent 100%)"
        if (i === 2) layer.style.background = "linear-gradient(180deg, #c44dff 0%, #ff69b4 40%, transparent 100%)"
      } else if (colorPalette === "pastel") {
        if (i === 0) layer.style.background = "linear-gradient(180deg, #ffd1dc 0%, #c5b3e6 40%, transparent 100%)"
        if (i === 1) layer.style.background = "linear-gradient(180deg, #b5ead7 0%, #ffd1dc 50%, transparent 100%)"
        if (i === 2) layer.style.background = "linear-gradient(180deg, #c5b3e6 0%, #85e3ff 40%, transparent 100%)"
      } else {
        if (i === 0) layer.style.background = "linear-gradient(180deg, #ff6b6b 0%, #ffa500 40%, transparent 100%)"
        if (i === 1) layer.style.background = "linear-gradient(180deg, #ffa500 0%, #ff69b4 50%, transparent 100%)"
        if (i === 2) layer.style.background = "linear-gradient(180deg, #ff69b4 0%, #ffd700 40%, transparent 100%)"
      }

      layer.style.opacity = String(opacity)
      layer.style.animationDuration = (baseSpeeds[i] * speedMul) + "s"
      container.appendChild(layer)
    }
  }

  function stop() {
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
