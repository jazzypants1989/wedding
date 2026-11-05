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
  reinstateBatch,
  batchRevocationHistory,
  recentBatches,
  negativesForFace,
} from "../../../db/face-assignments.js"
import {
  createIngest,
  getIngestById,
  ingestsForModelVersion,
  assertModelVersionInvariant,
} from "../../../db/vision-ingests.js"
import { mergeIdentityInto, softDeleteIdentity } from "../../../db/media-faces.js"

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

/** An upload-time detection: the row schema.js's §10 precedence triggers retire
 *  once the CLI has spoken for the same photo.
 *  @param {number} mediaId @returns {number} */
function makeUploadFace(mediaId) {
  return insert(
    `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, source)
     VALUES (?, 1, 2, 3, 4, 'test-model', 'upload')`,
    [mediaId],
  )
}

/** A CLI row stamped with the ingest run that produced it — which is what tells
 *  one generation of `--replace` rows from the next.
 *  @param {number} mediaId @param {number} ingestId @returns {number} */
function makeCliFaceFromIngest(mediaId, ingestId) {
  return insert(
    `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, source, ingest_id)
     VALUES (?, 1, 2, 3, 4, 'test-model', 'cli', ?)`,
    [mediaId, ingestId],
  )
}

/** `scripts/vision/ingest-faces.js`'s `retireCliFaces` — the `--replace` path,
 *  and `media_faces.deleted_at`'s third author. Reproduced here rather than
 *  imported because it is one statement and the script is not this file's
 *  subject; what matters is that it only ever touches LIVE rows.
 *  @param {number} mediaId */
