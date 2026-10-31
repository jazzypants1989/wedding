/**
 * @file Integration tests for Phase 6 admin moderation & curation: the combined
 * queue + filters, the approve/reject/hide state machine, bulk actions,
 * auto-trust on approval, account trust/untrust/soft-delete, curated-gallery
 * reorder/promote, and magic-link account recovery.
 */
// MUST be first: sets TEST_SERVER_PORT + storage env before ../helpers.js reads them.
import "./_moderation-port.js"

/** @import { DatabaseSync } from 'node:sqlite' */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
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
  readAuditLog,
  BASE_URL,
  TEST_DB_PATH,
} from "../helpers.js"
import { makeJpeg } from "../media-fixtures.js"

/** Server-side item directory for a media file_key (mirrors core/media-storage). */
/** @param {string} fileKey */
function serverItemDir(fileKey) {
  return path.join(
    path.dirname(TEST_DB_PATH),
    "uploads",
    "media",
    fileKey.slice(0, 2),
    fileKey,
  )
}

/** Quarantine destination for a rejected item (mirrors core/media-storage). */
/** @param {string} fileKey */
function serverQuarantineDir(fileKey) {
  return path.join(path.dirname(TEST_DB_PATH), "uploads", "quarantine", fileKey)
}

/** @type {DatabaseSync} */
let db

const hasAdmin = !!process.env.TEST_ADMIN_PASSWORD

/** @param {Response} res */
async function json(res) {
  return /** @type {any} */ (await res.json().catch(() => ({})))
}

/** @param {string} token */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

/** @param {{ trusted?: 0 | 1, name?: string, contactEmail?: string | null }} [opts] */
function signIn({ trusted = 0, name = "Guest", contactEmail = null } = {}) {
  const account = createTestAccount(db, { name, trusted, contact_email: contactEmail })
  const session = createTestAccountSession(db, Number(account.id))
  return {
    accountId: Number(account.id),
    auth: { cookieHeader: session.cookieHeader, csrfToken: session.csrfToken },
  }
}

/** @param {number} accountId @param {string} [status] */
function seedEntry(accountId, status = "pending") {
  const r = db
    .prepare(`INSERT INTO guestbook_entries (account_id, message, status) VALUES (?, ?, ?)`)
    .run(accountId, "seeded message", status)
  return Number(r.lastInsertRowid)
}

/** @param {number | null} accountId @param {string} [status] @param {string} [section] */
function seedMedia(accountId, status = "pending", section = "guest") {
  const fileKey = crypto.randomBytes(16).toString("hex")
  const r = db
    .prepare(
      `INSERT INTO media (file_key, account_id, kind, section, status) VALUES (?, ?, 'image', ?, ?)`,
    )
    .run(fileKey, accountId, section, status)
  return { id: Number(r.lastInsertRowid), fileKey }
}

/** @param {number} accountId @param {number} targetId @param {string} [status] */
function seedComment(accountId, targetId, status = "pending") {
  const r = db
    .prepare(
      `INSERT INTO comments (account_id, target_type, target_id, message, status)
       VALUES (?, 'guestbook', ?, ?, ?)`,
    )
    .run(accountId, targetId, "seeded comment", status)
  return Number(r.lastInsertRowid)
}

/** @param {string} table @param {number} id */
function statusOf(table, id) {
  const row = /** @type {any} */ (
    db.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id)
  )
  return row ? row.status : null
}

/**
 * Poll the audit log (the server appends asynchronously, after the response is
 * sent) for entries added since `sinceLen` that match `predicate`.
 * @param {number} sinceLen @param {(e: Record<string, any>) => boolean} predicate
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function auditSince(sinceLen, predicate) {
  for (let i = 0; i < 40; i++) {
    const fresh = readAuditLog().slice(sinceLen).filter(predicate)
    if (fresh.length) return fresh
    await sleep(25)
  }
  return []
}

/** @param {number} accountId */
function isTrusted(accountId) {
  const row = /** @type {any} */ (
    db.prepare(`SELECT trusted FROM accounts WHERE id = ?`).get(accountId)
  )
  return row ? row.trusted : null
}

/** @type {{ cookieHeader: string, csrfToken: string } | null} */
let admin = null

