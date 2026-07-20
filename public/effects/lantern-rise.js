/** @file Paper lanterns — warm lanterns rising with a soft glow, gentle sway,
 *  and an independent flicker on the lantern body. */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, cappedCount } from "./effect-utils.js"

const DEFAULT_COLORS = [
  "var(--fx-gold-1)",
  "var(--fx-warm-1)",
  "var(--fx-gold-2)",
  "var(--fx-gold-3)",
]

// Absolute ceiling regardless of config: lanterns are large, glowing,
// will-change'd nodes — cap well below the schema's permissive max.
const MAX_LANTERNS = 60

/** @type {Types.createLanternRise} */
export function createLanternRise(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const lanternCount = cfg.lanternCount !== undefined ? cfg.lanternCount : 10
  const colors = cfg.colors || DEFAULT_COLORS
  const riseDurationRange = cfg.riseDurationRange || [12, 22]
  const delayRange = cfg.delayRange || [0, 10]
  const sizeRange = cfg.sizeRange || [16, 34]
  const swayRange = cfg.swayRange || [20, 60]

  function getCount() {
    return cappedCount(isMobile() ? Math.round(lanternCount * 0.5) : lanternCount, MAX_LANTERNS)
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer lanterns-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      // Outer element owns the rise + sway; inner body owns the glow + flicker,
      // so the two run on independent timelines.
      const lantern = document.createElement("div")
      lantern.className = "paper-lantern"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const sway = randomBetween(swayRange[0], swayRange[1]) * (Math.random() < 0.5 ? -1 : 1)
      lantern.style.left = randomBetween(0, 100) + "%"
      lantern.style.setProperty("--sway", sway + "px")
      lantern.style.setProperty("--lantern-opacity", String(randomBetween(0.4, 0.8)))
      lantern.style.animationDuration =
        randomBetween(riseDurationRange[0], riseDurationRange[1]) + "s"
      lantern.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"

      const body = document.createElement("div")
      body.className = "paper-lantern-body"
      const color = randomFrom(colors)
      body.style.width = size + "px"
      body.style.height = size * 1.25 + "px"
      // Inner-flame look: CSS reads --lantern-color for a warm-core radial
      // gradient instead of a flat fill.
      body.style.setProperty("--lantern-color", color)
      body.style.color = color // drives the currentColor glow in box-shadow
      body.style.animationDuration = randomBetween(1.2, 2.6) + "s"
      body.style.animationDelay = randomBetween(0, 2) + "s"
      lantern.appendChild(body)

      container.appendChild(lantern)
    }

    document.body.appendChild(container)
  }

  function stop() {
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
