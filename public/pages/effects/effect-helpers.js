/** @file Shared utilities for visual effects */

/**
 * Check if the viewport is mobile-sized.
 * @returns {boolean}
 */
export function isMobile() {
  return window.innerWidth < 768
}

/**
 * Check if the user prefers reduced motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Create a fixed-position effect layer container.
 * @param {string} [extraClass] - Optional additional CSS class
 * @returns {HTMLDivElement}
 */
export function createEffectLayer(extraClass) {
  const container = document.createElement("div")
  container.className = "effect-layer" + (extraClass ? " " + extraClass : "")
  return container
}

/**
 * Run a spawn loop that respects a max element count.
 * Returns an object with stop() to clear the interval.
 * @param {object} options
 * @param {HTMLElement} options.container - Container to append elements to
 * @param {function} options.spawnFn - Called to create and return a new element (or null to skip)
 * @param {number} options.interval - Spawn interval in ms
 * @param {function} options.maxCount - Function returning the current max count
 * @returns {{ stop: () => void, getCount: () => number }}
 */
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

/**
 * Pick a random item from an array.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
export function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Generate a random number between min and max.
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

/**
 * Map a 0-100 slider value to a range.
 * @param {number} sliderValue - Value between 0 and 100
 * @param {number} min - Output minimum
 * @param {number} max - Output maximum
 * @param {boolean} [invert] - If true, 100 maps to min and 0 maps to max
 * @returns {number}
 */
export function mapSlider(sliderValue, min, max, invert) {
  const clamped = Math.max(0, Math.min(100, sliderValue))
  const normalized = clamped / 100
  if (invert) {
    return max - normalized * (max - min)
  }
  return min + normalized * (max - min)
}
