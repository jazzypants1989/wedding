/** @file Parallax sparkles — multi-depth sparkle layers that shift on scroll */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, mapSlider } from "./main.js"
import { EFFECT_PALETTE } from "./config.js"

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
  let rafId = 0

  const layerCount = cfg.layerCount !== undefined ? cfg.layerCount : 3
  const density = cfg.density !== undefined ? cfg.density : 50
  const speedMultiplier =
    cfg.speedMultiplier !== undefined ? cfg.speedMultiplier : 50
  const colorScheme = cfg.colorScheme || "gold"

  function getColors() {
    if (colorScheme === "rose")
      return [
        EFFECT_PALETTE.pink,
        "#ff8fa3",
        "#e8747c",
        "rgba(255,255,255,0.8)",
      ]
    if (colorScheme === "cool")
      return [
        EFFECT_PALETTE.sky,
        EFFECT_PALETTE.purple,
        "#60efff",
        "rgba(255,255,255,0.8)",
      ]
    if (colorScheme === "mixed")
      return [
        EFFECT_PALETTE.gold,
        EFFECT_PALETTE.pink,
        EFFECT_PALETTE.sky,
        EFFECT_PALETTE.white,
        EFFECT_PALETTE.purple,
      ]
    return [
      EFFECT_PALETTE.gold,
      EFFECT_PALETTE.blush,
      EFFECT_PALETTE.white,
      "rgba(255,215,0,0.6)",
    ]
  }

  function getSparkleCount() {
    const base = isMobile() ? 5 : 18
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

    var baseZ =
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--z-parallax-sparkles",
        ),
      ) || 40
    for (var i = 0; i < count; i++) {
      var depth = (i + 1) / count
      var layer = document.createElement("div")
      layer.className = "parallax-sparkle-layer"
      layer.style.zIndex = String(baseZ + i)

      var sparklesPerLayer = Math.round(sparkleCount * (0.6 + depth * 0.4))

      for (var s = 0; s < sparklesPerLayer; s++) {
        var sparkle = document.createElement("div")
        sparkle.className = "parallax-sparkle"

        var size = randomBetween(2, 5) * depth
        sparkle.style.width = size + "px"
        sparkle.style.height = size + "px"
        sparkle.style.left = randomBetween(0, 100) + "%"
        sparkle.style.top = randomBetween(-20, 120) + "%"
        const color = randomFrom(colors)
        sparkle.style.backgroundColor = color
        sparkle.style.color = color // for currentColor in box-shadow
        sparkle.style.opacity = String(randomBetween(0.2, 0.7) * depth)
        sparkle.style.animationDuration = randomBetween(2, 5) + "s"
        sparkle.style.animationDelay = randomBetween(0, 3) + "s"

        if (depth > 0.6) {
          sparkle.classList.add("parallax-sparkle-glow")
        }

        layer.appendChild(sparkle)
      }

      container?.appendChild(layer)
      builtLayers.push({ element: layer, depth: depth })
    }

    return builtLayers
  }

  function updateParallax() {
    var scrollY = window.scrollY || document.documentElement.scrollTop
    lastScrollY = scrollY
    var factor = getParallaxFactor()

    for (var i = 0; i < layers.length; i++) {
      var shift = -scrollY * factor * layers[i].depth
      layers[i].element.style.transform = "translateY(" + shift + "px)"
    }
    rafId = 0
  }

  function onScroll() {
    if (!rafId) {
      rafId = requestAnimationFrame(updateParallax)
    }
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer parallax-sparkle-container"
    container.setAttribute("aria-hidden", "true")
    document.body.appendChild(container)

    layers = buildLayers()
    lastScrollY = window.scrollY || document.documentElement.scrollTop

    scrollHandler = onScroll
    window.addEventListener("scroll", scrollHandler, { passive: true })
    updateParallax()
  }

  function stop() {
    if (scrollHandler) {
      window.removeEventListener("scroll", scrollHandler)
      scrollHandler = null
    }
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    layers = []
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
