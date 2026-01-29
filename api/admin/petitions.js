/** @file Admin petition management endpoints */
/** @import * as Types from './types.js' */
import { isPetitionStatus } from "../../types.js"
import {
  withTransaction,
  normalizePhone,
  normalizeEmail,
  now,
  generateInviteCode,
} from "../../db/utils.js"
import { getGuestById, updateGuestInvitedAt } from "../guests/data.js"
import { logCommunication } from "../../db/utils.js"
import { addToBlocklist } from "./blocklist.js"
import { sendJson, parseBody } from "../../core/http.js"
import { BASE_URL } from "../../types.js"
import {
  validateId,
  validatePartySize,
  validateOptionalString,
  ValidationError,
  NotFoundError,
} from "../../core/validation.js"
import { LIMITS, PETITION_STATUS } from "../../types.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import * as twilio from "../../services/twilio.js"
import * as email from "../../services/email.js"

import { sql } from "../../db/sql.js"

/** @type {Types.listPetitions} */
export async function list(req, res) {
  const urlObj = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const statusParam = urlObj.searchParams.get("status")
  const status = isPetitionStatus(statusParam) ? statusParam : undefined

  const petitions = getAllPetitions({ status })
  const counts = {
    pending: countPetitions({ status: "pending" }),
    approved: countPetitions({ status: "approved" }),
    denied: countPetitions({ status: "denied" }),
  }

  return sendJson(res, 200, { petitions, counts })
}

