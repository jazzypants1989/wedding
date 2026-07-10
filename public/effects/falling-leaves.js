/** @file Falling leaves — autumn leaves tumbling down with sway and spin (pure CSS). */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween } from "./main.js"

const DEFAULT_COLORS = ["#d98634", "#c25b28", "#e0a83c", "#8a9a3b", "#b7502a"]

/** @type {Types.createFallingLeaves} */
export function createFallingLeaves(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const leafCount = cfg.leafCount !== undefined ? cfg.leafCount : 16
  const colors = cfg.colors || DEFAULT_COLORS
  const fallDurationRange = cfg.fallDurationRange || [7, 14]
  const delayRange = cfg.delayRange || [0, 9]
  const sizeRange = cfg.sizeRange || [10, 20]
  const swayRange = cfg.swayRange || [30, 80]

  function getCount() {
    return isMobile() ? Math.round(leafCount * 0.5) : leafCount
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer falling-leaves-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      const leaf = document.createElement("div")
      leaf.className = "falling-leaf"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const sway = randomBetween(swayRange[0], swayRange[1]) * (Math.random() < 0.5 ? -1 : 1)
      const spin = randomBetween(360, 900) * (Math.random() < 0.5 ? -1 : 1)
      leaf.style.width = size + "px"
      leaf.style.height = size * 0.7 + "px"
      leaf.style.left = randomBetween(0, 100) + "%"
      leaf.style.backgroundColor = randomFrom(colors)
      leaf.style.setProperty("--sway", sway + "px")
      leaf.style.setProperty("--spin", spin + "deg")
      leaf.style.setProperty("--leaf-opacity", String(randomBetween(0.5, 0.85)))
      leaf.style.animationDuration =
        randomBetween(fallDurationRange[0], fallDurationRange[1]) + "s"
      leaf.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"
      container.appendChild(leaf)
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
