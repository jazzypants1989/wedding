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
  route = null,
}) {
  const s = signals ?? {}
  const result = sql`INSERT INTO media_faces (
      media_id, bbox_x, bbox_y, bbox_w, bbox_h, landmarks,
      signal_score, signal_boxPx, signal_borderPx, signal_eyeRatio, signal_eyeAngle,
      signal_alignScale, signal_residual, signal_outsideFraction, signal_sharpness,
      descriptor, model_version, source,
      route_state, route_reason, route_profile
    ) VALUES (
      ${mediaId}, ${bbox.x}, ${bbox.y}, ${bbox.w}, ${bbox.h},
      ${landmarks ? JSON.stringify(landmarks) : null},
      ${s.score ?? null}, ${s.boxPx ?? null}, ${s.borderPx ?? null}, ${s.eyeRatio ?? null},
      ${s.eyeAngle ?? null}, ${s.alignScale ?? null}, ${s.residual ?? null},
      ${s.outsideFraction ?? null}, ${s.sharpness ?? null},
      ${descriptor ?? null}, ${modelVersion}, ${source},
      ${route?.state ?? null}, ${route?.reason ?? null}, ${route?.profile ?? null}
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
export function createIdentity({ personId, confirmedBy = null, confirmedAt = null, provenance = "confirmed" }) {
  const result = sql`INSERT INTO face_identities (person_id, confirmed_by, confirmed_at, provenance)
    VALUES (${personId}, ${confirmedBy}, ${confirmedAt}, ${provenance})`.run()
  return /** @type {import('../types.js').FaceIdentity} */ (
    getIdentityById(Number(result.lastInsertRowid))
  )
}

/** @type {Types.getIdentityById} */
export function getIdentityById(id) {
  return sql`SELECT * FROM face_identities WHERE id = ${id} AND deleted_at IS NULL`.get()
}

/**
 * Live identities linked to one person, id ascending. At most one per
 * provenance thanks to idx_face_identities_person, which is what makes
 * `identitiesForPerson(id).find(...)` deterministic.
 * @type {Types.identitiesForPerson}
 */
export function identitiesForPerson(personId) {
  return sql`SELECT * FROM face_identities
    WHERE person_id = ${personId} AND deleted_at IS NULL
    ORDER BY id`.all()
}

/**
 * Point every media_faces row (live or not) at a different identity — the
 * person-merge primitive. Includes soft-deleted face rows on purpose: a
 * superseded row that resurfaces must not resurrect a reference to a
 * soft-deleted identity of a soft-deleted person.
 * @type {Types.repointFaces}
 */
export function repointFaces(fromIdentityId, toIdentityId) {
  const result = sql`UPDATE media_faces SET face_identity_id = ${toIdentityId}
    WHERE face_identity_id = ${fromIdentityId}`.run()
  return Number(result.changes)
}

/** @type {Types.setIdentityPerson} */
export function setIdentityPerson(identityId, personId) {
  const result = sql`UPDATE face_identities SET person_id = ${personId}
    WHERE id = ${identityId} AND deleted_at IS NULL`.run()
  return result.changes > 0
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

// --- Quality routing (plan §8) -----------------------------------------------

/**
 * The nine gate signals plus the route columns, for a set of face ids.
 *
 * This function exists because D8 said nothing did: `media_faces` has carried
 * nine `signal_*` columns since it was created and **no query in this file
 * selected one**, so the Faces tab showed every detection including everything
 * the quality gate exists to catch. Anything that wants to grade, re-grade or
 * explain a face's routing reads it here.
 *
 * Never selects `descriptor` — this shape goes to the admin UI as JSON, and a
 * biometric vector must not ride along with a payload nobody asked to carry it.
 * @type {Types.facesWithSignals}
 */
export function facesWithSignals(faceIds) {
  if (faceIds.length === 0) return []
  return sql`SELECT id, media_id, model_version,
      signal_score, signal_boxPx, signal_borderPx, signal_eyeRatio, signal_eyeAngle,
      signal_alignScale, signal_residual, signal_outsideFraction, signal_sharpness,
      route_state, route_reason, route_profile
    FROM media_faces
    WHERE id IN ${sql.list(faceIds)} AND deleted_at IS NULL
    ORDER BY id`.all()
}

/**
 * face id -> route_state, for the ids that exist and are live.
 *
 * Deliberately a Map with MISSING entries for missing rows rather than a
 * defaulted one: a caller enforcing routing has to be able to tell "this face
 * is set_aside" from "this face id is not a live face", and those two want
 * different errors. `null` in the map is the third case — the row exists and
 * has not been graded.
 * @type {Types.routeStatesOf}
 */
export function routeStatesOf(faceIds) {
  /** @type {Map<number, import('../types.js').RouteState | null>} */
  const map = new Map()
  if (faceIds.length === 0) return map
  // The column is TEXT; the `check_media_faces_route_state_*` triggers are what
  // make the narrowing true, so this is a cast to what the schema enforces
  // rather than to what the query hopes for.
  /** @type {Array<{ id: number, route_state: import('../types.js').RouteState | null }>} */
  const rows = sql`SELECT id, route_state FROM media_faces
    WHERE id IN ${sql.list(faceIds)} AND deleted_at IS NULL`.all()
  for (const row of rows) map.set(row.id, row.route_state)
  return map
}

/**
 * Record a routing grade. `profile` travels with it so a later revision of the
 * cutoff table is an explicit re-grade of the rows whose profile is stale,
 * rather than a silent change to what an old grade meant.
 * @type {Types.setFaceRoute}
 */
export function setFaceRoute(id, verdict) {
  const result = sql`UPDATE media_faces
    SET route_state = ${verdict.state},
        route_reason = ${verdict.reason},
        route_profile = ${verdict.profile},
        updated_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/**
 * How many live faces sit in each route state, INCLUDING the ungraded ones.
 *
 * `ungraded` is a first-class count and not an omission: `route_state IS NULL`
 * means the row predates routing or was written by a path that did not grade
 * it, and a summary that silently leaves those out is the same shape of bug as
 * D8 — a number that looks complete and is not.
 * @type {Types.routeStateCounts}
 */
export function routeStateCounts() {
  /** @type {{ accept: number, ask: number, setAside: number, ungraded: number } | undefined} */
  const row = sql`SELECT
      SUM(CASE WHEN route_state = 'accept' THEN 1 ELSE 0 END) AS accept,
      SUM(CASE WHEN route_state = 'ask' THEN 1 ELSE 0 END) AS ask,
      SUM(CASE WHEN route_state = 'set_aside' THEN 1 ELSE 0 END) AS setAside,
      SUM(CASE WHEN route_state IS NULL THEN 1 ELSE 0 END) AS ungraded
    FROM media_faces WHERE deleted_at IS NULL`.get()
  // SUM() over an empty table is NULL, not 0.
  return {
    accept: row?.accept ?? 0,
    ask: row?.ask ?? 0,
    setAside: row?.setAside ?? 0,
    ungraded: row?.ungraded ?? 0,
  }
}

/**
 * Every live, undecided, descriptor-bearing face.
 *
 * ⚠ **Carries `route_state` but does NOT filter on it, deliberately.** Routing
 * decides what an admin is SHOWN; it must not decide what the clustering sees.
 * A poor-quality face inside an otherwise clean group still constrains that
 * group and still occupies its photograph — drop it here and the groups change
 * shape, the suggestions change order, and the faces that *were* worth naming
 * get worse answers. The filter belongs at the display, one layer up.
 * @type {Types.unidentifiedFacesWithDescriptors}
 */
export function unidentifiedFacesWithDescriptors() {
  return sql`SELECT id, media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, descriptor,
      route_state, route_reason
    FROM media_faces
    WHERE deleted_at IS NULL AND face_identity_id IS NULL AND descriptor IS NOT NULL
    ORDER BY id`.all()
}

/**
 * Every live face assigned to a CONFIRMED identity (never 'propagated' — those
 * must never seed a prototype, SPEC §9/schema.js), restricted to one descriptor
 * model version so a match never mixes descriptor spaces. One row per face;
 * the caller groups by identity_id to build one prototype per identity.
 *
 * Joins through people for the display name; the guests join is LEFT on
 * purpose — an off-roster person has no guest row, so `guest_id`/`guest_name`
 * are null and every consumer must handle that. `person_name` is the one that
 * is always present.
 * @type {Types.confirmedIdentityFaces}
 */
export function confirmedIdentityFaces(modelVersion) {
  return sql`SELECT fi.id AS identity_id, p.id AS person_id, p.display_name AS person_name,
      p.guest_id AS guest_id, g.name AS guest_name,
      mf.id AS face_id, mf.descriptor AS descriptor
    FROM face_identities fi
    JOIN people p ON p.id = fi.person_id AND p.deleted_at IS NULL
    LEFT JOIN guests g ON g.id = p.guest_id AND g.deleted_at IS NULL
    JOIN media_faces mf ON mf.face_identity_id = fi.id
      AND mf.deleted_at IS NULL AND mf.descriptor IS NOT NULL AND mf.model_version = ${modelVersion}
    WHERE fi.deleted_at IS NULL AND fi.provenance = 'confirmed'
    ORDER BY fi.id, mf.id`.all()
}

/**
 * Live faces for one photo, each with the person's display name if identified
 * (LEFT JOIN through face_identities → people). NEVER selects the descriptor
 * column — this is the shape the per-photo admin view returns straight to JSON.
 * @type {Types.facesForMediaWithNames}
 */
export function facesForMediaWithNames(mediaId) {
  return sql`SELECT mf.id AS id, mf.media_id AS media_id,
      mf.bbox_x AS bbox_x, mf.bbox_y AS bbox_y, mf.bbox_w AS bbox_w, mf.bbox_h AS bbox_h,
      mf.face_identity_id AS face_identity_id,
      p.id AS person_id, p.display_name AS person_name
    FROM media_faces mf
    LEFT JOIN face_identities fi ON fi.id = mf.face_identity_id AND fi.deleted_at IS NULL
    LEFT JOIN people p ON p.id = fi.person_id AND p.deleted_at IS NULL
    WHERE mf.media_id = ${mediaId} AND mf.deleted_at IS NULL
    ORDER BY mf.id`.all()
}

/**
 * Every live, descriptor-bearing face of one model version that sits in a
 * multi-photo frame class, with its frame key and current identity.
 *
 * The `HAVING COUNT(DISTINCT id) > 1` subquery is the whole point: propagation
 * can only ever act inside a frame class that contains more than one
 * photograph, and skipping the singletons here keeps the O(faces^2)-per-class
 * work in must-link.js proportional to the bursts rather than to the library.
 *
 * Identified and unidentified faces both come back — propagation needs the
 * confirmed ones as sources and the undecided ones as targets, and it needs to
 * see an already-taken box to refuse to overwrite it.
 * @type {Types.facesForPropagation}
 */
export function facesForPropagation(modelVersion) {
  return sql`SELECT mf.id AS id, mf.media_id AS media_id,
      mf.bbox_x AS bbox_x, mf.bbox_y AS bbox_y, mf.bbox_w AS bbox_w, mf.bbox_h AS bbox_h,
      mf.face_identity_id AS face_identity_id, mf.descriptor AS descriptor,
      m.frame_root_sha256 AS frame_root_sha256
    FROM media_faces mf
    JOIN media m ON m.id = mf.media_id AND m.deleted_at IS NULL
    WHERE mf.deleted_at IS NULL AND mf.descriptor IS NOT NULL
      AND mf.model_version = ${modelVersion}
      AND m.frame_root_sha256 IN (
        SELECT frame_root_sha256 FROM media
        WHERE frame_root_sha256 IS NOT NULL AND deleted_at IS NULL
        GROUP BY frame_root_sha256 HAVING COUNT(DISTINCT id) > 1
      )
    ORDER BY mf.id`.all()
}

/**
 * media_id -> frame key, for weighting "how many photographs does answering
 * this unlock" in distinct FRAMES rather than distinct rows. A ten-shot burst
 * of one moment is one frame, not ten — counting rows is the coverage-table
 * bug in a second costume.
 *
 * Falls back to the media id itself for a row the CLI has not yet given a
 * frame root, so an un-ingested row counts as its own frame rather than
 * vanishing from the weighting.
 * @type {Types.frameKeysByMediaId}
 */
export function frameKeysByMediaId(mediaIds) {
  if (mediaIds.length === 0) return new Map()
  /** @type {Array<{ id: number, frame_root_sha256: string | null }>} */
  const rows = sql`SELECT id, frame_root_sha256 FROM media
    WHERE id IN ${sql.list(mediaIds)} AND deleted_at IS NULL`.all()
  /** @type {Map<number, string>} */
  const map = new Map()
  for (const row of rows) map.set(row.id, row.frame_root_sha256 ?? `media:${row.id}`)
  for (const id of mediaIds) if (!map.has(id)) map.set(id, `media:${id}`)
  return map
}

/**
 * media_id -> what a face chip needs to crop a thumbnail to one box client-side:
 * the file key to build the variant URL from, and the ORIGINAL pixel dimensions
 * the box coordinates are expressed in.
 *
 * Without the dimensions a box in source pixels cannot be mapped onto a
 * thumbnail of unknown scale, so the admin UI silently falls back to showing
 * the whole (uncropped) photo for every face — which is exactly what it did
 * before this existed. Never carries a descriptor.
 * @type {Types.mediaChipInfo}
 */
export function mediaChipInfo(mediaIds) {
  if (mediaIds.length === 0) return new Map()
  /** @type {Array<{ id: number, file_key: string, width: number | null, height: number | null }>} */
  const rows = sql`SELECT id, file_key, width, height FROM media
    WHERE id IN ${sql.list(mediaIds)} AND deleted_at IS NULL`.all()
  /** @type {Map<number, { fileKey: string, width: number | null, height: number | null }>} */
  const map = new Map()
  for (const row of rows) map.set(row.id, { fileKey: row.file_key, width: row.width, height: row.height })
  return map
}

/**
 * Every descriptor model version present on a live face row, ascending.
 * Descriptors from two models are not comparable, so any computation over
 * distances has to partition by this first.
 * @type {Types.faceModelVersions}
 */
export function faceModelVersions() {
  /** @type {Array<{ model_version: string }>} */
  const rows = sql`SELECT DISTINCT model_version FROM media_faces
    WHERE deleted_at IS NULL AND descriptor IS NOT NULL
    ORDER BY model_version`.all()
  return rows.map((r) => r.model_version)
}

/**
 * media_id -> the CONFIRMED identities already placed in that photograph.
 *
 * The "who else is in this frame" half of the co-occurrence prior. Confirmed
 * only, for the same reason `confirmedCooccurrence` is: conditioning a
 * suggestion on an earlier unreviewed guess is how one mistake becomes a
 * consistent-looking set of them.
 * @type {Types.confirmedIdentitiesPerMedia}
 */
export function confirmedIdentitiesPerMedia() {
  /** @type {Array<{ media_id: number, identity_id: number }>} */
  const rows = sql`SELECT DISTINCT mf.media_id AS media_id, mf.face_identity_id AS identity_id
    FROM media_faces mf
    JOIN face_identities fi ON fi.id = mf.face_identity_id
      AND fi.deleted_at IS NULL AND fi.provenance = 'confirmed'
    WHERE mf.deleted_at IS NULL AND mf.face_identity_id IS NOT NULL`.all()
  /** @type {Map<number, Set<number>>} */
  const map = new Map()
  for (const row of rows) {
    const found = map.get(row.media_id)
    if (found) found.add(row.identity_id)
    else map.set(row.media_id, new Set([row.identity_id]))
  }
  return map
}

/**
 * How often each pair of CONFIRMED identities appears in one photograph.
 *
 * People at a wedding cluster socially, so "who is usually in frame with this
 * person" is real evidence about an unknown face — and it is evidence the
 * descriptor does not have, which is what makes it worth anything at the hard
 * tail where the descriptor is weakest.
 *
 * ⚠ Confirmed identities ONLY, and it ORDERS suggestions — never decides one
 * (SPEC §6.4's clothing-colour line). A prior allowed to override the evidence
 * confidently mislabels exactly the people who moved between groups during the
 * day. Propagated identities are excluded for the same reason they never seed
 * a prototype: an unreviewed guess must not become the evidence for the next
 * guess.
 * @type {Types.confirmedCooccurrence}
 */
export function confirmedCooccurrence() {
  return sql`SELECT a.face_identity_id AS identity_a, b.face_identity_id AS identity_b,
      COUNT(DISTINCT a.media_id) AS frames
    FROM media_faces a
    JOIN media_faces b ON b.media_id = a.media_id AND b.face_identity_id > a.face_identity_id
      AND b.deleted_at IS NULL
    JOIN face_identities fa ON fa.id = a.face_identity_id
      AND fa.deleted_at IS NULL AND fa.provenance = 'confirmed'
    JOIN face_identities fb ON fb.id = b.face_identity_id
      AND fb.deleted_at IS NULL AND fb.provenance = 'confirmed'
    WHERE a.deleted_at IS NULL AND a.face_identity_id IS NOT NULL
    GROUP BY a.face_identity_id, b.face_identity_id`.all()
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
