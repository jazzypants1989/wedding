/** @file Effect manager — creates and starts all effects with default config.
 *
 * To disable an effect: remove its entry from EFFECT_DEFINITIONS below.
 * To tweak an effect: edit its defaults in config.js.
 */
/** @import * as Types from './types.js' */

import { EFFECT_DEFINITIONS, effectRunsOn } from "./registry.js"
import { getEffectiveConfig } from "./config.js"
import { getActiveTheme } from "./themes.js"
import { prefersReducedMotion } from "./effect-utils.js"

// Re-exported so existing importers (the studio, effect factories) keep resolving
// these from main.js. The registry + helpers now live in DOM-free modules.
export { EFFECT_DEFINITIONS }
export { isMobile, prefersReducedMotion, randomFrom, randomBetween, cancellableDelay } from "./effect-utils.js"

/** @type {Map<string, Types.EffectInstance>} */
const activeEffects = new Map()

let managerActive = false

/** The page that started the manager; filters out entries whose `pages` list
 *  excludes it (landing-page set pieces, off the landing page).
 *  @type {Types.EffectPage} */
let managerPage = "home"

// Monotonic token identifying the current staggered start-up chain. Bumped on
// every startEffects() and whenever effects are torn down, so a chain queued via
// requestIdleCallback bails the moment a newer start (or a hide) supersedes it.
// Without this, hiding the tab mid-stagger leaves the old chain running (it
// re-adds effects while hidden) and a later resume spawns a second chain whose
// def.create() overwrites the map, leaking the un-stopped instances.
let startGeneration = 0

function startEffects() {
  // Idempotent: if a previous chain's effects are still live — e.g. a
  // visibilitychange→visible not preceded by a hidden teardown, which some
  // browsers emit — tear them down first so def.create() can't overwrite the
  // map and orphan the prior instances (each leaving a second DOM layer).
  if (activeEffects.size > 0) stopAllEffects()

  const schedule =
    typeof requestIdleCallback === "function"
      ? requestIdleCallback
      : /** @param {() => void} cb */ (cb) => setTimeout(cb, 16)

  // Resolve the active theme's effect subset against the full registry,
  // preserving registry order and silently skipping ids the theme names but
  // that aren't registered (e.g. a theme referencing a not-yet-built effect).
  const allowed = new Set(getActiveTheme().effectIds)
  const defs = EFFECT_DEFINITIONS.filter((d) => allowed.has(d.id) && effectRunsOn(d, managerPage))

  const gen = ++startGeneration

  function startNext(/** @type {number} */ index) {
    if (index >= defs.length) return
    if (!managerActive) return
    // A newer start-up chain, or a teardown, has superseded this one.
    if (gen !== startGeneration) return
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
export function initEffectManager(options) {
  if (prefersReducedMotion()) return
  managerPage = options?.page ?? "home"
  // Flip the deferred stylesheet on. Optional: a page that loads effects.css
  // eagerly has no #effects-css to flip.
  const link = document.getElementById("effects-css")
  if (link instanceof HTMLLinkElement) link.media = "all"
  managerActive = true
  startEffects()
}

/** @type {Types.stopAllEffects} */
export function stopAllEffects() {
  // Invalidate any in-flight staggered start chain so it can't re-populate the
  // map after we've torn it down (e.g. tab hidden mid-stagger).
  startGeneration++
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

