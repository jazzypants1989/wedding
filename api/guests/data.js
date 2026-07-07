/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../types.js' */

import {
  isGuestStatus,
  LIMITS,
  PAGINATION,
  COMMUNICATION_STATUS,
  GUEST_STATUS,
} from "../../types.js"
import { sendJson, parseBody } from "../../core/http.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import {
  validateRequiredString,
  validatePartySize,
  validateEmail,
  validatePhone,
  validateOptionalString,
  validateGuestStatus,
  validateId,
  ValidationError,
  NotFoundError,
} from "../../core/validation.js"
import { getStats, getRsvpByGuestId } from "../rsvp.js"
import { sql } from "../../db/sql.js"
import {
  generateInviteCode,
  now,
  escapeLikePattern,
  normalizePhone,
  normalizeEmail,
} from "../../db/utils.js"

/** @type {Types.getGuestByInviteCode} */
export function getGuestByInviteCode(code) {
  return sql`SELECT * FROM guests WHERE invite_code = ${code} AND deleted_at IS NULL`.get()
}

// Account registration lookup only: codes are hand-typed on phones where the auth
// sheet auto-capitalizes, so match case-insensitively. The RSVP flow's BINARY
// getGuestByInviteCode stays exact — its codes arrive verbatim via links.
/** @type {Types.getGuestByInviteCodeNoCase} */
export function getGuestByInviteCodeNoCase(code) {
  return sql`SELECT * FROM guests WHERE invite_code = ${code} COLLATE NOCASE AND deleted_at IS NULL`.get()
}

/** @type {Types.getGuestByEmail} */
export function getGuestByEmail(email) {
  return sql`SELECT * FROM guests WHERE email = ${normalizeEmail(email)} AND deleted_at IS NULL`.get()
}

/** @type {Types.getGuestByPhone} */
export function getGuestByPhone(phone) {
  const normalized = normalizePhone(phone)
  return sql`SELECT * FROM guests WHERE phone = ${normalized} AND deleted_at IS NULL`.get()
}

/** @type {Types.getGuestById} */
export function getGuestById(id, { includeDeleted = false } = {}) {
  const deleted = includeDeleted ? sql.empty : sql`AND deleted_at IS NULL`
  return sql`SELECT * FROM guests WHERE id = ${id} ${deleted}`.get()
}

/** @type {Types.getGuestsByIds} */
export function getGuestsByIds(ids, { includeDeleted = false } = {}) {
  if (!ids || ids.length === 0) return []
  const deleted = includeDeleted ? sql.empty : sql`AND deleted_at IS NULL`
  return sql`SELECT * FROM guests WHERE id IN ${sql.list(ids)} ${deleted}`.all()
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
  const deletedFilter = onlyDeleted
    ? sql`AND g.deleted_at IS NOT NULL`
    : !includeDeleted
      ? sql`AND g.deleted_at IS NULL`
      : sql.empty

  const statusFilter = status ? sql`AND g.status = ${status}` : sql.empty

  const searchFilter = search
    ? (() => {
        const pattern = `%${escapeLikePattern(search)}%`
        return sql`AND (g.name LIKE ${pattern} ESCAPE '\\' OR g.email LIKE ${pattern} ESCAPE '\\' OR g.phone LIKE ${pattern} ESCAPE '\\')`
      })()
    : sql.empty

  return sql`SELECT g.*, COALESCE(ic.invite_count, 0) as invite_count
    FROM guests g
    LEFT JOIN (
      SELECT guest_id, COUNT(*) as invite_count
      FROM communications WHERE status = ${COMMUNICATION_STATUS.SENT}
      GROUP BY guest_id
    ) ic ON g.id = ic.guest_id
    WHERE 1=1
    ${deletedFilter}
    ${statusFilter}
    ${searchFilter}
    ORDER BY g.created_at DESC LIMIT ${limit} OFFSET ${offset}`.all()
}

