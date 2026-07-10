/** @file Shooting stars — occasional diagonal streaks across the sky (pure CSS). */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween } from "./effect-utils.js"

const DEFAULT_COLORS = ["#ffffff", "#eaf2ff", "#fff4d6"]

/** @type {Types.createShootingStars} */
export function createShootingStars(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const streakCount = cfg.streakCount !== undefined ? cfg.streakCount : 5
  const colors = cfg.colors || DEFAULT_COLORS
  // The full repeat cycle. The streak flashes in the first ~20% of each cycle
  // (see @keyframes shooting-star-streak) and the rest is a dark gap, so a long
  // cycle + staggered delays makes streaks feel rare rather than a shower.
  const cycleDurationRange = cfg.cycleDurationRange || [5, 11]
  const delayRange = cfg.delayRange || [0, 12]
  const lengthRange = cfg.lengthRange || [120, 220]

  function getCount() {
    return isMobile() ? Math.max(2, Math.round(streakCount * 0.6)) : streakCount
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer shooting-stars-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      const streak = document.createElement("div")
      streak.className = "shooting-star"
      const color = randomFrom(colors)
      const length = randomBetween(lengthRange[0], lengthRange[1])
      // Spawn from the upper band and streak down-right at a shallow angle.
      streak.style.left = randomBetween(-10, 70) + "%"
      streak.style.top = randomBetween(0, 45) + "%"
      streak.style.width = length + "px"
      streak.style.setProperty("--streak-color", color)
      streak.style.setProperty("--streak-angle", randomBetween(18, 34) + "deg")
      streak.style.setProperty("--streak-travel", randomBetween(60, 90) + "vw")
      streak.style.animationDuration =
        randomBetween(cycleDurationRange[0], cycleDurationRange[1]) + "s"
      streak.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"
      container.appendChild(streak)
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