/** Admin action fetch (no-op skips are guarded by hasAdmin at call sites). */
/** @param {string} path @param {RequestInit} [options] */
function asAdmin(path, options = {}) {
  return adminFetch(path, /** @type {any} */ (options), /** @type {any} */ (admin))
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

describe("combined moderation queue + filters + counts", () => {
  it("returns all three content types interleaved, filterable by type/account", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ name: "Alice" })
    const b = signIn({ name: "Bob" })
    const entryId = seedEntry(a.accountId)
    const media = seedMedia(b.accountId)
    // The pending comment hangs off a LIVE (approved) parent so it surfaces in
    // the queue — a comment on a non-live parent is intentionally suppressed.
    const liveParent = seedEntry(a.accountId, "approved")
    const commentId = seedComment(a.accountId, liveParent)

    const all = await json(await asAdmin("/api/admin/moderation/queue"))
    const kinds = all.items.map((/** @type {any} */ i) => i.content_type).sort()
    assert.deepStrictEqual(kinds, ["comment", "guestbook", "media"])
    const mediaItem = all.items.find((/** @type {any} */ i) => i.content_type === "media")
    assert.strictEqual(mediaItem.file_key, media.fileKey)
    assert.strictEqual(mediaItem.id, media.id)
    assert.ok(all.items.some((/** @type {any} */ i) => i.id === commentId && i.content_type === "comment"))

    const onlyMedia = await json(await asAdmin("/api/admin/moderation/queue?type=media"))
    assert.strictEqual(onlyMedia.items.length, 1)
    assert.strictEqual(onlyMedia.items[0].content_type, "media")

    const byAccount = await json(
      await asAdmin(`/api/admin/moderation/queue?account_id=${b.accountId}`),
    )
    assert.strictEqual(byAccount.items.length, 1)
    assert.strictEqual(byAccount.items[0].account_id, b.accountId)

    const counts = await json(await asAdmin("/api/admin/moderation/counts"))
    assert.strictEqual(counts.guestbook, 1)
    assert.strictEqual(counts.media, 1)
    assert.strictEqual(counts.comments, 1)
    assert.strictEqual(counts.total, 3)
  })

  it("an unknown type is a 404", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const res = await asAdmin("/api/admin/moderation/queue?type=bogus")
    assert.strictEqual(res.status, 404)
  })

  it("filters the queue by status and reports hasMore", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ name: "StatusFilter" })
    const pendingId = seedEntry(a.accountId, "pending")
    const approvedId = seedEntry(a.accountId, "approved")

    const approved = await json(await asAdmin("/api/admin/moderation/queue?status=approved"))
    const approvedIds = approved.items.map((/** @type {any} */ i) => i.id)
    assert.ok(approvedIds.includes(approvedId), "approved item present under status=approved")
    assert.ok(!approvedIds.includes(pendingId), "pending item excluded under status=approved")
    assert.strictEqual(typeof approved.hasMore, "boolean", "queue reports a hasMore flag")

    const pending = await json(await asAdmin("/api/admin/moderation/queue?status=pending"))
    const pendingIds = pending.items.map((/** @type {any} */ i) => i.id)
    assert.ok(pendingIds.includes(pendingId), "pending item present under status=pending")
    assert.ok(!pendingIds.includes(approvedId), "approved item excluded under status=pending")
  })

  it("surfaces the author's relation on queue items (detail-modal source)", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const account = createTestAccount(db, { name: "Auntie", relation: "Aunt of the bride" })
    seedEntry(Number(account.id))
    const all = await json(await asAdmin("/api/admin/moderation/queue"))
    const item = all.items.find((/** @type {any} */ i) => i.account_id === Number(account.id))
    assert.ok(item, "queued item present")
    assert.strictEqual(item.author_relation, "Aunt of the bride")
  })
})

describe("approve/reject/hide state machine", () => {
  it("walks pending → approved → hidden → approved and rejects illegal transitions", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const owner = signIn({ trusted: 1, name: "SM" })
    const entryId = seedEntry(owner.accountId, "pending")

    // pending → approved
    const ap = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/approve`, { method: "POST" })
    assert.strictEqual(ap.status, 200)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "approved")

    // reject on an approved item is illegal → 409
    const badReject = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/reject`, { method: "POST" })
    assert.strictEqual(badReject.status, 409)

    // approved → hidden
    const hd = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/hide`, { method: "POST" })
    assert.strictEqual(hd.status, 200)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "hidden")

    // hidden → approved (unhide)
    const un = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/approve`, { method: "POST" })
    assert.strictEqual(un.status, 200)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "approved")

    // hide on a missing item → 409
    const missing = await asAdmin(`/api/admin/moderation/guestbook/999999/hide`, { method: "POST" })
    assert.strictEqual(missing.status, 409)
  })
})

