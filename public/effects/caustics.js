/** @file Underwater caustics — light refraction patterns rippling across the page */
/** @import * as Types from './types.js' */

import { mapSlider } from "./main.js"

/** @type {Types.createCaustics} */
export function createCaustics(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const intensity = cfg.intensity !== undefined ? cfg.intensity : 50
  const speed = cfg.speed !== undefined ? cfg.speed : 50

  function start() {
    if (container) return
    container = document.createElement("div")
    container.className = "effect-layer caustics-container"
    container.setAttribute("aria-hidden", "true")
    container.style.zIndex = "40"
    container.style.mixBlendMode = "overlay"
    document.body.appendChild(container)

    const opacity = mapSlider(intensity, 0.03, 0.1)
    const durations = [
      mapSlider(speed, 15, 5, true),
      mapSlider(speed, 20, 7, true),
      mapSlider(speed, 25, 9, true),
    ]

    for (let i = 0; i < 3; i++) {
      const layer = document.createElement("div")
      layer.className = "caustics-layer caustics-layer-" + (i + 1)
      layer.style.opacity = String(opacity)
      layer.style.animationDuration = durations[i] + "s"
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
