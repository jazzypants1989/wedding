/**
 * @file The `add_face_batch_reinstatement` migration — a revoked batch can come
 * back, and the history says so.
 *
 * `add_face_ledger_integrity` made a revocation one-way, and the face-work
 * import's batch id is its content digest, so a revoked naming import could
 * never be restored. This migration drops the one-way trigger and replaces it
 * with `face_batch_revocations`, an append-only revoke/reinstate history whose
 * latest row the batch's `revoked_at`/`revoked_by` must agree with.
 *
 * What is pinned HERE is the schema shape, the back-fill and the triggers. The
 * behaviour `reinstateBatch` buys is pinned in face-assignments.test.js and
 * vision-export-face-work.test.js. Fictional rows only.
 */

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import { DatabaseSync } from "node:sqlite"
import { createTables, runMigrations } from "../../../db/schema.js"

const MIGRATION = "add_face_batch_reinstatement"
const OLD_TRIGGER = "face_assignment_batches_revocation_is_permanent"

/** @param {string} needle */
function messageIncludes(needle) {
  /** @param {unknown} err @returns {boolean} */
  return (err) => err instanceof Error && err.message.includes(needle)
}

/** @param {DatabaseSync} db @param {string} type @param {string} name */
function hasObject(db, type, name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(type, name),
  )
}

/** @param {DatabaseSync} db @param {string} batchId */
function seedBatch(db, batchId) {
  db.prepare(
    "INSERT INTO face_assignment_batches (batch_id, kind, actor) VALUES (?, 'propagate', 'pipeline')",
  ).run(batchId)
}

/** @param {DatabaseSync} db @param {string} batchId */
function history(db, batchId) {
  return /** @type {Array<{ op: string, actor: string, created_at: string }>} */ (
    db
      .prepare(
        "SELECT op, actor, created_at FROM face_batch_revocations WHERE batch_id = ? ORDER BY id",
      )
      .all(batchId)
  ).map((row) => ({ ...row }))
}

/** @param {DatabaseSync} db @param {string} batchId */
function flag(db, batchId) {
  return /** @type {{ revoked_at: string | null, revoked_by: string | null }} */ (
    db
      .prepare("SELECT revoked_at, revoked_by FROM face_assignment_batches WHERE batch_id = ?")
      .get(batchId)
  )
}

/**
 * The PRE-migration world as production has it: every earlier migration
 * applied, plus the one-way trigger `add_face_ledger_integrity` used to create
 * (it no longer does, so a fresh database would never show it), and a batch
 * that was revoked under the old rules.
 * @param {DatabaseSync} db
 */
function productionBefore(db) {
  db.exec("PRAGMA foreign_keys = ON")
  createTables(db)
  db.prepare("INSERT INTO migrations (name) VALUES (?)").run(MIGRATION)
  runMigrations(db)
  db.exec(`
    CREATE TRIGGER ${OLD_TRIGGER}
    BEFORE UPDATE ON face_assignment_batches
    FOR EACH ROW
    WHEN OLD.revoked_at IS NOT NULL
      AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.revoked_by IS NOT OLD.revoked_by)
    BEGIN
      SELECT RAISE(ABORT, 'face_assignment_batches: a revocation is not reversible');
    END;
  `)
  seedBatch(db, "revoked-before")
  seedBatch(db, "live-before")
  db.prepare(
    "UPDATE face_assignment_batches SET revoked_at = '2026-08-03T00:00:00.000Z', revoked_by = 'operator' WHERE batch_id = 'revoked-before'",
  ).run()
}

/** @param {DatabaseSync} db */
function runIt(db) {
  db.prepare("DELETE FROM migrations WHERE name = ?").run(MIGRATION)
  runMigrations(db)
}

