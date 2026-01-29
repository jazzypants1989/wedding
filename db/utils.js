/** @file Database utility functions */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import { getDb } from "./connection.js"
import { sql } from "./sql.js"

/** @type {Types.generateInviteCode} */
export function generateInviteCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const maxUnbiased = 248 // 248 = 62 * 4, largest multiple of 62 ≤ 256
  let code = ""
  const bytes = crypto.randomBytes(16)
  let byteIdx = 0
  while (code.length < 8) {
    if (byteIdx >= bytes.length) {
      return generateInviteCode()
    }
    const b = bytes[byteIdx++]
    if (b < maxUnbiased) {
      code += chars[b % chars.length]
    }
  }
  return code
}

/** @type {Types.now} */
export function now() {
  return new Date().toISOString()
}

/** @type {Types.escapeLikePattern} */
export function escapeLikePattern(str) {
  if (!str) return str
  let result = ""
  for (const char of str) {
    if (char === "%" || char === "_" || char === "\\") {
      result += "\\" + char
    } else {
      result += char
    }
  }
  return result
}

/** @type {Types.extractDigits} */
export function extractDigits(str) {
  let digits = ""
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c >= 48 && c <= 57) digits += str[i] // 0-9: 48-57
  }
  return digits
}

/** @type {Types.normalizePhone} */
export function normalizePhone(phone) {
  if (!phone) return null
  // Strip common extension patterns before digit extraction
  let cleaned = phone
  const extPatterns = [" ext ", " ext.", " x ", " x.", "#"]
  for (const pat of extPatterns) {
    const idx = cleaned.toLowerCase().indexOf(pat)
    if (idx !== -1) {
      cleaned = cleaned.slice(0, idx)
    }
  }
  const digits = extractDigits(cleaned)

  if (digits.length === 10) return "+1" + digits

  if (digits.length === 11 && digits[0] === "1") return "+" + digits

  if (digits.length >= 7 && digits.length <= 15) {
    return "+" + digits
  }

  // Invalid: too short (< 7) or too long (> 15)
  return null
}

/** @type {Types.normalizeName} */
export function normalizeName(name) {
  if (!name) return ""
  const words = name
    .toLowerCase()
    .trim()
    .split(" ")
    .filter((w) => w !== "")
  return words.join(" ")
}

/** @type {Types.normalizeEmail} */
export function normalizeEmail(email) {
  if (!email || typeof email !== "string") return null
  const trimmed = email.trim().toLowerCase()
  return trimmed || null
}

/** @type {Types.levenshteinDistance} */
export function levenshteinDistance(a, b, maxDistance = Infinity) {
  if (!a || !b) return Math.max((a || "").length, (b || "").length)

  // Early exit: if length difference exceeds threshold, skip computation
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1

  // Cap input length for DoS protection
  const maxLen = 200
  const sa = a.length > maxLen ? a.slice(0, maxLen) : a
  const sb = b.length > maxLen ? b.slice(0, maxLen) : b

  /** @type {number[][]} */
  const matrix = []

  for (let i = 0; i <= sb.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= sa.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= sb.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= sa.length; j++) {
      if (sb[i - 1] === sa[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        )
      }
      if (matrix[i][j] < rowMin) rowMin = matrix[i][j]
    }
    // Early exit: if all values in this row exceed threshold, stop
    if (rowMin > maxDistance) return maxDistance + 1
  }

  return matrix[sb.length][sa.length]
}

/** @type {Types.withTransaction} */
export function withTransaction(fn) {
  const db = getDb()
  db.exec("BEGIN IMMEDIATE TRANSACTION")
  let committed = false
  try {
    const result = fn(db)
    if (
      result &&
      typeof result === "object" &&
      typeof /** @type {{ then?: unknown }} */ (/** @type {unknown} */ (result)).then === "function"
    ) {
      db.exec("ROLLBACK")
      throw new Error("withTransaction does not support async callbacks")
    }
    db.exec("COMMIT")
    committed = true
    return result
  } catch (err) {
    if (!committed) {
      try {
        db.exec("ROLLBACK")
      } catch {
        /* already rolled back */
      }
    }
    throw err
  }
}

/** @type {Types.logCommunication} */
export function logCommunication(
  guestId,
  type,
  status,
  messagePreview = null,
  errorMessage = null,
) {
  sql`INSERT INTO communications (guest_id, type, status, message_preview, error_message)
    VALUES (${guestId}, ${type}, ${status}, ${messagePreview}, ${errorMessage})`.run()
}

/** @type {Types.getInviteCountForGuest} */
export function getInviteCountForGuest(guestId) {
  /** @type {Types.CountResult | undefined} */
  const result = sql`SELECT COUNT(*) as count FROM communications WHERE guest_id = ${guestId} AND status = 'sent'`.get()
  return result ? result.count : 0
}

/** @type {Types.searchGuestsByName} */
export function searchGuestsByName(name) {
  const normalizedInput = normalizeName(name)
  if (!normalizedInput) return []

  const exactMatch = sql`SELECT * FROM guests WHERE deleted_at IS NULL AND LOWER(name) = ${normalizedInput}`.get()

  if (exactMatch) {
    return [{ ...exactMatch, matchDistance: 0 }]
  }

  /** @type {Types.GuestWithMatchDistance[]} */
  const matches = []
  if (normalizedInput.length >= 3) {
    const prefix = normalizedInput.slice(0, 3)
    const prefixMatches = sql`SELECT * FROM guests WHERE deleted_at IS NULL AND LOWER(name) LIKE ${escapeLikePattern(prefix) + "%"} ESCAPE '\\'`.all()

    for (const guest of prefixMatches) {
      const normalizedGuest = normalizeName(guest.name)
      const distance = levenshteinDistance(normalizedInput, normalizedGuest, 2)
      if (distance <= 2) {
        matches.push({ ...guest, matchDistance: distance })
      }
    }
  }

  if (matches.length === 0) {
    const allGuests = sql`SELECT * FROM guests WHERE deleted_at IS NULL`.all()

    for (const guest of allGuests) {
      const normalizedGuest = normalizeName(guest.name)
      const distance = levenshteinDistance(normalizedInput, normalizedGuest, 2)
      if (distance <= 2) {
        matches.push({ ...guest, matchDistance: distance })
      }
    }
  }

  matches.sort((a, b) => a.matchDistance - b.matchDistance)

  return matches
}

/** @type {Types.maskEmail} */
export function maskEmail(email) {
  if (!email) return null
  const [local, domain] = email.split("@")
  if (!domain) return email
  const masked = local[0] + "***"
  return masked + "@" + domain
}

/** @type {Types.maskPhone} */
export function maskPhone(phone) {
  if (!phone) return null
  const digits = extractDigits(phone)
  if (digits.length < 4) return "***"
  return "***-***-" + digits.slice(-4)
}
