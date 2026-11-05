/** @file Black-and-white twins: a colour photo (the primary) and a black-and-white
 *  copy of it (the twin, `media.twin_of` = the primary's id) are one photo.
 *
 *  Nothing here decides which photo is grayscale — that needs pixels, and the
 *  server has no decoder (CLAUDE.md: zero dependencies). The candidates query
 *  offers rows that COULD be twins by their metadata (same capture time, same
 *  dimensions, same section); the admin's browser looks at the thumbnails and
 *  proposes; a human confirms; pairTwin records it. The schema triggers
 *  (add_media_twins) refuse any shape this module would refuse, too. */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { MEDIA_SECTION } from "../types.js"

/** Statuses a twin or a primary may have: files in place, finished uploading. */
const PAIRABLE_STATUSES = ["pending", "approved", "hidden"]
/** The sections a gallery photo lives in. Never 'content'. */
const GALLERY_SECTIONS = [MEDIA_SECTION.OFFICIAL, MEDIA_SECTION.HONEYMOON, MEDIA_SECTION.GUEST]

/** @type {Types.getLiveTwinOf} */
export function getLiveTwinOf(primaryId) {
  return sql`SELECT * FROM media WHERE twin_of = ${primaryId} AND deleted_at IS NULL`.get()
}

/** @type {Types.pairTwin} */
export function pairTwin(primaryId, twinId) {
  // The API has checked everything a person needs to be told about; the WHERE
  // re-checks what makes the write safe, so a race between two admin tabs can't
  // pair a row that stopped qualifying (and the trigger is the last word).
  const result = sql`UPDATE media SET twin_of = ${primaryId}
    WHERE id = ${twinId} AND twin_of IS NULL AND deleted_at IS NULL AND kind = 'image'
      AND status IN ${sql.list(PAIRABLE_STATUSES)}
      AND NOT EXISTS (
        SELECT 1 FROM media c WHERE c.twin_of = ${twinId} AND c.deleted_at IS NULL)`.run()
  return result.changes > 0
}

/** @type {Types.unpairTwin} */
export function unpairTwin(primaryId) {
  // The twin keeps its own status. It was hidden, approved or pending before it
  // was paired, and it goes back to exactly that, so pairing is reversible.
  const result = sql`UPDATE media SET twin_of = NULL WHERE twin_of = ${primaryId}`.run()
  return Number(result.changes)
}

/** @type {Types.releaseTwinsOfRemoved} */
export function releaseTwinsOfRemoved(primaryId) {
  // The colour photo is being removed. Its copy becomes its own photo again,
  // but never a public one by surprise: an approved copy comes back hidden, so
  // it waits in Gallery → Hidden for the couple to decide.
  const result = sql`UPDATE media
    SET twin_of = NULL,
        status = CASE WHEN status = 'approved' THEN 'hidden' ELSE status END
    WHERE twin_of = ${primaryId}`.run()
  return Number(result.changes)
}

/** @type {Types.mediaMissingCaptureTime} */
export function mediaMissingCaptureTime() {
  return sql`SELECT id, file_key, original_ext FROM media
    WHERE captured_at IS NULL AND deleted_at IS NULL AND kind = 'image'
      AND status IN ${sql.list(PAIRABLE_STATUSES)}
      AND section IN ${sql.list(GALLERY_SECTIONS)}
      AND original_ext IN ('jpg', 'png', 'webp')
    ORDER BY id`.all()
}

/** @type {Types.fillMediaCapturedAt} */
export function fillMediaCapturedAt(id, capturedAt) {
  // Only fills a gap. The face ingest is authoritative for the rows it touched,
  // and it writes its own format; this never overwrites that.
  const result = sql`UPDATE media SET captured_at = ${capturedAt}
    WHERE id = ${id} AND captured_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.countMediaWithoutCaptureTime} */
export function countMediaWithoutCaptureTime() {
  /** @type {{ n: number } | undefined} */
  const row = sql`SELECT COUNT(*) AS n FROM media
    WHERE captured_at IS NULL AND deleted_at IS NULL AND kind = 'image' AND twin_of IS NULL
      AND status IN ${sql.list(PAIRABLE_STATUSES)}
      AND section IN ${sql.list(GALLERY_SECTIONS)}`.get()
  return row ? row.n : 0
}

/** @type {Types.twinCandidateRows} */
export function twinCandidateRows(limit) {
  // Every unpaired live image that shares (capture time, width, height, section)
  // with at least one other. A primary that already has a twin is out: one copy
  // per photo. Ordered so a group's members are adjacent; the caller groups.
  return sql`SELECT m.id, m.file_key, m.section, m.status, m.caption, m.width, m.height,
      m.needs_display, m.captured_at
    FROM media m
    JOIN (
      SELECT captured_at, width, height, section FROM media
      WHERE deleted_at IS NULL AND kind = 'image' AND twin_of IS NULL
        AND captured_at IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL
        AND status IN ${sql.list(PAIRABLE_STATUSES)}
        AND section IN ${sql.list(GALLERY_SECTIONS)}
        AND NOT EXISTS (SELECT 1 FROM media c WHERE c.twin_of = media.id AND c.deleted_at IS NULL)
      GROUP BY captured_at, width, height, section
      HAVING COUNT(*) > 1
    ) g ON g.captured_at = m.captured_at AND g.width = m.width AND g.height = m.height
      AND g.section = m.section
    WHERE m.deleted_at IS NULL AND m.kind = 'image' AND m.twin_of IS NULL
      AND m.status IN ${sql.list(PAIRABLE_STATUSES)}
      AND NOT EXISTS (SELECT 1 FROM media c WHERE c.twin_of = m.id AND c.deleted_at IS NULL)
    ORDER BY m.section, m.captured_at, m.width, m.height, m.id
    LIMIT ${limit}`.all()
}

/** @type {Types.twinPickOptions} */
export function twinPickOptions(primary, limit) {
  // The photos a person might mean when pairing by hand: same section, unpaired,
  // live images. A metadata match comes first, then the same dimensions, then
  // whatever was uploaded nearest — a photographer's two exports of one frame
  // usually land side by side.
  const sameShot =
    primary.captured_at !== null
      ? sql`(m.captured_at = ${primary.captured_at} AND m.width IS ${primary.width}
          AND m.height IS ${primary.height})`
      : sql`0`
  return sql`SELECT m.id, m.file_key, m.section, m.status, m.caption, m.width, m.height,
      m.needs_display, m.captured_at
    FROM media m
    WHERE m.section = ${primary.section} AND m.id != ${primary.id}
      AND m.deleted_at IS NULL AND m.kind = 'image' AND m.twin_of IS NULL
      AND m.status IN ${sql.list(PAIRABLE_STATUSES)}
      AND NOT EXISTS (SELECT 1 FROM media c WHERE c.twin_of = m.id AND c.deleted_at IS NULL)
    ORDER BY ${sameShot} DESC,
      (m.width IS ${primary.width} AND m.height IS ${primary.height}) DESC,
      ABS(m.id - ${primary.id}), m.id
    LIMIT ${limit}`.all()
}
