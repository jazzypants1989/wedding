/** @file Starfield — a scatter of small stars twinkling in place (pure CSS). */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween } from "./main.js"

const DEFAULT_COLORS = ["#ffffff", "#dbe9ff", "#fff4d6", "#c9d8ff"]

/** @type {Types.createStarfield} */
export function createStarfield(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const starCount = cfg.starCount !== undefined ? cfg.starCount : 70
  const colors = cfg.colors || DEFAULT_COLORS
  const sizeRange = cfg.sizeRange || [1, 3]
  const twinkleDurationRange = cfg.twinkleDurationRange || [2, 6]
  const delayRange = cfg.delayRange || [0, 6]

  function getCount() {
    return isMobile() ? Math.round(starCount * 0.5) : starCount
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer starfield-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      const star = document.createElement("div")
      star.className = "starfield-star"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const color = randomFrom(colors)
      star.style.width = size + "px"
      star.style.height = size + "px"
      star.style.left = randomBetween(0, 100) + "%"
      // Keep stars in the upper two-thirds so they read as sky, not confetti.
      star.style.top = randomBetween(0, 66) + "%"
      star.style.backgroundColor = color
      star.style.color = color // drives the currentColor glow in box-shadow
      star.style.setProperty("--star-opacity", String(randomBetween(0.35, 0.95)))
      star.style.animationDuration =
        randomBetween(twinkleDurationRange[0], twinkleDurationRange[1]) + "s"
      star.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"
      container.appendChild(star)
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