/** @type {Types.countGuests} */
export function countGuests({
  status,
  search,
  includeDeleted = false,
  onlyDeleted = false,
} = {}) {
  const deletedFilter = onlyDeleted
    ? sql`AND deleted_at IS NOT NULL`
    : !includeDeleted
      ? sql`AND deleted_at IS NULL`
      : sql.empty

  const statusFilter = status ? sql`AND status = ${status}` : sql.empty

  const searchFilter = search
    ? (() => {
        const pattern = `%${escapeLikePattern(search)}%`
        return sql`AND (name LIKE ${pattern} ESCAPE '\\' OR email LIKE ${pattern} ESCAPE '\\' OR phone LIKE ${pattern} ESCAPE '\\')`
      })()
    : sql.empty

  /** @type {Types.CountResult | undefined} */
  const result = sql`SELECT COUNT(*) as count FROM guests WHERE 1=1
    ${deletedFilter}
    ${statusFilter}
    ${searchFilter}`.get()
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
  const invite_code = generateInviteCode()
  const result =
    sql`INSERT INTO guests (name, email, phone, party_size, invite_code, notes)
    VALUES (${name}, ${normalizeEmail(email)}, ${normalizePhone(phone)}, ${party_size}, ${invite_code}, ${notes})`.run()
  return { id: result.lastInsertRowid, invite_code }
}

/** @type {Types.updateGuest} */
export function updateGuest(
  id,
  { name, email, phone, party_size, notes, status },
) {
  /** @type {import('../../db/sql.js').SqlFragment[]} */
  const sets = []

  if (name !== undefined) sets.push(sql`name = ${name}`)
  if (email !== undefined) sets.push(sql`email = ${normalizeEmail(email)}`)
  if (phone !== undefined) sets.push(sql`phone = ${normalizePhone(phone)}`)
  if (party_size !== undefined) sets.push(sql`party_size = ${party_size}`)
  if (notes !== undefined) sets.push(sql`notes = ${notes || null}`)
  if (status !== undefined) sets.push(sql`status = ${status}`)

  if (sets.length === 0) return false

  sets.push(sql`updated_at = ${now()}`)

  const setClause = sql.join(sets, ", ")
  const result = sql`UPDATE guests SET ${setClause} WHERE id = ${id}`.run()
  return result.changes > 0
}

/** @type {Types.softDeleteGuest} */
export function softDeleteGuest(id) {
  const timestamp = now()
  const result =
    sql`UPDATE guests SET deleted_at = ${timestamp}, updated_at = ${timestamp} WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.restoreGuest} */
export function restoreGuest(id) {
  const result =
    sql`UPDATE guests SET deleted_at = NULL, updated_at = ${now()} WHERE id = ${id} AND deleted_at IS NOT NULL`.run()
  return result.changes > 0
}

/** @type {Types.hardDeleteGuest} */
export function hardDeleteGuest(id) {
  const result = sql`DELETE FROM guests WHERE id = ${id}`.run()
  return result.changes > 0
}

/** @type {Types.updateGuestInvitedAt} */
export function updateGuestInvitedAt(id) {
  const timestamp = now()
  sql`UPDATE guests
    SET last_invited_at = ${timestamp}, status = CASE WHEN status = ${GUEST_STATUS.PENDING} THEN ${GUEST_STATUS.INVITED} ELSE status END, updated_at = ${timestamp}
    WHERE id = ${id}`.run()
}

/** @type {Types.statsHandler} */
export function stats(req, res) {
  const statsData = getStats()
  return sendJson(res, 200, { stats: statsData })
}

/** @type {Types.listHandler} */
export function list(req, res) {
  const urlObj = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const statusParam = urlObj.searchParams.get("status")
  const search = urlObj.searchParams.get("search") ?? undefined
  const limitParam = urlObj.searchParams.get("limit")
  const offsetParam = urlObj.searchParams.get("offset")
  const parsedLimit = limitParam
    ? parseInt(limitParam, 10)
    : PAGINATION.DEFAULT_PAGE_SIZE
  const limit =
    isNaN(parsedLimit) || parsedLimit < 1
      ? PAGINATION.DEFAULT_PAGE_SIZE
      : Math.min(parsedLimit, PAGINATION.MAX_PAGE_SIZE)
  const parsedOffset = offsetParam ? parseInt(offsetParam, 10) : 0
  const offset = isNaN(parsedOffset) || parsedOffset < 0 ? 0 : parsedOffset
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
export async function create(req, res, { session }) {
  const body = await parseBody(req)

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
export async function update(req, res, { params, session }) {
  const idResult = validateId(params.id, "guest ID")
  if (!idResult.valid) {
    throw new ValidationError(idResult.error)
  }

  const existingGuest = getGuestById(idResult.value)
  if (!existingGuest) {
    throw new NotFoundError("Guest")
  }

  const body = await parseBody(req)

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
export async function remove(req, res, { params, session }) {
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
export async function restore(req, res, { params, session }) {
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