describe("undo (reversible transitions only)", () => {
  it("returns previousStatus and reverts approve → pending", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const owner = signIn({ trusted: 1, name: "Undo Ursula" })
    const entryId = seedEntry(owner.accountId, "pending")

    const ap = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/approve`, { method: "POST" })
    assert.strictEqual(ap.status, 200)
    const body = await json(ap)
    assert.strictEqual(body.previousStatus, "pending")
    assert.strictEqual(statusOf("guestbook_entries", entryId), "approved")

    const un = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/undo`, {
      method: "POST",
      body: JSON.stringify({ to: "pending" }),
    })
    assert.strictEqual(un.status, 200)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "pending")
  })

  it("reverts hide → approved", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const owner = signIn({ trusted: 1, name: "Undo Uma" })
    const entryId = seedEntry(owner.accountId, "approved")

    await asAdmin(`/api/admin/moderation/guestbook/${entryId}/hide`, { method: "POST" })
    assert.strictEqual(statusOf("guestbook_entries", entryId), "hidden")

    const un = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/undo`, {
      method: "POST",
      body: JSON.stringify({ to: "approved" }),
    })
    assert.strictEqual(un.status, 200)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "approved")
  })

  it("refuses to undo a reject (its files were quarantined) → 409", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const owner = signIn({ trusted: 0, name: "Rejected Rita" })
    const entryId = seedEntry(owner.accountId, "pending")
    await asAdmin(`/api/admin/moderation/guestbook/${entryId}/reject`, { method: "POST" })
    assert.strictEqual(statusOf("guestbook_entries", entryId), "rejected")

    // Undo from a rejected state is not a supported reversal.
    const un = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/undo`, {
      method: "POST",
      body: JSON.stringify({ to: "pending" }),
    })
    assert.strictEqual(un.status, 409)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "rejected")
  })

  it("rejects an illegal undo target (to: rejected) → 409", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const owner = signIn({ trusted: 1, name: "Undo Ike" })
    const entryId = seedEntry(owner.accountId, "approved")

    const un = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/undo`, {
      method: "POST",
      body: JSON.stringify({ to: "rejected" }),
    })
    assert.strictEqual(un.status, 409)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "approved")
  })
})

describe("bulk actions", () => {
  it("bulk-approves a mix of types in one call", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const owner = signIn({ trusted: 1, name: "BulkOwner" })
    const stranger = signIn({ trusted: 0, name: "BulkStranger" })
    const entryId = seedEntry(stranger.accountId)
    const media = seedMedia(stranger.accountId)
    const commentId = seedComment(owner.accountId, entryId)

    const res = await asAdmin("/api/admin/moderation/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        items: [
          { type: "guestbook", id: entryId },
          { type: "media", id: media.id },
          { type: "comment", id: commentId },
        ],
      }),
    })
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    assert.strictEqual(body.changed, 3)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "approved")
    assert.strictEqual(statusOf("media", media.id), "approved")
    assert.strictEqual(statusOf("comments", commentId), "approved")
    // Bulk approve auto-trusts the untrusted author too.
    assert.strictEqual(isTrusted(stranger.accountId), 1)
  })

  it("rejects a bad bulk payload with 400", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const res = await asAdmin("/api/admin/moderation/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hide", items: [] }),
    })
    assert.strictEqual(res.status, 400)
  })

  it("approve-all drains the entire pending backlog (beyond one page) with auto-trust", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const stranger = signIn({ trusted: 0, name: "DrainMe" })
    const ids = []
    for (let i = 0; i < 3; i += 1) ids.push(seedEntry(stranger.accountId))
    const media = seedMedia(stranger.accountId)

    const res = await asAdmin("/api/admin/moderation/approve-all", { method: "POST" })
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    // Other tests' leftovers may also be pending — assert at-least, plus ours.
    assert.ok(body.changed >= 4, `approved at least our 4 items (got ${body.changed})`)
    // A single sweep drained everything here, so nothing is left pending.
    assert.strictEqual(body.remaining, 0)
    for (const id of ids) assert.strictEqual(statusOf("guestbook_entries", id), "approved")
    assert.strictEqual(statusOf("media", media.id), "approved")
    assert.strictEqual(isTrusted(stranger.accountId), 1)

    // The queue is actually drained.
    const counts = await json(await asAdmin("/api/admin/moderation/counts"))
    assert.strictEqual(counts.total, 0)
  })
})

describe("auto-trust on approval", () => {
  it("approving an untrusted author's item trusts them; their next post auto-approves", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const stranger = signIn({ trusted: 0, name: "Newcomer" })
    const entryId = seedEntry(stranger.accountId)

    const res = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/approve`, { method: "POST" })
    const body = await json(res)
    assert.strictEqual(body.autoTrusted, true)
    assert.strictEqual(isTrusted(stranger.accountId), 1)

    // Their next post goes live instantly (trust is read live from the session join).
    const post = await accountFetch(
      "/api/guestbook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "now I'm trusted" }),
      },
      stranger.auth,
    )
    assert.strictEqual((await json(post)).status, "approved")
  })

  it("reject does not touch trust", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const stranger = signIn({ trusted: 0, name: "Rejected" })
    const entryId = seedEntry(stranger.accountId)

    await asAdmin(`/api/admin/moderation/guestbook/${entryId}/reject`, { method: "POST" })
    assert.strictEqual(statusOf("guestbook_entries", entryId), "rejected")
    assert.strictEqual(isTrusted(stranger.accountId), 0)
  })

  it("unhiding a previously-approved item does NOT re-trust an untrusted author", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    // An untrusted author holding already-approved content (e.g. admin untrusted
    // them after approval). Hiding then unhiding must not silently re-trust —
    // only a genuine pending → approved transition auto-trusts (owner decision).
    const author = signIn({ trusted: 0, name: "Untrusted" })
    const entryId = seedEntry(author.accountId, "approved")

    const hide = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/hide`, { method: "POST" })
    assert.strictEqual(hide.status, 200)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "hidden")

    const unhide = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/approve`, { method: "POST" })
    assert.strictEqual(unhide.status, 200)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "approved")
    assert.strictEqual((await json(unhide)).autoTrusted, false, "unhide does not auto-trust")
    assert.strictEqual(isTrusted(author.accountId), 0)
  })

  it("approve & release rolls up the author's whole pending backlog", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const stranger = signIn({ trusted: 0, name: "Backlog" })
    const first = seedEntry(stranger.accountId)
    const second = seedEntry(stranger.accountId)
    const media = seedMedia(stranger.accountId)

    const res = await asAdmin(`/api/admin/moderation/guestbook/${first}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releasePending: true }),
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(statusOf("guestbook_entries", first), "approved")
    assert.strictEqual(statusOf("guestbook_entries", second), "approved")
    assert.strictEqual(statusOf("media", media.id), "approved")
  })
})

describe("media reject quarantines files", () => {
  it("rejecting a media item moves its files to quarantine but keeps the row", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const stranger = signIn({ trusted: 0, name: "PhotoStranger" })

    // Full untrusted upload → pending, files on disk.
    const create = await json(
      await accountFetch(
        "/api/media",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "image", originalBytes: 256 }),
        },
        stranger.auth,
      ),
    )
    /** @param {string} variant @param {Buffer} buf */
    const put = (variant, buf) =>
      accountFetch(
        `/api/media/${create.id}/${variant}`,
        /** @type {any} */ ({ method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: buf }),
        stranger.auth,
      )
    await put("original", makeJpeg(256))
    await put("display", makeJpeg(200))
    await put("thumb", makeJpeg(120))
    await accountFetch(
      `/api/media/${create.id}/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: 100, height: 100 }),
      },
      stranger.auth,
    )
    // Pending media isn't served publicly, so assert on the disk directly: the
    // variant files exist now, and reject removes the whole item directory.
    const dir = serverItemDir(create.fileKey)
    assert.ok(fs.existsSync(dir), "variant files on disk before reject")

    const rej = await asAdmin(`/api/admin/moderation/media/${create.id}/reject`, { method: "POST" })
    assert.strictEqual(rej.status, 200)
    // Files out of the serving tree but parked in quarantine (recoverable by
    // hand — reject must not be one mis-click from permanent loss); row kept.
    assert.ok(!fs.existsSync(dir), "item directory out of media/ after reject")
    assert.ok(
      fs.existsSync(serverQuarantineDir(create.fileKey)),
      "item directory moved to quarantine/ after reject",
    )
    assert.strictEqual(statusOf("media", create.id), "rejected")

    // The bytes are parked in quarantine/ (same disk), so a rejected row still
    // counts toward the account's quota until the sweep purges it — otherwise
    // reject-and-reupload would be an unbounded quota bypass.
    const sum = /** @type {{ total: number }} */ (
      db
        .prepare(
          `SELECT COALESCE(SUM(original_bytes), 0) AS total FROM media
           WHERE account_id = ? AND deleted_at IS NULL`,
        )
        .get(stranger.accountId)
    )
    assert.ok(sum.total > 0, "rejected item's bytes still count toward quota")
  })
})

