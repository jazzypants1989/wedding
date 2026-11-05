/**
 * @file Integration tests for the merged Guests list's data: GET
 * /api/admin/accounts as the Guests page joins it to the roster (household
 * link, no-invitation people, last seen), that it never leaks a session token
 * or anything else beyond its projection, and that Trust / Untrust from the
 * Guests page (the same endpoints Review uses) round-trip. Fictional names only.
 */
// MUST be first: sets TEST_SERVER_PORT before ../helpers.js reads it.
import "./_guests-accounts-port.js"

/** @import { DatabaseSync } from 'node:sqlite' */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import {
  startServer,
  stopServer,
  getTestDb,
  createTestGuest,
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

/** @type {{ cookieHeader: string, csrfToken: string } | null} */
let admin = null

/** @param {string} path @param {RequestInit} [options] */
function asAdmin(path, options = {}) {
  return adminFetch(path, /** @type {any} */ (options), /** @type {any} */ (admin))
}

/** @param {Response} res */
async function json(res) {
  return /** @type {any} */ (await res.json().catch(() => ({})))
}

/** Every key an account row may carry, and nothing more. */
const ROW_KEYS = [
  "contact_email",
  "created_at",
  "guest_id",
  "id",
  "last_seen_at",
  "name",
  "pending_count",
  "post_count",
  "relation",
  "source",
  "trusted",
].sort()

/** @param {number} accountId */
function isTrusted(accountId) {
  const row = /** @type {any} */ (
    db.prepare(`SELECT trusted FROM accounts WHERE id = ?`).get(accountId)
  )
  return row ? row.trusted : null
}

/** The whole listing, every page, as the Guests page loads it. */
async function listAll() {
  /** @type {any[]} */
  const all = []
  for (let offset = 0; ; offset += 100) {
    const res = await asAdmin(`/api/admin/accounts?limit=100&offset=${offset}`)
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    all.push(...body.accounts)
    if (body.accounts.length < 100 || all.length >= body.total) break
  }
  return all
}

before(async () => {
  await startServer()
  db = getTestDb()
  if (hasAdmin) {
    const a = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
    admin = { cookieHeader: a.cookieHeader, csrfToken: a.csrfToken }
  }
})
after(async () => {
  await stopServer()
})
beforeEach(() => {
  cleanupTestData(db)
})

describe("GET /api/admin/accounts — joined to the guest list", () => {
  it("is admin-only", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/accounts`)
    assert.strictEqual(res.status, 401)
  })

  it("links a household's people to their invitation and marks the no-invitation ones", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const household = createTestGuest(db, { name: "Rosa & Daniel Méndez" })
    const rosa = createTestAccount(db, { name: "Rosa Méndez", guest_id: household.id, trusted: 1 })
    const daniel = createTestAccount(db, { name: "Daniel Méndez", guest_id: household.id })
    const priya = createTestAccount(db, { name: "Priya Raman" })

    const rows = await listAll()
    const byId = new Map(rows.map((r) => [r.id, r]))
    const r = byId.get(Number(rosa.id))
    const d = byId.get(Number(daniel.id))
    const p = byId.get(Number(priya.id))
    assert.ok(r && d && p, "all three listed")
    assert.strictEqual(r.guest_id, household.id)
    assert.strictEqual(d.guest_id, household.id)
    assert.strictEqual(r.source, "Rosa & Daniel Méndez")
    assert.strictEqual(r.trusted, true)
    assert.strictEqual(d.trusted, false)
    assert.strictEqual(p.guest_id, null)
    assert.strictEqual(p.source, "open registration")
  })

  it("never leaks a session token, a CSRF token or any column beyond its projection", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const guest = createTestGuest(db, { name: "Theo Lindqvist" })
    const acct = createTestAccount(db, { name: "Theo Lindqvist", guest_id: guest.id })
    const session = createTestAccountSession(db, Number(acct.id))

    const listRes = await asAdmin("/api/admin/accounts")
    const listText = await listRes.text()
    const detailRes = await asAdmin(`/api/admin/accounts/${acct.id}`)
    const detailText = await detailRes.text()
    for (const text of [listText, detailText]) {
      assert.ok(!text.includes(session.token), "no raw session token")
      assert.ok(!text.includes(session.csrfToken), "no CSRF token")
      assert.ok(!text.includes("name_normalized"), "no internal columns")
      assert.ok(!text.includes("deleted_at"), "no internal columns")
    }
    const tokenHash = /** @type {any} */ (
      db.prepare("SELECT token FROM account_sessions WHERE account_id = ?").get(acct.id)
    ).token
    assert.ok(!listText.includes(tokenHash), "no hashed session token")

    const row = JSON.parse(listText).accounts.find((/** @type {any} */ a) => a.id === Number(acct.id))
    assert.deepStrictEqual(Object.keys(row).sort(), ROW_KEYS)
    const detail = JSON.parse(detailText).account
    assert.deepStrictEqual(
      Object.keys(detail).sort(),
      [...ROW_KEYS, "counts"].sort(),
    )
  })

  it("last seen is the newest live sign-in, and null when there is none", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const seen = createTestAccount(db, { name: "Hannah Weiss" })
    const never = createTestAccount(db, { name: "Grandpa Walt" })
    createTestAccountSession(db, Number(seen.id))
    db.prepare("UPDATE account_sessions SET last_activity_at = ? WHERE account_id = ?").run(
      "2026-10-01T12:00:00.000Z",
      seen.id,
    )
    createTestAccountSession(db, Number(seen.id))
    db.prepare(
      `UPDATE account_sessions SET last_activity_at = ?
       WHERE account_id = ? AND last_activity_at != ?`,
    ).run("2026-10-03T08:00:00.000Z", seen.id, "2026-10-01T12:00:00.000Z")

    const rows = await listAll()
    const s = rows.find((r) => r.id === Number(seen.id))
    const n = rows.find((r) => r.id === Number(never.id))
    assert.strictEqual(s.last_seen_at, "2026-10-03T08:00:00.000Z")
    assert.strictEqual(n.last_seen_at, null)
    const detail = await json(await asAdmin(`/api/admin/accounts/${seen.id}`))
    assert.strictEqual(detail.account.last_seen_at, "2026-10-03T08:00:00.000Z")
  })

  it("pages: limit + offset walk every person exactly once", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const ids = []
    for (let i = 0; i < 7; i++) ids.push(Number(createTestAccount(db, { name: `Cousin ${i}` }).id))
    /** @type {number[]} */
    const seen = []
    for (let offset = 0; offset < 7; offset += 3) {
      const body = await json(await asAdmin(`/api/admin/accounts?limit=3&offset=${offset}`))
      assert.strictEqual(body.total, 7)
      seen.push(...body.accounts.map((/** @type {any} */ a) => a.id))
    }
    assert.deepStrictEqual([...seen].sort(), [...ids].sort())
  })
})

describe("Trust / Untrust from the Guests page", () => {
  it("trusts then untrusts a household member (Rosa), and the listing follows", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const household = createTestGuest(db, { name: "Rosa & Daniel Méndez" })
    const rosa = createTestAccount(db, { name: "Rosa Méndez", guest_id: household.id })
    const id = Number(rosa.id)
    const session = createTestAccountSession(db, id)
    // A post already waiting stays waiting when she is trusted (approve_pending: false).
    const waiting = Number(
      db
        .prepare(`INSERT INTO guestbook_entries (account_id, message, status) VALUES (?, ?, 'pending')`)
        .run(id, "waiting already").lastInsertRowid,
    )

    const trust = await asAdmin(`/api/admin/accounts/${id}/trust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve_pending: false }),
    })
    assert.strictEqual(trust.status, 200)
    assert.strictEqual((await json(trust)).released, 0)
    assert.strictEqual(isTrusted(id), 1)
    let row = (await listAll()).find((r) => r.id === id)
    assert.strictEqual(row.trusted, true)
    assert.strictEqual(row.guest_id, household.id)
    const status = /** @type {any} */ (
      db.prepare("SELECT status FROM guestbook_entries WHERE id = ?").get(waiting)
    ).status
    assert.strictEqual(status, "pending")

    const untrust = await asAdmin(`/api/admin/accounts/${id}/untrust`, { method: "POST" })
    assert.strictEqual(untrust.status, 200)
    assert.strictEqual(isTrusted(id), 0)
    row = (await listAll()).find((r) => r.id === id)
    assert.strictEqual(row.trusted, false)

    // Untrusted again: her next post waits for review.
    const post = await accountFetch(
      "/api/guestbook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "held for review" }),
      },
      { cookieHeader: session.cookieHeader, csrfToken: session.csrfToken },
    )
    assert.strictEqual(post.status, 201)
    const latest = /** @type {any} */ (
      db
        .prepare("SELECT status FROM guestbook_entries WHERE account_id = ? ORDER BY id DESC LIMIT 1")
        .get(id)
    )
    assert.strictEqual(latest.status, "pending")
  })

  it("works the same for someone who signed up without an invitation", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const id = Number(createTestAccount(db, { name: "Kofi Mensah" }).id)
    const trust = await asAdmin(`/api/admin/accounts/${id}/trust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve_pending: false }),
    })
    assert.strictEqual(trust.status, 200)
    assert.strictEqual(isTrusted(id), 1)
    const untrust = await asAdmin(`/api/admin/accounts/${id}/untrust`, { method: "POST" })
    assert.strictEqual(untrust.status, 200)
    assert.strictEqual(isTrusted(id), 0)
  })

  it("needs the admin's CSRF token, and 404s a removed person", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const id = Number(createTestAccount(db, { name: "Dana Kim" }).id)
    const noCsrf = await fetch(`${BASE_URL}/api/admin/accounts/${id}/untrust`, {
      method: "POST",
      headers: { Cookie: /** @type {any} */ (admin).cookieHeader },
    })
    assert.strictEqual(noCsrf.status, 403)

    const del = await asAdmin(`/api/admin/accounts/${id}`, { method: "DELETE" })
    assert.strictEqual(del.status, 200)
    const after = await asAdmin(`/api/admin/accounts/${id}/trust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    assert.strictEqual(after.status, 404)
    assert.ok(!(await listAll()).some((r) => r.id === id), "a removed person leaves the list")
  })
})
