/** @file Admin moderation endpoints. Phase 6 grows the Phase 2 guestbook-only
 *  version into the full combined queue (guestbook + media + comments), bulk
 *  actions, auto-trust on approval, and terminal-state file cleanup. */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../types.js' */

import fs from "node:fs"
import { sendJson, parseBody, sanitize } from "../../core/http.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import {
  validateId,
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../core/validation.js"
import { itemDir } from "../../core/media-storage.js"
import { PAGINATION, CONTENT_STATUS, CONTENT_STATUS_VALUES } from "../../types.js"
import { withTransaction } from "../../db/utils.js"
import {
  getGuestbookEntryById,
  setGuestbookStatus,
  getModerationCounts,
} from "../../db/guestbook-entries.js"
import { getCommentById, setCommentStatus } from "../../db/comments.js"
import { getMediaById, setMediaStatus } from "../../db/media.js"
import { getModerationQueue, approvePendingForAccount } from "../../db/moderation.js"
import { getAccountById, setAccountTrusted } from "../../db/accounts.js"

/**
 * The minimal row shape every moderatable type exposes for the shared transition
 * logic: the author account (for auto-trust), the current status (to pick the
 * approve-vs-unhide audit action), and — media only — the file_key (reject
 * unlinks its variant files).
 * @typedef {{ account_id: number | null, status: string, file_key?: string | null }} ModeratableRow
 */

/**
 * Fixed allowlist of moderatable content types. The `:type` route param is only
 * ever used to look up an entry here — it NEVER touches SQL — so no allowlisted
 * value can inject. Each entry maps the three transitions plus a row fetch;
 * `unlink` marks the type whose reject removes files from disk (media, 03 §6).
 */
const MODERATABLE = Object.freeze({
  guestbook: {
    /** @type {(id: number) => ModeratableRow | undefined} */
    getRow: getGuestbookEntryById,
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
    unlink: false,
  },
  comment: {
    /** @type {(id: number) => ModeratableRow | undefined} */
    getRow: getCommentById,
    approve: (/** @type {number} */ id) =>
      setCommentStatus(
        id,
        [CONTENT_STATUS.PENDING, CONTENT_STATUS.HIDDEN],
        CONTENT_STATUS.APPROVED,
      ),
    reject: (/** @type {number} */ id) =>
      setCommentStatus(id, [CONTENT_STATUS.PENDING], CONTENT_STATUS.REJECTED),
    hide: (/** @type {number} */ id) =>
      setCommentStatus(id, [CONTENT_STATUS.APPROVED], CONTENT_STATUS.HIDDEN),
    unlink: false,
  },
  media: {
    /** @type {(id: number) => ModeratableRow | undefined} */
    getRow: getMediaById,
    approve: (/** @type {number} */ id) =>
      setMediaStatus(
        id,
        [CONTENT_STATUS.PENDING, CONTENT_STATUS.HIDDEN],
        CONTENT_STATUS.APPROVED,
      ),
    reject: (/** @type {number} */ id) =>
      setMediaStatus(id, [CONTENT_STATUS.PENDING], CONTENT_STATUS.REJECTED),
    hide: (/** @type {number} */ id) =>
      setMediaStatus(id, [CONTENT_STATUS.APPROVED], CONTENT_STATUS.HIDDEN),
    unlink: true,
  },
})

/** @typedef {keyof typeof MODERATABLE} ModeratableType */

/**
 * @param {string} type
 * @returns {(typeof MODERATABLE)['guestbook']}
 */
function resolveType(type) {
  if (Object.prototype.hasOwnProperty.call(MODERATABLE, type)) {
    return MODERATABLE[/** @type {ModeratableType} */ (type)]
  }
  throw new NotFoundError("Moderation type")
}

/** @param {string} type @returns {type is ModeratableType} */
function isModeratableType(type) {
  return Object.prototype.hasOwnProperty.call(MODERATABLE, type)
}

/**
 * Clamp a raw ?limit / ?offset pair to safe pagination bounds.
 * @param {string | null} limitParam @param {string | null} offsetParam
 */
function parsePaging(limitParam, offsetParam) {
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : PAGINATION.DEFAULT_PAGE_SIZE
  const limit =
    Number.isNaN(parsedLimit) || parsedLimit < 1
      ? PAGINATION.DEFAULT_PAGE_SIZE
      : Math.min(parsedLimit, PAGINATION.MAX_PAGE_SIZE)
  const parsedOffset = offsetParam ? parseInt(offsetParam, 10) : 0
  const offset = Number.isNaN(parsedOffset) || parsedOffset < 0 ? 0 : parsedOffset
  return { limit, offset }
}

