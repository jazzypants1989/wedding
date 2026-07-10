/** @file Effect manager — creates and starts all effects with default config.
 *
 * To disable an effect: remove its entry from EFFECT_DEFINITIONS below.
 * To tweak an effect: edit its defaults in config.js.
 */
/** @import * as Types from './types.js' */

import { createDiscoBall } from "./disco-ball.js"
import { createCursorTrail } from "./cursor-trail.js"
import { createMermaidShimmer } from "./mermaid-shimmer.js"
import { createSparkleDividers } from "./sparkle-dividers.js"
import { createNameShimmer } from "./name-shimmer.js"
import { createTextSparkle } from "./text-sparkle.js"
import { createParallaxSparkles } from "./parallax-sparkles.js"
import { createGrandEntrance } from "./grand-entrance.js"
import { createDiscoSpotlight } from "./disco-spotlight.js"
import { createMirrorReflections } from "./mirror-reflections.js"
import { createRosePetals } from "./rose-petals.js"
import { createFloatingHearts } from "./floating-hearts.js"
import { createGoldenDust } from "./golden-dust.js"
import { getEffectiveConfig } from "./config.js"
import { getActiveTheme } from "./themes.js"
import { getTypedElement } from "../pages/utils.js"

/** Registry of every effect, mapping its ID to its factory. Exported so dev
 *  tooling (the effect studio) can reuse the real registry instead of
 *  duplicating it. Not part of the runtime start-up path.
 *  @type {Types.EffectDefinition[]} */
export const EFFECT_DEFINITIONS = [
  { id: "disco", create: createDiscoBall },
  { id: "cursor", create: createCursorTrail },
  { id: "shimmer", create: createMermaidShimmer },
  { id: "dividers", create: createSparkleDividers },
  { id: "namespark", create: createNameShimmer },
  { id: "textglow", create: createTextSparkle },
  { id: "parallaxsparkles", create: createParallaxSparkles },
  { id: "entrance", create: createGrandEntrance },
  { id: "spotlight", create: createDiscoSpotlight },
  { id: "reflections", create: createMirrorReflections },
  { id: "petals", create: createRosePetals },
  { id: "hearts", create: createFloatingHearts },
  { id: "dust", create: createGoldenDust },
]

/** @type {Map<string, Types.EffectInstance>} */
const activeEffects = new Map()

let managerActive = false

function startEffects() {
  const schedule =
    typeof requestIdleCallback === "function"
      ? requestIdleCallback
      : /** @param {() => void} cb */ (cb) => setTimeout(cb, 16)

  // Resolve the active theme's effect subset against the full registry,
  // preserving registry order and silently skipping ids the theme names but
  // that aren't registered (e.g. a theme referencing a not-yet-built effect).
  const allowed = new Set(getActiveTheme().effectIds)
  const defs = EFFECT_DEFINITIONS.filter((d) => allowed.has(d.id))

  function startNext(/** @type {number} */ index) {
    if (index >= defs.length) return
    if (!managerActive) return
    const def = defs[index]
    const cfg = getEffectiveConfig(def.id) || {}
    const instance = def.create(cfg)
    try {
      instance.start()
      activeEffects.set(def.id, instance)
    } catch (err) {
      console.warn('Effect "' + def.id + '" failed to start:', err)
    }
    schedule(() => startNext(index + 1))
  }
  startNext(0)
}

/** @type {Types.initEffectManager} */
export function initEffectManager() {
  if (prefersReducedMotion()) return
  const link = getTypedElement("effects-css", HTMLLinkElement)
  if (link) link.media = "all"
  managerActive = true
  startEffects()
}

/** @type {Types.stopAllEffects} */
export function stopAllEffects() {
  for (const [id, instance] of activeEffects) {
    try {
      instance.stop()
    } catch (err) {
      console.warn('Effect "' + id + '" failed to stop:', err)
    }
  }
  activeEffects.clear()
}

/** @type {Types.stopEffect} */
export function stopEffect(id) {
  const instance = activeEffects.get(id)
  if (instance) {
    try {
      instance.stop()
    } catch {
      console.warn('Effect "' + id + '" failed to stop:')
    }
    activeEffects.delete(id)
  }
}

const moduleController = new AbortController()

// Pause effects when tab is hidden, resume when visible
document.addEventListener(
  "visibilitychange",
  function () {
    if (!managerActive) return
    if (document.hidden) {
      stopAllEffects()
    } else {
      startEffects()
    }
  },
  { signal: moduleController.signal },
)

// Stop effects permanently if user enables reduced motion
window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
  "change",
  function (e) {
    if (e.matches) {
      stopAllEffects()
      managerActive = false
    }
  },
  { signal: moduleController.signal },
)

/** @type {Types.isMobile} */
export function isMobile() {
  return window.innerWidth < 768
}

/** @type {Types.prefersReducedMotion} */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** @type {Types.randomFrom} */
export function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** @type {Types.randomBetween} */
export function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

/** @type {Types.cancellableDelay} */
export function cancellableDelay(ms, signal) {
  return new Promise(function (resolve, reject) {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const id = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      function () {
        clearTimeout(id)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}
