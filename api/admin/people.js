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
 *
 *  MERGE IS A REDIRECT (Phase 5). Folding one person into another sets
 *  `face_identities.merged_into` on the source and retires it; it writes no
 *  per-face assignment events, because a merge is a fact about identities and
 *  every event that named the source still correctly names what it named.
 *  `resolveIdentity` reads through the chain. See the merge handler for the
 *  one back-fill case, and why it is the exception that proves the rule.
 */
/** @import * as Types from './types.js' */

import { randomUUID } from "node:crypto"

import { sendJson, parseBody } from "../../core/http.js"
import { log, actorId } from "../../core/utils.js"
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
  faceIdsForIdentity,
  mergeIdentityInto,
  setIdentityPerson,
  softDeleteIdentity,
  getFaceById,
  mediaChipInfo,
} from "../../db/media-faces.js"
import {
  assignmentsForFace,
  createBatch,
  projectFace,
  recordAssignment,
} from "../../db/face-assignments.js"
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

/** How many of one person's faces `?faces=` returns. A person page shows them
 *  as a grid to check by eye; past this it says how many more there are. */
const PERSON_FACES_MAX = 60

/**
 * One person's live faces as chips, newest identity first — for the People
 * page's face grid, so a wrong name can be spotted (and opened) from the person
 * as well as from the photograph. Ids, a file key, a box and the original
 * pixel size, the same chip shape every face payload uses; never a descriptor.
 * @param {number} personId
 */
function personFaces(personId) {
  /** @type {Array<{ id: number, media_id: number, bbox_x: number, bbox_y: number, bbox_w: number, bbox_h: number }>} */
  const rows = []
  for (const identity of identitiesForPerson(personId)) {
    for (const faceId of faceIdsForIdentity(identity.id)) {
      const face = getFaceById(faceId)
      // faceIdsForIdentity includes soft-deleted rows on purpose (see its
      // note); a dismissed or superseded face is not one of theirs to show.
      if (face && !face.deleted_at) rows.push(face)
    }
  }
  rows.sort((a, b) => b.id - a.id)
  const shown = rows.slice(0, PERSON_FACES_MAX)
  const chips = mediaChipInfo([...new Set(shown.map((f) => f.media_id))])
  const faces = shown.map((f) => {
    const info = chips.get(f.media_id)
    return {
      faceId: f.id,
      mediaId: f.media_id,
      fileKey: info ? info.fileKey : null,
      width: info ? info.width : null,
      height: info ? info.height : null,
      box: { x: f.bbox_x, y: f.bbox_y, w: f.bbox_w, h: f.bbox_h },
    }
  })
  return { faces, total: rows.length }
}

