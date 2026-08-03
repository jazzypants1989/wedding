/**
 * @file db/face-assignments.js and db/vision-ingests.js — the append-only
 * assignment ledger and the ingest provenance it hangs off.
 *
 * The ledger exists because `media_faces.face_identity_id` on its own is a
 * value with no history: a bulk propagate pass and a human's deliberate
 * correction look identical in it, so undoing the pass either takes the
 * correction with it or takes nothing. Most of what is asserted below is that
 * second sentence, in one shape or another — above all
 * "a later manual correction survives revocation of an earlier batch", which is
 * the whole promise the ledger was built to keep.
 */

import { describe, it, before, beforeEach, after } from "node:test"
import assert from "node:assert"

import { init, close, getDb } from "../../../db/connection.js"
import { withTransaction } from "../../../db/utils.js"
import {
  createBatch,
  getBatch,
  recordAssignment,
  assignmentsForFace,
  resolveIdentity,
  replayFace,
  projectFace,
  revokeBatch,
  negativesForFace,
} from "../../../db/face-assignments.js"
import {
  createIngest,
  getIngestById,
  ingestsForModelVersion,
  assertModelVersionInvariant,
} from "../../../db/vision-ingests.js"

let seq = 0

/** @param {string} sql @param {Array<string | number | null>} params */
function insert(sql, params) {
  return Number(getDb().prepare(sql).run(...params).lastInsertRowid)
}

function makePerson() {
  seq++
  return insert("INSERT INTO people (display_name) VALUES (?)", [`Person ${seq}`])
}

function makeMedia() {
  seq++
  return insert(
    "INSERT INTO media (file_key, kind, section, status) VALUES (?, 'image', 'guest', 'approved')",
    [`ledgerkey${seq}`],
  )
}

/** A live confirmed identity for a fresh person — fresh because
 *  idx_face_identities_person allows only one live confirmed identity each.
 *  @returns {number} */
function makeIdentity() {
  return insert("INSERT INTO face_identities (person_id, provenance) VALUES (?, 'confirmed')", [
    makePerson(),
  ])
}

/** @param {number} [mediaId] @returns {number} */
function makeFace(mediaId) {
  return insert(
    `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, source)
     VALUES (?, 1, 2, 3, 4, 'test-model', 'cli')`,
    [mediaId ?? makeMedia()],
  )
}

/** @param {number} faceId */
function faceState(faceId) {
  return /** @type {{ face_identity_id: number | null, deleted_at: string | null }} */ (
    getDb()
      .prepare("SELECT face_identity_id, deleted_at FROM media_faces WHERE id = ?")
      .get(faceId)
  )
}

/** @param {number} from @param {number} into */
function merge(from, into) {
  getDb().prepare("UPDATE face_identities SET merged_into = ? WHERE id = ?").run(into, from)
}

/** @param {number} id */
function softDelete(id) {
  getDb()
    .prepare("UPDATE face_identities SET deleted_at = '2026-01-01' WHERE id = ?")
    .run(id)
}

/** An `assert.throws` matcher built from string methods — no regex literals
 *  anywhere in this repo, including the second argument to assert.throws.
 *  @param {string} needle */
function messageIncludes(needle) {
  /** @param {unknown} err @returns {boolean} */
  return (err) => err instanceof Error && err.message.includes(needle)
}

/** @param {Partial<{ datasetId: string, modelVersion: string, detectorSha256: string,
 *    embedderSha256: string, engineSha256: string, mirrorApplied: boolean,
 *    normalisation: string, routeProfile: string }>} [overrides] */
function ingestInput(overrides = {}) {
  return {
    datasetId: "test-dataset",
    modelVersion: "sface128-n127.5d128-nomirror",
    detectorSha256: "detector-hash",
    embedderSha256: "embedder-hash",
    engineSha256: "engine-hash",
    mirrorApplied: false,
    normalisation: "arcface",
    routeProfile: "test-profile",
    config: { engineVersion: "1.0.0", schemaVersion: 1, thresholds: { score: 0.5 } },
    ...overrides,
  }
}

function clearData() {
  const db = getDb()
  for (const table of [
    "face_assignments",
    "face_assignment_batches",
    "media_faces",
    "face_identities",
    "people",
    "media",
    "vision_ingests",
  ]) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
}

