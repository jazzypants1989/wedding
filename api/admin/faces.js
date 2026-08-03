/** @file Admin face-assignment endpoints (docs/post-wedding/SPEC-vision-lab.md §10/§15).
 *
 *  Clusters and prototype matches are NOT persisted. The only persistent
 *  identity state is `face_identities` + `media_faces.face_identity_id` — every
 *  group and every suggestion below is computed fresh, on demand, from live rows,
 *  by importing the pure numeric modules in public/vision/ (group.js, assign.js)
 *  straight into this server module. That is exactly what SPEC §4's
 *  venue-agnosticism is for: a few thousand 128-d descriptors group and match in
 *  milliseconds, so there is nothing here worth caching.
 *
 *  PRIVACY (§10, §15 — enforced, not just documented): every route is
 *  `{ admin: true }`; a descriptor NEVER appears in a response body, admin or
 *  otherwise — every JSON payload below is hand-built field by field, never a
 *  spread of a raw DB row, specifically so a `descriptor` column can never ride
 *  along by accident. Nothing here auto-publishes anything; assigning a face to
 *  a guest only ever records an assignment event against `media_faces`.
 *
 *  THE LEDGER (Phase 5). No handler here writes `media_faces.face_identity_id`.
 *  Every mutation appends an event via `recordAssignment`, which materialises
 *  the column in the same call — see db/face-assignments.js for why append and
 *  project are one call and never two. `revokeBatch` is deliberately NOT
 *  imported: it owns a `withTransaction`, every write path below is already
 *  inside one, and db/utils.js's `withTransaction` is a bare BEGIN IMMEDIATE
 *  with no savepoints, so nesting it would throw.
 *
 *  BATCH POLICY, and the judgement in it. A batch exists to make a *decision*
 *  revocable as one thing, so the question for each route is "is there one
 *  decision here, or several?".
 *
 *   - `propagate` — one batch, kind `propagate`. Unarguable: it is a bulk pass
 *     over machine proposals whose entire value is being undoable wholesale.
 *   - bulk `assign` / `unassign` / `not-a-face` — one batch each, kind
 *     `manual`, and this is the arguable one. These are a human's deliberate
 *     judgement, so batching them looks like over-application. It is not,
 *     because of what the Faces tab actually does: the fast path is "name this
 *     whole group at once", and the Phase 2 comparison established that on this
 *     cast SOME group on the page is two people welded together. Naming a
 *     welded group is one click, one mistake, and — without a batch — thirty
 *     rows to unpick by hand. One batch row per click is a rounding error next
 *     to that.
 *   - `assign-one` — no batch. One face, one event; the undo is the same route
 *     with `personId: null`, and a batch of one is a row that says nothing the
 *     event does not.
 */
/** @import * as Types from './types.js' */

import { randomUUID } from "node:crypto"

import { sendJson, parseBody } from "../../core/http.js"
import { log, actorId } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import { validateId, validateIdArray, ValidationError, NotFoundError } from "../../core/validation.js"
import { withTransaction } from "../../db/utils.js"
import { getMediaById } from "../../db/media.js"
import { getPersonById } from "../../db/people.js"
import {
  getFaceCounts,
  unidentifiedFacesWithDescriptors,
  confirmedIdentityFaces,
  facesForMediaWithNames,
  facesForPropagation,
  frameKeysByMediaId,
  confirmedCooccurrence,
  confirmedIdentitiesPerMedia,
  faceModelVersions,
  mediaChipInfo,
  getFaceById,
  getIdentityById,
  createIdentity,
  identitiesForPerson,
  blobToDescriptor,
  routeStatesOf,
  routeStateCounts,
  facesWithSignals,
} from "../../db/media-faces.js"
import { createBatch, recordAssignment } from "../../db/face-assignments.js"
import { now } from "../../db/utils.js"
import { groupFaces, distanceMatrix, centroid } from "../../public/vision/group.js"
import { buildPrototypes, matchFace } from "../../public/vision/assign.js"
import { propagateWithinFrames } from "../../public/vision/must-link.js"
import { getDefaults } from "../../public/vision/defaults.js"

/** Audit action names for this module. Not registered in core/utils.js's
 *  AUDIT_ACTIONS table (out of scope for this change) — `log()`'s `action`
 *  field is a plain string, so a local, equally-namespaced literal works the
 *  same way and needs no edit to that shared, frozen table. */
const FACE_AUDIT_ACTIONS = Object.freeze({
  ASSIGN: "FACE_ASSIGN",
  UNASSIGN: "FACE_UNASSIGN",
  NOT_A_FACE: "FACE_NOT_A_FACE",
  PROPAGATE: "FACE_PROPAGATE",
})

/** One batch mutation (assign/unassign/not-a-face) touches at most this many
 *  face rows. Round; there is no scenario at this project's scale where a
 *  single click plausibly needs more. */
const FACE_BATCH_MAX = 500

/** The ask queue never returns more than this many items in one response. */
const QUEUE_MAX_ITEMS = 200

