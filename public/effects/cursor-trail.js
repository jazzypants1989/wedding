/** @file Cursor trail effect — hearts and sparkles follow the mouse */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom } from "./effect-utils.js"
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
  /** @type {AbortController | null} */
  let controller = null
  /** @type {HTMLDivElement | null} */
  let container = null
  let count = 0
  let spawnCount = 0
  let lastSpawn = 0
  let lastX = -1
  let lastY = -1

  const trailDensity = cfg.trailDensity !== undefined ? cfg.trailDensity : 23
  const trailType = cfg.trailType || "mix"
  const throttleMs = cfg.throttleMs !== undefined ? cfg.throttleMs : 65
  const fadeDuration = cfg.fadeSpeed !== undefined ? cfg.fadeSpeed : 650
  const particleScale = cfg.size !== undefined ? cfg.size : 1.15
  const colors = cfg.colors || DEFAULT_COLORS
  const minDistance = cfg.minDistance !== undefined ? cfg.minDistance : 5

  const maxTrail = isMobile() ? Math.round(trailDensity / 2) : trailDensity

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
      if (dist < minDistance) return
    }
    lastX = x
    lastY = y

    const el = document.createElement("div")
    spawnCount++

    const color = randomFrom(colors)
    const cls = getParticleClass()
    el.className = "trail-particle " + cls
    el.style.backgroundColor = color
    el.style.left = x + "px"
    el.style.top = y + "px"
    el.style.animationDuration = fadeDuration + "ms"
    el.style.transform = "scale(" + particleScale + ")"

    count++
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
    if (controller) return
    controller = new AbortController()
    count = 0
    spawnCount = 0
    lastSpawn = 0
    lastX = -1
    lastY = -1

    container = document.createElement("div")
    container.className = "effect-layer trail-container"
    container.setAttribute("aria-hidden", "true")
    container.addEventListener("animationend", function (e) {
      const target = /** @type {HTMLElement} */ (e.target)
      if (target.classList.contains("trail-particle")) {
        target.remove()
        count--
      }
    }, { signal: controller.signal })
    document.body.appendChild(container)

    document.addEventListener("mousemove", onMouseMove, { signal: controller.signal })
    document.addEventListener("touchmove", onTouchMove, { signal: controller.signal })
  }

  function stop() {
    if (!controller) return

    controller.abort()
    controller = null

    if (container) {
      container.remove()
      container = null
    }
    count = 0
  }

  return { start, stop }
}
