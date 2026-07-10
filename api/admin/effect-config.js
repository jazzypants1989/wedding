/** @file Admin effect-config editor — site-wide runtime override of the effect
 *  defaults shipped in public/effects/config.js.
 *
 *  Stores a validated sparse `{ [effectId]: Partial<config> }` blob under the
 *  `effect_config` app_state key and re-resolves it (onEffectConfigChanged) so
 *  every page's inlined `data-effect-config` reflects the edit without a
 *  redeploy. This is the "promote the studio's tuned values to defaults" path:
 *  the admin pastes/imports the studio's per-browser override and saves it
 *  site-wide. Reset clears the key. Zero deps, no regex.
 */
/** @import * as Types from './types.js' */

import { parseBody, sendJson } from "../../core/http.js"
import { ValidationError } from "../../core/validation.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import { setAppState, getAppState } from "../../db/utils.js"
import { sql } from "../../db/sql.js"
import { onEffectConfigChanged } from "../../core/static.js"
import { EFFECT_CONFIG_KEYS } from "../../core/effect-config-schema.js"

const EFFECT_CONFIG_KEY = "effect_config"

// Bounds — the override is admin-authored (authenticated) but still validated as
// defense-in-depth and to keep the inlined page attribute small.
const MAX_STRING = 500
const MAX_ARRAY = 64

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Prototype-pollution guard for keys copied out of a parsed blob.
 *  @param {string} key @returns {boolean} */
function isProtoKey(key) {
  return key === "__proto__" || key === "constructor" || key === "prototype"
}

/**
 * Validate a single config value: a finite number, bounded string, boolean, or
 * an array of those (effect configs are flat — no nested objects). Returns the
 * value unchanged when valid; throws otherwise.
 * @param {unknown} v
 * @param {string} field
 * @returns {number | string | boolean | Array<number | string | boolean>}
 */
function validateValue(v, field) {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new ValidationError(field + " must be a finite number")
    return v
  }
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    if (v.length > MAX_STRING) throw new ValidationError(field + " is too long")
    return v
  }
  if (Array.isArray(v)) {
    if (v.length > MAX_ARRAY) throw new ValidationError(field + " has too many entries")
    return v.map((el, i) => {
      const inner = validateValue(el, field + "[" + i + "]")
      if (Array.isArray(inner)) throw new ValidationError(field + " may not nest arrays")
      return inner
    })
  }
  throw new ValidationError(field + " must be a number, string, boolean, or array")
}

/**
 * Validate a submitted override map into a clean sparse blob: every effect id
 * must be known, every key must be a known key for that effect, every value
 * must pass validateValue. Empty per-effect partials are dropped.
 * @param {unknown} raw
 * @returns {Record<string, Record<string, unknown>>}
 */
function validateOverride(raw) {
  if (!isPlainObject(raw)) throw new ValidationError("Effect config must be an object")
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {}
  for (const id of Object.keys(raw)) {
    if (isProtoKey(id)) continue
    const keys = EFFECT_CONFIG_KEYS[id]
    if (!keys) throw new ValidationError('Unknown effect "' + id + '"')
    const partial = raw[id]
    if (!isPlainObject(partial)) throw new ValidationError('Effect "' + id + '" override must be an object')
    /** @type {Record<string, unknown>} */
    const clean = {}
    for (const key of Object.keys(partial)) {
      if (isProtoKey(key)) continue
      if (!keys.has(key)) throw new ValidationError('Effect "' + id + '" has no config key "' + key + '"')
      clean[key] = validateValue(partial[key], id + "." + key)
    }
    if (Object.keys(clean).length > 0) out[id] = clean
  }
  return out
}

/** Read the stored override back as an object (never a string), guarding corrupt
 *  JSON with an empty map so the admin form still loads.
 *  @returns {Record<string, unknown>} */
function storedOverride() {
  const raw = getAppState(EFFECT_CONFIG_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** @type {Types.AsyncHandler} */
export async function get(req, res) {
  return sendJson(res, 200, { override: storedOverride() })
}

/** @type {Types.AuthedHandler} */
export async function update(req, res, { session }) {
  const body = await parseBody(req)
  const raw = isPlainObject(body) && body.override !== undefined ? body.override : body
  const sparse = validateOverride(raw)

  if (Object.keys(sparse).length === 0) {
    sql`DELETE FROM app_state WHERE key = ${EFFECT_CONFIG_KEY}`.run()
  } else {
    setAppState(EFFECT_CONFIG_KEY, JSON.stringify(sparse))
  }
  onEffectConfigChanged()

  log({
    action: AUDIT_ACTIONS.EFFECT_CONFIG_UPDATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "effect_config",
  })

  return sendJson(res, 200, {
    success: true,
    message: "Effect config updated",
    override: sparse,
  })
}

/** @type {Types.AuthedHandler} */
export async function reset(req, res, { session }) {
  sql`DELETE FROM app_state WHERE key = ${EFFECT_CONFIG_KEY}`.run()
  onEffectConfigChanged()

  log({
    action: AUDIT_ACTIONS.EFFECT_CONFIG_RESET,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "effect_config",
  })

  return sendJson(res, 200, {
    success: true,
    message: "Effect config reset to defaults",
    override: {},
  })
}