/**
 * The actor string every ledger event and batch row carries.
 *
 * Server-derived, always — the request body never contributes to it, which is
 * the same rule `created_by` and `confirmed_by` already follow. `withAdmin`
 * guarantees a session, so the fallback is unreachable in practice; it exists
 * because `actorId` returns null for an empty token and `face_assignments.actor`
 * is NOT NULL. It deliberately does not say "admin": in the one column whose
 * whole job is attribution, a plausible-looking default is worse than an
 * obviously unattributed one.
 * @param {import('../../types.js').Session} [session]
 * @returns {string}
 */
function ledgerActor(session) {
  return actorId(session?.token) ?? "unattributed"
}

/**
 * A fresh batch, created inside the caller's transaction (`createBatch` is a
 * plain statement and opens none of its own).
 *
 * The batch id is generated HERE and returned to the client rather than
 * accepted from it: it is a primary key, so a client-chosen one is both a
 * collision and a way to append into somebody else's batch.
 * @param {import('../../types.js').FaceAssignmentBatchKind} kind
 * @param {string} actor
 * @param {string} note
 * @returns {string}
 */
function openBatch(kind, actor, note) {
  const batchId = randomUUID()
  createBatch({ batchId, kind, actor, note })
  return batchId
}

/**
 * The route states a BULK action may touch.
 *
 * `set_aside` is absent on purpose — that is the whole enforcement. `null` is
 * present because it means "not yet graded" rather than "graded and rejected":
 * every row written before the `add_face_routing` migration has it, and
 * treating ungraded as forbidden would make the Faces tab refuse to work on
 * exactly the rows that exist today.
 * @type {ReadonlySet<string | null>}
 */
const BULK_ASSIGNABLE = new Set([null, "accept", "ask"])

/**
 * Refuse a bulk mutation that touches a face the admin was never shown.
 *
 * The Faces tab filters `set_aside` out of what it displays, so a request
 * carrying one did not come from a group the admin looked at — it came from a
 * stale page, a hand-made request, or a bug. Enforcing it here rather than in
 * the UI is what makes "a bulk action can never assign a face the admin did not
 * see" a property of the system instead of a property of one client.
 *
 * The single-face escape hatch (`assignOne`) deliberately does NOT go through
 * this: the per-photograph view shows every face in a photograph including the
 * set-aside ones, and without a way to name them the set-aside state would be a
 * one-way door rather than a queue filter.
 * @param {number[]} faceIds
 */
function assertBulkAssignable(faceIds) {
  const states = routeStatesOf(faceIds)
  /** @type {number[]} */
  const blocked = []
  /** @type {number[]} */
  const missing = []
  for (const id of faceIds) {
    // `validateFaceIds` has already refused anything missing or soft-deleted,
    // so `missing` should stay empty — but "the row vanished between two
    // queries" is reported as its own thing rather than mislabelled as set
    // aside, because the two want different answers from whoever reads it.
    if (!states.has(id)) missing.push(id)
    else if (!BULK_ASSIGNABLE.has(states.get(id) ?? null)) blocked.push(id)
  }
  if (missing.length > 0) throw new NotFoundError(`Face ${missing[0]}`)
  if (blocked.length > 0) {
    throw new ValidationError(
      `${blocked.length} face(s) are set aside and cannot be changed in bulk: ${blocked.join(", ")}. ` +
        "Open the photograph and assign them one at a time.",
    )
  }
}

/**
 * A face row + its Float32Array descriptor, sharing one DescriptorSet's
 * backing buffer (so `centroid`/`distanceMatrix`/`matchFace` can operate on
 * it directly without a copy per call).
 * @typedef {import('../../db/types.js').UnidentifiedFaceRow} UnidentifiedFaceRow
 */

/**
 * Every live, undecided, descriptor-bearing face, packed into one DescriptorSet
 * PER model_version. Never mixes descriptor spaces across a model swap — see
 * db/media-faces.js's confirmedIdentityFaces comment for why.
 * @returns {Map<string, { faces: UnidentifiedFaceRow[], set: import('../../public/vision/types.js').DescriptorSet }>}
 */
function loadUnidentifiedByModelVersion() {
  const rows = unidentifiedFacesWithDescriptors()
  /** @type {Map<string, UnidentifiedFaceRow[]>} */
  const grouped = new Map()
  for (const row of rows) {
    const list = grouped.get(row.model_version)
    if (list) list.push(row)
    else grouped.set(row.model_version, [row])
  }

  /** @type {Map<string, { faces: UnidentifiedFaceRow[], set: import('../../public/vision/types.js').DescriptorSet }>} */
  const byVersion = new Map()
  for (const [version, faces] of grouped) {
    const first = blobToDescriptor(faces[0].descriptor)
    const dim = first.length
    const data = new Float32Array(faces.length * dim)
    data.set(first, 0)
    /** @type {UnidentifiedFaceRow[]} */
    const kept = [faces[0]]
    for (let i = 1; i < faces.length; i++) {
      const vec = blobToDescriptor(faces[i].descriptor)
      // A malformed row (wrong descriptor length for its own model_version)
      // is dropped from the computed set rather than corrupting every other
      // row's offset — it still exists in the DB and is still visible via the
      // per-photo view, just not in the live grouping/matching pool.
      if (vec.length !== dim) continue
      data.set(vec, kept.length * dim)
      kept.push(faces[i])
    }
    byVersion.set(version, { faces: kept, set: { dim, data: kept.length === faces.length ? data : data.subarray(0, kept.length * dim) } })
  }
  return byVersion
}

