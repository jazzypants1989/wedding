/** @file Guest lookup and petition endpoints */
/** @import * as Types from './types.js' */

import { isBlocked } from "./admin/blocklist.js"
import {
  getGuestByEmail,
  getGuestByPhone,
  updateGuestInvitedAt,
} from "./guests/data.js"
import { searchGuestsByName } from "../db/utils.js"
import {
  getPetitionByEmail,
  getLatestPetitionByEmail,
  createPetition,
} from "./admin/petitions.js"
import { sendJson, parseBody, checkRateLimit } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import {
  validateRequiredString,
  validateEmail,
  validatePhone,
  validateOptionalString,
} from "../core/validation.js"
import { LIMITS, FEATURES } from "../types.js"
import { log, AUDIT_ACTIONS } from "../core/utils.js"

/** @type {Types.notFoundResponse} */
function notFoundResponse(res, petitionStatus = null) {
  return sendJson(res, 200, {
    found: false,
    canPetition: true,
    // Lets a returning petitioner see the truth (pending/denied/none) instead of
    // a client-side flag that only ever cleared on a successful invite load.
    petitionStatus,
    message:
      "We couldn't find you on our guest list. If you believe this is a mistake, you can request an invitation below.",
  })
}

/** @type {Types.lookup} */
export async function lookup(req, res) {
  const clientIp = getClientIp(req)
  if (checkRateLimit(res, limiters.lookup, clientIp)) return

  const body = await parseBody(req)

  const { name, email: inputEmail, phone: inputPhone } = body

  const nameResult = FEATURES.ENABLE_NAME_LOOKUP
    ? validateRequiredString(name, "Name", LIMITS.NAME_MAX_LENGTH)
    : validateOptionalString(name, LIMITS.NAME_MAX_LENGTH)
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
    name: nameResult.value || "",
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

  if (!guest && FEATURES.ENABLE_NAME_LOOKUP && nameResult.value) {
    const nameMatches = searchGuestsByName(nameResult.value)

    if (nameMatches.length === 1) {
      const match = nameMatches[0]

      // Verify caller's contact info matches the found guest
      let contactVerified = false

      if (emailResult.value && match.email) {
        contactVerified =
          emailResult.value.toLowerCase() === match.email.toLowerCase()
      }

      if (!contactVerified && phoneResult.value && match.phone) {
        contactVerified = phoneResult.value === match.phone
      }

      if (contactVerified) {
        guest = match
        matchMethod = "name"
      }
    }
  }

  if (!guest) {
    // Surface any prior petition's status so a returning guest sees accurate
    // copy (a denied petitioner isn't stuck on "still under review", and can
    // re-file). Petitions are keyed by email.
    const priorPetition = emailResult.value
      ? getLatestPetitionByEmail(emailResult.value)
      : null
    return notFoundResponse(res, priorPetition ? priorPetition.status : null)
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
  // Own bucket (not limiters.lookup): failed lookups precede most petitions,
  // and sharing the 3/min budget used to 429 guests mid-petition.
  if (checkRateLimit(res, limiters.petition, clientIp)) return

  const body = await parseBody(req)

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
    return notFoundResponse(res)
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

  log({
    action: AUDIT_ACTIONS.PETITION_CREATE,
    ip: clientIp,
    details: { email: petitionEmail },
  })

  return sendJson(res, 201, {
    success: true,
    message:
      "Your request has been submitted! We'll review it and get back to you.",
  })
}
