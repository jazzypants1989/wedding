/** @file Admin invite sending endpoints */
/** @import * as Types from './types.js' */

import { getGuestById, updateGuestInvitedAt } from "../guests/data.js"
import { logCommunication } from "../../db/utils.js"
import { sendJson, parseBody, checkRateLimit } from "../../core/http.js"
import { limiters, getClientIp } from "../../core/rate-limit.js"
import { SERVER } from "../../types.js"
import { getEmailSubjects } from "../../core/wedding-facts.js"
import {
  ValidationError,
  validateIdArray,
  validateCommunicationType,
  validateServiceConfigured,
} from "../../core/validation.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { formatTemplate } from "../../services/templates.js"
import * as twilio from "../../services/twilio.js"
import * as email from "../../services/email.js"

/** @type {Types.configHandler} */
export async function config(req, res) {
  return sendJson(res, 200, {
    sms: {
      configured: twilio.isConfigured(),
      defaultMessage: twilio.getDefaultInviteMessage("{name}", "{url}"),
    },
    email: {
      configured: email.isConfigured(),
      // The plain-text body (getDefaultInviteEmail returns { subject, text, ... });
      // the composer shows this as the "leave blank" default.
      defaultMessage: email.getDefaultInviteEmail("{name}", "{url}").text,
    },
  })
}

/** @type {Types.previewHandler} */
export async function preview(req, res) {
  const body = await parseBody(req)

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

    const inviteUrl = `${SERVER.baseUrl}/rsvp?code=${guest.invite_code}`
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
      // Append the ellipsis only when actually truncated, so a short message
      // isn't shown with a misleading "…".
      messagePreview:
        messagePreview.length > 200 ? messagePreview.slice(0, 200) + "…" : messagePreview,
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
export async function send(req, res, { session }) {
  // Rate limit: 100 messages per hour
  if (checkRateLimit(res, limiters.adminInvite, session.token)) return

  const body = await parseBody(req)

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

    const inviteUrl = `${SERVER.baseUrl}/rsvp?code=${guest.invite_code}`
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
            subject: getEmailSubjects().invite,
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

    if (sendResult.success) {
      logCommunication(guest.id, commType, "sent", messagePreview, null)
      updateGuestInvitedAt(guest.id)
      results.sent.push({ id: guest.id, name: guest.name })
    } else {
      logCommunication(
        guest.id,
        commType,
        "failed",
        messagePreview,
        sendResult.error,
      )
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