/**
 * Per-person centroid prototypes from every CONFIRMED identity's faces of one
 * model_version, plus a label -> {personId, personName} lookup. Propagated
 * identities never contribute (db/media-faces.js's query already excludes
 * them) — SPEC §9's feedback-loop guard.
 * @param {string} modelVersion
 * @returns {{ prototypes: import('../../public/vision/types.js').Prototype[], meta: Map<string, { personId: number, personName: string }> }}
 */
function loadPrototypesByModelVersion(modelVersion) {
  const rows = confirmedIdentityFaces(modelVersion)
  /** @type {Map<string, { personId: number, personName: string }>} */
  const meta = new Map()
  if (rows.length === 0) return { prototypes: [], meta }

  const first = blobToDescriptor(rows[0].descriptor)
  const dim = first.length
  const data = new Float32Array(rows.length * dim)
  /** @type {Array<string | null>} */
  const assignments = []
  rows.forEach((row, i) => {
    const label = String(row.identity_id)
    const vec = blobToDescriptor(row.descriptor)
    if (vec.length !== dim) {
      // Same defensive drop as loadUnidentifiedByModelVersion: contributes to
      // no prototype rather than corrupting the packed buffer's offsets.
      assignments.push(null)
      return
    }
    data.set(vec, i * dim)
    assignments.push(label)
    if (!meta.has(label)) meta.set(label, { personId: row.person_id, personName: row.person_name })
  })

  const prototypes = buildPrototypes({ dim, data }, assignments)
  return { prototypes, meta }
}

/**
 * A face chip entry as the admin UI needs it: the box, plus the file key and
 * ORIGINAL pixel dimensions it crops a thumbnail against. Built field by field,
 * like every other payload here, so a descriptor column can never ride along.
 * @param {{ id: number, media_id: number, bbox_x: number, bbox_y: number, bbox_w: number, bbox_h: number }} face
 * @param {ReadonlyMap<number, { fileKey: string, width: number | null, height: number | null }>} chips
 */
function chipOf(face, chips) {
  const info = chips.get(face.media_id)
  return {
    faceId: face.id,
    mediaId: face.media_id,
    fileKey: info ? info.fileKey : null,
    width: info ? info.width : null,
    height: info ? info.height : null,
    box: boxOf(face),
  }
}

/** Structural, not tied to one row type — every face-shaped row has these four.
 *  @param {{ bbox_x: number, bbox_y: number, bbox_w: number, bbox_h: number }} face */
function boxOf(face) {
  return { x: face.bbox_x, y: face.bbox_y, w: face.bbox_w, h: face.bbox_h }
}

/** Whether a face is one the queue and the group chips will show. Null
 *  (ungraded) shows: "not yet graded" is not "held back".
 *  @param {{ route_state: import('../../types.js').RouteState | null }} face */
function isShown(face) {
  return face.route_state !== "set_aside"
}

/**
 * How likely this group is to be two people welded into one.
 *
 * **Why the Faces tab needs this at all.** The Phase 2 comparison established
 * that on this cast, in BOTH descriptor spaces tried, no grouping cutoff
 * separates everyone without welding two people together. Welding is therefore
 * not a hypothetical this UI should be relaxed about — it is a thing that is
 * definitely happening in some group on the page, and the admin's fast path is
 * a button that names a whole group at once.
 *
 * **What the number is.** The group's DIAMETER — its widest internal pair —
 * divided by the grouping cutoff. Meaningful because the clustering is
 * average-linkage (public/vision/group.js): a merge needs the MEAN distance
 * below the cutoff, so individual pairs inside an accepted group are free to
 * sit well beyond it. A ratio above 1 says, in one number, "this group contains
 * two faces further apart than the threshold that was supposed to separate
 * people" — which is what a weld looks like from the inside.
 *
 * No new tunable: the comparison is against `group.cutoff`, the constant that
 * built the group in the first place.
 * @param {import('../../public/vision/types.js').DescriptorSet} set
 * @param {readonly number[]} members row indices into `set`
 * @param {{ n: number, d: Float64Array | Float32Array | number[] }} raw un-mutated distance matrix
 * @param {number} cutoff
 * @returns {{ diameter: number, ratio: number } | null}
 */
function weldRisk(set, members, raw, cutoff) {
  if (members.length < 2) return null
  let diameter = 0
  for (let a = 0; a < members.length; a++) {
    for (let b = a + 1; b < members.length; b++) {
      const dist = raw.d[members[a] * raw.n + members[b]]
      if (dist > diameter) diameter = dist
    }
  }
  return { diameter, ratio: cutoff > 0 ? diameter / cutoff : 0 }
}

