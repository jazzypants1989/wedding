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
 * 2. **No function here opens a transaction** (except `revokeBatch` and
 *    `reinstateBatch`, the two entry points that may own one). db/utils.js's
 *    `withTransaction` is a bare BEGIN IMMEDIATE with no savepoints — it does
 *    not nest — and every admin write path is already inside one.
 * 3. **Ordering is by `id`, never by `created_at`.** The timestamp has
 *    one-second resolution and a batch writes many events inside it, so
 *    "latest wins" by time would be a coin toss.
 */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now, withBoundTransaction } from "./utils.js"

/**
 * How far `resolveIdentity` will follow `merged_into` before deciding the
 * chain is corrupt.
 *
 * This is a CORRUPTION detector, not a depth limit, and it can only be one of
 * those. It used to be both: chains lengthen when a TARGET is merged later, so
 * thirty-three ordinary merges of one lineage — each folding the surviving
 * person into a new one — built a thirty-three-hop chain, and the thirty-third
 * told the operator their database contained a cycle. It did not. The merge
 * then 500'd, the lineage was permanently un-mergeable, every ledger write on
 * any face resolving through it threw, and `revokeBatch` aborted wholesale on
 * any batch containing one.
 *
 * `mergeIdentityInto` now compresses at merge time and this function
 * compresses what it walks, so no chain a merge produces exceeds ONE hop.
 * Anything that reaches this bound is a hand-edited cycle, and an error inside
 * one request is strictly better than a hang.
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
  /** Every id walked that redirects somewhere — the chain behind us.
   *  @type {number[]} */
  const walked = []

  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
    /** @type {{ id: number, merged_into: number | null, deleted_at: string | null } | undefined} */
    const row = sql`SELECT id, merged_into, deleted_at FROM face_identities
      WHERE id = ${current}`.get()
    // A dangling reference resolves to "nobody" rather than throwing: the row
    // it named is genuinely gone, and an event naming a deleted identity is a
    // true record of a decision about someone who no longer has an identity.
    if (!row) return null

    if (row.merged_into === null) {
      // Opportunistic compression. Nothing a merge produces is longer than one
      // hop any more, so this fires only for a chain built before that was true
      // or written by hand — and it heals it on first read rather than leaving
      // it to grow towards the bound. The last entry already points here.
      //
      // Semantics are unchanged: `merged_into` names the end of the chain
      // either way, and the redirect is not the historical record — the ledger
      // is, and every event still names the identity it actually named.
      if (walked.length > 1) {
        sql`UPDATE face_identities SET merged_into = ${row.id}
          WHERE id IN ${sql.list(walked.slice(0, -1))}`.run()
      }
      return row.deleted_at === null ? row.id : null
    }

    walked.push(row.id)
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
    // The same timestamp into both columns: `ledger_retired_at` is the RECEIPT
    // for this retirement, and `deleted_at = ledger_retired_at` is the proof
    // that it is still the one in force. `AND deleted_at IS NULL` means the
    // ledger never claims a retirement somebody else already wrote — it simply
    // agrees with it, and leaves the row to its author.
    const retiredAt = now()
    sql`UPDATE media_faces SET deleted_at = ${retiredAt}, ledger_retired_at = ${retiredAt}
      WHERE id = ${faceId} AND deleted_at IS NULL`.run()
  } else {
    // ⚠ Only ever UN-delete a retirement THIS PROJECTION WROTE and still holds.
    //
    // `media_faces.deleted_at` has three authors: this projection, schema.js's
    // §10 precedence triggers (an upload-sourced row the CLI has superseded),
    // and `retireCliFaces` in scripts/vision/ingest-faces.js (the `--replace`
    // path). The old test here — "does a `not_a_face` event exist in this
    // face's history at all, revoked or not" — asked whether the LEDGER EVER
    // SPOKE, which is a different question from who wrote the value currently
    // in the column, and answered yes for rows the other two had retired.
    //
    // Keying on the receipt answers the right one. Any later write to
    // `deleted_at` by anybody breaks the match and ends the claim, without that
    // writer needing to know this column exists.
    //
    // The one thing a receipt cannot see by itself is that a ledger retirement
    // MASKS the other authors: they all retire live rows only, so a face this
    // projection has already retired is invisible to them and the receipt is
    // never overwritten. schema.js's `media_faces_supersession_releases_ledger_claim`
    // closes that — it clears `ledger_retired_at` at the moment a CLI row
    // supersedes the photo, whether the retired row is live or already dead.
    sql`UPDATE media_faces SET deleted_at = NULL, ledger_retired_at = NULL
      WHERE id = ${faceId}
        AND deleted_at IS NOT NULL
        AND ledger_retired_at IS NOT NULL
        AND deleted_at = ledger_retired_at`.run()
  }

  return verdict
}

/** Re-project every face a batch touched. Returns how many. No transaction of
 *  its own — both callers below hold one.
 *  @param {string} batchId
 *  @returns {number} */
