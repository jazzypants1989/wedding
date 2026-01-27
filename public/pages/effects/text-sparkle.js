/** @file Text sparkle on scroll — text sections glow as they scroll into view */
/** @import * as Types from './types.js' */

import { mapSlider } from "./effect-helpers.js"

/** @type {Types.createTextSparkle} */
export function createTextSparkle(config) {
  const cfg = config || {}
  /** @type {IntersectionObserver | null} */
  let observer = null
  /** @type {HTMLElement[]} */
  let observed = []

  const intensity = cfg.intensity !== undefined ? cfg.intensity : 50

  /** @param {IntersectionObserverEntry[]} entries */
  function handleIntersection(entries) {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (entry.isIntersecting) {
        const el = /** @type {HTMLElement} */ (entry.target)
        if (!el.classList.contains("text-sparkle-in")) {
          el.classList.add("text-sparkle-in")
          const glowStrength = mapSlider(intensity, 4, 12)
          el.style.setProperty("--glow-strength", glowStrength + "px")

          el.addEventListener("animationend", function handler() {
            el.classList.remove("text-sparkle-in")
            el.removeEventListener("animationend", handler)
          })
        }
      }
    }
  }

  function start() {
    if (observer) return

    observer = new IntersectionObserver(handleIntersection, {
      threshold: 0.5,
    })

    var targets = document.querySelectorAll(".content-section p, .schedule-details, .rsvp-intro")
    observed = []
    for (let i = 0; i < targets.length; i++) {
      observer.observe(targets[i])
      observed.push(/** @type {HTMLElement} */ (targets[i]))
    }
  }

  function stop() {
    if (observer) {
      observer.disconnect()
      observer = null
    }
    for (let i = 0; i < observed.length; i++) {
      observed[i].classList.remove("text-sparkle-in")
      observed[i].style.removeProperty("--glow-strength")
    }
    observed = []
  }

  return { start, stop }
}