/** @type {Types.faceOverviewHandler} */
export async function overview(req, res) {
  const counts = getFaceCounts()
  const routeCounts = routeStateCounts()
  const groupDefaults = getDefaults("group")
  const cutoff = /** @type {number} */ (groupDefaults.cutoff)
  const byVersion = loadUnidentifiedByModelVersion()

  /** @type {Array<{ faceIds: number[], media: Array<ReturnType<typeof chipOf>>, suggestion: { personId: number, personName: string, margin: number } | null, size: number, shown: number, setAside: number, weld: { diameter: number, ratio: number } | null }>} */
  const rawGroups = []

  for (const [modelVersion, { faces, set }] of byVersion) {
    if (faces.length === 0) continue
    const chips = mediaChipInfo([...new Set(faces.map((f) => f.media_id))])
    const photoIds = faces.map((f) => f.media_id)
    // A SECOND, un-mutated distance matrix, for the weld measurement below.
    // groupFaces runs Lance-Williams in place over the matrix it uses, so the
    // one it works on is not a table of pairwise distances by the time it is
    // done — reading a group's diameter out of it would read merged-cluster
    // distances instead. Computed before, so it is untouched.
    const raw = distanceMatrix(set)
    const clusters = groupFaces(set, {
      cutoff,
      photoIds,
      cannotLinkWithinPhoto: /** @type {boolean} */ (groupDefaults.cannotLinkWithinPhoto),
    })
    const { prototypes, meta } = loadPrototypesByModelVersion(modelVersion)

    for (const cluster of clusters) {
      // The group was CLUSTERED over every face, including the set-aside ones —
      // that is the rule, routing filters the display and never the input. What
      // is filtered is what leaves this function: the chips the admin sees, and
      // `faceIds`, which is what the bulk-confirm button posts back. So a bulk
      // confirm cannot carry a face that was not on screen, by construction and
      // not only by the server-side check that also refuses it.
      const shownMembers = cluster.members.filter((i) => isShown(faces[i]))
      if (shownMembers.length === 0) continue

      /** @type {{ personId: number, personName: string, margin: number } | null} */
      let suggestion = null
      if (prototypes.length > 0) {
        // The centroid is over the FULL cluster, not the shown subset: the
        // suggestion is about who this group is, and a face being too small to
        // show is not a reason to drop its evidence.
        const vec = centroid(set, cluster.members)
        const match = matchFace(vec, prototypes)
        if (match.best) {
          const info = meta.get(match.best.label)
          if (info) suggestion = { personId: info.personId, personName: info.personName, margin: match.margin }
        }
      }

      rawGroups.push({
        faceIds: shownMembers.map((i) => faces[i].id),
        media: shownMembers.map((i) => chipOf(faces[i], chips)),
        suggestion,
        size: cluster.size,
        shown: shownMembers.length,
        setAside: cluster.members.length - shownMembers.length,
        weld: weldRisk(set, cluster.members, raw, cutoff),
      })
    }
  }

  // Largest first, globally across every model_version partition — matching
  // group.js's own per-partition ordering, just merged.
  rawGroups.sort((a, b) => b.size - a.size)
  const groups = rawGroups.map((g, index) => ({
    key: index,
    faceIds: g.faceIds,
    media: g.media,
    suggestion: g.suggestion,
    /** Total cluster size, INCLUDING faces not shown — so the UI can say
     *  "3 more too small to show" rather than silently disagreeing with
     *  itself about how big the group is. */
    size: g.size,
    setAside: g.setAside,
    weld: g.weld,
  }))

  return sendJson(res, 200, { counts, routeCounts, groups })
}

/**
 * How strongly each candidate identity co-occurs with the identities already
 * confirmed in a given photograph, as a plain count of shared frames.
 *
 * ⚠ ORDERING ONLY (SPEC §6.4, SESSION-2 §8). This never changes which
 * candidates exist, never changes their distances, and never changes which one
 * is `best` — it breaks ties between candidates the descriptor already
 * considers comparable. A prior allowed to override the evidence confidently
 * mislabels exactly the people who moved between groups during the day.
 * @param {ReadonlyArray<import('../../db/types.js').CooccurrenceRow>} rows
 * @returns {(identityId: number, presentIdentityIds: ReadonlySet<number>) => number}
 */
function cooccurrenceScorer(rows) {
  /** @type {Map<string, number>} */
  const pairs = new Map()
  for (const row of rows) {
    pairs.set(`${row.identity_a}:${row.identity_b}`, row.frames)
  }
  return (identityId, present) => {
    let total = 0
    for (const other of present) {
      if (other === identityId) continue
      const key = identityId < other ? `${identityId}:${other}` : `${other}:${identityId}`
      total += pairs.get(key) ?? 0
    }
    return total
  }
}