function retireLiveCliFaces(mediaId) {
  getDb()
    .prepare(
      `UPDATE media_faces SET deleted_at = '2026-02-02T00:00:00.000Z'
       WHERE media_id = ? AND model_version = 'test-model'
         AND source = 'cli' AND deleted_at IS NULL`,
    )
    .run(mediaId)
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

    it("compresses a hand-made chain on the way through, so it is walked once", () => {
      // The hop bound is a CORRUPTION detector, and it can only be that if a
      // legitimate chain never approaches it. Reading one collapses it.
      const chain = [makeIdentity(), makeIdentity(), makeIdentity(), makeIdentity()]
      for (let i = 0; i < chain.length - 1; i++) merge(chain[i], chain[i + 1])
      const last = chain[chain.length - 1]

      assert.strictEqual(resolveIdentity(chain[0]), last)

      for (const id of chain.slice(0, -1)) {
        const row = /** @type {{ merged_into: number | null }} */ (
          getDb().prepare("SELECT merged_into FROM face_identities WHERE id = ?").get(id)
        )
        assert.strictEqual(row.merged_into, last, "every hop now points straight at the survivor")
      }
    })

    it("a long LEGITIMATE merge chain is not corruption — 40 merges, no throw", () => {
      // Each step merges the SURVIVING person into a new one, which is exactly
      // what api/admin/people.js does and the one shape that lengthens a chain
      // (a merge points at a live identity; chains grow when the TARGET is
      // merged later). Before path compression this threw "contains a cycle" on
      // merge 33 — and then the lineage was permanently un-mergeable, every
      // ledger write on its faces threw, and the operator was told their
      // database was corrupt.
      const identities = []
      for (let i = 0; i < 40; i++) identities.push(makeIdentity())

      const face = makeFace()
      recordAssignment({ faceId: face, op: "assign", identityId: identities[0], actor: "a" })

      for (let i = 0; i < identities.length - 1; i++) {
        // api/admin/people.js:250-252, verbatim in shape: redirect, retire,
        // re-project every affected face.
        assert.ok(
          mergeIdentityInto(identities[i], identities[i + 1]),
          `merge ${i + 1} of ${identities.length - 1} was refused`,
        )
        softDeleteIdentity(identities[i])
        projectFace(face)
      }

      const survivor = identities[identities.length - 1]
      for (const identity of identities) assert.strictEqual(resolveIdentity(identity), survivor)
      assert.strictEqual(faceState(face).face_identity_id, survivor)
    })
  })

  describe("createBatch", () => {
    it("refuses a kind that is not one of the four", () => {
      // `kind` is typed FaceAssignmentBatchKind and commented with its four
      // values, and until the enum trigger existed the database took anything.
      // A batch is the unit revocation acts on; a kind nobody can interpret is
      // a revocable unit nobody can explain.
      assert.throws(
        () => createBatch({ batchId: "b1", kind: /** @type {never} */ ("not-a-real-kind"), actor: "a" }),
        messageIncludes("Invalid batch kind"),
      )
      assert.strictEqual(getBatch("b1"), undefined)
    })

    it("accepts each of the four", () => {
      for (const kind of /** @type {import('../../../types.js').FaceAssignmentBatchKind[]} */ ([
        "label-import",
        "propagate",
        "manual",
        "merge-repair",
      ])) {
        assert.strictEqual(createBatch({ batchId: kind, kind, actor: "a" }).kind, kind)
      }
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

    // ---------------------------------------------------------------------
    // `media_faces.deleted_at` has THREE authors, not one: this projection,
    // schema.js's §10 precedence triggers, and `retireCliFaces` in
    // scripts/vision/ingest-faces.js (the `--replace` path). The projection may
    // only ever revive a retirement it WROTE ITSELF and still holds — asking
    // instead "does a not_a_face event exist in this face's history at all"
    // answers a different question (did the ledger ever speak?) and hands every
    // other author's row back to the live pool.
    //
    // Each sequence below ends with a row that must stay retired.
    // ---------------------------------------------------------------------
    describe("never resurrects a retirement it does not own", () => {
      it("upload retired by the ledger, then superseded while already dead", () => {
        // The masking case: the §10 trigger only touches LIVE rows, so the
        // ledger's own soft-delete hides this row from it. Revoking must not
        // then conclude the row would have been live all along.
        const media = makeMedia()
        const upload = makeUploadFace(media)
        createBatch({ batchId: "b1", kind: "manual", actor: "a" })
        recordAssignment({ faceId: upload, op: "not_a_face", actor: "a", batchId: "b1" })
        assert.ok(faceState(upload).deleted_at, "fixture: the ledger should have retired it")

        makeFace(media) // the authoritative cli row lands for the same photo
        revokeBatch("b1", "admin2")

        assert.ok(
          faceState(upload).deleted_at,
          "an upload row must not rejoin the live pool beside authoritative cli rows",
        )
      })

      it("upload revived by revocation, then retired by the trigger, then re-revoked", () => {
        const media = makeMedia()
        const upload = makeUploadFace(media)
        createBatch({ batchId: "b1", kind: "manual", actor: "a" })
        recordAssignment({ faceId: upload, op: "not_a_face", actor: "a", batchId: "b1" })
        revokeBatch("b1", "admin2")
        assert.strictEqual(faceState(upload).deleted_at, null, "fixture: revocation revives it")

        makeFace(media) // now the trigger DOES fire — it is the current author
        assert.ok(faceState(upload).deleted_at, "fixture: the §10 trigger should have retired it")

        revokeBatch("b1", "admin2") // a second revocation is a bare re-projection

        assert.ok(faceState(upload).deleted_at, "the trigger's retirement is not the ledger's to undo")
      })

      it("the same, when the re-projection is an unrelated one (the merge back-fill)", () => {
        // api/admin/people.js's merge loop calls projectFace on every affected
        // face. Nothing about a merge says anything about supersession.
        const media = makeMedia()
        const upload = makeUploadFace(media)
        createBatch({ batchId: "b1", kind: "manual", actor: "a" })
        recordAssignment({ faceId: upload, op: "not_a_face", actor: "a", batchId: "b1" })
        revokeBatch("b1", "admin2")
        makeFace(media)
        assert.ok(faceState(upload).deleted_at, "fixture: the §10 trigger should have retired it")

        projectFace(upload)

        assert.ok(faceState(upload).deleted_at, "any projection, not just revocation")
      })

      it("a cli generation superseded by --replace stays superseded", () => {
        // The invariant `assertNoLiveCliFaces` enforces is "at most one live cli
        // generation per (media_id, model_version)". Reviving a retired row from
        // an earlier generation falsifies it retroactively — after the check
        // that was supposed to guarantee it has already passed.
        const media = makeMedia()
        const first = createIngest(ingestInput()).id
        const second = createIngest(ingestInput()).id
        const genOne = makeCliFaceFromIngest(media, first)

        createBatch({ batchId: "b1", kind: "manual", actor: "a" })
        recordAssignment({ faceId: genOne, op: "not_a_face", actor: "a", batchId: "b1" })

        retireLiveCliFaces(media) // --replace; genOne is already dead, so skipped
        makeCliFaceFromIngest(media, second)

        revokeBatch("b1", "admin2")

        assert.ok(
          faceState(genOne).deleted_at,
          "a superseded cli generation must not rejoin the live pool",
        )
      })

      it("still revives the retirement it does own, and only once", () => {
        // The guard must not cost the ledger its own undo — that is the whole
        // promise of a revocable not_a_face.
        const face = makeFace()
        createBatch({ batchId: "b1", kind: "manual", actor: "a" })
        recordAssignment({ faceId: face, op: "not_a_face", actor: "a", batchId: "b1" })
        assert.ok(faceState(face).deleted_at)

        revokeBatch("b1", "admin2")
        assert.strictEqual(faceState(face).deleted_at, null)

        // And a face nobody ever called not-a-face is not the ledger's to touch.
        const superseded = makeUploadFace(makeMedia())
        getDb()
          .prepare("UPDATE media_faces SET deleted_at = '2026-03-03T00:00:00.000Z' WHERE id = ?")
          .run(superseded)
        recordAssignment({ faceId: superseded, op: "assign", identityId: makeIdentity(), actor: "a" })
        assert.ok(faceState(superseded).deleted_at)
      })
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

    it("cannot be undone behind the projection's back", () => {
      // Revocation is a FLAG, and every projection is derived from it. Clearing
      // the flag by hand would leave `media_faces.face_identity_id` describing a
      // world where the batch was revoked and the ledger describing one where it
      // was not, with nothing to say which is current.
      const face = makeFace()
      const identity = makeIdentity()
      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "a", batchId: "b1" })
      revokeBatch("b1", "admin2")

      assert.throws(
        () =>
          getDb()
            .prepare("UPDATE face_assignment_batches SET revoked_at = NULL WHERE batch_id = 'b1'")
            .run(),
        messageIncludes("matching face_batch_revocations row"),
      )
      assert.ok(getBatch("b1")?.revoked_at)
    })

    it("cannot have its attribution rewritten", () => {
      // face_assignments.actor is frozen by the append-only trigger; the actor
      // on the REVOCABLE UNIT was not, which is the more useful one to forge.
      createBatch({ batchId: "b1", kind: "propagate", actor: "pipeline", note: "auto pass" })

      for (const statement of [
        "UPDATE face_assignment_batches SET actor = 'someone-else' WHERE batch_id = 'b1'",
        "UPDATE face_assignment_batches SET kind = 'manual' WHERE batch_id = 'b1'",
        "UPDATE face_assignment_batches SET note = 'a different story' WHERE batch_id = 'b1'",
        "UPDATE face_assignment_batches SET batch_id = 'b2' WHERE batch_id = 'b1'",
      ]) {
        assert.throws(
          () => getDb().prepare(statement).run(),
          messageIncludes("only revoked_at/revoked_by"),
          statement,
        )
      }
      assert.strictEqual(getBatch("b1")?.actor, "pipeline")
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

    it("records the revocation in the batch's history, once", () => {
      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      revokeBatch("b1", "admin2")
      revokeBatch("b1", "admin3") // a bare re-projection, not a second revocation

      const history = batchRevocationHistory("b1")
      assert.deepStrictEqual(
        history.map((row) => [row.op, row.actor]),
        [["revoke", "admin2"]],
      )
      assert.strictEqual(history[0].created_at, getBatch("b1")?.revoked_at)
    })
  })

  describe("reinstateBatch", () => {
    it("clears the flag and re-projects, so the batch's events count again", () => {
      const faces = [makeFace(), makeFace()]
      const identity = makeIdentity()
      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      for (const face of faces) {
        recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "a", batchId: "b1" })
      }
      revokeBatch("b1", "admin2")
      for (const face of faces) assert.strictEqual(faceState(face).face_identity_id, null)

      assert.strictEqual(reinstateBatch("b1", "admin3"), 2)

      assert.strictEqual(getBatch("b1")?.revoked_at, null)
      assert.strictEqual(getBatch("b1")?.revoked_by, null)
      for (const face of faces) assert.strictEqual(faceState(face).face_identity_id, identity)
    })

    it("keeps a hand correction made after the batch, whether before or after the revocation", () => {
      const fixedFirst = makeFace()
      const fixedLater = makeFace()
      const untouched = makeFace()
      const wrong = makeIdentity()
      const right = makeIdentity()
      createBatch({ batchId: "auto", kind: "propagate", actor: "pipeline" })
      for (const face of [fixedFirst, fixedLater, untouched]) {
        recordAssignment({ faceId: face, op: "assign", identityId: wrong, actor: "pipeline", batchId: "auto" })
      }

      recordAssignment({ faceId: fixedFirst, op: "assign", identityId: right, actor: "admin1" })
      revokeBatch("auto", "admin1")
      recordAssignment({ faceId: fixedLater, op: "clear", actor: "admin1" })
      reinstateBatch("auto", "admin1")

      assert.strictEqual(faceState(fixedFirst).face_identity_id, right)
      assert.strictEqual(faceState(fixedLater).face_identity_id, null)
      assert.strictEqual(faceState(untouched).face_identity_id, wrong)
    })

    it("re-retires a not_a_face verdict the revocation had revived", () => {
      const face = makeFace()
      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      recordAssignment({ faceId: face, op: "not_a_face", actor: "a", batchId: "b1" })
      revokeBatch("b1", "admin2")
      assert.strictEqual(faceState(face).deleted_at, null)

      reinstateBatch("b1", "admin2")
      assert.ok(faceState(face).deleted_at)
    })

    it("refuses a batch that is not revoked, and one that does not exist", () => {
      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      assert.throws(() => reinstateBatch("b1", "admin2"), messageIncludes("is not revoked"))
      assert.throws(() => reinstateBatch("nope", "admin2"), messageIncludes("no such batch"))
      assert.deepStrictEqual(batchRevocationHistory("b1"), [])
    })

    it("keeps the whole history, and a later revocation is dated afresh", () => {
      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      revokeBatch("b1", "admin2")
      reinstateBatch("b1", "admin3")
      revokeBatch("b1", "admin4")

      const history = batchRevocationHistory("b1")
      assert.deepStrictEqual(
        history.map((row) => [row.op, row.actor]),
        [
          ["revoke", "admin2"],
          ["reinstate", "admin3"],
          ["revoke", "admin4"],
        ],
      )
      assert.strictEqual(getBatch("b1")?.revoked_by, "admin4")
      assert.strictEqual(getBatch("b1")?.revoked_at, history[2].created_at)
    })

    it("refuses a history row out of turn, and any edit to one", () => {
      createBatch({ batchId: "b1", kind: "propagate", actor: "a" })
      revokeBatch("b1", "admin2")

      // A history row that does not alternate is refused outright.
      assert.throws(
        () =>
          getDb()
            .prepare(
              "INSERT INTO face_batch_revocations (batch_id, op, actor, created_at) VALUES ('b1', 'revoke', 'x', 'now')",
            )
            .run(),
        messageIncludes("revoked only while live"),
      )
      assert.throws(
        () =>
          getDb()
            .prepare("UPDATE face_batch_revocations SET actor = 'someone-else' WHERE batch_id = 'b1'")
            .run(),
        messageIncludes("append-only"),
      )
      assert.strictEqual(batchRevocationHistory("b1")[0].actor, "admin2")
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

  describe("recentBatches", () => {
    it("counts a batch's events and the distinct faces they touch", () => {
      const faces = [makeFace(), makeFace()]
      const identity = makeIdentity()
      createBatch({ batchId: "b1", kind: "manual", actor: "admin1", note: "bulk assign of 2" })
      for (const face of faces) {
        recordAssignment({ faceId: face, op: "assign", identityId: identity, actor: "admin1", batchId: "b1" })
      }
      // A second event on a face already in the batch: the two counts diverge,
      // which is why both are reported rather than one standing in for the other.
      recordAssignment({ faceId: faces[0], op: "clear", actor: "admin1", batchId: "b1" })

      const rows = recentBatches(10)
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].batch_id, "b1")
      assert.strictEqual(rows[0].kind, "manual")
      assert.strictEqual(rows[0].actor, "admin1")
      assert.strictEqual(rows[0].note, "bulk assign of 2")
      assert.strictEqual(rows[0].events, 3)
      assert.strictEqual(rows[0].faces, 2)
      assert.strictEqual(rows[0].revoked_at, null)
    })

    it("keeps listing a batch after it is revoked, and says who did it", () => {
      // A revoked batch that vanished from the list would look like an offer to
      // revoke it again — and there would be nothing on screen saying it had
      // already happened, or by whom.
      const face = makeFace()
      createBatch({ batchId: "b1", kind: "propagate", actor: "pipeline" })
      recordAssignment({ faceId: face, op: "assign", identityId: makeIdentity(), actor: "pipeline", batchId: "b1" })
      revokeBatch("b1", "admin2")

      const rows = recentBatches(10)
      assert.strictEqual(rows.length, 1)
      assert.ok(rows[0].revoked_at)
      assert.strictEqual(rows[0].revoked_by, "admin2")
      assert.strictEqual(rows[0].events, 1, "revocation removes no events")
    })

    it("lists a batch whose events are all gone — zero, not absent", () => {
      // face_assignments.face_id is ON DELETE CASCADE, so hard-deleting the
      // faces empties a batch without removing it. The row still exists and is
      // still revocable; a list that silently dropped it would be lying.
      const face = makeFace()
      createBatch({ batchId: "b1", kind: "manual", actor: "admin1" })
      recordAssignment({ faceId: face, op: "assign", identityId: makeIdentity(), actor: "admin1", batchId: "b1" })
      getDb().prepare("DELETE FROM media_faces WHERE id = ?").run(face)

      const rows = recentBatches(10)
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].events, 0)
      assert.strictEqual(rows[0].faces, 0)
    })

    it("is newest first and honours the limit", () => {
      for (const id of ["b1", "b2", "b3"]) {
        createBatch({ batchId: id, kind: "manual", actor: "admin1" })
      }
      // created_at is CURRENT_TIMESTAMP at one-second resolution, so all three
      // share a timestamp here — the rowid tiebreak is what makes the order
      // deterministic rather than a coin toss, exactly as replay orders by id.
      assert.deepStrictEqual(
        recentBatches(10).map((b) => b.batch_id),
        ["b3", "b2", "b1"],
      )
      assert.deepStrictEqual(
        recentBatches(2).map((b) => b.batch_id),
        ["b3", "b2"],
      )
    })
  })
})
