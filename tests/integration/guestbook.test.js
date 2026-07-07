/**
 * @file Integration tests for the guestbook (/api/guestbook + admin moderation).
 */
// MUST be first: sets TEST_SERVER_PORT before ../helpers.js reads it.
import "./_guestbook-port.js"

/** @import { DatabaseSync } from 'node:sqlite' */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import {
  startServer,
  stopServer,
  getTestDb,
  createTestAccount,
  createTestAccountSession,
  adminLogin,
  adminFetch,
  accountFetch,
  cleanupTestData,
  BASE_URL,
} from "../helpers.js"

/** @type {DatabaseSync} */
let db

const hasAdmin = !!process.env.TEST_ADMIN_PASSWORD

/**
 * Create an account + session and return the fetch-auth object.
 * @param {{ trusted?: 0 | 1, name?: string }} [opts]
 */
function signIn({ trusted = 0, name = "Guest" } = {}) {
  const account = createTestAccount(db, { name, trusted })
  const session = createTestAccountSession(db, Number(account.id))
  return {
    accountId: Number(account.id),
    auth: { cookieHeader: session.cookieHeader, csrfToken: session.csrfToken },
  }
}

/**
 * Insert a guestbook entry directly (bypassing the API) for seeding.
 * @param {number} accountId
 * @param {string} [status]
 */
function seedEntry(accountId, status = "approved") {
  db.prepare(
    `INSERT INTO guestbook_entries (account_id, message, status) VALUES (?, ?, ?)`,
  ).run(accountId, "seeded message", status)
}

/**
 * @param {string} path
 * @param {string} message
 * @param {{ cookieHeader: string | null, csrfToken: string | null }} auth
 */
function post(path, message, auth) {
  return accountFetch(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
    auth,
  )
}

/** GET /api/guestbook as an anonymous visitor. */
async function anonFeed(query = "") {
  const res = await fetch(`${BASE_URL}/api/guestbook${query}`)
  const data = /** @type {any} */ (await res.json())
  return { status: res.status, data }
}

