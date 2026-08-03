/**
 * @file The `add_people` migration, against a database that already has face
 * assignments in it — which is the only shape that can catch what this test
 * exists for.
 *
 * D1: `face_identities` has to be REBUILT (SQLite cannot add a NOT NULL column
 * without a default, and the departing `guest_id` carries a foreign key and a
 * partial index). `db/connection.js` turns `PRAGMA foreign_keys = ON` BEFORE
 * migrations run, and under that pragma `DROP TABLE face_identities` performs
 * an implicit delete of every row and FIRES `media_faces`' `ON DELETE SET
 * NULL`. Every face assignment in the database becomes NULL, no error is
 * raised, and the migration records itself as applied.
 *
 * That failure is INVISIBLE on a fresh install, because the tables are empty
 * when the migration runs — which is every developer machine and every test
 * database built by `createTables` + `runMigrations`. It detonates exactly once,
 * on the first populated database the migration ever meets. So the fixture
 * below seeds `media_faces` rows carrying NON-NULL `face_identity_id` before
 * migrating, and asserts they still point where they pointed. Nothing else
 * catches it.
 */

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import { DatabaseSync } from "node:sqlite"
import { createTables, runMigrations } from "../../../db/schema.js"

/** @param {DatabaseSync} db @param {string} name */
function guestId(db, name) {
  db.prepare("INSERT INTO guests (name, invite_code) VALUES (?, ?)").run(name, `code-${name}`)
  return Number(
    /** @type {{ id: number }} */ (db.prepare("SELECT last_insert_rowid() AS id").get()).id,
  )
}

/** @param {DatabaseSync} db @param {string} fileKey */
function mediaId(db, fileKey) {
  db.prepare("INSERT INTO media (file_key, kind, section, status) VALUES (?, 'image', 'guest', 'approved')").run(
    fileKey,
  )
  return Number(
    /** @type {{ id: number }} */ (db.prepare("SELECT last_insert_rowid() AS id").get()).id,
  )
}

/**
 * @param {DatabaseSync} db
 * @param {number} guest
 * @param {string} provenance
 */
function identityId(db, guest, provenance) {
  db.prepare("INSERT INTO face_identities (guest_id, provenance) VALUES (?, ?)").run(
    guest,
    provenance,
  )
  return Number(
    /** @type {{ id: number }} */ (db.prepare("SELECT last_insert_rowid() AS id").get()).id,
  )
}

/**
 * @param {DatabaseSync} db
 * @param {number} media
 * @param {number | null} identity
 */
function faceId(db, media, identity) {
  db.prepare(
    `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h,
       model_version, source, face_identity_id)
     VALUES (?, 1, 2, 3, 4, 'test-model', 'cli', ?)`,
  ).run(media, identity)
  return Number(
    /** @type {{ id: number }} */ (db.prepare("SELECT last_insert_rowid() AS id").get()).id,
  )
}

/** @param {DatabaseSync} db @param {number} id */
function faceRow(db, id) {
  return /** @type {{ face_identity_id: number | null } | undefined} */ (
    db.prepare("SELECT face_identity_id FROM media_faces WHERE id = ?").get(id)
  )
}

/** `node:sqlite` hands back null-prototype rows, which `deepStrictEqual`
 *  refuses to match against object literals. Shallow-copy them first.
 *  @template T @param {T[]} rows @returns {T[]} */
function plain(rows) {
  return rows.map((r) => ({ ...r }))
}

/** @param {DatabaseSync} db @param {string} table @param {string} column */
function hasColumn(db, table, column) {
  const cols = /** @type {Array<{ name: string }>} */ (
    db.prepare(`PRAGMA table_info(${table})`).all()
  )
  return cols.some((c) => c.name === column)
}

/** Build the PRE-migration world: base tables, foreign keys on exactly as
 *  db/connection.js leaves them, and `add_people` pre-recorded so the first
 *  `runMigrations` pass applies everything EXCEPT it. Data then goes in against
 *  the old `face_identities(guest_id)` shape, and the second pass — with the
 *  ledger row removed — runs `add_people` alone, against rows.
 *  @param {DatabaseSync} db */
function migrateAllExceptAddPeople(db) {
  db.exec("PRAGMA foreign_keys = ON")
  createTables(db)
  db.prepare("INSERT INTO migrations (name) VALUES ('add_people')").run()
  runMigrations(db)
  assert.ok(
    hasColumn(db, "face_identities", "guest_id"),
    "fixture is wrong: face_identities should still be the old guest_id shape here",
  )
}

/** @param {DatabaseSync} db */
function runAddPeople(db) {
  db.prepare("DELETE FROM migrations WHERE name = 'add_people'").run()
  runMigrations(db)
}

/** @param {DatabaseSync} db */
function foreignKeysOn(db) {
  return (
    /** @type {{ foreign_keys: number }} */ (db.prepare("PRAGMA foreign_keys").get())
      .foreign_keys === 1
  )
}

