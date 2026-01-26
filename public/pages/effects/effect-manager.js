/** @file Effect manager — registry, localStorage persistence, start/stop, config */

import { createSparkleStars } from "./sparkle-stars.js"
import { createDiscoBall } from "./disco-ball.js"
import { createCursorTrail } from "./cursor-trail.js"
import { createMermaidShimmer } from "./mermaid-shimmer.js"
import { createSparkleBurst } from "./sparkle-burst.js"
import { createSparkleDividers } from "./sparkle-dividers.js"
import { createNameShimmer } from "./name-shimmer.js"
import { createCaustics } from "./caustics.js"
import { createTextSparkle } from "./text-sparkle.js"
import { createScrollConfetti } from "./scroll-confetti.js"
import { createParallaxSparkles } from "./parallax-sparkles.js"
import { createGrandEntrance } from "./grand-entrance.js"
import { createDiscoSpotlight } from "./disco-spotlight.js"
import { createMirrorReflections } from "./mirror-reflections.js"
import { mergeWithDefaults, getDefaultConfig as getDefaultConfigFromSchema } from "./effect-config.js"

const STORAGE_KEY = "wedding-effects"
const CONFIG_STORAGE_KEY = "wedding-effects-config"

const EFFECT_DEFINITIONS = [
  { id: "sparkles", label: "Sparkle Stars", create: createSparkleStars },
  { id: "disco", label: "Disco Ball", create: createDiscoBall },
  { id: "cursor", label: "Cursor Trail", create: createCursorTrail },
  { id: "shimmer", label: "Mermaid Shimmer", create: createMermaidShimmer },
  { id: "burst", label: "Welcome Burst", create: createSparkleBurst },
  { id: "dividers", label: "Sparkle Dividers", create: createSparkleDividers },
  { id: "namespark", label: "Name Shimmer", create: createNameShimmer },
  { id: "caustics", label: "Underwater Caustics", create: createCaustics },
  { id: "textglow", label: "Text Sparkle", create: createTextSparkle },
  { id: "scrollconfetti", label: "Scroll Confetti", create: createScrollConfetti },
  { id: "parallaxsparkles", label: "Parallax Sparkles", create: createParallaxSparkles },
  { id: "entrance", label: "Grand Entrance", create: createGrandEntrance },
  { id: "spotlight", label: "Disco Spotlight", create: createDiscoSpotlight },
  { id: "reflections", label: "Mirror Reflections", create: createMirrorReflections },
]

/** @type {Map<string, { start: () => void, stop: () => void }>} */
const instances = new Map()

/** @type {Map<string, boolean>} */
const state = new Map()

/** @type {Record<string, Record<string, *>>} */
let configStore = {}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      for (const def of EFFECT_DEFINITIONS) {
        state.set(def.id, parsed[def.id] === true)
      }
      return
    }
  } catch {
    // Ignore parse errors
  }
  // Default: all off
  for (const def of EFFECT_DEFINITIONS) {
    state.set(def.id, false)
  }
}

function saveState() {
  /** @type {Record<string, boolean>} */
  const obj = {}
  for (const [key, value] of state) {
    obj[key] = value
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch {
    // Ignore storage errors
  }
}

function loadConfigStore() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
    if (raw) {
      configStore = JSON.parse(raw)
      return
    }
  } catch {
    // Ignore parse errors
  }
  configStore = {}
}

function saveConfigStore() {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configStore))
  } catch {
    // Ignore storage errors
  }
}

function ensureInstance(id) {
  if (!instances.has(id)) {
    const def = EFFECT_DEFINITIONS.find(function (d) { return d.id === id })
    if (def) {
      const cfg = getConfig(id)
      instances.set(id, def.create(cfg))
    }
  }
  return instances.get(id)
}

/**
 * Toggle an effect on or off.
 * @param {string} id
 * @param {boolean} [forceState]
 */
export function toggle(id, forceState) {
  const current = state.get(id)
  const next = forceState !== undefined ? forceState : !current
  state.set(id, next)
  saveState()

  const instance = ensureInstance(id)
  if (!instance) return

  if (next) {
    instance.start()
  } else {
    instance.stop()
  }
}

/**
 * Get the on/off state of a specific effect.
 * @param {string} id
 * @returns {boolean}
 */
export function isEnabled(id) {
  return state.get(id) === true
}

/**
 * Get all effect definitions with their labels.
 * @returns {Array<{ id: string, label: string }>}
 */
export function getEffects() {
  return EFFECT_DEFINITIONS.map(function (d) {
    return { id: d.id, label: d.label }
  })
}

/**
 * Turn all effects on.
 */
export function enableAll() {
  for (const def of EFFECT_DEFINITIONS) {
    toggle(def.id, true)
  }
}

/**
 * Turn all effects off.
 */
export function disableAll() {
  for (const def of EFFECT_DEFINITIONS) {
    toggle(def.id, false)
  }
}

/**
 * Get the merged config for an effect (defaults + saved overrides).
 * @param {string} id
 * @returns {Record<string, *>}
 */
export function getConfig(id) {
  const saved = configStore[id] || {}
  return mergeWithDefaults(id, saved)
}

/**
 * Set a partial config for an effect. Merges with existing config and saves.
 * Restarts the effect if it is currently running.
 * @param {string} id
 * @param {Record<string, *>} partialConfig
 */
export function setConfig(id, partialConfig) {
  const existing = configStore[id] || {}
  const merged = {}
  for (const key of Object.keys(existing)) {
    merged[key] = existing[key]
  }
  for (const key of Object.keys(partialConfig)) {
    merged[key] = partialConfig[key]
  }
  configStore[id] = merged
  saveConfigStore()

  // If the effect is running, restart it with the new config
  if (state.get(id)) {
    restart(id)
  }
}

/**
 * Reset an effect's config back to defaults.
 * Restarts the effect if it is currently running.
 * @param {string} id
 */
export function resetConfig(id) {
  delete configStore[id]
  saveConfigStore()

  if (state.get(id)) {
    restart(id)
  }
}

/**
 * Get the default config for an effect (from schema, no saved overrides).
 * @param {string} id
 * @returns {Record<string, *> | null}
 */
export function getDefaultConfig(id) {
  return getDefaultConfigFromSchema(id)
}

/**
 * Restart an effect — stop, destroy instance, re-create with current config, start.
 * @param {string} id
 */
export function restart(id) {
  const instance = instances.get(id)
  if (instance) {
    instance.stop()
    instances.delete(id)
  }
  if (state.get(id)) {
    const newInstance = ensureInstance(id)
    if (newInstance) {
      newInstance.start()
    }
  }
}

/**
 * Initialize: load saved state and config, start any enabled effects.
 */
export function initEffectManager() {
  loadConfigStore()
  loadState()
  for (const def of EFFECT_DEFINITIONS) {
    if (state.get(def.id)) {
      const instance = ensureInstance(def.id)
      if (instance) {
        instance.start()
      }
    }
  }
}
