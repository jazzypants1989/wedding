/** @file Database utility functions */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import { queryOne, queryAll, getDb } from "./connection.js"

/** @type {Types.generateInviteCode} */
export function generateInviteCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = crypto.randomBytes(8)
  let code = ""
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length]
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
  const digits = extractDigits(phone)

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

/** @type {Types.levenshteinDistance} */
export function levenshteinDistance(a, b) {
  if (!a || !b) return Math.max((a || "").length, (b || "").length)

  /** @type {number[][]} */
  const matrix = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/** @type {Types.withTransaction} */
export function withTransaction(fn) {
  const db = getDb()
  db.exec("BEGIN IMMEDIATE TRANSACTION")
  try {
    const result = fn(db)
    db.exec("COMMIT")
    return result
  } catch (err) {
    db.exec("ROLLBACK")
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
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO communications (guest_id, type, status, message_preview, error_message)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmt.run(guestId, type, status, messagePreview, errorMessage)
}

/** @type {Types.getInviteCountForGuest} */
export function getInviteCountForGuest(guestId) {
  /** @type {Types.CountResult | undefined} */
  const result = queryOne(
    "SELECT COUNT(*) as count FROM communications WHERE guest_id = ? AND status = 'sent'",
    guestId,
  )
  return result ? result.count : 0
}

/** @type {Types.searchGuestsByName} */
export function searchGuestsByName(name) {
  const normalizedInput = normalizeName(name)
  if (!normalizedInput) return []

  const exactMatch = queryOne(
    "SELECT * FROM guests WHERE deleted_at IS NULL AND LOWER(name) = ?",
    normalizedInput,
  )

  if (exactMatch) {
    return [{ ...exactMatch, matchDistance: 0 }]
  }

  /** @type {Types.GuestWithMatchDistance[]} */
  const matches = []
  if (normalizedInput.length >= 3) {
    const prefix = normalizedInput.slice(0, 3)
    const prefixMatches = queryAll(
      "SELECT * FROM guests WHERE deleted_at IS NULL AND LOWER(name) LIKE ?",
      prefix + "%",
    )

    for (const guest of prefixMatches) {
      const normalizedGuest = normalizeName(guest.name)
      const distance = levenshteinDistance(normalizedInput, normalizedGuest)
      if (distance <= 2) {
        matches.push({ ...guest, matchDistance: distance })
      }
    }
  }

  if (matches.length === 0) {
    const allGuests = queryAll("SELECT * FROM guests WHERE deleted_at IS NULL")

    for (const guest of allGuests) {
      const normalizedGuest = normalizeName(guest.name)
      const distance = levenshteinDistance(normalizedInput, normalizedGuest)
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
