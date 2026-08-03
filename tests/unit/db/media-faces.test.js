/**
 * @file Unit tests for the face pipeline schema (media_faces, face_identities)
 * and db/media-faces.js. Covers docs/post-wedding/SPEC-vision-lab.md §10:
 *   - cascade delete: media -> media_faces rows gone
 *   - deleting a guest UNLINKS the person (people.guest_id ON DELETE SET NULL)
 *     and leaves their identity and faces alone — the old schema cascaded a
 *     guest deletion straight through to face_identities and destroyed the
 *     naming with it
 *   - deleting an identity nulls media_faces.face_identity_id (ON DELETE SET
 *     NULL) — the action D1's table rebuild has to keep from firing
 *   - the precedence trigger, both arrival orders: upload-then-cli (the
 *     upload rows get soft-deleted when the cli row lands) and
 *     cli-then-upload (the upload row is born already superseded)
 *   - source / provenance enum triggers reject bad values
 *   - db/media-faces.js CRUD helpers
 */

import { describe, it, before, beforeEach, after } from "node:test"
import assert from "node:assert"

import { init, close, getDb } from "../../../db/connection.js"
import {
  insertFace,
  getFaceById,
  facesForMedia,
  softDeleteFace,
  createIdentity,
  getIdentityById,
  identitiesForPerson,
  softDeleteIdentity,
  mediaWithFaces,
  mergeIdentityInto,
  faceIdsForIdentity,
  confirmedIdentityFaces,
  confirmedIdentitiesPerMedia,
  confirmedCooccurrence,
  facesForMediaWithNames,
  descriptorToBlob,
} from "../../../db/media-faces.js"
import { projectFace, recordAssignment } from "../../../db/face-assignments.js"

/** Point a face at an identity (or clear it) the ONLY way there now is: append
 *  a ledger event, which projects the column in the same call. `setFaceIdentity`
 *  used to do this and is deleted — see db/media-faces.js's header.
 *  @param {number} faceId @param {number | null} identityId */
function assignFace(faceId, identityId) {
  recordAssignment({
    faceId,
    op: identityId === null ? "clear" : "assign",
    identityId,
    actor: "test",
  })
}

let guestSeq = 0
let personSeq = 0
let fileKeySeq = 0