/** @type {Types.moderationQueueHandler} */
export async function queue(req, res) {
  const urlObj = new URL(req.url ?? "/", `http://${req.headers.host}`)

  const typeParam = urlObj.searchParams.get("type")
  // An unknown type is a 404 (same guard as the action routes); absent = all.
  const type = typeParam ? (isModeratableType(typeParam) ? typeParam : null) : null
  if (typeParam && type === null) throw new NotFoundError("Moderation type")

  const statusParam = urlObj.searchParams.get("status")
  const status =
    statusParam && CONTENT_STATUS_VALUES.includes(/** @type {GlobalTypes.ContentStatus} */ (statusParam))
      ? statusParam
      : CONTENT_STATUS.PENDING

  const accountParam = urlObj.searchParams.get("account_id")
  const parsedAccount = accountParam ? parseInt(accountParam, 10) : NaN
  const accountId = Number.isInteger(parsedAccount) && parsedAccount > 0 ? parsedAccount : null

  const { limit, offset } = parsePaging(
    urlObj.searchParams.get("limit"),
    urlObj.searchParams.get("offset"),
  )

  // Fetch one extra row to tell the client whether another offset page exists,
  // without a second COUNT query (the accounts list returns `total`; the queue
  // is a UNION ALL where a plain count is comparatively costly).
  const rows = getModerationQueue({ type, status, accountId, limit: limit + 1, offset })
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map((row) => ({
    content_type: row.content_type,
    id: row.id,
    account_id: row.account_id,
    author_name: row.author_name,
    author_relation: row.relation,
    author_trusted: row.author_trusted === null ? null : !!row.author_trusted,
    status: row.status,
    created_at: row.created_at,
    message: row.message,
    target_type: row.target_type,
    target_id: row.target_id,
    file_key: row.file_key,
    kind: row.kind,
    caption: row.caption,
    needs_display: row.needs_display === null ? null : !!row.needs_display,
  }))

  return sendJson(res, 200, { items, type, status, hasMore })
}

/** @type {Types.moderationCountsHandler} */
export async function counts(req, res) {
  return sendJson(res, 200, getModerationCounts())
}

/**
 * Apply one transition to one item inside an open transaction: flip its status
 * and, when approving an untrusted author, promote that account (auto-trust,
 * owner decision 2026-07-06). Returns null when the row is missing or not in a
 * legal state for the action (caller turns that into a 409), otherwise the
 * facts the caller needs for auditing + post-commit file cleanup.
 * @param {(typeof MODERATABLE)['guestbook']} target
 * @param {'approve' | 'reject' | 'hide'} action
 * @param {number} id
 * @param {boolean} releasePending Approve-and-release the author's whole backlog.
 * @returns {{ row: ModeratableRow, wasHidden: boolean, autoTrusted: boolean, released: number } | null}
 */
function applyTransition(target, action, id, releasePending) {
  const row = target.getRow(id)
  if (!row) return null
  const wasHidden = row.status === CONTENT_STATUS.HIDDEN

  const changed = target[action](id)
  if (!changed) return null

  let autoTrusted = false
  let released = 0
  if (action === "approve" && row.account_id !== null) {
    // Auto-trust fires only on a genuine first approval (pending → approved),
    // never on unhide (hidden → approved): unhiding must not silently re-trust
    // an author the admin previously untrusted, and the approve confirm dialog
    // only names the trust effect for pending items (owner decision 2026-07-08).
    if (!wasHidden) {
      const account = getAccountById(row.account_id)
      if (account && !account.trusted) {
        setAccountTrusted(row.account_id, true)
        autoTrusted = true
      }
    }
    if (releasePending) {
      released = approvePendingForAccount(row.account_id)
    }
  }
  return { row, wasHidden, autoTrusted, released }
}

/** Pick the audit action for a committed transition. */
/** @param {'approve' | 'reject' | 'hide'} action @param {boolean} wasHidden */
function auditActionFor(action, wasHidden) {
  if (action === "reject") return AUDIT_ACTIONS.MODERATION_REJECT
  if (action === "hide") return AUDIT_ACTIONS.MODERATION_HIDE
  return wasHidden ? AUDIT_ACTIONS.MODERATION_UNHIDE : AUDIT_ACTIONS.MODERATION_APPROVE
}

/**
 * Shared body for approve/reject/hide: validate type + id, apply the transition
 * (auto-trust on approve), audit, and — for a media reject — unlink the item's
 * variant files after the DB commit. A no-op transition is a 409.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('../../core/types.js').AuthenticatedRouteInfo} routeInfo
 * @param {'approve' | 'reject' | 'hide'} action
 */
