/** @file Bubble float effect — translucent bubbles rising upward */

import { isMobile, randomBetween, mapSlider } from "./effect-helpers.js"

export function createBubbleFloat(config) {
  const cfg = config || {}
  let container = null
  let intervalId = null
  let count = 0

  const sizeMinCfg = cfg.sizeMin !== undefined ? cfg.sizeMin : 20
  const sizeMaxCfg = cfg.sizeMax !== undefined ? cfg.sizeMax : 60
  const riseSpeed = cfg.riseSpeed !== undefined ? cfg.riseSpeed : 50
  const density = cfg.density !== undefined ? cfg.density : 50
  const transparency = cfg.transparency !== undefined ? cfg.transparency : 50

  function maxCount() {
    return isMobile() ? Math.round(mapSlider(density, 4, 12)) : Math.round(mapSlider(density, 6, 18))
  }

  function spawnInterval() {
    return mapSlider(density, 2000, 500, true)
  }

  function spawnBubble() {
    if (!container) return
    if (count >= maxCount()) return

    const bubble = document.createElement("div")
    bubble.className = "bubble"

    const size = randomBetween(sizeMinCfg, sizeMaxCfg)
    bubble.style.width = size + "px"
    bubble.style.height = size + "px"
    bubble.style.left = (Math.random() * 100) + "%"

    // Smaller bubbles rise faster (simulating buoyancy)
    const speedFactor = mapSlider(riseSpeed, 1.5, 0.5, true)
    const duration = (3 + (size / 60) * 5) * speedFactor
    bubble.style.animationDuration = duration + "s"

    const baseOpacity = mapSlider(transparency, 0.15, 0.7)
    bubble.style.opacity = String(baseOpacity + Math.random() * 0.15)

    // Randomized wobble
    const w1 = randomBetween(-25, 25)
    const w2 = randomBetween(-20, 20)
    const w3 = randomBetween(-15, 15)
    bubble.style.setProperty("--wobble-1", w1 + "px")
    bubble.style.setProperty("--wobble-2", w2 + "px")
    bubble.style.setProperty("--wobble-3", w3 + "px")

    count++
    bubble.addEventListener("animationend", function () {
      bubble.remove()
      count--
    })

    container.appendChild(bubble)
  }

  function start() {
    if (container) return
    container = document.createElement("div")
    container.className = "effect-layer"
    document.body.appendChild(container)
    count = 0
    intervalId = setInterval(spawnBubble, spawnInterval())
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (container) {
      container.remove()
      container = null
    }
    count = 0
  }

  return { start, stop }
}