/** @type {Types.ParamsHandler} */
export async function approve(req, res, { params, session }) {
  const idResult = validateId(params.id, "petition ID")
  if (!idResult.valid) {
    throw new ValidationError(idResult.error)
  }

  const body = await parseBody(req)

  const partySizeResult = validatePartySize(body.party_size ?? 1)
  if (!partySizeResult.valid) {
    throw new ValidationError(partySizeResult.error)
  }
  const adminNotesResult = validateOptionalString(
    body.admin_notes,
    LIMITS.NOTES_MAX_LENGTH,
  )
  const sendInvite = body.send_invite !== false

  let guestResult
  try {
    guestResult = approvePetitionDb(idResult.value, {
      partySize: partySizeResult.value,
      adminNotes: adminNotesResult.value,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    if (message === "Petition not found") {
      throw new NotFoundError("Petition")
    }
    if (message.startsWith("Petition already")) {
      throw new ValidationError(message)
    }
    throw err
  }

  const guestId = Number(guestResult.id)

  log({
    action: AUDIT_ACTIONS.PETITION_APPROVE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "petition",
    resourceId: idResult.value,
    details: { guestId },
  })

  const petition = getPetitionById(idResult.value)

  let inviteSent = false
  if (sendInvite && petition) {
    const inviteUrl = `${BASE_URL}/rsvp?code=${guestResult.invite_code}`

    if (petition.email && email.isConfigured()) {
      const emailData = email.getDefaultInviteEmail(petition.name, inviteUrl)
      const sendResult = await email.sendEmail({
        to: petition.email,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      })

      if (sendResult.success) {
        logCommunication(guestId, "email", "sent", emailData.text.slice(0, 100))
        updateGuestInvitedAt(guestId)
        inviteSent = true
      } else {
        logCommunication(guestId, "email", "failed", null, sendResult.error)
      }
    } else if (petition.phone && twilio.isConfigured()) {
      const message = twilio.getDefaultInviteMessage(petition.name, inviteUrl)
      const sendResult = await twilio.sendSMS(petition.phone, message)

      if (sendResult.success) {
        logCommunication(guestId, "sms", "sent", message.slice(0, 100))
        updateGuestInvitedAt(guestId)
        inviteSent = true
      } else {
        logCommunication(guestId, "sms", "failed", null, sendResult.error)
      }
    }
  }

  const guest = getGuestById(guestId)
  return sendJson(res, 200, {
    success: true,
    message: inviteSent
      ? "Petition approved! Guest created and invite sent."
      : "Petition approved! Guest created. Invite not sent (service not configured or not requested).",
    guest,
    inviteSent,
  })
}

/** @type {Types.ParamsHandler} */
export async function deny(req, res, { params, session }) {
  const idResult = validateId(params.id, "petition ID")
  if (!idResult.valid) {
    throw new ValidationError(idResult.error)
  }

  const petition = getPetitionById(idResult.value)
  if (!petition) {
    throw new NotFoundError("Petition")
  }

  if (petition.status !== PETITION_STATUS.PENDING) {
    throw new ValidationError(`Petition already ${petition.status}`)
  }

  const body = await parseBody(req)

  const adminNotesResult = validateOptionalString(
    body.admin_notes,
    LIMITS.NOTES_MAX_LENGTH,
  )
  const shouldAddToBlocklist = body.add_to_blocklist === true
  const blocklistReasonResult = validateOptionalString(
    body.blocklist_reason,
    500,
  )

  // Wrap both operations in a transaction for atomicity
  withTransaction(() => {
    updatePetitionStatus(idResult.value, "denied", adminNotesResult.value)

    if (shouldAddToBlocklist) {
      addToBlocklist({
        name: petition.name,
        email: petition.email,
        phone: petition.phone,
        reason:
          blocklistReasonResult.value ||
          `Denied petition: ${adminNotesResult.value || "No reason specified"}`,
      })
    }
  })

  // Audit logging after successful transaction
  log({
    action: AUDIT_ACTIONS.PETITION_DENY,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "petition",
    resourceId: idResult.value,
    details: { addedToBlocklist: shouldAddToBlocklist },
  })

  return sendJson(res, 200, {
    success: true,
    message: shouldAddToBlocklist
      ? "Petition denied and added to blocklist."
      : "Petition denied.",
    addedToBlocklist: shouldAddToBlocklist,
  })
}

/** @type {Types.createPetition} */
export function createPetition({ name, email, phone, relationship, message }) {
  const result =
    sql`INSERT INTO petitions (name, email, phone, relationship, message)
    VALUES (${name}, ${normalizeEmail(email)}, ${normalizePhone(phone)}, ${relationship || null}, ${message || null})`.run()
  return result.lastInsertRowid
}

/** @type {Types.getPetitionById} */
export function getPetitionById(id) {
  return sql`SELECT * FROM petitions WHERE id = ${id}`.get()
}

/** @type {Types.getPetitionByEmail} */
export function getPetitionByEmail(email) {
  return sql`SELECT * FROM petitions WHERE email = ${normalizeEmail(email)} AND status = 'pending'`.get()
}

/** @type {Types.getAllPetitions} */
export function getAllPetitions({ status } = {}) {
  const where = status ? sql`WHERE status = ${status}` : sql.empty
  return sql`SELECT * FROM petitions ${where} ORDER BY created_at DESC`.all()
}

/** @type {Types.countPetitions} */
export function countPetitions({ status } = {}) {
  const where = status ? sql`WHERE status = ${status}` : sql.empty
  /** @type {Types.CountResult | undefined} */
  const result = sql`SELECT COUNT(*) as count FROM petitions ${where}`.get()
  return result ? result.count : 0
}

/** @type {Types.updatePetitionStatus} */
export function updatePetitionStatus(id, status, adminNotes = null) {
  const result = sql`UPDATE petitions
    SET status = ${status}, admin_notes = ${adminNotes}, reviewed_at = ${now()}
    WHERE id = ${id}`.run()
  return result.changes > 0
}

/** @type {Types.approvePetitionDb} */
export function approvePetitionDb(
  petitionId,
  { partySize = 1, adminNotes = null } = {},
) {
  return withTransaction(() => {
    const petition = getPetitionById(petitionId)
    if (!petition) {
      throw new Error("Petition not found")
    }
    if (petition.status !== PETITION_STATUS.PENDING) {
      throw new Error(`Petition already ${petition.status}`)
    }

    // Create guest from petition
    const invite_code = generateInviteCode()
    const guestResult =
      sql`INSERT INTO guests (name, email, phone, party_size, invite_code, notes)
      VALUES (${petition.name}, ${petition.email}, ${petition.phone}, ${partySize}, ${invite_code}, ${`From petition: ${petition.relationship || "No relationship specified"}`})`.run()

    // Update petition status
    sql`UPDATE petitions
      SET status = ${PETITION_STATUS.APPROVED}, admin_notes = ${adminNotes}, reviewed_at = ${now()}
      WHERE id = ${petitionId}`.run()

    return { id: guestResult.lastInsertRowid, invite_code }
  })
}
