/**
 * @file `revokeBatch` under a vision CLI's connection model — the reproduction
 * for a bug that made the ledger's only undo unreachable from anywhere except a
 * server process.
 *
 * Two connection models exist in this repository and both are legitimate:
 *
 *  - the **server**, which calls `db/connection.js`'s `init()`, keeps one
 *    process-wide `DatabaseSync`, and hands `getStmt` to `bindExecutor`;
 *  - a **vision CLI** (`scripts/vision/ingest-faces.js`'s `openDatabase`,
 *    `scripts/vision/export-face-work.js`), which opens its OWN `DatabaseSync`
 *    against an explicit `--database` path and binds that, without ever calling
 *    `init()`. There is no singleton in such a process.
 *
 * Everything in db/face-assignments.js runs through `sql``` and therefore works
 * under both — except `revokeBatch`, which reached for `db/utils.js`'s
 * `withTransaction`, which calls `getDb()`. In a CLI that threw
 * "Database not initialized. Call init() first." before it could revoke
 * anything; and had the singleton been initialised too, it would have done
 * something quieter and worse — held `BEGIN IMMEDIATE` open on one connection
 * while the re-projections were written through another, so the two halves the
 * transaction exists to keep together would not have been inside it.
 *
 * `withBoundTransaction` opens the transaction on whatever `sql``` is bound to,
 * which is what the tests below assert. **This file never calls `init()`** —
 * that is the whole point of it, and the first test guards the guard.
 *
 * NO REGEX, per CLAUDE.md — including the `assert.throws` matcher, which is the
 * `messageIncludes` helper copied from face-assignments.test.js.
 */

import { describe, it, before, beforeEach, after } from "node:test"
import assert from "node:assert"
import { DatabaseSync } from "node:sqlite"

import { createTables, runMigrations } from "../../../db/schema.js"
import { bindExecutor, sql } from "../../../db/sql.js"
import { getDb } from "../../../db/connection.js"
import {
  createBatch,
  getBatch,
  recordAssignment,
  revokeBatch,
} from "../../../db/face-assignments.js"

/** @type {DatabaseSync} */
let db

/** An `assert.throws` matcher built from string methods.
 *  @param {string} needle */
function messageIncludes(needle) {
  /** @param {unknown} err @returns {boolean} */
  return (err) => err instanceof Error && err.message.includes(needle)
}

/** @param {string} statement @param {Array<string | number | null>} params */
function insert(statement, params) {
  return Number(db.prepare(statement).run(...params).lastInsertRowid)
}

let seq = 0

function makeIdentity() {
  seq++
  const person = insert("INSERT INTO people (display_name) VALUES (?)", [`CLI Person ${seq}`])
  return insert("INSERT INTO face_identities (person_id, provenance) VALUES (?, 'confirmed')", [
    person,
  ])
}

function makeFace() {
  seq++
  const media = insert(
    "INSERT INTO media (file_key, kind, section, status) VALUES (?, 'image', 'guest', 'approved')",
    [`clikey${seq}`],
  )
  return insert(
    `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, source)
     VALUES (?, 1, 2, 3, 4, 'test-model', 'cli')`,
    [media],
  )
}

/** @param {number} faceId */
function columnIdentity(faceId) {
  return /** @type {{ face_identity_id: number | null }} */ (
    db.prepare("SELECT face_identity_id FROM media_faces WHERE id = ?").get(faceId)
  ).face_identity_id
}

