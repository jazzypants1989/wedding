/** @file Admin blocklist management endpoints */
/** @import * as Types from './types.js' */

import { withAdmin } from "../../core/auth.js"
import { sendJson, parseBody } from "../../core/http.js"
import { ValidationError, NotFoundError } from "../../core/errors.js"
import {
  validateEmail,
  validatePhone,
  validateOptionalString,
  validateId,
} from "../../core/validation.js"
import { LIMITS } from "../../types.js"
import { log, AUDIT_ACTIONS } from "../../core/log.js"
import { getClientIp } from "../../core/rate-limit.js"
import { getDb, queryOne, queryAll } from "../../db/connection.js"
import {
  normalizePhone,
  normalizeName,
  levenshteinDistance,
} from "../../db/utils.js"

/** @type {Types.listHandler} */
async function listHandler(req, res) {
  const blocklist = getAllBlocklist()
  return sendJson(res, 200, { blocklist, total: blocklist.length })
}

/** @type {Types.createHandler} */
async function createHandler(req, res, { session }) {
  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    throw new ValidationError("Invalid JSON body")
  }

  const { name, email: inputEmail, phone: inputPhone, reason } = body

  const nameResult = validateOptionalString(name, LIMITS.NAME_MAX_LENGTH)

  const emailResult = validateEmail(inputEmail)
  if (!emailResult.valid) {
    throw new ValidationError(emailResult.error)
  }

  const phoneResult = validatePhone(inputPhone)
  if (!phoneResult.valid) {
    throw new ValidationError(phoneResult.error)
  }

  if (!nameResult.value && !emailResult.value && !phoneResult.value) {
    throw new ValidationError(
      "At least one of name, email, or phone is required"
    )
  }

  const reasonResult = validateOptionalString(reason, 500)

  const id = addToBlocklist({
    name: nameResult.value,
    email: emailResult.value,
    phone: phoneResult.value,
    reason: reasonResult.value,
  })

  log({
    action: AUDIT_ACTIONS.BLOCKLIST_ADD,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "blocklist",
    resourceId: id,
    details: { name: nameResult.value, email: emailResult.value },
  })

  return sendJson(res, 201, {
    success: true,
    message: "Added to blocklist",
    id,
  })
}

/** @type {Types.removeHandler} */
async function removeHandler(req, res, { params, session }) {
  const idResult = validateId(params.id, "blocklist entry ID")
  if (!idResult.valid) {
    throw new ValidationError(idResult.error)
  }

  const removed = removeFromBlocklist(idResult.value)
  if (!removed) {
    throw new NotFoundError("Blocklist entry")
  }

  log({
    action: AUDIT_ACTIONS.BLOCKLIST_REMOVE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "blocklist",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, {
    success: true,
    message: "Removed from blocklist",
  })
}

export const list = withAdmin(listHandler)
export const create = withAdmin(createHandler)
export const remove = withAdmin(removeHandler)

/** @type {Types.isBlocked} */
export function isBlocked({ name, email, phone }) {
  const normalizedInputEmail = email ? email.toLowerCase().trim() : null
  const normalizedInputPhone = normalizePhone(phone)

  if (normalizedInputEmail) {
    const emailMatch = queryOne(
      "SELECT * FROM blocklist WHERE LOWER(email) = ? LIMIT 1",
      normalizedInputEmail
    )
    if (emailMatch) return emailMatch
  }

  if (normalizedInputPhone) {
    const phoneMatch = queryOne(
      "SELECT * FROM blocklist WHERE phone = ? LIMIT 1",
      normalizedInputPhone
    )
    if (phoneMatch) return phoneMatch
  }

  if (name) {
    const normalizedInputName = normalizeName(name)
    if (normalizedInputName && normalizedInputName.length >= 3) {
      const prefix = normalizedInputName.slice(0, 3)
      const prefixEntries = queryAll(
        "SELECT * FROM blocklist WHERE name IS NOT NULL AND LOWER(name) LIKE ?",
        prefix + "%"
      )

      for (const entry of prefixEntries) {
        const normalizedEntryName = normalizeName(entry.name)
        const distance = levenshteinDistance(
          normalizedInputName,
          normalizedEntryName
        )
        if (distance <= 2) {
          return entry
        }
      }

      const otherEntries = queryAll(
        "SELECT * FROM blocklist WHERE name IS NOT NULL AND LOWER(name) NOT LIKE ?",
        prefix + "%"
      )

      for (const entry of otherEntries) {
        const normalizedEntryName = normalizeName(entry.name)
        const distance = levenshteinDistance(
          normalizedInputName,
          normalizedEntryName
        )
        if (distance <= 2) {
          return entry
        }
      }
    } else if (normalizedInputName) {
      const namedEntries = queryAll(
        "SELECT * FROM blocklist WHERE name IS NOT NULL"
      )

      for (const entry of namedEntries) {
        const normalizedEntryName = normalizeName(entry.name)
        const distance = levenshteinDistance(
          normalizedInputName,
          normalizedEntryName
        )
        if (distance <= 2) {
          return entry
        }
      }
    }
  }

  return null
}

/** @type {Types.getAllBlocklist} */
export function getAllBlocklist() {
  return queryAll("SELECT * FROM blocklist ORDER BY created_at DESC")
}

/** @type {Types.addToBlocklist} */
export function addToBlocklist({ name, email, phone, reason }) {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO blocklist (name, email, phone, reason)
    VALUES (?, ?, ?, ?)
  `)
  const result = stmt.run(
    name || null,
    email ? email.toLowerCase().trim() : null,
    normalizePhone(phone),
    reason || null
  )
  return Number(result.lastInsertRowid)
}

/** @type {Types.removeFromBlocklist} */
export function removeFromBlocklist(id) {
  const db = getDb()
  const stmt = db.prepare("DELETE FROM blocklist WHERE id = ?")
  const result = stmt.run(id)
  return result.changes > 0
}
