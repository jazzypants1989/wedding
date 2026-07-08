/** @file Studio comparison fixture — the BOX-SHADOW grand entrance (git HEAD).
 *
 *  Renders each wave's sparkles as a single element's `box-shadow` list, so a
 *  wave is 1 DOM node instead of ~69. Cheapest render cost, but sparkles are
 *  round dots (pseudo-element cross-stars can't apply to box-shadow) and every
 *  sparkle in a wave shares one animation (lockstep fall). Needs the
 *  `.grand-entrance-wave` CSS, which is defined in studio.css (salvaged from
 *  HEAD, since the working tree removed it). NOT shipped.
 */
/** @import * as Types from "../../../effects/types.js" */

import {
  isMobile,
  randomFrom,
  randomBetween,
  cancellableDelay,
} from "../../../effects/main.js"
import { EFFECT_PALETTE } from "../../../effects/config.js"

/** @type {Types.createGrandEntrance} */
export function createGrandEntranceBoxShadow(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let overlay = null
  /** @type {HTMLDivElement | null} */
  let sparkleContainer = null
  /** @type {AbortController | null} */
  let controller = null

  const entranceStyle = cfg.entranceStyle || "curtain"
  const sparkleIntensity =
    cfg.sparkleIntensity !== undefined ? cfg.sparkleIntensity : 69
  const speed = cfg.speed !== undefined ? cfg.speed : 0.95
  const colors = cfg.colors || [
    EFFECT_PALETTE.gold,
    EFFECT_PALETTE.white,
    EFFECT_PALETTE.brand,
    EFFECT_PALETTE.pink,
    EFFECT_PALETTE.sky,
    EFFECT_PALETTE.purple,
  ]
  const sparkleSizeRange = cfg.sparkleSizeRange || [3, 8]
  const waveCount = cfg.waveCount !== undefined ? cfg.waveCount : 5

  function getSparkleCount() {
    return isMobile() ? Math.round(sparkleIntensity * 0.25) : sparkleIntensity
  }

  function getSpeedFactor() {
    return speed
  }

  /**
   * Create a single wave element that uses box-shadow to render all sparkles
   * as a single render object, avoiding per-element rendering overhead.
   * @param {number} startY @param {number} waveWidth
   */
  function createSparkleWave(startY, waveWidth) {
    if (!sparkleContainer) return
    const count = getSparkleCount()
    const w = window.innerWidth

    // Build a box-shadow string with one shadow per sparkle.
    // Each shadow is offset from (0,0) to the sparkle's position.
    const shadows = []
    for (let i = 0; i < count; i++) {
      const x = randomBetween(0, w)
      const y = startY + randomBetween(-waveWidth, waveWidth)
      const size = randomBetween(sparkleSizeRange[0], sparkleSizeRange[1])
      const color = randomFrom(colors)
      // box-shadow: offsetX offsetY blurRadius spreadRadius color
      shadows.push(x + "px " + y + "px 0 " + Math.round(size / 2) + "px " + color)
    }

    const wave = document.createElement("div")
    wave.className = "grand-entrance-wave"
    wave.style.boxShadow = shadows.join(",")

    const duration = randomBetween(0.8, 2)
    wave.style.animationDuration = duration + "s"

    sparkleContainer.appendChild(wave)
  }

  /**
   * Set up the sparkle container with animationend cleanup.
   * @param {AbortSignal} signal
   */
  function initSparkleContainer(signal) {
    sparkleContainer = document.createElement("div")
    sparkleContainer.className = "effect-layer grand-entrance-sparkles"
    sparkleContainer.setAttribute("aria-hidden", "true")
    sparkleContainer.addEventListener(
      "animationend",
      function (e) {
        const target = /** @type {HTMLElement} */ (e.target)
        if (
          target.classList.contains("grand-entrance-sparkle") ||
          target.classList.contains("grand-entrance-wave")
        ) {
          target.remove()
        }
      },
      { signal },
    )
    document.body.appendChild(sparkleContainer)
  }

  /** @param {AbortSignal} signal */
  async function runCurtainEntrance(signal) {
    const speedFactor = getSpeedFactor()

    // Stage 1: Overlay appears
    overlay = document.createElement("div")
    overlay.className = "grand-entrance-overlay"
    overlay.setAttribute("aria-hidden", "true")
    overlay.style.animationDuration = 1.2 * speedFactor + "s"
    document.body.appendChild(overlay)

    // Stage 2: Sparkle cascade from top to bottom
    initSparkleContainer(signal)

    const h = window.innerHeight
    const waveDelay = 300 * speedFactor

    await cancellableDelay(200 * speedFactor, signal)
    for (let w = 0; w < waveCount; w++) {
      if (w > 0) await cancellableDelay(waveDelay, signal)
      const y = (h * w) / waveCount
      createSparkleWave(y, h / waveCount)
    }

    // Stage 3: Overlay fades out
    await cancellableDelay(waveDelay + 400 * speedFactor, signal)
    if (overlay) {
      overlay.classList.add("grand-entrance-overlay-fade")
      await cancellableDelay(1000 * speedFactor, signal)
      if (overlay) {
        overlay.remove()
        overlay = null
      }
    }

    // Stage 4: Final cleanup
    await cancellableDelay(1400 * speedFactor, signal)
    cleanupAll()
  }

  /** @param {AbortSignal} signal */
  async function runSparkleShower(signal) {
    const speedFactor = getSpeedFactor()

    initSparkleContainer(signal)

    const showerWaveCount = Math.round(waveCount * 1.6)
    const waveDelay = 200 * speedFactor

    for (let w = 0; w < showerWaveCount; w++) {
      if (w > 0) await cancellableDelay(waveDelay, signal)
      createSparkleWave(-20, 60)
    }

    await cancellableDelay(waveDelay + 3000 * speedFactor, signal)
    cleanupAll()
  }

  /** @param {AbortSignal} signal */
  async function runGoldenReveal(signal) {
    const speedFactor = getSpeedFactor()

    overlay = document.createElement("div")
    overlay.className = "grand-entrance-overlay grand-entrance-overlay-golden"
    overlay.setAttribute("aria-hidden", "true")
    overlay.style.animationDuration = 2 * speedFactor + "s"
    document.body.appendChild(overlay)

    initSparkleContainer(signal)

    // Radial sparkle burst from center
    await cancellableDelay(400 * speedFactor, signal)
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
      sparkle.className = "grand-entrance-sparkle grand-entrance-sparkle-radial"
      sparkle.style.left = cx + "px"
      sparkle.style.top = cy + "px"
      sparkle.style.setProperty("--tx", Math.cos(angle) * dist + "px")
      sparkle.style.setProperty("--ty", Math.sin(angle) * dist + "px")
      sparkle.style.backgroundColor = randomFrom(colors)

      const size = randomBetween(
        sparkleSizeRange[0],
        Math.round((sparkleSizeRange[0] + sparkleSizeRange[1]) / 2),
      )
      sparkle.style.width = size + "px"
      sparkle.style.height = size + "px"
      sparkle.style.animationDuration = randomBetween(1, 2.5) + "s"
      sparkle.style.animationDelay = randomBetween(0, 0.3) + "s"

      sparkleContainer?.appendChild(sparkle)
    }

    await cancellableDelay(1100 * speedFactor, signal)
    if (overlay) {
      overlay.classList.add("grand-entrance-overlay-fade")
      await cancellableDelay(1000 * speedFactor, signal)
      if (overlay) {
        overlay.remove()
        overlay = null
      }
    }

    await cancellableDelay(1500 * speedFactor, signal)
    cleanupAll()
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
    if (controller) return

    controller = new AbortController()
    const signal = controller.signal

    /** @type {Promise<void>} */
    let run
    if (entranceStyle === "shower") {
      run = runSparkleShower(signal)
    } else if (entranceStyle === "golden") {
      run = runGoldenReveal(signal)
    } else {
      run = runCurtainEntrance(signal)
    }

    run.catch(function (e) {
      if (e && typeof e === "object" && "name" in e && /** @type {*} */ (e).name === "AbortError") return
      console.warn("Grand entrance error:", e)
    })
  }

  function stop() {
    if (controller) {
      controller.abort()
      controller = null
    }
    cleanupAll()
  }

  return { start, stop }
}
