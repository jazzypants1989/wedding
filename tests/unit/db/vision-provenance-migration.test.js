/**
 * @file The `add_vision_provenance` migration, run against a database that
 * already holds face assignments.
 *
 * The fixture shape is the point. This migration is deliberately NOT a table
 * rebuild — every change is a CREATE TABLE or a plain ADD COLUMN — but "not a
 * rebuild" is a claim about the code, and D1 is the project's proof that the
 * claim is worth testing rather than asserting. `db/connection.js` turns
 * `PRAGMA foreign_keys = ON` before migrations run, and under that pragma any
 * implicit delete of `face_identities` fires `media_faces`' `ON DELETE SET
 * NULL`: every assignment in the database silently becomes NULL, no error is
 * raised, and the migration records itself as applied. That failure is
 * invisible on a fresh install — which is every developer machine and every
 * test database — and total on the first populated one it meets.
 *
 * So the rows below go in with NON-NULL `face_identity_id` before the
 * migration runs, and the first assertion is that they still point where they
 * pointed.
 *
 * The rest covers what the new schema itself has to enforce: append-only means
 * UPDATE blocked and DELETE emphatically NOT (media deletion cascades through
 * `media_faces` into the ledger, and a delete-blocking trigger would turn that
 * into a hard failure), and the op/identity agreement table.
 */

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import { DatabaseSync } from "node:sqlite"
import { createTables, runMigrations } from "../../../db/schema.js"

const MIGRATION = "add_vision_provenance"

/** @param {DatabaseSync} db @param {string} sql @param {Array<string | number | null>} params */
function insert(db, sql, params) {
  return Number(db.prepare(sql).run(...params).lastInsertRowid)
}

/** @param {DatabaseSync} db @param {string} name */
function guestId(db, name) {
  return insert(db, "INSERT INTO guests (name, invite_code) VALUES (?, ?)", [name, `code-${name}`])
}

/** @param {DatabaseSync} db @param {string} name @param {number | null} guest */
function personId(db, name, guest) {
  return insert(db, "INSERT INTO people (display_name, guest_id) VALUES (?, ?)", [name, guest])
}

/** @param {DatabaseSync} db @param {string} fileKey */
function mediaId(db, fileKey) {
  return insert(
    db,
    "INSERT INTO media (file_key, kind, section, status) VALUES (?, 'image', 'guest', 'approved')",
    [fileKey],
  )
}

/** @param {DatabaseSync} db @param {number} person */
function identityId(db, person) {
  return insert(db, "INSERT INTO face_identities (person_id, provenance) VALUES (?, 'confirmed')", [
    person,
  ])
}

/** @param {DatabaseSync} db @param {number} media @param {number | null} identity */
function faceId(db, media, identity) {
  return insert(
    db,
    `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h,
       model_version, source, face_identity_id)
     VALUES (?, 1, 2, 3, 4, 'test-model', 'cli', ?)`,
    [media, identity],
  )
}

/** @param {DatabaseSync} db @param {number} id */
function faceRow(db, id) {
  return /** @type {{ face_identity_id: number | null } | undefined} */ (
    db.prepare("SELECT face_identity_id FROM media_faces WHERE id = ?").get(id)
  )
}

/** @param {DatabaseSync} db @param {string} table @param {string} column */
function hasColumn(db, table, column) {
  const cols = /** @type {Array<{ name: string }>} */ (
    db.prepare(`PRAGMA table_info(${table})`).all()
  )
  return cols.some((c) => c.name === column)
}

/** @param {DatabaseSync} db @param {string} type @param {string} name */
function hasObject(db, type, name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(type, name),
  )
}

/** @param {DatabaseSync} db @param {string} table */
function rowCount(db, table) {
  return /** @type {{ n: number }} */ (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()
  ).n
}

/** An `assert.throws` matcher built from string methods — this repo allows no
 *  regex literals, so the usual `/pattern/` second argument is out.
 *  @param {string} needle */
function messageIncludes(needle) {
  /** @param {unknown} err @returns {boolean} */
  return (err) => err instanceof Error && err.message.includes(needle)
}

/** Build the PRE-migration world: base tables, foreign keys on exactly as
 *  db/connection.js leaves them, and this migration pre-recorded so the first
 *  pass applies everything except it. Data then goes in against the old shape.
 *  @param {DatabaseSync} db @param {string[]} [alsoPinned] */
function migrateAllExcept(db, alsoPinned = []) {
  db.exec("PRAGMA foreign_keys = ON")
  createTables(db)
  for (const name of [MIGRATION, ...alsoPinned]) {
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(name)
  }
  runMigrations(db)
}

/** @param {DatabaseSync} db */
function runIt(db) {
  db.prepare("DELETE FROM migrations WHERE name = ?").run(MIGRATION)
  runMigrations(db)
}