/** @type {Types.faceQueueHandler} */
export async function queue(req, res) {
  const assignDefaults = getDefaults("assign")
  const sameBandCutoff = /** @type {number} */ (assignDefaults.sameBandCutoff)
  const byVersion = loadUnidentifiedByModelVersion()
  const scoreCooccurrence = cooccurrenceScorer(confirmedCooccurrence())

  /** @type {Array<ReturnType<typeof chipOf> & { candidates: Array<{ personId: number | null, personName: string | null, distance: number, margin: number, cooccurrence: number }>, unlocks: number, routeState: import('../../types.js').RouteState | null, routeReason: string | null }>} */
  const items = []

  for (const [modelVersion, { faces, set }] of byVersion) {
    if (faces.length === 0) continue
    const { prototypes, meta } = loadPrototypesByModelVersion(modelVersion)
    // "unidentified faces where prototypes exist" — a bucket with no confirmed
    // identity has nobody to suggest, so none of its faces are askable yet.
    if (prototypes.length === 0) continue

    // Raw (unmutated) distance matrix, shared by every face in this bucket for
    // the `unlocks` count below. groupFaces is never called here, so nothing
    // needs to guard against its in-place Lance-Williams mutation.
    const { n, d } = distanceMatrix(set)
    // Frame keys, so `unlocks` counts distinct MOMENTS. Counting media rows
    // lets a ten-shot burst of one moment outrank a face that appears across
    // ten genuinely different pictures — the coverage-table bug in a second
    // costume (SESSION-2 §2b, plan 4.4).
    const mediaIds = [...new Set(faces.map((f) => f.media_id))]
    const frameKey = frameKeysByMediaId(mediaIds)
    const chips = mediaChipInfo(mediaIds)
    // Who is already confirmed in each photo, for the co-occurrence ordering.
    const confirmedInPhoto = confirmedIdentitiesPerMedia()

    for (let i = 0; i < faces.length; i++) {
      const face = faces[i]
      // The display filter. Note WHERE it is: after the distance matrix and
      // after `frameKey`, both of which are computed over every face in the
      // bucket. A set-aside face still counts toward another face's `unlocks`,
      // because confirming that other face really would resolve this one too —
      // dropping it earlier would make the queue's ordering signal quietly
      // wrong as well as shorter.
      if (!isShown(face)) continue
      const descriptor = set.data.subarray(i * set.dim, (i + 1) * set.dim)
      const match = matchFace(descriptor, prototypes)
      const present = confirmedInPhoto.get(face.media_id) ?? new Set()
      const top3 = match.candidates.slice(0, 3).map((c, idx) => {
        const next = match.candidates[idx + 1]
        const info = meta.get(c.label)
        return {
          personId: info ? info.personId : null,
          personName: info ? info.personName : null,
          distance: c.distance,
          margin: next ? next.distance - c.distance : Infinity,
          cooccurrence: scoreCooccurrence(Number(c.label), present),
        }
      })

      // unlocks: distinct FRAMES among this bucket's unidentified faces within
      // sameBandCutoff of face i, INCLUDING face i's own frame — the diagonal
      // is 0 by construction, so it is always counted without a special case.
      /** @type {Set<string>} */
      const frameSet = new Set()
      const row = i * n
      for (let j = 0; j < n; j++) {
        if (d[row + j] < sameBandCutoff) frameSet.add(frameKey.get(faces[j].media_id) ?? `media:${faces[j].media_id}`)
      }

      items.push({
        ...chipOf(face, chips),
        candidates: top3,
        unlocks: frameSet.size,
        routeState: face.route_state,
        routeReason: face.route_reason,
      })
    }
  }

  // Most-unlocking first, so abandoning the queue at any point has kept the
  // most value — the queue is never something that must be finished to be
  // worth anything (SESSION-2 §4b).
  items.sort((a, b) => b.unlocks - a.unlocks || a.faceId - b.faceId)
  const truncated = items.length > QUEUE_MAX_ITEMS
  return sendJson(res, 200, { items: items.slice(0, QUEUE_MAX_ITEMS), truncated })
}

/**
 * Load + validate one batch of face ids from a request body, refusing anything
 * missing or already soft-deleted. Shared by assign/unassign/not-a-face so all
 * three fail the same way on the same bad input.
 * @param {unknown} rawFaceIds
 * @returns {number[]}
 */
function validateFaceIds(rawFaceIds) {
  const result = validateIdArray(rawFaceIds, "faceIds", FACE_BATCH_MAX)
  if (!result.valid) throw new ValidationError(result.error)
  for (const id of result.value) {
    const face = getFaceById(id)
    if (!face || face.deleted_at) throw new NotFoundError(`Face ${id}`)
  }
  return result.value
}

/**
 * Bulk assign. Every face id must be one the queue would have shown.
 * @type {Types.faceAssignHandler}
 */
export async function assign(req, res, { session }) {
  const body = await parseBody(req)
  const faceIds = validateFaceIds(body.faceIds)
  assertBulkAssignable(faceIds)

  const personIdResult = validateId(body.personId, "personId")
  if (!personIdResult.valid) throw new ValidationError(personIdResult.error)
  const person = getPersonById(personIdResult.value)
  if (!person) throw new NotFoundError("Person")

  const actor = ledgerActor(session)
  const { identityId, changed, batchId } = withTransaction(() => {
    const existing = identitiesForPerson(personIdResult.value).find((i) => i.provenance === "confirmed")
    const identity =
      existing ??
      createIdentity({
        personId: personIdResult.value,
        // Through actorId, like every other actor field — see core/utils.js.
        confirmedBy: actorId(session?.token),
        confirmedAt: now(),
        provenance: "confirmed",
      })

    const batch = openBatch("manual", actor, `bulk assign of ${faceIds.length} face(s)`)
    let n = 0
    for (const faceId of faceIds) {
      // Appends AND projects. `changed` counts events appended, which is every
      // face: `validateFaceIds` already refused anything missing or deleted, so
      // this is the same number the old `setFaceIdentity` row count produced —
      // both were really "faces acted on", never "faces whose value differed".
      recordAssignment({ faceId, op: "assign", identityId: identity.id, actor, batchId: batch })
      n++
    }
    return { identityId: identity.id, changed: n, batchId: batch }
  })

  log({
    action: FACE_AUDIT_ACTIONS.ASSIGN,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "face_identity",
    resourceId: identityId,
    details: { personId: personIdResult.value, faceIds, changed, batchId },
  })

  return sendJson(res, 200, {
    success: true,
    personId: personIdResult.value,
    identityId,
    changed,
    batchId,
  })
}

