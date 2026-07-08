/** @file Admin account-management endpoints (Phase 6): list accounts with their
 *  content counts + household source, and the trust / untrust / soft-delete
 *  lifecycle. Trust flips future inserts to auto-approve; `approve_pending`
 *  releases the existing backlog; delete pulls the account's live content
 *  offline and kills its sessions. All routes are {admin:true}. */
/** @import * as Types from './types.js' */

import { sendJson, parseBody } from "../../core/http.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import { validateId, ValidationError, NotFoundError } from "../../core/validation.js"
import { PAGINATION } from "../../types.js"
import { withTransaction } from "../../db/utils.js"
import {
  listAccounts,
  countAccounts,
  setAccountTrusted,
  softDeleteAccount,
} from "../../db/accounts.js"
import {
  approvePendingForAccount,
  hideApprovedContentForAccount,
} from "../../db/moderation.js"
import { deleteAccountSessionsForAccount } from "../../db/account-sessions.js"

/**
 * Parse the optional `trusted` filter: "1"/"true" → trusted only, "0"/"false" →
 * untrusted only, absent/anything else → both.
 * @param {string | null} value @returns {boolean | null}
 */
function parseTrusted(value) {
  if (value === "1" || value === "true") return true
  if (value === "0" || value === "false") return false
  return null
}

/** @type {Types.accountsListHandler} */
export async function list(req, res) {
  const urlObj = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const trusted = parseTrusted(urlObj.searchParams.get("trusted"))

  const limitParam = urlObj.searchParams.get("limit")
  const offsetParam = urlObj.searchParams.get("offset")
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : PAGINATION.DEFAULT_PAGE_SIZE
  const limit =
    Number.isNaN(parsedLimit) || parsedLimit < 1
      ? PAGINATION.DEFAULT_PAGE_SIZE
      : Math.min(parsedLimit, PAGINATION.MAX_PAGE_SIZE)
  const parsedOffset = offsetParam ? parseInt(offsetParam, 10) : 0
  const offset = Number.isNaN(parsedOffset) || parsedOffset < 0 ? 0 : parsedOffset

  const accounts = listAccounts({ trusted, limit, offset }).map((a) => ({
    id: a.id,
    name: a.name,
    relation: a.relation,
    trusted: !!a.trusted,
    source: a.guest_name ?? "open registration",
    guest_id: a.guest_id,
    contact_email: a.contact_email,
    post_count: a.post_count,
    created_at: a.created_at,
  }))
  const total = countAccounts({ trusted })

  return sendJson(res, 200, { accounts, total })
}

/** @type {Types.accountTrustHandler} */
export async function trust(req, res, { params, session }) {
  const idResult = validateId(params.id, "account ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const body = await parseBody(req).catch(
    () => /** @type {Record<string, unknown>} */ ({}),
  )
  const approvePending = body.approve_pending === true

  const outcome = withTransaction(() => {
    const changed = setAccountTrusted(idResult.value, true)
    if (!changed) return null
    const released = approvePending ? approvePendingForAccount(idResult.value) : 0
    return { released }
  })
  if (!outcome) throw new NotFoundError("Account")

  log({
    action: AUDIT_ACTIONS.ACCOUNT_TRUST,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "account",
    resourceId: idResult.value,
    details: outcome.released ? { released: outcome.released } : undefined,
  })

  return sendJson(res, 200, { success: true, released: outcome.released })
}

/** @type {Types.accountUntrustHandler} */
export async function untrust(req, res, { params, session }) {
  const idResult = validateId(params.id, "account ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  // Future-only: existing approved content stays live; only the auto-approve
  // decision at the next insert flips back to held-for-review.
  const changed = setAccountTrusted(idResult.value, false)
  if (!changed) throw new NotFoundError("Account")

  log({
    action: AUDIT_ACTIONS.ACCOUNT_UNTRUST,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "account",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true })
}

/** @type {Types.accountDeleteHandler} */
export async function remove(req, res, { params, session }) {
  const idResult = validateId(params.id, "account ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const outcome = withTransaction(() => {
    const changed = softDeleteAccount(idResult.value)
    if (!changed) return null
    // Pull their live content offline (reversible — files kept) and drop every
    // session so the account can't act while soft-deleted.
    const hidden = hideApprovedContentForAccount(idResult.value)
    deleteAccountSessionsForAccount(idResult.value)
    return { hidden }
  })
  if (!outcome) throw new NotFoundError("Account")

  log({
    action: AUDIT_ACTIONS.ACCOUNT_DELETE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "account",
    resourceId: idResult.value,
    details: outcome.hidden ? { hidden: outcome.hidden } : undefined,
  })

  return sendJson(res, 200, { success: true, hidden: outcome.hidden })
}
