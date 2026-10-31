/** @file "Photos they're in" — the media a guest appears in, through face tagging.
 *
 *  The thank-you composer's photo picker lists these first (IA §13.1). A face
 *  belongs to a guest when it is assigned to a person linked to that guest:
 *
 *    media_faces (live) → face_identity_id → face_identities
 *      → the identity at the end of its merge redirect (live, not itself merged)
 *      → people (live) → people.guest_id
 *
 *  A merge moves the redirect and never re-points a face row
 *  (db/media-faces.js mergeIdentityInto), so a face assigned to an identity
 *  that was later folded into another still belongs to the survivor's person.
 *  Merges leave chains one hop long (mergeIdentityInto compresses), so
 *  COALESCE(merged_into, id) names the end of the chain — the same answer
 *  resolveIdentity() gives.
 *
 *  Read-only. Only approved, non-deleted gallery media (official + guest);
 *  site-content figures are never a card photo. */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"

/** @type {Types.getMediaFeaturingGuest} */
export function getMediaFeaturingGuest(guestId) {
  /** @type {Array<{ id: number, file_key: string, kind: string, section: string, width: number | null, height: number | null, needs_display: number, created_at: string, faces: number }>} */
  const rows = sql`SELECT m.id, m.file_key, m.kind, m.section, m.width, m.height,
      m.needs_display, m.created_at, COUNT(DISTINCT f.id) AS faces
    FROM media m
    JOIN media_faces f ON f.media_id = m.id AND f.deleted_at IS NULL
    JOIN face_identities fi ON fi.id = f.face_identity_id
    JOIN face_identities live ON live.id = COALESCE(fi.merged_into, fi.id)
      AND live.deleted_at IS NULL AND live.merged_into IS NULL
    JOIN people p ON p.id = live.person_id AND p.deleted_at IS NULL
    WHERE p.guest_id = ${guestId}
      AND m.status = 'approved' AND m.deleted_at IS NULL
      AND m.section IN ('official', 'guest')
    GROUP BY m.id
    ORDER BY faces DESC, m.id DESC`.all()
  return rows.map((r) => ({
    id: r.id,
    file_key: r.file_key,
    kind: /** @type {"image" | "video"} */ (r.kind),
    section: /** @type {"official" | "guest"} */ (r.section),
    width: r.width,
    height: r.height,
    needs_display: !!r.needs_display,
    created_at: r.created_at,
    faces: r.faces,
  }))
}
