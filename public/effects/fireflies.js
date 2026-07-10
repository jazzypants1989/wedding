/** @file Fireflies — small warm points that blink and drift on wandering paths. */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween } from "./main.js"

const DEFAULT_COLORS = ["#ffe98a", "#c9ff8a", "#fff3b0", "#a8e063"]

/** @type {Types.createFireflies} */
export function createFireflies(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const flyCount = cfg.flyCount !== undefined ? cfg.flyCount : 22
  const colors = cfg.colors || DEFAULT_COLORS
  const sizeRange = cfg.sizeRange || [2, 5]
  const blinkDurationRange = cfg.blinkDurationRange || [2, 5]
  const driftDurationRange = cfg.driftDurationRange || [8, 16]
  const driftRange = cfg.driftRange || [20, 70]

  function getCount() {
    return isMobile() ? Math.round(flyCount * 0.5) : flyCount
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer fireflies-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      // Outer element owns the slow wandering drift; inner dot owns the blink,
      // so the two animations run on independent timelines.
      const fly = document.createElement("div")
      fly.className = "firefly"
      const driftX = randomBetween(driftRange[0], driftRange[1]) * (Math.random() < 0.5 ? -1 : 1)
      const driftY = randomBetween(driftRange[0], driftRange[1]) * (Math.random() < 0.5 ? -1 : 1)
      fly.style.left = randomBetween(0, 100) + "%"
      fly.style.top = randomBetween(15, 90) + "%"
      fly.style.setProperty("--drift-x", driftX + "px")
      fly.style.setProperty("--drift-y", driftY + "px")
      fly.style.animationDuration =
        randomBetween(driftDurationRange[0], driftDurationRange[1]) + "s"
      fly.style.animationDelay = randomBetween(0, 8) + "s"

      const glow = document.createElement("div")
      glow.className = "firefly-glow"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const color = randomFrom(colors)
      glow.style.width = size + "px"
      glow.style.height = size + "px"
      glow.style.backgroundColor = color
      glow.style.color = color // currentColor glow
      glow.style.setProperty("--fly-opacity", String(randomBetween(0.5, 0.95)))
      glow.style.animationDuration =
        randomBetween(blinkDurationRange[0], blinkDurationRange[1]) + "s"
      glow.style.animationDelay = randomBetween(0, 5) + "s"
      fly.appendChild(glow)

      container.appendChild(fly)
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
