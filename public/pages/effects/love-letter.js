/** @file Love letter / envelope — decorative envelope that opens periodically */

import { randomBetween, mapSlider } from "./effect-helpers.js"

export function createLoveLetter(config) {
  const cfg = config || {}
  let wrapper = null
  let timeoutId = null
  let active = false

  const frequency = cfg.frequency !== undefined ? cfg.frequency : 50

  function getCycleDelay() {
    return mapSlider(frequency, 40000, 12000, true)
  }

  function runCycle() {
    if (!wrapper || !active) return

    wrapper.classList.add("envelope--opening")

    // After flap opens, show heart
    setTimeout(function () {
      if (!wrapper || !active) return
      var heart = wrapper.querySelector(".envelope-heart")
      if (heart) heart.classList.add("envelope-heart--rising")
    }, 600)

    // Close after heart escapes
    setTimeout(function () {
      if (!wrapper || !active) return
      wrapper.classList.remove("envelope--opening")
      var heart = wrapper.querySelector(".envelope-heart")
      if (heart) heart.classList.remove("envelope-heart--rising")
    }, 2500)

    // Schedule next cycle
    timeoutId = setTimeout(runCycle, getCycleDelay())
  }

  function start() {
    if (wrapper) return
    active = true

    wrapper = document.createElement("div")
    wrapper.className = "envelope-wrapper"

    var body = document.createElement("div")
    body.className = "envelope-body"

    var flap = document.createElement("div")
    flap.className = "envelope-flap"

    var heart = document.createElement("div")
    heart.className = "envelope-heart"

    wrapper.appendChild(heart)
    wrapper.appendChild(body)
    wrapper.appendChild(flap)
    document.body.appendChild(wrapper)

    // Start first cycle after a short delay
    timeoutId = setTimeout(runCycle, randomBetween(3000, 6000))
  }

  function stop() {
    active = false
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (wrapper) {
      wrapper.remove()
      wrapper = null
    }
  }

  return { start, stop }
}
