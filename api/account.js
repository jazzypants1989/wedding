/** @file Guest account endpoints: register (claim / re-login / open signup),
 *  logout, me, and magic-link recovery (Phase 6). */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
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
  findAccountByContactEmail,
  getAccountById,
} from "../db/accounts.js"
import { hashToken } from "../db/sessions.js"
import {
  createRecoveryToken,
  consumeRecoveryToken,
} from "../db/account-recovery.js"
import { getGuestByInviteCodeNoCase } from "./guests/data.js"
import { normalizeName } from "../db/utils.js"
import {
  validateRequiredString,
  validateOptionalString,
  validateEmail,
  validateInviteCode,
} from "../core/validation.js"
import { LIMITS, SERVER, WEDDING } from "../types.js"
import { log, AUDIT_ACTIONS, escapeHtml } from "../core/utils.js"
import { sendEmail } from "../services/email.js"

// A recovery link is valid for one hour and single-use (consumeRecoveryToken
// enforces both). Only the SHA-256 hash is stored; the plaintext lives in the
// emailed URL alone.
const RECOVERY_TOKEN_TTL_MS = 60 * 60 * 1000

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

/**
 * Compose the recovery email. Kept inline (not in services/email.js) because it
 * is the only caller and needs no template config.
 * @param {string} link @returns {{ subject: string, text: string, html: string }}
 */
function recoveryEmail(link) {
  const subject = `Your ${WEDDING.COUPLE_NAMES} wedding site sign-in link`
  const text = `Hello!

Use this link to sign back in to the ${WEDDING.COUPLE_NAMES} wedding site:

${link}

This link works once and expires in one hour. If you didn't request it, you can ignore this email.`
  const html = `<!DOCTYPE html>
<html><body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p>Hello!</p>
  <p>Use this link to sign back in to the ${escapeHtml(WEDDING.COUPLE_NAMES)} wedding site:</p>
  <p><a href="${escapeHtml(link)}">Sign back in</a></p>
  <p>This link works once and expires in one hour. If you didn't request it, you can ignore this email.</p>
</body></html>`
  return { subject, text, html }
}

/** @type {Types.recover} */
export async function recover(req, res) {
  const clientIp = getClientIp(req)
  if (checkRateLimit(res, limiters.accountRecover, clientIp)) return

  const body = await parseBody(req)
  const account = findAccountByContactEmail(
    typeof body.email === "string" ? body.email : null,
  )

  // Always respond 200 with the same copy — never reveal whether the address
  // maps to an account (the rate limiter is the load-bearing anti-enumeration
  // control, mirroring register()). Only mint + email when an account exists.
  if (account) {
    const token = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_TTL_MS).toISOString()
    createRecoveryToken(account.id, hashToken(token), expiresAt)

    const link = `${SERVER.baseUrl}/api/account/recover/${token}`
    // Fire-and-forget: the response must not block on (or reveal) delivery.
    sendEmail({ to: account.contact_email ?? "", ...recoveryEmail(link) }).catch(
      () => {},
    )

    log({
      action: AUDIT_ACTIONS.ACCOUNT_RECOVER_REQUEST,
      ip: clientIp,
      resourceType: "account",
      resourceId: account.id,
    })
  } else {
    log({
      action: AUDIT_ACTIONS.ACCOUNT_RECOVER_REQUEST,
      ip: clientIp,
      details: { found: false },
    })
  }

  return sendJson(res, 200, {
    success: true,
    message: "If that email is on file, a sign-in link is on its way.",
  })
}

/** @type {Types.recoverConsume} */
export async function recoverConsume(req, res, { params }) {
  const token = params.token
  const accountId =
    typeof token === "string" && token.length > 0
      ? consumeRecoveryToken(hashToken(token))
      : null

  // Unknown / already-used / expired → 4xx (single-use is enforced atomically in
  // consumeRecoveryToken). Also reject if the account was deleted after minting.
  const account = accountId !== null ? getAccountById(accountId) : undefined
  if (!account) {
    return sendJson(res, 400, {
      error: "This sign-in link is invalid or has expired. Please request a new one.",
      code: "INVALID_TOKEN",
    })
  }

  const session = createAccountSession(account.id)
  const isSecure = SERVER.baseUrl.startsWith("https")
  const cookies = createAccountSessionCookies(session, isSecure)

  log({
    action: AUDIT_ACTIONS.ACCOUNT_RECOVER_LOGIN,
    ip: getClientIp(req),
    resourceType: "account",
    resourceId: account.id,
  })

  // Browser-follow: set the guest cookies and redirect into the app.
  res.writeHead(302, { Location: "/guestbook", "Set-Cookie": cookies })
  res.end()
}
