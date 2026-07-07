/** @file Admin manual SMS endpoints for copy-paste texting workflow */
/** @import * as Types from './types.js' */

import { getGuestById, updateGuestInvitedAt } from "../guests/data.js"
import { logCommunication, withTransaction } from "../../db/utils.js"
import { sendJson, parseBody } from "../../core/http.js"
import {
  ValidationError,
  validateId,
  validateIdArray,
} from "../../core/validation.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import {
  SERVER,
  WEDDING,
  COMMUNICATION_TYPE,
  COMMUNICATION_STATUS,
} from "../../types.js"
import { sql } from "../../db/sql.js"

const DEFAULT_TEMPLATE =
  "Hi {name}! You're invited to " +
  WEDDING.COUPLE_NAMES +
  "'s wedding on {date} in {location}. Please RSVP here: {url}"

/** @type {Types.AuthedHandler} */
export async function getEligibleGuests(req, res) {
  const guests =
    sql`SELECT id, name, phone, invite_code, status, last_invited_at
     FROM guests
     WHERE phone IS NOT NULL
       AND deleted_at IS NULL
       AND status IN ('pending', 'invited')
     ORDER BY name`.all()

  return sendJson(res, 200, {
    guests,
    defaultTemplate: DEFAULT_TEMPLATE,
    wedding: {
      date: WEDDING.DATE,
      location: WEDDING.LOCATION,
      coupleNames: WEDDING.COUPLE_NAMES,
      baseUrl: SERVER.baseUrl,
    },
  })
}

/** @type {Types.AuthedHandler} */
export async function markSent(req, res, { session }) {
  const body = await parseBody(req)

  const { guestId, messagePreview } = body

  const idResult = validateId(guestId, "guestId")
  if (!idResult.valid) {
    throw new ValidationError(idResult.error)
  }

  const guest = getGuestById(idResult.value)
  if (!guest) {
    throw new ValidationError("Guest not found")
  }

  if (!guest.phone) {
    throw new ValidationError("Guest has no phone number")
  }

  const preview =
    typeof messagePreview === "string" ? messagePreview.slice(0, 100) : null

  updateGuestInvitedAt(idResult.value)

  logCommunication(
    idResult.value,
    COMMUNICATION_TYPE.SMS,
    COMMUNICATION_STATUS.SENT,
    preview,
    null,
  )

  log({
    action: AUDIT_ACTIONS.MANUAL_SMS_MARK,
    adminId: session?.token,
    ip: getClientIp(req),
    details: {
      guestId: idResult.value,
      guestName: guest.name,
    },
  })

  return sendJson(res, 200, {
    success: true,
    guest: { id: guest.id, name: guest.name, status: "invited" },
  })
}

/** @type {Types.AuthedHandler} */
export async function markSentBatch(req, res, { session }) {
  const body = await parseBody(req)

  const { guestIds, messagePreview } = body

  const idsResult = validateIdArray(guestIds, "guestIds")
  if (!idsResult.valid) {
    throw new ValidationError(idsResult.error)
  }

  const preview =
    typeof messagePreview === "string" ? messagePreview.slice(0, 100) : null

  /** @type {{ id: number, name: string }[]} */
  const sent = []
  /** @type {{ id: number, name?: string, error: string }[]} */
  const failed = []

  withTransaction(() => {
    for (const id of idsResult.value) {
      const guest = getGuestById(id)
      if (!guest) {
        failed.push({ id, error: "Guest not found" })
        continue
      }
      if (!guest.phone) {
        failed.push({ id, name: guest.name, error: "No phone number" })
        continue
      }

      try {
        updateGuestInvitedAt(id)
        logCommunication(
          id,
          COMMUNICATION_TYPE.SMS,
          COMMUNICATION_STATUS.SENT,
          preview,
          null,
        )
        sent.push({ id: guest.id, name: guest.name })
      } catch (err) {
        failed.push({
          id,
          name: guest.name,
          error: err instanceof Error ? err.message : "Unknown error",
        })
      }
    }
  })

  if (sent.length > 0) {
    log({
      action: AUDIT_ACTIONS.MANUAL_SMS_MARK,
      adminId: session?.token,
      ip: getClientIp(req),
      details: {
        batch: true,
        sent: sent.length,
        failed: failed.length,
        guestIds: sent.map((r) => r.id),
      },
    })
  }

  return sendJson(res, 200, {
    success: true,
    results: { sent, failed },
    summary: { sent: sent.length, failed: failed.length },
  })
}