describe("Guestbook", () => {
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

  describe("POST /api/guestbook — hybrid moderation", () => {
    it("trusted account → 201 approved → visible in anonymous GET immediately", async () => {
      const { auth } = signIn({ trusted: 1, name: "Aunt Carol" })
      const res = await post("/api/guestbook", "So happy for you!", auth)
      assert.strictEqual(res.status, 201)
      const body = /** @type {any} */ (await res.json())
      assert.strictEqual(body.status, "approved")
      assert.strictEqual(body.entry.author_name, "Aunt Carol")
      assert.strictEqual(body.entry.author_trusted, true)
      assert.strictEqual(body.entry.is_own, true)

      const feed = await anonFeed()
      assert.strictEqual(feed.status, 200)
      assert.strictEqual(feed.data.entries.length, 1)
      assert.strictEqual(feed.data.entries[0].message, "So happy for you!")
      assert.strictEqual(feed.data.entries[0].is_own, false)
    })

    it("untrusted account → 201 pending → hidden from anon, visible+flagged to author, in admin queue", async () => {
      const { auth, accountId } = signIn({ trusted: 0, name: "New Friend" })
      const res = await post("/api/guestbook", "Congrats!!", auth)
      assert.strictEqual(res.status, 201)
      const body = /** @type {any} */ (await res.json())
      assert.strictEqual(body.status, "pending")
      const entryId = body.entry.id

      // Absent from the anonymous feed.
      const anon = await anonFeed()
      assert.strictEqual(anon.data.entries.length, 0)

      // Present + flagged in the author's own authed feed.
      const ownRes = await accountFetch("/api/guestbook", { method: "GET" }, auth)
      const own = /** @type {any} */ (await ownRes.json())
      assert.strictEqual(own.entries.length, 1)
      assert.strictEqual(own.entries[0].status, "pending")
      assert.strictEqual(own.entries[0].is_own, true)

      // Present in the admin moderation queue.
      if (!hasAdmin) return
      const adminAuth = await adminLogin()
      const qRes = await adminFetch(
        "/api/admin/moderation/queue?type=guestbook",
        { method: "GET" },
        adminAuth,
      )
      const q = /** @type {any} */ (await qRes.json())
      assert.strictEqual(qRes.status, 200)
      assert.ok(q.items.some((/** @type {any} */ i) => i.id === entryId))

      const cRes = await adminFetch(
        "/api/admin/moderation/counts",
        { method: "GET" },
        adminAuth,
      )
      const counts = /** @type {any} */ (await cRes.json())
      assert.strictEqual(counts.guestbook, 1)
      assert.strictEqual(counts.total, 1)
    })

    it("POST without a CSRF header → 403", async () => {
      const { auth } = signIn({ trusted: 1 })
      // Send the cookies but omit the X-CSRF-Token header.
      const res = await fetch(`${BASE_URL}/api/guestbook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: auth.cookieHeader ?? "",
        },
        body: JSON.stringify({ message: "no csrf" }),
      })
      assert.strictEqual(res.status, 403)
    })

    it("POST while signed out → 401", async () => {
      const res = await fetch(`${BASE_URL}/api/guestbook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      })
      assert.strictEqual(res.status, 401)
    })

    it("empty message → 400", async () => {
      const { auth } = signIn({ trusted: 1 })
      const res = await post("/api/guestbook", "   ", auth)
      assert.strictEqual(res.status, 400)
    })
  })

  describe("admin moderation transitions", () => {
    it("approve makes a pending entry public; reject removes it from the author's feed", async () => {
      if (!hasAdmin) return
      const { auth } = signIn({ trusted: 0, name: "Pending Pat" })
      const approveId = /** @type {any} */ (
        await (await post("/api/guestbook", "approve me", auth)).json()
      ).entry.id
      const rejectId = /** @type {any} */ (
        await (await post("/api/guestbook", "reject me", auth)).json()
      ).entry.id

      const adminAuth = await adminLogin()

      const aRes = await adminFetch(
        `/api/admin/moderation/guestbook/${approveId}/approve`,
        { method: "POST" },
        adminAuth,
      )
      assert.strictEqual(aRes.status, 200)

      const rRes = await adminFetch(
        `/api/admin/moderation/guestbook/${rejectId}/reject`,
        { method: "POST" },
        adminAuth,
      )
      assert.strictEqual(rRes.status, 200)

      // Approved entry is now public.
      const anon = await anonFeed()
      const messages = anon.data.entries.map((/** @type {any} */ e) => e.message)
      assert.deepStrictEqual(messages, ["approve me"])

      // Rejected entry no longer shows even to its author.
      const ownRes = await accountFetch("/api/guestbook", { method: "GET" }, auth)
      const own = /** @type {any} */ (await ownRes.json())
      const ownMessages = own.entries.map((/** @type {any} */ e) => e.message)
      assert.deepStrictEqual(ownMessages, ["approve me"])
    })

    it("hide pulls a previously-approved entry from the public feed", async () => {
      if (!hasAdmin) return
      const { auth } = signIn({ trusted: 1, name: "Trusted Terry" })
      const id = /** @type {any} */ (
        await (await post("/api/guestbook", "live then hidden", auth)).json()
      ).entry.id

      // Live immediately (trusted).
      let anon = await anonFeed()
      assert.strictEqual(anon.data.entries.length, 1)

      const adminAuth = await adminLogin()
      const hRes = await adminFetch(
        `/api/admin/moderation/guestbook/${id}/hide`,
        { method: "POST" },
        adminAuth,
      )
      assert.strictEqual(hRes.status, 200)

      anon = await anonFeed()
      assert.strictEqual(anon.data.entries.length, 0, "hidden entry is gone publicly")
    })

    it("rejects an unknown moderation :type with 404", async () => {
      if (!hasAdmin) return
      const adminAuth = await adminLogin()
      const res = await adminFetch(
        "/api/admin/moderation/bogus/1/approve",
        { method: "POST" },
        adminAuth,
      )
      assert.strictEqual(res.status, 404)
    })
  })

  describe("keyset pagination", () => {
    it("walks 45 entries across 3 pages with no duplicates/gaps and null final cursor", async () => {
      const { accountId } = signIn({ trusted: 1 })
      for (let i = 0; i < 45; i++) seedEntry(accountId, "approved")

      /** @type {number[]} */
      const seen = []
      let cursor = null
      let pages = 0
      const pageSizes = []
      do {
        const query = `?limit=20${cursor !== null ? `&before=${cursor}` : ""}`
        const { data } = await anonFeed(query)
        pageSizes.push(data.entries.length)
        for (const e of data.entries) seen.push(e.id)
        cursor = data.nextCursor
        pages++
      } while (cursor !== null && pages < 10)

      assert.strictEqual(pages, 3, "45 rows / 20 per page = 3 pages")
      assert.deepStrictEqual(pageSizes, [20, 20, 5])
      assert.strictEqual(seen.length, 45)
      assert.strictEqual(new Set(seen).size, 45, "no duplicates across pages")

      // Strictly descending ids (newest-first, no gaps in ordering).
      for (let i = 1; i < seen.length; i++) {
        assert.ok(seen[i] < seen[i - 1], "ids strictly decreasing")
      }
    })

    it("clamps limit above 50 down to 50", async () => {
      const { accountId } = signIn({ trusted: 1 })
      for (let i = 0; i < 55; i++) seedEntry(accountId, "approved")
      const { data } = await anonFeed("?limit=200")
      assert.strictEqual(data.entries.length, 50)
    })
  })

  describe("rate limiting", () => {
    it("11th post within the window from one account → 429", async () => {
      const { auth } = signIn({ trusted: 1 })
      const statuses = []
      for (let i = 0; i < 11; i++) {
        const res = await post("/api/guestbook", `msg ${i}`, auth)
        statuses.push(res.status)
      }
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(statuses[i], 201, `post ${i} should succeed`)
      }
      assert.strictEqual(statuses[10], 429, "11th post should be rate limited")
    })
  })

  describe("DELETE /api/guestbook/:id", () => {
    it("author can soft-delete their own entry (gone from the feed)", async () => {
      const { auth } = signIn({ trusted: 1 })
      const id = /** @type {any} */ (
        await (await post("/api/guestbook", "delete me", auth)).json()
      ).entry.id

      const delRes = await accountFetch(
        `/api/guestbook/${id}`,
        { method: "DELETE" },
        auth,
      )
      assert.strictEqual(delRes.status, 200)

      const anon = await anonFeed()
      assert.strictEqual(anon.data.entries.length, 0)
    })

    it("cannot delete someone else's entry → 404", async () => {
      const owner = signIn({ trusted: 1, name: "Owner" })
      const other = signIn({ trusted: 1, name: "Other" })
      const id = /** @type {any} */ (
        await (await post("/api/guestbook", "mine", owner.auth)).json()
      ).entry.id

      const delRes = await accountFetch(
        `/api/guestbook/${id}`,
        { method: "DELETE" },
        other.auth,
      )
      assert.strictEqual(delRes.status, 404)

      // Still present for the real owner.
      const ownRes = await accountFetch("/api/guestbook", { method: "GET" }, owner.auth)
      const own = /** @type {any} */ (await ownRes.json())
      assert.strictEqual(own.entries.length, 1)
    })
  })
})
