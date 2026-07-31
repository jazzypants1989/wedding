/** @file Must-link propagation across near-duplicate frames.
 *
 *  `group.js` enforces cannot-link: two faces in ONE photograph are two
 *  different people. This file is the inverse constraint, and it is the one
 *  that recovers coverage rather than protecting accuracy: the *same* box in
 *  two near-identical frames — a burst, or a retouched and unretouched export
 *  of one exposure — is the same person. So an identity confirmed on a face
 *  the recogniser handled well can be carried onto the frame next door where
 *  the same person was blinking, turned, or soft enough that the quality gate
 *  discarded them.
 *
 *  That is coverage the gate throws away and nothing else gets back, which is
 *  also exactly why this has to be conservative. A wrong propagation is worse
 *  than a missing one: it attaches a real person's name to a face that is not
 *  them, silently, with no human in the loop. Four rules, all required, none
 *  of them individually sufficient:
 *
 *  **1. Frames resolve to a root, not to a neighbour.** A delivery links
 *  A→B and C→B; treating A and C as unrelated leaves exactly the pair the
 *  equivalence class exists to capture. Callers pass an already-resolved frame
 *  key (`frameRoots`' union-find output, or `media.frame_root_sha256`) — this
 *  module never follows a one-hop link itself.
 *
 *  **2. Geometry must be unambiguous, not merely best.** The highest-IoU box
 *  in the target frame has to beat the runner-up by a margin. Two guests
 *  standing shoulder to shoulder produce two boxes that both overlap a source
 *  box respectably, and "best of two near-ties" is how one person's name gets
 *  attached to the person beside them.
 *
 *  **3. Geometry is never trusted alone.** The target's own descriptor has to
 *  agree with the source's. This is the rule that catches the case geometry
 *  cannot see at all: between two frames of a burst, two people swapped
 *  places. No descriptor, or a descriptor that disagrees, means suppress — a
 *  face with nothing to corroborate it is not a weaker candidate, it is not a
 *  candidate.
 *
 *  **4. Propagated identities never seed prototypes.** Enforced in the schema
 *  and the query layer (`face_identities.provenance`,
 *  `db/media-faces.js`'s `confirmedIdentityFaces`), not here — but it is the
 *  reason this module marks every result as a *proposal*. Without it an
 *  unreviewed guess reinforces itself: propagate, re-prototype from the
 *  propagation, propagate further, and the error compounds with no human ever
 *  having seen it.
 *
 *  Everything here is a proposal. Nothing in this file decides anything.
 */
/** @import * as Types from './types.js' */

import { boxIou } from "./detect.js"
import { cosineDistance } from "./group.js"

