/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../types.js' */

import {
  isGuestStatus,
  LIMITS,
  PAGINATION,
  COMMUNICATION_STATUS,
  GUEST_STATUS,
} from "../../types.js"
import { withAdmin } from "../../core/auth.js"
import { sendJson, parseBody } from "../../core/http.js"
import { log, AUDIT_ACTIONS } from "../../core/log.js"
import { getClientIp } from "../../core/rate-limit.js"
import { ValidationError, NotFoundError } from "../../core/errors.js"
import {
  validateRequiredString,
  validatePartySize,
  validateEmail,
  validatePhone,
  validateOptionalString,
  validateGuestStatus,
  validateId,
} from "../../core/validation.js"
import { getStats, getRsvpByGuestId } from "../rsvp.js"
import { getDb, queryOne, queryAll } from "../../db/connection.js"
import {
  generateInviteCode,
  now,
  escapeLikePattern,
  normalizePhone,
} from "../../db/utils.js"

/** @type {Types.getGuestByInviteCode} */
export function getGuestByInviteCode(code) {
  return queryOne(
    "SELECT * FROM guests WHERE invite_code = ? AND deleted_at IS NULL",
    code,
  )
}

/** @type {Types.getGuestByEmail} */
export function getGuestByEmail(email) {
  return queryOne(
    "SELECT * FROM guests WHERE email = ? AND deleted_at IS NULL",
    email ? email.toLowerCase().trim() : null,
  )
}

/** @type {Types.getGuestByPhone} */
export function getGuestByPhone(phone) {
  const normalized = normalizePhone(phone)
  return queryOne(
    "SELECT * FROM guests WHERE phone = ? AND deleted_at IS NULL",
    normalized,
  )
}

/** @type {Types.getGuestById} */
export function getGuestById(id, { includeDeleted = false } = {}) {
  const sql = includeDeleted
    ? "SELECT * FROM guests WHERE id = ?"
    : "SELECT * FROM guests WHERE id = ? AND deleted_at IS NULL"
  return queryOne(sql, id)
}

/** @type {Types.getGuestsByIds} */
export function getGuestsByIds(ids, { includeDeleted = false } = {}) {
  if (!ids || ids.length === 0) return []
  const placeholders = ids.map(() => "?").join(",")
  const deletedClause = includeDeleted ? "" : "AND deleted_at IS NULL"
  return queryAll(
    `SELECT * FROM guests WHERE id IN (${placeholders}) ${deletedClause}`,
    ...ids,
  )
}

/** @type {Types.getAllGuests} */
export function getAllGuests({
  status,
  search,
  limit = 50,
  offset = 0,
  includeDeleted = false,
  onlyDeleted = false,
} = {}) {
  let sql = `
    SELECT g.*, COALESCE(ic.invite_count, 0) as invite_count
    FROM guests g
    LEFT JOIN (
      SELECT guest_id, COUNT(*) as invite_count
      FROM communications WHERE status = ?
      GROUP BY guest_id
    ) ic ON g.id = ic.guest_id
    WHERE 1=1
  `
  /** @type {(string | number)[]} */
  const params = [COMMUNICATION_STATUS.SENT]

  if (onlyDeleted) {
    sql += " AND g.deleted_at IS NOT NULL"
  } else if (!includeDeleted) {
    sql += " AND g.deleted_at IS NULL"
  }

  if (status) {
    sql += " AND g.status = ?"
    params.push(status)
  }

  if (search) {
    sql +=
      " AND (g.name LIKE ? ESCAPE '\\' OR g.email LIKE ? ESCAPE '\\' OR g.phone LIKE ? ESCAPE '\\')"
    const searchPattern = `%${escapeLikePattern(search)}%`
    params.push(searchPattern, searchPattern, searchPattern)
  }

  sql += " ORDER BY g.created_at DESC LIMIT ? OFFSET ?"
  params.push(limit, offset)

  return queryAll(sql, ...params)
}

/** @type {Types.countGuests} */
export function countGuests({
  status,
  search,
  includeDeleted = false,
  onlyDeleted = false,
} = {}) {
  let sql = "SELECT COUNT(*) as count FROM guests WHERE 1=1"
  /** @type {(string | number)[]} */
  const params = []

  if (onlyDeleted) {
    sql += " AND deleted_at IS NOT NULL"
  } else if (!includeDeleted) {
    sql += " AND deleted_at IS NULL"
  }

  if (status) {
    sql += " AND status = ?"
    params.push(status)
  }

  if (search) {
    sql +=
      " AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')"
    const searchPattern = `%${escapeLikePattern(search)}%`
    params.push(searchPattern, searchPattern, searchPattern)
  }

  /** @type {Types.CountResult | undefined} */
  const result = queryOne(sql, ...params)
  return result ? result.count : 0
}

