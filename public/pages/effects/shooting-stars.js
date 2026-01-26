/** @file Shooting stars effect — occasional bright streaks across the viewport */

import { randomBetween, mapSlider } from "./effect-helpers.js"

export function createShootingStars(config) {
  const cfg = config || {}
  let container = null
  let timeoutId = null
  let active = false

  const frequency = cfg.frequency !== undefined ? cfg.frequency : 50
  const trailLength = cfg.trailLength !== undefined ? cfg.trailLength : 50
  const colorTint = cfg.colorTint || "white"

  function getDelay() {
    const minDelay = mapSlider(frequency, 15000, 4000, true)
    const maxDelay = mapSlider(frequency, 25000, 8000, true)
    return randomBetween(minDelay, maxDelay)
  }

  function getTrailWidth() {
    return Math.round(mapSlider(trailLength, 40, 140))
  }

  function getStarColor() {
    if (colorTint === "golden") return "linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.9))"
    if (colorTint === "rose") return "linear-gradient(90deg, transparent, rgba(255, 105, 180, 0.9))"
    if (colorTint === "mixed") {
      var tints = [
        "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.9))",
        "linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.9))",
        "linear-gradient(90deg, transparent, rgba(255, 105, 180, 0.9))",
        "linear-gradient(90deg, transparent, rgba(135, 206, 235, 0.9))",
      ]
      return tints[Math.floor(Math.random() * tints.length)]
    }
    return "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.9))"
  }

  function spawnStar() {
    if (!container || !active) return

    const star = document.createElement("div")
    star.className = "shooting-star"

    const width = getTrailWidth()
    star.style.width = width + "px"
    star.style.background = getStarColor()

    // Random start position along top or right edge
    const startFromTop = Math.random() > 0.5
    if (startFromTop) {
      star.style.left = (10 + Math.random() * 80) + "%"
      star.style.top = "0"
    } else {
      star.style.left = "100%"
      star.style.top = (Math.random() * 50) + "%"
    }

    // Angle between 200 and 250 degrees (heading down-left)
    const angle = randomBetween(200, 250)
    star.style.setProperty("--angle", angle + "deg")
    star.style.transform = "rotate(" + angle + "deg)"

    const duration = randomBetween(0.6, 1.2)
    star.style.animationDuration = duration + "s"

    star.addEventListener("animationend", function () {
      star.remove()
    })

    container.appendChild(star)
    scheduleNext()
  }

  function scheduleNext() {
    if (!active) return
    timeoutId = setTimeout(spawnStar, getDelay())
  }

  function start() {
    if (active) return
    active = true
    container = document.createElement("div")
    container.className = "effect-layer"
    document.body.appendChild(container)
    scheduleNext()
  }

  function stop() {
    active = false
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