async function moderate(req, res, { params, session }, action) {
  const target = resolveType(params.type)
  const idResult = validateId(params.id, "entry ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  // Optional body: { releasePending } on approve (detail-modal "approve &
  // release their other pending items"), { reason } on reject (an optional
  // note recorded in the audit log for an irreversible action). Body is
  // optional on POST.
  let releasePending = false
  /** @type {string | null} */
  let reason = null
  if (action === "approve" || action === "reject") {
    const body = await parseBody(req).catch(
      () => /** @type {Record<string, unknown>} */ ({}),
    )
    releasePending = body.releasePending === true
    if (action === "reject" && typeof body.reason === "string") {
      reason = sanitize(body.reason, 500)
    }
  }

  const outcome = withTransaction(() =>
    applyTransition(target, action, idResult.value, releasePending),
  )
  if (!outcome) {
    throw new ConflictError(
      `Cannot ${action} this item — it no longer exists or is not in a valid state`,
    )
  }

  // Terminal state: a rejected media item's files come off disk (row kept for
  // audit). Done after commit so a rolled-back transaction never orphans files.
  if (action === "reject" && target.unlink && outcome.row.file_key) {
    fs.rmSync(itemDir(outcome.row.file_key), { recursive: true, force: true })
  }

  /** @type {Record<string, unknown>} */
  const details = {}
  if (outcome.autoTrusted) details.autoTrusted = outcome.row.account_id
  if (outcome.released) details.released = outcome.released
  if (reason) details.reason = reason

  log({
    action: auditActionFor(action, outcome.wasHidden),
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: params.type,
    resourceId: idResult.value,
    details: Object.keys(details).length ? details : undefined,
  })

  return sendJson(res, 200, {
    success: true,
    autoTrusted: outcome.autoTrusted,
    released: outcome.released,
  })
}

/** @type {Types.ParamsHandler} */
export async function approve(req, res, routeInfo) {
  return moderate(req, res, routeInfo, "approve")
}

/** @type {Types.ParamsHandler} */
export async function reject(req, res, routeInfo) {
  return moderate(req, res, routeInfo, "reject")
}

/** @type {Types.ParamsHandler} */
export async function hide(req, res, routeInfo) {
  return moderate(req, res, routeInfo, "hide")
}

/** @type {Types.moderationBulkHandler} */
export async function bulk(req, res, { session }) {
  const body = await parseBody(req)
  const action = body.action
  if (action !== "approve" && action !== "reject") {
    throw new ValidationError("action must be 'approve' or 'reject'")
  }

  const rawItems = body.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ValidationError("items must be a non-empty array")
  }
  if (rawItems.length > PAGINATION.MAX_PAGE_SIZE) {
    throw new ValidationError(`Cannot process more than ${PAGINATION.MAX_PAGE_SIZE} items at once`)
  }

  /** @type {{ type: ModeratableType, id: number }[]} */
  const items = []
  for (const raw of rawItems) {
    if (typeof raw !== "object" || raw === null) {
      throw new ValidationError("Each item must be an object with a type and id")
    }
    const entry = /** @type {Record<string, unknown>} */ (raw)
    const type = entry.type
    if (typeof type !== "string" || !isModeratableType(type)) {
      throw new ValidationError("Invalid item type")
    }
    const idResult = validateId(entry.id, "item ID")
    if (!idResult.valid) throw new ValidationError(idResult.error)
    items.push({ type, id: idResult.value })
  }

  // One transaction for the whole batch. A thrown DB error rolls the batch back;
  // items already in a terminal or otherwise invalid state are skipped (their
  // applyTransition returns null) while the rest still commit, so `changed` may
  // be < items.length. Auto-trust rides along on approve.
  const results = withTransaction(() =>
    items.map((item) => {
      const target = MODERATABLE[item.type]
      const outcome = applyTransition(target, action, item.id, false)
      return { item, outcome }
    }),
  )

  // Files for rejected media come off disk after commit.
  if (action === "reject") {
    for (const { item, outcome } of results) {
      if (outcome && MODERATABLE[item.type].unlink && outcome.row.file_key) {
        fs.rmSync(itemDir(outcome.row.file_key), { recursive: true, force: true })
      }
    }
  }

  const ip = getClientIp(req)
  let changed = 0
  for (const { item, outcome } of results) {
    if (!outcome) continue
    changed++
    // One audit entry per item (documented granularity — matches the bulk test).
    log({
      action: auditActionFor(action, outcome.wasHidden),
      adminId: session?.token,
      ip,
      resourceType: item.type,
      resourceId: item.id,
      details: outcome.autoTrusted ? { autoTrusted: outcome.row.account_id } : undefined,
    })
  }

  return sendJson(res, 200, { success: true, changed, total: items.length })
}
