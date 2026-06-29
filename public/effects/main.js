/** @file Effect manager — creates and starts all effects with default config.
 *
 * To disable an effect: remove its entry from EFFECT_DEFINITIONS below.
 * To tweak an effect: edit its defaults in config.js.
 */
/** @import * as Types from './types.js' */

import { createDiscoBall } from "./disco-ball.js"
import { createCursorTrail } from "./cursor-trail.js"
import { createMermaidShimmer } from "./mermaid-shimmer.js"
import { createSparkleBurst } from "./sparkle-burst.js"
import { createSparkleDividers } from "./sparkle-dividers.js"
import { createNameShimmer } from "./name-shimmer.js"
import { createTextSparkle } from "./text-sparkle.js"
import { createParallaxSparkles } from "./parallax-sparkles.js"
import { createGrandEntrance } from "./grand-entrance.js"
import { createDiscoSpotlight } from "./disco-spotlight.js"
import { createMirrorReflections } from "./mirror-reflections.js"
import { getDefaultConfig } from "./config.js"
import { getTypedElement } from "../pages/utils.js"

/** @type {Types.EffectDefinition[]} */
const EFFECT_DEFINITIONS = [
  { id: "disco", create: createDiscoBall },
  { id: "cursor", create: createCursorTrail },
  { id: "shimmer", create: createMermaidShimmer },
  { id: "burst", create: createSparkleBurst },
  { id: "dividers", create: createSparkleDividers },
  { id: "namespark", create: createNameShimmer },
  { id: "textglow", create: createTextSparkle },
  { id: "parallaxsparkles", create: createParallaxSparkles },
  { id: "entrance", create: createGrandEntrance },
  { id: "spotlight", create: createDiscoSpotlight },
  { id: "reflections", create: createMirrorReflections },
]

/** @type {Map<string, Types.EffectInstance>} */
const activeEffects = new Map()

let managerActive = false

function startEffects() {
  const schedule =
    typeof requestIdleCallback === "function"
      ? requestIdleCallback
      : /** @param {() => void} cb */ (cb) => setTimeout(cb, 16)

  function startNext(/** @type {number} */ index) {
    if (index >= EFFECT_DEFINITIONS.length) return
    if (!managerActive) return
    const def = EFFECT_DEFINITIONS[index]
    const cfg = getDefaultConfig(def.id) || {}
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
