/** @file Firefly / fairy lights effect — warm glowing dots drifting organically */

import { isMobile, randomBetween, mapSlider } from "./effect-helpers.js"

export function createFireflyLights(config) {
  const cfg = config || {}
  let container = null
  let animationId = null
  let flies = []

  const warmth = cfg.warmth !== undefined ? cfg.warmth : 50
  const countSlider = cfg.count !== undefined ? cfg.count : 50
  const glowIntensity = cfg.glowIntensity !== undefined ? cfg.glowIntensity : 50

  function getFlyCount() {
    const base = isMobile() ? 5 : 10
    return Math.round(mapSlider(countSlider, base * 0.4, base * 2))
  }

  function getFlyColor() {
    const warm = mapSlider(warmth, 0, 1)
    if (warm > 0.7) {
      // Warm: gold tones
      return "rgba(255, 215, 0, 0.9)"
    } else if (warm > 0.3) {
      // Mixed: some gold, some white-blue
      return Math.random() > 0.5 ? "rgba(255, 215, 0, 0.9)" : "rgba(255, 248, 220, 0.9)"
    }
    // Cool: white/blue tones
    return Math.random() > 0.5 ? "rgba(255, 248, 220, 0.9)" : "rgba(200, 220, 255, 0.9)"
  }

  function createFly(index) {
    const el = document.createElement("div")
    el.className = "firefly"

    const color = getFlyColor()
    el.style.backgroundColor = color

    const glowSize = Math.round(mapSlider(glowIntensity, 3, 12))
    el.style.boxShadow = "0 0 " + glowSize + "px " + Math.round(glowSize * 0.5) + "px " + color

    const glowDuration = randomBetween(2, 4)
    el.style.animationDuration = glowDuration + "s"
    el.style.animationDelay = randomBetween(0, 3) + "s"

    const x = randomBetween(5, 95) / 100 * window.innerWidth
    const y = randomBetween(5, 95) / 100 * window.innerHeight

    return {
      el: el,
      x: x,
      y: y,
      vx: randomBetween(-0.3, 0.3),
      vy: randomBetween(-0.3, 0.3),
    }
  }

  function loop() {
    for (let i = 0; i < flies.length; i++) {
      const f = flies[i]

      // Random walk acceleration
      f.vx += (Math.random() - 0.5) * 0.02
      f.vy += (Math.random() - 0.5) * 0.02

      // Clamp speed
      const maxSpeed = 0.5
      if (f.vx > maxSpeed) f.vx = maxSpeed
      if (f.vx < -maxSpeed) f.vx = -maxSpeed
      if (f.vy > maxSpeed) f.vy = maxSpeed
      if (f.vy < -maxSpeed) f.vy = -maxSpeed

      f.x += f.vx
      f.y += f.vy

      // Steer back toward viewport center if near edges
      const margin = 50
      if (f.x < margin) f.vx += 0.02
      if (f.x > window.innerWidth - margin) f.vx -= 0.02
      if (f.y < margin) f.vy += 0.02
      if (f.y > window.innerHeight - margin) f.vy -= 0.02

      f.el.style.transform = "translate(" + Math.round(f.x) + "px, " + Math.round(f.y) + "px)"
    }

    animationId = requestAnimationFrame(loop)
  }

  function start() {
    if (container) return
    container = document.createElement("div")
    container.className = "effect-layer"
    document.body.appendChild(container)

    const flyCount = getFlyCount()
    flies = []
    for (let i = 0; i < flyCount; i++) {
      const fly = createFly(i)
      flies.push(fly)
      container.appendChild(fly.el)
    }

    loop()
  }

  function stop() {
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
    flies = []
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
