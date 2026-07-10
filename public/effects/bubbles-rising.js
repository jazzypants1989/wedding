/** @file Bubbles rising — translucent bubbles floating up with a lateral wobble. */
/** @import * as Types from './types.js' */

import { isMobile, randomBetween } from "./main.js"

/** @type {Types.createBubblesRising} */
export function createBubblesRising(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const bubbleCount = cfg.bubbleCount !== undefined ? cfg.bubbleCount : 20
  const riseDurationRange = cfg.riseDurationRange || [8, 16]
  const delayRange = cfg.delayRange || [0, 10]
  const sizeRange = cfg.sizeRange || [6, 22]
  const wobbleRange = cfg.wobbleRange || [15, 50]

  function getCount() {
    return isMobile() ? Math.round(bubbleCount * 0.5) : bubbleCount
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer bubbles-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      const bubble = document.createElement("div")
      bubble.className = "rising-bubble"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const wobble = randomBetween(wobbleRange[0], wobbleRange[1]) * (Math.random() < 0.5 ? -1 : 1)
      bubble.style.width = size + "px"
      bubble.style.height = size + "px"
      bubble.style.left = randomBetween(0, 100) + "%"
      bubble.style.setProperty("--wobble", wobble + "px")
      bubble.style.setProperty("--bubble-opacity", String(randomBetween(0.25, 0.6)))
      bubble.style.animationDuration =
        randomBetween(riseDurationRange[0], riseDurationRange[1]) + "s"
      bubble.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"
      container.appendChild(bubble)
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
