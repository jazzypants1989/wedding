/** @file Admin guestbook management: pin/unpin a note for the public "Favorites"
 *  strip (Wow pack, Feature 2). Deliberately separate from the moderation queue —
 *  pinning curates already-approved notes rather than reviewing pending ones. */
/** @import * as Types from './types.js' */

import { sendJson } from "../../core/http.js"
import { getClientIp } from "../../core/rate-limit.js"
import { validateId, ValidationError, ConflictError } from "../../core/validation.js"
import { setGuestbookPinned } from "../../db/guestbook-entries.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"

/**
 * Shared body for pin/unpin: flip the entry's pinned_at and audit it. A no-op
 * (already in the target state, not approved, or missing) is a 409.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('../../core/types.js').AuthenticatedRouteInfo} routeInfo
 * @param {boolean} pinned
 */
async function setPinned(req, res, { params, session }, pinned) {
  const idResult = validateId(params.id, "entry ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const changed = setGuestbookPinned(idResult.value, pinned)
  if (!changed) {
    throw new ConflictError(
      pinned
        ? "Cannot pin this entry — it no longer exists, isn't approved, or is already pinned"
        : "Cannot unpin this entry — it no longer exists or isn't pinned",
    )
  }

  log({
    action: pinned ? AUDIT_ACTIONS.GUESTBOOK_PIN : AUDIT_ACTIONS.GUESTBOOK_UNPIN,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "guestbook_entry",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true, pinned })
}

/** @type {Types.ParamsHandler} */
export async function pin(req, res, routeInfo) {
  return setPinned(req, res, routeInfo, true)
}

/** @type {Types.ParamsHandler} */
export async function unpin(req, res, routeInfo) {
  return setPinned(req, res, routeInfo, false)
}
