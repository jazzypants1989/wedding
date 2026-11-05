/**
 * @file Integration tests for Gallery → Sort's server half: the admin curated
 * listing's capture time and decided flag, and POST /api/admin/media/decide.
 */
// MUST be first: sets TEST_SERVER_PORT before ../helpers.js reads it.
import "./_media-sort-port.js"

/** @import { DatabaseSync } from 'node:sqlite' */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import crypto from "node:crypto"
import {
  startServer,
  stopServer,
  getTestDb,
  adminLogin,
  adminFetch,
  cleanupTestData,
  readAuditLog,
  BASE_URL,
} from "../helpers.js"

/** @type {DatabaseSync} */
let db

const hasAdmin = !!process.env.TEST_ADMIN_PASSWORD

/** @param {Response} res */
async function json(res) {
  return /** @type {any} */ (await res.json().catch(() => ({})))
}

/**
 * A curated row, inserted directly: the decision endpoint only reads and writes
 * rows, so the upload pipeline has nothing to add here.
 * @param {{ section?: string, status?: string, sortOrder?: number,
 *   capturedAt?: string | null, decidedAt?: string | null, deleted?: boolean }} [o]
 */
function insertMedia(o = {}) {
  const result = db
    .prepare(
      `INSERT INTO media (file_key, account_id, kind, section, status, original_bytes,
         width, height, sort_order, captured_at, decided_at, reviewed_at, deleted_at)
       VALUES (?, NULL, 'image', ?, ?, 100, 1200, 800, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomBytes(16).toString("hex"),
      o.section ?? "official",
      o.status ?? "hidden",
      o.sortOrder ?? 0,
      o.capturedAt ?? null,
      o.decidedAt ?? null,
      "2026-01-01T00:00:00.000Z",
      o.deleted ? "2026-01-02T00:00:00.000Z" : null,
    )
  return Number(result.lastInsertRowid)
}

/** @param {number} id */
function row(id) {
  return /** @type {any} */ (
    db
      .prepare("SELECT status, decided_at, reviewed_at, sort_order FROM media WHERE id = ?")
      .get(id)
  )
}

function adminAuth() {
  return adminLogin(process.env.TEST_ADMIN_PASSWORD)
}

/** @param {any} auth @param {unknown} body */
function decide(auth, body) {
  return adminFetch(
    "/api/admin/media/decide",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    auth,
  )
}

before(async () => {
  await startServer()
  db = getTestDb()
})
after(async () => {
  await stopServer()
})
beforeEach(() => {
  cleanupTestData(db)
})

describe("Gallery → Sort: the admin listing", () => {
  it("carries the capture time and the decided flag; the public feed carries neither", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const auth = await adminAuth()
    const shown = insertMedia({ status: "approved", capturedAt: "2026-06-20T17:03:12.000Z" })
    const hidden = insertMedia({ status: "hidden", sortOrder: 1 })

    const res = await adminFetch("/api/admin/media/curated?section=official", {}, auth)
    assert.strictEqual(res.status, 200)
    const items = (await json(res)).items
    const byId = new Map(items.map((/** @type {any} */ i) => [i.id, i]))
    assert.strictEqual(byId.get(shown).captured_at, "2026-06-20T17:03:12.000Z")
    assert.strictEqual(byId.get(shown).decided_at, null)
    assert.strictEqual(byId.get(hidden).captured_at, null)

    const pub = await json(await fetch(`${BASE_URL}/api/media?section=official`))
    assert.strictEqual(pub.items.length, 1)
    assert.ok(!("captured_at" in pub.items[0]), "no capture time in public")
    assert.ok(!("decided_at" in pub.items[0]), "no decided flag in public")
  })
})

describe("Gallery → Sort: POST /api/admin/media/decide", () => {
  it("shows a hidden photo in its old place in the order, and marks it looked at", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const auth = await adminAuth()
    const first = insertMedia({ status: "approved", sortOrder: 0 })
    const middle = insertMedia({ status: "hidden", sortOrder: 1 })
    const last = insertMedia({ status: "approved", sortOrder: 2 })

    const res = await decide(auth, { ids: [middle], status: "approved", decided: true })
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    assert.deepStrictEqual(body.ids, [middle])
    assert.strictEqual(body.status, "approved")
    assert.ok(typeof body.decided_at === "string" && body.decided_at.length > 0)

    const after = row(middle)
    assert.strictEqual(after.status, "approved")
    assert.strictEqual(after.decided_at, body.decided_at)
    assert.strictEqual(after.sort_order, 1, "the order is never touched")
    assert.notStrictEqual(after.reviewed_at, "2026-01-01T00:00:00.000Z", "a status change stamps it")

    const pub = await json(await fetch(`${BASE_URL}/api/media?section=official`))
    assert.deepStrictEqual(
      pub.items.map((/** @type {any} */ i) => i.id),
      [first, middle, last],
    )
  })

  it("keeps a moment hidden in one call, leaving reviewed_at where it was", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const auth = await adminAuth()
    const a = insertMedia({ status: "hidden" })
    const b = insertMedia({ status: "hidden", sortOrder: 1, section: "honeymoon" })

    const res = await decide(auth, { ids: [a, b], status: "hidden", decided: true })
    assert.strictEqual(res.status, 200)
    for (const id of [a, b]) {
      const r = row(id)
      assert.strictEqual(r.status, "hidden")
      assert.ok(r.decided_at, "looked at")
      assert.strictEqual(r.reviewed_at, "2026-01-01T00:00:00.000Z", "no status change")
    }
  })

  it("undoes: back to hidden and not looked at", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const auth = await adminAuth()
    const id = insertMedia({ status: "hidden" })
    assert.strictEqual((await decide(auth, { ids: [id], status: "approved", decided: true })).status, 200)

    const res = await decide(auth, { ids: [id], status: "hidden", decided: false })
    assert.strictEqual(res.status, 200)
    assert.strictEqual((await json(res)).decided_at, null)
    const r = row(id)
    assert.strictEqual(r.status, "hidden")
    assert.strictEqual(r.decided_at, null)
  })

  it("is all or none: one photo it can't change refuses the lot", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const auth = await adminAuth()
    const ok = insertMedia({ status: "hidden" })
    const refused = [
      insertMedia({ status: "rejected", sortOrder: 1 }),
      insertMedia({ status: "uploading", sortOrder: 2 }),
      insertMedia({ status: "hidden", sortOrder: 3, deleted: true }),
      insertMedia({ status: "pending", section: "guest" }),
      insertMedia({ status: "approved", section: "content" }),
      999999,
    ]
    for (const bad of refused) {
      const res = await decide(auth, { ids: [ok, bad], status: "approved", decided: true })
      assert.strictEqual(res.status, 409, `id ${bad}`)
      assert.strictEqual(row(ok).status, "hidden", "rolled back")
      assert.strictEqual(row(ok).decided_at, null, "rolled back")
    }
  })

  it("refuses a malformed body", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const auth = await adminAuth()
    const id = insertMedia({ status: "hidden" })
    for (const body of [
      { ids: [], status: "approved", decided: true },
      { ids: [id, id], status: "approved", decided: true },
      { ids: ["x"], status: "approved", decided: true },
      { ids: [0], status: "approved", decided: true },
      { ids: [id], status: "rejected", decided: true },
      { ids: [id], status: "approved" },
      { ids: [id], status: "approved", decided: "yes" },
      { ids: Array.from({ length: 201 }, (_, i) => i + 1), status: "hidden", decided: true },
    ]) {
      const res = await decide(auth, body)
      assert.strictEqual(res.status, 400, JSON.stringify(body).slice(0, 80))
    }
    assert.strictEqual(row(id).decided_at, null)
  })

  it("needs an admin", async () => {
    const id = insertMedia({ status: "hidden" })
    const res = await fetch(`${BASE_URL}/api/admin/media/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], status: "approved", decided: true }),
    })
    assert.ok(res.status === 401 || res.status === 403, `got ${res.status}`)
    assert.strictEqual(row(id).status, "hidden")
  })

  it("writes one audit entry per photo", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const auth = await adminAuth()
    const a = insertMedia({ status: "hidden" })
    const b = insertMedia({ status: "hidden", sortOrder: 1 })
    assert.strictEqual((await decide(auth, { ids: [a, b], status: "hidden", decided: true })).status, 200)
    // The log is appended asynchronously after the response: wait for it.
    /** @type {Array<Record<string, any>>} */
    let entries = []
    for (let i = 0; i < 80; i++) {
      entries = readAuditLog().filter(
        (e) => e.action === "MEDIA_DECIDE" && (e.resourceId === a || e.resourceId === b),
      )
      if (entries.length === 2) break
      await new Promise((r) => setTimeout(r, 25))
    }
    for (const id of [a, b]) {
      const entry = entries.find((e) => e.resourceId === id)
      assert.ok(entry, `audited ${id}`)
      assert.deepStrictEqual(entry.details, { status: "hidden", decided: true })
    }
  })
})
