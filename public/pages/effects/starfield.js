/** @file Twinkling starfield — static stars placed once, pulsing via CSS */

import { isMobile, mapSlider } from "./effect-helpers.js"

export function createStarfield(config) {
  const cfg = config || {}
  let container = null

  const starCountSlider = cfg.starCount !== undefined ? cfg.starCount : 50
  const pulseSpeed = cfg.pulseSpeed !== undefined ? cfg.pulseSpeed : 50
  const brightness = cfg.brightness !== undefined ? cfg.brightness : 50
  const colorDistribution = cfg.colorDistribution || "mixed"

  function getStarCount() {
    const base = isMobile() ? 15 : 30
    return Math.round(mapSlider(starCountSlider, base * 0.5, base * 2.5))
  }

  function getColorClass() {
    if (colorDistribution === "white") return ""
    if (colorDistribution === "warm") {
      return Math.random() < 0.5 ? " starfield-star--gold" : " starfield-star--rose"
    }
    // mixed
    const roll = Math.random()
    if (roll < 0.1) return " starfield-star--gold"
    if (roll < 0.2) return " starfield-star--rose"
    return ""
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer"
    document.body.appendChild(container)

    const starCount = getStarCount()
    const brightThreshold = mapSlider(brightness, 0.5, 0.9)

    for (let i = 0; i < starCount; i++) {
      const star = document.createElement("div")

      const isBright = Math.random() > (1 - brightThreshold * 0.5)
      const colorClass = getColorClass()

      star.className = "starfield-star" +
        (isBright ? " starfield-star--bright" : "") +
        colorClass

      star.style.left = (Math.random() * 100) + "%"
      star.style.top = (Math.random() * 100) + "%"

      const durationMin = mapSlider(pulseSpeed, 5, 1)
      const durationRange = mapSlider(pulseSpeed, 4, 1.5)
      star.style.animationDuration = (durationMin + Math.random() * durationRange) + "s"
      star.style.animationDelay = (Math.random() * 5) + "s"

      container.appendChild(star)
    }
  }

  function stop() {
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