/** @type {Types.faceUnassignHandler} */
export async function unassign(req, res, { session }) {
  const body = await parseBody(req)
  const faceIds = validateFaceIds(body.faceIds)
  assertBulkAssignable(faceIds)

  const actor = ledgerActor(session)
  const { changed, batchId } = withTransaction(() => {
    const batch = openBatch("manual", actor, `bulk unassign of ${faceIds.length} face(s)`)
    let n = 0
    for (const faceId of faceIds) {
      recordAssignment({ faceId, op: "clear", actor, batchId: batch })
      n++
    }
    return { changed: n, batchId: batch }
  })

  log({
    action: FACE_AUDIT_ACTIONS.UNASSIGN,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media_face",
    details: { faceIds, changed, batchId },
  })

  return sendJson(res, 200, { success: true, changed, batchId })
}

/** @type {Types.faceNotAFaceHandler} */
export async function notAFace(req, res, { session }) {
  const body = await parseBody(req)
  const faceIds = validateFaceIds(body.faceIds)
  // Enforced here too, and it is not obvious that it should be: a set-aside
  // face is exactly the kind you would want to sweep away in bulk. But "not a
  // face" is a judgement, the admin cannot have made it about a face the queue
  // never showed them, and this is a destructive write. A deliberate
  // "dismiss everything set aside" is a legitimate feature — as its own
  // endpoint, named for what it does, not as a side effect of this one.
  assertBulkAssignable(faceIds)

  const actor = ledgerActor(session)
  const { changed, batchId } = withTransaction(() => {
    const batch = openBatch("manual", actor, `bulk not-a-face of ${faceIds.length} face(s)`)
    let n = 0
    for (const faceId of faceIds) {
      // The soft delete is the PROJECTION of this event, not a second call:
      // `projectFace` sets `deleted_at` when the surviving event is
      // `not_a_face`, and un-sets it if that event is ever revoked. That is
      // what makes a mistaken bulk dismissal recoverable, where the old direct
      // `softDeleteFace` left no record that it had been a judgement at all.
      recordAssignment({ faceId, op: "not_a_face", actor, batchId: batch })
      n++
    }
    return { changed: n, batchId: batch }
  })

  log({
    action: FACE_AUDIT_ACTIONS.NOT_A_FACE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media_face",
    details: { faceIds, changed, batchId },
  })

  return sendJson(res, 200, { success: true, changed, batchId })
}

/**
 * The single-face escape hatch, for the per-photograph view.
 *
 * Exists because routing is enforced on the bulk paths, and without a way in,
 * `set_aside` would be a one-way door: a face the gate held back could never be
 * named even when the admin is looking straight at it and can see perfectly
 * well who it is. The queue is a filter on attention, not a verdict on the
 * photograph.
 *
 * Three things make this safe to exempt where the bulk paths are not:
 *
 *  - **Exactly one face.** Not "a small batch" — one. The blast radius of a
 *    client bug or a stale page is a single row.
 *  - **The face id is the whole request.** There is no group, no filter and no
 *    server-side selection to be wrong about; the admin named the row.
 *  - **The per-photograph view shows every face in the photograph**, set aside
 *    or not, so a face reaching here is one that was on screen.
 *
 * `personId: null` clears the assignment, so the same route is the undo.
 * @type {Types.faceAssignOneHandler}
 */
