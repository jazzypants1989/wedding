/** @file People (the photographed cast) database operations.
 *
 *  A person is who a face belongs to; a guest is an invitation. The two join
 *  through people.guest_id, which is nullable because the cast is bigger than
 *  the roster (schema.js `add_people` migration comment). Everything here is
 *  soft-delete aware: live means `deleted_at IS NULL`.
 */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"

/** @type {Types.createPerson} */
export function createPerson({ displayName, guestId = null, createdBy = null, notes = null }) {
  const result = sql`INSERT INTO people (display_name, guest_id, created_by, notes)
    VALUES (${displayName}, ${guestId}, ${createdBy}, ${notes})`.run()
  return /** @type {import('../types.js').Person} */ (
    getPersonById(Number(result.lastInsertRowid))
  )
}

/** @type {Types.getPersonById} */
export function getPersonById(id) {
  return sql`SELECT * FROM people WHERE id = ${id} AND deleted_at IS NULL`.get()
}

/**
 * Live people with what the admin list needs: the linked guest's name (LEFT
 * JOIN — null for an off-roster person, and every consumer must handle that),
 * how many live identities reference the person, and how many live faces those
 * identities carry. Ordered by display name for the datalist.
 * @type {Types.listPeople}
 */
export function listPeople() {
  return sql`SELECT p.id AS id, p.display_name AS display_name, p.guest_id AS guest_id,
      g.name AS guest_name, p.notes AS notes,
      (SELECT COUNT(*) FROM face_identities fi
        WHERE fi.person_id = p.id AND fi.deleted_at IS NULL) AS identities,
      (SELECT COUNT(*) FROM media_faces mf
        JOIN face_identities fi2 ON fi2.id = mf.face_identity_id AND fi2.deleted_at IS NULL
        WHERE fi2.person_id = p.id AND mf.deleted_at IS NULL) AS faces
    FROM people p
    LEFT JOIN guests g ON g.id = p.guest_id AND g.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
    ORDER BY p.display_name COLLATE NOCASE, p.id`.all()
}

/**
 * Fold a display name to its comparison key. Exported so the ONE definition of
 * "the same name" lives here — `public/pages/admin/face-assignment.js` mirrors
 * it and says so.
 *
 * NFC first, then `toLowerCase`. Both matter and neither is optional: a name
 * typed with a combining accent and the same name typed with a precomposed one
 * are indistinguishable on screen but different strings, and JS `toLowerCase`
 * is Unicode-aware where SQLite's `COLLATE NOCASE` folds ASCII only. Using the
 * collation here would mean the server saw no duplicate for a pair of names the
 * admin cannot tell apart. No regex — `normalize` and `toLowerCase` are string
 * methods.
 * @type {Types.nameKey}
 */
export function nameKey(displayName) {
  return displayName.normalize("NFC").toLowerCase()
}

/**
 * Case-insensitive exact display-name matches among live people. Duplicate
 * names are a legal state (two guests can share a name), which is exactly why
 * creation must surface these rather than silently picking one.
 *
 * Compared in JS via `nameKey` rather than in SQL: see its comment for why the
 * collation is not good enough. `people` is roster-sized — tens of rows — so
 * the scan is not worth an index.
 * @type {Types.findLivePeopleByName}
 */
export function findLivePeopleByName(displayName) {
  const key = nameKey(displayName)
  /** @type {import('../types.js').Person[]} */
  const rows = sql`SELECT * FROM people WHERE deleted_at IS NULL ORDER BY id`.all()
  return rows.filter((p) => nameKey(p.display_name) === key)
}

/** @type {Types.updatePerson} */
export function updatePerson(id, { displayName, guestId, notes }) {
  const existing = getPersonById(id)
  if (!existing) return false
  const result = sql`UPDATE people SET
      display_name = ${displayName === undefined ? existing.display_name : displayName},
      guest_id = ${guestId === undefined ? existing.guest_id : guestId},
      notes = ${notes === undefined ? existing.notes : notes}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.softDeletePerson} */
export function softDeletePerson(id) {
  const result = sql`UPDATE people SET deleted_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/**
 * How many LIVE identities reference a person. A person with any cannot be
 * soft-deleted (face_identities.person_id is NOT NULL, so the identities would
 * point at a tombstone) — the delete endpoint refuses on this count.
 * @type {Types.liveIdentityCountForPerson}
 */
export function liveIdentityCountForPerson(personId) {
  /** @type {{ n: number } | undefined} */
  const row = sql`SELECT COUNT(*) AS n FROM face_identities
    WHERE person_id = ${personId} AND deleted_at IS NULL`.get()
  return row ? row.n : 0
}
