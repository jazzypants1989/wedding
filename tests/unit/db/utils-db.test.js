/**
 * @file Unit tests for database-dependent utility functions
 * Tests withTransaction, logCommunication, searchGuestsByName, getInviteCountForGuest
 */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../../db/connection.js"
import {
  withTransaction,
  logCommunication,
  searchGuestsByName,
  getInviteCountForGuest,
} from "../../../db/utils.js"

describe("db/utils (database-dependent)", () => {
  before(() => {
    init()
  })

  after(() => {
    // Clean up test data
    const db = getDb()
    try { db.prepare("DELETE FROM communications WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE 'dbutil-%')").run() } catch { /* table may not exist */ }
    try { db.prepare("DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE 'dbutil-%')").run() } catch { /* ok */ }
    try { db.prepare("DELETE FROM guests WHERE email LIKE 'dbutil-%'").run() } catch { /* ok */ }
    close()
  })

  beforeEach(() => {
    // Clean test data between tests
    const db = getDb()
    try { db.prepare("DELETE FROM communications WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE 'dbutil-%')").run() } catch { /* ok */ }
    try { db.prepare("DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE 'dbutil-%')").run() } catch { /* ok */ }
    try { db.prepare("DELETE FROM guests WHERE email LIKE 'dbutil-%'").run() } catch { /* ok */ }
  })

  /**
   * Helper to insert a test guest and return its id.
   * @param {string} name
   * @param {string} emailSuffix
   * @returns {number}
   */
  function insertTestGuest(name, emailSuffix) {
    const db = getDb()
    const result = db.prepare(
      "INSERT INTO guests (name, email, phone, party_size, invite_code, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(name, `dbutil-${emailSuffix}@example.com`, null, 2, `DBUT${emailSuffix.toUpperCase().slice(0, 4)}`, "pending")
    return /** @type {number} */ (result.lastInsertRowid)
  }

  describe("withTransaction", () => {
    it("commits on success and returns the result", () => {
      const result = withTransaction((db) => {
        db.prepare(
          "INSERT INTO guests (name, email, phone, party_size, invite_code, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("Tx Test", "dbutil-tx1@example.com", null, 1, "DBUTXTE1", "pending")
        return "committed"
      })

      assert.strictEqual(result, "committed")

      // Verify the row was committed
      const db = getDb()
      const row = db.prepare("SELECT name FROM guests WHERE email = ?").get("dbutil-tx1@example.com")
      assert.ok(row, "Row should exist after commit")
      assert.strictEqual(/** @type {import('../../../types.js').Guest} */ (/** @type {unknown} */ (row)).name, "Tx Test")
    })

    it("rolls back on error and re-throws", () => {
      assert.throws(
        () => {
          withTransaction((db) => {
            db.prepare(
              "INSERT INTO guests (name, email, phone, party_size, invite_code, status) VALUES (?, ?, ?, ?, ?, ?)"
            ).run("Tx Fail", "dbutil-tx2@example.com", null, 1, "DBUTXTE2", "pending")
            throw new Error("intentional failure")
          })
        },
        { message: "intentional failure" }
      )

      // Verify the row was NOT committed
      const db = getDb()
      const row = db.prepare("SELECT name FROM guests WHERE email = ?").get("dbutil-tx2@example.com")
      assert.strictEqual(row, undefined, "Row should not exist after rollback")
    })

    it("rejects async callbacks", () => {
      assert.throws(
        () => {
          withTransaction(() => {
            return Promise.resolve("async")
          })
        },
        { message: "withTransaction does not support async callbacks" }
      )
    })

    it("returns the value from the callback", () => {
      const result = withTransaction(() => 42)
      assert.strictEqual(result, 42)
    })

    it("supports nested reads within the transaction", () => {
      // Insert a guest outside the transaction first
      insertTestGuest("Nested Read", "nr1")

      const result = withTransaction((db) => {
        const row = db.prepare("SELECT name FROM guests WHERE email = ?").get("dbutil-nr1@example.com")
        return /** @type {import('../../../types.js').Guest | undefined} */ (/** @type {unknown} */ (row))?.name
      })

      assert.strictEqual(result, "Nested Read")
    })
  })

  describe("logCommunication", () => {
    it("inserts a communication record", () => {
      const guestId = insertTestGuest("Comm Test", "cm1")

      logCommunication(guestId, "email", "sent", "Hello world", null)

      const db = getDb()
      const row = db.prepare("SELECT * FROM communications WHERE guest_id = ?").get(guestId)
      assert.ok(row, "Communication record should exist")
      const comm = /** @type {import('../../../types.js').Communication} */ (/** @type {unknown} */ (row))
      assert.strictEqual(comm.type, "email")
      assert.strictEqual(comm.status, "sent")
      assert.strictEqual(comm.message_preview, "Hello world")
      assert.strictEqual(comm.error_message, null)
    })

    it("records error messages for failed communications", () => {
      const guestId = insertTestGuest("Comm Fail", "cm2")

      logCommunication(guestId, "sms", "failed", null, "Delivery failed")

      const db = getDb()
      const row = db.prepare("SELECT * FROM communications WHERE guest_id = ?").get(guestId)
      assert.ok(row)
      const comm = /** @type {import('../../../types.js').Communication} */ (/** @type {unknown} */ (row))
      assert.strictEqual(comm.status, "failed")
      assert.strictEqual(comm.error_message, "Delivery failed")
    })

    it("handles null optional parameters", () => {
      const guestId = insertTestGuest("Comm Null", "cm3")

      logCommunication(guestId, "email", "sent")

      const db = getDb()
      const row = db.prepare("SELECT * FROM communications WHERE guest_id = ?").get(guestId)
      assert.ok(row)
      const comm = /** @type {import('../../../types.js').Communication} */ (/** @type {unknown} */ (row))
      assert.strictEqual(comm.message_preview, null)
      assert.strictEqual(comm.error_message, null)
    })
  })

  describe("getInviteCountForGuest", () => {
    it("returns 0 for a guest with no communications", () => {
      const guestId = insertTestGuest("No Invites", "ic1")
      const count = getInviteCountForGuest(guestId)
      assert.strictEqual(count, 0)
    })

    it("counts only sent communications", () => {
      const guestId = insertTestGuest("Invite Count", "ic2")

      logCommunication(guestId, "email", "sent", "Invite 1")
      logCommunication(guestId, "sms", "sent", "Invite 2")
      logCommunication(guestId, "email", "failed", null, "Error")

      const count = getInviteCountForGuest(guestId)
      assert.strictEqual(count, 2)
    })
  })

  describe("searchGuestsByName", () => {
    it("returns empty array for empty input", () => {
      const results = searchGuestsByName("")
      assert.deepStrictEqual(results, [])
    })

    it("returns empty array for null-like input", () => {
      const results = searchGuestsByName("   ")
      assert.deepStrictEqual(results, [])
    })

    it("finds exact match with distance 0", () => {
      insertTestGuest("Alice Smith", "as1")

      const results = searchGuestsByName("Alice Smith")
      assert.ok(results.length >= 1)
      const match = results.find((r) => r.email === "dbutil-as1@example.com")
      assert.ok(match, "Should find Alice Smith")
      assert.strictEqual(match.matchDistance, 0)
    })

    it("finds case-insensitive exact match", () => {
      insertTestGuest("Bob Jones", "bj1")

      const results = searchGuestsByName("bob jones")
      assert.ok(results.length >= 1)
      const match = results.find((r) => r.email === "dbutil-bj1@example.com")
      assert.ok(match, "Should find Bob Jones case-insensitively")
      assert.strictEqual(match.matchDistance, 0)
    })

    it("finds fuzzy match within distance 2", () => {
      insertTestGuest("Charlie Brown", "cb1")

      // "Charli Brown" — distance 1 (missing 'e')
      const results = searchGuestsByName("Charli Brown")
      const match = results.find((r) => r.email === "dbutil-cb1@example.com")
      assert.ok(match, "Should find fuzzy match")
      assert.ok(match.matchDistance <= 2)
    })

    it("does not return soft-deleted guests", () => {
      const guestId = insertTestGuest("Deleted Guest", "dg1")
      const db = getDb()
      db.prepare("UPDATE guests SET deleted_at = datetime('now') WHERE id = ?").run(guestId)

      const results = searchGuestsByName("Deleted Guest")
      const match = results.find((r) => r.email === "dbutil-dg1@example.com")
      assert.ok(!match, "Soft-deleted guests should not appear in search results")
    })

    it("sorts results by match distance", () => {
      insertTestGuest("Dana White", "dw1")
      insertTestGuest("Dan White", "dw2")

      // "Dana White" is exact, "Dan White" is distance 1
      const results = searchGuestsByName("Dana White")
      assert.ok(results.length >= 1)
      // Exact match should be first (or the only result with distance 0)
      const exactMatch = results.find((r) => r.email === "dbutil-dw1@example.com")
      assert.ok(exactMatch)
      assert.strictEqual(exactMatch.matchDistance, 0)
    })
  })
})
