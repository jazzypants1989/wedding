/** @file Shared effect helpers — pure/DOM-query utilities used by every effect
 *  factory. Split out of main.js so the factories (and the registry that lists
 *  them) carry no import-time dependency on main.js's DOM lifecycle side effects
 *  (the visibilitychange / reduced-motion listeners it registers at module load).
 *  That keeps registry.js importable in any environment for tests + dev tooling.
 *  `window` is only touched inside functions (call time), never at import.
 */
/** @import * as Types from './types.js' */

/** @type {Types.isMobile} */
export function isMobile() {
  return window.innerWidth < 768
}

/** @type {Types.prefersReducedMotion} */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** @type {Types.randomFrom} */
export function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** @type {Types.randomBetween} */
export function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

/** @type {Types.cappedCount} */
export function cappedCount(desired, max) {
  return Math.min(desired, max)
}

/** @type {Types.cancellableDelay} */
export function cancellableDelay(ms, signal) {
  return new Promise(function (resolve, reject) {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const id = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      function () {
        clearTimeout(id)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}
