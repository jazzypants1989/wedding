/** @file Guestbook entry database operations */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"
import { countPendingMedia } from "./media.js"
import { countPendingComments } from "./comments.js"

/** @type {Types.createGuestbookEntry} */
export function createGuestbookEntry({ accountId, message, status }) {
  const result = sql`INSERT INTO guestbook_entries (account_id, message, status)
    VALUES (${accountId}, ${message}, ${status})`.run()
  return /** @type {import('../types.js').GuestbookEntry} */ (
    getGuestbookEntryById(Number(result.lastInsertRowid))
  )
}

/** @type {Types.getGuestbookEntryById} */
export function getGuestbookEntryById(id) {
  return sql`SELECT * FROM guestbook_entries WHERE id = ${id}`.get()
}

/** @type {Types.getGuestbookEntryForCaller} */
export function getGuestbookEntryForCaller(id, callerId = null) {
  // Minimal visibility probe for the comments parent gate (media's analog is
  // getMediaFeedRowById). Excludes soft-deleted rows AND rows whose author
  // account is soft-deleted → undefined; the caller gates on status (approved,
  // or own-pending via is_own).
  const isOwn = callerId !== null ? sql`(e.account_id = ${callerId})` : sql`0`
  return sql`SELECT e.id, e.account_id, e.status, ${isOwn} AS is_own
    FROM guestbook_entries e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.id = ${id} AND e.deleted_at IS NULL AND a.deleted_at IS NULL`.get()
}

/** @type {Types.getGuestbookFeed} */
export function getGuestbookFeed({ callerId = null, before = null, limit }) {
  // A signed-in caller also sees their OWN pending entries; anonymous callers
  // (callerId null) see approved only. `is_own` flags the caller's rows so the
  // page can render the pending chip / delete affordance without a second pass.
  const ownPending =
    callerId !== null
      ? sql`OR (e.status = 'pending' AND e.account_id = ${callerId})`
      : sql.empty
  const isOwn =
    callerId !== null
      ? sql`(e.account_id = ${callerId})`
      : sql`0`
  const beforeFilter = before !== null ? sql`AND e.id < ${before}` : sql.empty

  return sql`SELECT e.id, e.account_id, e.message, e.status, e.created_at,
      a.name AS author_name, a.trusted AS author_trusted, ${isOwn} AS is_own,
      (e.pinned_at IS NOT NULL) AS is_pinned
    FROM guestbook_entries e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.deleted_at IS NULL AND a.deleted_at IS NULL
      AND (e.status = 'approved' ${ownPending})
      ${beforeFilter}
    ORDER BY e.id DESC
    LIMIT ${limit}`.all()
}

/** @type {Types.getGuestbookFeedEntryById} */
export function getGuestbookFeedEntryById(id, callerId = null) {
  // Same columns + visibility gate as getGuestbookFeed, narrowed to one id, so
  // a ?entry= deep link resolves to a full feed row (or undefined if the caller
  // may not see it — never confirm unmoderated content by id-guessing).
  const ownPending =
    callerId !== null
      ? sql`OR (e.status = 'pending' AND e.account_id = ${callerId})`
      : sql.empty
  const isOwn = callerId !== null ? sql`(e.account_id = ${callerId})` : sql`0`
  return sql`SELECT e.id, e.account_id, e.message, e.status, e.created_at,
      a.name AS author_name, a.trusted AS author_trusted, ${isOwn} AS is_own,
      (e.pinned_at IS NOT NULL) AS is_pinned
    FROM guestbook_entries e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.id = ${id} AND e.deleted_at IS NULL AND a.deleted_at IS NULL
      AND (e.status = 'approved' ${ownPending})`.get()
}

/** @type {Types.setGuestbookPinned} */
export function setGuestbookPinned(id, pinned) {
  // Only an approved, live entry can be pinned (the Favorites strip shows public
  // notes only). Unpin clears the timestamp. Returns true if a row changed.
  const result = pinned
    ? sql`UPDATE guestbook_entries SET pinned_at = ${now()}
        WHERE id = ${id} AND deleted_at IS NULL AND status = 'approved' AND pinned_at IS NULL`.run()
    : sql`UPDATE guestbook_entries SET pinned_at = NULL
        WHERE id = ${id} AND deleted_at IS NULL AND pinned_at IS NOT NULL`.run()
  return result.changes > 0
}

