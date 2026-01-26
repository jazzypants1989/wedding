/** @file Sparkle rain effect — shimmering particles falling like gentle snow */

import { isMobile, randomBetween, mapSlider } from "./effect-helpers.js"

const SPARKLE_COLORS = ["#fff", "#ffd700", "#ffe4e1", "rgb(221, 115, 100)"]

export function createSparkleRain(config) {
  const cfg = config || {}
  let container = null
  let intervalId = null
  let count = 0

  const fallSpeed = cfg.fallSpeed !== undefined ? cfg.fallSpeed : 50
  const density = cfg.density !== undefined ? cfg.density : 50
  const driftAmount = cfg.driftAmount !== undefined ? cfg.driftAmount : 50
  const glowIntensity = cfg.glowIntensity !== undefined ? cfg.glowIntensity : 50

  function maxCount() {
    return isMobile() ? Math.round(mapSlider(density, 8, 22)) : Math.round(mapSlider(density, 15, 45))
  }

  function spawnInterval() {
    return mapSlider(density, 400, 100, true)
  }

  function spawnDrop() {
    if (!container) return
    if (count >= maxCount()) return

    const drop = document.createElement("div")
    drop.className = "sparkle-rain-drop"

    drop.style.left = (Math.random() * 100) + "%"

    const durationMin = mapSlider(fallSpeed, 7, 2)
    const durationRange = mapSlider(fallSpeed, 4, 1)
    drop.style.animationDuration = (durationMin + Math.random() * durationRange) + "s, 0.8s"

    // Drift
    const maxDrift = mapSlider(driftAmount, 10, 80)
    const drift = randomBetween(-maxDrift, maxDrift)
    drop.style.setProperty("--drift", drift + "px")

    // Size
    const size = 2 + Math.random() * 3
    drop.style.width = size + "px"
    drop.style.height = size + "px"

    // Color variety
    const colorRoll = Math.random()
    if (colorRoll > 0.7) {
      const sparkleColor = SPARKLE_COLORS[1 + Math.floor(Math.random() * (SPARKLE_COLORS.length - 1))]
      drop.style.setProperty("--sparkle-color", sparkleColor)
    }

    // Glow
    const glowSpread = Math.round(mapSlider(glowIntensity, 1, 5))
    drop.style.setProperty("--glow-spread", glowSpread + "px")

    count++
    drop.addEventListener("animationend", function () {
      drop.remove()
      count--
    })

    container.appendChild(drop)
  }

  function start() {
    if (container) return
    container = document.createElement("div")
    container.className = "effect-layer"
    document.body.appendChild(container)
    count = 0
    intervalId = setInterval(spawnDrop, spawnInterval())
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (container) {
      container.remove()
      container = null
    }
    count = 0
  }

  return { start, stop }
}
