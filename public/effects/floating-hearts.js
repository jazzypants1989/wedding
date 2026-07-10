/** @file Floating hearts — small hearts rising and fading with a gentle drift. */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween } from "./effect-utils.js"
import { EFFECT_PALETTE } from "./config.js"

const DEFAULT_COLORS = [
  EFFECT_PALETTE.brand,
  EFFECT_PALETTE.pink,
  "#ff8fa3",
  EFFECT_PALETTE.blush,
]

/** @type {Types.createFloatingHearts} */
export function createFloatingHearts(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const heartCount = cfg.heartCount !== undefined ? cfg.heartCount : 14
  const colors = cfg.colors || DEFAULT_COLORS
  const riseDurationRange = cfg.riseDurationRange || [7, 13]
  const delayRange = cfg.delayRange || [0, 9]
  const sizeRange = cfg.sizeRange || [10, 18]
  const driftRange = cfg.driftRange || [15, 50]

  function getCount() {
    return isMobile() ? Math.round(heartCount * 0.5) : heartCount
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer floating-hearts-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      // Outer element owns the rise/drift motion; inner shape owns the static
      // -45deg rotation that forms the heart — keeps the two transforms apart.
      const heart = document.createElement("div")
      heart.className = "floating-heart"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const drift = randomBetween(driftRange[0], driftRange[1]) * (Math.random() < 0.5 ? -1 : 1)
      heart.style.left = randomBetween(0, 100) + "%"
      heart.style.setProperty("--drift", drift + "px")
      heart.style.setProperty("--heart-opacity", String(randomBetween(0.4, 0.75)))
      heart.style.animationDuration =
        randomBetween(riseDurationRange[0], riseDurationRange[1]) + "s"
      heart.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"

      const shape = document.createElement("div")
      shape.className = "floating-heart-shape"
      shape.style.width = size + "px"
      shape.style.height = size + "px"
      shape.style.backgroundColor = randomFrom(colors)
      heart.appendChild(shape)

      container.appendChild(heart)
    }

    document.body.appendChild(container)
  }

  function stop() {
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
