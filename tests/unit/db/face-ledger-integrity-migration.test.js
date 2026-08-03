/**
 * @file The `add_face_ledger_integrity` migration — the three things
 * `add_vision_provenance` left the ledger without.
 *
 * 1. `face_assignment_batches.kind` was typed and commented with four values
 *    and enforced by nothing, unlike `vision_ingests.mirror_applied` and
 *    `face_assignments.op` beside it.
 * 2. The batches table is deliberately updatable — revocation is a legitimate
 *    update — but nothing narrowed WHICH update. `SET revoked_at = NULL`
 *    silently un-revoked a batch and left every projection derived from it
 *    stale, and `actor`, the attribution on the revocable unit, was freely
 *    rewritable while `face_assignments.actor` beside it was frozen.
 * 3. `media_faces.deleted_at` has three authors and the projection could not
 *    tell which one wrote the value it was looking at, so it revived rows the
 *    §10 precedence triggers and `--replace` had retired.
 *    `media_faces.ledger_retired_at` is the ledger's receipt for its own
 *    retirement; the behaviour it buys is pinned in
 *    tests/unit/db/face-assignments.test.js, and what is pinned HERE is the
 *    schema shape and the back-fill.
 *
 * The fixture shape matters for the same reason it does in
 * vision-provenance-migration.test.js: this migration must run against a
 * database that already holds a ledger, and must not disturb it.
 */

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import { DatabaseSync } from "node:sqlite"
import { createTables, runMigrations } from "../../../db/schema.js"

const MIGRATION = "add_face_ledger_integrity"

/** @param {DatabaseSync} db @param {string} sql @param {Array<string | number | null>} params */
function insert(db, sql, params) {
  return Number(db.prepare(sql).run(...params).lastInsertRowid)
}

