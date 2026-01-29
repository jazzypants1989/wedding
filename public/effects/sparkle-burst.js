/** @file Page load sparkle burst — cascading sparkles on first load */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, mapSlider } from "./main.js"
import { EFFECT_PALETTE } from "./config.js"

const DEFAULT_COLORS = [
  EFFECT_PALETTE.white,
  EFFECT_PALETTE.gold,
  EFFECT_PALETTE.blush,
  EFFECT_PALETTE.brand,
  EFFECT_PALETTE.sky,
  EFFECT_PALETTE.purple,
]

/** @type {Types.createSparkleBurst} */
export function createSparkleBurst(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null
  let remaining = 0

  const particleCountSlider =
    cfg.particleCount !== undefined ? cfg.particleCount : 50
  const colors = cfg.colors || DEFAULT_COLORS

  function getCount() {
    const base = isMobile() ? 25 : 50
    return Math.round(mapSlider(particleCountSlider, base * 0.4, base * 2))
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer"
    container.setAttribute("aria-hidden", "true")
    container.addEventListener("animationend", function (e) {
      const target = /** @type {HTMLElement} */ (e.target)
      if (target.classList.contains("sparkle-burst-particle")) {
        target.remove()
        remaining--
        if (remaining <= 0 && container) {
          container.remove()
          container = null
        }
      }
    })
    document.body.appendChild(container)

    const count = getCount()
    remaining = count

    for (let i = 0; i < count; i++) {
      const sparkle = document.createElement("div")
      sparkle.className = "sparkle-burst-particle"

      sparkle.style.left = Math.random() * 100 + "%"
      sparkle.style.backgroundColor = randomFrom(colors)

      const delay = Math.random() * 0.8
      sparkle.style.animationDelay = delay + "s"

      const duration = randomBetween(1.5, 3)
      sparkle.style.animationDuration = duration + "s"

      const drift = randomBetween(-40, 40)
      sparkle.style.setProperty("--burst-drift", drift + "px")

      const scale = randomBetween(0.5, 1.5)
      sparkle.style.setProperty("--burst-scale", String(scale))

      container.appendChild(sparkle)
    }
  }

  function stop() {
    remaining = 0
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
