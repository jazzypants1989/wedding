/** @file Sparkle dividers — animated sparkle lines between content sections */
/** @import * as Types from './types.js' */

import { EFFECT_PALETTE } from "./config.js"

/** @type {Types.createSparkleDividers} */
export function createSparkleDividers(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement[]} */
  let dividers = []

  const dotDensity = cfg.dotDensity !== undefined ? cfg.dotDensity : 19
  const color = cfg.color !== undefined ? cfg.color : 0.5
  const animationDelayStep = cfg.animationDelayStep !== undefined ? cfg.animationDelayStep : 0.1

  function getDotCount() {
    return Math.round(dotDensity)
  }

  function getDotColor() {
    if (color > 0.6) return EFFECT_PALETTE.brand
    if (color > 0.3) return EFFECT_PALETTE.gold
    return EFFECT_PALETTE.white
  }

  function start() {
    if (dividers.length > 0) return

    const sections = document.querySelectorAll(
      ".schedule-item, .content-section",
    )
    const dotCount = getDotCount()
    const dotColor = getDotColor()

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      const divider = document.createElement("div")
      divider.className = "sparkle-divider"
      divider.setAttribute("aria-hidden", "true")

      for (let d = 0; d < dotCount; d++) {
        const dot = document.createElement("div")
        dot.className = "sparkle-divider-dot"
        dot.style.left = (d / (dotCount - 1)) * 100 + "%"
        dot.style.backgroundColor = dotColor
        dot.style.animationDelay = d * animationDelayStep + "s"
        divider.appendChild(dot)
      }

      section.appendChild(divider)
      dividers.push(divider)
    }
  }

  function stop() {
    for (let i = 0; i < dividers.length; i++) {
      dividers[i].remove()
    }
    dividers = []
  }

  return { start, stop }
}
