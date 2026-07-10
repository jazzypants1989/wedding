/** @file Runtime-editable site content resolver.
 *
 *  `content.js` holds the checked-in defaults. Admins can override any of it at
 *  runtime via the `site_content` key in `app_state` (see api/admin/site-content.js).
 *  This module resolves the *effective* content = defaults ⊕ stored override and
 *  caches it in a module variable, re-resolved at boot and on each admin save.
 *
 *  Kept separate from `content.js` (which stays dependency-free) so the DB import
 *  lives here, not in the pure defaults module. Zero deps, no regex.
 */
/** @import * as Types from '../types.js' */

import { CONTENT as CONTENT_DEFAULTS, getTimelineMode } from "../content.js"
import { getAppState } from "../db/utils.js"

/** @type {Types.SiteContent} */
let effective = CONTENT_DEFAULTS

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>} true for a mergeable plain object (not array, not null)
 */
function isPlainObject(v) {
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

/** @type {Types.deepMergeContent} */
export function deepMerge(base, override) {
  const result = structuredClone(base)
  applyOverride(
    /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (result)),
    /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (override)),
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
export function diffFromDefaults(full, base = CONTENT_DEFAULTS) {
  /** @type {Record<string, unknown>} */
  const out = {}
  const fullObj = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (full))
  const baseObj = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (base))
  for (const key of Object.keys(fullObj)) {
    const v = fullObj[key]
    const d = baseObj[key]
    if (isPlainObject(v) && isPlainObject(d)) {
      const sub = diffFromDefaults(
        /** @type {Types.SiteContent} */ (/** @type {unknown} */ (v)),
        /** @type {Types.SiteContent} */ (/** @type {unknown} */ (d)),
      )
      if (Object.keys(sub).length > 0) out[key] = sub
    } else if (!deepEqual(v, d)) {
      out[key] = v
    }
  }
  return /** @type {Types.SiteContentOverride} */ (out)
}

/** @type {Types.resolveSiteContent} */
export function resolveSiteContent() {
  const raw = getAppState("site_content")
  if (!raw) {
    effective = CONTENT_DEFAULTS
    return effective
  }
  try {
    const override = /** @type {Types.SiteContentOverride} */ (JSON.parse(raw))
    effective = Object.freeze(deepMerge(CONTENT_DEFAULTS, override))
  } catch {
    // Corrupt override → fall back to defaults rather than break every page.
    effective = CONTENT_DEFAULTS
  }
  return effective
}

/** @type {Types.getContent} */
export function getContent() {
  return effective
}

/** @type {Types.getMode} */
export function getMode(now = Date.now()) {
  return getTimelineMode(now, effective.weddingDate)
}
