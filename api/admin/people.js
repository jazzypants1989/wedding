/** @file Admin people endpoints — the photographed cast behind face tagging.
 *
 *  A person is who a face belongs to; a guest is an invitation. Naming a face
 *  takes a personId (assigning by name is not an API shape), so this module is
 *  where people are created, renamed, linked to roster guests, merged and
 *  retired.
 *
 *  Two rules with teeth:
 *  - Creation is EXPLICIT. Duplicate display names are a legal state (two
 *    guests can share a name), so an unrecognised name must never silently
 *    become a new person — the create endpoint refuses a same-name create
 *    unless the caller confirms it knows about the existing one, and the UI
 *    puts a deliberate confirm step in front of it.
 *  - `created_by` and every actor field derive from the authenticated admin
 *    session, never from the client.
 */
/** @import * as Types from './types.js' */

import { sendJson, parseBody } from "../../core/http.js"
import { log } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import {
  validateId,
  validateRequiredString,
  validateOptionalString,
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../core/validation.js"
import { withTransaction } from "../../db/utils.js"
import {
  createPerson,
  getPersonById,
  listPeople as listPeopleRows,
  findLivePeopleByName,
  updatePerson,
  softDeletePerson,
  liveIdentityCountForPerson,
} from "../../db/people.js"
import {
  identitiesForPerson,
  repointFaces,
  setIdentityPerson,
  softDeleteIdentity,
} from "../../db/media-faces.js"
import { getGuestById } from "../guests/data.js"

/** Same local-literal pattern as api/admin/faces.js's FACE_AUDIT_ACTIONS. */
const PEOPLE_AUDIT_ACTIONS = Object.freeze({
  CREATE: "PERSON_CREATE",
  UPDATE: "PERSON_UPDATE",
  MERGE: "PERSON_MERGE",
  DELETE: "PERSON_DELETE",
})

const DISPLAY_NAME_MAX = 200
const NOTES_MAX = 1000

/** @param {import('../../db/types.js').PersonListRow} row */
function personListPayload(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    guestId: row.guest_id,
    guestName: row.guest_name,
    notes: row.notes,
    identities: row.identities,
    faces: row.faces,
  }
}

/** @param {import('../../types.js').Person} person */
function personPayload(person) {
  return {
    id: person.id,
    displayName: person.display_name,
    guestId: person.guest_id,
    notes: person.notes,
  }
}

/** @type {Types.peopleListHandler} */
export async function listPeople(req, res) {
  return sendJson(res, 200, { people: listPeopleRows().map(personListPayload) })
}

/** @type {Types.personCreateHandler} */
export async function create(req, res, { session }) {
  const body = await parseBody(req)

  const nameResult = validateRequiredString(body.displayName, "displayName", DISPLAY_NAME_MAX)
  if (!nameResult.valid) throw new ValidationError(nameResult.error)
  const notesResult = validateOptionalString(body.notes, NOTES_MAX)

  /** @type {number | null} */
  let guestId = null
  if (body.guestId !== undefined && body.guestId !== null) {
    const guestIdResult = validateId(body.guestId, "guestId")
    if (!guestIdResult.valid) throw new ValidationError(guestIdResult.error)
    if (!getGuestById(guestIdResult.value)) throw new NotFoundError("Guest")
    guestId = guestIdResult.value
  }

  // Surface existing same-name people instead of silently creating a
  // doppelgänger: without `confirmDuplicate: true` the create is refused and
  // the existing candidates are named, so "the person I mean" and "a
  // different person with the same name" stay distinguishable.
  const sameName = findLivePeopleByName(nameResult.value)
  if (sameName.length > 0 && body.confirmDuplicate !== true) {
    throw new ConflictError(
      `A person named "${nameResult.value}" already exists ` +
        `(id ${sameName.map((p) => p.id).join(", ")}). ` +
        `Assign to them, or pass confirmDuplicate to create a separate person with the same name.`,
    )
  }

  const person = createPerson({
    displayName: nameResult.value,
    guestId,
    createdBy: session?.token ?? null,
    notes: notesResult.value,
  })

  log({
    action: PEOPLE_AUDIT_ACTIONS.CREATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "person",
    resourceId: person.id,
    details: { guestId, duplicateOf: sameName.map((p) => p.id) },
  })

  return sendJson(res, 201, { success: true, person: personPayload(person) })
}

