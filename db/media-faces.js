/** @file Face pipeline database operations (docs/post-wedding/SPEC-vision-lab.md §10) */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"

/** @type {Types.insertFace} */
export function insertFace({
  mediaId,
  bbox,
  landmarks,
  signals,
  descriptor,
  modelVersion,
  source,
}) {
  const s = signals ?? {}
  const result = sql`INSERT INTO media_faces (
      media_id, bbox_x, bbox_y, bbox_w, bbox_h, landmarks,
      signal_score, signal_boxPx, signal_borderPx, signal_eyeRatio, signal_eyeAngle,
      signal_alignScale, signal_residual, signal_outsideFraction, signal_sharpness,
      descriptor, model_version, source
    ) VALUES (
      ${mediaId}, ${bbox.x}, ${bbox.y}, ${bbox.w}, ${bbox.h},
      ${landmarks ? JSON.stringify(landmarks) : null},
      ${s.score ?? null}, ${s.boxPx ?? null}, ${s.borderPx ?? null}, ${s.eyeRatio ?? null},
      ${s.eyeAngle ?? null}, ${s.alignScale ?? null}, ${s.residual ?? null},
      ${s.outsideFraction ?? null}, ${s.sharpness ?? null},
      ${descriptor ?? null}, ${modelVersion}, ${source}
    )`.run()
  return /** @type {import('../types.js').MediaFace} */ (
    getFaceById(Number(result.lastInsertRowid))
  )
}

/** @type {Types.getFaceById} */
export function getFaceById(id) {
  return sql`SELECT * FROM media_faces WHERE id = ${id}`.get()
}

/** @type {Types.facesForMedia} */
export function facesForMedia(mediaId) {
  return sql`SELECT * FROM media_faces
    WHERE media_id = ${mediaId} AND deleted_at IS NULL
    ORDER BY id`.all()
}

/** @type {Types.setFaceIdentity} */
export function setFaceIdentity(id, identityId) {
  const result = sql`UPDATE media_faces SET face_identity_id = ${identityId}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.softDeleteFace} */
export function softDeleteFace(id) {
  const result = sql`UPDATE media_faces SET deleted_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.createIdentity} */
export function createIdentity({ guestId, confirmedBy = null, confirmedAt = null, provenance = "confirmed" }) {
  const result = sql`INSERT INTO face_identities (guest_id, confirmed_by, confirmed_at, provenance)
    VALUES (${guestId}, ${confirmedBy}, ${confirmedAt}, ${provenance})`.run()
  return /** @type {import('../types.js').FaceIdentity} */ (
    getIdentityById(Number(result.lastInsertRowid))
  )
}

/** @type {Types.getIdentityById} */
export function getIdentityById(id) {
  return sql`SELECT * FROM face_identities WHERE id = ${id} AND deleted_at IS NULL`.get()
}

/** @type {Types.identitiesForGuest} */
export function identitiesForGuest(guestId) {
  return sql`SELECT * FROM face_identities
    WHERE guest_id = ${guestId} AND deleted_at IS NULL
    ORDER BY id`.all()
}

/** @type {Types.softDeleteIdentity} */
export function softDeleteIdentity(id) {
  const result = sql`UPDATE face_identities SET deleted_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.mediaWithFaces} */
export function mediaWithFaces(mediaIds) {
  // "Which of these media ids have at least one live face row" — feed/gallery
  // enrichment shape (mirrors getCommentCounts' empty-array guard: sql.list()
  // throws on an empty array, so guard here too rather than push that onto
  // every caller).
  if (mediaIds.length === 0) return new Set()
  /** @type {{ media_id: number }[]} */
  const rows = sql`SELECT DISTINCT media_id FROM media_faces
    WHERE media_id IN ${sql.list(mediaIds)} AND deleted_at IS NULL`.all()
  return new Set(rows.map((r) => r.media_id))
}
