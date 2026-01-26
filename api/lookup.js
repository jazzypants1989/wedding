/** @file Guest lookup and petition endpoints */
/** @import * as Types from './types.js' */

import { isBlocked } from "./admin/blocklist.js"
import {
  getGuestByEmail,
  getGuestByPhone,
  updateGuestInvitedAt,
} from "./guests/data.js"
import { searchGuestsByName, maskEmail, maskPhone } from "../db/utils.js"
import { logCommunication } from "../db/utils.js"
import { getPetitionByEmail, createPetition } from "./admin/petitions.js"
import { sendJson, parseBody, checkRateLimit } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import { BASE_URL, CONTACT_EMAIL } from "../types.js"
import {
  validateRequiredString,
  validateEmail,
  validatePhone,
  validateOptionalString,
} from "../core/validation.js"
import { LIMITS } from "../types.js"
import * as twilio from "../services/twilio.js"
import * as email from "../services/email.js"

/** @type {Types.notFoundResponse} */
function notFoundResponse(res) {
  return sendJson(res, 200, {
    found: false,
    canPetition: true,
    message:
      "We couldn't find you on our guest list. If you believe this is a mistake, you can request an invitation below.",
  })
}

/** @type {Types.lookup} */
export async function lookup(req, res) {
  const clientIp = getClientIp(req)
  if (checkRateLimit(res, limiters.lookup, clientIp)) return

  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: "Invalid JSON body" })
  }

  const { name, email: inputEmail, phone: inputPhone } = body

  const nameResult = validateRequiredString(
    name,
    "Name",
    LIMITS.NAME_MAX_LENGTH,
  )
  if (!nameResult.valid) {
    return sendJson(res, 400, { error: nameResult.error })
  }

  const emailResult = validateEmail(inputEmail)
  if (!emailResult.valid) {
    return sendJson(res, 400, { error: emailResult.error })
  }

  const phoneResult = validatePhone(inputPhone)
  if (!phoneResult.valid) {
    return sendJson(res, 400, { error: phoneResult.error })
  }

  if (!emailResult.value && !phoneResult.value) {
    return sendJson(res, 400, { error: "Email or phone is required" })
  }

  const blocked = isBlocked({
    name: nameResult.value,
    email: emailResult.value,
    phone: phoneResult.value,
  })
  if (blocked) {
    return notFoundResponse(res)
  }

  let guest = null
  let matchMethod = null

  if (emailResult.value) {
    guest = getGuestByEmail(emailResult.value)
    if (guest) matchMethod = "email"
  }

  if (!guest && phoneResult.value) {
    guest = getGuestByPhone(phoneResult.value)
    if (guest) matchMethod = "phone"
  }

  if (!guest) {
    const nameMatches = searchGuestsByName(nameResult.value)

    if (nameMatches.length === 1) {
      const match = nameMatches[0]
      if (match.email) {
        guest = match
        matchMethod = "email"
      } else if (match.phone) {
        guest = match
        matchMethod = "phone"
      }
    }
  }

  if (!guest) {
    return notFoundResponse(res)
  }

  const inviteUrl = `${BASE_URL}/rsvp.html?code=${guest.invite_code}`

  let sendResult
  let maskedContact = null

  if (matchMethod === "email" && guest.email) {
    maskedContact = maskEmail(guest.email)

    const emailData = email.getDefaultInviteEmail(guest.name, inviteUrl)
    sendResult = await email.sendEmail({
      to: guest.email,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    })

    if (sendResult.success) {
      logCommunication(guest.id, "email", "sent", emailData.text.slice(0, 100))
      updateGuestInvitedAt(guest.id)
    } else {
      logCommunication(guest.id, "email", "failed", null, sendResult.error)
    }
  } else if (guest.phone) {
    maskedContact = maskPhone(guest.phone)

    const message = twilio.getDefaultInviteMessage(guest.name, inviteUrl)
    sendResult = await twilio.sendSMS(guest.phone, message)

    if (sendResult.success) {
      logCommunication(guest.id, "sms", "sent", message.slice(0, 100))
      updateGuestInvitedAt(guest.id)
    } else {
      logCommunication(guest.id, "sms", "failed", null, sendResult.error)
    }
  } else {
    return sendJson(res, 500, { error: "Unable to send invitation" })
  }

  if (!sendResult.success) {
    return sendJson(res, 200, {
      found: true,
      sent: false,
      method: matchMethod,
      message: `We found you, but there was a problem sending your invite. Please contact us at ${CONTACT_EMAIL} for assistance.`,
    })
  }

  let successMessage
  if (maskedContact) {
    successMessage = `Found you! We've sent your invite link to ${maskedContact}. Didn't receive it? Contact us at ${CONTACT_EMAIL}.`
  } else {
    successMessage = `Found you! Check your ${
      matchMethod === "email" ? "email" : "phone"
    } for your invite link. Didn't receive it? Contact us at ${CONTACT_EMAIL}.`
  }

  return sendJson(res, 200, {
    found: true,
    sent: true,
    method: matchMethod,
    masked: maskedContact,
    message: successMessage,
  })
}

/** @type {Types.petition} */
export async function petition(req, res) {
  const clientIp = getClientIp(req)
  if (checkRateLimit(res, limiters.lookup, clientIp)) return

  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: "Invalid JSON body" })
  }

  const {
    name,
    email: inputEmail,
    phone: inputPhone,
    relationship,
    message: petitionMessage,
  } = body

  const nameResult = validateRequiredString(
    name,
    "Name",
    LIMITS.NAME_MAX_LENGTH,
  )
  if (!nameResult.valid) {
    return sendJson(res, 400, { error: nameResult.error })
  }

  const emailResult = validateEmail(inputEmail, { required: true })
  if (!emailResult.valid) {
    return sendJson(res, 400, { error: emailResult.error })
  }
  if (!emailResult.value) {
    return sendJson(res, 400, { error: "Email is required" })
  }
  const petitionEmail = emailResult.value

  const phoneResult = validatePhone(inputPhone)
  if (!phoneResult.valid) {
    return sendJson(res, 400, { error: phoneResult.error })
  }

  const relationshipResult = validateOptionalString(
    relationship,
    LIMITS.RELATIONSHIP_MAX_LENGTH,
  )
  const messageResult = validateOptionalString(
    petitionMessage,
    LIMITS.MESSAGE_MAX_LENGTH,
  )

  const blocked = isBlocked({
    name: nameResult.value,
    email: petitionEmail,
    phone: phoneResult.value,
  })
  if (blocked) {
    return sendJson(res, 403, { error: "Unable to process your request." })
  }

  const existingPetition = getPetitionByEmail(petitionEmail)
  if (existingPetition) {
    return sendJson(res, 409, {
      error: "You already have a pending request. We will review it soon!",
    })
  }

  createPetition({
    name: nameResult.value,
    email: petitionEmail,
    phone: phoneResult.value,
    relationship: relationshipResult.value,
    message: messageResult.value,
  })

  return sendJson(res, 201, {
    success: true,
    message:
      "Your request has been submitted! We'll review it and get back to you.",
  })
}