/** @type {Types.peopleListHandler} */
export async function listPeople(req, res) {
  const people = listPeopleRows().map(personListPayload)
  // `?faces=<personId>` adds that one person's faces, so the People page can
  // draw its grid without a route of its own.
  const param = new URL(req.url ?? "/", `http://${req.headers.host}`).searchParams.get("faces")
  if (param === null) return sendJson(res, 200, { people })
  const idResult = validateId(param, "person ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)
  const { faces, total } = personFaces(idResult.value)
  return sendJson(res, 200, { people, personFaces: { personId: idResult.value, faces, total } })
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
    // Through actorId, like every other actor field — the audit log has always
    // truncated to 8 chars and this column is the more durable of the two.
    createdBy: actorId(session?.token),
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
    // Spread, not `patch` itself: an interface has no implicit index signature,
    // so it is not assignable to AuditEvent's `Record<string, unknown>`.
    details: { ...patch },
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

  const actor = actorId(session?.token) ?? "unattributed"
  const { movedFaces, movedIdentities, carriedGuestLink, repairedFaces } = withTransaction(() => {
    let faces = 0
    let identities = 0
    let repaired = 0
    /** @type {string | null} Opened lazily — most merges never need it. */
    let repairBatch = null

    // Per provenance: if the target person already has a live identity of that
    // provenance, REDIRECT the source identity at it and retire the source
    // (idx_face_identities_person allows only one live row per
    // (person, provenance)); otherwise the identity itself moves across.
    const fromIdentities = identitiesForPerson(fromResult.value)
    const intoIdentities = identitiesForPerson(intoResult.value)
    for (const source of fromIdentities) {
      const target = intoIdentities.find((i) => i.provenance === source.provenance)
      if (!target) {
        setIdentityPerson(source.id, intoResult.value)
        identities++
        continue
      }

      // ⚠ A merge is a fact about IDENTITIES, not about faces (owner ruling,
      // Phase 5). One column update — `merged_into` — and NO per-face events:
      // every historical event still names the identity it actually named, and
      // `resolveIdentity` reads through the redirect, so the record stays true
      // instead of being rewritten. The old `repointFaces` did the opposite: it
      // overwrote each face's column, leaving events that said A beside a
      // column that said B, with nothing recording that A had ever existed.
      const affected = faceIdsForIdentity(source.id)
      mergeIdentityInto(source.id, target.id)
      softDeleteIdentity(source.id)
      faces += affected.length

      for (const faceId of affected) {
        // Re-materialise the column. This writes no event — `projectFace` IS
        // the projection, replaying what the ledger already says, which after
        // the redirect resolves to the target. It is needed because half the
        // read path joins `face_identities ... AND deleted_at IS NULL`
        // (confirmedIdentityFaces, confirmedIdentitiesPerMedia,
        // confirmedCooccurrence, facesForMediaWithNames), so a column still
        // naming the now-soft-deleted source would make those faces silently
        // nameless rather than merged.
        if (assignmentsForFace(faceId).length > 0) {
          projectFace(faceId)
          continue
        }

        // The one case the ruling's premise does not cover: a face with NO
        // events at all — assigned before the ledger existed, so there is no
        // historical event for the redirect to keep true, and replaying it
        // would clear the assignment outright. `merge-repair` is the batch kind
        // the Phase 5 contract reserved for exactly this. Writing the missing
        // history is strictly better than the alternatives (leave the column
        // dangling at a deleted identity, or silently lose the assignment), and
        // being a batch, it is revocable like anything else.
        if (repairBatch === null) {
          repairBatch = randomUUID()
          createBatch({
            batchId: repairBatch,
            kind: "merge-repair",
            actor,
            note: `identities merged into ${intoResult.value}; faces with no ledger history back-filled`,
          })
        }
        recordAssignment({
          faceId,
          op: "assign",
          identityId: target.id,
          actor,
          batchId: repairBatch,
          reason: "pre-ledger assignment, back-filled during a person merge",
        })
        repaired++
      }
    }

    // A merge must not quietly discard the roster link. If the source is linked
    // to a guest and the target is not, the link travels; an existing link on
    // the target is NEVER overwritten, because that would silently reassign who
    // an invitation belongs to. Notes ride along on the same rule, appended so
    // neither side's text is lost.
    const carried = from.guest_id !== null && into.guest_id === null
    if (carried || from.notes) {
      updatePerson(intoResult.value, {
        guestId: carried ? from.guest_id : undefined,
        notes: from.notes
          ? into.notes
            ? `${into.notes}\n\n(merged from “${from.display_name}”)\n${from.notes}`
            : from.notes
          : undefined,
      })
    }

    softDeletePerson(fromResult.value)
    return {
      movedFaces: faces,
      movedIdentities: identities,
      carriedGuestLink: carried,
      repairedFaces: repaired,
    }
  })

  // Prototypes are computed on demand from live rows (api/admin/faces.js's
  // module comment), so the redirect plus the re-projection above IS the
  // prototype rebuild — nothing is cached to invalidate.
  log({
    action: PEOPLE_AUDIT_ACTIONS.MERGE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "person",
    resourceId: intoResult.value,
    details: {
      fromPersonId: fromResult.value,
      intoPersonId: intoResult.value,
      movedFaces,
      movedIdentities,
      carriedGuestLink,
      repairedFaces,
    },
  })

  // `movedFaces` keeps its name and its meaning to a reader — "this many face
  // rows now answer to the target" — even though no face row moved. What
  // changed is that they resolve through a redirect instead of having been
  // rewritten.
  return sendJson(res, 200, {
    success: true,
    movedFaces,
    movedIdentities,
    carriedGuestLink,
    repairedFaces,
  })
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
