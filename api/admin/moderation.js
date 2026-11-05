/** @file Admin moderation endpoints. Phase 6 grows the Phase 2 guestbook-only
 *  version into the full combined queue (guestbook + media + comments), bulk
 *  actions, auto-trust on approval, and terminal-state file cleanup. */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../types.js' */

import { sendJson, parseBody, sanitize } from "../../core/http.js"
import { log, logBatch, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import {
  validateId,
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../core/validation.js"
import { quarantineItemDir, restoreQuarantinedItemDir } from "../../core/media-storage.js"
import { PAGINATION, MODERATION, CONTENT_STATUS, CONTENT_STATUS_VALUES } from "../../types.js"
import { withTransaction } from "../../db/utils.js"
import {
  getGuestbookEntryById,
  setGuestbookStatus,
  getModerationCounts,
} from "../../db/guestbook-entries.js"
import { getCommentById, setCommentStatus } from "../../db/comments.js"
import { getMediaById, setMediaStatus } from "../../db/media.js"
import {
  getModerationQueue,
  getModerationItem,
  approvePendingForAccount,
} from "../../db/moderation.js"
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
    /** pending|approved → hidden (off the site, kept: the Review "h") */
    hide: (/** @type {number} */ id) =>
      setGuestbookStatus(
        id,
        [CONTENT_STATUS.PENDING, CONTENT_STATUS.APPROVED],
        CONTENT_STATUS.HIDDEN,
      ),
    /** generic from→to setter for undo (uniform signature keeps the union callable) */
    /** @type {(id: number, from: string[], to: string) => boolean} */
    set: (id, from, to) =>
      setGuestbookStatus(
        id,
        /** @type {GlobalTypes.ContentStatus[]} */ (from),
        /** @type {GlobalTypes.ContentStatus} */ (to),
      ),
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
    /** pending|approved → hidden (off the site, kept: the Review "h") */
    hide: (/** @type {number} */ id) =>
      setCommentStatus(
        id,
        [CONTENT_STATUS.PENDING, CONTENT_STATUS.APPROVED],
        CONTENT_STATUS.HIDDEN,
      ),
    /** @type {(id: number, from: string[], to: string) => boolean} */
    set: (id, from, to) =>
      setCommentStatus(
        id,
        /** @type {GlobalTypes.ContentStatus[]} */ (from),
        /** @type {GlobalTypes.ContentStatus} */ (to),
      ),
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
    /** pending|approved → hidden (off the site, kept: the Review "h") */
    hide: (/** @type {number} */ id) =>
      setMediaStatus(
        id,
        [CONTENT_STATUS.PENDING, CONTENT_STATUS.APPROVED],
        CONTENT_STATUS.HIDDEN,
      ),
    /** @type {(id: number, from: string[], to: string) => boolean} */
    set: (id, from, to) =>
      setMediaStatus(
        id,
        /** @type {GlobalTypes.MediaStatus[]} */ (from),
        /** @type {GlobalTypes.MediaStatus} */ (to),
      ),
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
  const items = rows.slice(0, limit).map(projectItem)

  return sendJson(res, 200, { items, type, status, hasMore })
}

/**
 * One queue row as the client sees it (booleans, `author_relation`).
 * @param {GlobalTypes.ModerationQueueRow} row
 */
function projectItem(row) {
  return {
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
    parent_snippet: row.parent_snippet,
    parent_author: row.parent_author,
    parent_file_key: row.parent_file_key,
    parent_kind: row.parent_kind,
  }
}

/**
 * GET /api/admin/moderation/:type/:id — one post in any status, so a link to
 * a post that has since been decided shows "this is now approved" (IA §1.4).
 * @type {Types.ParamsHandler}
 */
export async function item(req, res, { params }) {
  resolveType(params.type)
  const idResult = validateId(params.id, "entry ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)
  const row = getModerationItem(/** @type {ModeratableType} */ (params.type), idResult.value)
  if (!row) throw new NotFoundError("Post")
  return sendJson(res, 200, { item: projectItem(row) })
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
 * @param {Map<number, boolean>} [trustCache] Per-batch author-trust cache, so a
 *   bulk approve doesn't re-query the same author's account for every item.
 * @param {boolean} [autoTrust] false: approve without promoting the author. The
 *   Review page sends it: there, trust is offered once everything the author
 *   posted is approved, never applied on the first approval (owner, Nov 2026).
 * @returns {{ row: ModeratableRow, wasHidden: boolean, autoTrusted: boolean, released: number } | null}
 */
function applyTransition(target, action, id, releasePending, trustCache, autoTrust = true) {
  const row = target.getRow(id)
  if (!row) return null
  const wasHidden = row.status === CONTENT_STATUS.HIDDEN

  const changed = target[action](id)
  if (!changed) return null

  let autoTrusted = false
  let released = 0
  if (action === "approve" && row.account_id !== null) {
    const accountId = row.account_id
    // Auto-trust fires only on a genuine first approval (pending → approved),
    // never on unhide (hidden → approved): unhiding must not silently re-trust
    // an author the admin previously untrusted, and the approve confirm dialog
    // only names the trust effect for pending items (owner decision 2026-07-08).
    if (!wasHidden && autoTrust) {
      let trusted = trustCache?.get(accountId)
      if (trusted === undefined) {
        const account = getAccountById(accountId)
        // Missing account → treat as trusted (nothing to promote).
        trusted = account ? !!account.trusted : true
        if (trustCache) trustCache.set(accountId, trusted)
      }
      if (!trusted) {
        setAccountTrusted(accountId, true)
        autoTrusted = true
        if (trustCache) trustCache.set(accountId, true)
      }
    }
    if (releasePending) {
      released = approvePendingForAccount(accountId)
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
 * @typedef {{ item: { type: ModeratableType, id: number },
 *   outcome: ReturnType<typeof applyTransition> }} TransitionResult
 */

/**
 * Tally a batch's committed transitions and write one batched audit log (one
 * entry per changed item — documented granularity). Shared by bulk() and
 * approveAllPending().
 * @param {TransitionResult[]} results
 * @param {{ action: 'approve' | 'reject' | 'hide', req: import('node:http').IncomingMessage, session?: { token?: string } }} ctx
 * @returns {{ changed: number, trusted: number }}
 */
function tallyAndAudit(results, { action, req, session }) {
  const ip = getClientIp(req)
  /** @type {import('../../core/types.js').AuditEvent[]} */
  const entries = []
  let changed = 0
  let trusted = 0
  for (const { item, outcome } of results) {
    if (!outcome) continue
    changed++
    if (outcome.autoTrusted) trusted++
    entries.push({
      action: auditActionFor(action, outcome.wasHidden),
      adminId: session?.token,
      ip,
      resourceType: item.type,
      resourceId: item.id,
      details: outcome.autoTrusted ? { autoTrusted: outcome.row.account_id } : undefined,
    })
  }
  logBatch(entries)
  return { changed, trusted }
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

  // Optional body: { releasePending, autoTrust } on approve (detail-modal
  // "approve & release their other pending items"; autoTrust: false approves
  // without trusting), { reason } on reject (an optional note recorded in the
  // audit log for an irreversible action). Body is optional on POST.
  let releasePending = false
  let autoTrust = true
  /** @type {string | null} */
  let reason = null
  if (action === "approve" || action === "reject") {
    const body = await parseBody(req).catch(
      () => /** @type {Record<string, unknown>} */ ({}),
    )
    releasePending = body.releasePending === true
    autoTrust = body.autoTrust !== false
    if (action === "reject" && typeof body.reason === "string") {
      reason = sanitize(body.reason, 500)
    }
  }

  const outcome = withTransaction(() =>
    applyTransition(target, action, idResult.value, releasePending, undefined, autoTrust),
  )
  if (!outcome) {
    throw new ConflictError(
      `Cannot ${action} this item — it no longer exists or is not in a valid state`,
    )
  }

  // Terminal state: a rejected media item's files move to quarantine/ (row kept
  // for audit) — recoverable by hand until quarantine is emptied, so one
  // mis-click on the Reject button beside Approve isn't permanent loss. Done
  // after commit so a rolled-back transaction never orphans files.
  if (action === "reject" && target.unlink && outcome.row.file_key) {
    quarantineItemDir(outcome.row.file_key)
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
    // The status BEFORE this transition, so the client's "Undo" toast knows
    // what to revert to (a reject returns 'pending' but undo is disabled for it
    // client-side — its files were quarantined; see undo()).
    previousStatus: outcome.row.status,
  })
}

/**
 * Reverse the last single-item transition (the "Undo" toast). Only clean,
 * status-only reversals are allowed — approve→pending, unhide→hidden,
 * hide→approved. A reject is never undone here (its files moved to quarantine;
 * it stays hand-recoverable), and no reversal touches files.
 * @type {Types.ParamsHandler}
 */
export async function undo(req, res, { params, session }) {
  const target = resolveType(params.type)
  const idResult = validateId(params.id, "entry ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const body = await parseBody(req).catch(
    () => /** @type {Record<string, unknown>} */ ({}),
  )
  const to = body.to
  if (typeof to !== "string") throw new ValidationError("Invalid target status")

  const row = target.getRow(idResult.value)
  if (!row) throw new NotFoundError("Moderation item")
  const from = row.status

  // Whitelist of reversible (from → to) pairs. Reject (from 'rejected', or to
  // 'rejected') is intentionally excluded — those files were quarantined.
  const legal =
    (from === CONTENT_STATUS.APPROVED &&
      (to === CONTENT_STATUS.PENDING || to === CONTENT_STATUS.HIDDEN)) ||
    (from === CONTENT_STATUS.HIDDEN && to === CONTENT_STATUS.APPROVED)
  if (!legal) throw new ConflictError("This action can no longer be undone")

  const changed = withTransaction(() => target.set(idResult.value, [from], to))
  if (!changed) throw new ConflictError("This action can no longer be undone")

  log({
    action: AUDIT_ACTIONS.MODERATION_UNDO,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: params.type,
    resourceId: idResult.value,
    details: { from, to },
  })

  return sendJson(res, 200, { success: true })
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
  if (action !== "approve" && action !== "reject" && action !== "hide") {
    throw new ValidationError("action must be 'approve', 'reject' or 'hide'")
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
  // be < items.length. Auto-trust rides along on approve unless the body says
  // { autoTrust: false }.
  const autoTrust = body.autoTrust !== false
  /** @type {Map<number, boolean>} */
  const trustCache = new Map()
  const results = withTransaction(() =>
    items.map((item) => {
      const target = MODERATABLE[item.type]
      const outcome = applyTransition(target, action, item.id, false, trustCache, autoTrust)
      return { item, outcome }
    }),
  )

  // Files for rejected media move to quarantine/ after commit (see moderate()).
  if (action === "reject") {
    for (const { item, outcome } of results) {
      if (outcome && MODERATABLE[item.type].unlink && outcome.row.file_key) {
        quarantineItemDir(outcome.row.file_key)
      }
    }
  }

  const { changed, trusted } = tallyAndAudit(results, { action, req, session })

  // `trusted` surfaces the standing side effect of a bulk approve (each newly
  // trusted author's future posts skip review) so the client can disclose it.
  // `items` + `trustedAccounts` are exactly what an Undo needs to put back.
  return sendJson(res, 200, {
    success: true,
    changed,
    total: items.length,
    trusted,
    ...undoFacts(results),
  })
}

/**
 * What a batch changed, in the shape POST /restore takes back: each changed
 * item with the status it left, and every account the batch auto-trusted.
 * @param {TransitionResult[]} results
 * @returns {{ items: { type: ModeratableType, id: number, previousStatus: string }[], trustedAccounts: number[] }}
 */
function undoFacts(results) {
  /** @type {{ type: ModeratableType, id: number, previousStatus: string }[]} */
  const changedItems = []
  /** @type {Set<number>} */
  const trustedAccounts = new Set()
  for (const { item, outcome } of results) {
    if (!outcome) continue
    changedItems.push({ type: item.type, id: item.id, previousStatus: outcome.row.status })
    if (outcome.autoTrusted && outcome.row.account_id !== null) {
      trustedAccounts.add(outcome.row.account_id)
    }
  }
  return { items: changedItems, trustedAccounts: [...trustedAccounts] }
}

/**
 * The (from → to) moves an Undo, or "Move back to review", may make. A reject
 * comes back too: its files are moved out of quarantine first, and if the
 * sweep has already purged them the item stays rejected.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const RESTORABLE = Object.freeze({
  [CONTENT_STATUS.APPROVED]: [CONTENT_STATUS.PENDING, CONTENT_STATUS.HIDDEN],
  [CONTENT_STATUS.HIDDEN]: [CONTENT_STATUS.APPROVED, CONTENT_STATUS.PENDING],
  [CONTENT_STATUS.REJECTED]: [CONTENT_STATUS.PENDING],
})

/**
 * POST /api/admin/moderation/restore — { items: [{ type, id, to }], untrust?: [accountId] }.
 * Puts posts back where an action found them (the Undo toast, for one post or
 * a batch) and un-trusts the authors that action auto-trusted. Items that have
 * moved on since are skipped, not failed: `restored` says how many came back.
 * @type {Types.AuthedHandler}
 */
export async function restore(req, res, { session }) {
  const body = await parseBody(req)
  const rawItems = body.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ValidationError("items must be a non-empty array")
  }
  if (rawItems.length > MODERATION.APPROVE_ALL_MAX) {
    throw new ValidationError("Too many items")
  }
  /** @type {{ type: ModeratableType, id: number, to: string }[]} */
  const items = []
  for (const raw of rawItems) {
    if (typeof raw !== "object" || raw === null) {
      throw new ValidationError("Each item must be an object with a type, id and to")
    }
    const entry = /** @type {Record<string, unknown>} */ (raw)
    const type = entry.type
    if (typeof type !== "string" || !isModeratableType(type)) {
      throw new ValidationError("Invalid item type")
    }
    const idResult = validateId(entry.id, "item ID")
    if (!idResult.valid) throw new ValidationError(idResult.error)
    if (typeof entry.to !== "string") throw new ValidationError("Invalid target status")
    items.push({ type, id: idResult.value, to: entry.to })
  }
  /** @type {number[]} */
  const untrust = []
  if (body.untrust !== undefined) {
    if (!Array.isArray(body.untrust)) throw new ValidationError("untrust must be an array")
    for (const raw of body.untrust) {
      const idResult = validateId(raw, "account ID")
      if (!idResult.valid) throw new ValidationError(idResult.error)
      untrust.push(idResult.value)
    }
  }

  const ip = getClientIp(req)
  /** @type {import('../../core/types.js').AuditEvent[]} */
  const entries = []
  let restored = 0
  for (const { type, id, to } of items) {
    const target = MODERATABLE[type]
    const row = target.getRow(id)
    if (!row) continue
    const from = row.status
    if (!(RESTORABLE[from] ?? []).includes(to)) continue
    // A rejected photo's files are in quarantine: bring them back first, and
    // leave the item rejected if the sweep got there before the Undo did.
    const unquarantine = target.unlink && from === CONTENT_STATUS.REJECTED && !!row.file_key
    if (unquarantine && !restoreQuarantinedItemDir(/** @type {string} */ (row.file_key))) continue
    const changed = withTransaction(() => target.set(id, [from], to))
    if (!changed) {
      if (unquarantine) quarantineItemDir(/** @type {string} */ (row.file_key))
      continue
    }
    restored++
    entries.push({
      action: AUDIT_ACTIONS.MODERATION_UNDO,
      adminId: session?.token,
      ip,
      resourceType: type,
      resourceId: id,
      details: { from, to },
    })
  }
  let untrusted = 0
  for (const accountId of untrust) {
    if (!setAccountTrusted(accountId, false)) continue
    untrusted++
    entries.push({
      action: AUDIT_ACTIONS.ACCOUNT_UNTRUST,
      adminId: session?.token,
      ip,
      resourceType: "account",
      resourceId: accountId,
      details: { undo: true },
    })
  }
  logBatch(entries)
  return sendJson(res, 200, { success: true, restored, untrusted, total: items.length })
}

/**
 * POST /api/admin/accounts/:id/approve-pending — "Approve their N waiting" on
 * the Review author card and in Accounts. Approves exactly the rows the queue
 * shows for this author (same transition as one approve, so auto-trust rides
 * along unless the optional body says { autoTrust: false }) and returns them,
 * so the Undo toast can put them back.
 * @type {Types.ParamsHandler}
 */
export async function approveWaiting(req, res, { params, session }) {
  const idResult = validateId(params.id, "account ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)
  if (!getAccountById(idResult.value)) throw new NotFoundError("Account")
  const body = await parseBody(req).catch(() => /** @type {Record<string, unknown>} */ ({}))
  const autoTrust = body.autoTrust !== false

  const rows = getModerationQueue({
    status: CONTENT_STATUS.PENDING,
    accountId: idResult.value,
    limit: MODERATION.APPROVE_ALL_MAX,
    offset: 0,
  })
  /** @type {Map<number, boolean>} */
  const trustCache = new Map()
  const results = withTransaction(() =>
    rows.map((row) => {
      const type = /** @type {ModeratableType} */ (row.content_type)
      const outcome = applyTransition(
        MODERATABLE[type],
        "approve",
        row.id,
        false,
        trustCache,
        autoTrust,
      )
      return { item: { type, id: row.id }, outcome }
    }),
  )
  const { changed } = tallyAndAudit(results, { action: "approve", req, session })
  return sendJson(res, 200, { success: true, changed, ...undoFacts(results) })
}

/** @type {Types.moderationApproveAllHandler} */
export async function approveAllPending(req, res, { session }) {
  // The whole pending backlog, not just the client's loaded page: the "yes,
  // publish everything" path for a couple facing hundreds of uploads. Same
  // per-item transition as bulk(), so auto-trust and audit ride along.
  const rows = /** @type {{ content_type: string, id: number }[]} */ (
    getModerationQueue({
      status: CONTENT_STATUS.PENDING,
      limit: MODERATION.APPROVE_ALL_MAX,
      offset: 0,
    })
  )
  /** @type {{ type: ModeratableType, id: number }[]} */
  const items = rows.map((row) => ({
    type: /** @type {ModeratableType} */ (row.content_type),
    id: row.id,
  }))

  /** @type {Map<number, boolean>} */
  const trustCache = new Map()
  const results = withTransaction(() =>
    items.map((item) => ({
      item,
      outcome: applyTransition(MODERATABLE[item.type], "approve", item.id, false, trustCache),
    })),
  )

  const { changed, trusted } = tallyAndAudit(results, { action: "approve", req, session })

  // If the backlog exceeded APPROVE_ALL_MAX, tell the client how many are still
  // pending so it can keep sweeping (and toast honestly) instead of the old
  // silent truncation that reported "Approved 5000" with work left.
  const remaining = getModerationCounts().total

  return sendJson(res, 200, { success: true, changed, trusted, remaining })
}
