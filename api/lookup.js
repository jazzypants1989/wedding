/** @file Guest lookup and petition endpoints */
/** @import * as Types from './types.js' */

import { isBlocked } from "./admin/blocklist.js"
import {
  getGuestByEmail,
  getGuestByPhone,
  updateGuestInvitedAt,
} from "./guests/data.js"
import { searchGuestsByName } from "../db/utils.js"
import { getPetitionByEmail, createPetition } from "./admin/petitions.js"
import { sendJson, parseBody, checkRateLimit } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import {
  validateRequiredString,
  validateEmail,
  validatePhone,
  validateOptionalString,
} from "../core/validation.js"
import { LIMITS } from "../types.js"

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

  updateGuestInvitedAt(guest.id)

  return sendJson(res, 200, {
    found: true,
    redirectCode: guest.invite_code,
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
