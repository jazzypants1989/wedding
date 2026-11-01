/** @file Media item database operations */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"
import { MEDIA_SECTION, isCuratedMediaSection } from "../types.js"

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

  // Guest is a newest-first keyset feed; a curated section (official,
  // honeymoon) is a single sort_order page (no cursor — it stays small), so the
  // `before` filter applies to guest only.
  const isCurated = isCuratedMediaSection(section)
  const beforeFilter =
    !isCurated && before !== null ? sql`AND m.id < ${before}` : sql.empty
  const ordering = isCurated
    ? sql`m.sort_order, m.id`
    : sql`m.id DESC`

  return sql`SELECT m.id, m.file_key, m.account_id, m.kind, m.section, m.status,
      m.caption, m.width, m.height, m.duration_seconds, m.needs_display,
      m.created_at, a.name AS author_name, ${isOwn} AS is_own
    FROM media m
    LEFT JOIN accounts a ON a.id = m.account_id
    WHERE m.deleted_at IS NULL
      AND (m.account_id IS NULL OR a.deleted_at IS NULL)
      AND m.section = ${section}
      AND (m.status = 'approved' ${ownPending})
      ${beforeFilter}
    ORDER BY ${ordering}
    LIMIT ${limit}`.all()
}

/** @type {Types.listGuestMediaByReactions} */
export function listGuestMediaByReactions(limit) {
  // "Most loved" curation (A3): approved guest media ranked by TOTAL reaction
  // count across all emojis. Reactions are polymorphic (target_type='media',
  // target_id=media.id), aggregated in a subquery so a media row with no
  // reactions still returns (COALESCE → 0). This is a single capped page — a
  // reaction count isn't a stable keyset cursor (ties + mutable counts), so we
  // don't paginate it; the cap keeps it a bounded curation view, not a feed.
  return sql`SELECT m.id, m.file_key, m.kind, m.caption, m.width, m.height,
      m.needs_display, m.created_at, a.name AS author_name,
      COALESCE(r.cnt, 0) AS reaction_count
    FROM media m
    LEFT JOIN accounts a ON a.id = m.account_id
    LEFT JOIN (
      SELECT target_id, COUNT(*) AS cnt
      FROM reactions
      WHERE target_type = 'media'
      GROUP BY target_id
    ) r ON r.target_id = m.id
    WHERE m.deleted_at IS NULL
      AND (m.account_id IS NULL OR a.deleted_at IS NULL)
      AND m.section = 'guest'
      AND m.status = 'approved'
    ORDER BY reaction_count DESC, m.id DESC
    LIMIT ${limit}`.all()
}

