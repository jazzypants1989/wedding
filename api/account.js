/** @file Guest account endpoints: register (claim / re-login / open signup), logout, me */
/** @import * as Types from './types.js' */

import { sendJson, parseBody, checkRateLimit } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import {
  parseCookies,
  createAccountSessionCookies,
  clearAccountSessionCookies,
  getOptionalAccount,
} from "../core/auth.js"
import {
  createAccountSession,
  deleteAccountSession,
} from "../db/account-sessions.js"
import {
  createAccount,
  findAccountByGuestAndName,
  getAccountById,
} from "../db/accounts.js"
import { getGuestByInviteCodeNoCase } from "./guests/data.js"
import { normalizeName } from "../db/utils.js"
import {
  validateRequiredString,
  validateOptionalString,
  validateEmail,
  validateInviteCode,
} from "../core/validation.js"
import { LIMITS, SERVER } from "../types.js"
import { log, AUDIT_ACTIONS } from "../core/utils.js"

/** @type {Types.publicAccount} */
export function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    relation: account.relation,
    trusted: account.trusted,
  }
}

/**
 * Issue a session for an account and respond with its public projection + cookies.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {import('../types.js').Account} account
 * @param {boolean} returning
 */
function respondWithSession(res, status, account, returning) {
  const session = createAccountSession(account.id)
  const isSecure = SERVER.baseUrl.startsWith("https")
  const cookies = createAccountSessionCookies(session, isSecure)
  return sendJson(
    res,
    status,
    { success: true, account: publicAccount(account), returning },
    { "Set-Cookie": cookies },
  )
}

/** @type {Types.register} */
export async function register(req, res) {
  const clientIp = getClientIp(req)
  // The registration endpoint is an invite-code oracle; the per-IP limit and the
  // generic 404 wording below are the load-bearing mitigations.
  if (checkRateLimit(res, limiters.accountRegister, clientIp)) return

  const body = await parseBody(req)
  const { code, name, relation, contact } = body

  const nameResult = validateRequiredString(
    name,
    "Name",
    LIMITS.ACCOUNT_NAME_MAX_LENGTH,
  )
  if (!nameResult.valid) return sendJson(res, 400, { error: nameResult.error })

  const relationResult = validateOptionalString(
    relation,
    LIMITS.RELATIONSHIP_MAX_LENGTH,
  )

  // contact is optional and exists solely to enable Phase 6 magic-link recovery.
  const contactResult = validateEmail(contact)
  if (!contactResult.valid) {
    return sendJson(res, 400, { error: contactResult.error })
  }

  const cleanName = nameResult.value
  const relationValue = relationResult.value
  const contactEmail = contactResult.value

  const hasCode = typeof code === "string" && code.trim().length > 0

  if (hasCode) {
    const codeResult = validateInviteCode(code)
    // A malformed code and a genuinely-unknown code get the SAME generic 404 and
    // the same audit reason — never distinguish wrong-code vs deleted-guest.
    const guest = codeResult.valid
      ? getGuestByInviteCodeNoCase(codeResult.value)
      : undefined
    if (!guest) {
      log({
        action: AUDIT_ACTIONS.ACCOUNT_REGISTER,
        ip: clientIp,
        details: { reason: "invalid_code" },
      })
      return sendJson(res, 404, { error: "Invite code not found" })
    }

    const existing = findAccountByGuestAndName(guest.id, normalizeName(cleanName))
    if (existing) {
      // Re-login: same household member re-registering with code + their name.
      log({
        action: AUDIT_ACTIONS.ACCOUNT_LOGIN,
        ip: clientIp,
        resourceType: "account",
        resourceId: existing.id,
      })
      return respondWithSession(res, 200, existing, true)
    }

    // New trusted account bound to the household guest record. Multiple family
    // members can each claim the one code under their own name.
    const account = createAccount({
      guestId: guest.id,
      name: cleanName,
      relation: relationValue,
      contactEmail,
      trusted: 1,
    })
    log({
      action: AUDIT_ACTIONS.ACCOUNT_REGISTER,
      ip: clientIp,
      resourceType: "account",
      resourceId: account.id,
    })
    return respondWithSession(res, 201, account, false)
  }

  // Open path: instant untrusted account, no dedupe (nothing to dedupe on).
  const account = createAccount({
    guestId: null,
    name: cleanName,
    relation: relationValue,
    contactEmail,
    trusted: 0,
  })
  log({
    action: AUDIT_ACTIONS.ACCOUNT_REGISTER,
    ip: clientIp,
    resourceType: "account",
    resourceId: account.id,
  })
  return respondWithSession(res, 201, account, false)
}

/** @type {Types.logout} */
export async function logout(req, res) {
  const cookies = parseCookies(req.headers.cookie)
  const sessionToken = cookies.guest_session

  if (sessionToken) {
    // Honor the session cookie but do NOT require CSRF — logging out is safe to
    // trigger and a stale CSRF token should never trap a guest in a signed-in UI.
    const session = getOptionalAccount(req)
    deleteAccountSession(sessionToken)
    log({
      action: AUDIT_ACTIONS.ACCOUNT_LOGOUT,
      resourceType: "account",
      resourceId: session ? session.account_id : undefined,
    })
  }

  return sendJson(
    res,
    200,
    { success: true },
    { "Set-Cookie": clearAccountSessionCookies() },
  )
}

/** @type {Types.me} */
export async function me(req, res) {
  const session = getOptionalAccount(req)
  if (!session) return sendJson(res, 200, { account: null })

  const account = getAccountById(session.account_id)
  return sendJson(res, 200, {
    account: account ? publicAccount(account) : null,
  })
}