describe("db/schema add_face_batch_reinstatement migration", () => {
  /** @type {DatabaseSync} */
  let db

  beforeEach(() => {
    db = new DatabaseSync(":memory:")
    productionBefore(db)
    runIt(db)
  })

  afterEach(() => {
    db.close()
  })

  it("drops the one-way trigger and creates the history and its triggers", () => {
    assert.ok(!hasObject(db, "trigger", OLD_TRIGGER))
    assert.ok(hasObject(db, "table", "face_batch_revocations"))
    for (const trigger of [
      "check_face_batch_revocations_op_insert",
      "face_batch_revocations_alternate",
      "face_batch_revocations_append_only",
      "face_assignment_batches_revocation_follows_history",
    ]) {
      assert.ok(hasObject(db, "trigger", trigger), `${trigger} was not created`)
    }
  })

  it("back-fills one revoke row per already-revoked batch, matching its flag", () => {
    assert.deepStrictEqual(history(db, "revoked-before"), [
      { op: "revoke", actor: "operator", created_at: "2026-08-03T00:00:00.000Z" },
    ])
    assert.deepStrictEqual(history(db, "live-before"), [])
  })

  it("is idempotent, and re-applies cleanly when its ledger row is lost", () => {
    assert.doesNotThrow(() => runMigrations(db))
    assert.doesNotThrow(() => runIt(db))
    assert.strictEqual(history(db, "revoked-before").length, 1)
    assert.deepStrictEqual(db.prepare("PRAGMA foreign_key_check").all(), [])
  })

  it("still refuses a bare un-revoke, and a re-dated or re-attributed revocation", () => {
    for (const statement of [
      "UPDATE face_assignment_batches SET revoked_at = NULL, revoked_by = NULL WHERE batch_id = 'revoked-before'",
      "UPDATE face_assignment_batches SET revoked_at = '2026-09-09' WHERE batch_id = 'revoked-before'",
      "UPDATE face_assignment_batches SET revoked_by = 'nobody' WHERE batch_id = 'revoked-before'",
      "UPDATE face_assignment_batches SET revoked_at = '2026-09-09', revoked_by = 'x' WHERE batch_id = 'live-before'",
    ]) {
      assert.throws(
        () => db.prepare(statement).run(),
        messageIncludes("matching face_batch_revocations row"),
        statement,
      )
    }
    assert.strictEqual(flag(db, "revoked-before").revoked_by, "operator")
    assert.strictEqual(flag(db, "live-before").revoked_at, null)
  })

  it("lets a recorded reinstatement clear the flag — and only to NULL", () => {
    db.prepare(
      "INSERT INTO face_batch_revocations (batch_id, op, actor, created_at) VALUES ('revoked-before', 'reinstate', 'operator2', '2026-08-04')",
    ).run()

    assert.throws(
      () =>
        db
          .prepare(
            "UPDATE face_assignment_batches SET revoked_at = '2026-08-04', revoked_by = 'operator2' WHERE batch_id = 'revoked-before'",
          )
          .run(),
      messageIncludes("matching face_batch_revocations row"),
    )
    db.prepare(
      "UPDATE face_assignment_batches SET revoked_at = NULL, revoked_by = NULL WHERE batch_id = 'revoked-before'",
    ).run()
    assert.deepStrictEqual({ ...flag(db, "revoked-before") }, { revoked_at: null, revoked_by: null })
  })

  it("makes the history alternate, revoke first, with a known op", () => {
    const insert = db.prepare(
      "INSERT INTO face_batch_revocations (batch_id, op, actor, created_at) VALUES (?, ?, 'x', '2026-08-05')",
    )
    assert.throws(() => insert.run("live-before", "reinstate"), messageIncludes("reinstated only while revoked"))
    assert.throws(() => insert.run("revoked-before", "revoke"), messageIncludes("revoked only while live"))
    assert.throws(() => insert.run("live-before", "undo"), messageIncludes("Invalid batch revocation op"))
    assert.doesNotThrow(() => insert.run("live-before", "revoke"))
  })

  it("never lets a history row be edited, and follows its batch out on delete", () => {
    assert.throws(
      () => db.prepare("UPDATE face_batch_revocations SET actor = 'someone-else'").run(),
      messageIncludes("append-only"),
    )
    db.prepare("DELETE FROM face_assignment_batches WHERE batch_id = 'revoked-before'").run()
    assert.deepStrictEqual(history(db, "revoked-before"), [])
  })
})
