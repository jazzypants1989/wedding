/** @file Sparkle stars effect — twinkling stars appear at random positions */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, mapSlider } from "./effect-helpers.js"

const DEFAULT_COLORS = ["#fff", "#ffd700", "#ffe4e1", "rgb(221, 115, 100)"]

/** @type {Types.createSparkleStars} */
export function createSparkleStars(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null
  /** @type {ReturnType<typeof setInterval> | null} */
  let intervalId = null
  let count = 0

  const twinkleSpeed = cfg.twinkleSpeed !== undefined ? cfg.twinkleSpeed : 50
  const starSize = cfg.starSize !== undefined ? cfg.starSize : 50
  const spawnDensity = cfg.spawnDensity !== undefined ? cfg.spawnDensity : 50
  const colors = cfg.colorMix || DEFAULT_COLORS

  function maxCount() {
    return isMobile() ? Math.round(mapSlider(spawnDensity, 6, 18)) : Math.round(mapSlider(spawnDensity, 10, 30))
  }

  function spawnInterval() {
    return mapSlider(spawnDensity, 700, 150, true)
  }

  function spawnStar() {
    if (!container) return
    if (count >= maxCount()) return

    const star = document.createElement("div")
    star.className = "sparkle-star"

    const color = randomFrom(colors)
    star.style.background = color
    star.style.left = (Math.random() * 100) + "%"
    star.style.top = (Math.random() * 100) + "%"

    const durationMin = mapSlider(twinkleSpeed, 3, 0.8)
    const durationRange = mapSlider(twinkleSpeed, 2, 0.5)
    star.style.animationDuration = (durationMin + Math.random() * durationRange) + "s"

    const scale = mapSlider(starSize, 0.3, 1.8)
    star.style.setProperty("--scale", String(scale))

    count++
    star.addEventListener("animationend", function () {
      star.remove()
      count--
    })

    container.appendChild(star)
  }

  function start() {
    if (container) return
    container = document.createElement("div")
    container.className = "effect-layer"
    document.body.appendChild(container)
    count = 0
    intervalId = setInterval(spawnStar, spawnInterval())
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
