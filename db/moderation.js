/** @file Cross-type moderation queries (Phase 6): a combined queue over the three
 *  moderatable tables (guestbook_entries, media, comments) plus per-account bulk
 *  transitions used by trust/auto-trust and account soft-delete. The `type`
 *  filter is validated by the caller against a fixed allowlist — never
 *  interpolated into SQL here. */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"
import { MEDIA_SECTION } from "../types.js"

/**
 * Build one type's contribution to the combined queue. Every branch projects the
 * SAME 14 columns (NULL-filled where a column doesn't apply) so the UNION ALL is
 * well-formed. Media uses a LEFT JOIN (official uploads have account_id NULL).
 * @param {'guestbook' | 'media' | 'comment'} type
 * @param {string} status
 * @param {number | null} accountId
 * @returns {import('./sql.js').SqlFragment}
 */
function typeSelect(type, status, accountId) {
  if (type === "guestbook") {
    const acct = accountId !== null ? sql`AND e.account_id = ${accountId}` : sql.empty
    return sql`SELECT 'guestbook' AS content_type, e.id AS id, e.account_id AS account_id,
        a.name AS author_name, a.relation AS relation, a.trusted AS author_trusted, e.status AS status,
        e.created_at AS created_at, e.message AS message,
        NULL AS target_type, NULL AS target_id,
        NULL AS file_key, NULL AS kind, NULL AS caption, NULL AS needs_display
      FROM guestbook_entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.status = ${status} AND e.deleted_at IS NULL ${acct}`
  }
  if (type === "comment") {
    const acct = accountId !== null ? sql`AND c.account_id = ${accountId}` : sql.empty
    return sql`SELECT 'comment' AS content_type, c.id AS id, c.account_id AS account_id,
        a.name AS author_name, a.relation AS relation, a.trusted AS author_trusted, c.status AS status,
        c.created_at AS created_at, c.message AS message,
        c.target_type AS target_type, c.target_id AS target_id,
        NULL AS file_key, NULL AS kind, NULL AS caption, NULL AS needs_display
      FROM comments c JOIN accounts a ON a.id = c.account_id
      WHERE c.status = ${status} AND c.deleted_at IS NULL ${acct}`
  }
  const acct = accountId !== null ? sql`AND m.account_id = ${accountId}` : sql.empty
  return sql`SELECT 'media' AS content_type, m.id AS id, m.account_id AS account_id,
      a.name AS author_name, a.relation AS relation, a.trusted AS author_trusted, m.status AS status,
      m.created_at AS created_at, NULL AS message,
      NULL AS target_type, NULL AS target_id,
      m.file_key AS file_key, m.kind AS kind, m.caption AS caption, m.needs_display AS needs_display
    FROM media m LEFT JOIN accounts a ON a.id = m.account_id
    WHERE m.status = ${status} AND m.deleted_at IS NULL AND m.section != ${MEDIA_SECTION.CONTENT} ${acct}`
}

/** @type {Types.getModerationQueue} */
export function getModerationQueue({ type = null, status = "pending", accountId = null, limit, offset }) {
  const types = type ? [type] : ["guestbook", "media", "comment"]
  const selects = types.map((t) =>
    typeSelect(/** @type {'guestbook' | 'media' | 'comment'} */ (t), status, accountId),
  )
  const union = sql.join(selects, " UNION ALL ")
  return sql`SELECT * FROM (${union})
    ORDER BY created_at DESC, content_type ASC, id DESC
    LIMIT ${limit} OFFSET ${offset}`.all()
}

/**
 * Move every row an account owns in `fromStatus` (across the three content
 * tables) to `toStatus`, stamping reviewed_at. Caller wraps in withTransaction.
 * @param {number} accountId
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {number} total rows changed
 */
function bulkTransitionForAccount(accountId, fromStatus, toStatus) {
  const ts = now()
  let changed = 0
  changed += Number(sql`UPDATE guestbook_entries SET status = ${toStatus}, reviewed_at = ${ts}
    WHERE account_id = ${accountId} AND status = ${fromStatus} AND deleted_at IS NULL`.run().changes)
  changed += Number(sql`UPDATE comments SET status = ${toStatus}, reviewed_at = ${ts}
    WHERE account_id = ${accountId} AND status = ${fromStatus} AND deleted_at IS NULL`.run().changes)
  changed += Number(sql`UPDATE media SET status = ${toStatus}, reviewed_at = ${ts}
    WHERE account_id = ${accountId} AND status = ${fromStatus} AND deleted_at IS NULL`.run().changes)
  return changed
}

/** @type {Types.approvePendingForAccount} */
export function approvePendingForAccount(accountId) {
  // Bulk-release one author's pending backlog (trust with approve_pending, and
  // "approve & release" from the queue).
  return bulkTransitionForAccount(accountId, "pending", "approved")
}

/** @type {Types.hideApprovedContentForAccount} */
export function hideApprovedContentForAccount(accountId) {
  // Account soft-delete: pull this author's live content offline (reversible —
  // files are kept; only reject/self-delete unlink).
  return bulkTransitionForAccount(accountId, "approved", "hidden")
}
