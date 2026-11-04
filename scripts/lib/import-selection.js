/** @file Reads the culling page's selection file: which originals stay visible.
 *
 *    { "version": 1, "visible": ["<lowercase sha256 hex of the original file bytes>"] }
 *
 *  The hash is the one the idempotency manifest keys on (hashFile in
 *  import-manifest.js), so a selection names files the same way a re-run does:
 *  by content, not by filename. Anything malformed fails the run before an
 *  upload. Guessing here would be the one mistake that publishes a reject. */
/** @import * as Types from './types.js' */

import fs from "node:fs"

const SELECTION_VERSION = 1
const SHA256_HEX_LENGTH = 64

/** @type {Types.isSha256Hex} */
export function isSha256Hex(value) {
  if (typeof value !== "string" || value.length !== SHA256_HEX_LENGTH) return false
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    const isDigit = c >= 48 && c <= 57
    const isLowerHex = c >= 97 && c <= 102
    if (!isDigit && !isLowerHex) return false
  }
  return true
}

/** @type {Types.parseSelection} */
export function parseSelection(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { valid: false, error: `not valid JSON (${err instanceof Error ? err.message : err})` }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, error: "expected an object with `version` and `visible`" }
  }
  if (parsed.version !== SELECTION_VERSION) {
    return {
      valid: false,
      error: `expected version ${SELECTION_VERSION}, found ${JSON.stringify(parsed.version)}`,
    }
  }
  if (!Array.isArray(parsed.visible)) {
    return { valid: false, error: "`visible` must be an array of sha256 hashes" }
  }
  for (let i = 0; i < parsed.visible.length; i++) {
    if (!isSha256Hex(parsed.visible[i])) {
      return {
        valid: false,
        error: `visible[${i}] is not a lowercase sha256 hex string: ${JSON.stringify(parsed.visible[i])}`,
      }
    }
  }
  return { valid: true, value: new Set(parsed.visible) }
}

/** @type {Types.loadSelection} */
export function loadSelection(selectionPath) {
  let raw
  try {
    raw = fs.readFileSync(selectionPath, "utf8")
  } catch (err) {
    return {
      valid: false,
      error: `can't read it (${err instanceof Error ? err.message : String(err)})`,
    }
  }
  return parseSelection(raw)
}
