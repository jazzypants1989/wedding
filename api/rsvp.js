/** @file RSVP endpoints */
/** @import * as Types from './types.js' */

import { queryOne, queryAll } from "../db/connection.js"
import { now, withTransaction } from "../db/utils.js"
import { getGuestByInviteCode } from "./guests/data.js"
import { sendJson, parseBody, checkRateLimit } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import {
  validateInviteCode,
  validateOptionalString,
} from "../core/validation.js"
import { GUEST_STATUS, LIMITS } from "../types.js"

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
          song_request: rsvp.song_request,
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

  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: "Invalid JSON body" })
  }

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
  const songResult = validateOptionalString(body.song_request, 200)
  const messageResult = validateOptionalString(
    body.message,
    LIMITS.MESSAGE_MAX_LENGTH,
  )

  upsertRsvp(guest.id, {
    attending: body.attending,
    actual_party_size: actualPartySize,
    dietary_restrictions: dietaryResult.value,
    song_request: songResult.value,
    message: messageResult.value,
  })

  return sendJson(res, 200, {
    success: true,
    message:
      body.attending && actualPartySize
        ? `Thank you! We're excited to see you and ${
            actualPartySize > 1
              ? `your ${actualPartySize - 1} guest(s)`
              : "just you"
          }!`
        : "We're sorry you can't make it. Thank you for letting us know!",
  })
}

/** @type {Types.getRsvpByGuestId} */
export function getRsvpByGuestId(guestId) {
  return queryOne("SELECT * FROM rsvps WHERE guest_id = ?", guestId)
}

/** @type {Types.upsertRsvp} */
export function upsertRsvp(
  guestId,
  { attending, actual_party_size, dietary_restrictions, song_request, message },
) {
  const timestamp = now()

  return withTransaction((db) => {
    const stmt = db.prepare(`
      INSERT INTO rsvps (guest_id, attending, actual_party_size, dietary_restrictions, song_request, message, submitted_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guest_id) DO UPDATE SET
        attending = excluded.attending,
        actual_party_size = excluded.actual_party_size,
        dietary_restrictions = excluded.dietary_restrictions,
        song_request = excluded.song_request,
        message = excluded.message,
        updated_at = excluded.updated_at
    `)

    stmt.run(
      guestId,
      attending ? 1 : 0,
      actual_party_size || null,
      dietary_restrictions || null,
      song_request || null,
      message || null,
      timestamp,
      timestamp,
    )

    const updateStmt = db.prepare(
      "UPDATE guests SET status = ?, updated_at = ? WHERE id = ?",
    )
    updateStmt.run(GUEST_STATUS.RESPONDED, timestamp, guestId)

    return true
  })
}

/** @type {Types.getAllRsvps} */
export function getAllRsvps({ includeDeleted = false } = {}) {
  const whereClause = includeDeleted ? "" : "WHERE g.deleted_at IS NULL"
  return queryAll(`
    SELECT r.*, g.name, g.email, g.phone, g.party_size as max_party_size, g.deleted_at as guest_deleted_at
    FROM rsvps r
    JOIN guests g ON r.guest_id = g.id
    ${whereClause}
    ORDER BY r.submitted_at DESC
  `)
}

/** @type {Types.getStats} */
export function getStats() {
  const stats = queryOne(`
    SELECT
      SUM(CASE WHEN g.deleted_at IS NULL THEN 1 ELSE 0 END) as total_guests,
      SUM(CASE WHEN g.deleted_at IS NULL AND g.status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN g.deleted_at IS NULL AND g.status = 'invited' THEN 1 ELSE 0 END) as invited,
      SUM(CASE WHEN g.deleted_at IS NULL AND g.status = 'responded' THEN 1 ELSE 0 END) as responded,
      SUM(CASE WHEN g.deleted_at IS NULL AND r.attending = 1 THEN 1 ELSE 0 END) as attending_yes,
      SUM(CASE WHEN g.deleted_at IS NULL AND r.attending = 0 THEN 1 ELSE 0 END) as attending_no,
      COALESCE(SUM(CASE WHEN g.deleted_at IS NULL AND r.attending = 1 THEN r.actual_party_size ELSE 0 END), 0) as total_headcount,
      SUM(CASE WHEN g.deleted_at IS NOT NULL THEN 1 ELSE 0 END) as deleted_guests
    FROM guests g
    LEFT JOIN rsvps r ON g.id = r.guest_id
  `)
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
