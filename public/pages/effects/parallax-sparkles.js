/** @file Parallax sparkles — multi-depth sparkle layers that shift on scroll */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, mapSlider, prefersReducedMotion } from "./effect-helpers.js"

/** @type {Types.createParallaxSparkles} */
export function createParallaxSparkles(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null
  /** @type {Types.ParallaxLayer[]} */
  let layers = []
  /** @type {(() => void) | null} */
  let scrollHandler = null
  let lastScrollY = 0

  const layerCount = cfg.layerCount !== undefined ? cfg.layerCount : 3
  const density = cfg.density !== undefined ? cfg.density : 50
  const speedMultiplier = cfg.speedMultiplier !== undefined ? cfg.speedMultiplier : 50
  const colorScheme = cfg.colorScheme || "gold"

  function getColors() {
    if (colorScheme === "rose") return ["#ff69b4", "#ff8fa3", "#e8747c", "rgba(255,255,255,0.8)"]
    if (colorScheme === "cool") return ["#87ceeb", "#c44dff", "#60efff", "rgba(255,255,255,0.8)"]
    if (colorScheme === "mixed") return ["#ffd700", "#ff69b4", "#87ceeb", "#fff", "#c44dff"]
    return ["#ffd700", "#ffe4e1", "#fff", "rgba(255,215,0,0.6)"]
  }

  function getSparkleCount() {
    var base = isMobile() ? 8 : 18
    return Math.round(mapSlider(density, base * 0.4, base * 2))
  }

  function getParallaxFactor() {
    return mapSlider(speedMultiplier, 0.1, 0.6)
  }

  function buildLayers() {
    var count = Math.max(2, Math.min(5, layerCount))
    var sparkleCount = getSparkleCount()
    var colors = getColors()
    var builtLayers = []

    for (var i = 0; i < count; i++) {
      var depth = (i + 1) / count
      var layer = document.createElement("div")
      layer.className = "parallax-sparkle-layer"
      layer.style.zIndex = String(40 + i)

      var sparklesPerLayer = Math.round(sparkleCount * (0.6 + depth * 0.4))

      for (var s = 0; s < sparklesPerLayer; s++) {
        var sparkle = document.createElement("div")
        sparkle.className = "parallax-sparkle"

        var size = randomBetween(2, 5) * depth
        sparkle.style.width = size + "px"
        sparkle.style.height = size + "px"
        sparkle.style.left = randomBetween(0, 100) + "%"
        sparkle.style.top = randomBetween(-20, 120) + "%"
        sparkle.style.backgroundColor = randomFrom(colors)
        sparkle.style.opacity = String(randomBetween(0.2, 0.7) * depth)
        sparkle.style.animationDuration = randomBetween(2, 5) + "s"
        sparkle.style.animationDelay = randomBetween(0, 3) + "s"

        if (depth > 0.6) {
          sparkle.style.boxShadow = "0 0 " + Math.round(size * 2) + "px " + Math.round(size * 0.5) + "px " + randomFrom(colors)
        }

        layer.appendChild(sparkle)
      }

      container?.appendChild(layer)
      builtLayers.push({ element: layer, depth: depth })
    }

    return builtLayers
  }

  function onScroll() {
    var scrollY = window.scrollY || document.documentElement.scrollTop
    var delta = scrollY - lastScrollY
    lastScrollY = scrollY
    var factor = getParallaxFactor()

    for (var i = 0; i < layers.length; i++) {
      var shift = -scrollY * factor * layers[i].depth
      layers[i].element.style.transform = "translateY(" + shift + "px)"
    }
  }

  function start() {
    if (container) return
    if (prefersReducedMotion()) return

    container = document.createElement("div")
    container.className = "effect-layer parallax-sparkle-container"
    document.body.appendChild(container)

    layers = buildLayers()
    lastScrollY = window.scrollY || document.documentElement.scrollTop

    scrollHandler = onScroll
    window.addEventListener("scroll", scrollHandler, { passive: true })
    onScroll()
  }

  function stop() {
    if (scrollHandler) {
      window.removeEventListener("scroll", scrollHandler)
      scrollHandler = null
    }
    layers = []
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
