/**
 * Unit tests for guest account session database operations
 */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import crypto from "node:crypto"
import { init, close, getDb } from "../../../db/connection.js"
import {
  createAccountSession,
  getAccountSession,
  deleteAccountSession,
  updateAccountSessionActivity,
  rotateAccountCsrfToken,
  cleanExpiredAccountSessions,
} from "../../../db/account-sessions.js"
import { GUEST_SESSION } from "../../../types.js"

/**
 * @param {string} token
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

/**
 * Insert an account directly and return its id.
 * @param {{ name?: string, trusted?: 0 | 1, guestId?: number | null, deleted?: boolean }} [opts]
 */
function makeAccount({ name = "Session Tester", trusted = 0, guestId = null, deleted = false } = {}) {
  const result = getDb()
    .prepare(
      `INSERT INTO accounts (guest_id, name, name_normalized, trusted, deleted_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(guestId, name, name.toLowerCase(), trusted, deleted ? new Date().toISOString() : null)
  return Number(result.lastInsertRowid)
}

function clearAccountData() {
  getDb().prepare("DELETE FROM account_sessions").run()
  getDb().prepare("DELETE FROM accounts").run()
}

describe("db/account-sessions", () => {
  before(() => {
    init()
  })

  beforeEach(() => {
    clearAccountData()
  })

  after(() => {
    clearAccountData()
    close()
  })

  describe("createAccountSession", () => {
    it("returns token, csrf_token, and expires_at", () => {
      const accountId = makeAccount()
      const result = createAccountSession(accountId)
      assert.ok(result.token, "token should be set")
      assert.ok(result.csrf_token, "csrf_token should be set")
      assert.ok(result.expires_at, "expires_at should be set")
    })

    it("returns a 64-char hex token", () => {
      const accountId = makeAccount()
      const result = createAccountSession(accountId)
      assert.strictEqual(result.token.length, 64)
      assert.ok(
        result.token.split("").every((c) => "0123456789abcdef".includes(c)),
        "token should be hex",
      )
    })

    it("sets expires_at ~180 days out", () => {
      const accountId = makeAccount()
      const before = Date.now()
      const result = createAccountSession(accountId)
      const after = Date.now()
      const expiresMs = new Date(result.expires_at).getTime()
      assert.ok(
        expiresMs >= before + GUEST_SESSION.DURATION_MS - 1000 &&
          expiresMs <= after + GUEST_SESSION.DURATION_MS + 1000,
        "expires_at should be ~180 days from now",
      )
    })

    it("stores the hashed token, not the plaintext", () => {
      const accountId = makeAccount()
      const result = createAccountSession(accountId)
      const row = getDb()
        .prepare("SELECT token FROM account_sessions WHERE token = ?")
        .get(hashToken(result.token))
      assert.ok(row, "session should exist under the hashed token")
      const plain = getDb()
        .prepare("SELECT token FROM account_sessions WHERE token = ?")
        .get(result.token)
      assert.strictEqual(plain, undefined, "plaintext token must not be stored")
    })

    it("keeps multiple concurrent sessions for one account (unlike admin)", () => {
      const accountId = makeAccount()
      const first = createAccountSession(accountId)
      const second = createAccountSession(accountId)
      assert.ok(getAccountSession(first.token), "first session should survive")
      assert.ok(getAccountSession(second.token), "second session should survive")
    })

    it("caps at 10 sessions per account, keeping the newest (rowid tiebreak on same-second inserts)", () => {
      const accountId = makeAccount()
      /** @type {string[]} */
      const tokens = []
      // 15 synchronous creates land within the same clock second, so every trim
      // sees rows that tie on created_at — exactly the case the rowid DESC
      // tiebreak exists for. The just-created session must always survive.
      for (let i = 0; i < 15; i++) {
        tokens.push(createAccountSession(accountId).token)
      }

      const count = /** @type {{ n: number }} */ (
        getDb()
          .prepare("SELECT COUNT(*) AS n FROM account_sessions WHERE account_id = ?")
          .get(accountId)
      )
      assert.strictEqual(count.n, GUEST_SESSION.MAX_SESSIONS_PER_ACCOUNT, "should cap at 10")

      // The most recently created session is never the one trimmed.
      assert.ok(
        getAccountSession(tokens[tokens.length - 1]),
        "newest session must survive the trim",
      )
      // The oldest was trimmed.
      assert.strictEqual(
        getAccountSession(tokens[0]),
        null,
        "oldest session should have been trimmed",
      )
    })

    it("does not trim other accounts' sessions", () => {
      const a = makeAccount({ name: "Account A" })
      const b = makeAccount({ name: "Account B" })
      const bToken = createAccountSession(b).token
      for (let i = 0; i < 12; i++) createAccountSession(a)
      assert.ok(getAccountSession(bToken), "account B's session must be untouched")
    })
  })

  describe("getAccountSession", () => {
    it("returns the joined account fields for a valid token", () => {
      const accountId = makeAccount({ name: "Dana Guest", trusted: 1 })
      const result = createAccountSession(accountId)
      const session = getAccountSession(result.token)
      assert.ok(session, "session should be found")
      assert.strictEqual(session.account_id, accountId)
      assert.strictEqual(session.name, "Dana Guest")
      assert.strictEqual(session.trusted, 1)
      assert.strictEqual(session.csrf_token, result.csrf_token)
    })

    it("returns null for an unknown token", () => {
      assert.strictEqual(getAccountSession("a".repeat(64)), null)
    })

    it("returns null and deletes an absolutely-expired session", () => {
      const accountId = makeAccount()
      const result = createAccountSession(accountId)
      getDb()
        .prepare("UPDATE account_sessions SET expires_at = ? WHERE token = ?")
        .run(new Date(Date.now() - 1000).toISOString(), hashToken(result.token))

      assert.strictEqual(getAccountSession(result.token), null)
      const row = getDb()
        .prepare("SELECT * FROM account_sessions WHERE token = ?")
        .get(hashToken(result.token))
      assert.strictEqual(row, undefined, "expired session should be deleted")
    })

    it("returns null past the idle timeout", () => {
      const accountId = makeAccount()
      const result = createAccountSession(accountId)
      const pastIdle = new Date(
        Date.now() - GUEST_SESSION.IDLE_TIMEOUT_MS - 60000,
      ).toISOString()
      getDb()
        .prepare("UPDATE account_sessions SET last_activity_at = ? WHERE token = ?")
        .run(pastIdle, hashToken(result.token))
      assert.strictEqual(getAccountSession(result.token), null)
    })

    it("returns the session when within the idle window", () => {
      const accountId = makeAccount()
      const result = createAccountSession(accountId)
      const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // 1 day
      getDb()
        .prepare("UPDATE account_sessions SET last_activity_at = ? WHERE token = ?")
        .run(recent, hashToken(result.token))
      assert.ok(getAccountSession(result.token), "1-day-idle session is within 60d window")
    })

    it("returns null once the account is soft-deleted (join guards deleted_at)", () => {
      const accountId = makeAccount()
      const result = createAccountSession(accountId)
      assert.ok(getAccountSession(result.token), "valid before soft-delete")

      getDb()
        .prepare("UPDATE accounts SET deleted_at = ? WHERE id = ?")
        .run(new Date().toISOString(), accountId)

      assert.strictEqual(
        getAccountSession(result.token),
        null,
        "soft-deleted account instantly invalidates its sessions",
      )
    })
  })

  describe("updateAccountSessionActivity", () => {
    it("bumps last_activity_at to ~now", () => {
      const accountId = makeAccount()
      const result = createAccountSession(accountId)
      const past = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      getDb()
        .prepare("UPDATE account_sessions SET last_activity_at = ? WHERE token = ?")
        .run(past, hashToken(result.token))

      updateAccountSessionActivity(result.token)

      const row = /** @type {{ last_activity_at: string } | undefined} */ (
        getDb()
          .prepare("SELECT last_activity_at FROM account_sessions WHERE token = ?")
          .get(hashToken(result.token))
      )
      assert.ok(row)
      assert.ok(
        Math.abs(new Date(row.last_activity_at).getTime() - Date.now()) < 2000,
        "last_activity_at should be refreshed",
      )
    })
  })

  describe("rotateAccountCsrfToken", () => {
    it("returns a new token and keeps the session valid", () => {
      const accountId = makeAccount()
      const result = createAccountSession(accountId)
      const rotated = rotateAccountCsrfToken(result.token)
      assert.strictEqual(rotated.length, 64)
      assert.notStrictEqual(rotated, result.csrf_token)

      const session = getAccountSession(result.token)
      assert.ok(session)
      assert.strictEqual(session.csrf_token, rotated)
    })
  })

  describe("deleteAccountSession", () => {
    it("removes the session", () => {
      const accountId = makeAccount()
      const result = createAccountSession(accountId)
      deleteAccountSession(result.token)
      assert.strictEqual(getAccountSession(result.token), null)
    })

    it("does not throw on an unknown token", () => {
      assert.doesNotThrow(() => deleteAccountSession("z".repeat(64)))
    })
  })

  describe("cleanExpiredAccountSessions", () => {
    it("stores last_activity_at in ISO form so a new session compares like the cutoff", () => {
      const { token } = createAccountSession(makeAccount())
      const row = /** @type {{ last_activity_at: string }} */ (
        getDb()
          .prepare("SELECT last_activity_at FROM account_sessions WHERE token = ?")
          .get(hashToken(token))
      )
      assert.ok(row.last_activity_at.includes("T"))
    })

    it("deletes absolutely-expired and idle-expired sessions, keeps fresh ones", () => {
      const accountId = makeAccount()
      const fresh = createAccountSession(accountId)
      const expired = createAccountSession(accountId)
      const idle = createAccountSession(accountId)

      getDb()
        .prepare("UPDATE account_sessions SET expires_at = ? WHERE token = ?")
        .run(new Date(Date.now() - 1000).toISOString(), hashToken(expired.token))
      getDb()
        .prepare("UPDATE account_sessions SET last_activity_at = ? WHERE token = ?")
        .run(
          new Date(Date.now() - GUEST_SESSION.IDLE_TIMEOUT_MS - 60000).toISOString(),
          hashToken(idle.token),
        )

      cleanExpiredAccountSessions()

      assert.ok(getAccountSession(fresh.token), "fresh session kept")
      const expiredRow = getDb()
        .prepare("SELECT * FROM account_sessions WHERE token = ?")
        .get(hashToken(expired.token))
      const idleRow = getDb()
        .prepare("SELECT * FROM account_sessions WHERE token = ?")
        .get(hashToken(idle.token))
      assert.strictEqual(expiredRow, undefined, "expired session cleaned")
      assert.strictEqual(idleRow, undefined, "idle session cleaned")
    })
  })
})
