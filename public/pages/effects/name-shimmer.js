/** @file Name shimmer effect — traveling light highlight on the couple's names */

import { mapSlider } from "./effect-helpers.js"

export function createNameShimmer(config) {
  const cfg = config || {}
  let target = null
  let active = false

  const shimmerSpeed = cfg.shimmerSpeed !== undefined ? cfg.shimmerSpeed : 50
  const shimmerColor = cfg.shimmerColor || "gold"

  function getShimmerClass() {
    return "couple-names--shimmer couple-names--shimmer-" + shimmerColor
  }

  function start() {
    if (active) return
    active = true

    target = document.querySelector(".couple-names")
    if (!target) return

    const duration = mapSlider(shimmerSpeed, 12, 4, true)
    target.style.setProperty("--shimmer-duration", duration + "s")

    const cls = getShimmerClass()
    const parts = cls.split(" ")
    for (let i = 0; i < parts.length; i++) {
      target.classList.add(parts[i])
    }
  }

  function stop() {
    active = false
    if (target) {
      target.classList.remove("couple-names--shimmer")
      target.classList.remove("couple-names--shimmer-gold")
      target.classList.remove("couple-names--shimmer-white")
      target.classList.remove("couple-names--shimmer-pink")
      target.style.removeProperty("--shimmer-duration")
      target = null
    }
  }

  return { start, stop }
}
