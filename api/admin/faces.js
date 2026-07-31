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
import { log } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import { validateId, validateIdArray, ValidationError, NotFoundError } from "../../core/validation.js"
import { withTransaction } from "../../db/utils.js"
import { getMediaById } from "../../db/media.js"
import { getGuestById } from "../guests/data.js"
import {
  getFaceCounts,
  unidentifiedFacesWithDescriptors,
  confirmedIdentityFaces,
  facesForMediaWithNames,
  getFaceById,
  setFaceIdentity,
  softDeleteFace,
  createIdentity,
  identitiesForGuest,
  blobToDescriptor,
} from "../../db/media-faces.js"
import { now } from "../../db/utils.js"
import { groupFaces, distanceMatrix, centroid } from "../../public/vision/group.js"
import { buildPrototypes, matchFace } from "../../public/vision/assign.js"
import { getDefaults } from "../../public/vision/defaults.js"

/** Audit action names for this module. Not registered in core/utils.js's
 *  AUDIT_ACTIONS table (out of scope for this change) — `log()`'s `action`
 *  field is a plain string, so a local, equally-namespaced literal works the
 *  same way and needs no edit to that shared, frozen table. */
const FACE_AUDIT_ACTIONS = Object.freeze({
  ASSIGN: "FACE_ASSIGN",
  UNASSIGN: "FACE_UNASSIGN",
  NOT_A_FACE: "FACE_NOT_A_FACE",
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
 * model_version, plus a label -> {guestId, guestName} lookup. Propagated
 * identities never contribute (db/media-faces.js's query already excludes
 * them) — SPEC §9's feedback-loop guard.
 * @param {string} modelVersion
 * @returns {{ prototypes: import('../../public/vision/types.js').Prototype[], meta: Map<string, { guestId: number, guestName: string }> }}
 */
function loadPrototypesByModelVersion(modelVersion) {
  const rows = confirmedIdentityFaces(modelVersion)
  /** @type {Map<string, { guestId: number, guestName: string }>} */
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
    if (!meta.has(label)) meta.set(label, { guestId: row.guest_id, guestName: row.guest_name })
  })

  const prototypes = buildPrototypes({ dim, data }, assignments)
  return { prototypes, meta }
}

/** @param {UnidentifiedFaceRow} face */
function boxOf(face) {
  return { x: face.bbox_x, y: face.bbox_y, w: face.bbox_w, h: face.bbox_h }
}

/** @type {Types.faceOverviewHandler} */
export async function overview(req, res) {
  const counts = getFaceCounts()
  const groupDefaults = getDefaults("group")
  const byVersion = loadUnidentifiedByModelVersion()

  /** @type {Array<{ faceIds: number[], media: Array<{ faceId: number, mediaId: number, box: { x: number, y: number, w: number, h: number } }>, suggestion: { guestId: number, guestName: string, margin: number } | null, size: number }>} */
  const rawGroups = []

  for (const [modelVersion, { faces, set }] of byVersion) {
    if (faces.length === 0) continue
    const photoIds = faces.map((f) => f.media_id)
    const clusters = groupFaces(set, {
      cutoff: /** @type {number} */ (groupDefaults.cutoff),
      photoIds,
      cannotLinkWithinPhoto: /** @type {boolean} */ (groupDefaults.cannotLinkWithinPhoto),
    })
    const { prototypes, meta } = loadPrototypesByModelVersion(modelVersion)

    for (const cluster of clusters) {
      const faceIds = cluster.members.map((i) => faces[i].id)
      const media = cluster.members.map((i) => ({
        faceId: faces[i].id,
        mediaId: faces[i].media_id,
        box: boxOf(faces[i]),
      }))

      /** @type {{ guestId: number, guestName: string, margin: number } | null} */
      let suggestion = null
      if (prototypes.length > 0) {
        const vec = centroid(set, cluster.members)
        const match = matchFace(vec, prototypes)
        if (match.best) {
          const info = meta.get(match.best.label)
          if (info) suggestion = { guestId: info.guestId, guestName: info.guestName, margin: match.margin }
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

/** @type {Types.faceQueueHandler} */
export async function queue(req, res) {
  const assignDefaults = getDefaults("assign")
  const sameBandCutoff = /** @type {number} */ (assignDefaults.sameBandCutoff)
  const byVersion = loadUnidentifiedByModelVersion()

  /** @type {Array<{ faceId: number, mediaId: number, box: { x: number, y: number, w: number, h: number }, candidates: Array<{ guestId: number | null, guestName: string | null, distance: number, margin: number }>, unlocks: number }>} */
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

    for (let i = 0; i < faces.length; i++) {
      const face = faces[i]
      const descriptor = set.data.subarray(i * set.dim, (i + 1) * set.dim)
      const match = matchFace(descriptor, prototypes)
      const top3 = match.candidates.slice(0, 3).map((c, idx) => {
        const next = match.candidates[idx + 1]
        const info = meta.get(c.label)
        return {
          guestId: info ? info.guestId : null,
          guestName: info ? info.guestName : null,
          distance: c.distance,
          margin: next ? next.distance - c.distance : Infinity,
        }
      })

      // unlocks: distinct media (frames) among this bucket's unidentified faces
      // within sameBandCutoff of face i, INCLUDING face i's own photo — the
      // diagonal is 0 by construction, so it is always counted without a
      // special case.
      /** @type {Set<number>} */
      const mediaSet = new Set()
      const row = i * n
      for (let j = 0; j < n; j++) {
        if (d[row + j] < sameBandCutoff) mediaSet.add(faces[j].media_id)
      }

      items.push({
        faceId: face.id,
        mediaId: face.media_id,
        box: boxOf(face),
        candidates: top3,
        unlocks: mediaSet.size,
      })
    }
  }

  items.sort((a, b) => b.unlocks - a.unlocks)
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

  const guestIdResult = validateId(body.guestId, "guestId")
  if (!guestIdResult.valid) throw new ValidationError(guestIdResult.error)
  const guest = getGuestById(guestIdResult.value)
  if (!guest) throw new NotFoundError("Guest")

  const { identityId, changed } = withTransaction(() => {
    const existing = identitiesForGuest(guestIdResult.value).find((i) => i.provenance === "confirmed")
    const identity =
      existing ??
      createIdentity({
        guestId: guestIdResult.value,
        confirmedBy: session?.token ?? null,
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
    details: { guestId: guestIdResult.value, faceIds, changed },
  })

  return sendJson(res, 200, { success: true, guestId: guestIdResult.value, identityId, changed })
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
    guestId: row.guest_id,
    guestName: row.guest_name,
  }))

  return sendJson(res, 200, { faces })
}
