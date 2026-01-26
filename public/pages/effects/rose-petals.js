/** @file Rose petal fall effect — petals tumbling down with 3D rotation */

import { isMobile, randomFrom, randomBetween, mapSlider } from "./effect-helpers.js"

const DEFAULT_COLORS = [
  "rgb(221, 115, 100)", "#ff69b4", "#ff8fa3", "#e8747c",
  "#f4978e", "#dc143c", "#c44040",
]

export function createRosePetals(config) {
  const cfg = config || {}
  let container = null
  let intervalId = null
  let count = 0

  const density = cfg.density !== undefined ? cfg.density : 50
  const windDirection = cfg.windDirection !== undefined ? cfg.windDirection : 50
  const sizeMin = cfg.sizeMin !== undefined ? cfg.sizeMin : 0.7
  const sizeMax = cfg.sizeMax !== undefined ? cfg.sizeMax : 1.3
  const colors = cfg.colors || DEFAULT_COLORS

  function maxCount() {
    return isMobile() ? Math.round(mapSlider(density, 5, 14)) : Math.round(mapSlider(density, 10, 25))
  }

  function spawnInterval() {
    return mapSlider(density, 1200, 300, true)
  }

  function spawnPetal() {
    if (!container) return
    if (count >= maxCount()) return

    const petal = document.createElement("div")
    petal.className = "rose-petal"

    const color = randomFrom(colors)
    petal.style.backgroundColor = color
    petal.style.left = (Math.random() * 100) + "%"

    const scale = randomBetween(sizeMin, sizeMax)
    petal.style.setProperty("--petal-scale", String(scale))

    const duration = randomBetween(6, 12)
    const tumbleDuration = randomBetween(3, 5)
    petal.style.animationDuration = duration + "s, " + tumbleDuration + "s"

    // Wind drift based on slider (0 = left, 50 = center, 100 = right)
    const windDrift = mapSlider(windDirection, -60, 60)
    const drift = windDrift + randomBetween(-20, 20)
    petal.style.setProperty("--petal-drift", drift + "px")

    petal.style.opacity = String(randomBetween(0.6, 0.95))

    count++
    petal.addEventListener("animationend", function () {
      petal.remove()
      count--
    })

    container.appendChild(petal)
  }

  function start() {
    if (container) return
    container = document.createElement("div")
    container.className = "effect-layer"
    document.body.appendChild(container)
    count = 0
    intervalId = setInterval(spawnPetal, spawnInterval())
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