export async function assignOne(req, res, { session }) {
  const body = await parseBody(req)

  // ⚠ Checked BEFORE validateId, and it has to be. `validateId` is
  // `parseInt(String(value), 10)`, and `String([12, 13])` is `"12,13"`, which
  // parses to 12 — so an array reaches it and comes back as its FIRST element,
  // valid and silent. Everywhere else that is merely untidy; here it would turn
  // the one route exempt from the routing check into a bulk path that quietly
  // operates on one arbitrary member of whatever it was sent. "Exactly one
  // face" is the property this exemption rests on, so it is enforced on the
  // raw body rather than inferred from a validator that does not promise it.
  if (typeof body.faceId !== "number" && typeof body.faceId !== "string") {
    throw new ValidationError("faceId must be a single id — this route assigns exactly one face")
  }

  const faceIdResult = validateId(body.faceId, "faceId")
  if (!faceIdResult.valid) throw new ValidationError(faceIdResult.error)
  const face = getFaceById(faceIdResult.value)
  if (!face || face.deleted_at) throw new NotFoundError(`Face ${faceIdResult.value}`)

  const actor = ledgerActor(session)

  // Clearing is always allowed and needs no person to exist.
  if (body.personId === null || body.personId === undefined) {
    // ⚠ In a transaction, where it used to be a bare statement. That was a real
    // inconsistency and not a harmless one: `recordAssignment` writes two rows
    // (the event, then the projection), and an unwrapped pair can be
    // interrupted between them — leaving the ledger and the column disagreeing,
    // which is the exact failure the ledger exists to prevent. Every other
    // write path here was already wrapped; this one now is too.
    const changed = withTransaction(() => {
      recordAssignment({ faceId: face.id, op: "clear", actor, batchId: null })
      return true
    })
    log({
      action: FACE_AUDIT_ACTIONS.UNASSIGN,
      adminId: session?.token,
      ip: getClientIp(req),
      resourceType: "media_face",
      resourceId: face.id,
      details: { faceIds: [face.id], changed: changed ? 1 : 0, single: true },
    })
    return sendJson(res, 200, { success: true, personId: null, identityId: null, changed: changed ? 1 : 0 })
  }

  const personIdResult = validateId(body.personId, "personId")
  if (!personIdResult.valid) throw new ValidationError(personIdResult.error)
  const person = getPersonById(personIdResult.value)
  if (!person) throw new NotFoundError("Person")

  const { identityId, changed } = withTransaction(() => {
    const existing = identitiesForPerson(personIdResult.value).find((i) => i.provenance === "confirmed")
    const identity =
      existing ??
      createIdentity({
        personId: personIdResult.value,
        confirmedBy: actorId(session?.token),
        confirmedAt: now(),
        provenance: "confirmed",
      })
    // No batch: one face, one event. The undo is this same route with
    // `personId: null`, so a batch of one would be a row saying nothing the
    // event does not already say.
    recordAssignment({ faceId: face.id, op: "assign", identityId: identity.id, actor, batchId: null })
    return { identityId: identity.id, changed: 1 }
  })

  log({
    action: FACE_AUDIT_ACTIONS.ASSIGN,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "face_identity",
    resourceId: identityId,
    // `routeState` is recorded because this is the path that can name a face
    // the queue held back, and "which ones did we override" is a question the
    // Phase 4 tuning pass will want to ask of the log rather than guess at.
    details: {
      faceIds: [face.id],
      personId: personIdResult.value,
      changed,
      single: true,
      routeState: face.route_state,
    },
  })

  return sendJson(res, 200, { success: true, personId: personIdResult.value, identityId, changed })
}

/**
 * Every model_version's propagation proposals, computed fresh. Shared by the
 * GET (review) and POST (apply) handlers so the two can never disagree about
 * what was proposed — the POST re-derives rather than trusting a client to
 * hand back a proposal it was shown earlier.
 * @returns {{ proposals: Array<import('../../public/vision/types.js').PropagationProposal>, suppressed: Array<import('../../public/vision/types.js').PropagationSuppression>, rowByFaceId: Map<number, import('../../db/types.js').PropagationFaceRow> }}
 */
function computePropagations() {
  const opts = getDefaults("propagate")
  /** @type {Array<import('../../public/vision/types.js').PropagationProposal>} */
  const proposals = []
  /** @type {Array<import('../../public/vision/types.js').PropagationSuppression>} */
  const suppressed = []
  /** @type {Map<number, import('../../db/types.js').PropagationFaceRow>} */
  const rowByFaceId = new Map()

  // One model_version at a time: descriptors from different models are not
  // comparable, and rule 3's corroboration is a distance between two of them.
  for (const modelVersion of faceModelVersions()) {
    const rows = facesForPropagation(modelVersion)
    if (rows.length === 0) continue

    const first = blobToDescriptor(rows[0].descriptor)
    const dim = first.length
    const data = new Float32Array(rows.length * dim)
    /** @type {Array<import('../../public/vision/types.js').PropagationFace>} */
    const faces = []
    /** @type {import('../../db/types.js').PropagationFaceRow[]} */
    const kept = []
    for (const row of rows) {
      const vec = blobToDescriptor(row.descriptor)
      // Same defensive drop as the other loaders: a row whose descriptor is
      // the wrong length for its own model_version contributes nothing rather
      // than corrupting every later row's offset.
      if (vec.length !== dim) continue
      data.set(vec, kept.length * dim)
      faces.push({
        faceId: row.id,
        frame: row.frame_root_sha256,
        photoId: row.media_id,
        box: boxOf(row),
        identityId: row.face_identity_id,
        descriptorRow: kept.length,
      })
      kept.push(row)
      rowByFaceId.set(row.id, row)
    }
    if (faces.length === 0) continue

    const result = propagateWithinFrames(
      faces,
      { dim, data: data.subarray(0, kept.length * dim) },
      {
        minIou: /** @type {number} */ (opts.minIou),
        iouMargin: /** @type {number} */ (opts.iouMargin),
        corroborationCutoff: /** @type {number} */ (opts.corroborationCutoff),
      },
    )
    proposals.push(...result.proposals)
    suppressed.push(...result.suppressed)
  }

  return { proposals, suppressed, rowByFaceId }
}

