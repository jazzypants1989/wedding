/** @file Shared utilities for visual effects */
/** @import * as Types from './types.js' */

/** @type {Types.isMobile} */
export function isMobile() {
  return window.innerWidth < 768
}

/** @type {Types.prefersReducedMotion} */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** @type {Types.createEffectLayer} */
export function createEffectLayer(extraClass) {
  const container = document.createElement("div")
  container.className = "effect-layer" + (extraClass ? " " + extraClass : "")
  return container
}

/** @type {Types.createSpawnLoop} */
export function createSpawnLoop(options) {
  let count = 0
  const intervalId = setInterval(function () {
    if (!options.container || !options.container.parentNode) return
    if (count >= options.maxCount()) return

    const el = options.spawnFn()
    if (!el) return

    count++
    el.addEventListener("animationend", function () {
      el.remove()
      count--
    })

    options.container.appendChild(el)
  }, options.interval)

  return {
    stop: function () {
      clearInterval(intervalId)
      count = 0
    },
    getCount: function () {
      return count
    },
  }
}

/** @type {Types.randomFrom} */
export function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** @type {Types.randomBetween} */
export function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

/** @type {Types.mapSlider} */
export function mapSlider(sliderValue, min, max, invert) {
  const clamped = Math.max(0, Math.min(100, sliderValue))
  const normalized = clamped / 100
  if (invert) {
    return max - normalized * (max - min)
  }
  return min + normalized * (max - min)
}
