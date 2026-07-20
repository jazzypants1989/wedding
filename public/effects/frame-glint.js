/** @file Frame glint — a periodic diagonal specular sweep across framed elements
 *  (`.tc-polaroid`). Unlike the particle effects there is no container: on an
 *  interval it briefly adds a sweep class to each target. Harmless where no
 *  targets exist, and — being the one effect with a JS timer — it MUST clear
 *  its interval (and every per-target setTimeout it schedules) in stop().
 */
/** @import * as Types from './types.js' */

import { prefersReducedMotion } from "./effect-utils.js"

const SWEEP_CLASS = "tc-glint-sweep"
// Per-target extra delay so a stack of polaroids glints in a cascade rather
// than flashing in unison.
const STAGGER_MS = 120

/** @type {Types.createFrameGlint} */
export function createFrameGlint(config) {
  const cfg = config || {}
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const pendingTimeouts = new Set()

  const sweepIntervalMs = cfg.sweepIntervalMs !== undefined ? cfg.sweepIntervalMs : 6000
  const sweepDurationMs = cfg.sweepDurationMs !== undefined ? cfg.sweepDurationMs : 1400
  const angle = cfg.angle !== undefined ? cfg.angle : 22
  const intensity = cfg.intensity !== undefined ? cfg.intensity : 0.5

  /** Tracked setTimeout so stop() can cancel every in-flight sweep/cleanup.
   *  @param {() => void} fn @param {number} delay */
  function track(fn, delay) {
    const id = setTimeout(function () {
      pendingTimeouts.delete(id)
      fn()
    }, delay)
    pendingTimeouts.add(id)
  }

  function sweep() {
    // Reduced motion: leave the interval running (so it resumes correctly if
    // the preference flips) but do zero work — no class thrashing for no
    // visual payoff.
    if (prefersReducedMotion()) return

    // Re-query each tick so targets added after start() still glint.
    const targets = document.querySelectorAll(".tc-polaroid")
    targets.forEach((node, index) => {
      const el = /** @type {HTMLElement} */ (node)
      track(function () {
        el.style.setProperty("--glint-duration", sweepDurationMs + "ms")
        el.style.setProperty("--glint-angle", angle + "deg")
        el.style.setProperty("--glint-intensity", String(intensity))
        // Restart the animation cleanly if a prior sweep is still in flight.
        el.classList.remove(SWEEP_CLASS)
        void el.offsetWidth
        el.classList.add(SWEEP_CLASS)
        track(function () {
          el.classList.remove(SWEEP_CLASS)
        }, sweepDurationMs)
      }, index * STAGGER_MS)
    })
  }

  function start() {
    if (timer !== null) return
    sweep() // First sweep immediately — otherwise polaroids sit dull for a
    // full sweepIntervalMs right after landing.
    timer = setInterval(sweep, sweepIntervalMs)
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    pendingTimeouts.forEach(function (id) {
      clearTimeout(id)
    })
    pendingTimeouts.clear()
    document.querySelectorAll("." + SWEEP_CLASS).forEach((node) => {
      const el = /** @type {HTMLElement} */ (node)
      el.classList.remove(SWEEP_CLASS)
      el.style.removeProperty("--glint-duration")
      el.style.removeProperty("--glint-angle")
      el.style.removeProperty("--glint-intensity")
    })
  }

  return { start, stop }
}
