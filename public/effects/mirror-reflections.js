/** @file Mirror reflections — small light squares bouncing around the viewport */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween } from "./effect-utils.js"

/** @type {Types.createMirrorReflections} */
export function createMirrorReflections(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null
  /** @type {number | null} */
  let animationId = null
  /** @type {Types.Reflection[]} */
  let reflections = []
  let active = false
  let lastFrameTime = 0
  let viewportW = window.innerWidth
  let viewportH = window.innerHeight
  const resizeController = new AbortController()

  const reflectionCount =
    cfg.reflectionCount !== undefined ? cfg.reflectionCount : 22
  const speed = cfg.speed !== undefined ? cfg.speed : 0.9
  const brightness = cfg.brightness !== undefined ? cfg.brightness : 0.425
  const colors = cfg.colors || [
    "rgba(255, 255, 255, 0.6)",
    "rgba(255, 215, 0, 0.5)",
    "rgba(255, 200, 200, 0.4)",
    "rgba(200, 200, 255, 0.4)",
    "rgba(200, 255, 200, 0.3)",
  ]
  const sizeRange = cfg.sizeRange || [4, 14]
  const frameInterval = cfg.frameInterval !== undefined ? cfg.frameInterval : 33

  function getCount() {
    return isMobile() ? Math.round(reflectionCount * 0.45) : reflectionCount
  }

  function getSpeedFactor() {
    return speed
  }

  function getBrightness() {
    return brightness
  }

  function initReflections() {
    const count = getCount()
    const w = viewportW
    const h = viewportH
    const speedFactor = getSpeedFactor()
    const bright = getBrightness()
    const refs = []

    for (let i = 0; i < count; i++) {
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const el = document.createElement("div")
      el.className = "mirror-reflection"
      el.style.width = size + "px"
      el.style.height = size + "px"
      el.style.opacity = String(bright * randomBetween(0.5, 1))
      el.style.backgroundColor = randomFrom(colors)

      container?.appendChild(el)

      refs.push({
        el: el,
        x: randomBetween(0, w),
        y: randomBetween(0, h),
        vx: (Math.random() - 0.5) * 2 * speedFactor,
        vy: (Math.random() - 0.5) * 2 * speedFactor,
        size: size,
        flickerPhase: randomBetween(0, Math.PI * 2),
        flickerSpeed: randomBetween(0.02, 0.06),
        baseBrightness: bright * randomBetween(0.5, 1),
      })
    }

    return refs
  }

  /** @param {number} timestamp */
  function render(timestamp) {
    if (!active) return

    // Throttle to configured frame interval
    if (timestamp - lastFrameTime < frameInterval) {
      animationId = requestAnimationFrame(render)
      return
    }
    lastFrameTime = timestamp

    const w = viewportW
    const h = viewportH

    // Compute pass: update all positions and flicker values
    for (let i = 0; i < reflections.length; i++) {
      const r = reflections[i]

      r.x += r.vx
      r.y += r.vy

      if (r.x < 0) {
        r.x = 0
        r.vx = Math.abs(r.vx)
      }
      if (r.x > w - r.size) {
        r.x = w - r.size
        r.vx = -Math.abs(r.vx)
      }
      if (r.y < 0) {
        r.y = 0
        r.vy = Math.abs(r.vy)
      }
      if (r.y > h - r.size) {
        r.y = h - r.size
        r.vy = -Math.abs(r.vy)
      }

      r.flickerPhase += r.flickerSpeed
    }

    // Write pass: apply all DOM changes in a single batch
    for (let j = 0; j < reflections.length; j++) {
      const ref = reflections[j]
      const flicker = 0.5 + 0.5 * Math.sin(ref.flickerPhase)
      ref.el.style.opacity = String(ref.baseBrightness * flicker)
      ref.el.style.transform =
        "translate3d(" +
        Math.round(ref.x) +
        "px, " +
        Math.round(ref.y) +
        "px, 0) rotate(" +
        Math.round(ref.flickerPhase * 30) +
        "deg)"
    }

    animationId = requestAnimationFrame(render)
  }

  function start() {
    if (container) return

    active = true
    viewportW = window.innerWidth
    viewportH = window.innerHeight
    window.addEventListener(
      "resize",
      function () {
        viewportW = window.innerWidth
        viewportH = window.innerHeight
      },
      { signal: resizeController.signal },
    )

    container = document.createElement("div")
    container.className = "effect-layer mirror-reflection-container"
    container.setAttribute("aria-hidden", "true")
    document.body.appendChild(container)

    reflections = initReflections()
    lastFrameTime = 0
    render(0)
  }

  function stop() {
    active = false
    resizeController.abort()
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
    reflections = []
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
