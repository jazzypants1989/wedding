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
import { EFFECT_CONFIG_SPECS } from "../../core/effect-config-schema.js"

const EFFECT_CONFIG_KEY = "effect_config"

// Bounds — the override is admin-authored (authenticated) but still validated as
// defense-in-depth: a wrong-typed or out-of-range value would otherwise reach
// every visitor's browser (a huge count hangs it; a string where a number is
// expected makes the effect throw). Numeric/array bounds come from the per-key
// spec; strings are only length-capped here.
const MAX_STRING = 500

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

/** @import * as CoreTypes from '../../core/types.js' */

/**
 * Validate a single config value against its key spec: correct kind, in range,
 * and (for arrays) correct arity + element types. Returns the value unchanged
 * when valid; throws ValidationError otherwise.
 * @param {unknown} v
 * @param {CoreTypes.EffectKeySpec} spec
 * @param {string} field
 * @returns {number | string | Array<number | string>}
 */
function validateValue(v, spec, field) {
  switch (spec.kind) {
    case "number":
    case "count":
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new ValidationError(field + " must be a finite number")
      }
      if (v < spec.min || v > spec.max) {
        throw new ValidationError(field + " must be between " + spec.min + " and " + spec.max)
      }
      return v
    case "string":
      if (typeof v !== "string") throw new ValidationError(field + " must be a string")
      if (v.length > MAX_STRING) throw new ValidationError(field + " is too long")
      return v
    case "numberArray": {
      if (!Array.isArray(v)) throw new ValidationError(field + " must be an array")
      if (v.length < spec.minItems || v.length > spec.maxItems) {
        const arity =
          spec.minItems === spec.maxItems
            ? spec.minItems + " entries"
            : "between " + spec.minItems + " and " + spec.maxItems + " entries"
        throw new ValidationError(field + " must have " + arity)
      }
      return v.map((el, i) => {
        if (typeof el !== "number" || !Number.isFinite(el)) {
          throw new ValidationError(field + "[" + i + "] must be a finite number")
        }
        if (el < spec.min || el > spec.max) {
          throw new ValidationError(field + "[" + i + "] must be between " + spec.min + " and " + spec.max)
        }
        return el
      })
    }
    case "stringArray": {
      if (!Array.isArray(v)) throw new ValidationError(field + " must be an array")
      if (v.length > spec.maxItems) throw new ValidationError(field + " has too many entries")
      return v.map((el, i) => {
        if (typeof el !== "string") throw new ValidationError(field + "[" + i + "] must be a string")
        if (el.length > MAX_STRING) throw new ValidationError(field + "[" + i + "] is too long")
        return el
      })
    }
    default:
      throw new ValidationError(field + " has an unrecognized spec")
  }
}

/**
 * Validate a submitted override map into a clean sparse blob: every effect id
 * must be known, every key must be a known key for that effect, every value
 * must pass validateValue against its spec. Empty per-effect partials are
 * dropped. `Object.hasOwn` guards keep an id/key like `"toString"` from
 * resolving to an inherited Object.prototype member.
 * @param {unknown} raw
 * @returns {Record<string, Record<string, unknown>>}
 */
function validateOverride(raw) {
  if (!isPlainObject(raw)) throw new ValidationError("Effect config must be an object")
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {}
  for (const id of Object.keys(raw)) {
    if (isProtoKey(id)) continue
    if (!Object.hasOwn(EFFECT_CONFIG_SPECS, id)) throw new ValidationError('Unknown effect "' + id + '"')
    const specs = EFFECT_CONFIG_SPECS[id]
    const partial = raw[id]
    if (!isPlainObject(partial)) throw new ValidationError('Effect "' + id + '" override must be an object')
    /** @type {Record<string, unknown>} */
    const clean = {}
    for (const key of Object.keys(partial)) {
      if (isProtoKey(key)) continue
      if (!Object.hasOwn(specs, key)) {
        throw new ValidationError('Effect "' + id + '" has no config key "' + key + '"')
      }
      clean[key] = validateValue(partial[key], specs[key], id + "." + key)
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