describe("account trust management", () => {
  it("trust with approve_pending releases the backlog atomically across tables", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const stranger = signIn({ trusted: 0, name: "TrustMe" })
    const entryId = seedEntry(stranger.accountId)
    const media = seedMedia(stranger.accountId)
    const commentId = seedComment(stranger.accountId, entryId)

    const res = await asAdmin(`/api/admin/accounts/${stranger.accountId}/trust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve_pending: true }),
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual((await json(res)).released, 3)
    assert.strictEqual(isTrusted(stranger.accountId), 1)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "approved")
    assert.strictEqual(statusOf("media", media.id), "approved")
    assert.strictEqual(statusOf("comments", commentId), "approved")
  })

  it("untrust holds the account's next post for review", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const acct = signIn({ trusted: 1, name: "WasTrusted" })

    const res = await asAdmin(`/api/admin/accounts/${acct.accountId}/untrust`, { method: "POST" })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(isTrusted(acct.accountId), 0)

    const post = await accountFetch(
      "/api/guestbook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "held now" }),
      },
      acct.auth,
    )
    assert.strictEqual((await json(post)).status, "pending")
  })

  it("lists accounts with source + post counts", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const acct = signIn({ trusted: 0, name: "Listed" })
    seedEntry(acct.accountId, "approved")
    seedMedia(acct.accountId, "approved")

    const body = await json(await asAdmin("/api/admin/accounts"))
    const row = body.accounts.find((/** @type {any} */ a) => a.id === acct.accountId)
    assert.ok(row, "account listed")
    assert.strictEqual(row.source, "open registration")
    assert.strictEqual(row.post_count, 2)
    assert.strictEqual(row.trusted, false)
  })

  it("soft-delete kills sessions and hides the account's content", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const acct = signIn({ trusted: 1, name: "Doomed" })
    const entryId = seedEntry(acct.accountId, "approved")

    const del = await asAdmin(`/api/admin/accounts/${acct.accountId}`, { method: "DELETE" })
    assert.strictEqual(del.status, 200)
    assert.strictEqual((await json(del)).hidden, 1)

    // Approved content pulled offline.
    assert.strictEqual(statusOf("guestbook_entries", entryId), "hidden")

    // The session is dead — a mutation now 401s.
    const post = await accountFetch(
      "/api/guestbook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "ghost" }),
      },
      acct.auth,
    )
    assert.strictEqual(post.status, 401)
  })
})

describe("curated gallery management", () => {
  it("reorder rewrites the official order; foreign/short id sets are 400", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const one = seedMedia(null, "approved", "official")
    const two = seedMedia(null, "approved", "official")
    const three = seedMedia(null, "approved", "official")

    const reversed = [three.id, two.id, one.id]
    const ok = await asAdmin("/api/admin/media/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: reversed }),
    })
    assert.strictEqual(ok.status, 200)

    const feed = await json(await fetch(`${BASE_URL}/api/media?section=official`))
    const order = feed.items.map((/** @type {any} */ i) => i.id)
    assert.deepStrictEqual(order, reversed)

    // A foreign id → 400.
    const foreign = await asAdmin("/api/admin/media/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [three.id, two.id, 999999] }),
    })
    assert.strictEqual(foreign.status, 400)

    // A short set (not the full official list) → 400.
    const short = await asAdmin("/api/admin/media/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [three.id, two.id] }),
    })
    assert.strictEqual(short.status, 400)
  })

  it("promote MOVES an approved guest item into official (gone from the guest feed)", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const owner = signIn({ trusted: 1, name: "Promoter" })
    // Two existing official items so we can assert the promoted item appends last.
    seedMedia(null, "approved", "official")
    seedMedia(null, "approved", "official")
    const media = seedMedia(owner.accountId, "approved", "guest")

    const res = await asAdmin(`/api/admin/media/${media.id}/promote`, { method: "POST" })
    assert.strictEqual(res.status, 200)

    const official = await json(await fetch(`${BASE_URL}/api/media?section=official`))
    const officialIds = official.items.map((/** @type {any} */ i) => i.id)
    assert.ok(officialIds.includes(media.id), "now in official")
    assert.strictEqual(
      officialIds[officialIds.length - 1],
      media.id,
      "promoted item appended at the end (sort_order = MAX+1)",
    )

    const guest = await json(await fetch(`${BASE_URL}/api/media?section=guest`))
    assert.ok(!guest.items.some((/** @type {any} */ i) => i.id === media.id), "gone from guest feed")

    // Promoting a non-approved / already-official item → 409.
    const again = await asAdmin(`/api/admin/media/${media.id}/promote`, { method: "POST" })
    assert.strictEqual(again.status, 409)
  })

  it("caption edit persists; delete unlinks and soft-deletes", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const media = seedMedia(null, "approved", "official")

    const patch = await asAdmin(`/api/admin/media/${media.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption: "Our first dance" }),
    })
    assert.strictEqual(patch.status, 200)
    const capRow = /** @type {any} */ (
      db.prepare(`SELECT caption FROM media WHERE id = ?`).get(media.id)
    )
    assert.strictEqual(capRow.caption, "Our first dance")

    const del = await asAdmin(`/api/admin/media/${media.id}`, { method: "DELETE" })
    assert.strictEqual(del.status, 200)
    const delRow = /** @type {any} */ (
      db.prepare(`SELECT deleted_at FROM media WHERE id = ?`).get(media.id)
    )
    assert.ok(delRow.deleted_at, "row soft-deleted")
  })
})