/** @type {Types.propagateWithinFrames} */
export function propagateWithinFrames(faces, set, options) {
  const minIou = options.minIou
  const iouMargin = options.iouMargin
  const corroborationCutoff = options.corroborationCutoff

  /** @type {Types.PropagationProposal[]} */
  const proposals = []
  /** @type {Types.PropagationSuppression[]} */
  const suppressed = []

  /** @type {Map<string, number[]>} rows of `faces`, by resolved frame key */
  const byFrame = new Map()
  for (let i = 0; i < faces.length; i++) {
    const key = String(faces[i].frame)
    const list = byFrame.get(key)
    if (list) list.push(i)
    else byFrame.set(key, [i])
  }

  /** @param {number} i @param {number} j */
  const distance = (i, j) => {
    const a = faces[i].descriptorRow
    const b = faces[j].descriptorRow
    if (a === null || b === null) return null
    return cosineDistance(set.data.subarray(a * set.dim, (a + 1) * set.dim), set.data.subarray(b * set.dim, (b + 1) * set.dim))
  }

  // Sorted frame keys, and ascending rows within each, so the proposal list is
  // deterministic regardless of Map iteration order or input ordering.
  for (const key of [...byFrame.keys()].sort()) {
    const rows = /** @type {number[]} */ (byFrame.get(key))
    // One photograph in its class has no frame next door to propagate into.
    const photos = new Set(rows.map((r) => faces[r].photoId))
    if (photos.size < 2) continue

    /** @type {Map<number, number[]>} */
    const byPhoto = new Map()
    for (const r of rows) {
      const list = byPhoto.get(faces[r].photoId)
      if (list) list.push(r)
      else byPhoto.set(faces[r].photoId, [r])
    }

    for (const source of rows) {
      const identityId = faces[source].identityId
      if (identityId === null) continue

      for (const photoId of [...byPhoto.keys()].sort((a, b) => a - b)) {
        if (photoId === faces[source].photoId) continue
        const targets = /** @type {number[]} */ (byPhoto.get(photoId))

        // Rule 3's companion to cannot-link: if this person is ALREADY placed
        // in the target photograph, there is nothing to propagate and a second
        // box claiming them would contradict the frame's own assignment.
        if (targets.some((t) => faces[t].identityId === identityId)) continue

        let best = -1
        let bestIou = 0
        let runnerUpIou = 0
        for (const t of targets) {
          const iou = boxIou(faces[source].box, faces[t].box)
          if (iou > bestIou) {
            runnerUpIou = bestIou
            bestIou = iou
            best = t
          } else if (iou > runnerUpIou) {
            runnerUpIou = iou
          }
        }

        if (best < 0 || bestIou < minIou) {
          if (best >= 0) {
            suppressed.push({ fromFaceId: faces[source].faceId, toFaceId: faces[best].faceId, identityId, reason: "no-overlap", iou: bestIou, runnerUpIou, distance: null })
          }
          continue
        }
        if (bestIou - runnerUpIou < iouMargin) {
          suppressed.push({ fromFaceId: faces[source].faceId, toFaceId: faces[best].faceId, identityId, reason: "ambiguous-box", iou: bestIou, runnerUpIou, distance: null })
          continue
        }
        if (faces[best].identityId !== null) {
          // Someone ELSE is already confirmed on that box. Geometry says it is
          // our source; the existing assignment says otherwise. That is a
          // disagreement for a human, never something to overwrite.
          suppressed.push({ fromFaceId: faces[source].faceId, toFaceId: faces[best].faceId, identityId, reason: "already-identified", iou: bestIou, runnerUpIou, distance: null })
          continue
        }

        const d = distance(source, best)
        if (d === null) {
          suppressed.push({ fromFaceId: faces[source].faceId, toFaceId: faces[best].faceId, identityId, reason: "no-descriptor", iou: bestIou, runnerUpIou, distance: null })
          continue
        }
        if (d > corroborationCutoff) {
          suppressed.push({ fromFaceId: faces[source].faceId, toFaceId: faces[best].faceId, identityId, reason: "descriptor-disagrees", iou: bestIou, runnerUpIou, distance: d })
          continue
        }

        proposals.push({ fromFaceId: faces[source].faceId, toFaceId: faces[best].faceId, identityId, iou: bestIou, runnerUpIou, distance: d })
      }
    }
  }

  // Two sources landing on one target, or one identity landing on two boxes in
  // a single photograph, are both contradictions the geometry did not catch —
  // each individual proposal passed every test above on its own. Drop BOTH
  // sides rather than picking a winner: the tie-break that would choose one is
  // exactly the "best of two near-ties" reasoning rule 2 exists to refuse.
  /** @type {Map<number, number>} */
  const claimsOnTarget = new Map()
  /** @type {Map<string, number>} */
  const claimsByIdentityInPhoto = new Map()
  /** @type {Map<number, number>} */
  const photoOfFaceId = new Map()
  for (const f of faces) photoOfFaceId.set(f.faceId, f.photoId)

  for (const p of proposals) {
    claimsOnTarget.set(p.toFaceId, (claimsOnTarget.get(p.toFaceId) ?? 0) + 1)
    const slot = `${photoOfFaceId.get(p.toFaceId)}:${p.identityId}`
    claimsByIdentityInPhoto.set(slot, (claimsByIdentityInPhoto.get(slot) ?? 0) + 1)
  }

  /** @type {Types.PropagationProposal[]} */
  const kept = []
  for (const p of proposals) {
    const slot = `${photoOfFaceId.get(p.toFaceId)}:${p.identityId}`
    if ((claimsOnTarget.get(p.toFaceId) ?? 0) > 1) {
      suppressed.push({ ...p, reason: "conflicting-sources" })
      continue
    }
    if ((claimsByIdentityInPhoto.get(slot) ?? 0) > 1) {
      suppressed.push({ ...p, reason: "duplicate-identity-in-photo" })
      continue
    }
    kept.push(p)
  }

  return { proposals: kept, suppressed }
}
