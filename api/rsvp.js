/** @file RSVP endpoints */
/** @import * as Types from './types.js' */

import { sql } from "../db/sql.js"
import { now, withTransaction } from "../db/utils.js"
import { getGuestByInviteCode } from "./guests/data.js"
import { sendJson, parseBody, checkRateLimit } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import {
  validateInviteCode,
  validateOptionalString,
  NotFoundError,
} from "../core/validation.js"
import { GUEST_STATUS, LIMITS } from "../types.js"
import { log, AUDIT_ACTIONS } from "../core/utils.js"

/** @type {Types.get} */
export async function get(req, res, { params }) {
  const clientIp = getClientIp(req)
  if (checkRateLimit(res, limiters.rsvp, clientIp)) return

  const { code } = params

  const codeResult = validateInviteCode(code)
  if (!codeResult.valid) {
    return sendJson(res, 400, { error: codeResult.error })
  }

  const guest = getGuestByInviteCode(codeResult.value)
  if (!guest) {
    return sendJson(res, 404, { error: "Invite code not found" })
  }

  const rsvp = getRsvpByGuestId(guest.id)

  return sendJson(res, 200, {
    guest: {
      name: guest.name,
      party_size: guest.party_size,
    },
    rsvp: rsvp
      ? {
          attending: rsvp.attending === 1,
          actual_party_size: rsvp.actual_party_size,
          dietary_restrictions: rsvp.dietary_restrictions,
          additional_info: rsvp.additional_info,
          message: rsvp.message,
          submitted_at: rsvp.submitted_at,
          updated_at: rsvp.updated_at,
        }
      : null,
  })
}

/** @type {Types.post} */
export async function post(req, res, { params }) {
  const clientIp = getClientIp(req)
  if (checkRateLimit(res, limiters.rsvp, clientIp)) return

  const { code } = params

  const codeResult = validateInviteCode(code)
  if (!codeResult.valid) {
    return sendJson(res, 400, { error: codeResult.error })
  }

  const guest = getGuestByInviteCode(codeResult.value)
  if (!guest) {
    return sendJson(res, 404, { error: "Invite code not found" })
  }

  const body = await parseBody(req)

  if (typeof body.attending !== "boolean") {
    return sendJson(res, 400, { error: "attending must be a boolean" })
  }

  let actualPartySize = null
  if (body.attending) {
    actualPartySize = parseInt(String(body.actual_party_size), 10)
    if (isNaN(actualPartySize) || actualPartySize < 1) {
      return sendJson(res, 400, {
        error: "actual_party_size must be at least 1 when attending",
      })
    }
    if (actualPartySize > guest.party_size) {
      return sendJson(res, 400, {
        error: `actual_party_size cannot exceed your allowed party size of ${guest.party_size}`,
      })
    }
  }

  const dietaryResult = validateOptionalString(body.dietary_restrictions, 500)
  const additionalInfoResult = validateOptionalString(
    body.additional_info,
    LIMITS.ADDITIONAL_INFO_MAX_LENGTH,
  )
  const messageResult = validateOptionalString(
    body.message,
    LIMITS.MESSAGE_MAX_LENGTH,
  )

  upsertRsvp(guest.id, {
    attending: body.attending,
    actual_party_size: actualPartySize,
    dietary_restrictions: dietaryResult.value,
    additional_info: additionalInfoResult.value,
    message: messageResult.value,
  })

  log({
    action: AUDIT_ACTIONS.RSVP_SUBMIT,
    ip: clientIp,
    resourceType: "guest",
    resourceId: String(guest.id),
    details: { attending: body.attending, partySize: actualPartySize },
  })

  return sendJson(res, 200, {
    success: true,
    message:
      body.attending && actualPartySize
        ? `Thank you! We're excited to see you and ${companionPhrase(actualPartySize)}!`
        : "We're sorry you can't make it. Thank you for letting us know!",
  })
}

/**
 * Human phrasing for who's coming, given the party size (self included).
 * @param {number} partySize @returns {string}
 */
function companionPhrase(partySize) {
  if (partySize === 2) return "your guest"
  if (partySize > 2) return `your ${partySize - 1} guests`
  return "just you"
}

/** @type {Types.getRsvpByGuestId} */
export function getRsvpByGuestId(guestId) {
  return sql`SELECT * FROM rsvps WHERE guest_id = ${guestId}`.get()
}

/** @type {Types.upsertRsvp} */
export function upsertRsvp(
  guestId,
  { attending, actual_party_size, dietary_restrictions, additional_info, message },
) {
  const timestamp = now()

  return withTransaction(() => {
    // Defense-in-depth: verify guest is not soft-deleted before writing
    const guest =
      sql`SELECT id FROM guests WHERE id = ${guestId} AND deleted_at IS NULL`.get()
    if (!guest) throw new NotFoundError("Guest not found or deleted")

    sql`INSERT INTO rsvps (guest_id, attending, actual_party_size, dietary_restrictions, additional_info, message, submitted_at, updated_at)
      VALUES (${guestId}, ${attending ? 1 : 0}, ${actual_party_size || null}, ${dietary_restrictions || null}, ${additional_info || null}, ${message || null}, ${timestamp}, ${timestamp})
      ON CONFLICT(guest_id) DO UPDATE SET
        attending = excluded.attending,
        actual_party_size = excluded.actual_party_size,
        dietary_restrictions = excluded.dietary_restrictions,
        additional_info = excluded.additional_info,
        message = excluded.message,
        updated_at = excluded.updated_at`.run()

    sql`UPDATE guests SET status = ${GUEST_STATUS.RESPONDED}, updated_at = ${timestamp} WHERE id = ${guestId}`.run()

    return true
  })
}

/** @type {Types.getAllRsvps} */
export function getAllRsvps({ includeDeleted = false } = {}) {
  const where = includeDeleted ? sql.empty : sql`WHERE g.deleted_at IS NULL`
  return sql`SELECT r.*, g.name, g.email, g.phone, g.party_size as max_party_size, g.deleted_at as guest_deleted_at
    FROM rsvps r
    JOIN guests g ON r.guest_id = g.id
    ${where}
    ORDER BY r.submitted_at DESC`.all()
}

/** @type {Types.getStats} */
export function getStats() {
  const stats = sql`SELECT
      SUM(CASE WHEN g.deleted_at IS NULL THEN 1 ELSE 0 END) as total_guests,
      SUM(CASE WHEN g.deleted_at IS NULL AND g.status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN g.deleted_at IS NULL AND g.status = 'invited' THEN 1 ELSE 0 END) as invited,
      SUM(CASE WHEN g.deleted_at IS NULL AND g.status = 'responded' THEN 1 ELSE 0 END) as responded,
      SUM(CASE WHEN g.deleted_at IS NULL AND r.attending = 1 THEN 1 ELSE 0 END) as attending_yes,
      SUM(CASE WHEN g.deleted_at IS NULL AND r.attending = 0 THEN 1 ELSE 0 END) as attending_no,
      COALESCE(SUM(CASE WHEN g.deleted_at IS NULL AND r.attending = 1 THEN r.actual_party_size ELSE 0 END), 0) as total_headcount,
      SUM(CASE WHEN g.deleted_at IS NOT NULL THEN 1 ELSE 0 END) as deleted_guests
    FROM guests g
    LEFT JOIN rsvps r ON g.id = r.guest_id`.get()
  return (
    stats || {
      total_guests: 0,
      pending: 0,
      invited: 0,
      responded: 0,
      attending_yes: 0,
      attending_no: 0,
      total_headcount: 0,
      deleted_guests: 0,
    }
  )
}
