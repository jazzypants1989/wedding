/** @file Mirror reflections — small light squares bouncing around the viewport */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, mapSlider } from "./main.js"

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

  const reflectionCount =
    cfg.reflectionCount !== undefined ? cfg.reflectionCount : 50
  const speed = cfg.speed !== undefined ? cfg.speed : 50
  const brightness = cfg.brightness !== undefined ? cfg.brightness : 50
  const colors = cfg.colors || [
    "rgba(255, 255, 255, 0.6)",
    "rgba(255, 215, 0, 0.5)",
    "rgba(255, 200, 200, 0.4)",
    "rgba(200, 200, 255, 0.4)",
    "rgba(200, 255, 200, 0.3)",
  ]

  function getCount() {
    var base = isMobile() ? 8 : 18
    return Math.round(mapSlider(reflectionCount, base * 0.4, base * 2))
  }

  function getSpeedFactor() {
    return mapSlider(speed, 0.3, 1.5)
  }

  function getBrightness() {
    return mapSlider(brightness, 0.15, 0.7)
  }

  function initReflections() {
    var count = getCount()
    var w = window.innerWidth
    var h = window.innerHeight
    var speedFactor = getSpeedFactor()
    var bright = getBrightness()
    var refs = []

    for (var i = 0; i < count; i++) {
      var size = randomBetween(4, 14)
      var el = document.createElement("div")
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

  function render() {
    if (!active) return
    var w = window.innerWidth
    var h = window.innerHeight

    // Compute pass: update all positions and flicker values
    for (var i = 0; i < reflections.length; i++) {
      var r = reflections[i]

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
    for (var j = 0; j < reflections.length; j++) {
      var ref = reflections[j]
      var flicker = 0.5 + 0.5 * Math.sin(ref.flickerPhase)
      ref.el.style.opacity = String(ref.baseBrightness * flicker)
      ref.el.style.transform =
        "translate(" +
        Math.round(ref.x) +
        "px, " +
        Math.round(ref.y) +
        "px) rotate(" +
        Math.round(ref.flickerPhase * 30) +
        "deg)"
    }

    animationId = requestAnimationFrame(render)
  }

  function start() {
    if (container) return

    active = true
    container = document.createElement("div")
    container.className = "effect-layer mirror-reflection-container"
    container.setAttribute("aria-hidden", "true")
    document.body.appendChild(container)

    reflections = initReflections()
    render()
  }

  function stop() {
    active = false
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