/** @type {Types.getPinnedGuestbook} */
export function getPinnedGuestbook({ callerId = null, limit }) {
  // The admin-pinned "Favorites" set: approved, live, non-deleted author, newest
  // pinned first. Same columns as getGuestbookFeed so the page renders them with
  // the shared entry renderer. `is_own` is computed for parity (delete/share
  // affordances) though the strip is read-mostly.
  const isOwn =
    callerId !== null ? sql`(e.account_id = ${callerId})` : sql`0`
  return sql`SELECT e.id, e.account_id, e.message, e.status, e.created_at,
      a.name AS author_name, a.trusted AS author_trusted, ${isOwn} AS is_own,
      1 AS is_pinned
    FROM guestbook_entries e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.pinned_at IS NOT NULL AND e.status = 'approved'
      AND e.deleted_at IS NULL AND a.deleted_at IS NULL
    ORDER BY e.pinned_at DESC, e.id DESC
    LIMIT ${limit}`.all()
}

/** @type {Types.softDeleteGuestbookEntry} */
export function softDeleteGuestbookEntry(id, accountId) {
  const result = sql`UPDATE guestbook_entries SET deleted_at = ${now()}
    WHERE id = ${id} AND account_id = ${accountId} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.getGuestbookModerationQueue} */
export function getGuestbookModerationQueue({ limit, offset }) {
  // Oldest-first so the admin clears the backlog in arrival order. A soft-deleted
  // author's pending items drop out — the admin removed that person.
  return sql`SELECT e.id, e.account_id, e.message, e.status, e.created_at,
      a.name AS author_name, a.trusted AS author_trusted, 0 AS is_own, 0 AS is_pinned
    FROM guestbook_entries e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.status = 'pending' AND e.deleted_at IS NULL AND a.deleted_at IS NULL
    ORDER BY e.created_at ASC, e.id ASC
    LIMIT ${limit} OFFSET ${offset}`.all()
}

/** @type {Types.countPendingGuestbook} */
export function countPendingGuestbook() {
  // Joins accounts so a soft-deleted author's pending items drop out of the badge,
  // keeping this count in step with getGuestbookModerationQueue.
  /** @type {import('./types.js').CountResult | undefined} */
  const result = sql`SELECT COUNT(*) AS count FROM guestbook_entries e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.status = 'pending' AND e.deleted_at IS NULL AND a.deleted_at IS NULL`.get()
  return result ? result.count : 0
}

/** @type {Types.countApprovedGuestbook} */
export function countApprovedGuestbook() {
  // Public "moments shared" tally for the landing page — approved, non-deleted
  // entries from live accounts (same gate as the public feed).
  /** @type {import('./types.js').CountResult | undefined} */
  const result = sql`SELECT COUNT(*) AS count FROM guestbook_entries e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.status = 'approved' AND e.deleted_at IS NULL AND a.deleted_at IS NULL`.get()
  return result ? result.count : 0
}

/** @type {Types.setGuestbookStatus} */
export function setGuestbookStatus(id, fromStatuses, toStatus) {
  const result = sql`UPDATE guestbook_entries
    SET status = ${toStatus}, reviewed_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL AND status IN ${sql.list(fromStatuses)}`.run()
  return result.changes > 0
}

/** @type {Types.getModerationCounts} */
export function getModerationCounts() {
  // All three content types now contribute (media in Phase 3, comments in Phase
  // 5). The digest reads this on the hourly tick — content endpoints never call
  // it, so the notify service stays decoupled.
  const guestbook = countPendingGuestbook()
  const media = countPendingMedia()
  const comments = countPendingComments()
  return { guestbook, media, comments, total: guestbook + media + comments }
}

/** @type {Types.getOldestPendingGuestbookAt} */
export function getOldestPendingGuestbookAt() {
  // Matches countPendingGuestbook's account gate so the digest's "oldest pending"
  // never points at an item that no longer counts (deleted author).
  /** @type {{ oldest: string | null } | undefined} */
  const row = sql`SELECT MIN(e.created_at) AS oldest FROM guestbook_entries e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.status = 'pending' AND e.deleted_at IS NULL AND a.deleted_at IS NULL`.get()
  return row && row.oldest ? row.oldest : null
}
