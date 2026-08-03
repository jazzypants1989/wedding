/**
 * @file The append-only assignment ledger (schema.js `add_vision_provenance`).
 *
 * `media_faces.face_identity_id` on its own is a value with no history: a bulk
 * propagate pass and a human's deliberate correction look identical in it, so
 * undoing the pass either takes the correction with it or takes nothing. Here
 * every decision is an EVENT, and the column is a PROJECTION of replaying
 * them. Revoking a batch is then a filter over history rather than a
 * destructive edit — and a later manual event still outranks the revoked bulk
 * one, which is the whole promise of plan §9b.
 *
 * Three rules this file exists to keep:
 *
 * 1. **Append and project are ONE call.** `recordAssignment` writes the event
 *    and materialises the column in the same breath. Nothing else may write
 *    `face_identity_id`. A trigger was considered and rejected: SQL cannot
 *    express "replay excluding batch X", so the logic would have to exist in
 *    JS anyway, and two implementations of one rule is how they drift.
 * 2. **No function here opens a transaction** (except `revokeBatch`, which is
 *    the one entry point that may own one). db/utils.js's `withTransaction` is
 *    a bare BEGIN IMMEDIATE with no savepoints — it does not nest — and every
 *    admin write path is already inside one.
 * 3. **Ordering is by `id`, never by `created_at`.** The timestamp has
 *    one-second resolution and a batch writes many events inside it, so
 *    "latest wins" by time would be a coin toss.
 */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now, withTransaction } from "./utils.js"

/**
 * How far `resolveIdentity` will follow `merged_into` before deciding the
 * chain is corrupt. Real merges chain a handful of times at most (a merge
 * points at a LIVE identity, so chains only lengthen when a target is itself
 * merged later); a cycle is impossible to create through the merge path and
 * only reachable by hand-editing rows. Bounded so that corruption is an error
 * inside one request rather than a hang.
 */
const MAX_MERGE_HOPS = 32

/** @type {Types.createBatch} */
export function createBatch({ batchId, kind, actor, note = null }) {
  sql`INSERT INTO face_assignment_batches (batch_id, kind, actor, note)
    VALUES (${batchId}, ${kind}, ${actor}, ${note})`.run()
  return /** @type {import('../types.js').FaceAssignmentBatch} */ (getBatch(batchId))
}

/** @type {Types.getBatch} */
export function getBatch(batchId) {
  return sql`SELECT * FROM face_assignment_batches WHERE batch_id = ${batchId}`.get()
}

/** @type {Types.recordAssignment} */
export function recordAssignment({
  faceId,
  op,
  identityId = null,
  actor,
  batchId = null,
  reason = null,
}) {
  // op/identity_id agreement is left to the schema trigger rather than
  // re-checked here: one enforcement point, and it holds for every writer
  // including a future one that forgets this module exists.
  const result = sql`INSERT INTO face_assignments (face_id, op, identity_id, actor, batch_id, reason)
    VALUES (${faceId}, ${op}, ${identityId}, ${actor}, ${batchId}, ${reason})`.run()

  // The same breath. A caller that appended without projecting would leave the
  // column disagreeing with the ledger, and every reader trusts the column.
  projectFace(faceId)

  return /** @type {import('../types.js').FaceAssignment} */ (
    sql`SELECT * FROM face_assignments WHERE id = ${Number(result.lastInsertRowid)}`.get()
  )
}

/** @type {Types.assignmentsForFace} */
export function assignmentsForFace(faceId) {
  return sql`SELECT * FROM face_assignments WHERE face_id = ${faceId} ORDER BY id`.all()
}

/** @type {Types.resolveIdentity} */
export function resolveIdentity(identityId) {
  if (identityId === null || identityId === undefined) return null

  let current = identityId
  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
    /** @type {{ id: number, merged_into: number | null, deleted_at: string | null } | undefined} */
    const row = sql`SELECT id, merged_into, deleted_at FROM face_identities
      WHERE id = ${current}`.get()
    // A dangling reference resolves to "nobody" rather than throwing: the row
    // it named is genuinely gone, and an event naming a deleted identity is a
    // true record of a decision about someone who no longer has an identity.
    if (!row) return null
    if (row.merged_into === null) return row.deleted_at === null ? row.id : null
    current = row.merged_into
  }

  throw new Error(
    `resolveIdentity: merge chain from identity ${identityId} exceeded ` +
      `${MAX_MERGE_HOPS} hops — face_identities.merged_into contains a cycle`,
  )
}