/** @returns {number} */
function makeGuest() {
  guestSeq++
  return Number(
    getDb()
      .prepare(
        `INSERT INTO guests (name, email, phone, party_size, invite_code, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(`Face Guest ${guestSeq}`, null, null, 1, `FACEG${guestSeq}`, "pending", null)
      .lastInsertRowid,
  )
}

/** A person — who a face belongs to. `guestId` is optional because the cast is
 *  bigger than the invitation roster, which is the whole reason this table
 *  exists (D10).
 *  @param {number | null} [guestId]
 *  @returns {number} */
function makePerson(guestId = null) {
  personSeq++
  return Number(
    getDb()
      .prepare(`INSERT INTO people (display_name, guest_id) VALUES (?, ?)`)
      .run(`Face Person ${personSeq}`, guestId).lastInsertRowid,
  )
}

/** @returns {number} */
function makeMedia() {
  fileKeySeq++
  return Number(
    getDb()
      .prepare(
        `INSERT INTO media (file_key, account_id, kind, section, status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(`facekey${fileKeySeq}`, null, "image", "guest", "approved").lastInsertRowid,
  )
}

/**
 * @param {number} mediaId
 * @param {"cli" | "upload"} source
 */
function insertBasicFace(mediaId, source) {
  return insertFace({
    mediaId,
    bbox: { x: 1, y: 2, w: 100, h: 120 },
    landmarks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    signals: {
      score: 0.9,
      boxPx: 100,
      borderPx: 10,
      eyeRatio: 0.4,
      eyeAngle: 0.01,
      alignScale: 1.0,
      residual: 0.2,
      outsideFraction: 0,
      sharpness: 50,
    },
    descriptor: null,
    modelVersion: "test-v1",
    source,
  })
}

/** A face carrying a descriptor, so it is visible to the queries that require
 *  one (confirmedIdentityFaces and friends). The vector is invented — nothing
 *  in tests/ ever describes a photograph.
 *  @param {number} mediaId */
function insertDescribedFace(mediaId) {
  return insertFace({
    mediaId,
    bbox: { x: 1, y: 2, w: 100, h: 120 },
    landmarks: null,
    signals: null,
    descriptor: descriptorToBlob(Float32Array.from([1, 0, 0, 0])),
    modelVersion: "test-v1",
    source: "cli",
  })
}

function clearData() {
  const db = getDb()
  db.prepare("DELETE FROM face_assignments").run()
  db.prepare("DELETE FROM face_assignment_batches").run()
  db.prepare("DELETE FROM media_faces").run()
  db.prepare("DELETE FROM face_identities").run()
  db.prepare("DELETE FROM media").run()
  db.prepare("DELETE FROM guests").run()
}

describe("db/media-faces + media_faces/face_identities schema", () => {
  before(() => init())
  beforeEach(() => clearData())
  after(() => {
    clearData()
    close()
  })

  describe("insertFace / facesForMedia", () => {
    it("inserts a face row and reads it back with all nine signal_ columns", () => {
      const mediaId = makeMedia()
      const face = insertBasicFace(mediaId, "cli")

      assert.strictEqual(face.media_id, mediaId)
      assert.strictEqual(face.bbox_x, 1)
      assert.strictEqual(face.bbox_w, 100)
      assert.strictEqual(face.source, "cli")
      assert.strictEqual(face.model_version, "test-v1")
      assert.strictEqual(face.descriptor, null)
      assert.deepStrictEqual(JSON.parse(/** @type {string} */ (face.landmarks)), [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ])
      assert.strictEqual(face.signal_score, 0.9)
      assert.strictEqual(face.signal_boxPx, 100)
      assert.strictEqual(face.signal_borderPx, 10)
      assert.strictEqual(face.signal_eyeRatio, 0.4)
      assert.strictEqual(face.signal_eyeAngle, 0.01)
      assert.strictEqual(face.signal_alignScale, 1.0)
      assert.strictEqual(face.signal_residual, 0.2)
      assert.strictEqual(face.signal_outsideFraction, 0)
      assert.strictEqual(face.signal_sharpness, 50)
    })

    it("allows a detection-only row (null descriptor, null signals, null landmarks)", () => {
      const mediaId = makeMedia()
      const face = insertFace({
        mediaId,
        bbox: { x: 0, y: 0, w: 50, h: 50 },
        landmarks: null,
        signals: null,
        descriptor: null,
        modelVersion: "test-v1",
        source: "cli",
      })
      assert.strictEqual(face.landmarks, null)
      assert.strictEqual(face.signal_score, null)
      assert.strictEqual(face.descriptor, null)
    })

    it("facesForMedia excludes soft-deleted rows", () => {
      const mediaId = makeMedia()
      const face = insertBasicFace(mediaId, "cli")
      assert.strictEqual(facesForMedia(mediaId).length, 1)

      softDeleteFace(face.id)
      assert.strictEqual(facesForMedia(mediaId).length, 0)
    })
  })

  describe("face_identities CRUD", () => {
    it("creates an identity defaulting to provenance='confirmed'", () => {
      const personId = makePerson()
      const identity = createIdentity({ personId })
      assert.strictEqual(identity.person_id, personId)
      assert.strictEqual(identity.provenance, "confirmed")
      assert.strictEqual(identity.confirmed_by, null)
    })

    it("creates a propagated identity explicitly", () => {
      const personId = makePerson()
      const identity = createIdentity({ personId, provenance: "propagated" })
      assert.strictEqual(identity.provenance, "propagated")
    })

    it("creates an identity for an OFF-ROSTER person", () => {
      // The point of the people table: the photographer, a child, a partner
      // recorded under someone else's invitation — none of them have a guests
      // row, and all of them need naming.
      const personId = makePerson(null)
      const identity = createIdentity({ personId })
      assert.strictEqual(identity.person_id, personId)
    })

    it("identitiesForPerson excludes soft-deleted rows", () => {
      const personId = makePerson()
      const identity = createIdentity({ personId })
      assert.strictEqual(identitiesForPerson(personId).length, 1)

      softDeleteIdentity(identity.id)
      assert.strictEqual(identitiesForPerson(personId).length, 0)
      assert.strictEqual(getIdentityById(identity.id), undefined)
    })

    it("refuses a second LIVE identity of the same provenance for one person", () => {
      // idx_face_identities_person. Without it, `identitiesForPerson(id).find(
      // ...)` picks by row order, and which identity a face lands on becomes
      // an accident of insertion history.
      const personId = makePerson()
      const first = createIdentity({ personId })
      assert.throws(() => createIdentity({ personId }), /UNIQUE/i)

      // Partial index: retiring the first frees the slot.
      softDeleteIdentity(first.id)
      const replacement = createIdentity({ personId })
      assert.notStrictEqual(replacement.id, first.id)
    })
  })

  describe("assignment projection / mediaWithFaces", () => {
    it("links and unlinks a face to an identity", () => {
      const personId = makePerson()
      const mediaId = makeMedia()
      const face = insertBasicFace(mediaId, "cli")
      const identity = createIdentity({ personId })

      assignFace(face.id, identity.id)
      assert.strictEqual(getFaceById(face.id)?.face_identity_id, identity.id)

      assignFace(face.id, null)
      assert.strictEqual(getFaceById(face.id)?.face_identity_id, null)
    })

    it("mediaWithFaces reports only media ids with a live face row", () => {
      const mediaWithFace = makeMedia()
      const mediaWithoutFace = makeMedia()
      const mediaWithDeletedFace = makeMedia()

      insertBasicFace(mediaWithFace, "cli")
      const deletedFace = insertBasicFace(mediaWithDeletedFace, "cli")
      softDeleteFace(deletedFace.id)

      const result = mediaWithFaces([mediaWithFace, mediaWithoutFace, mediaWithDeletedFace])
      assert.ok(result.has(mediaWithFace))
      assert.ok(!result.has(mediaWithoutFace))
      assert.ok(!result.has(mediaWithDeletedFace))
    })

    it("mediaWithFaces returns an empty set for empty input", () => {
      assert.strictEqual(mediaWithFaces([]).size, 0)
    })
  })

  describe("cascade deletes", () => {
    it("deleting a media row cascades to its media_faces rows", () => {
      const mediaId = makeMedia()
      const face = insertBasicFace(mediaId, "cli")

      getDb().prepare("DELETE FROM media WHERE id = ?").run(mediaId)

      assert.strictEqual(getFaceById(face.id), undefined)
    })

    it("deleting a guest unlinks the person but keeps the naming intact", () => {
      // This CHANGED with the people table, and the change is the point. Under
      // the old schema face_identities referenced guests ON DELETE CASCADE, so
      // removing an invitation silently destroyed every face named against it.
      // Now the person is the thing faces belong to; the guest link is
      // ON DELETE SET NULL, so deleting the invitation leaves the person, their
      // identity and their faces exactly where they were — off-roster, which is
      // a state the model can now express.
      const guestId = makeGuest()
      const personId = makePerson(guestId)
      const mediaId = makeMedia()
      const face = insertBasicFace(mediaId, "cli")
      const identity = createIdentity({ personId })
      assignFace(face.id, identity.id)

      getDb().prepare("DELETE FROM guests WHERE id = ?").run(guestId)

      const personRow = /** @type {{ guest_id: number | null } | undefined} */ (
        getDb().prepare("SELECT guest_id FROM people WHERE id = ?").get(personId)
      )
      assert.ok(personRow, "the person survives their invitation being deleted")
      assert.strictEqual(personRow.guest_id, null, "people.guest_id should be SET NULL")

      assert.ok(getIdentityById(identity.id), "the identity is untouched")
      assert.strictEqual(getFaceById(face.id)?.face_identity_id, identity.id)
    })

    it("a ledger event REFUSES to let its identity be hard-deleted out from under it", () => {
      // New since the assignment ledger: face_assignments.identity_id
      // references face_identities with no ON DELETE action, so an identity
      // some event named cannot simply vanish. That is the right way round — an
      // event is the record of a decision about that identity, and the app
      // soft-deletes identities anyway (softDeleteIdentity), which this does
      // not touch.
      const face = insertBasicFace(makeMedia(), "cli")
      const identity = createIdentity({ personId: makePerson() })
      assignFace(face.id, identity.id)

      assert.throws(() =>
        getDb().prepare("DELETE FROM face_identities WHERE id = ?").run(identity.id),
      )
    })

    it("deleting a person's identity nulls out media_faces.face_identity_id", () => {
      // media_faces -> face_identities is still ON DELETE SET NULL, which is
      // exactly the action D1 warns about firing during a table rebuild.
      //
      // Shown on a PRE-LEDGER row — a column value with no events behind it —
      // because that is the only shape a hard delete can still reach (see the
      // test above), and because it is the shape every row written before the
      // ledger landed is in.
      const personId = makePerson()
      const mediaId = makeMedia()
      const face = insertBasicFace(mediaId, "cli")
      const identity = createIdentity({ personId })
      getDb()
        .prepare("UPDATE media_faces SET face_identity_id = ? WHERE id = ?")
        .run(identity.id, face.id)

      getDb().prepare("DELETE FROM face_identities WHERE id = ?").run(identity.id)

      const faceRow = /** @type {{ face_identity_id: number | null }} */ (
        getDb().prepare("SELECT face_identity_id FROM media_faces WHERE id = ?").get(face.id)
      )
      assert.strictEqual(faceRow.face_identity_id, null)
    })
  })

  describe("§10 precedence trigger — CLI is authoritative", () => {
    it("direction 1: upload rows exist first, then a cli row lands -> uploads are soft-deleted", () => {
      const mediaId = makeMedia()
      const upload1 = insertBasicFace(mediaId, "upload")
      const upload2 = insertBasicFace(mediaId, "upload")

      assert.strictEqual(getFaceById(upload1.id)?.deleted_at, null)
      assert.strictEqual(getFaceById(upload2.id)?.deleted_at, null)

      const cliFace = insertBasicFace(mediaId, "cli")

      assert.notStrictEqual(getFaceById(upload1.id)?.deleted_at, null, "upload1 should be superseded")
      assert.notStrictEqual(getFaceById(upload2.id)?.deleted_at, null, "upload2 should be superseded")
      assert.strictEqual(getFaceById(cliFace.id)?.deleted_at, null, "the cli row itself stays live")
    })

    it("direction 2: a cli row already exists, then an upload row arrives -> the upload row is born superseded", () => {
      const mediaId = makeMedia()
      const cliFace = insertBasicFace(mediaId, "cli")
      const uploadFace = insertBasicFace(mediaId, "upload")

      assert.strictEqual(getFaceById(cliFace.id)?.deleted_at, null, "the cli row is untouched")
      assert.notStrictEqual(
        getFaceById(uploadFace.id)?.deleted_at,
        null,
        "the upload row should be immediately superseded",
      )
    })

    it("a second cli pass does not touch a prior cli row for the same media_id", () => {
      const mediaId = makeMedia()
      const cli1 = insertBasicFace(mediaId, "cli")
      const cli2 = insertBasicFace(mediaId, "cli")

      assert.strictEqual(getFaceById(cli1.id)?.deleted_at, null)
      assert.strictEqual(getFaceById(cli2.id)?.deleted_at, null)
    })

    it("upload rows for a different media_id are unaffected by another photo's cli row", () => {
      const mediaA = makeMedia()
      const mediaB = makeMedia()
      const uploadOnB = insertBasicFace(mediaB, "upload")
      insertBasicFace(mediaA, "cli")

      assert.strictEqual(getFaceById(uploadOnB.id)?.deleted_at, null)
    })
  })

  describe("enum CHECK triggers", () => {
    it("rejects an invalid media_faces.source on insert", () => {
      const mediaId = makeMedia()
      assert.throws(
        () => insertBasicFace(mediaId, /** @type {"cli"} */ ("bogus")),
        (/** @type {Error} */ err) => err.message.includes("Invalid face source"),
      )
    })

    it("rejects an invalid media_faces.source on update", () => {
      const mediaId = makeMedia()
      const face = insertBasicFace(mediaId, "cli")
      assert.throws(
        () => {
          getDb().prepare("UPDATE media_faces SET source = ? WHERE id = ?").run("bogus", face.id)
        },
        (/** @type {Error} */ err) => err.message.includes("Invalid face source"),
      )
    })

    it("rejects an invalid face_identities.provenance on insert", () => {
      const personId = makePerson()
      assert.throws(
        () => createIdentity({ personId, provenance: /** @type {"confirmed"} */ ("bogus") }),
        (/** @type {Error} */ err) => err.message.includes("Invalid identity provenance"),
      )
    })

    it("rejects an invalid face_identities.provenance on update", () => {
      const personId = makePerson()
      const identity = createIdentity({ personId })
      assert.throws(
        () => {
          getDb()
            .prepare("UPDATE face_identities SET provenance = ? WHERE id = ?")
            .run("bogus", identity.id)
        },
        (/** @type {Error} */ err) => err.message.includes("Invalid identity provenance"),
      )
    })
  })

  describe("media columns: source_sha256, captured_at", () => {
    it("createTables/runMigrations adds both nullable columns to media", () => {
      const mediaId = makeMedia()
      const row = /** @type {{ source_sha256: string | null, captured_at: string | null }} */ (
        getDb().prepare("SELECT source_sha256, captured_at FROM media WHERE id = ?").get(mediaId)
      )
      assert.strictEqual(row.source_sha256, null)
      assert.strictEqual(row.captured_at, null)
    })

    it("idx_media_source_sha256 index exists", () => {
      const row = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get("idx_media_source_sha256")
      assert.ok(row)
    })
  })

  // -------------------------------------------------------------------------
  // The merge redirect (Phase 5).
  //
  // A merge sets `face_identities.merged_into` and retires the source; it moves
  // no face row. That makes every historical assignment event still correct —
  // but it also soft-deletes an identity that faces still name, and half the
  // read path joins `face_identities ... AND deleted_at IS NULL`. So the merge
  // re-projects the affected faces, and what is asserted here is that the read
  // path comes out the far side seeing the TARGET rather than seeing nobody.
  // -------------------------------------------------------------------------
  describe("merge redirect", () => {
    /** The whole of what a merge does to the data, in the order people.js does
     *  it: redirect, retire, re-project.
     *  @param {number} fromIdentityId @param {number} toIdentityId */
    function mergeIdentities(fromIdentityId, toIdentityId) {
      const faces = faceIdsForIdentity(fromIdentityId)
      mergeIdentityInto(fromIdentityId, toIdentityId)
      softDeleteIdentity(fromIdentityId)
      for (const faceId of faces) projectFace(faceId)
      return faces.length
    }

    it("identitiesForPerson drops a merged-away identity, so it is never a merge target", () => {
      const personA = makePerson()
      const personB = makePerson()
      const identityA = createIdentity({ personId: personA })
      const identityB = createIdentity({ personId: personB })

      assert.strictEqual(identitiesForPerson(personA).length, 1)
      mergeIdentities(identityA.id, identityB.id)

      assert.strictEqual(identitiesForPerson(personA).length, 0, "merged away means not live")
      assert.strictEqual(getIdentityById(identityA.id), undefined)
      assert.strictEqual(identitiesForPerson(personB).length, 1)
    })

    it("confirmedIdentityFaces credits the TARGET with the source's faces", () => {
      const personA = makePerson()
      const personB = makePerson()
      const identityA = createIdentity({ personId: personA })
      const identityB = createIdentity({ personId: personB })

      const faceA = insertDescribedFace(makeMedia())
      const faceB = insertDescribedFace(makeMedia())
      assignFace(faceA.id, identityA.id)
      assignFace(faceB.id, identityB.id)
      assert.strictEqual(confirmedIdentityFaces("test-v1").length, 2)

      mergeIdentities(identityA.id, identityB.id)

      const rows = confirmedIdentityFaces("test-v1")
      assert.strictEqual(rows.length, 2, "the source's face is NOT lost to a soft-deleted identity")
      for (const row of rows) {
        assert.strictEqual(row.identity_id, identityB.id)
        assert.strictEqual(row.person_id, personB)
      }
    })

    it("facesForMediaWithNames names the target, not nobody", () => {
      const personA = makePerson()
      const personB = makePerson()
      const identityA = createIdentity({ personId: personA })
      const identityB = createIdentity({ personId: personB })
      const mediaId = makeMedia()
      const face = insertDescribedFace(mediaId)
      assignFace(face.id, identityA.id)

      mergeIdentities(identityA.id, identityB.id)

      const [row] = facesForMediaWithNames(mediaId)
      assert.strictEqual(row.person_id, personB)
      assert.ok(row.person_name, "a merged face keeps a name")
    })

    it("co-occurrence collapses onto the surviving identity instead of vanishing", () => {
      // Three people photographed together. Merging one into another must leave
      // the pair counts describing the people who are LEFT — not drop the pair
      // entirely because one side points at a retired row.
      const personA = makePerson()
      const personB = makePerson()
      const personC = makePerson()
      const identityA = createIdentity({ personId: personA })
      const identityB = createIdentity({ personId: personB })
      const identityC = createIdentity({ personId: personC })

      const mediaId = makeMedia()
      const faceA = insertDescribedFace(mediaId)
      const faceB = insertDescribedFace(mediaId)
      const faceC = insertDescribedFace(mediaId)
      assignFace(faceA.id, identityA.id)
      assignFace(faceB.id, identityB.id)
      assignFace(faceC.id, identityC.id)

      assert.strictEqual(confirmedCooccurrence().length, 3, "three pairs among three identities")
      assert.strictEqual(confirmedIdentitiesPerMedia().get(mediaId)?.size, 3)

      mergeIdentities(identityA.id, identityB.id)

      // A and B are now one person, so two identities remain in the frame and
      // exactly one pair between them.
      const present = confirmedIdentitiesPerMedia().get(mediaId)
      assert.strictEqual(present?.size, 2)
      assert.ok(present?.has(identityB.id))
      assert.ok(present?.has(identityC.id))
      assert.ok(!present?.has(identityA.id), "the retired identity is not still counted as present")

      const pairs = confirmedCooccurrence()
      assert.strictEqual(pairs.length, 1)
      assert.strictEqual(pairs[0].identity_a, Math.min(identityB.id, identityC.id))
      assert.strictEqual(pairs[0].identity_b, Math.max(identityB.id, identityC.id))
    })

    it("faceIdsForIdentity includes soft-deleted face rows", () => {
      // The reason repointFaces included them, and the reason this does: a
      // superseded row that resurfaces must not carry a reference nobody has
      // re-resolved.
      const personId = makePerson()
      const identity = createIdentity({ personId })
      const live = insertBasicFace(makeMedia(), "cli")
      const dead = insertBasicFace(makeMedia(), "cli")
      assignFace(live.id, identity.id)
      assignFace(dead.id, identity.id)
      softDeleteFace(dead.id)

      assert.deepStrictEqual(faceIdsForIdentity(identity.id), [live.id, dead.id].sort((a, b) => a - b))
    })

    it("mergeIdentityInto refuses to redirect an already-retired identity", () => {
      const identity = createIdentity({ personId: makePerson() })
      const target = createIdentity({ personId: makePerson() })
      softDeleteIdentity(identity.id)
      assert.strictEqual(mergeIdentityInto(identity.id, target.id), false)
    })
  })
})
