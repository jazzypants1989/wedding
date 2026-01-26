/** @file Admin petition management endpoints */
/** @import * as Types from './types.js' */
import { withAdmin } from "../../core/auth.js"
import { isPetitionStatus } from "../../types.js"
import {
  withTransaction,
  normalizePhone,
  now,
  generateInviteCode,
} from "../../db/utils.js"
import { getGuestById, updateGuestInvitedAt } from "../guests/data.js"
import { logCommunication } from "../../db/utils.js"
import { addToBlocklist } from "./blocklist.js"
import { sendJson, parseBody } from "../../core/http.js"
import { ValidationError, NotFoundError } from "../../core/errors.js"
import { BASE_URL } from "../../types.js"
import {
  validateId,
  validatePartySize,
  validateOptionalString,
} from "../../core/validation.js"
import { LIMITS, PETITION_STATUS } from "../../types.js"
import { log, AUDIT_ACTIONS } from "../../core/log.js"
import { getClientIp } from "../../core/rate-limit.js"
import * as twilio from "../../services/twilio.js"
import * as email from "../../services/email.js"

import { getDb, queryOne, queryAll } from "../../db/connection.js"

/** @type {Types.listPetitions} */
async function listPetitions(req, res) {
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
async function approvePetitionHandler(req, res, { params, session }) {
  const idResult = validateId(params.id, "petition ID")
  if (!idResult.valid) {
    throw new ValidationError(idResult.error)
  }

  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    if (message === "Payload too large") {
      throw new ValidationError("Payload too large")
    }
    throw new ValidationError("Invalid JSON body")
  }

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
    const inviteUrl = `${BASE_URL}/rsvp.html?code=${guestResult.invite_code}`

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
async function denyPetitionHandler(req, res, { params, session }) {
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

  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    throw new ValidationError("Invalid JSON body")
  }

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

export const list = withAdmin(listPetitions)
export const approve = withAdmin(approvePetitionHandler)
export const deny = withAdmin(denyPetitionHandler)

/** @type {Types.createPetition} */
export function createPetition({ name, email, phone, relationship, message }) {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO petitions (name, email, phone, relationship, message)
    VALUES (?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    name,
    email.toLowerCase().trim(),
    normalizePhone(phone),
    relationship || null,
    message || null,
  )
  return result.lastInsertRowid
}

/** @type {Types.getPetitionById} */
export function getPetitionById(id) {
  return queryOne("SELECT * FROM petitions WHERE id = ?", id)
}

/** @type {Types.getPetitionByEmail} */
export function getPetitionByEmail(email) {
  return queryOne(
    "SELECT * FROM petitions WHERE email = ? AND status = 'pending'",
    email.toLowerCase().trim(),
  )
}

/** @type {Types.getAllPetitions} */
export function getAllPetitions({ status } = {}) {
  let sql = "SELECT * FROM petitions"
  /** @type {string[]} */
  const params = []

  if (status) {
    sql += " WHERE status = ?"
    params.push(status)
  }

  sql += " ORDER BY created_at DESC"

  return queryAll(sql, ...params)
}

/** @type {Types.countPetitions} */
export function countPetitions({ status } = {}) {
  let sql = "SELECT COUNT(*) as count FROM petitions"
  /** @type {string[]} */
  const params = []

  if (status) {
    sql += " WHERE status = ?"
    params.push(status)
  }

  /** @type {Types.CountResult | undefined} */
  const result = queryOne(sql, ...params)
  return result ? result.count : 0
}

/** @type {Types.updatePetitionStatus} */
export function updatePetitionStatus(id, status, adminNotes = null) {
  const db = getDb()
  const stmt = db.prepare(`
    UPDATE petitions
    SET status = ?, admin_notes = ?, reviewed_at = ?
    WHERE id = ?
  `)
  const result = stmt.run(status, adminNotes, now(), id)
  return result.changes > 0
}

/** @type {Types.approvePetitionDb} */
export function approvePetitionDb(
  petitionId,
  { partySize = 1, adminNotes = null } = {},
) {
  return withTransaction((db) => {
    const petition = getPetitionById(petitionId)
    if (!petition) {
      throw new Error("Petition not found")
    }
    if (petition.status !== PETITION_STATUS.PENDING) {
      throw new Error(`Petition already ${petition.status}`)
    }

    // Create guest from petition
    const invite_code = generateInviteCode()
    const createStmt = db.prepare(`
      INSERT INTO guests (name, email, phone, party_size, invite_code, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const guestResult = createStmt.run(
      petition.name,
      petition.email,
      petition.phone,
      partySize,
      invite_code,
      `From petition: ${petition.relationship || "No relationship specified"}`,
    )

    // Update petition status
    const updateStmt = db.prepare(`
      UPDATE petitions
      SET status = ?, admin_notes = ?, reviewed_at = ?
      WHERE id = ?
    `)
    updateStmt.run(PETITION_STATUS.APPROVED, adminNotes, now(), petitionId)

    return { id: guestResult.lastInsertRowid, invite_code }
  })
}