function reprojectBatch(batchId) {
  /** @type {Array<{ face_id: number }>} */
  const faces = sql`SELECT DISTINCT face_id FROM face_assignments
    WHERE batch_id = ${batchId}
    ORDER BY face_id`.all()

  for (const face of faces) projectFace(face.face_id)
  return faces.length
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
  // one (neither db/utils.js transaction helper has savepoints).
  //
  // ⚠ `withBoundTransaction`, NOT `withTransaction`. Every other statement in
  // this module runs through `sql``` — i.e. through whatever connection
  // `bindExecutor` last named — while `withTransaction` opens its BEGIN on
  // db/connection.js's singleton. In the server those are the same connection
  // and the difference is invisible; in a vision CLI, which opens its own
  // `DatabaseSync` and binds it without ever calling `init()`, the singleton
  // does not exist and this function threw "Database not initialized" before
  // it could revoke anything. Worse if the singleton HAD been initialised: the
  // BEGIN would have been held on one connection while the re-projections
  // below were written through another, so the two halves this transaction
  // exists to keep together would not have been in it at all.
  return withBoundTransaction(() => {
    // Already-revoked batches keep their original revoked_at/revoked_by — a
    // second revocation is a no-op re-projection, not a re-dating of the first.
    // Re-read inside the transaction: the history row below must alternate.
    const current = getBatch(batchId)
    if (current && current.revoked_at === null) {
      // History first, then the flag that projects it. schema.js's
      // `face_assignment_batches_revocation_follows_history` refuses the UPDATE
      // unless it matches this row exactly — same timestamp, same actor.
      const at = now()
      sql`INSERT INTO face_batch_revocations (batch_id, op, actor, created_at)
        VALUES (${batchId}, 'revoke', ${actor}, ${at})`.run()
      sql`UPDATE face_assignment_batches
        SET revoked_at = ${at}, revoked_by = ${actor}
        WHERE batch_id = ${batchId} AND revoked_at IS NULL`.run()
    }

    return reprojectBatch(batchId)
  })
}

/** @type {Types.reinstateBatch} */
export function reinstateBatch(batchId, actor) {
  if (!getBatch(batchId)) {
    throw new Error(`reinstateBatch: no such batch "${batchId}"`)
  }

  // `revokeBatch` in reverse, under the same transaction rules (see there).
  // Nothing about the events changes: they never left the ledger, they stopped
  // counting, and now they count again. Replay is newest-id first, so a face
  // corrected by hand after the batch — before or after the revocation — keeps
  // that correction, exactly as revocation promised.
  return withBoundTransaction(() => {
    const current = getBatch(batchId)
    if (!current || current.revoked_at === null) {
      // Refused rather than a no-op, unlike a second revocation: "reinstate"
      // on a live batch means the caller's picture of this batch is wrong, and
      // the history must not record a reinstatement of something never revoked.
      throw new Error(`reinstateBatch: batch "${batchId}" is not revoked`)
    }

    sql`INSERT INTO face_batch_revocations (batch_id, op, actor, created_at)
      VALUES (${batchId}, 'reinstate', ${actor}, ${now()})`.run()
    sql`UPDATE face_assignment_batches
      SET revoked_at = NULL, revoked_by = NULL
      WHERE batch_id = ${batchId} AND revoked_at IS NOT NULL`.run()

    return reprojectBatch(batchId)
  })
}

/** @type {Types.batchRevocationHistory} */
export function batchRevocationHistory(batchId) {
  return sql`SELECT * FROM face_batch_revocations WHERE batch_id = ${batchId} ORDER BY id`.all()
}

/** @type {Types.recentBatches} */
export function recentBatches(limit) {
  // LEFT JOIN, not INNER: a batch whose faces have since been hard-deleted
  // (`face_assignments.face_id` is ON DELETE CASCADE) has no events left and
  // must still be listed — it exists, it may still be revoked, and a row that
  // silently disappears from a history list is worse than one reading zero.
  //
  // Ordered by `created_at` DESC with `rowid` as the tiebreak, for the same
  // reason replay orders by id: the column is CURRENT_TIMESTAMP at one-second
  // resolution, and several batches inside one second is an ordinary Tuesday
  // for someone working through the Faces tab.
  return sql`SELECT b.batch_id AS batch_id, b.kind AS kind, b.actor AS actor, b.note AS note,
      b.created_at AS created_at, b.revoked_at AS revoked_at, b.revoked_by AS revoked_by,
      COUNT(fa.id) AS events,
      COUNT(DISTINCT fa.face_id) AS faces
    FROM face_assignment_batches b
    LEFT JOIN face_assignments fa ON fa.batch_id = b.batch_id
    GROUP BY b.batch_id
    ORDER BY b.created_at DESC, b.rowid DESC
    LIMIT ${limit}`.all()
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
