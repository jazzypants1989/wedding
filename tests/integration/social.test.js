/**
 * @file Integration tests for Phase 5 comments + reactions (polymorphic over
 * guestbook entries and media), plus feed enrichment and comment moderation.
 */
// MUST be first: sets TEST_SERVER_PORT before ../helpers.js reads it.
import "./_social-port.js"

/** @import { DatabaseSync } from 'node:sqlite' */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import crypto from "node:crypto"
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

/** @param {{ trusted?: 0 | 1, name?: string }} [opts] */
function signIn({ trusted = 0, name = "Guest" } = {}) {
  const account = createTestAccount(db, { name, trusted })
  const session = createTestAccountSession(db, Number(account.id))
  return {
    accountId: Number(account.id),
    auth: { cookieHeader: session.cookieHeader, csrfToken: session.csrfToken },
  }
}

/** @param {number} accountId @param {string} [status] */
function seedEntry(accountId, status = "approved") {
  const r = db
    .prepare(
      `INSERT INTO guestbook_entries (account_id, message, status) VALUES (?, ?, ?)`,
    )
    .run(accountId, "seeded message", status)
  return Number(r.lastInsertRowid)
}

/** @param {number} accountId @param {string} [status] @param {string} [section] */
function seedMedia(accountId, status = "approved", section = "guest") {
  const fileKey = crypto.randomBytes(16).toString("hex")
  const r = db
    .prepare(
      `INSERT INTO media (file_key, account_id, kind, section, status) VALUES (?, ?, 'image', ?, ?)`,
    )
    .run(fileKey, accountId, section, status)
  return Number(r.lastInsertRowid)
}

/**
 * @param {string} targetType @param {number} targetId @param {string} emoji
 * @param {{ cookieHeader: string | null, csrfToken: string | null }} auth
 */
function toggleReaction(targetType, targetId, emoji, auth) {
  return accountFetch(
    "/api/reactions/toggle",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_type: targetType, target_id: targetId, emoji }),
    },
    auth,
  )
}

/**
 * @param {string} targetType @param {number} targetId @param {string} message
 * @param {{ cookieHeader: string | null, csrfToken: string | null }} auth
 */
function postComment(targetType, targetId, message, auth) {
  return accountFetch(
    `/api/${targetType}/${targetId}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
    auth,
  )
}

/**
 * @param {string} targetType @param {number} targetId
 * @param {{ cookieHeader: string | null, csrfToken: string | null }} [auth]
 */
async function getComments(targetType, targetId, auth) {
  const res = auth
    ? await accountFetch(`/api/${targetType}/${targetId}/comments`, { method: "GET" }, auth)
    : await fetch(`${BASE_URL}/api/${targetType}/${targetId}/comments`)
  const data = /** @type {any} */ (await res.json().catch(() => null))
  return { status: res.status, data }
}

/**
 * Count reaction rows for a target/emoji directly in the DB.
 * @param {string} targetType @param {number} targetId @param {string} emoji
 */
function reactionRows(targetType, targetId, emoji) {
  const row = /** @type {any} */ (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM reactions WHERE target_type=? AND target_id=? AND emoji=?`,
      )
      .get(targetType, targetId, emoji)
  )
  return row.c
}

