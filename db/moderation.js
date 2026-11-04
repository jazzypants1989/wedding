/** @file Cross-type moderation queries (Phase 6): a combined queue over the three
 *  moderatable tables (guestbook_entries, media, comments) plus per-account bulk
 *  transitions used by trust/auto-trust and account soft-delete. The `type`
 *  filter is validated by the caller against a fixed allowlist — never
 *  interpolated into SQL here. */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"
import { liveCommentParentFilter } from "./comments.js"
import { MEDIA_SECTION, MEDIA_STATUS } from "../types.js"

/**
 * `status = …` for one branch, or nothing when `status` is null (a single-item
 * lookup and the per-author counts read every status).
 * @param {string} column @param {string | null} status
 * @returns {import('./sql.js').SqlFragment}
 */
function statusIs(column, status) {
  return status === null ? sql.empty : sql`AND ${sql.raw(column)} = ${status}`
}

/**
 * Build one type's contribution to the combined queue. Every branch projects the
 * SAME 18 columns (NULL-filled where a column doesn't apply) so the UNION ALL is
 * well-formed. Media uses a LEFT JOIN (official uploads have account_id NULL).
 * A soft-deleted author's rows drop out of every branch (the admin removed that
 * person; media stays null-tolerant so admin uploads survive), and the comment
 * branch additionally hides comments whose parent target is no longer live — the
 * same gate the standalone comment queue/count use, so all consumers agree.
 * The comment branch also carries parent context (snippet/author/file_key/kind)
 * via correlated subqueries so the moderation detail can show what a comment is
 * ON; guestbook/media branches NULL-fill those four columns.
 * @param {'guestbook' | 'media' | 'comment'} type
 * @param {string | null} status null = every status
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
        NULL AS file_key, NULL AS kind, NULL AS caption, NULL AS needs_display,
        NULL AS parent_snippet, NULL AS parent_author, NULL AS parent_file_key, NULL AS parent_kind
      FROM guestbook_entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.deleted_at IS NULL AND a.deleted_at IS NULL ${statusIs("e.status", status)} ${acct}`
  }
  if (type === "comment") {
    const acct = accountId !== null ? sql`AND c.account_id = ${accountId}` : sql.empty
    return sql`SELECT 'comment' AS content_type, c.id AS id, c.account_id AS account_id,
        a.name AS author_name, a.relation AS relation, a.trusted AS author_trusted, c.status AS status,
        c.created_at AS created_at, c.message AS message,
        c.target_type AS target_type, c.target_id AS target_id,
        NULL AS file_key, NULL AS kind, NULL AS caption, NULL AS needs_display,
        CASE c.target_type
          WHEN 'guestbook' THEN (SELECT ge.message FROM guestbook_entries ge WHERE ge.id = c.target_id)
          WHEN 'media' THEN (SELECT m.caption FROM media m WHERE m.id = c.target_id)
        END AS parent_snippet,
        CASE c.target_type
          WHEN 'guestbook' THEN (SELECT pa.name FROM guestbook_entries ge
            JOIN accounts pa ON pa.id = ge.account_id WHERE ge.id = c.target_id)
          WHEN 'media' THEN (SELECT pa.name FROM media m
            JOIN accounts pa ON pa.id = m.account_id WHERE m.id = c.target_id)
        END AS parent_author,
        CASE c.target_type
          WHEN 'media' THEN (SELECT m.file_key FROM media m WHERE m.id = c.target_id)
        END AS parent_file_key,
        CASE c.target_type
          WHEN 'media' THEN (SELECT m.kind FROM media m WHERE m.id = c.target_id)
        END AS parent_kind
      FROM comments c JOIN accounts a ON a.id = c.account_id
      WHERE c.deleted_at IS NULL AND a.deleted_at IS NULL ${statusIs("c.status", status)}
        AND ${liveCommentParentFilter()} ${acct}`
  }
  const acct = accountId !== null ? sql`AND m.account_id = ${accountId}` : sql.empty
  // Review is about guest content. A hidden curated photo is usually a culled import,
  // and could bury hidden guest posts, so it's managed from Gallery → Hidden. Only the
  // Hidden list leaves it out: a deep link (status null) still resolves.
  const culled =
    status === MEDIA_STATUS.HIDDEN
      ? sql`AND m.section NOT IN (${MEDIA_SECTION.OFFICIAL}, ${MEDIA_SECTION.HONEYMOON})`
      : sql.empty
  return sql`SELECT 'media' AS content_type, m.id AS id, m.account_id AS account_id,
      a.name AS author_name, a.relation AS relation, a.trusted AS author_trusted, m.status AS status,
      m.created_at AS created_at, NULL AS message,
      NULL AS target_type, NULL AS target_id,
      m.file_key AS file_key, m.kind AS kind, m.caption AS caption, m.needs_display AS needs_display,
      NULL AS parent_snippet, NULL AS parent_author, NULL AS parent_file_key, NULL AS parent_kind
    FROM media m LEFT JOIN accounts a ON a.id = m.account_id
    WHERE m.deleted_at IS NULL ${statusIs("m.status", status)}
      AND (m.account_id IS NULL OR a.deleted_at IS NULL)
      AND m.section != ${MEDIA_SECTION.CONTENT} ${culled} ${acct}`
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

/** @type {Types.getModerationItem} */
export function getModerationItem(type, id) {
  // Any status: a deep link to a post that has since been decided resolves to
  // "this is now approved", never a 404 (IA §1.4). Same projection as the queue.
  return sql`SELECT * FROM (${typeSelect(type, null, null)}) WHERE id = ${id}`.get()
}

/** @type {Types.getModerationStatusCounts} */
export function getModerationStatusCounts(accountId) {
  // Counted over the same three branches the queue reads, so "Approve their 3
  // waiting" names exactly the rows the queue shows for this author.
  const union = sql.join(
    ["guestbook", "media", "comment"].map((t) =>
      typeSelect(/** @type {'guestbook' | 'media' | 'comment'} */ (t), null, accountId),
    ),
    " UNION ALL ",
  )
  /** @type {{ status: string, n: number }[]} */
  const rows = sql`SELECT status, COUNT(*) AS n FROM (${union}) GROUP BY status`.all()
  const counts = { pending: 0, approved: 0, hidden: 0, rejected: 0 }
  for (const row of rows) {
    if (row.status === "pending") counts.pending = row.n
    else if (row.status === "approved") counts.approved = row.n
    else if (row.status === "hidden") counts.hidden = row.n
    else if (row.status === "rejected") counts.rejected = row.n
  }
  return counts
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
