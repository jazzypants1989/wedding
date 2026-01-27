/** @file Sparkle dividers — animated sparkle lines between content sections */
/** @import * as Types from './types.js' */

import { mapSlider } from "./effect-helpers.js"

/** @type {Types.createSparkleDividers} */
export function createSparkleDividers(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement[]} */
  let dividers = []

  const dotDensity = cfg.dotDensity !== undefined ? cfg.dotDensity : 50
  const color = cfg.color !== undefined ? cfg.color : 50

  function getDotCount() {
    return Math.round(mapSlider(dotDensity, 8, 30))
  }

  function getDotColor() {
    const warmth = mapSlider(color, 0, 1)
    if (warmth > 0.6) return "rgb(221, 115, 100)"
    if (warmth > 0.3) return "#ffd700"
    return "#fff"
  }

  function start() {
    if (dividers.length > 0) return

    const sections = document.querySelectorAll(".schedule-item, .content-section")
    const dotCount = getDotCount()
    const dotColor = getDotColor()

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      const divider = document.createElement("div")
      divider.className = "sparkle-divider"

      for (let d = 0; d < dotCount; d++) {
        const dot = document.createElement("div")
        dot.className = "sparkle-divider-dot"
        dot.style.left = ((d / (dotCount - 1)) * 100) + "%"
        dot.style.backgroundColor = dotColor
        dot.style.animationDelay = (d * 0.1) + "s"
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