describe("db/schema add_people migration", () => {
  /** @type {DatabaseSync} */
  let db

  beforeEach(() => {
    db = new DatabaseSync(":memory:")
    migrateAllExceptAddPeople(db)
  })

  afterEach(() => {
    db.close()
  })

  describe("against a database that already has face assignments (D1)", () => {
    it("does not null a single face assignment when face_identities is rebuilt", () => {
      const ada = guestId(db, "Ada")
      const grace = guestId(db, "Grace")
      const photo = mediaId(db, "aaaa1111")
      const adaIdentity = identityId(db, ada, "confirmed")
      const graceIdentity = identityId(db, grace, "confirmed")
      const adaFace = faceId(db, photo, adaIdentity)
      const graceFace = faceId(db, photo, graceIdentity)
      const looseFace = faceId(db, photo, null)

      runAddPeople(db)

      // THE assertion. With `PRAGMA foreign_keys` left ON across the rebuild,
      // all three of these come back null and nothing complains.
      assert.strictEqual(faceRow(db, adaFace)?.face_identity_id, adaIdentity)
      assert.strictEqual(faceRow(db, graceFace)?.face_identity_id, graceIdentity)
      assert.strictEqual(faceRow(db, looseFace)?.face_identity_id, null)
    })

    it("preserves face_identities ids across the rebuild", () => {
      const ada = guestId(db, "Ada")
      const identity = identityId(db, ada, "confirmed")

      runAddPeople(db)

      const row = /** @type {{ id: number } | undefined} */ (
        db.prepare("SELECT id FROM face_identities").get()
      )
      // A renumbering here would leave every media_faces.face_identity_id
      // pointing at a different person's identity, with foreign keys off and
      // nothing to catch it.
      assert.strictEqual(row?.id, identity)
    })

    it("leaves the database referentially clean and foreign keys back ON", () => {
      const ada = guestId(db, "Ada")
      const photo = mediaId(db, "aaaa1111")
      faceId(db, photo, identityId(db, ada, "confirmed"))

      runAddPeople(db)

      assert.deepStrictEqual(db.prepare("PRAGMA foreign_key_check").all(), [])
      assert.ok(foreignKeysOn(db), "the rebuild must restore PRAGMA foreign_keys = ON")
    })
  })

  describe("re-keying identities onto people", () => {
    it("creates one person per distinct guest, named from the guest, linked back", () => {
      const ada = guestId(db, "Ada")
      const grace = guestId(db, "Grace")
      guestId(db, "Never Photographed")
      identityId(db, ada, "confirmed")
      identityId(db, ada, "propagated")
      identityId(db, grace, "confirmed")

      runAddPeople(db)

      const people = /** @type {Array<{ display_name: string, guest_id: number }>} */ (
        plain(db.prepare("SELECT display_name, guest_id FROM people ORDER BY guest_id").all())
      )
      // Two people, not three: a guest with no identities is on the roster but
      // not (yet) in the photographs, and the cast is what this table holds.
      assert.deepStrictEqual(people, [
        { display_name: "Ada", guest_id: ada },
        { display_name: "Grace", guest_id: grace },
      ])
    })

    it("points every migrated identity at its person", () => {
      const ada = guestId(db, "Ada")
      const confirmed = identityId(db, ada, "confirmed")
      const propagated = identityId(db, ada, "propagated")

      runAddPeople(db)

      const person = /** @type {{ id: number }} */ (
        db.prepare("SELECT id FROM people WHERE guest_id = ?").get(ada)
      )
      const rows = /** @type {Array<{ id: number, person_id: number }>} */ (
        plain(db.prepare("SELECT id, person_id FROM face_identities ORDER BY id").all())
      )
      assert.deepStrictEqual(rows, [
        { id: confirmed, person_id: person.id },
        { id: propagated, person_id: person.id },
      ])
    })

    it("carries soft-deleted identities across rather than dropping them", () => {
      const ada = guestId(db, "Ada")
      const live = identityId(db, ada, "confirmed")
      const retired = identityId(db, ada, "propagated")
      db.prepare("UPDATE face_identities SET deleted_at = '2026-01-01' WHERE id = ?").run(retired)

      runAddPeople(db)

      const rows = /** @type {Array<{ id: number, deleted_at: string | null }>} */ (
        plain(db.prepare("SELECT id, deleted_at FROM face_identities ORDER BY id").all())
      )
      assert.deepStrictEqual(rows, [
        { id: live, deleted_at: null },
        { id: retired, deleted_at: "2026-01-01" },
      ])
    })
  })

  describe("consolidating duplicates the old schema allowed", () => {
    it("folds duplicate live (guest, provenance) identities onto the lowest id", () => {
      const ada = guestId(db, "Ada")
      const photo = mediaId(db, "aaaa1111")
      // Legal under the old schema — there was only a non-unique index on
      // guest_id — and the reason behaviour depended on row order: the API
      // takes the FIRST matching identity.
      const keeper = identityId(db, ada, "confirmed")
      const duplicate = identityId(db, ada, "confirmed")
      const keeperFace = faceId(db, photo, keeper)
      const duplicateFace = faceId(db, photo, duplicate)

      runAddPeople(db)

      // The duplicate's face moves to the keeper — an assignment is never lost,
      // only re-pointed.
      assert.strictEqual(faceRow(db, keeperFace)?.face_identity_id, keeper)
      assert.strictEqual(faceRow(db, duplicateFace)?.face_identity_id, keeper)

      const live = /** @type {Array<{ id: number }>} */ (
        plain(db.prepare("SELECT id FROM face_identities WHERE deleted_at IS NULL").all())
      )
      assert.deepStrictEqual(live, [{ id: keeper }])
      // The duplicate is retired, not deleted: ids are referenced elsewhere and
      // a tombstone stays truthful.
      assert.ok(db.prepare("SELECT 1 FROM face_identities WHERE id = ?").get(duplicate))
    })

    it("creates the unique index that stops duplicates coming back", () => {
      const ada = guestId(db, "Ada")
      identityId(db, ada, "confirmed")

      runAddPeople(db)

      const person = /** @type {{ id: number }} */ (
        db.prepare("SELECT id FROM people WHERE guest_id = ?").get(ada)
      )
      assert.throws(
        () =>
          db
            .prepare("INSERT INTO face_identities (person_id, provenance) VALUES (?, 'confirmed')")
            .run(person.id),
        /UNIQUE/i,
        "a second live confirmed identity for the same person must be rejected",
      )
      // Soft-deleted rows are outside the partial index, so retiring one and
      // creating a replacement still works.
      db.prepare("UPDATE face_identities SET deleted_at = '2026-01-01'").run()
      db.prepare("INSERT INTO face_identities (person_id, provenance) VALUES (?, 'confirmed')").run(
        person.id,
      )
    })
  })

  describe("refusing a corrupt database", () => {
    it("rolls the whole rebuild back, and restores foreign keys, when an identity has no guest", () => {
      const ada = guestId(db, "Ada")
      const photo = mediaId(db, "aaaa1111")
      const identity = identityId(db, ada, "confirmed")
      const face = faceId(db, photo, identity)
      // Referential corruption: foreign keys have been ON since this table was
      // created, so this state should be impossible. Reach past the pragma to
      // manufacture it, because "impossible" is exactly when a migration must
      // stop rather than quietly orphan someone's confirmations.
      db.exec("PRAGMA foreign_keys = OFF")
      db.prepare("DELETE FROM guests WHERE id = ?").run(ada)
      db.exec("PRAGMA foreign_keys = ON")

      assert.throws(() => runAddPeople(db), /refusing to migrate a corrupt database/)

      // Everything the migration touched is back as it was: the old column is
      // still there, no people were created, and the assignment still stands.
      assert.ok(hasColumn(db, "face_identities", "guest_id"))
      assert.strictEqual(
        /** @type {{ n: number }} */ (db.prepare("SELECT COUNT(*) AS n FROM people").get()).n,
        0,
      )
      assert.strictEqual(faceRow(db, face)?.face_identity_id, identity)
      // The failure path must not leave this long-lived connection running with
      // foreign keys off for the rest of the process.
      assert.ok(foreignKeysOn(db), "a failed rebuild must still restore PRAGMA foreign_keys = ON")
    })

    it("does not record itself as applied when it refuses", () => {
      const ada = guestId(db, "Ada")
      identityId(db, ada, "confirmed")
      db.exec("PRAGMA foreign_keys = OFF")
      db.prepare("DELETE FROM guests WHERE id = ?").run(ada)
      db.exec("PRAGMA foreign_keys = ON")

      assert.throws(() => runAddPeople(db))

      assert.strictEqual(
        db.prepare("SELECT 1 FROM migrations WHERE name = 'add_people'").get(),
        undefined,
        "an unrecorded migration is retried on the next boot; a recorded one is never seen again",
      )
    })
  })

  describe("on a fresh, empty database", () => {
    it("applies cleanly and leaves the new shape in place", () => {
      runAddPeople(db)

      assert.ok(hasColumn(db, "face_identities", "person_id"))
      assert.ok(!hasColumn(db, "face_identities", "guest_id"))
      assert.ok(
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'people'")
          .get(),
      )
      // The DROP took these with it; they must come back.
      for (const trigger of [
        "check_face_identities_provenance_insert",
        "check_face_identities_provenance_update",
        "auto_updated_at_face_identities",
      ]) {
        assert.ok(
          db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger),
          `${trigger} was not recreated after the rebuild`,
        )
      }
      assert.ok(foreignKeysOn(db))
    })

    it("is idempotent — a second runMigrations pass is a no-op", () => {
      runAddPeople(db)
      runMigrations(db)
      assert.ok(hasColumn(db, "face_identities", "person_id"))
      assert.deepStrictEqual(db.prepare("PRAGMA foreign_key_check").all(), [])
    })
  })
})
