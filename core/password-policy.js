/** @file Zero-dependency admin-password policy: strength check + scrypt hashing.
 *
 *  Deliberately DB-free and service-free so `scripts/setup-admin.js` (a standalone
 *  CLI that writes `.env` before any database exists) can share the exact same
 *  rules as the server-side setup wizard and `core/auth.js`. Importing `core/auth.js`
 *  or `core/validation.js` from the CLI would drag the DB/twilio/email modules into
 *  it; this leaf module pulls in nothing but `node:crypto`. No regex.
 */
/** @import * as Types from '../types.js' */

import crypto from "node:crypto"

/** @type {Types.HashPassword} */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 64)
  return salt.toString("hex") + ":" + hash.toString("hex")
}

/** @type {Types.ValidatePasswordStrength} */
export function validatePasswordStrength(password) {
  if (!password || password.length < 12) {
    return "Password must be at least 12 characters"
  }

  let hasUpper = false
  let hasLower = false
  let hasDigit = false

  for (let i = 0; i < password.length; i++) {
    const code = password.charCodeAt(i)
    // A-Z: 65-90
    if (code >= 65 && code <= 90) hasUpper = true
    // a-z: 97-122
    else if (code >= 97 && code <= 122) hasLower = true
    // 0-9: 48-57
    else if (code >= 48 && code <= 57) hasDigit = true
  }

  if (!hasUpper) return "Password must contain at least one uppercase letter"
  if (!hasLower) return "Password must contain at least one lowercase letter"
  if (!hasDigit) return "Password must contain at least one digit"

  return null // Valid
}