/** @type {Types.createGuest} */
export function createGuest({
  name,
  email,
  phone,
  party_size = 1,
  notes = null,
}) {
  const db = getDb()
  const invite_code = generateInviteCode()
  const normalizedEmail = email ? email.toLowerCase().trim() : null
  const stmt = db.prepare(`
    INSERT INTO guests (name, email, phone, party_size, invite_code, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    name,
    normalizedEmail,
    phone || null,
    party_size,
    invite_code,
    notes,
  )
  return { id: result.lastInsertRowid, invite_code }
}

/** @type {Types.updateGuest} */
export function updateGuest(
  id,
  { name, email, phone, party_size, notes, status },
) {
  const db = getDb()
  /** @type {string[]} */
  const updates = []
  /** @type {(string | number | null)[]} */
  const params = []

  if (name !== undefined) {
    updates.push("name = ?")
    params.push(name)
  }
  if (email !== undefined) {
    updates.push("email = ?")
    params.push(email ? email.toLowerCase().trim() : null)
  }
  if (phone !== undefined) {
    updates.push("phone = ?")
    params.push(phone || null)
  }
  if (party_size !== undefined) {
    updates.push("party_size = ?")
    params.push(party_size)
  }
  if (notes !== undefined) {
    updates.push("notes = ?")
    params.push(notes || null)
  }
  if (status !== undefined) {
    updates.push("status = ?")
    params.push(status)
  }

  if (updates.length === 0) return false

  updates.push("updated_at = ?")
  params.push(now())
  params.push(id)

  const stmt = db.prepare(
    `UPDATE guests SET ${updates.join(", ")} WHERE id = ?`,
  )
  const result = stmt.run(...params)
  return result.changes > 0
}

/** @type {Types.softDeleteGuest} */
export function softDeleteGuest(id) {
  const db = getDb()
  const stmt = db.prepare(
    "UPDATE guests SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
  )
  const timestamp = now()
  const result = stmt.run(timestamp, timestamp, id)
  return result.changes > 0
}

/** @type {Types.restoreGuest} */
export function restoreGuest(id) {
  const db = getDb()
  const stmt = db.prepare(
    "UPDATE guests SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
  )
  const result = stmt.run(now(), id)
  return result.changes > 0
}

/** @type {Types.hardDeleteGuest} */
export function hardDeleteGuest(id) {
  const db = getDb()
  const stmt = db.prepare("DELETE FROM guests WHERE id = ?")
  const result = stmt.run(id)
  return result.changes > 0
}

/** @type {Types.updateGuestInvitedAt} */
export function updateGuestInvitedAt(id) {
  const db = getDb()
  const stmt = db.prepare(`
    UPDATE guests
    SET last_invited_at = ?, status = CASE WHEN status = ? THEN ? ELSE status END, updated_at = ?
    WHERE id = ?
  `)
  const timestamp = now()
  stmt.run(timestamp, GUEST_STATUS.PENDING, GUEST_STATUS.INVITED, timestamp, id)
}

/** @type {Types.statsHandler} */
function statsHandler(req, res) {
  const stats = getStats()
  return sendJson(res, 200, { stats })
}

/** @type {Types.listHandler} */
function listHandler(req, res) {
  const urlObj = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const statusParam = urlObj.searchParams.get("status")
  const search = urlObj.searchParams.get("search") ?? undefined
  const limitParam = urlObj.searchParams.get("limit")
  const offsetParam = urlObj.searchParams.get("offset")
  const limit = Math.min(
    limitParam ? parseInt(limitParam, 10) : PAGINATION.DEFAULT_PAGE_SIZE,
    PAGINATION.MAX_PAGE_SIZE,
  )
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0
  const onlyDeleted = statusParam === "archived"

  let status

  if (statusParam === "archived") {
    status = undefined
  } else if (isGuestStatus(statusParam)) {
    status = /** @type {GlobalTypes.GuestStatus} */ (statusParam)
  }

  const guests = getAllGuests({
    status,
    search,
    limit,
    offset,
    onlyDeleted,
  })
  const total = countGuests({ status, search, onlyDeleted })

  // guests already includes invite_count from the JOIN in getAllGuests
  return sendJson(res, 200, {
    guests,
    pagination: { total, limit, offset },
  })
}

/** @type {Types.createHandler} */
async function createHandler(req, res, { session }) {
  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    throw new ValidationError("Invalid JSON body")
  }

  const { name, email, phone, party_size, notes } = body

  const nameResult = validateRequiredString(
    name,
    "Name",
    LIMITS.NAME_MAX_LENGTH,
  )
  if (!nameResult.valid) {
    throw new ValidationError(nameResult.error)
  }

  const partySizeResult = validatePartySize(party_size ?? 1)
  if (!partySizeResult.valid) {
    throw new ValidationError(partySizeResult.error)
  }

  const emailResult = validateEmail(email)
  if (!emailResult.valid) {
    throw new ValidationError(emailResult.error)
  }

  const phoneResult = validatePhone(phone)
  if (!phoneResult.valid) {
    throw new ValidationError(phoneResult.error)
  }

  const notesResult = validateOptionalString(notes, LIMITS.NOTES_MAX_LENGTH)

  const result = createGuest({
    name: nameResult.value,
    email: emailResult.value,
    phone: phoneResult.value,
    party_size: partySizeResult.value,
    notes: notesResult.value,
  })
  const guestId = Number(result.id)

  log({
    action: AUDIT_ACTIONS.GUEST_CREATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "guest",
    resourceId: guestId,
    details: { name: nameResult.value },
  })

  const guest = getGuestById(guestId)
  return sendJson(res, 201, {
    success: true,
    message: "Guest added successfully",
    guest,
  })
}

/** @type {Types.updateHandler} */
async function updateHandler(req, res, { params, session }) {
  const idResult = validateId(params.id, "guest ID")
  if (!idResult.valid) {
    throw new ValidationError(idResult.error)
  }

  const existingGuest = getGuestById(idResult.value)
  if (!existingGuest) {
    throw new NotFoundError("Guest")
  }

  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    throw new ValidationError("Invalid JSON body")
  }

  const updates = {}

  if (body.name !== undefined) {
    const nameResult = validateRequiredString(
      body.name,
      "Name",
      LIMITS.NAME_MAX_LENGTH,
    )
    if (!nameResult.valid) {
      throw new ValidationError(nameResult.error)
    }
    updates.name = nameResult.value
  }

  if (body.email !== undefined) {
    const emailResult = validateEmail(body.email)
    if (!emailResult.valid) {
      throw new ValidationError(emailResult.error)
    }
    updates.email = emailResult.value
  }

  if (body.phone !== undefined) {
    const phoneResult = validatePhone(body.phone)
    if (!phoneResult.valid) {
      throw new ValidationError(phoneResult.error)
    }
    updates.phone = phoneResult.value
  }

  if (body.party_size !== undefined) {
    const partySizeResult = validatePartySize(body.party_size)
    if (!partySizeResult.valid) {
      throw new ValidationError(partySizeResult.error)
    }
    updates.party_size = partySizeResult.value
  }

  if (body.notes !== undefined) {
    const notesResult = validateOptionalString(
      body.notes,
      LIMITS.NOTES_MAX_LENGTH,
    )
    updates.notes = notesResult.value
  }

  if (body.status !== undefined) {
    const statusResult = validateGuestStatus(body.status)
    if (!statusResult.valid) {
      throw new ValidationError(statusResult.error)
    }
    updates.status = statusResult.value
  }

  if (Object.keys(updates).length === 0) {
    throw new ValidationError("No valid fields to update")
  }

  updateGuest(idResult.value, updates)

  log({
    action: AUDIT_ACTIONS.GUEST_UPDATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "guest",
    resourceId: idResult.value,
    details: { fields: Object.keys(updates) },
  })

  const guest = getGuestById(idResult.value)
  return sendJson(res, 200, {
    success: true,
    message: "Guest updated successfully",
    guest,
  })
}

/** @type {Types.deleteHandler} */
async function deleteHandler(req, res, { params, session }) {
  const idResult = validateId(params.id, "guest ID")
  if (!idResult.valid) {
    throw new ValidationError(idResult.error)
  }

  const guest = getGuestById(idResult.value)
  if (!guest) {
    throw new NotFoundError("Guest")
  }

  const rsvp = getRsvpByGuestId(idResult.value)
  const hadRsvp = !!rsvp

  softDeleteGuest(idResult.value)

  log({
    action: AUDIT_ACTIONS.GUEST_DELETE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "guest",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, {
    success: true,
    message: hadRsvp
      ? "Guest archived (RSVP data preserved)"
      : "Guest archived successfully",
    hadRsvp,
  })
}

/** @type {Types.restoreHandler} */
async function restoreHandler(req, res, { params, session }) {
  const idResult = validateId(params.id, "guest ID")
  if (!idResult.valid) {
    throw new ValidationError(idResult.error)
  }

  const guest = getGuestById(idResult.value, { includeDeleted: true })
  if (!guest) {
    throw new NotFoundError("Guest")
  }

  if (!guest.deleted_at) {
    throw new ValidationError("Guest is not archived")
  }

  restoreGuest(idResult.value)

  log({
    action: AUDIT_ACTIONS.GUEST_RESTORE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "guest",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, {
    success: true,
    message: "Guest restored successfully",
    guest: getGuestById(idResult.value),
  })
}

export const stats = withAdmin(statsHandler)
export const list = withAdmin(listHandler)
export const create = withAdmin(createHandler)
export const update = withAdmin(updateHandler)
export const remove = withAdmin(deleteHandler)
export const restore = withAdmin(restoreHandler)
