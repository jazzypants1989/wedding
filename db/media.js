/** @file Media item database operations */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"

// Fixed variant -> byte-column map. Variant strings arrive from a frozen route
// allowlist, but we still resolve the column through this object (never
// interpolate a param) so a column name can never be attacker-influenced.
/** @type {Record<string, string>} */
const BYTES_COLUMN = {
  original: "original_bytes",
  display: "display_bytes",
  thumb: "thumb_bytes",
  poster: "poster_bytes",
  w400: "w400_bytes",
  w800: "w800_bytes",
  w1600: "w1600_bytes",
}

/** @type {Types.createMediaRow} */
export function createMediaRow({ fileKey, accountId, kind, section, originalBytes }) {
  const result = sql`INSERT INTO media (file_key, account_id, kind, section, status, original_bytes)
    VALUES (${fileKey}, ${accountId}, ${kind}, ${section}, 'uploading', ${originalBytes})`.run()
  return /** @type {import('../types.js').Media} */ (
    getMediaById(Number(result.lastInsertRowid))
  )
}

/** @type {Types.getMediaById} */
export function getMediaById(id) {
  return sql`SELECT * FROM media WHERE id = ${id}`.get()
}

/** @type {Types.getMediaByFileKey} */
export function getMediaByFileKey(fileKey) {
  return sql`SELECT * FROM media WHERE file_key = ${fileKey}`.get()
}

/** @type {Types.getMediaFeed} */
export function getMediaFeed({ callerId = null, section, before = null, limit }) {
  // Mirrors getGuestbookFeed, with two differences: the accounts join is a
  // LEFT JOIN (admin/official uploads have account_id NULL, so author_name comes
  // back null and the API coalesces it), and ordering/keyset differ per section.
  // A signed-in caller also sees their OWN pending items; anonymous callers see
  // approved only. `is_own` flags the caller's rows for the pending chip.
  const ownPending =
    callerId !== null
      ? sql`OR (m.status = 'pending' AND m.account_id = ${callerId})`
      : sql.empty
  const isOwn =
    callerId !== null ? sql`(m.account_id = ${callerId})` : sql`0`

  // Guest is a newest-first keyset feed; official is a single sort_order page
  // (no cursor — it stays small), so the `before` filter applies to guest only.
  const isOfficial = section === "official"
  const beforeFilter =
    !isOfficial && before !== null ? sql`AND m.id < ${before}` : sql.empty
  const ordering = isOfficial
    ? sql`m.sort_order, m.id`
    : sql`m.id DESC`

  return sql`SELECT m.id, m.file_key, m.account_id, m.kind, m.section, m.status,
      m.caption, m.width, m.height, m.duration_seconds, m.needs_display,
      m.created_at, a.name AS author_name, ${isOwn} AS is_own
    FROM media m
    LEFT JOIN accounts a ON a.id = m.account_id
    WHERE m.deleted_at IS NULL
      AND m.section = ${section}
      AND (m.status = 'approved' ${ownPending})
      ${beforeFilter}
    ORDER BY ${ordering}
    LIMIT ${limit}`.all()
}

/** @type {Types.getMediaFeedRowById} */
export function getMediaFeedRowById(id, callerId = null) {
  // Single-item form of getMediaFeed for ?item= deep links: same LEFT JOIN +
  // is_own shape so the API applies an identical visibility gate. Excludes
  // soft-deleted rows (→ undefined → 404); the caller gates on status. Also
  // excludes the 'content' section so admin site-content images (dress-code
  // figures) are never publicly deep-linked, nor targetable by comments/
  // reactions (this same query backs db/targets.js's visibility gate).
  const isOwn = callerId !== null ? sql`(m.account_id = ${callerId})` : sql`0`
  return sql`SELECT m.id, m.file_key, m.account_id, m.kind, m.section, m.status,
      m.caption, m.width, m.height, m.duration_seconds, m.needs_display,
      m.created_at, a.name AS author_name, ${isOwn} AS is_own
    FROM media m
    LEFT JOIN accounts a ON a.id = m.account_id
    WHERE m.id = ${id} AND m.deleted_at IS NULL AND m.section != 'content'`.get()
}

/** @type {Types.setMediaVariantBytes} */
export function setMediaVariantBytes(id, variant, bytes) {
  const column = BYTES_COLUMN[variant]
  if (!column) throw new Error(`Unknown media variant: ${variant}`)
  sql`UPDATE media SET ${sql.identifier(column)} = ${bytes} WHERE id = ${id}`.run()
}

/** @type {Types.setMediaOriginalExt} */
export function setMediaOriginalExt(id, ext) {
  sql`UPDATE media SET original_ext = ${ext} WHERE id = ${id}`.run()
}

