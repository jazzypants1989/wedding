/** @file Public guestbook endpoints: feed (GET), sign (POST), self-delete (DELETE) */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../types.js' */

import { sendJson, parseBody, checkRateLimit } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import { getOptionalAccount } from "../core/auth.js"
import {
  createGuestbookEntry,
  getGuestbookFeed,
  getGuestbookFeedEntryById,
  getPinnedGuestbook,
  softDeleteGuestbookEntry,
} from "../db/guestbook-entries.js"
import {
  validateRequiredString,
  validateId,
  ValidationError,
  NotFoundError,
} from "../core/validation.js"
import { LIMITS, CONTENT_STATUS, TARGET_TYPE } from "../types.js"
import { log, AUDIT_ACTIONS } from "../core/utils.js"
import { enrichSocial } from "./enrich.js"
import { getContent } from "../core/site-content.js"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
/** Cap on the admin-pinned "Favorites" strip returned on the first page. */
const PINNED_LIMIT = 6

/**
 * Parse the keyset cursor. Only a positive integer is a valid cursor; anything
 * else (absent, non-numeric, ≤0) means "first page" → null.
 * @param {string | null} value
 * @returns {number | null}
 */
function parseCursor(value) {
  if (!value) return null
  const n = parseInt(value, 10)
  return Number.isNaN(n) || n < 1 ? null : n
}

/**
 * Clamp the page size to [1, MAX_LIMIT], defaulting when absent/invalid.
 * @param {string | null} value
 * @returns {number}
 */
function clampLimit(value) {
  if (!value) return DEFAULT_LIMIT
  const n = parseInt(value, 10)
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

/**
 * Map a raw feed row (SQLite 0|1 flags) to the public response shape (booleans).
 * @param {GlobalTypes.GuestbookFeedRow} row
 * @returns {GlobalTypes.GuestbookFeedEntry}
 */
function toFeedEntry(row) {
  return {
    id: row.id,
    message: row.message,
    author_name: row.author_name,
    author_trusted: !!row.author_trusted,
    status: row.status,
    created_at: row.created_at,
    is_own: !!row.is_own,
    pinned: !!row.is_pinned,
  }
}

/** @type {Types.guestbookList} */
export async function list(req, res) {
  // Generous per-IP limiter shared across public list endpoints — every other
  // public endpoint is rate-limited; this one shouldn't be the exception.
  if (checkRateLimit(res, limiters.publicRead, getClientIp(req))) return

  const account = getOptionalAccount(req)
  const callerId = account ? account.account_id : null

  const urlObj = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const before = parseCursor(urlObj.searchParams.get("before"))
  const limit = clampLimit(urlObj.searchParams.get("limit"))

  const rows = getGuestbookFeed({ callerId, before, limit })
  const entries = rows.map(toFeedEntry)
  // Attach reaction summaries + comment counts (Phase 5). Guarded internally
  // against an empty page (sql.list throws on []).
  enrichSocial(entries, TARGET_TYPE.GUESTBOOK, callerId)
  // A short page means we've reached the end → no cursor. Otherwise the last
  // row's id is the exclusive cursor for the next page.
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null

  // The admin-pinned "Favorites" strip rides along on the FIRST page only (no
  // cursor), and only when the couple has it switched on (site content,
  // guestbook.showFavorites; off by default). Pinned entries also remain in the
  // main chronological feed, flagged `pinned`, so their flowers are gilded
  // either way — the duplication is intentional and simpler (the strip is a
  // separate, distinctly styled section, like a pinned post above a timeline).
  /** @type {GlobalTypes.GuestbookFeedEntry[]} */
  let pinned = []
  if (before === null && getContent().guestbook.showFavorites) {
    pinned = getPinnedGuestbook({ callerId, limit: PINNED_LIMIT }).map(toFeedEntry)
    enrichSocial(pinned, TARGET_TYPE.GUESTBOOK, callerId)
  }

  return sendJson(res, 200, { entries, nextCursor, pinned })
}

/** @type {Types.guestbookGetOne} */
export async function getOne(req, res, { params }) {
  if (checkRateLimit(res, limiters.publicRead, getClientIp(req))) return

  const account = getOptionalAccount(req)
  const callerId = account ? account.account_id : null

  const idResult = validateId(params.id, "entry ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const row = getGuestbookFeedEntryById(idResult.value, callerId)
  // Missing/deleted or not visible to this caller → 404 (never confirm existence
  // of unmoderated content by id-guessing), same posture as media.getOne.
  if (!row) throw new NotFoundError("Guestbook entry")

  const entry = toFeedEntry(row)
  enrichSocial([entry], TARGET_TYPE.GUESTBOOK, callerId)
  return sendJson(res, 200, entry)
}

/** @type {Types.guestbookCreate} */
export async function create(req, res, { account }) {
  if (checkRateLimit(res, limiters.guestbookPost, "acct:" + account.account_id)) {
    return
  }

  const body = await parseBody(req)
  const messageResult = validateRequiredString(
    body.message,
    "Message",
    LIMITS.GUESTBOOK_MESSAGE_MAX_LENGTH,
  )
  if (!messageResult.valid) throw new ValidationError(messageResult.error)

  // The single hybrid-moderation decision point: trusted content goes live
  // instantly; untrusted is held pending until the admin approves.
  const status = account.trusted
    ? CONTENT_STATUS.APPROVED
    : CONTENT_STATUS.PENDING

  const entry = createGuestbookEntry({
    accountId: account.account_id,
    message: messageResult.value,
    status,
  })

  log({
    action: AUDIT_ACTIONS.GUESTBOOK_CREATE,
    ip: getClientIp(req),
    resourceType: "guestbook_entry",
    resourceId: entry.id,
    details: { status },
  })

  // No notification call here — the digest service discovers pending items on
  // its own hourly schedule (owner decision 2026-07-06: digest-only).
  return sendJson(res, 201, {
    entry: {
      id: entry.id,
      message: entry.message,
      author_name: account.name,
      author_trusted: !!account.trusted,
      status: entry.status,
      created_at: entry.created_at,
      is_own: true,
      pinned: false,
    },
    status,
  })
}

/** @type {Types.guestbookRemove} */
export async function remove(req, res, { params, account }) {
  if (checkRateLimit(res, limiters.contentDelete, "acct:" + account.account_id)) {
    return
  }

  const idResult = validateId(params.id, "entry ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  // Own entries only. A miss (wrong owner OR nonexistent) is a generic 404 so
  // the endpoint never reveals whether someone else's entry exists.
  const deleted = softDeleteGuestbookEntry(idResult.value, account.account_id)
  if (!deleted) throw new NotFoundError("Entry")

  log({
    action: AUDIT_ACTIONS.GUESTBOOK_DELETE,
    ip: getClientIp(req),
    resourceType: "guestbook_entry",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true })
}
