/** @file Golden dust — fine champagne motes drifting slowly upward with a glow. */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween } from "./effect-utils.js"
import { EFFECT_PALETTE } from "./config.js"

const DEFAULT_COLORS = [EFFECT_PALETTE.gold, "#f0e0b0", "#fff8e7", "#e8c977"]

/** @type {Types.createGoldenDust} */
export function createGoldenDust(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const density = cfg.density !== undefined ? cfg.density : 26
  const colors = cfg.colors || DEFAULT_COLORS
  const driftDurationRange = cfg.driftDurationRange || [10, 20]
  const delayRange = cfg.delayRange || [0, 12]
  const sizeRange = cfg.sizeRange || [2, 5]
  const swayRange = cfg.swayRange || [10, 30]

  function getCount() {
    return isMobile() ? Math.round(density * 0.4) : density
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer golden-dust-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      const mote = document.createElement("div")
      mote.className = "golden-dust-mote"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const sway = randomBetween(swayRange[0], swayRange[1]) * (Math.random() < 0.5 ? -1 : 1)
      const color = randomFrom(colors)
      mote.style.width = size + "px"
      mote.style.height = size + "px"
      mote.style.left = randomBetween(0, 100) + "%"
      mote.style.backgroundColor = color
      mote.style.color = color // drives the currentColor glow in box-shadow
      mote.style.setProperty("--sway", sway + "px")
      mote.style.setProperty("--dust-opacity", String(randomBetween(0.3, 0.7)))
      mote.style.animationDuration =
        randomBetween(driftDurationRange[0], driftDurationRange[1]) + "s"
      mote.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"
      container.appendChild(mote)
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
