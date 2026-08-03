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
 *  a guest only ever sets `face_identity_id` on `media_faces`.
 */
/** @import * as Types from './types.js' */

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
  setFaceIdentity,
  softDeleteFace,
  createIdentity,
  identitiesForPerson,
  blobToDescriptor,
} from "../../db/media-faces.js"
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

/** @type {Types.faceOverviewHandler} */
export async function overview(req, res) {
  const counts = getFaceCounts()
  const groupDefaults = getDefaults("group")
  const byVersion = loadUnidentifiedByModelVersion()

  /** @type {Array<{ faceIds: number[], media: Array<ReturnType<typeof chipOf>>, suggestion: { personId: number, personName: string, margin: number } | null, size: number }>} */
  const rawGroups = []

  for (const [modelVersion, { faces, set }] of byVersion) {
    if (faces.length === 0) continue
    const chips = mediaChipInfo([...new Set(faces.map((f) => f.media_id))])
    const photoIds = faces.map((f) => f.media_id)
    const clusters = groupFaces(set, {
      cutoff: /** @type {number} */ (groupDefaults.cutoff),
      photoIds,
      cannotLinkWithinPhoto: /** @type {boolean} */ (groupDefaults.cannotLinkWithinPhoto),
    })
    const { prototypes, meta } = loadPrototypesByModelVersion(modelVersion)

    for (const cluster of clusters) {
      const faceIds = cluster.members.map((i) => faces[i].id)
      const media = cluster.members.map((i) => chipOf(faces[i], chips))

      /** @type {{ personId: number, personName: string, margin: number } | null} */
      let suggestion = null
      if (prototypes.length > 0) {
        const vec = centroid(set, cluster.members)
        const match = matchFace(vec, prototypes)
        if (match.best) {
          const info = meta.get(match.best.label)
          if (info) suggestion = { personId: info.personId, personName: info.personName, margin: match.margin }
        }
      }

      rawGroups.push({ faceIds, media, suggestion, size: cluster.size })
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
  }))

  return sendJson(res, 200, { counts, groups })
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

  /** @type {Array<ReturnType<typeof chipOf> & { candidates: Array<{ personId: number | null, personName: string | null, distance: number, margin: number, cooccurrence: number }>, unlocks: number }>} */
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

      items.push({ ...chipOf(face, chips), candidates: top3, unlocks: frameSet.size })
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

/** @type {Types.faceAssignHandler} */
export async function assign(req, res, { session }) {
  const body = await parseBody(req)
  const faceIds = validateFaceIds(body.faceIds)

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
        // Through actorId, like every other actor field — see core/utils.js.
        confirmedBy: actorId(session?.token),
        confirmedAt: now(),
        provenance: "confirmed",
      })

    let n = 0
    for (const faceId of faceIds) {
      if (setFaceIdentity(faceId, identity.id)) n++
    }
    return { identityId: identity.id, changed: n }
  })

  log({
    action: FACE_AUDIT_ACTIONS.ASSIGN,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "face_identity",
    resourceId: identityId,
    details: { personId: personIdResult.value, faceIds, changed },
  })

  return sendJson(res, 200, { success: true, personId: personIdResult.value, identityId, changed })
}

/** @type {Types.faceUnassignHandler} */
export async function unassign(req, res, { session }) {
  const body = await parseBody(req)
  const faceIds = validateFaceIds(body.faceIds)

  const changed = withTransaction(() => {
    let n = 0
    for (const faceId of faceIds) {
      if (setFaceIdentity(faceId, null)) n++
    }
    return n
  })

  log({
    action: FACE_AUDIT_ACTIONS.UNASSIGN,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media_face",
    details: { faceIds, changed },
  })

  return sendJson(res, 200, { success: true, changed })
}

/** @type {Types.faceNotAFaceHandler} */
export async function notAFace(req, res, { session }) {
  const body = await parseBody(req)
  const faceIds = validateFaceIds(body.faceIds)

  const changed = withTransaction(() => {
    let n = 0
    for (const faceId of faceIds) {
      if (softDeleteFace(faceId)) n++
    }
    return n
  })

  log({
    action: FACE_AUDIT_ACTIONS.NOT_A_FACE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media_face",
    details: { faceIds, changed },
  })

  return sendJson(res, 200, { success: true, changed })
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

  const { changed, identities } = withTransaction(() => {
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
      if (setFaceIdentity(faceId, target)) n++
    }
    return { changed: n, identities: [...propagatedFor.values()] }
  })

  log({
    action: FACE_AUDIT_ACTIONS.PROPAGATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media_face",
    details: { faceIds, changed, identities },
  })

  return sendJson(res, 200, { success: true, changed })
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
