/** @file Comment database operations (polymorphic: guestbook entries + media) */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"

/** @type {Types.createComment} */
export function createComment({ accountId, targetType, targetId, message, status }) {
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

/** @type {Types.getCommentsForTarget} */
export function getCommentsForTarget({ targetType, targetId, callerId = null }) {
  // Ascending (oldest-first, chronological thread). A signed-in caller also sees
  // their OWN pending comments; anonymous callers see approved only. `is_own`
  // flags the caller's rows for the pending chip / delete affordance.
  const ownPending =
    callerId !== null
      ? sql`OR (c.status = 'pending' AND c.account_id = ${callerId})`
      : sql.empty
  const isOwn =
    callerId !== null ? sql`(c.account_id = ${callerId})` : sql`0`

  return sql`SELECT c.id, c.account_id, c.message, c.status, c.created_at,
      a.name AS author_name, ${isOwn} AS is_own
    FROM comments c
    JOIN accounts a ON a.id = c.account_id
    WHERE c.deleted_at IS NULL
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
  // target so Phase 6's queue UI can link back to the commented item.
  return sql`SELECT c.id, c.account_id, c.target_type, c.target_id, c.message,
      c.status, c.created_at, a.name AS author_name, a.trusted AS author_trusted,
      0 AS is_own
    FROM comments c
    JOIN accounts a ON a.id = c.account_id
    WHERE c.status = 'pending' AND c.deleted_at IS NULL
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT ${limit} OFFSET ${offset}`.all()
}

/** @type {Types.countPendingComments} */
export function countPendingComments() {
  /** @type {import('./types.js').CountResult | undefined} */
  const result = sql`SELECT COUNT(*) AS count FROM comments
    WHERE status = 'pending' AND deleted_at IS NULL`.get()
  return result ? result.count : 0
}

/** @type {Types.getCommentCounts} */
export function getCommentCounts(targetType, ids) {
  // Feed enrichment: approved comment count per target for a page of ids.
  // sql.list() throws on an empty array, so the caller must guard — but guard
  // here too so this is safe to call unconditionally.
  if (ids.length === 0) return new Map()
  /** @type {{ target_id: number, c: number }[]} */
  const rows = sql`SELECT target_id, COUNT(*) AS c FROM comments
    WHERE target_type = ${targetType} AND status = 'approved'
      AND deleted_at IS NULL AND target_id IN ${sql.list(ids)}
    GROUP BY target_id`.all()
  const counts = new Map()
  for (const row of rows) counts.set(row.target_id, row.c)
  return counts
}
