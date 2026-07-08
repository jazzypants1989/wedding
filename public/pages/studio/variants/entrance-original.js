/** @file Studio comparison fixture — the ORIGINAL grand entrance (git HEAD~1).
 *
 *  Real per-sparkle DOM stars, created fresh each wave (no pool). Reads
 *  `sparkleIntensity`/`speed` as 0–100 slider values via `mapSlider`. Kept here
 *  verbatim (minus a local `mapSlider`, which main.js no longer exports) so the
 *  studio can A/B it against the box-shadow and pooled variants. NOT shipped.
 */
/** @import * as Types from "../../../effects/types.js" */

import { isMobile, randomFrom, randomBetween } from "../../../effects/main.js"
import { EFFECT_PALETTE } from "../../../effects/config.js"

/**
 * Map a 0–100 slider value onto a numeric range (optionally inverted).
 * Restored locally; the original effect imported this from main.js.
 * @param {number} sliderValue @param {number} min @param {number} max
 * @param {boolean} [invert]
 * @returns {number}
 */
function mapSlider(sliderValue, min, max, invert) {
  const clamped = Math.max(0, Math.min(100, sliderValue))
  const normalized = clamped / 100
  if (invert) {
    return max - normalized * (max - min)
  }
  return min + normalized * (max - min)
}

