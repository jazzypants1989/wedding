/** @file Click ripple effect — expanding rings from click point */

import { mapSlider } from "./effect-helpers.js"

export function createClickRipple(config) {
  const cfg = config || {}
  let clickHandler = null
  let container = null
  let count = 0

  const ringCount = cfg.ringCount !== undefined ? cfg.ringCount : 2
  const colorWarmth = cfg.color !== undefined ? cfg.color : 50

  function getRingColor() {
    const warmth = mapSlider(colorWarmth, 0, 1)
    if (warmth > 0.6) return "rgba(221, 115, 100, 0.6)"
    if (warmth > 0.3) return "rgba(255, 215, 0, 0.5)"
    return "rgba(255, 255, 255, 0.5)"
  }

  function handleClick(e) {
    if (!container) return

    // Don't ripple on effects panel or button clicks
    var target = e.target
    if (target && target.closest) {
      if (target.closest(".effects-panel") || target.closest(".effects-toggle-btn")) return
    }

    if (count >= 15) return

    var color = getRingColor()
    var rings = Math.max(1, Math.min(3, ringCount))

    for (var i = 0; i < rings; i++) {
      var ring = document.createElement("div")
      ring.className = "click-ripple"
      ring.style.left = e.clientX + "px"
      ring.style.top = e.clientY + "px"
      ring.style.borderColor = color
      ring.style.animationDelay = (i * 0.15) + "s"

      count++
      ring.addEventListener("animationend", function () {
        ring.remove()
        count--
      })

      container.appendChild(ring)
    }
  }

  function start() {
    if (clickHandler) return

    container = document.createElement("div")
    container.className = "effect-layer"
    container.style.zIndex = "9998"
    document.body.appendChild(container)

    count = 0
    clickHandler = handleClick
    document.addEventListener("click", clickHandler)
  }

  function stop() {
    if (clickHandler) {
      document.removeEventListener("click", clickHandler)
      clickHandler = null
    }
    if (container) {
      container.remove()
      container = null
    }
    count = 0
  }

  return { start, stop }
}
