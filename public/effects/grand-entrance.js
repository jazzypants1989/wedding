/** @file Grand entrance — choreographed welcome cascade on page load */
/** @import * as Types from './types.js' */

import {
  isMobile,
  randomFrom,
  randomBetween,
  cancellableDelay,
} from "./main.js"
import { EFFECT_PALETTE } from "./config.js"

/** @type {Types.createGrandEntrance} */
export function createGrandEntrance(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let overlay = null
  /** @type {HTMLDivElement | null} */
  let sparkleContainer = null
  /** @type {AbortController | null} */
  let controller = null

  // Reusable star-sparkle pool for curtain/shower waves. Nodes are created once
  // (display:none → no layout cost while idle) and cycled: each wave repositions
  // free nodes and restarts their fall animation. The free list is a hard cap on
  // concurrent live sparkles — spawnSparkle() returns false when exhausted.
  /** @type {HTMLDivElement[]} */
  let freeSparkles = []
  /** @type {Set<HTMLDivElement>} */
  const pooledSet = new Set()

  // Absolute ceiling on pooled sparkles, on top of the mobile 0.25 factor.
  const SPARKLE_CAP = 100

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

  // Total sparkle budget for the whole entrance (== pool size). Previously
  // sparkleIntensity was a per-wave count (× waveCount ≈ 345 nodes); it now bounds
  // the entire cascade, so far fewer render objects hit the first-load TBT window.
  function getSparkleCount() {
    const base = isMobile()
      ? Math.round(sparkleIntensity * 0.25)
      : sparkleIntensity
    return Math.min(base, SPARKLE_CAP)
  }

  function getSpeedFactor() {
    return speed
  }

  /**
   * Pre-allocate the reusable star-sparkle pool. Nodes start display:none so
   * they generate no render objects until spawned.
   * @param {number} count
   */
  function buildSparklePool(count) {
    if (!sparkleContainer) return
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div")
      s.className = "grand-entrance-sparkle"
      s.style.display = "none"
      sparkleContainer.appendChild(s)
      freeSparkles.push(s)
      pooledSet.add(s)
    }
  }

  /**
   * Reposition an idle pooled sparkle and start its fall with a per-sparkle
   * random duration/delay (staggered twinkle). Returns false if the pool is
   * exhausted — the natural hard cap on concurrent nodes.
   * @param {number} x @param {number} y
   * @returns {boolean}
   */
  function spawnSparkle(x, y) {
    const s = freeSparkles.pop()
    if (!s) return false
    const size = randomBetween(sparkleSizeRange[0], sparkleSizeRange[1])
    s.style.left = x + "px"
    s.style.top = y + "px"
    s.style.width = size + "px"
    s.style.height = size + "px"
    s.style.backgroundColor = randomFrom(colors)
    s.style.display = "block"
    const dur = randomBetween(0.8, 2)
    const delay = randomBetween(0, 0.5)
    // Idle nodes carry animation:none, so assigning a named animation restarts
    // it cleanly — no forced-reflow hack needed. Timing is per-sparkle for a
    // staggered shimmer instead of the box-shadow version's lockstep.
    s.style.animation =
      "grand-entrance-sparkle-fall " + dur + "s ease-out " + delay + "s forwards"
    return true
  }

  /**
   * Spawn one wave of `perWave` pooled sparkles scattered around `startY`.
   * Stops early if the pool is exhausted.
   * @param {number} startY @param {number} waveWidth @param {number} perWave
   */
  function createSparkleWave(startY, waveWidth, perWave) {
    if (!sparkleContainer) return
    const w = window.innerWidth
    for (let i = 0; i < perWave; i++) {
      const x = randomBetween(0, w)
      const y = startY + randomBetween(-waveWidth, waveWidth)
      if (!spawnSparkle(x, y)) break
    }
  }

  /**
   * Set up the sparkle container with animationend handling: pooled sparkles are
   * returned to the free list for reuse; one-off sparkles (golden reveal) are
   * removed.
   * @param {AbortSignal} signal
   */
  function initSparkleContainer(signal) {
    sparkleContainer = document.createElement("div")
    sparkleContainer.className = "effect-layer grand-entrance-sparkles"
    sparkleContainer.setAttribute("aria-hidden", "true")
    sparkleContainer.addEventListener(
      "animationend",
      function (e) {
        const target = /** @type {HTMLDivElement} */ (e.target)
        if (pooledSet.has(target)) {
          target.style.display = "none"
          target.style.animation = "none"
          freeSparkles.push(target)
        } else if (
          target.classList &&
          target.classList.contains("grand-entrance-sparkle")
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
    buildSparklePool(getSparkleCount())

    const h = window.innerHeight
    const waveDelay = 300 * speedFactor
    // Split the total budget across waves so the whole cascade ≈ pool size.
    const perWave = Math.ceil(getSparkleCount() / waveCount)

    // Initial delay also pushes the first render-costly spawn past the
    // first-load Total-Blocking-Time window.
    await cancellableDelay(200 * speedFactor, signal)
    for (let w = 0; w < waveCount; w++) {
      if (w > 0) await cancellableDelay(waveDelay, signal)
      const y = (h * w) / waveCount
      createSparkleWave(y, h / waveCount, perWave)
    }

    // Stage 3: Overlay fades out
    // Original: waveCount*waveDelay + 600*sf from t=0
    // Elapsed:  200*sf + (waveCount-1)*waveDelay
    // Remaining: waveDelay + 400*sf
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
    buildSparklePool(getSparkleCount())

    const showerWaveCount = Math.round(waveCount * 1.6)
    const waveDelay = 200 * speedFactor
    const perWave = Math.ceil(getSparkleCount() / showerWaveCount)

    for (let w = 0; w < showerWaveCount; w++) {
      if (w > 0) await cancellableDelay(waveDelay, signal)
      createSparkleWave(-20, 60, perWave)
    }

    // Original cleanup: waveCount*waveDelay + 3000*sf from t=0
    // Elapsed: (waveCount-1)*waveDelay
    // Remaining: waveDelay + 3000*sf
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
      sparkle.className =
        "grand-entrance-sparkle grand-entrance-sparkle-radial"
      sparkle.style.left = cx + "px"
      sparkle.style.top = cy + "px"
      sparkle.style.setProperty("--tx", Math.cos(angle) * dist + "px")
      sparkle.style.setProperty("--ty", Math.sin(angle) * dist + "px")
      sparkle.style.backgroundColor = randomFrom(colors)

      const size = randomBetween(sparkleSizeRange[0], Math.round((sparkleSizeRange[0] + sparkleSizeRange[1]) / 2))
      sparkle.style.width = size + "px"
      sparkle.style.height = size + "px"
      sparkle.style.animationDuration = randomBetween(1, 2.5) + "s"
      sparkle.style.animationDelay = randomBetween(0, 0.3) + "s"

      sparkleContainer?.appendChild(sparkle)
    }

    // Overlay fade: original at 1500*sf, elapsed 400*sf, remaining 1100*sf
    await cancellableDelay(1100 * speedFactor, signal)
    if (overlay) {
      overlay.classList.add("grand-entrance-overlay-fade")
      await cancellableDelay(1000 * speedFactor, signal)
      if (overlay) {
        overlay.remove()
        overlay = null
      }
    }

    // Cleanup: original at 4000*sf, elapsed 2500*sf, remaining 1500*sf
    await cancellableDelay(1500 * speedFactor, signal)
    cleanupAll()
  }

  function cleanupAll() {
    if (sparkleContainer) {
      sparkleContainer.remove()
      sparkleContainer = null
    }
    freeSparkles = []
    pooledSet.clear()
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