/** @param {DatabaseSync} db @param {string} name */
function personId(db, name) {
  return insert(db, "INSERT INTO people (display_name) VALUES (?)", [name])
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

/** @param {DatabaseSync} db @param {number} media @param {string} source
 *  @param {string | null} deletedAt @param {number | null} ingest */
function faceId(db, media, source, deletedAt = null, ingest = null) {
  return insert(
    db,
    `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h,
       model_version, source, deleted_at, ingest_id)
     VALUES (?, 1, 2, 3, 4, 'test-model', ?, ?, ?)`,
    [media, source, deletedAt, ingest],
  )
}

/** @param {DatabaseSync} db @param {number} face @param {string} op */
function assignmentEvent(db, face, op) {
  return insert(
    db,
    "INSERT INTO face_assignments (face_id, op, identity_id, actor) VALUES (?, ?, NULL, 'tester')",
    [face, op],
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

/** @param {DatabaseSync} db @param {number} id */
function ledgerClaim(db, id) {
  return /** @type {{ deleted_at: string | null, ledger_retired_at: string | null }} */ (
    db.prepare("SELECT deleted_at, ledger_retired_at FROM media_faces WHERE id = ?").get(id)
  )
}

/** An `assert.throws` matcher built from string methods — this repo allows no
 *  regex literals, so the usual `/pattern/` second argument is out.
 *  @param {string} needle */
function messageIncludes(needle) {
  /** @param {unknown} err @returns {boolean} */
  return (err) => err instanceof Error && err.message.includes(needle)
}

/** The PRE-migration world: every earlier migration applied (so the ledger
 *  tables exist), this one pinned so the first pass skips it.
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

/** @param {DatabaseSync} db @param {string} batchId @param {string} kind */
function seedBatch(db, batchId, kind) {
  db.prepare(
    "INSERT INTO face_assignment_batches (batch_id, kind, actor, note) VALUES (?, ?, 'pipeline', 'auto pass')",
  ).run(batchId, kind)
}

describe("db/schema add_face_ledger_integrity migration", () => {
  /** @type {DatabaseSync} */
  let db

  beforeEach(() => {
    db = new DatabaseSync(":memory:")
    migrateAllExcept(db)
  })

  afterEach(() => {
    db.close()
  })

  describe("the shape it leaves behind", () => {
    beforeEach(() => runIt(db))

    it("adds the column and every trigger", () => {
      assert.ok(hasColumn(db, "media_faces", "ledger_retired_at"))
      for (const trigger of [
        "check_face_assignment_batches_kind_insert",
        "face_assignment_batches_revocation_only",
        "face_assignment_batches_revocation_is_permanent",
        "media_faces_supersession_releases_ledger_claim",
      ]) {
        assert.ok(hasObject(db, "trigger", trigger), `${trigger} was not created`)
      }
    })

    it("is idempotent — a second runMigrations pass is a no-op", () => {
      assert.doesNotThrow(() => runMigrations(db))
      assert.ok(hasColumn(db, "media_faces", "ledger_retired_at"))
      assert.deepStrictEqual(db.prepare("PRAGMA foreign_key_check").all(), [])
    })

    it("re-applies cleanly when the ledger row is lost but the schema is there", () => {
      // A throwing migration stops the server booting, which is D3.
      assert.doesNotThrow(() => runIt(db))
      assert.ok(hasColumn(db, "media_faces", "ledger_retired_at"))
    })
  })

  describe("face_assignment_batches.kind is an enum at last", () => {
    beforeEach(() => runIt(db))

    it("accepts the four documented kinds", () => {
      for (const kind of ["label-import", "propagate", "manual", "merge-repair"]) {
        assert.doesNotThrow(() => seedBatch(db, kind, kind))
      }
    })

    it("rejects anything else", () => {
      assert.throws(
        () => seedBatch(db, "b1", "not-a-real-kind"),
        messageIncludes("Invalid batch kind"),
      )
      assert.throws(() => seedBatch(db, "b2", ""), messageIncludes("Invalid batch kind"))
    })

    it("leaves a pre-existing bad kind alone rather than refusing to migrate", () => {
      // The trigger is INSERT-side, and the migration is not a rebuild: a row
      // written before the rule existed is grandfathered. A migration that
      // refuses stops the server booting.
      const bare = new DatabaseSync(":memory:")
      try {
        migrateAllExcept(bare)
        seedBatch(bare, "legacy", "whatever-this-was")
        assert.doesNotThrow(() => runIt(bare))
        assert.ok(
          bare.prepare("SELECT 1 FROM face_assignment_batches WHERE batch_id = 'legacy'").get(),
        )
      } finally {
        bare.close()
      }
    })
  })

  describe("face_assignment_batches updates are revocations and nothing else", () => {
    beforeEach(() => {
      runIt(db)
      seedBatch(db, "b1", "propagate")
    })

    it("allows the revocation it exists for", () => {
      assert.doesNotThrow(() =>
        db
          .prepare(
            "UPDATE face_assignment_batches SET revoked_at = '2026-01-01', revoked_by = 'admin' WHERE batch_id = 'b1'",
          )
          .run(),
      )
    })

    it("refuses to rewrite the attribution on a revocable unit", () => {
      for (const column of ["kind = 'manual'", "actor = 'someone-else'", "note = 'other'", "batch_id = 'b2'"]) {
        assert.throws(
          () =>
            db.prepare(`UPDATE face_assignment_batches SET ${column} WHERE batch_id = 'b1'`).run(),
          messageIncludes("only revoked_at/revoked_by"),
          column,
        )
      }
      assert.throws(
        () =>
          db
            .prepare("UPDATE face_assignment_batches SET created_at = '1999-01-01' WHERE batch_id = 'b1'")
            .run(),
        messageIncludes("only revoked_at/revoked_by"),
      )
    })

    it("refuses to un-revoke, or to re-date a revocation", () => {
      db.prepare(
        "UPDATE face_assignment_batches SET revoked_at = '2026-01-01', revoked_by = 'admin' WHERE batch_id = 'b1'",
      ).run()

      for (const statement of [
        "UPDATE face_assignment_batches SET revoked_at = NULL WHERE batch_id = 'b1'",
        "UPDATE face_assignment_batches SET revoked_at = '2026-06-06' WHERE batch_id = 'b1'",
        "UPDATE face_assignment_batches SET revoked_by = 'nobody' WHERE batch_id = 'b1'",
      ]) {
        assert.throws(
          () => db.prepare(statement).run(),
          messageIncludes("not reversible"),
          statement,
        )
      }

      const row = /** @type {{ revoked_at: string | null, revoked_by: string | null }} */ (
        db.prepare("SELECT revoked_at, revoked_by FROM face_assignment_batches WHERE batch_id = 'b1'").get()
      )
      assert.strictEqual(row.revoked_at, "2026-01-01")
      assert.strictEqual(row.revoked_by, "admin")
    })
  })

  describe("the ledger's claim on a retirement it wrote", () => {
    it("back-fills the claims that were still legitimate, and only those", () => {
      // Pre-migration, `deleted_at` carried no authorship, so the migration has
      // to reconstruct it. The reconstruction is deliberately conservative: a
      // row that another author had cause to retire keeps NO claim, because the
      // whole point of the column is that the ledger stops undoing other
      // people's work.
      const person = personId(db, "Ada")
      identityId(db, person)

      const soloMedia = mediaId(db, "solo0001")
      const claimed = faceId(db, soloMedia, "cli", "2026-01-01T00:00:00.000Z")
      assignmentEvent(db, claimed, "not_a_face")

      const supersededMedia = mediaId(db, "sup00001")
      const uploadRow = faceId(db, supersededMedia, "upload", "2026-01-01T00:00:00.000Z")
      assignmentEvent(db, uploadRow, "not_a_face")
      faceId(db, supersededMedia, "cli") // live, authoritative

      const liveMedia = mediaId(db, "live0001")
      const stillLive = faceId(db, liveMedia, "cli")

      const noEventMedia = mediaId(db, "noev0001")
      const retiredByOtherHands = faceId(db, noEventMedia, "cli", "2026-01-01T00:00:00.000Z")

      runIt(db)

      assert.strictEqual(
        ledgerClaim(db, claimed).ledger_retired_at,
        "2026-01-01T00:00:00.000Z",
        "a not_a_face retirement nobody else had cause to write is the ledger's",
      )
      assert.strictEqual(
        ledgerClaim(db, uploadRow).ledger_retired_at,
        null,
        "an upload row sitting beside live cli rows is superseded, whoever wrote the timestamp",
      )
      assert.strictEqual(ledgerClaim(db, stillLive).ledger_retired_at, null, "a live row has no claim")
      assert.strictEqual(
        ledgerClaim(db, retiredByOtherHands).ledger_retired_at,
        null,
        "no not_a_face event, no claim",
      )
    })

    it("releases the claim when a later cli generation supersedes the row", () => {
      runIt(db)
      const media = mediaId(db, "gener001")
      const first = insert(
        db,
        `INSERT INTO vision_ingests (dataset_id, model_version, detector_sha256, embedder_sha256,
           engine_sha256, mirror_applied, normalisation, route_profile, config_json)
         VALUES ('ds', 'test-model', 'd', 'e', 'g', 0, 'arcface', 'p1', '{}')`,
        [],
      )
      const second = insert(
        db,
        `INSERT INTO vision_ingests (dataset_id, model_version, detector_sha256, embedder_sha256,
           engine_sha256, mirror_applied, normalisation, route_profile, config_json)
         VALUES ('ds', 'test-model', 'd', 'e', 'g', 0, 'arcface', 'p1', '{}')`,
        [],
      )
      const genOne = faceId(db, media, "cli", "2026-01-01T00:00:00.000Z", first)
      db.prepare("UPDATE media_faces SET ledger_retired_at = deleted_at WHERE id = ?").run(genOne)

      faceId(db, media, "cli", null, second)

      assert.strictEqual(
        ledgerClaim(db, genOne).ledger_retired_at,
        null,
        "a new ingest generation takes the claim away",
      )
      assert.ok(ledgerClaim(db, genOne).deleted_at, "and leaves it retired")
    })

    it("does not release a claim on a sibling from the SAME generation", () => {
      // Two faces in one photograph from one run are not each other's
      // supersession — otherwise a not_a_face on one box could never be undone.
      runIt(db)
      const media = mediaId(db, "siblin01")
      const ingest = insert(
        db,
        `INSERT INTO vision_ingests (dataset_id, model_version, detector_sha256, embedder_sha256,
           engine_sha256, mirror_applied, normalisation, route_profile, config_json)
         VALUES ('ds', 'test-model', 'd', 'e', 'g', 0, 'arcface', 'p1', '{}')`,
        [],
      )
      const retired = faceId(db, media, "cli", "2026-01-01T00:00:00.000Z", ingest)
      db.prepare("UPDATE media_faces SET ledger_retired_at = deleted_at WHERE id = ?").run(retired)

      faceId(db, media, "cli", null, ingest)

      assert.strictEqual(
        ledgerClaim(db, retired).ledger_retired_at,
        "2026-01-01T00:00:00.000Z",
        "same run, same generation — the claim stands",
      )
    })
  })

  describe("when the tables it extends do not exist yet (D3)", () => {
    it("does not throw", () => {
      const bare = new DatabaseSync(":memory:")
      try {
        migrateAllExcept(bare, ["add_media_faces", "add_people", "add_vision_provenance"])
        assert.ok(
          !hasObject(bare, "table", "face_assignment_batches"),
          "fixture is wrong: the ledger should not exist here",
        )
        assert.doesNotThrow(() => runIt(bare))
      } finally {
        bare.close()
      }
    })

    it("creates no trigger over a column that is not there yet", () => {
      // ⚠ SQLite compiles a trigger BODY lazily, at fire time. `CREATE TRIGGER`
      // over a missing column therefore SUCCEEDS, and the damage shows up as
      // every later INSERT into the watched table failing — far from the
      // migration, and on exactly the databases (a pinned earlier ledger state)
      // that a guard on `PRAGMA table_info` exists to protect. Creating the
      // object is not proof the object works.
      const bare = new DatabaseSync(":memory:")
      try {
        migrateAllExcept(bare, ["add_vision_provenance"])
        assert.ok(hasObject(bare, "table", "media_faces"), "fixture: media_faces should exist")
        assert.ok(!hasColumn(bare, "media_faces", "ingest_id"), "fixture: without ingest_id")

        assert.doesNotThrow(() => runIt(bare))
        assert.ok(!hasObject(bare, "trigger", "media_faces_supersession_releases_ledger_claim"))

        // A bare insert, without the column this fixture does not have — so
        // the only thing that could raise here is the trigger.
        const media = mediaId(bare, "lazytrg1")
        assert.doesNotThrow(() =>
          insert(
            bare,
            `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, source)
             VALUES (?, 1, 2, 3, 4, 'test-model', 'cli')`,
            [media],
          ),
        )
      } finally {
        bare.close()
      }
    })
  })
})
