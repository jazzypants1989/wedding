/** @file Cursor trail effect — hearts and sparkles follow the mouse */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, mapSlider } from "./main.js"
import { EFFECT_PALETTE } from "./config.js"

const DEFAULT_COLORS = [
  EFFECT_PALETTE.brand,
  EFFECT_PALETTE.pink,
  EFFECT_PALETTE.gold,
  EFFECT_PALETTE.blush,
  EFFECT_PALETTE.white,
]

/** @type {Types.createCursorTrail} */
export function createCursorTrail(config) {
  const cfg = config || {}
  let active = false
  /** @type {HTMLDivElement | null} */
  let container = null
  let count = 0
  let spawnCount = 0
  let lastSpawn = 0
  let lastX = -1
  let lastY = -1
  /** @type {((e: MouseEvent) => void) | null} */
  let mouseMoveHandler = null
  /** @type {((e: TouchEvent) => void) | null} */
  let touchMoveHandler = null

  const trailDensity = cfg.trailDensity !== undefined ? cfg.trailDensity : 50
  const trailType = cfg.trailType || "mix"
  const fadeSpeed = cfg.fadeSpeed !== undefined ? cfg.fadeSpeed : 50
  const size = cfg.size !== undefined ? cfg.size : 50

  const baseMax = isMobile() ? 15 : 40
  const maxTrail = Math.round(mapSlider(trailDensity, 5, baseMax))
  const throttleMs = mapSlider(trailDensity, 100, 30, true)
  const fadeDuration = mapSlider(fadeSpeed, 1000, 300, true)
  const particleScale = mapSlider(size, 0.5, 1.8)

  function getParticleClass() {
    if (trailType === "hearts") return "trail-heart"
    if (trailType === "sparkles") return "trail-sparkle"
    if (trailType === "stars") return "trail-sparkle"
    if (trailType === "rings") return "trail-ring"
    // mix
    return spawnCount % 3 === 0 ? "trail-heart" : "trail-sparkle"
  }

  /** @param {number} x @param {number} y */
  function spawnParticle(x, y) {
    if (!container) return
    if (count >= maxTrail) return

    // Skip if cursor hasn't moved enough
    if (lastX >= 0 && lastY >= 0) {
      const dx = x - lastX
      const dy = y - lastY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 5) return
    }
    lastX = x
    lastY = y

    const el = document.createElement("div")
    spawnCount++

    const color = randomFrom(DEFAULT_COLORS)
    const cls = getParticleClass()
    el.className = "trail-particle " + cls
    el.style.backgroundColor = color
    el.style.left = x + "px"
    el.style.top = y + "px"
    el.style.animationDuration = fadeDuration + "ms"
    el.style.transform = "scale(" + particleScale + ")"

    count++
    el.addEventListener("animationend", function () {
      el.remove()
      count--
    })

    container.appendChild(el)
  }

  /** @param {MouseEvent} e */
  function onMouseMove(e) {
    const now = Date.now()
    if (now - lastSpawn < throttleMs) return
    lastSpawn = now
    spawnParticle(e.clientX, e.clientY)
  }

  /** @param {TouchEvent} e */
  function onTouchMove(e) {
    if (!e.touches || e.touches.length === 0) return
    const now = Date.now()
    if (now - lastSpawn < throttleMs) return
    lastSpawn = now
    const touch = e.touches[0]
    spawnParticle(touch.clientX, touch.clientY)
  }

  function start() {
    if (active) return
    active = true
    count = 0
    spawnCount = 0
    lastSpawn = 0
    lastX = -1
    lastY = -1

    container = document.createElement("div")
    container.className = "effect-layer trail-container"
    container.setAttribute("aria-hidden", "true")
    document.body.appendChild(container)

    mouseMoveHandler = onMouseMove
    touchMoveHandler = onTouchMove

    document.addEventListener("mousemove", mouseMoveHandler)
    document.addEventListener("touchmove", touchMoveHandler)
  }

  function stop() {
    if (!active) return
    active = false

    if (mouseMoveHandler) {
      document.removeEventListener("mousemove", mouseMoveHandler)
      mouseMoveHandler = null
    }
    if (touchMoveHandler) {
      document.removeEventListener("touchmove", touchMoveHandler)
      touchMoveHandler = null
    }

    if (container) {
      container.remove()
      container = null
    }
    count = 0
  }

  return { start, stop }
}
