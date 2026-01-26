/** @file Floating hearts effect — hearts rise from the bottom of the viewport */

import { isMobile, randomFrom, randomBetween, mapSlider } from "./effect-helpers.js"

const DEFAULT_COLORS = [
  "rgb(221, 115, 100)",
  "#ff69b4",
  "#ff8fa3",
  "#e8747c",
  "#f4978e",
]

export function createFloatingHearts(config) {
  const cfg = config || {}
  let container = null
  let intervalId = null
  let count = 0

  const speed = cfg.speed !== undefined ? cfg.speed : 50
  const density = cfg.density !== undefined ? cfg.density : 50
  const sizeMin = cfg.sizeMin !== undefined ? cfg.sizeMin : 0.5
  const sizeMax = cfg.sizeMax !== undefined ? cfg.sizeMax : 1.5
  const swayIntensity = cfg.swayIntensity !== undefined ? cfg.swayIntensity : 50
  const colors = cfg.colors || DEFAULT_COLORS

  function maxCount() {
    return isMobile() ? Math.round(mapSlider(density, 4, 12)) : Math.round(mapSlider(density, 8, 22))
  }

  function spawnInterval() {
    return mapSlider(density, 1400, 300, true)
  }

  function spawnHeart() {
    if (!container) return
    if (count >= maxCount()) return

    const heart = document.createElement("div")
    heart.className = "floating-heart"

    const color = randomFrom(colors)
    heart.style.backgroundColor = color
    heart.style.left = (Math.random() * 100) + "%"

    const durationMin = mapSlider(speed, 7, 2)
    const durationRange = mapSlider(speed, 5, 2)
    heart.style.animationDuration = (durationMin + Math.random() * durationRange) + "s"

    const scale = randomBetween(sizeMin, sizeMax)
    heart.style.setProperty("--heart-scale", String(scale))

    const drift = randomBetween(-1, 1) * mapSlider(swayIntensity, 5, 30)
    heart.style.setProperty("--drift", drift + "px")

    heart.style.opacity = String(randomBetween(0.4, 0.9))

    count++
    heart.addEventListener("animationend", function () {
      heart.remove()
      count--
    })

    container.appendChild(heart)
  }

  function start() {
    if (container) return
    container = document.createElement("div")
    container.className = "effect-layer"
    document.body.appendChild(container)
    count = 0
    intervalId = setInterval(spawnHeart, spawnInterval())
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
