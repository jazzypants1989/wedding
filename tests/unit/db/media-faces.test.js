/**
 * @file Unit tests for the face pipeline schema (media_faces, face_identities)
 * and db/media-faces.js. Covers docs/post-wedding/SPEC-vision-lab.md §10:
 *   - cascade delete: media -> media_faces rows gone
 *   - cascade delete: guest -> face_identities gone, and media_faces whose
 *     face_identity_id pointed at one of them is nulled (ON DELETE SET NULL)
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
  setFaceIdentity,
  softDeleteFace,
  createIdentity,
  getIdentityById,
  identitiesForGuest,
  softDeleteIdentity,
  mediaWithFaces,
} from "../../../db/media-faces.js"

let guestSeq = 0
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

function clearData() {
  const db = getDb()
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
      const guestId = makeGuest()
      const identity = createIdentity({ guestId })
      assert.strictEqual(identity.guest_id, guestId)
      assert.strictEqual(identity.provenance, "confirmed")
      assert.strictEqual(identity.confirmed_by, null)
    })

    it("creates a propagated identity explicitly", () => {
      const guestId = makeGuest()
      const identity = createIdentity({ guestId, provenance: "propagated" })
      assert.strictEqual(identity.provenance, "propagated")
    })

    it("identitiesForGuest excludes soft-deleted rows", () => {
      const guestId = makeGuest()
      const identity = createIdentity({ guestId })
      assert.strictEqual(identitiesForGuest(guestId).length, 1)

      softDeleteIdentity(identity.id)
      assert.strictEqual(identitiesForGuest(guestId).length, 0)
      assert.strictEqual(getIdentityById(identity.id), undefined)
    })
  })

  describe("setFaceIdentity / mediaWithFaces", () => {
    it("links and unlinks a face to an identity", () => {
      const guestId = makeGuest()
      const mediaId = makeMedia()
      const face = insertBasicFace(mediaId, "cli")
      const identity = createIdentity({ guestId })

      assert.ok(setFaceIdentity(face.id, identity.id))
      assert.strictEqual(getFaceById(face.id)?.face_identity_id, identity.id)

      assert.ok(setFaceIdentity(face.id, null))
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

    it("deleting a guest cascades to face_identities, and nulls out media_faces.face_identity_id", () => {
      const guestId = makeGuest()
      const mediaId = makeMedia()
      const face = insertBasicFace(mediaId, "cli")
      const identity = createIdentity({ guestId })
      setFaceIdentity(face.id, identity.id)

      getDb().prepare("DELETE FROM guests WHERE id = ?").run(guestId)

      const identityRow = getDb().prepare("SELECT * FROM face_identities WHERE id = ?").get(identity.id)
      assert.strictEqual(identityRow, undefined, "face_identities row should be cascade-deleted")

      const faceRow = /** @type {{ face_identity_id: number | null }} */ (
        getDb().prepare("SELECT face_identity_id FROM media_faces WHERE id = ?").get(face.id)
      )
      assert.strictEqual(faceRow.face_identity_id, null, "media_faces.face_identity_id should be SET NULL")
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
      const guestId = makeGuest()
      assert.throws(
        () => createIdentity({ guestId, provenance: /** @type {"confirmed"} */ ("bogus") }),
        (/** @type {Error} */ err) => err.message.includes("Invalid identity provenance"),
      )
    })

    it("rejects an invalid face_identities.provenance on update", () => {
      const guestId = makeGuest()
      const identity = createIdentity({ guestId })
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
})