/** @param {DatabaseSync} db */
function seedIngest(db) {
  return insert(
    db,
    `INSERT INTO vision_ingests (dataset_id, model_version, detector_sha256, embedder_sha256,
       engine_sha256, mirror_applied, normalisation, route_profile, config_json)
     VALUES ('ds', 'mv', 'dsha', 'esha', 'gsha', 0, 'arcface', 'p1', '{}')`,
    [],
  )
}

describe("db/schema add_vision_provenance migration", () => {
  /** @type {DatabaseSync} */
  let db

  beforeEach(() => {
    db = new DatabaseSync(":memory:")
    migrateAllExcept(db)
  })

  afterEach(() => {
    db.close()
  })

  describe("against a database that already has face assignments", () => {
    it("leaves every existing face assignment exactly where it pointed", () => {
      const ada = personId(db, "Ada", guestId(db, "Ada"))
      const grace = personId(db, "Grace", guestId(db, "Grace"))
      const photo = mediaId(db, "aaaa1111")
      const adaIdentity = identityId(db, ada)
      const graceIdentity = identityId(db, grace)
      const adaFace = faceId(db, photo, adaIdentity)
      const graceFace = faceId(db, photo, graceIdentity)
      const looseFace = faceId(db, photo, null)

      runIt(db)

      assert.strictEqual(faceRow(db, adaFace)?.face_identity_id, adaIdentity)
      assert.strictEqual(faceRow(db, graceFace)?.face_identity_id, graceIdentity)
      assert.strictEqual(faceRow(db, looseFace)?.face_identity_id, null)
    })

    it("leaves the database referentially clean", () => {
      const ada = personId(db, "Ada", guestId(db, "Ada"))
      const photo = mediaId(db, "aaaa1111")
      faceId(db, photo, identityId(db, ada))

      runIt(db)

      assert.deepStrictEqual(db.prepare("PRAGMA foreign_key_check").all(), [])
    })

    it("gives every pre-existing row a null ingest_id and merged_into", () => {
      const ada = personId(db, "Ada", guestId(db, "Ada"))
      const photo = mediaId(db, "aaaa1111")
      const identity = identityId(db, ada)
      const face = faceId(db, photo, identity)

      runIt(db)

      // Nullable on purpose and permanently: a row written before this
      // migration predates ingest provenance, and an upload-time detection has
      // no run behind it at all.
      assert.strictEqual(
        /** @type {{ ingest_id: number | null }} */ (
          db.prepare("SELECT ingest_id FROM media_faces WHERE id = ?").get(face)
        ).ingest_id,
        null,
      )
      assert.strictEqual(
        /** @type {{ merged_into: number | null }} */ (
          db.prepare("SELECT merged_into FROM face_identities WHERE id = ?").get(identity)
        ).merged_into,
        null,
      )
    })
  })

  describe("the shape it leaves behind", () => {
    beforeEach(() => runIt(db))

    it("creates all three tables, both columns and every index", () => {
      for (const table of ["vision_ingests", "face_assignment_batches", "face_assignments"]) {
        assert.ok(hasObject(db, "table", table), `${table} was not created`)
      }
      assert.ok(hasColumn(db, "media_faces", "ingest_id"))
      assert.ok(hasColumn(db, "face_identities", "merged_into"))
      for (const index of [
        "idx_vision_ingests_model",
        "idx_media_faces_ingest",
        "idx_face_identities_merged",
        "idx_face_assignments_face",
        "idx_face_assignments_batch",
        "idx_face_assignments_identity",
      ]) {
        assert.ok(hasObject(db, "index", index), `${index} was not created`)
      }
    })

    it("is idempotent — a second runMigrations pass is a no-op", () => {
      assert.doesNotThrow(() => runMigrations(db))
      assert.ok(hasColumn(db, "media_faces", "ingest_id"))
      assert.deepStrictEqual(db.prepare("PRAGMA foreign_key_check").all(), [])
    })

    it("re-applies cleanly when the ledger row is lost but the schema is already there", () => {
      // A partially-applied ledger (the migrations row missing, the columns
      // present) must not make the migration throw — a throwing migration
      // stops the server booting, which is D3.
      assert.doesNotThrow(() => runIt(db))
      assert.ok(hasColumn(db, "face_identities", "merged_into"))
    })
  })

  describe("vision_ingests immutability", () => {
    beforeEach(() => runIt(db))

    it("blocks UPDATE", () => {
      const ingest = seedIngest(db)
      assert.throws(
        () =>
          db.prepare("UPDATE vision_ingests SET dataset_id = 'other' WHERE id = ?").run(ingest),
        messageIncludes("immutable"),
        "an ingest is a historical fact; re-running writes a new row",
      )
    })

    it("does NOT block DELETE", () => {
      const ingest = seedIngest(db)
      assert.doesNotThrow(() =>
        db.prepare("DELETE FROM vision_ingests WHERE id = ?").run(ingest),
      )
      assert.strictEqual(rowCount(db, "vision_ingests"), 0)
    })

    it("rejects a mirror_applied that is neither 0 nor 1", () => {
      assert.throws(
        () =>
          db
            .prepare(
              `INSERT INTO vision_ingests (dataset_id, model_version, detector_sha256,
                 embedder_sha256, engine_sha256, mirror_applied, normalisation, route_profile,
                 config_json)
               VALUES ('ds', 'mv', 'd', 'e', 'g', 2, 'arcface', 'p1', '{}')`,
            )
            .run(),
        messageIncludes("mirror_applied"),
      )
    })
  })

  describe("face_assignments append-only", () => {
    /** @type {{ face: number, identity: number, media: number }} */
    let seeded

    beforeEach(() => {
      const ada = personId(db, "Ada", guestId(db, "Ada"))
      const media = mediaId(db, "aaaa1111")
      const identity = identityId(db, ada)
      const face = faceId(db, media, identity)
      runIt(db)
      seeded = { face, identity, media }
      db.prepare(
        "INSERT INTO face_assignments (face_id, op, identity_id, actor) VALUES (?, 'assign', ?, 'tester')",
      ).run(face, identity)
    })

    it("blocks UPDATE", () => {
      assert.throws(
        () => db.prepare("UPDATE face_assignments SET actor = 'someone-else'").run(),
        messageIncludes("append-only"),
        "a correction is a new event, never an edit to an old one",
      )
    })

    it("does NOT block DELETE — a media hard-delete has to cascade through", () => {
      // media -> media_faces (ON DELETE CASCADE) -> face_assignments (ON
      // DELETE CASCADE). A delete-blocking trigger would turn deleting a photo
      // into a hard failure.
      assert.doesNotThrow(() =>
        db.prepare("DELETE FROM media WHERE id = ?").run(seeded.media),
      )
      assert.strictEqual(rowCount(db, "face_assignments"), 0)
      assert.strictEqual(rowCount(db, "media_faces"), 0)
      assert.deepStrictEqual(db.prepare("PRAGMA foreign_key_check").all(), [])
    })

    it("lets a batch be revoked — the batches table is NOT append-only", () => {
      db.prepare(
        "INSERT INTO face_assignment_batches (batch_id, kind, actor) VALUES ('b1', 'propagate', 'tester')",
      ).run()
      assert.doesNotThrow(() =>
        db
          .prepare(
            "UPDATE face_assignment_batches SET revoked_at = '2026-01-01', revoked_by = 'tester' WHERE batch_id = 'b1'",
          )
          .run(),
      )
    })
  })

  describe("the op/identity_id agreement table", () => {
    /** @type {number} */
    let face
    /** @type {number} */
    let identity

    beforeEach(() => {
      const ada = personId(db, "Ada", guestId(db, "Ada"))
      const media = mediaId(db, "aaaa1111")
      identity = identityId(db, ada)
      face = faceId(db, media, identity)
      runIt(db)
    })

    /** @param {string} op @param {number | null} id */
    function tryInsert(op, id) {
      db.prepare(
        "INSERT INTO face_assignments (face_id, op, identity_id, actor) VALUES (?, ?, ?, 'tester')",
      ).run(face, op, id)
    }

    it("accepts every allowed combination", () => {
      assert.doesNotThrow(() => tryInsert("assign", identity))
      assert.doesNotThrow(() => tryInsert("clear", null))
      assert.doesNotThrow(() => tryInsert("not_a_face", null))
      assert.doesNotThrow(() => tryInsert("negative", identity))
    })

    it("rejects every disallowed combination", () => {
      // assign/negative name someone; clear/not_a_face name no one. A row that
      // disagrees records a state nobody can replay.
      const bad = messageIncludes("Invalid face assignment")
      assert.throws(() => tryInsert("assign", null), bad)
      assert.throws(() => tryInsert("negative", null), bad)
      assert.throws(() => tryInsert("clear", identity), bad)
      assert.throws(() => tryInsert("not_a_face", identity), bad)
    })

    it("rejects an op that is not one of the four", () => {
      const bad = messageIncludes("Invalid face assignment")
      // Merge is deliberately not an op: it is a fact about identities, and it
      // lives on face_identities.merged_into.
      assert.throws(() => tryInsert("merge", identity), bad)
      assert.throws(() => tryInsert("", null), bad)
    })
  })

  describe("when the tables it extends do not exist yet (D3)", () => {
    it("does not throw", () => {
      // A test may pin an earlier ledger state to exercise one migration in
      // isolation. A migration that hard-depends on another's table turns that
      // into a boot failure.
      const bare = new DatabaseSync(":memory:")
      try {
        migrateAllExcept(bare, ["add_media_faces", "add_people"])
        assert.ok(
          !hasObject(bare, "table", "media_faces"),
          "fixture is wrong: media_faces should not exist here",
        )
        assert.doesNotThrow(() => runIt(bare))
        // The one table that depends on nothing is still created.
        assert.ok(hasObject(bare, "table", "vision_ingests"))
        assert.ok(!hasObject(bare, "table", "face_assignments"))
      } finally {
        bare.close()
      }
    })
  })
})
