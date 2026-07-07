/** @file Admin moderation endpoints (guestbook-only in Phase 2; Phase 6 expands) */
/** @import * as Types from './types.js' */

import { sendJson } from "../../core/http.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import {
  validateId,
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../core/validation.js"
import { PAGINATION, CONTENT_STATUS } from "../../types.js"
import {
  getGuestbookModerationQueue,
  getModerationCounts,
  setGuestbookStatus,
} from "../../db/guestbook-entries.js"

/**
 * Fixed allowlist of moderatable content types. The `:type` route param is only
 * ever used to look up an entry here — it NEVER touches SQL — so no allowlisted
 * value can inject. Phases 3/5/6 add `media` and `comments` entries in place.
 */
const MODERATABLE = Object.freeze({
  guestbook: {
    /** pending|hidden → approved */
    approve: (/** @type {number} */ id) =>
      setGuestbookStatus(
        id,
        [CONTENT_STATUS.PENDING, CONTENT_STATUS.HIDDEN],
        CONTENT_STATUS.APPROVED,
      ),
    /** pending → rejected */
    reject: (/** @type {number} */ id) =>
      setGuestbookStatus(id, [CONTENT_STATUS.PENDING], CONTENT_STATUS.REJECTED),
    /** approved → hidden */
    hide: (/** @type {number} */ id) =>
      setGuestbookStatus(id, [CONTENT_STATUS.APPROVED], CONTENT_STATUS.HIDDEN),
    queue: getGuestbookModerationQueue,
  },
})

/**
 * @param {string} type
 * @returns {(typeof MODERATABLE)['guestbook']}
 */
function resolveType(type) {
  if (Object.prototype.hasOwnProperty.call(MODERATABLE, type)) {
    return MODERATABLE[/** @type {'guestbook'} */ (type)]
  }
  throw new NotFoundError("Moderation type")
}

/** @type {Types.moderationQueueHandler} */
export async function queue(req, res) {
  const urlObj = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const type = urlObj.searchParams.get("type") ?? "guestbook"
  const target = resolveType(type)

  const limitParam = urlObj.searchParams.get("limit")
  const offsetParam = urlObj.searchParams.get("offset")
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : PAGINATION.DEFAULT_PAGE_SIZE
  const limit =
    Number.isNaN(parsedLimit) || parsedLimit < 1
      ? PAGINATION.DEFAULT_PAGE_SIZE
      : Math.min(parsedLimit, PAGINATION.MAX_PAGE_SIZE)
  const parsedOffset = offsetParam ? parseInt(offsetParam, 10) : 0
  const offset = Number.isNaN(parsedOffset) || parsedOffset < 0 ? 0 : parsedOffset

  const rows = target.queue({ limit, offset })
  const items = rows.map((row) => ({
    id: row.id,
    message: row.message,
    author_name: row.author_name,
    author_trusted: !!row.author_trusted,
    status: row.status,
    created_at: row.created_at,
  }))

  return sendJson(res, 200, { items, type })
}

/** @type {Types.moderationCountsHandler} */
export async function counts(req, res) {
  return sendJson(res, 200, getModerationCounts())
}

/**
 * Shared body for approve/reject/hide: validate type + id, apply the transition,
 * audit. A no-op transition (missing row or wrong current state) is a 409.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('../../core/types.js').AuthenticatedRouteInfo} routeInfo
 * @param {'approve' | 'reject' | 'hide'} action
 * @param {string} auditAction
 */
async function moderate(req, res, { params, session }, action, auditAction) {
  const target = resolveType(params.type)
  const idResult = validateId(params.id, "entry ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const changed = target[action](idResult.value)
  if (!changed) {
    throw new ConflictError(
      `Cannot ${action} this item — it no longer exists or is not in a valid state`,
    )
  }

  log({
    action: auditAction,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: params.type,
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true })
}

/** @type {Types.ParamsHandler} */
export async function approve(req, res, routeInfo) {
  return moderate(req, res, routeInfo, "approve", AUDIT_ACTIONS.MODERATION_APPROVE)
}

/** @type {Types.ParamsHandler} */
export async function reject(req, res, routeInfo) {
  return moderate(req, res, routeInfo, "reject", AUDIT_ACTIONS.MODERATION_REJECT)
}

/** @type {Types.ParamsHandler} */
export async function hide(req, res, routeInfo) {
  return moderate(req, res, routeInfo, "hide", AUDIT_ACTIONS.MODERATION_HIDE)
}