/** @type {Types.replayFace} */
export function replayFace(faceId, { ignoreBatchId = null } = {}) {
  /** @type {Array<{ op: import('../types.js').FaceAssignmentOp, identity_id: number | null, batch_id: string | null }>} */
  const events = sql`SELECT fa.op AS op, fa.identity_id AS identity_id, fa.batch_id AS batch_id
    FROM face_assignments fa
    LEFT JOIN face_assignment_batches b ON b.batch_id = fa.batch_id
    WHERE fa.face_id = ${faceId}
      -- A negative is a constraint ("this face is NOT that person"), never a
      -- state, so it can never be the surviving event.
      AND fa.op != 'negative'
      -- A revoked batch's events stay in the table and stop counting. That is
      -- what makes revocation reversible, and what lets a later manual event
      -- outlive the bulk pass it corrected.
      AND (fa.batch_id IS NULL OR b.revoked_at IS NULL)
    ORDER BY fa.id DESC`.all()

  for (const event of events) {
    if (ignoreBatchId !== null && event.batch_id === ignoreBatchId) continue
    if (event.op === "assign") {
      // Resolved, not raw: the identity may since have been merged into
      // another, and the event still correctly names the one it named.
      return { identityId: resolveIdentity(event.identity_id), notAFace: false }
    }
    if (event.op === "clear") return { identityId: null, notAFace: false }
    if (event.op === "not_a_face") return { identityId: null, notAFace: true }
  }

  return { identityId: null, notAFace: false }
}

/** @type {Types.projectFace} */
export function projectFace(faceId, opts = {}) {
  const verdict = replayFace(faceId, opts)

  sql`UPDATE media_faces SET face_identity_id = ${verdict.identityId}
    WHERE id = ${faceId}`.run()

  if (verdict.notAFace) {
    sql`UPDATE media_faces SET deleted_at = ${now()}
      WHERE id = ${faceId} AND deleted_at IS NULL`.run()
  } else {
    // ⚠ Only ever UN-delete a face the ledger itself deleted. `deleted_at` on
    // media_faces has a second author — schema.js's §10 precedence triggers
    // soft-delete an upload-sourced row the CLI has superseded — and clearing
    // it unconditionally here would resurrect superseded rows every time an
    // unrelated event was projected. So: revive only if a `not_a_face` event
    // exists in this face's history at all, revoked or not.
    const everMarked = sql`SELECT 1 FROM face_assignments
      WHERE face_id = ${faceId} AND op = 'not_a_face' LIMIT 1`.get()
    if (everMarked) {
      sql`UPDATE media_faces SET deleted_at = NULL
        WHERE id = ${faceId} AND deleted_at IS NOT NULL`.run()
    }
  }

  return verdict
}

/** @type {Types.revokeBatch} */
export function revokeBatch(batchId, actor) {
  const batch = getBatch(batchId)
  if (!batch) {
    throw new Error(`revokeBatch: no such batch "${batchId}"`)
  }

  // The one entry point here that may own a transaction: flagging the batch
  // and re-projecting its faces have to land together, or a crash between them
  // leaves the column disagreeing with the ledger. Callers that already hold a
  // transaction should call the two halves themselves rather than nest this
  // one (db/utils.js's withTransaction is a bare BEGIN IMMEDIATE).
  return withTransaction(() => {
    // Already-revoked batches keep their original revoked_at/revoked_by — a
    // second revocation is a no-op re-projection, not a re-dating of the first.
    if (batch.revoked_at === null) {
      sql`UPDATE face_assignment_batches
        SET revoked_at = ${now()}, revoked_by = ${actor}
        WHERE batch_id = ${batchId} AND revoked_at IS NULL`.run()
    }

    /** @type {Array<{ face_id: number }>} */
    const faces = sql`SELECT DISTINCT face_id FROM face_assignments
      WHERE batch_id = ${batchId}
      ORDER BY face_id`.all()

    for (const face of faces) projectFace(face.face_id)
    return faces.length
  })
}

/** @type {Types.negativesForFace} */
export function negativesForFace(faceId) {
  /** @type {Array<{ identity_id: number }>} */
  const rows = sql`SELECT DISTINCT fa.identity_id AS identity_id
    FROM face_assignments fa
    LEFT JOIN face_assignment_batches b ON b.batch_id = fa.batch_id
    WHERE fa.face_id = ${faceId}
      AND fa.op = 'negative'
      AND fa.identity_id IS NOT NULL
      AND (fa.batch_id IS NULL OR b.revoked_at IS NULL)`.all()

  // Resolved through merges, or a negative silently stops applying the moment
  // the identity it names is folded into another — and the suggestion it was
  // recorded to suppress comes straight back.
  /** @type {Set<number>} */
  const live = new Set()
  for (const row of rows) {
    const resolved = resolveIdentity(row.identity_id)
    if (resolved !== null) live.add(resolved)
  }
  return [...live].sort((a, b) => a - b)
}
