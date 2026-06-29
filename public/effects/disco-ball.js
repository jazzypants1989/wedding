/** @file Disco ball effect — spinning disco ball with light rays */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween } from "./main.js"
import { EFFECT_PALETTE } from "./config.js"

const DEFAULT_TILE_SHADES = [
  "#e8e8e8",
  "#d4d4d4",
  "#c0c0c0",
  "#b0b0b0",
  "#a8a8a8",
  "#d0d0d0",
  "#dcdcdc",
  "#c8c8c8",
]

const DEFAULT_RAY_COLORS = [
  "rgba(255, 255, 255, 0.5)",
  "rgba(255, 200, 200, 0.4)",
  "rgba(200, 200, 255, 0.4)",
  "rgba(255, 255, 200, 0.4)",
  "rgba(200, 255, 200, 0.3)",
  "rgba(255, 200, 255, 0.3)",
]

/** @type {Types.createDiscoBall} */
export function createDiscoBall(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let wrapper = null

  const spinSpeed = cfg.spinSpeed !== undefined ? cfg.spinSpeed : 4.75
  const ballSize = cfg.ballSize !== undefined ? cfg.ballSize : 88
  const rayCountCfg = cfg.rayCount !== undefined ? cfg.rayCount : 6
  const rayBrightness = cfg.rayBrightness !== undefined ? cfg.rayBrightness : 0.4
  const rayColors = cfg.rayColors || DEFAULT_RAY_COLORS
  const tileSize = cfg.tileSize !== undefined ? cfg.tileSize : 7
  const tileGap = cfg.tileGap !== undefined ? cfg.tileGap : 1
  const rayDurRange = cfg.rayDurationRange || [3, 8]
  const rayDelRange = cfg.rayDelayRange || [0, 3]

  function getBallSize() {
    return isMobile() ? Math.round(ballSize * 0.75) : ballSize
  }

  function getSpinDuration() {
    return spinSpeed
  }

  function getRayCount() {
    const rc = isMobile() ? Math.min(rayCountCfg, 4) : rayCountCfg
    return Math.max(2, rc)
  }

  function buildBall() {
    const ballSize = getBallSize()

    const ball = document.createElement("div")
    ball.className = "disco-ball"
    ball.style.width = ballSize + "px"
    ball.style.height = ballSize + "px"
    ball.style.animationDuration = getSpinDuration() + "s"

    const cols = Math.floor(ballSize / (tileSize + tileGap))
    const rows = Math.floor(ballSize / (tileSize + tileGap))

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tile = document.createElement("div")
        tile.className = "disco-tile"
        tile.style.left = col * (tileSize + tileGap) + "px"
        tile.style.top = row * (tileSize + tileGap) + "px"
        tile.style.backgroundColor = randomFrom(DEFAULT_TILE_SHADES)
        tile.style.setProperty("--tile-delay", Math.random() * 4 + "s")
        ball.appendChild(tile)
      }
    }

    return ball
  }

  function buildRays() {
    const container = document.createElement("div")
    container.className = "disco-rays"

    const rayCount = getRayCount()
    const brightness = rayBrightness

    for (let i = 0; i < rayCount; i++) {
      const ray = document.createElement("div")
      ray.className = "disco-ray"
      ray.style.animationDuration = randomBetween(rayDurRange[0], rayDurRange[1]) + "s"
      ray.style.animationDelay = randomBetween(rayDelRange[0], rayDelRange[1]) + "s"
      ray.style.opacity = String(brightness)

      const colorStr =
        i < rayColors.length ? rayColors[i] : rayColors[i % rayColors.length]
      const colorGradient =
        "linear-gradient(90deg, " + colorStr + ", transparent)"
      ray.style.background = colorGradient

      container.appendChild(ray)
    }

    return container
  }

  function start() {
    if (wrapper) return

    wrapper = document.createElement("div")
    wrapper.className = "disco-ball-wrapper"
    wrapper.setAttribute("aria-hidden", "true")

    const string = document.createElement("div")
    string.className = "disco-ball-string"

    const ball = buildBall()
    const rays = buildRays()

    wrapper.appendChild(string)
    wrapper.appendChild(ball)
    wrapper.appendChild(rays)
    document.body.appendChild(wrapper)
  }

  function stop() {
    if (wrapper) {
      wrapper.remove()
      wrapper = null
    }
  }

  return { start, stop }
}
