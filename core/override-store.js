/** @file Generic runtime-override store: shipped defaults ⊕ app_state override.
 *
 *  Factored out of core/site-content.js so every app_state-backed override
 *  (site content, effect config, …) shares one resolver and one merge/diff
 *  discipline. A store closes over its app_state `key` and shipped `defaults`,
 *  caches the resolved effective value, and re-resolves on demand (at boot and
 *  after an admin save). The merge/diff helpers are key-agnostic and exported
 *  so callers can reuse them directly. Zero deps, no regex.
 */
/** @import * as Types from "./types.js" */

import { getAppState } from "../db/utils.js"

/** @type {Types.isPlainObject} */
export function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * Recursively overlay `override` onto `target` in place. Nested plain objects
 * are merged key-by-key; arrays and scalars (incl. explicit `null`) replace the
 * base value wholesale. `undefined` override values are ignored.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} override
 */
function applyOverride(target, override) {
  for (const key of Object.keys(override)) {
    // Never merge prototype keys — a stored blob is JSON.parse'd and trusted
    // here; `__proto__` would otherwise recurse into Object.prototype.
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue
    const val = override[key]
    const cur = target[key]
    if (isPlainObject(val) && isPlainObject(cur)) {
      applyOverride(cur, val)
    } else if (val !== undefined) {
      target[key] = val
    }
  }
}

/** @type {Types.deepMerge} */
export function deepMerge(base, override) {
  const result = structuredClone(base)
  applyOverride(
    /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (result)),
    override,
  )
  return result
}

/**
 * Structural equality: identity, then recursive for plain objects (same keys +
 * equal values) and arrays (same length + equal elements). Everything else is
 * only equal by `===`. Zero deps, no regex.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a)
    return ak.length === Object.keys(b).length && ak.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}

/** @type {Types.diffFromDefaults} */
export function diffFromDefaults(full, base) {
  /** @type {Record<string, unknown>} */
  const out = {}
  const fullObj = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (full))
  const baseObj = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (base))
  for (const key of Object.keys(fullObj)) {
    const v = fullObj[key]
    const d = baseObj[key]
    if (isPlainObject(v) && isPlainObject(d)) {
      const sub = diffFromDefaults(v, d)
      if (Object.keys(sub).length > 0) out[key] = sub
    } else if (!deepEqual(v, d)) {
      out[key] = v
    }
  }
  return out
}

/** @type {Types.createOverrideStore} */
export function createOverrideStore(key, defaults, onChanged) {
  let effective = defaults
  /** @type {Record<string, unknown> | null} */
  let override = null

  function resolve() {
    const raw = getAppState(key)
    if (!raw) {
      effective = defaults
      override = null
    } else {
      try {
        const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(raw))
        override = parsed
        effective = /** @type {typeof defaults} */ (Object.freeze(deepMerge(defaults, parsed)))
      } catch {
        // Corrupt override → fall back to defaults rather than break every page.
        effective = defaults
        override = null
      }
    }
    if (onChanged) onChanged(effective)
    return effective
  }

  return {
    key,
    defaults,
    resolve,
    get: () => effective,
    getOverride: () => override,
  }
}