describe("Social (comments + reactions)", () => {
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

  describe("reactions toggle", () => {
    it("toggle on → {active:true} + row; toggle again → {active:false} + row gone", async () => {
      const owner = signIn({ trusted: 1, name: "Owner" })
      const entryId = seedEntry(owner.accountId)
      const reactor = signIn({ trusted: 1, name: "Reactor" })

      const onRes = await toggleReaction("guestbook", entryId, "heart", reactor.auth)
      assert.strictEqual(onRes.status, 200)
      const on = /** @type {any} */ (await onRes.json())
      assert.strictEqual(on.active, true)
      assert.strictEqual(on.counts.heart, 1)
      assert.strictEqual(reactionRows("guestbook", entryId, "heart"), 1)

      const offRes = await toggleReaction("guestbook", entryId, "heart", reactor.auth)
      const off = /** @type {any} */ (await offRes.json())
      assert.strictEqual(off.active, false)
      assert.ok(!off.counts.heart, "heart drops out of counts at zero")
      assert.strictEqual(reactionRows("guestbook", entryId, "heart"), 0)
    })

    it("UNIQUE(account,target,emoji) rejects a duplicate reaction row", () => {
      const owner = signIn({ trusted: 1 })
      const entryId = seedEntry(owner.accountId)
      const reactor = createTestAccount(db, { trusted: 1, name: "Dup" })
      const insert = db.prepare(
        `INSERT INTO reactions (account_id, target_type, target_id, emoji) VALUES (?, 'guestbook', ?, 'clap')`,
      )
      insert.run(reactor.id, entryId)
      assert.throws(() => insert.run(reactor.id, entryId))
    })

    it("two parallel toggles converge (one adds, one removes → final zero)", async () => {
      const owner = signIn({ trusted: 1 })
      const entryId = seedEntry(owner.accountId)
      const reactor = signIn({ trusted: 1, name: "Racer" })

      const [aRes, bRes] = await Promise.all([
        toggleReaction("guestbook", entryId, "fire", reactor.auth),
        toggleReaction("guestbook", entryId, "fire", reactor.auth),
      ])
      const a = /** @type {any} */ (await aRes.json())
      const b = /** @type {any} */ (await bRes.json())
      // The two writes serialize: exactly one insert + one delete.
      assert.deepStrictEqual([a.active, b.active].sort(), [false, true])
      assert.strictEqual(reactionRows("guestbook", entryId, "fire"), 0)
    })

    it("invalid emoji or target_type → 400", async () => {
      const reactor = signIn({ trusted: 1 })
      const badEmoji = await toggleReaction("guestbook", 1, "banana", reactor.auth)
      assert.strictEqual(badEmoji.status, 400)
      const badType = await toggleReaction("bogus", 1, "heart", reactor.auth)
      assert.strictEqual(badType.status, 400)
    })

    it("reacting on someone else's pending target → 404", async () => {
      const owner = signIn({ trusted: 0, name: "Pending Owner" })
      const pendingId = seedEntry(owner.accountId, "pending")
      const other = signIn({ trusted: 1, name: "Other" })
      const res = await toggleReaction("guestbook", pendingId, "heart", other.auth)
      assert.strictEqual(res.status, 404)
    })

    it("31st toggle within the window from one account → 429", async () => {
      const owner = signIn({ trusted: 1 })
      const entryId = seedEntry(owner.accountId)
      const reactor = signIn({ trusted: 1, name: "RL" })
      const statuses = []
      for (let i = 0; i < 31; i++) {
        const res = await toggleReaction("guestbook", entryId, "heart", reactor.auth)
        statuses.push(res.status)
      }
      for (let i = 0; i < 30; i++) assert.strictEqual(statuses[i], 200, `toggle ${i}`)
      assert.strictEqual(statuses[30], 429)
    })
  })

  describe("comments — hybrid moderation", () => {
    it("trusted comment is instantly public", async () => {
      const owner = signIn({ trusted: 1 })
      const entryId = seedEntry(owner.accountId)
      const commenter = signIn({ trusted: 1, name: "Trusted" })

      const res = await postComment("guestbook", entryId, "Congrats!", commenter.auth)
      assert.strictEqual(res.status, 201)
      const body = /** @type {any} */ (await res.json())
      assert.strictEqual(body.status, "approved")

      const anon = await getComments("guestbook", entryId)
      assert.strictEqual(anon.status, 200)
      assert.strictEqual(anon.data.comments.length, 1)
      assert.strictEqual(anon.data.comments[0].message, "Congrats!")
      assert.strictEqual(anon.data.comments[0].is_own, false)
    })

    it("untrusted comment is held, author-visible, and approvable via the moderation API", async () => {
      const owner = signIn({ trusted: 1 })
      const entryId = seedEntry(owner.accountId)
      const commenter = signIn({ trusted: 0, name: "New Voice" })

      const res = await postComment("guestbook", entryId, "held pls", commenter.auth)
      const body = /** @type {any} */ (await res.json())
      assert.strictEqual(body.status, "pending")
      const commentId = body.comment.id

      // Absent for the public.
      const anon = await getComments("guestbook", entryId)
      assert.strictEqual(anon.data.comments.length, 0)

      // Present + flagged for the author.
      const own = await getComments("guestbook", entryId, commenter.auth)
      assert.strictEqual(own.data.comments.length, 1)
      assert.strictEqual(own.data.comments[0].is_own, true)
      assert.strictEqual(own.data.comments[0].status, "pending")

      if (!hasAdmin) return
      const adminAuth = await adminLogin()
      // Counts include the pending comment.
      const before = /** @type {any} */ (
        await (
          await adminFetch("/api/admin/moderation/counts", { method: "GET" }, adminAuth)
        ).json()
      )
      assert.strictEqual(before.comments, 1)
      assert.strictEqual(before.total, 1)

      // Reachable via the comment queue by type.
      const q = /** @type {any} */ (
        await (
          await adminFetch(
            "/api/admin/moderation/queue?type=comment",
            { method: "GET" },
            adminAuth,
          )
        ).json()
      )
      assert.ok(q.items.some((/** @type {any} */ i) => i.id === commentId))

      // Approve → now public.
      const ap = await adminFetch(
        `/api/admin/moderation/comment/${commentId}/approve`,
        { method: "POST" },
        adminAuth,
      )
      assert.strictEqual(ap.status, 200)
      const anon2 = await getComments("guestbook", entryId)
      assert.strictEqual(anon2.data.comments.length, 1)

      const after = /** @type {any} */ (
        await (
          await adminFetch("/api/admin/moderation/counts", { method: "GET" }, adminAuth)
        ).json()
      )
      assert.strictEqual(after.comments, 0)
    })

    it("commenting on someone else's pending target → 404", async () => {
      const owner = signIn({ trusted: 0, name: "PO" })
      const pendingId = seedEntry(owner.accountId, "pending")
      const other = signIn({ trusted: 1, name: "Other" })
      const res = await postComment("guestbook", pendingId, "hi", other.auth)
      assert.strictEqual(res.status, 404)
    })

    it("comments on a hidden parent → GET 404 for the public", async () => {
      const owner = signIn({ trusted: 1 })
      const entryId = seedEntry(owner.accountId)
      const commenter = signIn({ trusted: 1, name: "C" })
      await postComment("guestbook", entryId, "before hide", commenter.auth)

      db.prepare(`UPDATE guestbook_entries SET status='hidden' WHERE id=?`).run(entryId)

      const anon = await getComments("guestbook", entryId)
      assert.strictEqual(anon.status, 404)
    })

    it("author can delete their own comment", async () => {
      const owner = signIn({ trusted: 1 })
      const entryId = seedEntry(owner.accountId)
      const commenter = signIn({ trusted: 1, name: "Deleter" })
      const id = /** @type {any} */ (
        await (await postComment("guestbook", entryId, "oops", commenter.auth)).json()
      ).comment.id

      const del = await accountFetch(
        `/api/comments/${id}`,
        { method: "DELETE" },
        commenter.auth,
      )
      assert.strictEqual(del.status, 200)
      const anon = await getComments("guestbook", entryId)
      assert.strictEqual(anon.data.comments.length, 0)
    })
  })

  describe("media targets", () => {
    it("comment on approved media is public; on a stranger's pending media → 404", async () => {
      const owner = signIn({ trusted: 1 })
      const approvedId = seedMedia(owner.accountId, "approved")
      const pendingId = seedMedia(owner.accountId, "pending")
      const commenter = signIn({ trusted: 1, name: "MC" })

      const ok = await postComment("media", approvedId, "cute!", commenter.auth)
      assert.strictEqual(ok.status, 201)

      const no = await postComment("media", pendingId, "hi", commenter.auth)
      assert.strictEqual(no.status, 404)
    })

    it("media feed + single-item enrichment attach reactions and comment_count", async () => {
      const owner = signIn({ trusted: 1 })
      const mediaId = seedMedia(owner.accountId, "approved")
      const reactor = signIn({ trusted: 1, name: "MR" })
      await toggleReaction("media", mediaId, "cheers", reactor.auth)
      await postComment("media", mediaId, "photo!", reactor.auth)

      const feed = /** @type {any} */ (
        await (await fetch(`${BASE_URL}/api/media?section=guest`)).json()
      )
      const item = feed.items.find((/** @type {any} */ i) => i.id === mediaId)
      assert.ok(item, "media item present in feed")
      assert.strictEqual(item.reactions.cheers.count, 1)
      assert.strictEqual(item.reactions.cheers.mine, false)
      assert.strictEqual(item.comment_count, 1)

      const one = /** @type {any} */ (
        await (await fetch(`${BASE_URL}/api/media/${mediaId}`)).json()
      )
      assert.strictEqual(one.reactions.cheers.count, 1)
      assert.strictEqual(one.comment_count, 1)
    })
  })

  describe("feed enrichment (guestbook)", () => {
    it("counts + mine flags + comment_count are correct per viewer", async () => {
      const owner = signIn({ trusted: 1 })
      const entryId = seedEntry(owner.accountId)
      const reactor = signIn({ trusted: 1, name: "Enricher" })
      await toggleReaction("guestbook", entryId, "heart", reactor.auth)
      await postComment("guestbook", entryId, "c1", reactor.auth)

      // Anonymous viewer: counts present, mine false.
      const anon = /** @type {any} */ (
        await (await fetch(`${BASE_URL}/api/guestbook`)).json()
      )
      const anonEntry = anon.entries.find((/** @type {any} */ e) => e.id === entryId)
      assert.strictEqual(anonEntry.reactions.heart.count, 1)
      assert.strictEqual(anonEntry.reactions.heart.mine, false)
      assert.strictEqual(anonEntry.comment_count, 1)

      // The reactor's own authed feed: mine true.
      const own = /** @type {any} */ (
        await (
          await accountFetch("/api/guestbook", { method: "GET" }, reactor.auth)
        ).json()
      )
      const ownEntry = own.entries.find((/** @type {any} */ e) => e.id === entryId)
      assert.strictEqual(ownEntry.reactions.heart.mine, true)
    })
  })
})