/** @type {Types.personUpdateHandler} */
export async function update(req, res, { session, params }) {
  const idResult = validateId(params.id, "person ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)
  const person = getPersonById(idResult.value)
  if (!person) throw new NotFoundError("Person")

  const body = await parseBody(req)

  /** @type {import('../../db/types.js').UpdatePersonInput} */
  const patch = {}
  if (body.displayName !== undefined) {
    const nameResult = validateRequiredString(body.displayName, "displayName", DISPLAY_NAME_MAX)
    if (!nameResult.valid) throw new ValidationError(nameResult.error)
    patch.displayName = nameResult.value
  }
  if (body.notes !== undefined) {
    patch.notes = validateOptionalString(body.notes, NOTES_MAX).value
  }
  // Three-state: absent = untouched, null = unlink, number = link.
  if ("guestId" in body) {
    if (body.guestId === null) {
      patch.guestId = null
    } else {
      const guestIdResult = validateId(body.guestId, "guestId")
      if (!guestIdResult.valid) throw new ValidationError(guestIdResult.error)
      if (!getGuestById(guestIdResult.value)) throw new NotFoundError("Guest")
      patch.guestId = guestIdResult.value
    }
  }
  if (patch.displayName === undefined && patch.notes === undefined && !("guestId" in body)) {
    throw new ValidationError("Nothing to update: pass displayName, guestId, or notes")
  }

  updatePerson(idResult.value, patch)

  log({
    action: PEOPLE_AUDIT_ACTIONS.UPDATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "person",
    resourceId: idResult.value,
    details: patch,
  })

  const updated = /** @type {import('../../types.js').Person} */ (getPersonById(idResult.value))
  return sendJson(res, 200, { success: true, person: personPayload(updated) })
}

/** @type {Types.personMergeHandler} */
export async function merge(req, res, { session }) {
  const body = await parseBody(req)

  const fromResult = validateId(body.fromPersonId, "fromPersonId")
  if (!fromResult.valid) throw new ValidationError(fromResult.error)
  const intoResult = validateId(body.intoPersonId, "intoPersonId")
  if (!intoResult.valid) throw new ValidationError(intoResult.error)
  if (fromResult.value === intoResult.value) {
    throw new ValidationError("Cannot merge a person into themselves")
  }
  const from = getPersonById(fromResult.value)
  if (!from) throw new NotFoundError("Person (fromPersonId)")
  const into = getPersonById(intoResult.value)
  if (!into) throw new NotFoundError("Person (intoPersonId)")

  const { movedFaces, movedIdentities } = withTransaction(() => {
    let faces = 0
    let identities = 0
    // Per provenance: if the target person already has a live identity of that
    // provenance, fold the source identity's faces into it and retire the
    // source identity (idx_face_identities_person allows only one live row per
    // (person, provenance)); otherwise the identity itself moves across.
    const fromIdentities = identitiesForPerson(fromResult.value)
    const intoIdentities = identitiesForPerson(intoResult.value)
    for (const source of fromIdentities) {
      const target = intoIdentities.find((i) => i.provenance === source.provenance)
      if (target) {
        faces += repointFaces(source.id, target.id)
        softDeleteIdentity(source.id)
      } else {
        setIdentityPerson(source.id, intoResult.value)
        identities++
      }
    }
    softDeletePerson(fromResult.value)
    return { movedFaces: faces, movedIdentities: identities }
  })

  // Prototypes are computed on demand from live rows (api/admin/faces.js's
  // module comment) — re-pointing the identities IS the prototype rebuild.
  // The Phase-5 assignment ledger records the merge's face moves when it
  // lands; until then the audit log below is the durable record.
  log({
    action: PEOPLE_AUDIT_ACTIONS.MERGE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "person",
    resourceId: intoResult.value,
    details: { fromPersonId: fromResult.value, intoPersonId: intoResult.value, movedFaces, movedIdentities },
  })

  return sendJson(res, 200, { success: true, movedFaces, movedIdentities })
}

/** @type {Types.personDeleteHandler} */
export async function remove(req, res, { session, params }) {
  const idResult = validateId(params.id, "person ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)
  const person = getPersonById(idResult.value)
  if (!person) throw new NotFoundError("Person")

  // face_identities.person_id is NOT NULL, so deleting a person with live
  // identities would leave them pointing at a tombstone. Refuse with a message
  // the UI can show verbatim; merge (or unassign the faces) first.
  const liveIdentities = liveIdentityCountForPerson(idResult.value)
  if (liveIdentities > 0) {
    throw new ConflictError(
      `"${person.display_name}" still has ${liveIdentities} live face identit${liveIdentities === 1 ? "y" : "ies"}. ` +
        `Merge them into another person or unassign their faces before deleting.`,
    )
  }

  softDeletePerson(idResult.value)

  log({
    action: PEOPLE_AUDIT_ACTIONS.DELETE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "person",
    resourceId: idResult.value,
    details: {},
  })

  return sendJson(res, 200, { success: true })
}
