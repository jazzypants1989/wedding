/** @file Tilt-depth — pointer/gyroscope parallax. Maps the cursor's position over
 *  the viewport (desktop) or the device's tilt (mobile) to a gentle rotateX/rotateY
 *  on the primary target and small translate/parallax offsets on secondary targets.
 *  Values are written as CSS custom properties; the transforms live in effects.css
 *  (`.tiltdepth-target`), so this factory only computes numbers.
 *
 *  Motion is damped: each rAF the live value eases toward the pointer/tilt target,
 *  so it never snaps. The loop pauses on visibilitychange and fully resets in
 *  stop(). Under prefers-reduced-motion the effect no-ops entirely.
 *
 *  iOS 13+ gates DeviceOrientationEvent behind a permission prompt that can only be
 *  requested from a user gesture — an ambient effect can't prompt on its own. So we
 *  add the orientation listener optimistically (it stays silent until permission is
 *  granted) and export requestTiltPermission() for a page to call inside its own tap
 *  handler. With no grant it degrades silently to pointer-only.
 */
/** @import * as Types from './types.js' */

import { prefersReducedMotion } from "./effect-utils.js"

const TARGET_CLASS = "tiltdepth-target"
const SECONDARY_CLASS = "tiltdepth-secondary"
// Damping factor: fraction of the remaining distance closed each frame. Small
// enough that the tilt trails the pointer for a springy, physical feel.
const EASE = 0.1

/** The DeviceOrientationEvent constructor as a loose record so we can probe the
 *  non-standard iOS `requestPermission` without a lib.dom typing for it.
 *  @returns {Record<string, unknown> | null} */
function orientationCtor() {
  if (typeof DeviceOrientationEvent === "undefined") return null
  return /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (DeviceOrientationEvent))
}

/** Request DeviceOrientation permission from within a user gesture (iOS 13+).
 *  Pages MUST call this inside their own tap/click handler — an effect can't
 *  prompt on its own. Resolves true when granted (or when no permission is
 *  needed), false when denied/unavailable. Never throws.
 *  @type {Types.requestTiltPermission} */
export async function requestTiltPermission() {
  const ctor = orientationCtor()
  if (!ctor || typeof ctor.requestPermission !== "function") return true
  try {
    const request = /** @type {() => Promise<string>} */ (ctor.requestPermission)
    const result = await request()
    return result === "granted"
  } catch {
    return false
  }
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

/** @type {Types.createTiltDepth} */
export function createTiltDepth(config) {
  const cfg = config || {}
  const selector = cfg.selector || ".tc-card, .tc-polaroid"
  const maxTilt = cfg.maxTilt !== undefined ? cfg.maxTilt : 6
  const depth = cfg.depth !== undefined ? cfg.depth : 12

  /** @type {AbortController | null} */
  let controller = null
  let rafId = 0
  let running = false

  /** Targets currently tagged, primary first. */
  /** @type {HTMLElement[]} */
  let tagged = []
  /** @type {HTMLElement | null} */
  let primary = null

  // Normalized pointer/tilt target in [-1, 1] and its eased, rendered value.
  let targetX = 0
  let targetY = 0
  let curX = 0
  let curY = 0

  /** Drop the tilt classes + custom properties from a tagged element. */
  /** @param {HTMLElement} el */
  function clearEl(el) {
    el.classList.remove(TARGET_CLASS, SECONDARY_CLASS)
    el.style.removeProperty("--tilt-rx")
    el.style.removeProperty("--tilt-ry")
    el.style.removeProperty("--tilt-px")
    el.style.removeProperty("--tilt-py")
    el.style.removeProperty("--tilt-tz")
  }

  /** (Re)tag the current matches. Primary = first match (tilts); the rest are
   *  secondaries (parallax translate). Cheap enough to re-run when the primary
   *  falls out of the DOM (e.g. the gallery lightbox swaps its <img> on nav). */
  function scan() {
    for (const el of tagged) clearEl(el)
    tagged = []
    const nodes = document.querySelectorAll(selector)
    nodes.forEach((node, i) => {
      const el = /** @type {HTMLElement} */ (node)
      el.classList.add(TARGET_CLASS)
      if (i > 0) el.classList.add(SECONDARY_CLASS)
      tagged.push(el)
    })
    primary = tagged[0] || null
  }

  function ensureTargets() {
    if (primary && primary.isConnected) return
    scan()
  }

  function frame() {
    ensureTargets()
    // Ease the rendered value toward the pointer/tilt target.
    curX += (targetX - curX) * EASE
    curY += (targetY - curY) * EASE

    if (primary) {
      // Cursor to the right → look right (positive rotateY); down → rotateX down.
      primary.style.setProperty("--tilt-ry", (curX * maxTilt).toFixed(3) + "deg")
      primary.style.setProperty("--tilt-rx", (-curY * maxTilt).toFixed(3) + "deg")
    }
    for (let i = 1; i < tagged.length; i++) {
      const el = tagged[i]
      // Deeper layers drift a touch further, for a gentle stacked-parallax feel.
      const scale = depth * (0.6 + (i / tagged.length) * 0.4)
      el.style.setProperty("--tilt-px", (curX * scale).toFixed(2) + "px")
      el.style.setProperty("--tilt-py", (curY * scale).toFixed(2) + "px")
      el.style.setProperty("--tilt-tz", (depth * i).toFixed(2) + "px")
    }

    if (running) rafId = requestAnimationFrame(frame)
  }

  function startLoop() {
    if (rafId || !running) return
    rafId = requestAnimationFrame(frame)
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  /** @param {PointerEvent} e */
  function onPointerMove(e) {
    const w = window.innerWidth || 1
    const h = window.innerHeight || 1
    targetX = clamp((e.clientX / w) * 2 - 1, -1, 1)
    targetY = clamp((e.clientY / h) * 2 - 1, -1, 1)
  }

  /** @param {DeviceOrientationEvent} e */
  function onOrientation(e) {
    if (e.gamma === null && e.beta === null) return
    // gamma: left/right tilt (-90..90); beta: front/back (portrait neutral ~45°).
    const gamma = e.gamma || 0
    const beta = e.beta || 0
    targetX = clamp(gamma / 45, -1, 1)
    targetY = clamp((beta - 45) / 45, -1, 1)
  }

  function onVisibility() {
    if (document.hidden) stopLoop()
    else startLoop()
  }

  function start() {
    // Reduced motion: no-op entirely — no listeners, no rAF, no transforms.
    if (prefersReducedMotion()) return
    if (controller) return

    controller = new AbortController()
    const signal = controller.signal
    running = true

    scan()

    window.addEventListener("pointermove", onPointerMove, { passive: true, signal })
    // Add the orientation listener optimistically: on iOS without a grant it
    // simply never fires (silent pointer-only degrade); requestTiltPermission()
    // lets a page unlock it from a gesture. Elsewhere it needs no permission.
    if (orientationCtor()) {
      window.addEventListener("deviceorientation", onOrientation, { passive: true, signal })
    }
    document.addEventListener("visibilitychange", onVisibility, { signal })

    startLoop()
  }

  function stop() {
    running = false
    stopLoop()
    if (controller) {
      controller.abort()
      controller = null
    }
    for (const el of tagged) clearEl(el)
    tagged = []
    primary = null
    targetX = targetY = curX = curY = 0
  }

  return { start, stop }
}
