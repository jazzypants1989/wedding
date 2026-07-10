/** @file Snowfall — soft flakes drifting down with lateral sway (pure CSS). */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween } from "./effect-utils.js"

const DEFAULT_COLORS = ["#ffffff", "#eaf4ff", "#dcefff"]

/** @type {Types.createSnowfall} */
export function createSnowfall(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const flakeCount = cfg.flakeCount !== undefined ? cfg.flakeCount : 40
  const colors = cfg.colors || DEFAULT_COLORS
  const fallDurationRange = cfg.fallDurationRange || [6, 13]
  const delayRange = cfg.delayRange || [0, 10]
  const sizeRange = cfg.sizeRange || [3, 8]
  const swayRange = cfg.swayRange || [15, 55]

  function getCount() {
    return isMobile() ? Math.round(flakeCount * 0.5) : flakeCount
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer snowfall-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      const flake = document.createElement("div")
      flake.className = "snow-flake"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const sway = randomBetween(swayRange[0], swayRange[1]) * (Math.random() < 0.5 ? -1 : 1)
      flake.style.width = size + "px"
      flake.style.height = size + "px"
      flake.style.left = randomBetween(0, 100) + "%"
      flake.style.backgroundColor = randomFrom(colors)
      flake.style.setProperty("--sway", sway + "px")
      flake.style.setProperty("--flake-opacity", String(randomBetween(0.4, 0.9)))
      flake.style.animationDuration =
        randomBetween(fallDurationRange[0], fallDurationRange[1]) + "s"
      flake.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"
      container.appendChild(flake)
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
