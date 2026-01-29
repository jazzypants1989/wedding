/**
 * Unit tests for session database operations
 */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import crypto from "node:crypto"
import { init, close, getDb } from "../../../db/connection.js"
import {
  createSession,
  getSession,
  deleteSession,
  updateSessionActivity,
  rotateCsrfToken,
  cleanExpiredSessions,
} from "../../../db/sessions.js"
import { SESSION } from "../../../types.js"

/**
 * @param {string} token
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function clearSessions() {
  getDb().prepare("DELETE FROM sessions").run()
}

describe("db/sessions", () => {
  before(() => {
    init()
  })

  beforeEach(() => {
    clearSessions()
  })

  after(() => {
    clearSessions()
    close()
  })

  describe("createSession", () => {
    it("returns token, csrf_token, and expires_at", () => {
      const result = createSession()
      assert.ok(result.token, "token should be set")
      assert.ok(result.csrf_token, "csrf_token should be set")
      assert.ok(result.expires_at, "expires_at should be set")
    })

    it("returns a 64-char hex token", () => {
      const result = createSession()
      assert.strictEqual(result.token.length, 64)
      assert.ok(
        result.token.split("").every((c) => "0123456789abcdef".includes(c)),
        "token should be hex",
      )
    })

    it("returns a 64-char hex csrf_token", () => {
      const result = createSession()
      assert.strictEqual(result.csrf_token.length, 64)
      assert.ok(
        result.csrf_token
          .split("")
          .every((c) => "0123456789abcdef".includes(c)),
        "csrf_token should be hex",
      )
    })

    it("sets expires_at approximately 24 hours in the future", () => {
      const before = Date.now()
      const result = createSession()
      const after = Date.now()
      const expiresMs = new Date(result.expires_at).getTime()

      const expectedMin = before + SESSION.DURATION_MS - 1000
      const expectedMax = after + SESSION.DURATION_MS + 1000

      assert.ok(
        expiresMs >= expectedMin && expiresMs <= expectedMax,
        "expires_at should be ~24 hours from now",
      )
    })

    it("invalidates all previous sessions (single-admin)", () => {
      const first = createSession()
      const second = createSession()

      // First session should be deleted
      const firstSession = getSession(first.token)
      assert.strictEqual(firstSession, null, "first session should be gone")

      // Second session should be valid
      const secondSession = getSession(second.token)
      assert.ok(secondSession, "second session should exist")
    })

    it("stores hashed token in the database", () => {
      const result = createSession()
      const tokenHash = hashToken(result.token)
      const row = getDb()
        .prepare("SELECT token FROM sessions WHERE token = ?")
        .get(tokenHash)
      assert.ok(row, "session should exist with hashed token")
    })
  })

  describe("getSession", () => {
    it("returns session for valid token", () => {
      const result = createSession()
      const session = getSession(result.token)
      assert.ok(session, "session should be found")
      assert.strictEqual(session.csrf_token, result.csrf_token)
    })

    it("returns null for unknown token", () => {
      const session = getSession("a".repeat(64))
      assert.strictEqual(session, null)
    })

    it("returns null for expired session", () => {
      const result = createSession()
      const tokenHash = hashToken(result.token)

      // Set expires_at to the past
      getDb()
        .prepare("UPDATE sessions SET expires_at = ? WHERE token = ?")
        .run(new Date(Date.now() - 1000).toISOString(), tokenHash)

      const session = getSession(result.token)
      assert.strictEqual(session, null, "expired session should return null")
    })

    it("deletes expired session from database", () => {
      const result = createSession()
      const tokenHash = hashToken(result.token)

      getDb()
        .prepare("UPDATE sessions SET expires_at = ? WHERE token = ?")
        .run(new Date(Date.now() - 1000).toISOString(), tokenHash)

      getSession(result.token)

      const row = getDb()
        .prepare("SELECT * FROM sessions WHERE token = ?")
        .get(tokenHash)
      assert.strictEqual(row, undefined, "expired session should be deleted")
    })

    it("returns null for session past idle timeout", () => {
      const result = createSession()
      const tokenHash = hashToken(result.token)

      // Set last_activity_at to > 30 minutes ago
      const pastIdle = new Date(
        Date.now() - SESSION.IDLE_TIMEOUT_MS - 60000,
      ).toISOString()
      getDb()
        .prepare("UPDATE sessions SET last_activity_at = ? WHERE token = ?")
        .run(pastIdle, tokenHash)

      const session = getSession(result.token)
      assert.strictEqual(
        session,
        null,
        "idle-expired session should return null",
      )
    })

    it("returns session when within idle timeout", () => {
      const result = createSession()
      const tokenHash = hashToken(result.token)

      // Set last_activity_at to 10 minutes ago (within 30-minute timeout)
      const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      getDb()
        .prepare("UPDATE sessions SET last_activity_at = ? WHERE token = ?")
        .run(recent, tokenHash)

      const session = getSession(result.token)
      assert.ok(session, "session within idle timeout should be returned")
    })
  })

  describe("deleteSession", () => {
    it("removes session from database", () => {
      const result = createSession()
      assert.ok(getSession(result.token), "session should exist before delete")

      deleteSession(result.token)
      assert.strictEqual(
        getSession(result.token),
        null,
        "session should be gone after delete",
      )
    })

    it("does not error when deleting non-existent session", () => {
      assert.doesNotThrow(() => {
        deleteSession("nonexistent" + "a".repeat(56))
      })
    })
  })

  describe("updateSessionActivity", () => {
    it("updates last_activity_at timestamp", () => {
      const result = createSession()
      const tokenHash = hashToken(result.token)

      // Set last_activity_at to a known past time
      const pastTime = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      getDb()
        .prepare("UPDATE sessions SET last_activity_at = ? WHERE token = ?")
        .run(pastTime, tokenHash)

      updateSessionActivity(result.token)

      const row = /** @type {{ last_activity_at: string } | undefined} */ (
        getDb()
          .prepare("SELECT last_activity_at FROM sessions WHERE token = ?")
          .get(tokenHash)
      )
      assert.ok(row, "session should exist")

      const updatedTime = new Date(row.last_activity_at).getTime()
      const nowMs = Date.now()
      assert.ok(
        Math.abs(updatedTime - nowMs) < 2000,
        "last_activity_at should be updated to approximately now",
      )
    })
  })

  describe("rotateCsrfToken", () => {
    it("returns a new CSRF token", () => {
      const result = createSession()
      const newCsrf = rotateCsrfToken(result.token)

      assert.ok(newCsrf, "new CSRF token should be returned")
      assert.strictEqual(newCsrf.length, 64, "new token should be 64 hex chars")
    })

    it("returns token different from original", () => {
      const result = createSession()
      const newCsrf = rotateCsrfToken(result.token)

      assert.notStrictEqual(
        newCsrf,
        result.csrf_token,
        "rotated token should differ from original",
      )
    })

    it("session remains valid after rotation", () => {
      const result = createSession()
      const newCsrf = rotateCsrfToken(result.token)

      const session = getSession(result.token)
      assert.ok(session, "session should still be valid")
      assert.strictEqual(
        session.csrf_token,
        newCsrf,
        "session should have the new CSRF token",
      )
    })
  })

  describe("cleanExpiredSessions", () => {
    it("deletes sessions with expires_at in the past", () => {
      const result = createSession()
      const tokenHash = hashToken(result.token)

      getDb()
        .prepare("UPDATE sessions SET expires_at = ? WHERE token = ?")
        .run(new Date(Date.now() - 1000).toISOString(), tokenHash)

      cleanExpiredSessions()

      const row = getDb()
        .prepare("SELECT * FROM sessions WHERE token = ?")
        .get(tokenHash)
      assert.strictEqual(
        row,
        undefined,
        "expired session should be cleaned up",
      )
    })

    it("deletes sessions past idle timeout", () => {
      const result = createSession()
      const tokenHash = hashToken(result.token)

      // Set last_activity_at to > 30 minutes ago but expires_at still in the future
      const pastIdle = new Date(
        Date.now() - SESSION.IDLE_TIMEOUT_MS - 60000,
      ).toISOString()
      getDb()
        .prepare("UPDATE sessions SET last_activity_at = ? WHERE token = ?")
        .run(pastIdle, tokenHash)

      cleanExpiredSessions()

      const row = getDb()
        .prepare("SELECT * FROM sessions WHERE token = ?")
        .get(tokenHash)
      assert.strictEqual(
        row,
        undefined,
        "idle-expired session should be cleaned up",
      )
    })

    it("keeps valid non-idle sessions", () => {
      const result = createSession()
      const tokenHash = hashToken(result.token)

      // Set last_activity_at to 5 minutes ago (well within 30-minute idle timeout)
      const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      getDb()
        .prepare("UPDATE sessions SET last_activity_at = ? WHERE token = ?")
        .run(recent, tokenHash)

      cleanExpiredSessions()

      const row = getDb()
        .prepare("SELECT * FROM sessions WHERE token = ?")
        .get(tokenHash)
      assert.ok(row, "valid session should NOT be cleaned up")
    })
  })
})