/** @type {Types.getMediaFeedRowById} */
export function getMediaFeedRowById(id, callerId = null) {
  // Single-item form of getMediaFeed for ?item= deep links: same LEFT JOIN +
  // is_own shape so the API applies an identical visibility gate. Excludes
  // soft-deleted rows and rows whose author account is soft-deleted (→ undefined
  // → 404), while staying null-tolerant so admin/official uploads (account_id
  // NULL) remain visible; the caller gates on status. Also excludes the 'content'
  // section so admin site-content images (dress-code figures) are never publicly
  // deep-linked, nor targetable by comments/reactions (this same query backs
  // db/targets.js's visibility gate).
  const isOwn = callerId !== null ? sql`(m.account_id = ${callerId})` : sql`0`
  return sql`SELECT m.id, m.file_key, m.account_id, m.kind, m.section, m.status,
      m.caption, m.width, m.height, m.duration_seconds, m.needs_display,
      m.created_at, a.name AS author_name, ${isOwn} AS is_own
    FROM media m
    LEFT JOIN accounts a ON a.id = m.account_id
    WHERE m.id = ${id} AND m.deleted_at IS NULL
      AND (m.account_id IS NULL OR a.deleted_at IS NULL)
      AND m.section != ${MEDIA_SECTION.CONTENT}`.get()
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

/** @type {Types.setMediaSourceSha256} */
export function setMediaSourceSha256(id, sha256) {
  sql`UPDATE media SET source_sha256 = ${sha256} WHERE id = ${id}`.run()
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

/** @type {Types.getCuratedMediaIds} */
export function getCuratedMediaIds(section) {
  /** @type {{ id: number }[]} */
  const rows = sql`SELECT id FROM media
    WHERE section = ${section} AND deleted_at IS NULL
    ORDER BY sort_order, id`.all()
  return rows.map((r) => r.id)
}

/** @type {Types.setMediaSortOrders} */
export function setMediaSortOrders(ids, section) {
  // Caller wraps this in withTransaction. sort_order = array index; only rows of
  // this curated section, non-deleted, are touched (the API validates the id set
  // first).
  for (let i = 0; i < ids.length; i++) {
    sql`UPDATE media SET sort_order = ${i}
      WHERE id = ${ids[i]} AND section = ${section} AND deleted_at IS NULL`.run()
  }
}

/** @type {Types.moveCuratedMedia} */
export function moveCuratedMedia(id, toSection) {
  // MOVE a curated item into the other curated section (official ⇄ honeymoon),
  // appended at the end of that section's order — the same insertion promote
  // uses. Reactions and comments key on media.id, so they travel with it. A
  // guest or content item is never moved here (promote is the guest → official
  // path), and a move into the section it is already in changes nothing.
  const result = sql`UPDATE media
    SET section = ${toSection},
        sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM media
                      WHERE section = ${toSection} AND deleted_at IS NULL)
    WHERE id = ${id} AND deleted_at IS NULL
      AND section IN (${MEDIA_SECTION.OFFICIAL}, ${MEDIA_SECTION.HONEYMOON})
      AND section != ${toSection}`.run()
  return result.changes > 0
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

/** @type {Types.softDeleteContentMediaByFileKey} */
export function softDeleteContentMediaByFileKey(fileKey) {
  const result = sql`UPDATE media SET deleted_at = ${now()}
    WHERE file_key = ${fileKey} AND section = ${MEDIA_SECTION.CONTENT} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.softDeleteMediaByFileKey} */
export function softDeleteMediaByFileKey(fileKey) {
  // Reconciles the byte sums when the sweep purges a rejected item's quarantined
  // files: the bytes are gone from disk, so drop the row from the sums (which
  // filter deleted_at IS NULL).
  const result = sql`UPDATE media SET deleted_at = ${now()}
    WHERE file_key = ${fileKey} AND deleted_at IS NULL`.run()
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
  // LEFT JOIN + null-tolerant author gate: a soft-deleted uploader's pending items
  // drop out of the badge, while admin/official uploads (account_id NULL) still
  // count. Keeps this in step with the media branch of the combined queue.
  /** @type {import('./types.js').CountResult | undefined} */
  const result = sql`SELECT COUNT(*) AS count FROM media m
    LEFT JOIN accounts a ON a.id = m.account_id
    WHERE m.status = 'pending' AND m.deleted_at IS NULL
      AND (m.account_id IS NULL OR a.deleted_at IS NULL)`.get()
  return result ? result.count : 0
}

/** @type {Types.getGuestContributors} */
export function getGuestContributors(limit = 24) {
  // Contributors strip for the guest section (04 gallery "wow pack"): distinct
  // author names of *visible* guest uploads, ordered by contribution, plus the
  // total photo + distinct-guest counts. Mirrors the getMediaFeed visibility
  // gate exactly — approved, not soft-deleted, and the uploader account not
  // soft-deleted — so a hidden/pending/deleted upload (or a removed account)
  // never credits a name. Guest uploads always carry an account_id, so a plain
  // JOIN is correct here (official/admin uploads with NULL account_id are a
  // different section and excluded by section='guest').
  /** @type {{ name: string, n: number }[]} */
  const rows = sql`SELECT a.name AS name, COUNT(*) AS n
    FROM media m
    JOIN accounts a ON a.id = m.account_id
    WHERE m.section = 'guest' AND m.status = 'approved'
      AND m.deleted_at IS NULL AND a.deleted_at IS NULL
    GROUP BY a.id
    ORDER BY n DESC, a.name ASC`.all()
  let photos = 0
  for (const r of rows) photos += r.n
  return {
    photos,
    guests: rows.length,
    names: rows.slice(0, limit).map((r) => r.name),
  }
}

/** @type {Types.countApprovedGuestMedia} */
export function countApprovedGuestMedia() {
  // Public "moments shared" tally for the landing page. Same visibility gate as
  // the guest feed / contributors strip (approved, not deleted, live account).
  /** @type {import('./types.js').CountResult | undefined} */
  const result = sql`SELECT COUNT(*) AS count FROM media m
    JOIN accounts a ON a.id = m.account_id
    WHERE m.section = 'guest' AND m.status = 'approved'
      AND m.deleted_at IS NULL AND a.deleted_at IS NULL`.get()
  return result ? result.count : 0
}

/** @type {Types.sumOriginalBytes} */
export function sumOriginalBytes() {
  // Global disk guard. Counts every row whose files are still on the data volume:
  // 'uploading' presses its declared bytes so in-flight uploads count; hidden and
  // *rejected* rows keep their files (rejected → quarantine/, same disk) so they
  // count too. Only soft-deleted rows (self-delete rmSync, or a swept quarantine
  // dir) are excluded — their bytes are genuinely gone.
  /** @type {import('./types.js').SumResult | undefined} */
  const result = sql`SELECT COALESCE(SUM(original_bytes), 0) AS total FROM media
    WHERE deleted_at IS NULL`.get()
  return result ? result.total : 0
}

/** @type {Types.sumOriginalBytesForAccount} */
export function sumOriginalBytesForAccount(accountId) {
  /** @type {import('./types.js').SumResult | undefined} */
  const result = sql`SELECT COALESCE(SUM(original_bytes), 0) AS total FROM media
    WHERE account_id = ${accountId} AND deleted_at IS NULL`.get()
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
