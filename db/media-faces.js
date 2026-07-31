/** @file Face pipeline database operations (docs/post-wedding/SPEC-vision-lab.md §10) */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"

/**
 * A descriptor as it is stored: 4 bytes per float, little-endian, no header —
 * just the raw component values in order. Explicit LE (via Buffer's
 * writeFloatLE/readFloatLE) rather than a raw Float32Array.buffer view, so the
 * bytes on disk mean the same thing regardless of the host's native endianness
 * (every platform this runs on today is LE, but the column should not silently
 * depend on that staying true).
 * @type {Types.descriptorToBlob}
 */
export function descriptorToBlob(vector) {
  const buf = Buffer.alloc(vector.length * 4)
  for (let i = 0; i < vector.length; i++) buf.writeFloatLE(vector[i], i * 4)
  return buf
}

/** @type {Types.blobToDescriptor} */
export function blobToDescriptor(blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength)
  const out = new Float32Array(buf.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4)
  return out
}

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

/** @type {Types.getFaceCounts} */
export function getFaceCounts() {
  /** @type {{ faces: number, identified: number, unidentified: number, notAFace: number } | undefined} */
  const row = sql`SELECT
      SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS faces,
      SUM(CASE WHEN deleted_at IS NULL AND face_identity_id IS NOT NULL THEN 1 ELSE 0 END) AS identified,
      SUM(CASE WHEN deleted_at IS NULL AND face_identity_id IS NULL THEN 1 ELSE 0 END) AS unidentified,
      SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS notAFace
    FROM media_faces`.get()
  // SQLite's SUM() returns NULL over an empty table, not 0.
  return {
    faces: row?.faces ?? 0,
    identified: row?.identified ?? 0,
    unidentified: row?.unidentified ?? 0,
    notAFace: row?.notAFace ?? 0,
  }
}

/** @type {Types.unidentifiedFacesWithDescriptors} */
export function unidentifiedFacesWithDescriptors() {
  return sql`SELECT id, media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, descriptor
    FROM media_faces
    WHERE deleted_at IS NULL AND face_identity_id IS NULL AND descriptor IS NOT NULL
    ORDER BY id`.all()
}

/**
 * Every live face assigned to a CONFIRMED identity (never 'propagated' — those
 * must never seed a prototype, SPEC §9/schema.js), restricted to one descriptor
 * model version so a match never mixes descriptor spaces. One row per face;
 * the caller groups by identity_id to build one prototype per identity.
 * @type {Types.confirmedIdentityFaces}
 */
export function confirmedIdentityFaces(modelVersion) {
  return sql`SELECT fi.id AS identity_id, fi.guest_id AS guest_id, g.name AS guest_name,
      mf.id AS face_id, mf.descriptor AS descriptor
    FROM face_identities fi
    JOIN guests g ON g.id = fi.guest_id
    JOIN media_faces mf ON mf.face_identity_id = fi.id
      AND mf.deleted_at IS NULL AND mf.descriptor IS NOT NULL AND mf.model_version = ${modelVersion}
    WHERE fi.deleted_at IS NULL AND fi.provenance = 'confirmed'
    ORDER BY fi.id, mf.id`.all()
}

/**
 * Live faces for one photo, each with the guest name if identified (LEFT JOIN
 * through face_identities → guests). NEVER selects the descriptor column —
 * this is the shape the per-photo admin view returns straight to JSON.
 * @type {Types.facesForMediaWithNames}
 */
export function facesForMediaWithNames(mediaId) {
  return sql`SELECT mf.id AS id, mf.media_id AS media_id,
      mf.bbox_x AS bbox_x, mf.bbox_y AS bbox_y, mf.bbox_w AS bbox_w, mf.bbox_h AS bbox_h,
      mf.face_identity_id AS face_identity_id,
      g.id AS guest_id, g.name AS guest_name
    FROM media_faces mf
    LEFT JOIN face_identities fi ON fi.id = mf.face_identity_id AND fi.deleted_at IS NULL
    LEFT JOIN guests g ON g.id = fi.guest_id
    WHERE mf.media_id = ${mediaId} AND mf.deleted_at IS NULL
    ORDER BY mf.id`.all()
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