describe("audit logging", () => {
  it("logs one MODERATION_* action per single approve/reject/hide/unhide", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const author = signIn({ trusted: 1, name: "Audited" })
    const approveId = seedEntry(author.accountId, "pending")
    const rejectId = seedEntry(author.accountId, "pending")
    const hideId = seedEntry(author.accountId, "approved")

    let before = readAuditLog().length
    await asAdmin(`/api/admin/moderation/guestbook/${approveId}/approve`, { method: "POST" })
    let hits = await auditSince(
      before,
      (e) => e.action === "MODERATION_APPROVE" && e.resourceType === "guestbook" && e.resourceId === approveId,
    )
    assert.strictEqual(hits.length, 1, "one MODERATION_APPROVE logged")

    before = readAuditLog().length
    await asAdmin(`/api/admin/moderation/guestbook/${rejectId}/reject`, { method: "POST" })
    hits = await auditSince(before, (e) => e.action === "MODERATION_REJECT" && e.resourceId === rejectId)
    assert.strictEqual(hits.length, 1, "one MODERATION_REJECT logged")

    before = readAuditLog().length
    await asAdmin(`/api/admin/moderation/guestbook/${hideId}/hide`, { method: "POST" })
    hits = await auditSince(before, (e) => e.action === "MODERATION_HIDE" && e.resourceId === hideId)
    assert.strictEqual(hits.length, 1, "one MODERATION_HIDE logged")

    // Unhide (hidden → approved) is audited distinctly from a first approval.
    before = readAuditLog().length
    await asAdmin(`/api/admin/moderation/guestbook/${hideId}/approve`, { method: "POST" })
    hits = await auditSince(before, (e) => e.action === "MODERATION_UNHIDE" && e.resourceId === hideId)
    assert.strictEqual(hits.length, 1, "one MODERATION_UNHIDE logged")
  })

  it("bulk approve logs one entry per changed item (documented granularity)", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const author = signIn({ trusted: 1, name: "BulkAudit" })
    const e1 = seedEntry(author.accountId)
    const e2 = seedEntry(author.accountId)
    const m = seedMedia(author.accountId)

    const before = readAuditLog().length
    await asAdmin("/api/admin/moderation/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        items: [
          { type: "guestbook", id: e1 },
          { type: "guestbook", id: e2 },
          { type: "media", id: m.id },
        ],
      }),
    })
    const hits = await auditSince(
      before,
      (e) =>
        e.action === "MODERATION_APPROVE" &&
        ((e.resourceType === "guestbook" && (e.resourceId === e1 || e.resourceId === e2)) ||
          (e.resourceType === "media" && e.resourceId === m.id)),
    )
    assert.strictEqual(hits.length, 3, "one MODERATION_APPROVE entry per changed item")
  })

  it("logs ACCOUNT_TRUST / ACCOUNT_UNTRUST / ACCOUNT_DELETE", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const acct = signIn({ trusted: 0, name: "AcctAudit" })

    let before = readAuditLog().length
    await asAdmin(`/api/admin/accounts/${acct.accountId}/trust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve_pending: false }),
    })
    assert.ok(
      (await auditSince(before, (e) => e.action === "ACCOUNT_TRUST" && e.resourceId === acct.accountId)).length,
      "ACCOUNT_TRUST logged",
    )

    before = readAuditLog().length
    await asAdmin(`/api/admin/accounts/${acct.accountId}/untrust`, { method: "POST" })
    assert.ok(
      (await auditSince(before, (e) => e.action === "ACCOUNT_UNTRUST" && e.resourceId === acct.accountId)).length,
      "ACCOUNT_UNTRUST logged",
    )

    before = readAuditLog().length
    await asAdmin(`/api/admin/accounts/${acct.accountId}`, { method: "DELETE" })
    assert.ok(
      (await auditSince(before, (e) => e.action === "ACCOUNT_DELETE" && e.resourceId === acct.accountId)).length,
      "ACCOUNT_DELETE logged",
    )
  })

  it("logs MEDIA_REORDER, MEDIA_PROMOTE and MEDIA_DELETE", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const one = seedMedia(null, "approved", "official")
    const two = seedMedia(null, "approved", "official")

    let before = readAuditLog().length
    await asAdmin("/api/admin/media/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [two.id, one.id] }),
    })
    assert.ok((await auditSince(before, (e) => e.action === "MEDIA_REORDER")).length, "MEDIA_REORDER logged")

    const owner = signIn({ trusted: 1, name: "MediaAudit" })
    const guestItem = seedMedia(owner.accountId, "approved", "guest")
    before = readAuditLog().length
    await asAdmin(`/api/admin/media/${guestItem.id}/promote`, { method: "POST" })
    assert.ok(
      (await auditSince(before, (e) => e.action === "MEDIA_PROMOTE" && e.resourceId === guestItem.id)).length,
      "MEDIA_PROMOTE logged",
    )

    before = readAuditLog().length
    await asAdmin(`/api/admin/media/${one.id}`, { method: "DELETE" })
    assert.ok(
      (await auditSince(before, (e) => e.action === "MEDIA_DELETE" && e.resourceId === one.id)).length,
      "MEDIA_DELETE logged",
    )
  })
})

describe("account recovery (magic link)", () => {
  it("POST /recover always 200; mints a token only for a known email", async () => {
    const email = `recover-${Date.now()}@example.com`
    signIn({ name: "Recoverable", contactEmail: email })

    const known = await fetch(`${BASE_URL}/api/account/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.9.0.1" },
      body: JSON.stringify({ email }),
    })
    assert.strictEqual(known.status, 200)
    const mintedKnown = /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) AS c FROM account_recovery_tokens`).get()
    )
    assert.strictEqual(mintedKnown.c, 1, "a token is minted for a known email")

    const unknown = await fetch(`${BASE_URL}/api/account/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.9.0.2" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    })
    assert.strictEqual(unknown.status, 200, "same 200 — no existence oracle")
    const mintedAfter = /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) AS c FROM account_recovery_tokens`).get()
    )
    assert.strictEqual(mintedAfter.c, 1, "no token minted for an unknown email")
  })

  it("GET /recover/:token redeems once → session + 302, then is dead", async () => {
    const acct = signIn({ name: "LinkUser", contactEmail: "link@example.com" })
    const token = crypto.randomBytes(32).toString("hex")
    db.prepare(
      `INSERT INTO account_recovery_tokens (token_hash, account_id, expires_at)
       VALUES (?, ?, ?)`,
    ).run(hashToken(token), acct.accountId, new Date(Date.now() + 3600_000).toISOString())

    const res = await fetch(`${BASE_URL}/api/account/recover/${token}`, { redirect: "manual" })
    assert.strictEqual(res.status, 302)
    // ?recover=success lets the guestbook greet the returning guest.
    assert.strictEqual(res.headers.get("location"), "/guestbook?recover=success")

    const setCookies = res.headers.getSetCookie()
    const sessionCookie = setCookies.find((c) => c.startsWith("guest_session="))
    assert.ok(sessionCookie, "a guest session cookie is set")
    const cookieHeader = sessionCookie.split(";")[0]

    // The new session actually works.
    const me = await json(await fetch(`${BASE_URL}/api/account/me`, { headers: { Cookie: cookieHeader } }))
    assert.strictEqual(me.account.id, acct.accountId)

    // Single-use: the same token is now dead → redirected to the expired-link
    // landing (a browser follows these from email, so no JSON error).
    const reuse = await fetch(`${BASE_URL}/api/account/recover/${token}`, { redirect: "manual" })
    assert.strictEqual(reuse.status, 302)
    assert.strictEqual(reuse.headers.get("location"), "/guestbook?recover=expired")
  })

  it("GET /recover/:token redirects an expired token to the expired-link landing", async () => {
    const acct = signIn({ name: "Expired", contactEmail: "exp@example.com" })
    const token = crypto.randomBytes(32).toString("hex")
    db.prepare(
      `INSERT INTO account_recovery_tokens (token_hash, account_id, expires_at)
       VALUES (?, ?, ?)`,
    ).run(hashToken(token), acct.accountId, new Date(Date.now() - 1000).toISOString())

    const res = await fetch(`${BASE_URL}/api/account/recover/${token}`, { redirect: "manual" })
    assert.strictEqual(res.status, 302)
    assert.strictEqual(res.headers.get("location"), "/guestbook?recover=expired")
  })

  it("GET /recover/:token redirects an unknown token to the expired-link landing", async () => {
    const res = await fetch(`${BASE_URL}/api/account/recover/deadbeef`, { redirect: "manual" })
    assert.strictEqual(res.status, 302)
    assert.strictEqual(res.headers.get("location"), "/guestbook?recover=expired")
  })
})

describe("Review split view (Workspace): single item, hide-from-pending, restore", () => {
  it("GET /:type/:id returns one post in any status; unknown → 404", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ name: "Deep Link" })
    const approvedId = seedEntry(a.accountId, "approved")

    const res = await asAdmin(`/api/admin/moderation/guestbook/${approvedId}`)
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    assert.strictEqual(body.item.id, approvedId)
    assert.strictEqual(body.item.status, "approved")
    assert.strictEqual(body.item.author_name, "Deep Link")

    assert.strictEqual((await asAdmin("/api/admin/moderation/guestbook/999999")).status, 404)
    assert.strictEqual((await asAdmin(`/api/admin/moderation/bogus/${approvedId}`)).status, 404)
  })

  it("hide works straight from pending (off the site, kept)", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ trusted: 0, name: "Hide Pending" })
    const entryId = seedEntry(a.accountId, "pending")
    const res = await asAdmin(`/api/admin/moderation/guestbook/${entryId}/hide`, { method: "POST" })
    assert.strictEqual(res.status, 200)
    assert.strictEqual((await json(res)).previousStatus, "pending")
    assert.strictEqual(statusOf("guestbook_entries", entryId), "hidden")
    // Hiding is not approving: no auto-trust.
    assert.strictEqual(isTrusted(a.accountId), 0)
  })

  it("bulk hide reports what changed; restore puts every one back", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ trusted: 1, name: "Bulk Hide" })
    const pendingId = seedEntry(a.accountId, "pending")
    const approvedId = seedEntry(a.accountId, "approved")

    const res = await asAdmin("/api/admin/moderation/bulk", {
      method: "POST",
      body: JSON.stringify({
        action: "hide",
        items: [
          { type: "guestbook", id: pendingId },
          { type: "guestbook", id: approvedId },
        ],
      }),
    })
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    assert.strictEqual(body.changed, 2)
    const prev = Object.fromEntries(
      body.items.map((/** @type {any} */ i) => [i.id, i.previousStatus]),
    )
    assert.deepStrictEqual(prev, { [pendingId]: "pending", [approvedId]: "approved" })

    const undo = await asAdmin("/api/admin/moderation/restore", {
      method: "POST",
      body: JSON.stringify({
        items: body.items.map((/** @type {any} */ i) => ({
          type: i.type,
          id: i.id,
          to: i.previousStatus,
        })),
      }),
    })
    assert.strictEqual(undo.status, 200)
    assert.strictEqual((await json(undo)).restored, 2)
    assert.strictEqual(statusOf("guestbook_entries", pendingId), "pending")
    assert.strictEqual(statusOf("guestbook_entries", approvedId), "approved")
  })

  it("restore un-trusts the author an approve auto-trusted", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ trusted: 0, name: "Undo Trust" })
    const entryId = seedEntry(a.accountId, "pending")
    const ap = await json(
      await asAdmin(`/api/admin/moderation/guestbook/${entryId}/approve`, { method: "POST" }),
    )
    assert.strictEqual(ap.autoTrusted, true)
    assert.strictEqual(isTrusted(a.accountId), 1)

    const res = await asAdmin("/api/admin/moderation/restore", {
      method: "POST",
      body: JSON.stringify({
        items: [{ type: "guestbook", id: entryId, to: "pending" }],
        untrust: [a.accountId],
      }),
    })
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    assert.strictEqual(body.restored, 1)
    assert.strictEqual(body.untrusted, 1)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "pending")
    assert.strictEqual(isTrusted(a.accountId), 0)
  })

  it("restore skips moves it doesn't allow (pending → approved is not an undo)", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ name: "No Shortcut" })
    const entryId = seedEntry(a.accountId, "pending")
    const res = await asAdmin("/api/admin/moderation/restore", {
      method: "POST",
      body: JSON.stringify({ items: [{ type: "guestbook", id: entryId, to: "approved" }] }),
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual((await json(res)).restored, 0)
    assert.strictEqual(statusOf("guestbook_entries", entryId), "pending")

    const bad = await asAdmin("/api/admin/moderation/restore", {
      method: "POST",
      body: JSON.stringify({ items: [] }),
    })
    assert.strictEqual(bad.status, 400)
  })

  it("restoring a rejected photo brings its files back out of quarantine", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ trusted: 0, name: "Quarantine Return" })
    const media = seedMedia(a.accountId, "pending")
    const dir = serverItemDir(media.fileKey)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "original.jpg"), makeJpeg(64))

    const rej = await asAdmin(`/api/admin/moderation/media/${media.id}/reject`, { method: "POST" })
    assert.strictEqual(rej.status, 200)
    assert.ok(!fs.existsSync(dir), "files left media/ on reject")

    const res = await asAdmin("/api/admin/moderation/restore", {
      method: "POST",
      body: JSON.stringify({ items: [{ type: "media", id: media.id, to: "pending" }] }),
    })
    assert.strictEqual((await json(res)).restored, 1)
    assert.strictEqual(statusOf("media", media.id), "pending")
    assert.ok(fs.existsSync(path.join(dir, "original.jpg")), "files are back in media/")
    assert.ok(!fs.existsSync(serverQuarantineDir(media.fileKey)), "nothing left in quarantine")
  })

  it("a rejected photo whose files were purged stays rejected", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ trusted: 0, name: "Purged" })
    const media = seedMedia(a.accountId, "rejected")
    const res = await asAdmin("/api/admin/moderation/restore", {
      method: "POST",
      body: JSON.stringify({ items: [{ type: "media", id: media.id, to: "pending" }] }),
    })
    assert.strictEqual((await json(res)).restored, 0)
    assert.strictEqual(statusOf("media", media.id), "rejected")
  })
})

describe("Accounts + author card (Workspace)", () => {
  it("GET /api/admin/accounts/:id carries per-status counts; unknown → 404", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ trusted: 0, name: "Counted" })
    seedEntry(a.accountId, "pending")
    seedEntry(a.accountId, "pending")
    seedEntry(a.accountId, "approved")
    seedEntry(a.accountId, "hidden")
    seedMedia(a.accountId, "rejected")

    const res = await asAdmin(`/api/admin/accounts/${a.accountId}`)
    assert.strictEqual(res.status, 200)
    const { account } = await json(res)
    assert.strictEqual(account.name, "Counted")
    assert.strictEqual(account.trusted, false)
    assert.deepStrictEqual(account.counts, { pending: 2, approved: 1, hidden: 1, rejected: 1 })
    assert.strictEqual(account.pending_count, 2)
    assert.strictEqual(account.post_count, 5)

    assert.strictEqual((await asAdmin("/api/admin/accounts/999999")).status, 404)

    const list = await json(await asAdmin("/api/admin/accounts"))
    const row = list.accounts.find((/** @type {any} */ x) => x.id === a.accountId)
    assert.strictEqual(row.pending_count, 2)
  })

  it("approve-pending approves exactly their waiting posts, and restore undoes it", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ trusted: 0, name: "Waiting" })
    const other = signIn({ trusted: 0, name: "Someone Else" })
    const e1 = seedEntry(a.accountId, "pending")
    const m1 = seedMedia(a.accountId, "pending")
    const hiddenId = seedEntry(a.accountId, "hidden")
    const theirs = seedEntry(other.accountId, "pending")

    const res = await asAdmin(`/api/admin/accounts/${a.accountId}/approve-pending`, {
      method: "POST",
    })
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    assert.strictEqual(body.changed, 2)
    assert.deepStrictEqual(
      body.items.map((/** @type {any} */ i) => `${i.type}:${i.id}:${i.previousStatus}`).sort(),
      [`guestbook:${e1}:pending`, `media:${m1.id}:pending`].sort(),
    )
    // Same transition as one approve: the untrusted author is trusted now.
    assert.deepStrictEqual(body.trustedAccounts, [a.accountId])
    assert.strictEqual(statusOf("guestbook_entries", e1), "approved")
    assert.strictEqual(statusOf("media", m1.id), "approved")
    assert.strictEqual(statusOf("guestbook_entries", hiddenId), "hidden")
    assert.strictEqual(statusOf("guestbook_entries", theirs), "pending")

    const undo = await asAdmin("/api/admin/moderation/restore", {
      method: "POST",
      body: JSON.stringify({
        items: body.items.map((/** @type {any} */ i) => ({
          type: i.type,
          id: i.id,
          to: i.previousStatus,
        })),
        untrust: body.trustedAccounts,
      }),
    })
    assert.strictEqual((await json(undo)).restored, 2)
    assert.strictEqual(statusOf("guestbook_entries", e1), "pending")
    assert.strictEqual(statusOf("media", m1.id), "pending")
    assert.strictEqual(isTrusted(a.accountId), 0)

    const missing = await asAdmin("/api/admin/accounts/999999/approve-pending", { method: "POST" })
    assert.strictEqual(missing.status, 404)
  })

  it("trust without approve_pending leaves the waiting posts waiting", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const a = signIn({ trusted: 0, name: "Future Only" })
    const waiting = seedEntry(a.accountId, "pending")
    const res = await asAdmin(`/api/admin/accounts/${a.accountId}/trust`, {
      method: "POST",
      body: JSON.stringify({ approve_pending: false }),
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(isTrusted(a.accountId), 1)
    assert.strictEqual(statusOf("guestbook_entries", waiting), "pending")
  })
})