/** @type {Types.createGrandEntrance} */
export function createGrandEntranceOriginal(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let overlay = null
  /** @type {HTMLDivElement | null} */
  let sparkleContainer = null
  /** @type {ReturnType<typeof setTimeout>[]} */
  let timeoutIds = []
  let active = false

  const entranceStyle = cfg.entranceStyle || "curtain"
  const sparkleIntensity =
    cfg.sparkleIntensity !== undefined ? cfg.sparkleIntensity : 50
  const speed = cfg.speed !== undefined ? cfg.speed : 50
  const colors = cfg.colors || [
    EFFECT_PALETTE.gold,
    EFFECT_PALETTE.white,
    EFFECT_PALETTE.brand,
    EFFECT_PALETTE.pink,
    EFFECT_PALETTE.sky,
    EFFECT_PALETTE.purple,
  ]

  function getSparkleCount() {
    const base = isMobile() ? 15 : 60
    return Math.round(mapSlider(sparkleIntensity, base * 0.3, base * 2))
  }

  function getSpeedFactor() {
    return mapSlider(speed, 1.5, 0.4, true)
  }

  /** @param {number} startY @param {number} waveWidth */
  function createSparkleWave(startY, waveWidth) {
    if (!sparkleContainer || !active) return
    const count = getSparkleCount()
    const w = window.innerWidth

    for (let i = 0; i < count; i++) {
      const sparkle = document.createElement("div")
      sparkle.className = "grand-entrance-sparkle"

      const x = randomBetween(0, w)
      const y = startY + randomBetween(-waveWidth, waveWidth)
      sparkle.style.left = x + "px"
      sparkle.style.top = y + "px"

      const size = randomBetween(3, 8)
      sparkle.style.width = size + "px"
      sparkle.style.height = size + "px"
      sparkle.style.backgroundColor = randomFrom(colors)

      const duration = randomBetween(0.8, 2)
      sparkle.style.animationDuration = duration + "s"
      sparkle.style.animationDelay = randomBetween(0, 0.5) + "s"

      sparkleContainer.appendChild(sparkle)
    }
  }

  function runCurtainEntrance() {
    const speedFactor = getSpeedFactor()

    // Stage 1: Overlay appears
    overlay = document.createElement("div")
    overlay.className = "grand-entrance-overlay"
    overlay.setAttribute("aria-hidden", "true")
    overlay.style.animationDuration = 1.2 * speedFactor + "s"
    document.body.appendChild(overlay)

    // Stage 2: Sparkle cascade from top to bottom
    sparkleContainer = document.createElement("div")
    sparkleContainer.className = "effect-layer grand-entrance-sparkles"
    sparkleContainer.setAttribute("aria-hidden", "true")
    sparkleContainer.addEventListener("animationend", function (e) {
      const target = /** @type {HTMLElement} */ (e.target)
      if (target.classList.contains("grand-entrance-sparkle")) {
        target.remove()
      }
    })
    document.body.appendChild(sparkleContainer)

    const h = window.innerHeight
    const waveCount = 5
    const waveDelay = 300 * speedFactor

    for (let w = 0; w < waveCount; w++) {
      const tid = setTimeout(
        (function (waveIdx) {
          return function () {
            if (!active) return
            const y = (h * waveIdx) / waveCount
            createSparkleWave(y, h / waveCount)
          }
        })(w),
        w * waveDelay + 200 * speedFactor,
      )
      timeoutIds.push(tid)
    }

    // Stage 3: Overlay fades out
    const fadeId = setTimeout(
      function () {
        if (overlay && active) {
          overlay.classList.add("grand-entrance-overlay-fade")
          const removeId = setTimeout(function () {
            if (overlay) {
              overlay.remove()
              overlay = null
            }
          }, 1000 * speedFactor)
          timeoutIds.push(removeId)
        }
      },
      waveCount * waveDelay + 600 * speedFactor,
    )
    timeoutIds.push(fadeId)

    // Stage 4: Final cleanup
    const cleanupId = setTimeout(
      function () {
        cleanupAll()
      },
      waveCount * waveDelay + 3000 * speedFactor,
    )
    timeoutIds.push(cleanupId)
  }

  function runSparkleShower() {
    const speedFactor = getSpeedFactor()

    sparkleContainer = document.createElement("div")
    sparkleContainer.className = "effect-layer grand-entrance-sparkles"
    sparkleContainer.setAttribute("aria-hidden", "true")
    sparkleContainer.addEventListener("animationend", function (e) {
      const target = /** @type {HTMLElement} */ (e.target)
      if (target.classList.contains("grand-entrance-sparkle")) {
        target.remove()
      }
    })
    document.body.appendChild(sparkleContainer)

    const waveCount = 8
    const waveDelay = 200 * speedFactor

    for (let w = 0; w < waveCount; w++) {
      const tid = setTimeout(
        (function (waveIdx) {
          return function () {
            if (!active) return
            createSparkleWave(-20, 60)
          }
        })(w),
        w * waveDelay,
      )
      timeoutIds.push(tid)
    }

    const cleanupId = setTimeout(
      function () {
        cleanupAll()
      },
      waveCount * waveDelay + 3000 * speedFactor,
    )
    timeoutIds.push(cleanupId)
  }

  function runGoldenReveal() {
    const speedFactor = getSpeedFactor()

    overlay = document.createElement("div")
    overlay.className = "grand-entrance-overlay grand-entrance-overlay-golden"
    overlay.setAttribute("aria-hidden", "true")
    overlay.style.animationDuration = 2 * speedFactor + "s"
    document.body.appendChild(overlay)

    sparkleContainer = document.createElement("div")
    sparkleContainer.className = "effect-layer grand-entrance-sparkles"
    sparkleContainer.setAttribute("aria-hidden", "true")
    sparkleContainer.addEventListener("animationend", function (e) {
      const target = /** @type {HTMLElement} */ (e.target)
      if (target.classList.contains("grand-entrance-sparkle")) {
        target.remove()
      }
    })
    document.body.appendChild(sparkleContainer)

    // Radial sparkle burst from center
    const burstId = setTimeout(function () {
      if (!active) return
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const count = getSparkleCount()

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count
        const dist = randomBetween(
          50,
          Math.max(window.innerWidth, window.innerHeight) * 0.6,
        )
        const sparkle = document.createElement("div")
        sparkle.className =
          "grand-entrance-sparkle grand-entrance-sparkle-radial"
        sparkle.style.left = cx + "px"
        sparkle.style.top = cy + "px"
        sparkle.style.setProperty("--tx", Math.cos(angle) * dist + "px")
        sparkle.style.setProperty("--ty", Math.sin(angle) * dist + "px")
        sparkle.style.backgroundColor = randomFrom(colors)

        const size = randomBetween(3, 7)
        sparkle.style.width = size + "px"
        sparkle.style.height = size + "px"
        sparkle.style.animationDuration = randomBetween(1, 2.5) + "s"
        sparkle.style.animationDelay = randomBetween(0, 0.3) + "s"

        if (sparkleContainer) sparkleContainer.appendChild(sparkle)
      }
    }, 400 * speedFactor)
    timeoutIds.push(burstId)

    const fadeId = setTimeout(function () {
      if (overlay && active) {
        overlay.classList.add("grand-entrance-overlay-fade")
        const removeId = setTimeout(function () {
          if (overlay) {
            overlay.remove()
            overlay = null
          }
        }, 1000 * speedFactor)
        timeoutIds.push(removeId)
      }
    }, 1500 * speedFactor)
    timeoutIds.push(fadeId)

    const cleanupId = setTimeout(function () {
      cleanupAll()
    }, 4000 * speedFactor)
    timeoutIds.push(cleanupId)
  }

  function cleanupAll() {
    if (sparkleContainer) {
      sparkleContainer.remove()
      sparkleContainer = null
    }
    if (overlay) {
      overlay.remove()
      overlay = null
    }
  }

  function start() {
    if (active) return

    active = true

    if (entranceStyle === "shower") {
      runSparkleShower()
    } else if (entranceStyle === "golden") {
      runGoldenReveal()
    } else {
      runCurtainEntrance()
    }
  }

  function stop() {
    active = false
    for (let i = 0; i < timeoutIds.length; i++) {
      clearTimeout(timeoutIds[i])
    }
    timeoutIds = []
    cleanupAll()
  }

  return { start, stop }
}
