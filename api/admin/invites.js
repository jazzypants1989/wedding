/** @file Admin invite sending endpoints */
/** @import * as Types from './types.js' */

import { withAdmin } from "../../core/auth.js"
import { getGuestById, updateGuestInvitedAt } from "../guests/data.js"
import { logCommunication } from "../../db/utils.js"
import { sendJson, parseBody, checkRateLimit } from "../../core/http.js"
import { ValidationError } from "../../core/errors.js"
import { limiters, getClientIp } from "../../core/rate-limit.js"
import { BASE_URL } from "../../types.js"
import {
  validateIdArray,
  validateCommunicationType,
  validateServiceConfigured,
} from "../../core/validation.js"
import { log, AUDIT_ACTIONS } from "../../core/log.js"
import { formatTemplate } from "../../services/templates.js"
import * as twilio from "../../services/twilio.js"
import * as email from "../../services/email.js"

/** @type {Types.configHandler} */
async function configHandler(req, res) {
  return sendJson(res, 200, {
    sms: {
      configured: twilio.isConfigured(),
      defaultMessage: twilio.getDefaultInviteMessage("{name}", "{url}"),
    },
    email: {
      configured: email.isConfigured(),
      defaultMessage: email.getDefaultInviteEmail("{name}", "{url}"),
    },
  })
}

/** @type {Types.previewHandler} */
async function previewHandler(req, res) {
  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    throw new ValidationError("Invalid JSON body")
  }

  const { guestIds, type, customMessage } = body

  // Validate guest IDs array
  const idsResult = validateIdArray(guestIds, "guestIds")
  if (!idsResult.valid) {
    throw new ValidationError(idsResult.error)
  }

  // Validate communication type
  const typeResult = validateCommunicationType(type)
  if (!typeResult.valid) {
    throw new ValidationError(typeResult.error)
  }

  const serviceResult = validateServiceConfigured(typeResult.value)
  if (!serviceResult.valid) {
    throw new ValidationError(serviceResult.error ?? "Service not configured")
  }

  /** @type {Types.PreviewRecipient[]} */
  const recipients = []
  /** @type {Types.PreviewSkipped[]} */
  const skipped = []

  const commType = typeResult.value
  const template = typeof customMessage === "string" ? customMessage : null

  for (const id of idsResult.value) {
    const guest = getGuestById(id)
    if (!guest) {
      skipped.push({ id, reason: "Guest not found" })
      continue
    }

    if (commType === "sms" && !guest.phone) {
      skipped.push({ id, name: guest.name, reason: "No phone number" })
      continue
    }

    if (commType === "email" && !guest.email) {
      skipped.push({ id, name: guest.name, reason: "No email address" })
      continue
    }

    const inviteUrl = `${BASE_URL}/rsvp.html?code=${guest.invite_code}`
    let messagePreview

    if (commType === "sms") {
      messagePreview = template
        ? formatTemplate(template, { name: guest.name, url: inviteUrl })
        : twilio.getDefaultInviteMessage(guest.name, inviteUrl)
    } else {
      const emailData = template
        ? {
            subject: "You're Invited!",
            text: formatTemplate(template, {
              name: guest.name,
              url: inviteUrl,
            }),
          }
        : email.getDefaultInviteEmail(guest.name, inviteUrl)
      messagePreview = emailData.text
    }

    recipients.push({
      id: guest.id,
      name: guest.name,
      contact: commType === "sms" ? guest.phone : guest.email,
      messagePreview: messagePreview.slice(0, 200),
    })
  }

  return sendJson(res, 200, {
    type: commType,
    recipients,
    skipped,
    totalToSend: recipients.length,
  })
}

/** @type {Types.sendHandler} */
async function sendHandler(req, res, { session }) {
  // Rate limit: 100 messages per hour
  if (checkRateLimit(res, limiters.adminInvite, session.token)) return

  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    throw new ValidationError("Invalid JSON body")
  }

  const { guestIds, type, customMessage } = body

  const idsResult = validateIdArray(guestIds, "guestIds")
  if (!idsResult.valid) {
    throw new ValidationError(idsResult.error)
  }

  const typeResult = validateCommunicationType(type)
  if (!typeResult.valid) {
    throw new ValidationError(typeResult.error)
  }

  const serviceResult = validateServiceConfigured(typeResult.value)
  if (!serviceResult.valid) {
    throw new ValidationError(serviceResult.error ?? "Service not configured")
  }

  const commType = typeResult.value
  const template = typeof customMessage === "string" ? customMessage : null

  /** @type {Types.SendResults} */
  const results = { sent: [], failed: [], skipped: [] }

  for (const id of idsResult.value) {
    const guest = getGuestById(id)
    if (!guest) {
      results.skipped.push({ id, reason: "Guest not found" })
      continue
    }

    const inviteUrl = `${BASE_URL}/rsvp.html?code=${guest.invite_code}`
    let sendResult
    let messagePreview

    if (commType === "sms") {
      if (!guest.phone) {
        results.skipped.push({
          id,
          name: guest.name,
          reason: "No phone number",
        })
        continue
      }

      const message = template
        ? formatTemplate(template, { name: guest.name, url: inviteUrl })
        : twilio.getDefaultInviteMessage(guest.name, inviteUrl)

      messagePreview = message.slice(0, 100)
      sendResult = await twilio.sendSMS(guest.phone, message)
    } else {
      if (!guest.email) {
        results.skipped.push({
          id,
          name: guest.name,
          reason: "No email address",
        })
        continue
      }

      const emailData = template
        ? {
            subject: "You're Invited! Jesse & Jordana's Wedding",
            text: formatTemplate(template, {
              name: guest.name,
              url: inviteUrl,
            }),
            html: undefined,
          }
        : email.getDefaultInviteEmail(guest.name, inviteUrl)

      messagePreview = emailData.text.slice(0, 100)
      sendResult = await email.sendEmail({
        to: guest.email,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      })
    }

    // Log communication
    logCommunication(
      guest.id,
      commType,
      sendResult.success ? "sent" : "failed",
      messagePreview,
      sendResult.error ?? null,
    )

    if (sendResult.success) {
      updateGuestInvitedAt(guest.id)
      results.sent.push({ id: guest.id, name: guest.name })
    } else {
      results.failed.push({
        id: guest.id,
        name: guest.name,
        error: sendResult.error,
      })
    }
  }

  if (results.sent.length > 0) {
    log({
      action: AUDIT_ACTIONS.INVITE_SEND,
      adminId: session?.token,
      ip: getClientIp(req),
      details: {
        type: commType,
        sent: results.sent.length,
        failed: results.failed.length,
        guestIds: results.sent.map((r) => r.id),
      },
    })
  }

  return sendJson(res, 200, {
    success: true,
    results,
    summary: {
      sent: results.sent.length,
      failed: results.failed.length,
      skipped: results.skipped.length,
    },
  })
}

export const config = withAdmin(configHandler)
export const preview = withAdmin(previewHandler)
export const send = withAdmin(sendHandler)
