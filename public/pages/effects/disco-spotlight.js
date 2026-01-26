/** @file Disco spotlight — sweeping colored spotlight beams */

import { isMobile, randomFrom, randomBetween, mapSlider } from "./effect-helpers.js"

export function createDiscoSpotlight(config) {
  const cfg = config || {}
  let container = null
  let animationId = null
  let spotlights = []
  let active = false

  const beamCount = cfg.beamCount !== undefined ? cfg.beamCount : 3
  const sweepSpeed = cfg.sweepSpeed !== undefined ? cfg.sweepSpeed : 50
  const beamWidth = cfg.beamWidth !== undefined ? cfg.beamWidth : 50
  const colors = cfg.colors || [
    "rgba(221, 115, 100, 0.15)",
    "rgba(255, 105, 180, 0.12)",
    "rgba(255, 215, 0, 0.1)",
    "rgba(135, 206, 235, 0.12)",
    "rgba(196, 77, 255, 0.1)",
    "rgba(255, 255, 255, 0.08)",
  ]

  function getBeamCount() {
    var max = isMobile() ? 2 : 4
    return Math.max(1, Math.min(max, beamCount))
  }

  function getSweepDuration() {
    return mapSlider(sweepSpeed, 12, 3, true)
  }

  function getBeamWidthDeg() {
    return Math.round(mapSlider(beamWidth, 15, 60))
  }

  function buildSpotlights() {
    var count = getBeamCount()
    var widthDeg = getBeamWidthDeg()
    var built = []

    for (var i = 0; i < count; i++) {
      var spot = document.createElement("div")
      spot.className = "disco-spotlight-beam"

      var color = randomFrom(colors)
      var halfWidth = widthDeg / 2

      spot.style.background = "conic-gradient(from 0deg, transparent, " + color + " " + halfWidth + "deg, transparent " + widthDeg + "deg)"
      spot.style.animationDuration = (getSweepDuration() + randomBetween(-2, 2)) + "s"
      spot.style.animationDelay = (i * 1.5) + "s"

      // Alternate direction for visual interest
      if (i % 2 === 1) {
        spot.style.animationDirection = "reverse"
      }

      container.appendChild(spot)
      built.push({
        element: spot,
        colorIdx: i,
        phase: randomBetween(0, Math.PI * 2),
      })
    }

    return built
  }

  function cycleColors() {
    if (!active) return

    for (var i = 0; i < spotlights.length; i++) {
      var spot = spotlights[i]
      if (Math.random() > 0.7) {
        var color = randomFrom(colors)
        var widthDeg = getBeamWidthDeg()
        var halfWidth = widthDeg / 2
        spot.element.style.background = "conic-gradient(from 0deg, transparent, " + color + " " + halfWidth + "deg, transparent " + widthDeg + "deg)"
      }
    }

    animationId = setTimeout(cycleColors, 3000)
  }

  function start() {
    if (container) return
    active = true

    container = document.createElement("div")
    container.className = "effect-layer disco-spotlight-container"
    document.body.appendChild(container)

    spotlights = buildSpotlights()
    cycleColors()
  }

  function stop() {
    active = false
    if (animationId) {
      clearTimeout(animationId)
      animationId = null
    }
    spotlights = []
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
