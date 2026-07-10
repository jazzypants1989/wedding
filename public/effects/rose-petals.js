/** @file Rose petals — soft petals drifting down with lateral sway and spin. */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween } from "./effect-utils.js"

const DEFAULT_COLORS = [
  "var(--fx-rose-1)",
  "var(--fx-rose-3)",
  "var(--fx-rose-2)",
  "var(--fx-rose-2)",
]

/** @type {Types.createRosePetals} */
export function createRosePetals(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const petalCount = cfg.petalCount !== undefined ? cfg.petalCount : 18
  const colors = cfg.colors || DEFAULT_COLORS
  const fallDurationRange = cfg.fallDurationRange || [6, 12]
  const delayRange = cfg.delayRange || [0, 8]
  const sizeRange = cfg.sizeRange || [10, 20]
  const swayRange = cfg.swayRange || [20, 60]

  function getCount() {
    return isMobile() ? Math.round(petalCount * 0.5) : petalCount
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer rose-petals-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      const petal = document.createElement("div")
      petal.className = "rose-petal"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const sway = randomBetween(swayRange[0], swayRange[1]) * (Math.random() < 0.5 ? -1 : 1)
      petal.style.width = size + "px"
      petal.style.height = size * 0.85 + "px"
      petal.style.left = randomBetween(0, 100) + "%"
      petal.style.backgroundColor = randomFrom(colors)
      petal.style.setProperty("--sway", sway + "px")
      petal.style.setProperty("--petal-opacity", String(randomBetween(0.45, 0.8)))
      petal.style.animationDuration =
        randomBetween(fallDurationRange[0], fallDurationRange[1]) + "s"
      petal.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"
      container.appendChild(petal)
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
