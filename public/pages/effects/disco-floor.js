/** @file Disco floor tiles — colorful pulsing tiles at the bottom of viewport */

import { isMobile, randomFrom, mapSlider } from "./effect-helpers.js"

const FLOOR_COLORS = [
  "rgb(221, 115, 100)", "#ff69b4", "#ffd700", "#87ceeb",
  "#fff", "#f4978e", "#c44dff", "#45ffa5",
]

export function createDiscoFloor(config) {
  const cfg = config || {}
  let container = null
  let intervalId = null
  let patternIntervalId = null
  let tiles = []
  let currentPattern = "chase"

  const tileCountSlider = cfg.tileCount !== undefined ? cfg.tileCount : 50
  const colorPalette = cfg.colorPalette !== undefined ? cfg.colorPalette : 50
  const pattern = cfg.pattern || "chase"

  function getTileCount() {
    const base = isMobile() ? 8 : 14
    return Math.round(mapSlider(tileCountSlider, base * 0.5, base * 1.5))
  }

  function getColors() {
    const variety = Math.round(mapSlider(colorPalette, 3, FLOOR_COLORS.length))
    return FLOOR_COLORS.slice(0, variety)
  }

  function updateChase(colors) {
    if (tiles.length === 0) return
    var lastColor = tiles[tiles.length - 1].style.backgroundColor
    for (var i = tiles.length - 1; i > 0; i--) {
      tiles[i].style.backgroundColor = tiles[i - 1].style.backgroundColor
    }
    tiles[0].style.backgroundColor = randomFrom(colors)
  }

  function updatePulse(colors) {
    var color = randomFrom(colors)
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].style.backgroundColor = color
    }
    // Fade back to varied colors after brief moment
    setTimeout(function () {
      for (var i = 0; i < tiles.length; i++) {
        tiles[i].style.backgroundColor = randomFrom(colors)
      }
    }, 250)
  }

  function updateRainbow(colors) {
    for (var i = 0; i < tiles.length; i++) {
      var colorIndex = (i + Math.floor(Date.now() / 500)) % colors.length
      tiles[i].style.backgroundColor = colors[colorIndex]
      tiles[i].style.opacity = ""
    }
  }

  function updateWave(colors) {
    var time = Date.now() / 1000
    for (var i = 0; i < tiles.length; i++) {
      var phase = (i / tiles.length) * Math.PI * 2
      var wave = 0.4 + 0.6 * Math.abs(Math.sin(time * 2 + phase))
      tiles[i].style.opacity = String(wave)
      if (wave > 0.8 && Math.random() > 0.85) {
        tiles[i].style.backgroundColor = randomFrom(colors)
      }
    }
  }

  function animateTiles() {
    var colors = getColors()
    if (currentPattern === "chase") {
      updateChase(colors)
    } else if (currentPattern === "pulse") {
      updatePulse(colors)
    } else if (currentPattern === "wave") {
      updateWave(colors)
    } else {
      updateRainbow(colors)
    }
  }

  function start() {
    if (container) return
    currentPattern = pattern

    container = document.createElement("div")
    container.className = "disco-floor"
    document.body.appendChild(container)

    var tileCount = getTileCount()
    var colors = getColors()
    tiles = []

    for (var i = 0; i < tileCount; i++) {
      var tile = document.createElement("div")
      tile.className = "disco-floor-tile"
      tile.style.backgroundColor = randomFrom(colors)
      container.appendChild(tile)
      tiles.push(tile)
    }

    intervalId = setInterval(animateTiles, 500)
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (patternIntervalId) {
      clearInterval(patternIntervalId)
      patternIntervalId = null
    }
    tiles = []
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
