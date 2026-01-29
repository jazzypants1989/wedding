/** @file Admin blocklist management endpoints */
/** @import * as Types from './types.js' */

import { sendJson, parseBody } from "../../core/http.js"
import {
  ValidationError,
  NotFoundError,
  validateEmail,
  validatePhone,
  validateOptionalString,
  validateId,
} from "../../core/validation.js"
import { LIMITS } from "../../types.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import { sql } from "../../db/sql.js"
import {
  normalizePhone,
  normalizeEmail,
  normalizeName,
  levenshteinDistance,
} from "../../db/utils.js"

/** @type {Types.listHandler} */
export async function list(req, res) {
  const blocklist = getAllBlocklist()
  return sendJson(res, 200, { blocklist, total: blocklist.length })
}

/** @type {Types.createHandler} */
export async function create(req, res, { session }) {
  const body = await parseBody(req)

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
      "At least one of name, email, or phone is required",
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
export async function remove(req, res, { params, session }) {
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

/** @type {Types.isBlocked} */
export function isBlocked({ name, email, phone }) {
  const normalizedInputEmail = normalizeEmail(email)
  const normalizedInputPhone = normalizePhone(phone)

  if (normalizedInputEmail) {
    const emailMatch =
      sql`SELECT * FROM blocklist WHERE LOWER(email) = ${normalizedInputEmail} LIMIT 1`.get()
    if (emailMatch) return emailMatch
  }

  if (normalizedInputPhone) {
    const phoneMatch =
      sql`SELECT * FROM blocklist WHERE phone = ${normalizedInputPhone} LIMIT 1`.get()
    if (phoneMatch) return phoneMatch
  }

  if (name) {
    const normalizedInputName = normalizeName(name)
    if (normalizedInputName) {
      const namedEntries =
        sql`SELECT * FROM blocklist WHERE name IS NOT NULL`.all()

      for (const entry of namedEntries) {
        const normalizedEntryName = normalizeName(entry.name)
        const distance = levenshteinDistance(
          normalizedInputName,
          normalizedEntryName,
          2,
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
  return sql`SELECT * FROM blocklist ORDER BY created_at DESC`.all()
}

/** @type {Types.addToBlocklist} */
export function addToBlocklist({ name, email, phone, reason }) {
  const result = sql`INSERT INTO blocklist (name, email, phone, reason)
    VALUES (${name || null}, ${normalizeEmail(email)}, ${normalizePhone(phone)}, ${reason || null})`.run()
  return Number(result.lastInsertRowid)
}

/** @type {Types.removeFromBlocklist} */
export function removeFromBlocklist(id) {
  const result = sql`DELETE FROM blocklist WHERE id = ${id}`.run()
  return result.changes > 0
}
