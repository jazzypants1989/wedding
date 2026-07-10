/** @file Disco spotlight — sweeping colored spotlight beams */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, cancellableDelay } from "./effect-utils.js"
import { brandAlpha } from "./config.js"

/** @type {Types.createDiscoSpotlight} */
export function createDiscoSpotlight(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null
  /** @type {AbortController | null} */
  let controller = null
  /** @type {Types.SpotlightBeam[]} */
  let spotlights = []

  const beamCount = cfg.beamCount !== undefined ? cfg.beamCount : 3
  const sweepSpeed = cfg.sweepSpeed !== undefined ? cfg.sweepSpeed : 7.5
  const beamWidth = cfg.beamWidth !== undefined ? cfg.beamWidth : 38
  const colors = cfg.colors || [
    brandAlpha(0.15),
    "rgba(255, 105, 180, 0.12)",
    "rgba(255, 215, 0, 0.1)",
    "rgba(135, 206, 235, 0.12)",
    "rgba(196, 77, 255, 0.1)",
    "rgba(255, 255, 255, 0.08)",
  ]
  const colorCycleMs = cfg.colorCycleMs !== undefined ? cfg.colorCycleMs : 3000
  const beamStagger = cfg.beamStagger !== undefined ? cfg.beamStagger : 1.5

  function getBeamCount() {
    const max = isMobile() ? 2 : 4
    return Math.max(1, Math.min(max, beamCount))
  }

  function getSweepDuration() {
    return sweepSpeed
  }

  function getBeamWidthDeg() {
    return Math.round(beamWidth)
  }

  function buildSpotlights() {
    const count = getBeamCount()
    const widthDeg = getBeamWidthDeg()
    const built = []

    for (let i = 0; i < count; i++) {
      const spot = document.createElement("div")
      spot.className = "disco-spotlight-beam"

      const color = randomFrom(colors)
      const halfWidth = widthDeg / 2

      spot.style.background =
        "conic-gradient(from 0deg, transparent, " +
        color +
        " " +
        halfWidth +
        "deg, transparent " +
        widthDeg +
        "deg)"
      spot.style.animationDuration =
        getSweepDuration() + randomBetween(-2, 2) + "s"
      spot.style.animationDelay = i * beamStagger + "s"

      // Alternate direction for visual interest
      if (i % 2 === 1) {
        spot.style.animationDirection = "reverse"
      }

      container?.appendChild(spot)
      built.push({
        element: spot,
        colorIdx: i,
        phase: randomBetween(0, Math.PI * 2),
      })
    }

    return built
  }

  /** @param {AbortSignal} signal */
  async function cycleColors(signal) {
    while (true) {
      for (let i = 0; i < spotlights.length; i++) {
        const spot = spotlights[i]
        if (Math.random() > 0.7) {
          const color = randomFrom(colors)
          const widthDeg = getBeamWidthDeg()
          const halfWidth = widthDeg / 2
          spot.element.style.background =
            "conic-gradient(from 0deg, transparent, " +
            color +
            " " +
            halfWidth +
            "deg, transparent " +
            widthDeg +
            "deg)"
        }
      }
      await cancellableDelay(colorCycleMs, signal)
    }
  }

  function start() {
    if (container) return

    controller = new AbortController()

    container = document.createElement("div")
    container.className = "effect-layer disco-spotlight-container"
    container.setAttribute("aria-hidden", "true")
    document.body.appendChild(container)

    spotlights = buildSpotlights()
    cycleColors(controller.signal).catch(function (e) {
      if (e && typeof e === "object" && "name" in e && /** @type {*} */ (e).name === "AbortError") return
      console.warn("Spotlight error:", e)
    })
  }

  function stop() {
    if (controller) {
      controller.abort()
      controller = null
    }
    spotlights = []
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