/** @type {Types.facePropagationsHandler} */
export async function propagations(req, res) {
  const { proposals, rowByFaceId } = computePropagations()

  // Identity -> person, so the reviewer sees a name rather than a row id.
  /** @type {Map<number, { personId: number, personName: string } | null>} */
  const personByIdentity = new Map()
  /** @param {number} identityId */
  const personFor = (identityId) => {
    if (personByIdentity.has(identityId)) return personByIdentity.get(identityId) ?? null
    const identity = getIdentityById(identityId)
    const person = identity ? getPersonById(identity.person_id) : null
    const info = identity && person ? { personId: person.id, personName: person.display_name } : null
    personByIdentity.set(identityId, info)
    return info
  }

  const chips = mediaChipInfo([...new Set([...rowByFaceId.values()].map((r) => r.media_id))])

  const items = proposals.map((p) => {
    const from = rowByFaceId.get(p.fromFaceId)
    const to = rowByFaceId.get(p.toFaceId)
    const info = personFor(p.identityId)
    return {
      // The TARGET is the chip: it is the face the reviewer is being asked
      // about, and it is the one that changes if they say yes.
      ...(to ? chipOf(to, chips) : { faceId: p.toFaceId, mediaId: null, fileKey: null, width: null, height: null, box: null }),
      toFaceId: p.toFaceId,
      fromFaceId: p.fromFaceId,
      from: from ? chipOf(from, chips) : null,
      personId: info ? info.personId : null,
      personName: info ? info.personName : null,
      iou: p.iou,
      distance: p.distance,
    }
  })

  return sendJson(res, 200, { items })
}

/** @type {Types.facePropagateHandler} */
export async function propagate(req, res, { session }) {
  const body = await parseBody(req)
  const faceIds = validateFaceIds(body.toFaceIds)

  const { proposals } = computePropagations()
  /** @type {Map<number, number>} */
  const identityByTarget = new Map(proposals.map((p) => [p.toFaceId, p.identityId]))

  // A face the client asked for that is not (or is no longer) a live proposal
  // is refused rather than quietly skipped — the proposal set is recomputed
  // from current rows, so a stale UI must be told, not humoured.
  const unknown = faceIds.filter((id) => !identityByTarget.has(id))
  if (unknown.length > 0) {
    throw new ValidationError(
      `${unknown.length} face(s) are not current propagation proposals. Reload the proposal list and try again.`,
    )
  }

  const actor = ledgerActor(session)
  const { changed, identities, batchId } = withTransaction(() => {
    // The clearest case for a batch in the whole module: a propagation is a
    // bulk pass over MACHINE proposals, and the reason it is safe to offer at
    // all is that the whole pass can be taken back in one move if the
    // corroboration turns out to have been optimistic. Revoking it later leaves
    // any face an admin has since corrected by hand exactly as they left it —
    // plan §9b — because revocation is a filter over history, not an undo of
    // the rows.
    const batch = openBatch("propagate", actor, `propagate onto ${faceIds.length} face(s)`)
    /** @type {Map<number, number>} propagated-identity id, by source confirmed identity */
    const propagatedFor = new Map()
    let n = 0
    for (const faceId of faceIds) {
      const sourceIdentityId = /** @type {number} */ (identityByTarget.get(faceId))
      let target = propagatedFor.get(sourceIdentityId)
      if (target === undefined) {
        const source = getIdentityById(sourceIdentityId)
        if (!source) throw new NotFoundError(`Identity ${sourceIdentityId}`)
        // ⚠ Rule 4. The face is NEVER pointed at the confirmed identity: that
        // would let it seed a prototype (confirmedIdentityFaces selects
        // provenance='confirmed'), and an unreviewed guess reinforcing itself
        // is the exact feedback loop the provenance column exists to block.
        // It gets a separate, second-class 'propagated' identity for the same
        // person instead.
        const existing = identitiesForPerson(source.person_id).find((i) => i.provenance === "propagated")
        const identity =
          existing ??
          createIdentity({
            personId: source.person_id,
            confirmedBy: actorId(session?.token),
            confirmedAt: now(),
            provenance: "propagated",
          })
        target = identity.id
        propagatedFor.set(sourceIdentityId, target)
      }
      recordAssignment({ faceId, op: "assign", identityId: target, actor, batchId: batch })
      n++
    }
    return { changed: n, identities: [...propagatedFor.values()], batchId: batch }
  })

  log({
    action: FACE_AUDIT_ACTIONS.PROPAGATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media_face",
    details: { faceIds, changed, identities, batchId },
  })

  // `batchId` travels back so the pass is revocable by whoever applied it —
  // without it the batch exists but nothing outside the database knows its name.
  return sendJson(res, 200, { success: true, changed, batchId })
}

/** @type {Types.faceForMediaHandler} */
export async function forMedia(req, res, { params }) {
  const idResult = validateId(params.id, "media ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const media = getMediaById(idResult.value)
  if (!media || media.deleted_at) throw new NotFoundError("Media")

  const rows = facesForMediaWithNames(idResult.value)
  const faces = rows.map((row) => ({
    faceId: row.id,
    box: { x: row.bbox_x, y: row.bbox_y, w: row.bbox_w, h: row.bbox_h },
    personId: row.person_id,
    personName: row.person_name,
  }))

  return sendJson(res, 200, { faces })
}
