/** @file Comment database operations (polymorphic: guestbook entries + media) */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"

/** @type {Types.createComment} */
export function createComment({ accountId, targetType, targetId, message, status }) {
  // accountId is NULL for a host/couple reply (admin-authored).
  const result = sql`INSERT INTO comments (account_id, target_type, target_id, message, status)
    VALUES (${accountId}, ${targetType}, ${targetId}, ${message}, ${status})`.run()
  return /** @type {import('../types.js').Comment} */ (
    getCommentById(Number(result.lastInsertRowid))
  )
}

/** @type {Types.getCommentById} */
export function getCommentById(id) {
  return sql`SELECT * FROM comments WHERE id = ${id}`.get()
}

/**
 * Parent-visibility predicate for the comment moderation queue + pending count: a
 * pending comment only surfaces while its parent target is still LIVE (approved
 * AND not soft-deleted), mirroring db/targets.js's public rule per target_type. A
 * comment on a since-hidden / rejected / soft-deleted parent stays in the DB
 * untouched but drops out of the queue and the pending badge/digest count, so an
 * invisible parent can't inflate the backlog forever. Assumes the comment alias
 * `c` (its target_type / target_id columns) is in scope; reused by the combined
 * queue in db/moderation.js so both consumers agree.
 * @returns {import('./sql.js').SqlFragment}
 */
export function liveCommentParentFilter() {
  return sql`(
    (c.target_type = 'guestbook' AND EXISTS (
      SELECT 1 FROM guestbook_entries ge
      WHERE ge.id = c.target_id AND ge.status = 'approved' AND ge.deleted_at IS NULL))
    OR (c.target_type = 'media' AND EXISTS (
      SELECT 1 FROM media m
      WHERE m.id = c.target_id AND m.status = 'approved' AND m.deleted_at IS NULL
        AND m.twin_of IS NULL))
  )`
}

/** @type {Types.getCommentsForTarget} */
export function getCommentsForTarget({ targetType, targetId, callerId = null }) {
  // Ascending (oldest-first, chronological thread). A signed-in caller also sees
  // their OWN pending comments; anonymous callers see approved only. `is_own`
  // flags the caller's rows for the pending chip / delete affordance.
  //
  // LEFT JOIN + null-tolerant author gate: host/couple replies carry account_id
  // NULL (no accounts row), so they must survive the join and the deleted-author
  // filter. `is_host` lets the API render the host chip + resolve the couple's
  // display name (author_name is NULL for them).
  const ownPending =
    callerId !== null
      ? sql`OR (c.status = 'pending' AND c.account_id = ${callerId})`
      : sql.empty
  const isOwn =
    callerId !== null ? sql`(c.account_id = ${callerId})` : sql`0`

  return sql`SELECT c.id, c.account_id, c.message, c.status, c.created_at,
      a.name AS author_name, ${isOwn} AS is_own,
      (c.account_id IS NULL) AS is_host
    FROM comments c
    LEFT JOIN accounts a ON a.id = c.account_id
    WHERE c.deleted_at IS NULL AND (c.account_id IS NULL OR a.deleted_at IS NULL)
      AND c.target_type = ${targetType} AND c.target_id = ${targetId}
      AND (c.status = 'approved' ${ownPending})
    ORDER BY c.id ASC`.all()
}

/** @type {Types.softDeleteComment} */
export function softDeleteComment(id, accountId) {
  const result = sql`UPDATE comments SET deleted_at = ${now()}
    WHERE id = ${id} AND account_id = ${accountId} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.setCommentStatus} */
export function setCommentStatus(id, fromStatuses, toStatus) {
  const result = sql`UPDATE comments
    SET status = ${toStatus}, reviewed_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL AND status IN ${sql.list(fromStatuses)}`.run()
  return result.changes > 0
}

/** @type {Types.getCommentModerationQueue} */
export function getCommentModerationQueue({ limit, offset }) {
  // Oldest-first so the admin clears the backlog in arrival order. Includes the
  // target so Phase 6's queue UI can link back to the commented item. A deleted
  // author's items and comments on a no-longer-live parent both drop out.
  return sql`SELECT c.id, c.account_id, c.target_type, c.target_id, c.message,
      c.status, c.created_at, a.name AS author_name, a.trusted AS author_trusted,
      0 AS is_own
    FROM comments c
    JOIN accounts a ON a.id = c.account_id
    WHERE c.status = 'pending' AND c.deleted_at IS NULL AND a.deleted_at IS NULL
      AND ${liveCommentParentFilter()}
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT ${limit} OFFSET ${offset}`.all()
}

/** @type {Types.countPendingComments} */
export function countPendingComments() {
  // Joins accounts and gates on parent visibility so this stays in lockstep with
  // getCommentModerationQueue — the badge/digest never counts a pending comment
  // the queue won't show (deleted author, or a hidden/rejected/deleted parent).
  /** @type {import('./types.js').CountResult | undefined} */
  const result = sql`SELECT COUNT(*) AS count FROM comments c
    JOIN accounts a ON a.id = c.account_id
    WHERE c.status = 'pending' AND c.deleted_at IS NULL AND a.deleted_at IS NULL
      AND ${liveCommentParentFilter()}`.get()
  return result ? result.count : 0
}

/** @type {Types.getCommentCounts} */
export function getCommentCounts(targetType, ids) {
  // Feed enrichment: approved comment count per target for a page of ids.
  // sql.list() throws on an empty array, so the caller must guard — but guard
  // here too so this is safe to call unconditionally.
  if (ids.length === 0) return new Map()
  // Excludes comments by a soft-deleted author so the per-item count matches what
  // getCommentsForTarget will actually render in the thread.
  // LEFT JOIN + null-tolerant author gate so host/couple replies (account_id
  // NULL) still count toward the per-item comment_count the thread will render.
  /** @type {{ target_id: number, c: number }[]} */
  const rows = sql`SELECT c.target_id, COUNT(*) AS c FROM comments c
    LEFT JOIN accounts a ON a.id = c.account_id
    WHERE c.target_type = ${targetType} AND c.status = 'approved'
      AND c.deleted_at IS NULL AND (c.account_id IS NULL OR a.deleted_at IS NULL)
      AND c.target_id IN ${sql.list(ids)}
    GROUP BY c.target_id`.all()
  const counts = new Map()
  for (const row of rows) counts.set(row.target_id, row.c)
  return counts
}
