/** @file Effect studio — per-browser config override persistence.
 *
 *  The studio tunes an in-memory config; these helpers persist a *sparse*
 *  diff-from-defaults for the current effect into a single localStorage key,
 *  so the tuner's own browser can preview tuned values on the real pages
 *  (read back by the effects boot path). Per-browser and dev-only.
 *
 *  Shared contract with the effects read side (getEffectiveConfig):
 *    key   "effect-config-override"
 *    value JSON { [effectId]: Partial<config> }
 *    merge getEffectiveConfig(id) = getDefaultConfig(id) ⊕ stored[id]
 *
 *  This module is the WRITE side; it only ever reads the agreed key here to
 *  seed the studio's own controls. No regex — values compared via JSON.
 */
/** @import * as Types from "./types.js" */

const STORAGE_KEY = "effect-config-override"

/** @type {Types.readAll} */
export function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return /** @type {Record<string, Types.ConfigPartial>} */ (parsed)
    }
    return {}
  } catch {
    // Malformed JSON or storage access denied — behave as if empty.
    return {}
  }
}

/**
 * Persist the whole override map, pruning the key entirely when nothing is left.
 * @param {Record<string, Types.ConfigPartial>} map
 */
function writeAll(map) {
  if (Object.keys(map).length === 0) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

/** @type {Types.readOverride} */
export function readOverride(id) {
  const entry = readAll()[id]
  return entry && typeof entry === "object" ? entry : {}
}

/** @type {Types.diffConfig} */
export function diffConfig(full, defaults) {
  /** @type {Types.ConfigPartial} */
  const diff = {}
  for (const key of Object.keys(full)) {
    if (JSON.stringify(full[key]) !== JSON.stringify(defaults[key])) {
      diff[key] = full[key]
    }
  }
  return diff
}

/** @type {Types.saveOverride} */
export function saveOverride(id, full, defaults) {
  const diff = diffConfig(full, defaults)
  const all = readAll()
  if (Object.keys(diff).length === 0) {
    delete all[id]
  } else {
    all[id] = diff
  }
  writeAll(all)
}

/** @type {Types.clearOverride} */
export function clearOverride(id) {
  const all = readAll()
  if (id in all) {
    delete all[id]
    writeAll(all)
  }
}

/** @type {Types.clearAll} */
export function clearAll() {
  localStorage.removeItem(STORAGE_KEY)
}

/** @type {Types.seedFromOverride} */
export function seedFromOverride(defaults, partial) {
  const seeded = structuredClone(defaults)
  for (const key of Object.keys(partial)) {
    // Ignore orphaned keys from params that no longer exist in defaults.
    if (key in seeded) seeded[key] = partial[key]
  }
  return seeded
}