describe("db/face-assignments + db/vision-ingests", () => {
  before(() => init())
  beforeEach(() => clearData())
  after(() => {
    clearData()
    close()
  })

  describe("vision-ingests", () => {
    it("round-trips an ingest, serialising the allowlisted config", () => {
      const ingest = createIngest(ingestInput({ mirrorApplied: true }))

      assert.strictEqual(ingest.dataset_id, "test-dataset")
      // SQLite has no boolean; the column is 0/1 and the input is a boolean.
      assert.strictEqual(ingest.mirror_applied, 1)
      assert.deepStrictEqual(JSON.parse(ingest.config_json), {
        engineVersion: "1.0.0",
        schemaVersion: 1,
        thresholds: { score: 0.5 },
      })
      assert.deepStrictEqual({ ...getIngestById(ingest.id) }, { ...ingest })
    })

    it("lists every ingest of one descriptor space, id ascending", () => {
      const first = createIngest(ingestInput())
      const second = createIngest(ingestInput())
      createIngest(ingestInput({ modelVersion: "other-space" }))

      assert.deepStrictEqual(
        ingestsForModelVersion("sface128-n127.5d128-nomirror").map((r) => r.id),
        [first.id, second.id],
      )
    })

    describe("assertModelVersionInvariant", () => {
      it("permits an identical reuse — a second run of the same models", () => {
        createIngest(ingestInput())
        assert.doesNotThrow(() =>
          assertModelVersionInvariant("sface128-n127.5d128-nomirror", {
            embedderSha256: "embedder-hash",
            normalisation: "arcface",
            mirrorApplied: false,
          }),
        )
      })

      it("permits any triple when the model_version has never been used", () => {
        createIngest(ingestInput())
        assert.doesNotThrow(() =>
          assertModelVersionInvariant("a-brand-new-space", {
            embedderSha256: "different",
            normalisation: "ingraph",
            mirrorApplied: true,
          }),
        )
      })

      for (const [field, triple] of /** @type {Array<[string, import('../../../db/types.js').ModelVersionTriple]>} */ ([
        [
          "embedder_sha256",
          { embedderSha256: "a-different-embedder", normalisation: "arcface", mirrorApplied: false },
        ],
        [
          "normalisation",
          { embedderSha256: "embedder-hash", normalisation: "ingraph", mirrorApplied: false },
        ],
        [
          "mirror_applied",
          { embedderSha256: "embedder-hash", normalisation: "arcface", mirrorApplied: true },
        ],
      ])) {
        it(`refuses a model_version reused against a different ${field}`, () => {
          createIngest(ingestInput())
          // The whole point: a reused string silently mixes two descriptor
          // spaces inside one distance comparison, and that failure looks like
          // a slightly worse recogniser rather than like a bug.
          assert.throws(
            () => assertModelVersionInvariant("sface128-n127.5d128-nomirror", triple),
            messageIncludes(field),
          )
        })
      }
    })
  })

  describe("resolveIdentity", () => {
    it("returns a live identity unchanged, and null for null or unknown", () => {
      const identity = makeIdentity()
      assert.strictEqual(resolveIdentity(identity), identity)
      assert.strictEqual(resolveIdentity(null), null)
      assert.strictEqual(resolveIdentity(999999), null)
    })

    it("follows a two-hop merge chain to the live identity at the end", () => {
      const a = makeIdentity()
      const b = makeIdentity()
      const c = makeIdentity()
      merge(a, b)
      merge(b, c)

      assert.strictEqual(resolveIdentity(a), c)
      assert.strictEqual(resolveIdentity(b), c)
      assert.strictEqual(resolveIdentity(c), c)
    })

    it("returns null when the chain ends at a soft-deleted identity", () => {
      const a = makeIdentity()
      const b = makeIdentity()
      merge(a, b)
      softDelete(b)

      assert.strictEqual(resolveIdentity(a), null)
      assert.strictEqual(resolveIdentity(b), null)
    })

    it("throws rather than looping on a cycle", () => {
      // Unreachable through the merge path, which only ever points at a live
      // identity — so this is hand-made corruption, and an error inside one
      // request is strictly better than a hung one.
      const a = makeIdentity()
      const b = makeIdentity()
      merge(a, b)
      merge(b, a)

      assert.throws(() => resolveIdentity(a), messageIncludes("cycle"))
    })
  })

  describe("recordAssignment", () => {
    it("appends the event and projects the face in one call", () => {
      const face = makeFace()
      const identity = makeIdentity()

      const event = recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "admin1" })

      assert.strictEqual(event.op, "assign")
      assert.strictEqual(event.identity_id, identity)
      assert.strictEqual(event.actor, "admin1")
      // The projection is not a second call the caller could forget.
      assert.strictEqual(faceState(face).face_identity_id, identity)
    })

    it("works inside a caller's already-open transaction", () => {
      // db/utils.js's withTransaction is a bare BEGIN IMMEDIATE with no
      // savepoints — it does not nest — and every admin write path is already
      // inside one. Anything here that opened its own would throw.
      const face = makeFace()
      const identity = makeIdentity()

      const event = withTransaction(() =>
        recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "admin1" }),
      )

      assert.strictEqual(event.identity_id, identity)
      assert.strictEqual(faceState(face).face_identity_id, identity)
    })

    it("refuses an op/identity_id disagreement (the schema is the enforcement)", () => {
      const face = makeFace()
      assert.throws(
        () =>
          recordAssignment({
            faceId: face,
            op: "assign",
            identityId: null,
            actor: "admin1",
          }),
        messageIncludes("Invalid face assignment"),
      )
    })

    it("keeps every event, revoked or not, in assignmentsForFace", () => {
      const face = makeFace()
      const identity = makeIdentity()
      recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "admin1" })
      recordAssignment({ faceId: face, op: "clear", actor: "admin1" })

      // The audit view is the history, not the verdict.
      assert.deepStrictEqual(
        assignmentsForFace(face).map((e) => e.op),
        ["assign", "clear"],
      )
    })
  })

  describe("replayFace", () => {
    it("returns nothing for a face with no events", () => {
      assert.deepStrictEqual(replayFace(makeFace()), { identityId: null, notAFace: false })
    })

    it("lets the latest event win", () => {
      const face = makeFace()
      const first = makeIdentity()
      const second = makeIdentity()
      recordAssignment({ faceId: face, op: "assign", identityId: first, actor: "a" })
      recordAssignment({ faceId: face, op: "assign", identityId: second, actor: "a" })

      assert.deepStrictEqual(replayFace(face), { identityId: second, notAFace: false })

      recordAssignment({ faceId: face, op: "clear", actor: "a" })
      assert.deepStrictEqual(replayFace(face), { identityId: null, notAFace: false })
    })

    it("resolves the winning assign through a merge", () => {
      const face = makeFace()
      const from = makeIdentity()
      const into = makeIdentity()
      recordAssignment({ faceId: face, op: "assign", identityId: from, actor: "a" })
      merge(from, into)

      // The event still names the identity it named; the reader resolves.
      assert.strictEqual(replayFace(face).identityId, into)
      assert.strictEqual(assignmentsForFace(face)[0].identity_id, from)
    })

    it("skips negative events entirely when materialising", () => {
      const face = makeFace()
      const identity = makeIdentity()
      const notThem = makeIdentity()
      recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "a" })
      recordAssignment({ faceId: face, op: "negative", identityId: notThem, actor: "a" })

      // A negative is a constraint on what the face is NOT, never a state — so
      // the newest event is not the winner here.
      assert.deepStrictEqual(replayFace(face), { identityId: identity, notAFace: false })
    })

    it("skips a revoked batch's events", () => {
      const face = makeFace()
      const identity = makeIdentity()
      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "a", batchId: "b1" })
      assert.strictEqual(replayFace(face).identityId, identity)

      revokeBatch("b1", "admin2")
      assert.deepStrictEqual(replayFace(face), { identityId: null, notAFace: false })
    })

    it("honours ignoreBatchId without touching the batch", () => {
      const face = makeFace()
      const earlier = makeIdentity()
      const later = makeIdentity()
      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      recordAssignment({ faceId: face, op: "assign", identityId: earlier, actor: "a" })
      recordAssignment({ faceId: face, op: "assign", identityId: later, actor: "a", batchId: "b1" })

      // The preview half of revocation: what would this face be if that batch
      // had never happened?
      assert.strictEqual(replayFace(face, { ignoreBatchId: "b1" }).identityId, earlier)
      assert.strictEqual(replayFace(face).identityId, later)
      assert.strictEqual(getBatch("b1")?.revoked_at, null)
    })

    it("reports not_a_face, and orders it like any other event", () => {
      const face = makeFace()
      const identity = makeIdentity()
      recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "a" })
      recordAssignment({ faceId: face, op: "not_a_face", actor: "a" })

      assert.deepStrictEqual(replayFace(face), { identityId: null, notAFace: true })
    })
  })

  describe("projectFace", () => {
    it("materialises not_a_face as a soft delete, and undoes it on replay", () => {
      const face = makeFace()
      createBatch({ batchId: "b1", kind: "manual", actor: "a" })
      recordAssignment({ faceId: face, op: "not_a_face", actor: "a", batchId: "b1" })
      assert.ok(faceState(face).deleted_at, "not_a_face must soft-delete the row")

      revokeBatch("b1", "admin2")
      assert.strictEqual(faceState(face).deleted_at, null, "revoking must bring the face back")
    })

    it("never resurrects a face the ledger did not delete", () => {
      // deleted_at has a second author: schema.js's §10 precedence triggers
      // soft-delete an upload-sourced row the CLI has superseded. Projection
      // must not undo that.
      const media = makeMedia()
      const uploadFace = insert(
        `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, source)
         VALUES (?, 1, 2, 3, 4, 'test-model', 'upload')`,
        [media],
      )
      makeFace(media) // a cli row for the same photo retires the upload one
      assert.ok(faceState(uploadFace).deleted_at, "fixture is wrong: the trigger should have fired")

      const identity = makeIdentity()
      recordAssignment({ faceId: uploadFace, op: "assign", identityId: identity, actor: "a" })

      assert.ok(faceState(uploadFace).deleted_at, "a superseded row must stay superseded")
      assert.strictEqual(faceState(uploadFace).face_identity_id, identity)
    })

    it("returns what it wrote", () => {
      const face = makeFace()
      const identity = makeIdentity()
      recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "a" })

      assert.deepStrictEqual(projectFace(face), { identityId: identity, notAFace: false })
    })
  })

  describe("revokeBatch", () => {
    it("flags the batch, re-projects its faces, and reports how many", () => {
      const faces = [makeFace(), makeFace(), makeFace()]
      const identity = makeIdentity()
      createBatch({ batchId: "b1", kind: "propagate", actor: "a", note: "auto pass" })
      for (const face of faces) {
        recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "a", batchId: "b1" })
      }

      assert.strictEqual(revokeBatch("b1", "admin2"), 3)

      const batch = getBatch("b1")
      assert.ok(batch?.revoked_at)
      assert.strictEqual(batch?.revoked_by, "admin2")
      for (const face of faces) assert.strictEqual(faceState(face).face_identity_id, null)
    })

    it("throws for a batch that does not exist", () => {
      assert.throws(() => revokeBatch("nope", "admin2"), messageIncludes("no such batch"))
    })

    it("does not re-date an already-revoked batch", () => {
      const face = makeFace()
      const identity = makeIdentity()
      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "a", batchId: "b1" })
      revokeBatch("b1", "admin2")
      const first = getBatch("b1")

      revokeBatch("b1", "admin3")

      assert.strictEqual(getBatch("b1")?.revoked_at, first?.revoked_at)
      assert.strictEqual(getBatch("b1")?.revoked_by, "admin2")
    })

    it("LEAVES A LATER MANUAL CORRECTION STANDING — plan §9b's whole promise", () => {
      const corrected = makeFace()
      const untouched = makeFace()
      const wrong = makeIdentity()
      const right = makeIdentity()

      createBatch({ batchId: "auto", kind: "propagate", actor: "pipeline" })
      recordAssignment({ faceId: corrected, op: "assign", identityId: wrong, actor: "pipeline", batchId: "auto" })
      recordAssignment({ faceId: untouched, op: "assign", identityId: wrong, actor: "pipeline", batchId: "auto" })

      // A human notices one of them is wrong and fixes it by hand.
      recordAssignment({ faceId: corrected, op: "assign", identityId: right, actor: "admin1" })

      // Then the whole automatic pass is revoked.
      revokeBatch("auto", "admin1")

      // The correction outlives it: revocation is a FILTER over history, not a
      // compensating event, so the manual event simply becomes the newest
      // surviving one. Undoing the pass destructively would have taken this
      // with it.
      assert.strictEqual(faceState(corrected).face_identity_id, right)
      assert.strictEqual(faceState(untouched).face_identity_id, null)
    })
  })

  describe("negativesForFace", () => {
    it("returns the identities this face has been declared not to be", () => {
      const face = makeFace()
      const notA = makeIdentity()
      const notB = makeIdentity()
      recordAssignment({ faceId: face, op: "negative", identityId: notA, actor: "a" })
      recordAssignment({ faceId: face, op: "negative", identityId: notB, actor: "a" })
      recordAssignment({ faceId: face, op: "negative", identityId: notA, actor: "a" })

      assert.deepStrictEqual(negativesForFace(face), [notA, notB].sort((x, y) => x - y))
    })

    it("resolves through a merge and drops revoked ones", () => {
      const face = makeFace()
      const merged = makeIdentity()
      const into = makeIdentity()
      const revoked = makeIdentity()

      recordAssignment({ faceId: face, op: "negative", identityId: merged, actor: "a" })
      merge(merged, into)

      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      recordAssignment({ faceId: face, op: "negative", identityId: revoked, actor: "a", batchId: "b1" })
      revokeBatch("b1", "admin2")

      // Without resolution the negative would stop applying the moment its
      // identity was folded into another, and the suggestion it was recorded
      // to suppress would come straight back.
      assert.deepStrictEqual(negativesForFace(face), [into])
    })

    it("returns nothing for a face with no negatives", () => {
      const face = makeFace()
      recordAssignment({ faceId: face, op: "assign", identityId: makeIdentity(), actor: "a" })
      assert.deepStrictEqual(negativesForFace(face), [])
    })
  })
})