/** @type {Types.finalizeMedia} */
export function finalizeMedia(id, { width, height, durationS, needsDisplay, status }) {
  // The status='uploading' guard makes this a no-op on an already-finalized row
  // (the API checks status first for the idempotent re-finalize path).
  sql`UPDATE media SET
      width = ${width}, height = ${height},
      duration_seconds = ${durationS ?? null},
      needs_display = ${needsDisplay ? 1 : 0},
      status = ${status}
    WHERE id = ${id} AND status = 'uploading'`.run()
  return /** @type {import('../types.js').Media} */ (getMediaById(id))
}

/** @type {Types.setMediaStatus} */
export function setMediaStatus(id, fromStatuses, toStatus) {
  const result = sql`UPDATE media
    SET status = ${toStatus}, reviewed_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL AND status IN ${sql.list(fromStatuses)}`.run()
  return result.changes > 0
}

/** @type {Types.getOfficialMediaIds} */
export function getOfficialMediaIds() {
  /** @type {{ id: number }[]} */
  const rows = sql`SELECT id FROM media
    WHERE section = 'official' AND deleted_at IS NULL
    ORDER BY sort_order, id`.all()
  return rows.map((r) => r.id)
}

/** @type {Types.setMediaSortOrders} */
export function setMediaSortOrders(ids) {
  // Caller wraps this in withTransaction. sort_order = array index; only official,
  // non-deleted rows are touched (the API validates the id set first).
  for (let i = 0; i < ids.length; i++) {
    sql`UPDATE media SET sort_order = ${i}
      WHERE id = ${ids[i]} AND section = 'official' AND deleted_at IS NULL`.run()
  }
}

/** @type {Types.promoteMediaToOfficial} */
export function promoteMediaToOfficial(id) {
  // MOVE (not copy) a guest item into the official section, appended at the end
  // (same insertion behavior as admin-upload finalize). The item leaves the guest
  // feed. Only an approved guest item can be promoted.
  const result = sql`UPDATE media
    SET section = 'official',
        sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM media
                      WHERE section = 'official' AND deleted_at IS NULL)
    WHERE id = ${id} AND section = 'guest' AND deleted_at IS NULL
      AND status = 'approved'`.run()
  return result.changes > 0
}

/** @type {Types.updateMediaCaption} */
export function updateMediaCaption(id, caption) {
  const result = sql`UPDATE media SET caption = ${caption}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.softDeleteMedia} */
export function softDeleteMedia(id) {
  const result = sql`UPDATE media SET deleted_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.hardDeleteMedia} */
export function hardDeleteMedia(id) {
  // Only for abandoned 'uploading' rows the sweep removes — they never went
  // public and carry no audit value, unlike self-deleted/rejected content.
  sql`DELETE FROM media WHERE id = ${id}`.run()
}

/** @type {Types.countPendingMedia} */
export function countPendingMedia() {
  /** @type {import('./types.js').CountResult | undefined} */
  const result = sql`SELECT COUNT(*) AS count FROM media
    WHERE status = 'pending' AND deleted_at IS NULL`.get()
  return result ? result.count : 0
}

/** @type {Types.sumOriginalBytes} */
export function sumOriginalBytes() {
  // Global disk guard. Excludes soft-deleted and rejected rows (their files are
  // unlinked); 'uploading' rows count their declared bytes so in-flight uploads
  // press against the cap. hidden rows keep their files, so they count.
  /** @type {import('./types.js').SumResult | undefined} */
  const result = sql`SELECT COALESCE(SUM(original_bytes), 0) AS total FROM media
    WHERE deleted_at IS NULL AND status != 'rejected'`.get()
  return result ? result.total : 0
}

/** @type {Types.sumOriginalBytesForAccount} */
export function sumOriginalBytesForAccount(accountId) {
  /** @type {import('./types.js').SumResult | undefined} */
  const result = sql`SELECT COALESCE(SUM(original_bytes), 0) AS total FROM media
    WHERE account_id = ${accountId} AND deleted_at IS NULL AND status != 'rejected'`.get()
  return result ? result.total : 0
}

/** @type {Types.getAbandonedUploads} */
export function getAbandonedUploads(modifier) {
  // Cutoff computed in SQLite so it matches the CURRENT_TIMESTAMP column format
  // exactly (e.g. modifier = '-6 hours').
  return sql`SELECT id, file_key, original_ext FROM media
    WHERE status = 'uploading' AND created_at < datetime('now', ${modifier})`.all()
}

/** @type {Types.getAllMediaFileKeys} */
export function getAllMediaFileKeys() {
  return sql`SELECT file_key FROM media`.all()
}

/** @type {Types.getFinalizedMediaForIntegrity} */
export function getFinalizedMediaForIntegrity() {
  // Rows whose variant files must exist on disk: finalized (not 'uploading'),
  // not soft-deleted, not rejected. The integrity pass computes each row's
  // expected variants (needs_display rows legitimately lack display/thumb).
  return sql`SELECT id, file_key, kind, section, original_ext, needs_display, poster_bytes
    FROM media
    WHERE status IN ('pending', 'approved', 'hidden') AND deleted_at IS NULL`.all()
}
