/**
 * @file Integration tests for guest account endpoints (/api/account/*)
 */
// MUST be first: sets TEST_SERVER_PORT before ../helpers.js reads it.
import "./_alt-port.js"

/** @import { DatabaseSync } from 'node:sqlite' */
/** @import { AccountRegisterResult } from '../helpers.js' */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import {
  startServer,
  stopServer,
  getTestDb,
  createTestGuest,
  createTestAccount,
  createTestAccountSession,
  accountRegister,
  accountFetch,
  adminLogin,
  adminFetch,
  cleanupTestData,
  BASE_URL,
} from "../helpers.js"

/** @type {DatabaseSync} */
let db

// Unique per-test IPs keep the 10/h/IP ACCOUNT_REGISTER limiter from tripping
// across the file. Each test that registers passes its own.
let ipCounter = 0
function nextIp() {
  ipCounter += 1
  return `203.0.113.${ipCounter}`
}

describe("Account Endpoints", () => {
  before(async () => {
    db = getTestDb()
    cleanupTestData(db)
    await startServer()
  })

  after(async () => {
    cleanupTestData(db)
    db.close()
    await stopServer()
  })

  beforeEach(() => {
    cleanupTestData(db)
  })

  describe("POST /api/account/register — code path", () => {
    it("valid code + name → 201 trusted, cookies set, me resolves the account", async () => {
      const guest = createTestGuest(db, { invite_code: "GjKmPqrt" })
      const res = await accountRegister(
        { code: guest.invite_code, name: "Ada Guest" },
        { ip: nextIp() },
      )

      assert.strictEqual(res.status, 201)
      const account = /** @type {any} */ (res.data.account)
      assert.strictEqual(account.trusted, 1)
      assert.strictEqual(res.data.returning, false)
      assert.ok(res.cookieHeader, "guest cookies should be set")

      const meRes = await accountFetch("/api/account/me", { method: "GET" }, res)
      assert.strictEqual(meRes.status, 200)
      const meData = /** @type {any} */ (await meRes.json())
      assert.strictEqual(meData.account.id, account.id)
      assert.strictEqual(meData.account.name, "Ada Guest")
    })

    it("same code, two different names → two distinct accounts", async () => {
      const guest = createTestGuest(db, { invite_code: "Hh11Kk22" })
      const ip = nextIp()
      const a = await accountRegister({ code: guest.invite_code, name: "Alex" }, { ip })
      const b = await accountRegister({ code: guest.invite_code, name: "Blair" }, { ip })

      assert.strictEqual(a.status, 201)
      assert.strictEqual(b.status, 201)
      const idA = /** @type {any} */ (a.data.account).id
      const idB = /** @type {any} */ (b.data.account).id
      assert.notStrictEqual(idA, idB)
    })

    it("same code + same name (case/whitespace variants) → same account, 200 returning:true", async () => {
      const guest = createTestGuest(db, { invite_code: "Nn33Pp44" })
      const ip = nextIp()
      const first = await accountRegister(
        { code: guest.invite_code, name: "Jamie Lee" },
        { ip },
      )
      assert.strictEqual(first.status, 201)
      const firstId = /** @type {any} */ (first.data.account).id

      const again = await accountRegister(
        { code: guest.invite_code, name: "  jamie   LEE " },
        { ip },
      )
      assert.strictEqual(again.status, 200)
      assert.strictEqual(again.data.returning, true)
      assert.strictEqual(/** @type {any} */ (again.data.account).id, firstId)
    })

    it("invite code is matched case-insensitively (COLLATE NOCASE)", async () => {
      const guest = createTestGuest(db, { invite_code: "AbCdEfGh" })
      const ip = nextIp()
      const created = await accountRegister(
        { code: guest.invite_code, name: "Sam" },
        { ip },
      )
      assert.strictEqual(created.status, 201)
      const id = /** @type {any} */ (created.data.account).id

      // Lower-cased code + same name → same guest resolved → re-login (200).
      const lower = await accountRegister(
        { code: guest.invite_code.toLowerCase(), name: "Sam" },
        { ip },
      )
      assert.strictEqual(lower.status, 200)
      assert.strictEqual(lower.data.returning, true)
      assert.strictEqual(/** @type {any} */ (lower.data.account).id, id)

      // Upper-cased code, a new name → same guest, new trusted account (201).
      const upper = await accountRegister(
        { code: guest.invite_code.toUpperCase(), name: "Pat" },
        { ip },
      )
      assert.strictEqual(upper.status, 201)
      assert.strictEqual(/** @type {any} */ (upper.data.account).trusted, 1)
    })

    it("unknown code → generic 404 'Invite code not found'", async () => {
      const res = await accountRegister(
        { code: "Zz00Zz00", name: "Nobody" },
        { ip: nextIp() },
      )
      assert.strictEqual(res.status, 404)
      assert.strictEqual(res.data.error, "Invite code not found")
    })

    it("malformed code → same generic 404 (no oracle)", async () => {
      const res = await accountRegister(
        { code: "short", name: "Nobody" },
        { ip: nextIp() },
      )
      assert.strictEqual(res.status, 404)
      assert.strictEqual(res.data.error, "Invite code not found")
    })
  })

  describe("POST /api/account/register — open path", () => {
    it("no code → 201 untrusted account created instantly", async () => {
      const res = await accountRegister({ name: "Wanderer" }, { ip: nextIp() })
      assert.strictEqual(res.status, 201)
      assert.strictEqual(/** @type {any} */ (res.data.account).trusted, 0)
      assert.ok(res.cookieHeader)
    })

    it("optional contact is stored normalized", async () => {
      const res = await accountRegister(
        { name: "Ravi", contact: "  Ravi.Guest@Example.COM " },
        { ip: nextIp() },
      )
      assert.strictEqual(res.status, 201)
      const id = /** @type {any} */ (res.data.account).id
      const row = /** @type {{ contact_email: string } | undefined} */ (
        db.prepare("SELECT contact_email FROM accounts WHERE id = ?").get(id)
      )
      assert.ok(row)
      assert.strictEqual(row.contact_email, "ravi.guest@example.com")
    })

    it("invalid contact → 400", async () => {
      const res = await accountRegister(
        { name: "Ravi", contact: "not-an-email" },
        { ip: nextIp() },
      )
      assert.strictEqual(res.status, 400)
    })

    it("missing name → 400", async () => {
      const res = await accountRegister({ relation: "Cousin" }, { ip: nextIp() })
      assert.strictEqual(res.status, 400)
    })
  })

  describe("POST /api/account/register — open path, email already has an account", () => {
    function countAccounts() {
      const row = /** @type {{ c: number }} */ (
        db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL").get()
      )
      return row.c
    }

    /** @param {number | bigint} accountId */
    function countTokens(accountId) {
      const row = /** @type {{ c: number }} */ (
        db
          .prepare("SELECT COUNT(*) AS c FROM account_recovery_tokens WHERE account_id = ?")
          .get(accountId)
      )
      return row.c
    }

    it("a new email still creates an account, as before", async () => {
      const res = await accountRegister(
        { name: "Newcomer", contact: "newcomer@example.com" },
        { ip: nextIp() },
      )
      assert.strictEqual(res.status, 201)
      assert.strictEqual(/** @type {any} */ (res.data.account).trusted, 0)
      assert.strictEqual(res.data.emailed, undefined)
      assert.ok(res.cookieHeader)
      assert.strictEqual(countAccounts(), 1)
    })

    it("an existing open account's email → no account, no session, a recovery link", async () => {
      const first = await accountRegister(
        { name: "Returning Ravi", contact: "ravi@example.com" },
        { ip: nextIp() },
      )
      assert.strictEqual(first.status, 201)
      const firstId = /** @type {any} */ (first.data.account).id

      const again = await accountRegister(
        { name: "Ravi Again", contact: "ravi@example.com" },
        { ip: nextIp() },
      )
      assert.strictEqual(again.status, 200)
      assert.strictEqual(again.data.success, true)
      assert.strictEqual(again.data.emailed, true)
      assert.strictEqual(
        again.data.message,
        "You've been here before. We've emailed a link to sign you back in.",
      )
      assert.strictEqual(again.data.account, undefined, "no account in the body")
      assert.strictEqual(again.cookieHeader, null, "no session cookie")
      assert.strictEqual(countAccounts(), 1, "no second account")
      assert.strictEqual(countTokens(firstId), 1, "a recovery token for the first account")
    })

    it("an existing claimed (trusted) account's email matches too", async () => {
      const guest = createTestGuest(db, { invite_code: "Pq7rSt9v" })
      const claimed = await accountRegister(
        { code: guest.invite_code, name: "Claimed Cleo", contact: "cleo@example.com" },
        { ip: nextIp() },
      )
      assert.strictEqual(claimed.status, 201)
      const claimedId = /** @type {any} */ (claimed.data.account).id

      const open = await accountRegister(
        { name: "Cleo", contact: "cleo@example.com" },
        { ip: nextIp() },
      )
      assert.strictEqual(open.status, 200)
      assert.strictEqual(open.data.emailed, true)
      assert.strictEqual(open.cookieHeader, null)
      assert.strictEqual(countAccounts(), 1)
      assert.strictEqual(countTokens(claimedId), 1)
    })

    it("case and whitespace variants of the email match", async () => {
      const account = createTestAccount(db, {
        name: "Mixed Case",
        contact_email: "mixed.case@example.com",
      })

      const res = await accountRegister(
        { name: "Mixed Case", contact: "  Mixed.CASE@Example.com  " },
        { ip: nextIp() },
      )
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.emailed, true)
      assert.strictEqual(res.cookieHeader, null)
      assert.strictEqual(countAccounts(), 1)
      assert.strictEqual(countTokens(account.id), 1)
    })

    it("a soft-deleted account's email does not match", async () => {
      const gone = createTestAccount(db, { name: "Gone", contact_email: "gone@example.com" })
      db.prepare("UPDATE accounts SET deleted_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        gone.id,
      )

      const res = await accountRegister(
        { name: "Gone", contact: "gone@example.com" },
        { ip: nextIp() },
      )
      assert.strictEqual(res.status, 201)
      assert.ok(res.cookieHeader)
      assert.strictEqual(countTokens(gone.id), 0)
    })

    it("no email still creates an account, even beside accounts that have one", async () => {
      createTestAccount(db, { name: "Has Email", contact_email: "has@example.com" })
      const res = await accountRegister({ name: "Has Email" }, { ip: nextIp() })
      assert.strictEqual(res.status, 201)
      assert.ok(res.cookieHeader)
      assert.strictEqual(countAccounts(), 2)
    })
  })

  describe("logout & me", () => {
    it("logout deletes the session and clears cookies; me then returns null", async () => {
      const auth = await accountRegister({ name: "Loginout" }, { ip: nextIp() })
      assert.strictEqual(auth.status, 201)

      // Logout with only the session cookie (no CSRF header) still succeeds.
      const logoutRes = await fetch(`${BASE_URL}/api/account/logout`, {
        method: "POST",
        headers: { Cookie: auth.cookieHeader ?? "" },
      })
      assert.strictEqual(logoutRes.status, 200)

      // The old cookie no longer authenticates.
      const meRes = await accountFetch("/api/account/me", { method: "GET" }, auth)
      const meData = /** @type {any} */ (await meRes.json())
      assert.strictEqual(meData.account, null)
    })

    it("me returns { account: null } with no cookie, never 401", async () => {
      const res = await fetch(`${BASE_URL}/api/account/me`)
      assert.strictEqual(res.status, 200)
      const data = /** @type {any} */ (await res.json())
      assert.strictEqual(data.account, null)
    })

    it("logout without any cookie still 200s", async () => {
      const res = await fetch(`${BASE_URL}/api/account/logout`, { method: "POST" })
      assert.strictEqual(res.status, 200)
    })
  })

  describe("session lifecycle via direct DB (factories)", () => {
    it("a soft-deleted account instantly de-authenticates its sessions", async () => {
      const account = createTestAccount(db, { name: "Ghost", trusted: 1 })
      const session = createTestAccountSession(db, account.id)
      const auth = { cookieHeader: session.cookieHeader, csrfToken: session.csrfToken }

      // Valid to start.
      let meRes = await accountFetch("/api/account/me", { method: "GET" }, auth)
      let meData = /** @type {any} */ (await meRes.json())
      assert.strictEqual(meData.account.id, Number(account.id))

      // Soft-delete the account row directly.
      db.prepare("UPDATE accounts SET deleted_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        account.id,
      )

      meRes = await accountFetch("/api/account/me", { method: "GET" }, auth)
      meData = /** @type {any} */ (await meRes.json())
      assert.strictEqual(meData.account, null, "soft-deleted account is unauthenticated")
    })
  })

  describe("rate limiting", () => {
    it("11th registration from one IP within the window → 429", async () => {
      const ip = "198.51.100.7"
      /** @type {AccountRegisterResult[]} */
      const results = []
      for (let i = 0; i < 11; i++) {
        results.push(await accountRegister({ name: `Flood ${i}` }, { ip }))
      }
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(results[i].status, 201, `registration ${i} should succeed`)
      }
      assert.strictEqual(results[10].status, 429, "11th should be rate limited")
    })
  })

  describe("coexistence with admin sessions", () => {
    it("admin and guest sessions resolve independently in one client", async () => {
      if (!process.env.TEST_ADMIN_PASSWORD) return // admin tests skipped without password

      const adminAuth = await adminLogin()
      const guestAuth = await accountRegister({ name: "Dual Session" }, { ip: nextIp() })
      assert.strictEqual(guestAuth.status, 201)

      const statsRes = await adminFetch("/api/admin/stats", { method: "GET" }, adminAuth)
      assert.strictEqual(statsRes.status, 200, "admin session still works")

      const meRes = await accountFetch("/api/account/me", { method: "GET" }, guestAuth)
      const meData = /** @type {any} */ (await meRes.json())
      assert.strictEqual(meData.account.name, "Dual Session", "guest session still works")
    })
  })
})