describe("the ledger under a CLI's own connection", () => {
  before(() => {
    // Exactly what scripts/vision/ingest-faces.js's openDatabase does, minus
    // the file: a private connection, the schema, and an executor bound to it.
    db = new DatabaseSync(":memory:")
    db.exec("PRAGMA foreign_keys = ON")
    createTables(db)
    runMigrations(db)

    /** @type {Map<string, import('node:sqlite').StatementSync>} */
    const stmtCache = new Map()
    bindExecutor((text) => {
      let stmt = stmtCache.get(text)
      if (!stmt) {
        stmt = db.prepare(text)
        stmtCache.set(text, stmt)
      }
      return stmt
    })
  })

  beforeEach(() => {
    for (const table of [
      "face_assignments",
      "face_assignment_batches",
      "media_faces",
      "face_identities",
      "people",
      "media",
    ]) {
      db.prepare(`DELETE FROM ${table}`).run()
    }
  })

  after(() => db.close())

  it("has no singleton at all — which is what makes the rest of this file mean something", () => {
    // If `init()` ever runs in this process the tests below stop testing the
    // CLI case and quietly start testing the server one again.
    assert.throws(() => getDb(), messageIncludes("Database not initialized"))
  })

  it("revokes a batch with no db/connection.js singleton in the process", () => {
    const faces = [makeFace(), makeFace()]
    const identity = makeIdentity()
    createBatch({ batchId: "cli-batch", kind: "label-import", actor: "face-work-import" })
    for (const face of faces) {
      recordAssignment({
        faceId: face,
        op: "assign",
        identityId: identity,
        actor: "face-work-import",
        batchId: "cli-batch",
      })
      assert.strictEqual(columnIdentity(face), identity)
    }

    // This is the line that used to throw "Database not initialized".
    assert.strictEqual(revokeBatch("cli-batch", "face-work-revoke"), 2)

    assert.ok(getBatch("cli-batch")?.revoked_at)
    assert.strictEqual(getBatch("cli-batch")?.revoked_by, "face-work-revoke")
    for (const face of faces) assert.strictEqual(columnIdentity(face), null)
  })

  it("leaves the CLI's own connection with no transaction open afterwards", () => {
    const face = makeFace()
    createBatch({ batchId: "cli-batch", kind: "propagate", actor: "pipeline" })
    recordAssignment({
      faceId: face,
      op: "assign",
      identityId: makeIdentity(),
      actor: "pipeline",
      batchId: "cli-batch",
    })

    revokeBatch("cli-batch", "operator")

    // The COMMIT went to the same connection the BEGIN did. If the transaction
    // had been opened on some other connection this would be false — and the
    // CLI's next write would be sitting inside a transaction nobody closes.
    assert.strictEqual(db.isTransaction, false)
  })

  it("rolls back the flag as well as the projection when a re-projection throws", () => {
    // The reason revokeBatch owns a transaction at all: the flag and the
    // re-projections must land together. Forced here with a hand-made merge
    // CYCLE, which `resolveIdentity` refuses to walk forever — the same shape a
    // corrupt `merged_into` would have in production.
    const face = makeFace()
    const identity = makeIdentity()
    const other = makeIdentity()
    createBatch({ batchId: "cli-batch", kind: "propagate", actor: "pipeline" })
    recordAssignment({
      faceId: face,
      op: "assign",
      identityId: identity,
      actor: "pipeline",
      batchId: "cli-batch",
    })
    // A second, un-revoked event so replay has something to resolve after the
    // batch's own event is skipped — and it is that resolution which throws.
    recordAssignment({ faceId: face, op: "assign", identityId: other, actor: "human" })
    db.prepare("UPDATE face_identities SET merged_into = ? WHERE id = ?").run(identity, other)
    db.prepare("UPDATE face_identities SET merged_into = ? WHERE id = ?").run(other, identity)

    assert.throws(() => revokeBatch("cli-batch", "operator"), messageIncludes("cycle"))

    assert.strictEqual(db.isTransaction, false, "the failed transaction was rolled back, not left open")
    assert.strictEqual(
      getBatch("cli-batch")?.revoked_at,
      null,
      "the batch is not left flagged with its faces un-re-projected",
    )
  })

  it("refuses a batch that does not exist before opening anything", () => {
    assert.throws(() => revokeBatch("no-such-batch", "operator"), messageIncludes("no such batch"))
    assert.strictEqual(db.isTransaction, false)
  })
})
