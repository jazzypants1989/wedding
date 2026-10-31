/**
 * @file Integration tests for digital thank-you cards: the public token-authed
 * card read/reply/open-beacon endpoints, the signed-in "card waiting" /mine
 * surfacing, and the admin gift-log + card CRUD/delivery/resend surface. Public
 * cards are seeded directly via db/thank-you-cards.js / db/gifts.js functions;
 * the admin flows drive the real /api/admin/* endpoints.
 */
// MUST be first: sets TEST_SERVER_PORT before ../helpers.js reads it.
import "./_thank-you-port.js"
// MUST be second (and before any db/*.js import below): points
// db/connection.js's DB_PATH at the same SQLite file the spawned test server
// uses.
import "./_thank-you-db-env.js"
// Self-provisions a TEST_ADMIN_PASSWORD (+ matching ADMIN_PASSWORD_HASH) when
// the environment doesn't already supply one, so the admin suite ALWAYS runs
// instead of silently skipping ~20 tests. Imported after _thank-you-db-env.js
// (which pulls in helpers.js and thus loads .env), so a real .env-provided
// password still wins.
import "./_thank-you-admin-env.js"

/** @import { DatabaseSync } from 'node:sqlite' */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import crypto from "node:crypto"

import { init, close, getDb } from "../../db/connection.js"
import { createThankYouCard, markCardSent, setCardReply } from "../../db/thank-you-cards.js"
import { createGift as createGiftDb } from "../../db/gifts.js"
import {
  insertFace,
  createIdentity,
  mergeIdentityInto,
  softDeleteFace,
} from "../../db/media-faces.js"
import { recordAssignment } from "../../db/face-assignments.js"
import {
  startServer,
  stopServer,
  startAuxServer,
  createTestGuest,
  createTestPerson,
  createTestAccount,
  createTestAccountSession,
  cleanupTestData,
  accountFetch,
  adminLogin,
  adminFetch,
  readAuditLog,
  BASE_URL,
  TEST_PORT,
} from "../helpers.js"

/** @type {DatabaseSync} */
let db

const hasAdmin = !!process.env.TEST_ADMIN_PASSWORD
/** @type {{ cookieHeader: string, csrfToken: string } | null} */
let admin = null

/** Admin action fetch (no-op skips are guarded by hasAdmin at call sites). */
/** @param {string} path @param {RequestInit} [options] */
function asAdmin(path, options = {}) {
  return adminFetch(path, /** @type {any} */ (options), /** @type {any} */ (admin))
}

/** @param {Response} res */
async function json(res) {
  return /** @type {any} */ (await res.json().catch(() => ({})))
}

/**
 * Create a guest + a 'sent' card for them in one step (the state a public
 * token GET/reply requires — a bare 'draft' card 404s).
 * @param {Partial<Parameters<typeof createThankYouCard>[0]>} [overrides]
 */
function seedSentCard(overrides = {}) {
  const guest = createTestGuest(db)
  const card = createThankYouCard({
    guestId: Number(guest.id),
    giftId: null,
    message: "Thank you so much for the gift!",
    theme: "classic",
    effectsConfig: undefined,
    mediaKeys: undefined,
    ...overrides,
  })
  markCardSent(card.id, "manual")
  return { guest, token: card.token, shareToken: card.share_token, cardId: card.id }
}

/** Seed a bare draft card (never sent) — used for the "not yet delivered" 404 cases. */
function seedDraftCard() {
  const guest = createTestGuest(db)
  const card = createThankYouCard({
    guestId: Number(guest.id),
    giftId: null,
    message: "still drafting",
    theme: "classic",
    effectsConfig: undefined,
    mediaKeys: undefined,
  })
  return { guest, token: card.token }
}

/** Seed a gift row (via the db layer, so its FK to a real guest is satisfied). */
function seedGift() {
  const guest = createTestGuest(db)
  return createGiftDb({
    guestId: Number(guest.id),
    description: "A gift",
    amount: "$50",
    notes: null,
    receivedAt: null,
  })
}

/** @param {string} token */
async function getCard(token) {
  const res = await fetch(`${BASE_URL}/api/thank-you/${token}`)
  const data = /** @type {any} */ (await res.json().catch(() => null))
  return { status: res.status, data }
}

/** @param {string} token @param {Record<string, unknown>} body */
async function postReply(token, body) {
  const res = await fetch(`${BASE_URL}/api/thank-you/${token}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = /** @type {any} */ (await res.json().catch(() => null))
  return { status: res.status, data }
}

/**
 * Insert a media row directly (raw SQL — no admin upload API to go through).
 * @param {{ status?: string, width?: number | null, height?: number | null }} [opts]
 */
function seedMediaRow({ status = "approved", width = null, height = null } = {}) {
  const fileKey = crypto.randomBytes(16).toString("hex")
  db.prepare(
    `INSERT INTO media (file_key, account_id, kind, section, status, width, height)
     VALUES (?, NULL, 'image', 'guest', ?, ?, ?)`,
  ).run(fileKey, status, width, height)
  return fileKey
}

describe("Digital thank-you cards (Phase 3 public API)", () => {
  before(async () => {
    init()
    db = getDb()
    cleanupTestData(db)
    await startServer()
    if (hasAdmin) {
      const a = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
      admin = { cookieHeader: a.cookieHeader, csrfToken: a.csrfToken }
    }
  })

  after(async () => {
    cleanupTestData(db)
    close()
    await stopServer()
  })

  beforeEach(() => {
    cleanupTestData(db)
  })

  describe("GET /api/thank-you/:token", () => {
    it("404s for an unknown (but well-formed) token", async () => {
      const res = await getCard("ZZZZZZZZ")
      assert.strictEqual(res.status, 404)
    })

    it("404s for a malformed token", async () => {
      const res = await getCard("not-8-chars")
      assert.strictEqual(res.status, 404)
    })

    it("404s for a draft (not-yet-sent) card token", async () => {
      const { token } = seedDraftCard()
      const res = await getCard(token)
      assert.strictEqual(res.status, 404)
    })

    it("returns scoped card fields (no amount anywhere) and is read-only (GET never marks viewed)", async () => {
      const { guest, token } = seedSentCard({ message: "Thanks a million!", theme: "gratitude" })

      const first = await getCard(token)
      assert.strictEqual(first.status, 200)
      assert.strictEqual(first.data.recipient_name, guest.name)
      assert.strictEqual(first.data.message, "Thanks a million!")
      assert.strictEqual(first.data.theme, "gratitude")
      assert.strictEqual(first.data.reply, null)
      assert.deepStrictEqual(first.data.media, [])
      assert.strictEqual(first.data.effects_config, null)
      // GET is read-only now — the envelope-open beacon (POST /:token/opened)
      // stamps viewed_at, not the page-load fetch. A never-opened card reads null.
      assert.strictEqual(first.data.viewed_at, null, "GET does not mark viewed")

      // Never leak gift/amount data on any public thank-you response.
      const flat = JSON.stringify(first.data).toLowerCase()
      assert.ok(!flat.includes("amount"), "no amount key anywhere in the response")

      // A second GET still doesn't mutate.
      const second = await getCard(token)
      assert.strictEqual(second.status, 200)
      assert.strictEqual(second.data.viewed_at, null, "GET stays read-only on re-fetch")
    })

    it("the open beacon (POST /:token/opened) marks viewed once and counts every open", async () => {
      const { token } = seedSentCard()

      const first = await fetch(`${BASE_URL}/api/thank-you/${token}/opened`, { method: "POST" })
      const firstData = /** @type {any} */ (await first.json())
      assert.strictEqual(first.status, 200)
      assert.ok(firstData.viewed_at, "first open stamps viewed_at")
      assert.strictEqual(firstData.view_count, 1)

      const second = await fetch(`${BASE_URL}/api/thank-you/${token}/opened`, { method: "POST" })
      const secondData = /** @type {any} */ (await second.json())
      assert.strictEqual(secondData.view_count, 2, "every open increments view_count")
      assert.strictEqual(secondData.viewed_at, firstData.viewed_at, "viewed_at unchanged after first")

      // The GET now reflects the beacon-set viewed_at.
      const got = await getCard(token)
      assert.strictEqual(got.data.viewed_at, firstData.viewed_at)
    })

    it("the open beacon 404s an unknown/draft token like the GET", async () => {
      const unknown = await fetch(`${BASE_URL}/api/thank-you/ZZZZZZZZ/opened`, { method: "POST" })
      assert.strictEqual(unknown.status, 404)

      const { token } = seedDraftCard()
      const draft = await fetch(`${BASE_URL}/api/thank-you/${token}/opened`, { method: "POST" })
      assert.strictEqual(draft.status, 404)
    })

    it("the open beacon 404s a soft-deleted card and never bumps its view_count", async () => {
      const { token, cardId } = seedSentCard()
      // One legitimate open first, so view_count has a known non-zero baseline.
      await fetch(`${BASE_URL}/api/thank-you/${token}/opened`, { method: "POST" })
      const before = /** @type {any} */ (
        db.prepare("SELECT view_count FROM thank_you_cards WHERE id = ?").get(cardId)
      )
      assert.strictEqual(before.view_count, 1)

      // Soft-delete, then the beacon must 404 (like the GET) AND leave view_count
      // untouched — recordCardOpen's WHERE clause filters deleted_at IS NULL.
      db.prepare("UPDATE thank_you_cards SET deleted_at = datetime('now') WHERE id = ?").run(cardId)
      const res = await fetch(`${BASE_URL}/api/thank-you/${token}/opened`, { method: "POST" })
      assert.strictEqual(res.status, 404)

      const after = /** @type {any} */ (
        db.prepare("SELECT view_count FROM thank_you_cards WHERE id = ?").get(cardId)
      )
      assert.strictEqual(after.view_count, 1, "no view_count bump on a soft-deleted card")
    })

    it("resolves media_keys to approved, non-deleted media items only", async () => {
      const approvedKey = seedMediaRow({ status: "approved", width: 800, height: 600 })
      const pendingKey = seedMediaRow({ status: "pending" })

      const { token } = seedSentCard({ mediaKeys: [approvedKey, pendingKey, "doesnotexist00"] })
      const res = await getCard(token)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.media.length, 1)
      assert.strictEqual(res.data.media[0].file_key, approvedKey)
      assert.strictEqual(res.data.media[0].kind, "image")
      assert.strictEqual(res.data.media[0].width, 800)
      assert.strictEqual(res.data.media[0].height, 600)
    })

    it("excludes a media row that was approved then soft-deleted", async () => {
      // Closes the untested branch in api/thank-you.js#resolveMedia: an approved
      // key whose row later gets a deleted_at must silently drop, not 404 the card.
      const liveKey = seedMediaRow({ status: "approved", width: 640, height: 480 })
      const deletedKey = seedMediaRow({ status: "approved", width: 100, height: 100 })
      db.prepare(`UPDATE media SET deleted_at = ? WHERE file_key = ?`).run(
        new Date().toISOString(),
        deletedKey,
      )

      const { token } = seedSentCard({ mediaKeys: [liveKey, deletedKey] })
      const res = await getCard(token)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.media.length, 1, "only the live approved row resolves")
      assert.strictEqual(res.data.media[0].file_key, liveKey)
    })

    it("exposes exactly the whitelisted public keys — never gift_id/amount", async () => {
      // Exact response-shape assertion (stronger than a substring scan): the
      // public card payload is a fixed key whitelist. gift/amount fields must be
      // structurally absent, not merely missing from a flattened string.
      const gift = seedGift()
      const { token } = seedSentCard({ message: "Whitelist check", giftId: gift.id })
      const res = await getCard(token)
      assert.strictEqual(res.status, 200)

      // Primary-token access adds canReply (true) + shareToken (the raw share
      // credential so the page can build the forward link).
      assert.deepStrictEqual(
        Object.keys(res.data).sort(),
        [
          "canReply",
          "effects_config",
          "media",
          "message",
          "recipient_name",
          "reply",
          "shareToken",
          "theme",
          "viewed_at",
        ],
      )
      assert.strictEqual(res.data.canReply, true, "primary token can reply")
      assert.strictEqual(typeof res.data.shareToken, "string")
      assert.ok(!("gift_id" in res.data), "gift_id is absent from the public payload")
      assert.ok(!("amount" in res.data), "amount is absent from the public payload")
      assert.ok(!("token" in res.data), "primary token is never echoed as a key")
    })

    it("parses effects_config JSON when present", async () => {
      const { token } = seedSentCard({
        effectsConfig: { reveal: "confetti", effects: [{ id: "lanterns", config: {} }] },
      })
      const res = await getCard(token)
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(res.data.effects_config, {
        reveal: "confetti",
        effects: [{ id: "lanterns", config: {} }],
      })
    })
  })

  describe("share token (read-only forward link)", () => {
    it("resolves the card via the share token but marks it read-only (canReply false, no shareToken echo)", async () => {
      const { guest, token, shareToken } = seedSentCard({ message: "Shared card" })
      assert.ok(shareToken, "seeded card has a share token")
      assert.notStrictEqual(shareToken, token, "share token differs from the primary token")

      const res = await getCard(shareToken)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.recipient_name, guest.name)
      assert.strictEqual(res.data.message, "Shared card")
      assert.strictEqual(res.data.canReply, false, "share-token viewer cannot reply")
      // The primary token is NEVER echoed to a share-token viewer, in any field.
      assert.ok(!("shareToken" in res.data), "shareToken is not echoed on the share path")
      const flat = JSON.stringify(res.data)
      assert.ok(!flat.includes(token), "primary token never appears in the share response")
    })

    it("the primary-token GET exposes canReply true + the raw share token", async () => {
      const { token, shareToken } = seedSentCard()
      const res = await getCard(token)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.canReply, true)
      assert.strictEqual(res.data.shareToken, shareToken, "primary GET returns the share token verbatim")
    })

    it("the open beacon 404s a share token (primary-only, keeps view analytics honest)", async () => {
      const { shareToken } = seedSentCard()
      const res = await fetch(`${BASE_URL}/api/thank-you/${shareToken}/opened`, { method: "POST" })
      assert.strictEqual(res.status, 404)
    })

    it("a reply via a share token 404s (primary-only), same as an unknown token", async () => {
      const { shareToken } = seedSentCard()
      const res = await postReply(shareToken, { emoji: "heart" })
      assert.strictEqual(res.status, 404)
    })
  })

  describe("POST /api/thank-you/:token/reply", () => {
    it("404s on an unknown token", async () => {
      const res = await postReply("ZZZZZZZZ", { emoji: "heart" })
      assert.strictEqual(res.status, 404)
    })

    it("404s on a draft (not-yet-sent) card token", async () => {
      const { token } = seedDraftCard()
      const res = await postReply(token, { emoji: "heart" })
      assert.strictEqual(res.status, 404)
    })

    it("valid emoji only → 200", async () => {
      const { token } = seedSentCard()
      const res = await postReply(token, { emoji: "🥂" })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.success, true)
      assert.strictEqual(res.data.reply.emoji, "🥂")
      assert.strictEqual(res.data.reply.message, null)
      assert.ok(res.data.reply.replied_at)
    })

    it("message only → 200", async () => {
      const { token } = seedSentCard()
      const res = await postReply(token, { message: "So sweet of you!" })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.reply.emoji, null)
      assert.strictEqual(res.data.reply.message, "So sweet of you!")
    })

    it("both emoji and message → 200", async () => {
      const { token } = seedSentCard()
      const res = await postReply(token, { emoji: "🔥", message: "Loved it" })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.reply.emoji, "🔥")
      assert.strictEqual(res.data.reply.message, "Loved it")
    })

    it("invalid emoji → 400", async () => {
      const { token } = seedSentCard()
      const res = await postReply(token, { emoji: "banana" })
      assert.strictEqual(res.status, 400)
    })

    it("any single emoji → 200, stored as the glyph (issue #8)", async () => {
      const { token } = seedSentCard()
      const res = await postReply(token, { emoji: "👨‍👩‍👧" })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.reply.emoji, "👨‍👩‍👧")
    })

    it("a legacy reaction key (a cached page) maps to its glyph", async () => {
      const { token } = seedSentCard()
      const res = await postReply(token, { emoji: "heart_eyes" })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.reply.emoji, "😍")
    })

    it("two emoji, emoji + text, or a lone modifier → 400", async () => {
      for (const emoji of ["😀😀", "hi 😀", "🏽", 5]) {
        const { token } = seedSentCard()
        const res = await postReply(token, { emoji })
        assert.strictEqual(res.status, 400, JSON.stringify(emoji))
      }
    })

    it("over-length message → 400", async () => {
      const { token } = seedSentCard()
      const tooLong = "x".repeat(501) // LIMITS.THANK_YOU_REPLY_MAX_LENGTH is 500
      const res = await postReply(token, { message: tooLong })
      assert.strictEqual(res.status, 400)
    })

    it("neither emoji nor message → 400", async () => {
      const { token } = seedSentCard()
      const res = await postReply(token, {})
      assert.strictEqual(res.status, 400)
    })

    it("a non-object JSON body (array or string) → 400", async () => {
      // Body-shape guard: a JSON array or bare string must be a clean 400, not a
      // 500 from reading `.emoji` off a non-object.
      const { token } = seedSentCard()
      const arr = await fetch(`${BASE_URL}/api/thank-you/${token}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(["not", "an", "object"]),
      })
      assert.strictEqual(arr.status, 400)

      const str = await fetch(`${BASE_URL}/api/thank-you/${token}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("just a string"),
      })
      assert.strictEqual(str.status, 400)
    })

    it("upsert: a second reply replaces the first", async () => {
      const { token } = seedSentCard()
      const first = await postReply(token, { emoji: "heart", message: "First!" })
      assert.strictEqual(first.status, 200)

      const second = await postReply(token, { emoji: "laugh", message: "Actually, this!" })
      assert.strictEqual(second.status, 200)
      assert.strictEqual(second.data.reply.emoji, "😂")
      assert.strictEqual(second.data.reply.message, "Actually, this!")

      // GET reflects the latest reply, not the first.
      const fetched = await getCard(token)
      assert.strictEqual(fetched.data.reply.emoji, "😂")
      assert.strictEqual(fetched.data.reply.message, "Actually, this!")
    })

    it("a reply on an already-opened card still succeeds", async () => {
      const { token } = seedSentCard()
      // Open the envelope via the beacon (GET no longer mutates), flipping the
      // card to 'viewed'; a reply on a viewed card must still work.
      await fetch(`${BASE_URL}/api/thank-you/${token}/opened`, { method: "POST" })
      const res = await postReply(token, { emoji: "clap" })
      assert.strictEqual(res.status, 200)
    })
  })

  describe("GET /api/thank-you/mine", () => {
    it("returns an empty list when signed out", async () => {
      const res = await fetch(`${BASE_URL}/api/thank-you/mine`)
      assert.strictEqual(res.status, 200)
      const data = /** @type {any} */ (await res.json())
      assert.deepStrictEqual(data.cards, [])
    })

    it("returns an empty list for a signed-in account with no linked guest", async () => {
      const account = createTestAccount(db, { name: "No Guest Link" })
      const session = createTestAccountSession(db, Number(account.id))
      const res = await accountFetch(
        "/api/thank-you/mine",
        { method: "GET" },
        { cookieHeader: session.cookieHeader, csrfToken: session.csrfToken },
      )
      assert.strictEqual(res.status, 200)
      const data = /** @type {any} */ (await res.json())
      assert.deepStrictEqual(data.cards, [])
    })

    it("returns the guest's sent/viewed cards for a signed-in account linked to that guest", async () => {
      const { guest, token } = seedSentCard()
      const account = createTestAccount(db, { name: guest.name, guest_id: Number(guest.id) })
      const session = createTestAccountSession(db, Number(account.id))

      const res = await accountFetch(
        "/api/thank-you/mine",
        { method: "GET" },
        { cookieHeader: session.cookieHeader, csrfToken: session.csrfToken },
      )
      assert.strictEqual(res.status, 200)
      const data = /** @type {any} */ (await res.json())
      assert.strictEqual(data.cards.length, 1)
      assert.strictEqual(data.cards[0].token, token)
      assert.ok(data.cards[0].sent_at)
    })

    it("never includes a draft card (only sent/viewed)", async () => {
      const { guest } = seedDraftCard()
      const account = createTestAccount(db, { name: guest.name, guest_id: Number(guest.id) })
      const session = createTestAccountSession(db, Number(account.id))

      const res = await accountFetch(
        "/api/thank-you/mine",
        { method: "GET" },
        { cookieHeader: session.cookieHeader, csrfToken: session.csrfToken },
      )
      const data = /** @type {any} */ (await res.json())
      assert.deepStrictEqual(data.cards, [])
    })
  })

  describe("rate limiting", () => {
    it("the reply limiter eventually 429s a single token hammered from one IP", async () => {
      const { token } = seedSentCard()
      const statuses = []
      // THANK_YOU_REPLY is 10/hour per IP; 11 calls should trip it. Alternate
      // valid/invalid bodies is unnecessary — even a validation 400 counts
      // against the limiter since checkRateLimit runs before body validation.
      for (let i = 0; i < 11; i++) {
        const res = await postReply(token, { emoji: "heart" })
        statuses.push(res.status)
      }
      assert.ok(statuses.slice(0, 10).every((s) => s === 200), "first 10 succeed")
      assert.strictEqual(statuses[10], 429, "11th trips the limiter")
    })

    it("the per-token reply limiter 429s even when each hit comes from a fresh IP", async () => {
      // Reply integrity (D4): the reply endpoint rate-limits per TOKEN
      // (`tyreply:<token>`) as well as per IP, so a single card can't be griefed
      // from rotating IPs. Each request here carries a distinct X-Forwarded-For
      // (localhost is a TRUSTED_PROXY in tests), so the per-IP bucket never
      // trips — only the shared per-token bucket (10/hour) does.
      const { token } = seedSentCard()
      const statuses = []
      for (let i = 0; i < 11; i++) {
        const res = await fetch(`${BASE_URL}/api/thank-you/${token}/reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": `203.0.113.${i + 1}`,
          },
          body: JSON.stringify({ emoji: "heart" }),
        })
        statuses.push(res.status)
      }
      assert.ok(statuses.slice(0, 10).every((s) => s === 200), "first 10 (distinct IPs) succeed")
      assert.strictEqual(statuses[10], 429, "11th trips the per-token limiter despite a new IP")
    })
  })

  describe("Admin API (Phase 5/6)", () => {
    /** Create a guest + a gift for them via the admin API. */
    async function createGuestAndGift(overrides = {}) {
      const guest = createTestGuest(db)
      const res = await asAdmin("/api/admin/gifts", {
        method: "POST",
        body: JSON.stringify({
          guest_id: Number(guest.id),
          description: "A blender",
          amount: "$100",
          ...overrides,
        }),
      })
      const data = await json(res)
      return { guest, res, gift: data.gift }
    }

    /** Create a guest + a draft card for them via the admin API. */
    async function createGuestAndDraftCard(overrides = {}) {
      const guest = createTestGuest(db)
      const res = await asAdmin("/api/admin/thank-you", {
        method: "POST",
        body: JSON.stringify({
          guest_id: Number(guest.id),
          message: "Thank you so much!",
          theme: "classic",
          ...overrides,
        }),
      })
      const data = await json(res)
      return { guest, res, card: data.card }
    }

    describe("authentication", () => {
      it("401s every gift/card/delivery endpoint without a session", async () => {
        const attempts = [
          fetch(`${BASE_URL}/api/admin/gifts`),
          fetch(`${BASE_URL}/api/admin/gifts`, { method: "POST", body: "{}" }),
          fetch(`${BASE_URL}/api/admin/thank-you`),
          fetch(`${BASE_URL}/api/admin/thank-you`, { method: "POST", body: "{}" }),
          fetch(`${BASE_URL}/api/admin/thank-you/counts`),
          fetch(`${BASE_URL}/api/admin/thank-you/config`),
          fetch(`${BASE_URL}/api/admin/thank-you/send`, { method: "POST", body: "{}" }),
          fetch(`${BASE_URL}/api/admin/thank-you/1/mark-sent`, { method: "POST", body: "{}" }),
        ]
        const results = await Promise.all(attempts)
        for (const res of results) {
          assert.strictEqual(res.status, 401)
        }
      })
    })

    describe("gifts CRUD", () => {
      it("creates, lists, updates, and soft-deletes a gift", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { res: createRes, gift } = await createGuestAndGift()
        assert.strictEqual(createRes.status, 201)
        assert.strictEqual(gift.description, "A blender")
        assert.strictEqual(gift.amount, "$100")

        const listRes = await asAdmin("/api/admin/gifts")
        const listData = await json(listRes)
        assert.strictEqual(listRes.status, 200)
        assert.ok(listData.gifts.some((/** @type {any} */ g) => g.id === gift.id))
        // Never sums/omits amount — it's an admin-only field, present as-is here.
        assert.strictEqual(
          listData.gifts.find((/** @type {any} */ g) => g.id === gift.id).amount,
          "$100",
        )

        const updateRes = await asAdmin(`/api/admin/gifts/${gift.id}`, {
          method: "PUT",
          body: JSON.stringify({ amount: "$150", notes: "Very generous" }),
        })
        const updateData = await json(updateRes)
        assert.strictEqual(updateRes.status, 200)
        assert.strictEqual(updateData.gift.amount, "$150")
        assert.strictEqual(updateData.gift.notes, "Very generous")

        const deleteRes = await asAdmin(`/api/admin/gifts/${gift.id}`, { method: "DELETE" })
        assert.strictEqual(deleteRes.status, 200)

        const afterDelete = await json(await asAdmin("/api/admin/gifts"))
        assert.ok(!afterDelete.gifts.some((/** @type {any} */ g) => g.id === gift.id))
      })

      it("404s creating a gift for an unknown guest", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const res = await asAdmin("/api/admin/gifts", {
          method: "POST",
          body: JSON.stringify({ guest_id: 99999999 }),
        })
        assert.strictEqual(res.status, 404)
      })

      it("toggles the physical-card-sent flag", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { gift } = await createGuestAndGift()

        const onRes = await asAdmin(`/api/admin/gifts/${gift.id}/physical-card`, {
          method: "POST",
          body: JSON.stringify({ sent: true }),
        })
        const onData = await json(onRes)
        assert.strictEqual(onRes.status, 200)
        assert.strictEqual(onData.gift.physical_card_sent, 1)
        assert.ok(onData.gift.physical_card_sent_at)

        const offRes = await asAdmin(`/api/admin/gifts/${gift.id}/physical-card`, {
          method: "POST",
          body: JSON.stringify({ sent: false }),
        })
        const offData = await json(offRes)
        assert.strictEqual(offRes.status, 200)
        assert.strictEqual(offData.gift.physical_card_sent, 0)
        assert.strictEqual(offData.gift.physical_card_sent_at, null)
      })

      it("400s a gift update carrying no recognized fields", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { gift } = await createGuestAndGift()
        const res = await asAdmin(`/api/admin/gifts/${gift.id}`, {
          method: "PUT",
          body: JSON.stringify({ not_a_field: "ignored" }),
        })
        assert.strictEqual(res.status, 400)
      })
    })

    describe("card creation validation", () => {
      it("creates a draft card for a valid guest", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { res, card, guest } = await createGuestAndDraftCard()
        assert.strictEqual(res.status, 201)
        assert.strictEqual(card.status, "draft")
        assert.strictEqual(card.guest_id, Number(guest.id))
        assert.ok(card.token)
      })

      it("404s for an unknown guest", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const res = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({ guest_id: 99999999, message: "Thanks!" }),
        })
        assert.strictEqual(res.status, 404)
      })

      it("400s a card with a missing or empty message", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = createTestGuest(db)
        const missing = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({ guest_id: Number(guest.id), theme: "classic" }),
        })
        assert.strictEqual(missing.status, 400)

        const blank = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({ guest_id: Number(guest.id), message: "   ", theme: "classic" }),
        })
        assert.strictEqual(blank.status, 400)
      })

      it("400s a card whose gift_id belongs to a different guest", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        // seedGift() makes a gift owned by its own fresh guest; linking it to a
        // DIFFERENT guest's card must be rejected (the amount is admin-only and
        // cross-guest links would misattribute it).
        const gift = seedGift()
        const otherGuest = createTestGuest(db)
        const res = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({
            guest_id: Number(otherGuest.id),
            message: "Thanks!",
            gift_id: gift.id,
          }),
        })
        assert.strictEqual(res.status, 400)

        // ...and it succeeds when the gift belongs to the card's own guest.
        const ok = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({
            guest_id: gift.guest_id,
            message: "Thanks!",
            gift_id: gift.id,
          }),
        })
        assert.strictEqual(ok.status, 201)
      })

      it("rejects an invalid theme", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = createTestGuest(db)
        const res = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({
            guest_id: Number(guest.id),
            message: "Thanks!",
            theme: "not-a-real-theme",
          }),
        })
        assert.strictEqual(res.status, 400)
      })

      it("rejects an oversized effects_config", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = createTestGuest(db)
        const res = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({
            guest_id: Number(guest.id),
            message: "Thanks!",
            // LIMITS.THANK_YOU_EFFECTS_CONFIG_MAX_BYTES is 16384.
            effects_config: { blob: "x".repeat(20000) },
          }),
        })
        assert.strictEqual(res.status, 400)
      })

      it("rejects more than 12 media_keys", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = createTestGuest(db)
        const tooMany = Array.from({ length: 13 }, (_, i) => `key${i}`)
        const res = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({
            guest_id: Number(guest.id),
            message: "Thanks!",
            media_keys: tooMany,
          }),
        })
        assert.strictEqual(res.status, 400)
      })

      it("rejects an unknown/unapproved media key", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = createTestGuest(db)
        const pendingKey = seedMediaRow({ status: "pending" })

        const unknownRes = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({
            guest_id: Number(guest.id),
            message: "Thanks!",
            media_keys: ["doesnotexist00"],
          }),
        })
        assert.strictEqual(unknownRes.status, 400)

        const pendingRes = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({
            guest_id: Number(guest.id),
            message: "Thanks!",
            media_keys: [pendingKey],
          }),
        })
        assert.strictEqual(pendingRes.status, 400)
      })

      it("accepts an approved media key", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = createTestGuest(db)
        const approvedKey = seedMediaRow({ status: "approved" })
        const res = await asAdmin("/api/admin/thank-you", {
          method: "POST",
          body: JSON.stringify({
            guest_id: Number(guest.id),
            message: "Thanks!",
            media_keys: [approvedKey],
          }),
        })
        const data = await json(res)
        assert.strictEqual(res.status, 201)
        assert.deepStrictEqual(JSON.parse(data.card.media_keys), [approvedKey])
      })
    })

    describe("draft-only edit/send enforcement", () => {
      it("allows editing a draft card, then 409s once it's sent", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()

        const editRes = await asAdmin(`/api/admin/thank-you/${card.id}`, {
          method: "PUT",
          body: JSON.stringify({ message: "Updated message!" }),
        })
        const editData = await json(editRes)
        assert.strictEqual(editRes.status, 200)
        assert.strictEqual(editData.card.message, "Updated message!")

        const sentRes = await asAdmin(`/api/admin/thank-you/${card.id}/mark-sent`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        assert.strictEqual(sentRes.status, 200)

        const conflictRes = await asAdmin(`/api/admin/thank-you/${card.id}`, {
          method: "PUT",
          body: JSON.stringify({ message: "Too late!" }),
        })
        assert.strictEqual(conflictRes.status, 409)
      })

      it("409s sending a card that's already sent", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        markCardSent(card.id, "manual")

        const res = await asAdmin("/api/admin/thank-you/send", {
          method: "POST",
          body: JSON.stringify({ cardId: card.id, type: "email" }),
        })
        assert.strictEqual(res.status, 409)
      })

      it("soft-deletes a card regardless of status", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        const res = await asAdmin(`/api/admin/thank-you/${card.id}`, { method: "DELETE" })
        assert.strictEqual(res.status, 200)

        const getRes = await asAdmin(`/api/admin/thank-you/${card.id}`)
        assert.strictEqual(getRes.status, 404)
      })
    })

    describe("counts + reply-seen", () => {
      it("counts reflects drafts, and reply-seen clears the unread count", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        await createGuestAndDraftCard()
        await createGuestAndDraftCard()

        const before = await json(await asAdmin("/api/admin/thank-you/counts"))
        assert.strictEqual(before.drafts, 2)
        assert.strictEqual(before.unreadReplies, 0)

        const { card } = await createGuestAndDraftCard()
        markCardSent(card.id, "manual")

        // Recipient replies via the public token-authed endpoint (token IS
        // the auth there — no admin session involved).
        await postReply(card.token, { emoji: "heart", message: "Love it!" })

        const afterReply = await json(await asAdmin("/api/admin/thank-you/counts"))
        assert.strictEqual(afterReply.unreadReplies, 1)

        const seenRes = await asAdmin(`/api/admin/thank-you/${card.id}/reply-seen`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        assert.strictEqual(seenRes.status, 200)

        const afterSeen = await json(await asAdmin("/api/admin/thank-you/counts"))
        assert.strictEqual(afterSeen.unreadReplies, 0)
      })
    })

    describe("delivery", () => {
      it("GET config reports channel availability + default templates", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const res = await asAdmin("/api/admin/thank-you/config")
        const data = await json(res)
        assert.strictEqual(res.status, 200)
        assert.strictEqual(typeof data.email.configured, "boolean")
        assert.strictEqual(typeof data.sms.configured, "boolean")
        // Called with literal "{name}"/"{url}" placeholders (config() passes
        // them through as-is) so the composer can show the raw token template.
        assert.ok(data.email.defaultMessage.includes("{url}"))
        assert.ok(data.sms.defaultMessage.includes("{url}"))
      })

      it("send 400s cleanly when the channel service isn't configured (test env has no RESEND/Twilio number)", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()

        const res = await asAdmin("/api/admin/thank-you/send", {
          method: "POST",
          body: JSON.stringify({ cardId: card.id, type: "email" }),
        })
        const data = await json(res)
        assert.strictEqual(res.status, 400)
        assert.ok(String(data.error).toLowerCase().includes("not configured"))

        // The card must still be in draft — a failed/unconfigured send is not
        // a partial send.
        const getRes = await json(await asAdmin(`/api/admin/thank-you/${card.id}`))
        assert.strictEqual(getRes.card.status, "draft")
      })

      it("preview 400s cleanly when the channel service isn't configured", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        const res = await asAdmin("/api/admin/thank-you/preview", {
          method: "POST",
          body: JSON.stringify({ cardId: card.id, type: "sms" }),
        })
        assert.strictEqual(res.status, 400)
      })

      it("marks a card sent via the manual copy-paste path", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        const res = await asAdmin(`/api/admin/thank-you/${card.id}/mark-sent`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        const data = await json(res)
        assert.strictEqual(res.status, 200)
        assert.strictEqual(data.card.status, "sent")
        assert.strictEqual(data.card.sent_via, "manual")

        const again = await asAdmin(`/api/admin/thank-you/${card.id}/mark-sent`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        assert.strictEqual(again.status, 409)
      })

      it("marks a card sent via the 'copy link' path", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        const res = await asAdmin(`/api/admin/thank-you/${card.id}/mark-sent`, {
          method: "POST",
          body: JSON.stringify({ via: "link" }),
        })
        const data = await json(res)
        assert.strictEqual(res.status, 200)
        assert.strictEqual(data.card.sent_via, "link")
      })
    })

    /** Mark a draft card sent via the admin endpoint and return its live token.
     *  @param {number} cardId @param {string} [via] */
    async function markSentViaAdmin(cardId, via = "manual") {
      const res = await asAdmin(`/api/admin/thank-you/${cardId}/mark-sent`, {
        method: "POST",
        body: JSON.stringify(via === "link" ? { via } : {}),
      })
      assert.strictEqual(res.status, 200, "mark-sent should succeed on a fresh draft")
      return (await json(res)).card
    }

    /** Fire the public envelope-open beacon for a delivered card. @param {string} token */
    async function openBeacon(token) {
      const res = await fetch(`${BASE_URL}/api/thank-you/${token}/opened`, { method: "POST" })
      assert.strictEqual(res.status, 200, "beacon should 200 on a delivered card")
      return json(res)
    }

    describe("photos they're in (GET /api/admin/guests/:id/photos)", () => {
      /** Raw media row (no upload API to go through). @param {string} status @param {string} [section] */
      function seedMedia(status, section = "guest") {
        const fileKey = crypto.randomBytes(16).toString("hex")
        const r = db
          .prepare(
            `INSERT INTO media (file_key, account_id, kind, section, status) VALUES (?, NULL, 'image', ?, ?)`,
          )
          .run(fileKey, section, status)
        return { id: Number(r.lastInsertRowid), fileKey }
      }

      /** A detected face on a media row, assigned through the ledger (the only
       *  writer of media_faces.face_identity_id). @param {number} mediaId @param {number} identityId */
      function assignedFace(mediaId, identityId) {
        const face = insertFace({
          mediaId,
          bbox: { x: 1, y: 1, w: 10, h: 10 },
          landmarks: null,
          signals: null,
          descriptor: null,
          modelVersion: "ty-test",
          source: "cli",
        })
        recordAssignment({ faceId: face.id, op: "assign", identityId, actor: "test" })
        return face.id
      }

      it("lists approved media with a live face of a person linked to the guest, and nothing else", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = createTestGuest(db)
        const other = createTestGuest(db)
        const person = createTestPerson(db, { guest_id: Number(guest.id) })
        const otherPerson = createTestPerson(db, { guest_id: Number(other.id) })
        const offRoster = createTestPerson(db)
        const identity = createIdentity({ personId: person.id })
        const otherIdentity = createIdentity({ personId: otherPerson.id })
        const offRosterIdentity = createIdentity({ personId: offRoster.id })
        try {
          const inOfficial = seedMedia("approved", "official")
          const inGuest = seedMedia("approved")
          const pending = seedMedia("pending")
          const deletedMedia = seedMedia("approved")
          const deletedFace = seedMedia("approved")
          const someoneElse = seedMedia("approved")
          const unassigned = seedMedia("approved")
          const content = seedMedia("approved", "content")

          assignedFace(inOfficial.id, identity.id)
          assignedFace(inGuest.id, identity.id)
          assignedFace(inGuest.id, otherIdentity.id) // a group photo still counts
          assignedFace(pending.id, identity.id)
          assignedFace(deletedMedia.id, identity.id)
          db.prepare(`UPDATE media SET deleted_at = datetime('now') WHERE id = ?`).run(deletedMedia.id)
          softDeleteFace(assignedFace(deletedFace.id, identity.id))
          assignedFace(someoneElse.id, otherIdentity.id)
          assignedFace(unassigned.id, offRosterIdentity.id)
          assignedFace(content.id, identity.id)

          const res = await asAdmin(`/api/admin/guests/${guest.id}/photos`)
          assert.strictEqual(res.status, 200)
          const data = await json(res)
          const keys = data.items.map((/** @type {any} */ i) => i.file_key).sort()
          assert.deepStrictEqual(keys, [inOfficial.fileKey, inGuest.fileKey].sort())
          const item = data.items.find((/** @type {any} */ i) => i.file_key === inGuest.fileKey)
          assert.strictEqual(item.kind, "image")
          assert.strictEqual(item.section, "guest")
          assert.strictEqual(item.faces, 1)
          assert.strictEqual(typeof item.needs_display, "boolean")
        } finally {
          db.prepare(`DELETE FROM media`).run()
          db.prepare(`DELETE FROM face_identities WHERE id IN (?, ?, ?)`).run(
            identity.id,
            otherIdentity.id,
            offRosterIdentity.id,
          )
          db.prepare(`DELETE FROM people WHERE id IN (?, ?, ?)`).run(
            person.id,
            otherPerson.id,
            offRoster.id,
          )
        }
      })

      it("follows a merged identity to its survivor, and drops a retired person", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = createTestGuest(db)
        const person = createTestPerson(db, { guest_id: Number(guest.id) })
        const survivor = createIdentity({ personId: person.id })
        // A second person's identity, assigned first and then folded into the
        // guest's: its faces now belong to the survivor without being re-pointed.
        const stray = createTestPerson(db)
        const folded = createIdentity({ personId: stray.id })
        try {
          const merged = seedMedia("approved")
          assignedFace(merged.id, folded.id)
          assert.ok(mergeIdentityInto(folded.id, survivor.id), "merge succeeds")

          let data = await json(await asAdmin(`/api/admin/guests/${guest.id}/photos`))
          assert.deepStrictEqual(
            data.items.map((/** @type {any} */ i) => i.file_key),
            [merged.fileKey],
          )

          db.prepare(`UPDATE people SET deleted_at = datetime('now') WHERE id = ?`).run(person.id)
          data = await json(await asAdmin(`/api/admin/guests/${guest.id}/photos`))
          assert.deepStrictEqual(data.items, [])
        } finally {
          db.prepare(`DELETE FROM media`).run()
          db.prepare(`DELETE FROM face_identities WHERE id IN (?, ?)`).run(survivor.id, folded.id)
          db.prepare(`DELETE FROM people WHERE id IN (?, ?)`).run(person.id, stray.id)
        }
      })

      it("404s an unknown guest, 400s a bad id, 401s without a session", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")
        assert.strictEqual((await asAdmin(`/api/admin/guests/999999/photos`)).status, 404)
        assert.strictEqual((await asAdmin(`/api/admin/guests/abc/photos`)).status, 400)
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/guests/1/photos`)).status, 401)
      })
    })

    describe("card list carries the recipient's contact (batch send pre-picks channels)", () => {
      it("returns guest_email and guest_phone on every row", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")
        const { guest, card } = await createGuestAndDraftCard()
        const data = await json(await asAdmin("/api/admin/thank-you"))
        const row = data.cards.find((/** @type {any} */ c) => c.id === card.id)
        assert.strictEqual(row.guest_email, guest.email)
        assert.strictEqual(row.guest_phone, null)
      })
    })

    describe("infrastructure", () => {
      it("always has an admin session (self-provisioned when .env omits one)", () => {
        // Guard against the admin suite silently skipping: _thank-you-admin-env.js
        // mints a throwaway credential when TEST_ADMIN_PASSWORD is unset, so this
        // must always hold. If it ever fails, ~20 admin tests would have skipped.
        assert.ok(hasAdmin, "TEST_ADMIN_PASSWORD present")
        assert.ok(admin, "admin login succeeded in before()")
      })
    })

    describe("resend (reset vs duplicate)", () => {
      it("resets a sent-but-unopened card in place (mode reset, SAME token, sendable again)", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        const sent = await markSentViaAdmin(card.id)
        assert.strictEqual(sent.status, "sent")

        const res = await asAdmin(`/api/admin/thank-you/${card.id}/resend`, { method: "POST" })
        const data = await json(res)
        assert.strictEqual(res.status, 200)
        assert.strictEqual(data.mode, "reset")
        assert.strictEqual(data.card.token, card.token, "reset keeps the same token")
        assert.strictEqual(data.card.status, "draft", "card is a draft again")
        assert.strictEqual(data.card.sent_at, null)

        // The same token link keeps working once it's re-sent.
        const resent = await markSentViaAdmin(card.id)
        assert.strictEqual(resent.status, "sent")
        assert.strictEqual(resent.token, card.token)
      })

      it("duplicates an opened card to a NEW token, leaving the original intact", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        await markSentViaAdmin(card.id)
        // Open the envelope + reply so the "original untouched" assertion has teeth.
        await openBeacon(card.token)
        await postReply(card.token, { emoji: "heart", message: "thank you!" })

        const res = await asAdmin(`/api/admin/thank-you/${card.id}/resend`, { method: "POST" })
        const data = await json(res)
        assert.strictEqual(res.status, 200)
        assert.strictEqual(data.mode, "duplicate")
        assert.notStrictEqual(data.card.token, card.token, "duplicate gets a fresh token")
        assert.strictEqual(data.card.status, "draft", "the clone starts as a draft")

        // Original is completely untouched: still viewed, reply + viewed_at intact.
        const original = (await json(await asAdmin(`/api/admin/thank-you/${card.id}`))).card
        assert.strictEqual(original.status, "viewed")
        assert.ok(original.viewed_at, "original keeps its viewed_at")
        assert.strictEqual(original.reply_emoji, "❤️", "original keeps its reply")
      })

      it("409s resending a draft (never delivered)", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        const res = await asAdmin(`/api/admin/thank-you/${card.id}/resend`, { method: "POST" })
        assert.strictEqual(res.status, 409)
      })

      it("duplicates (not resets) a replied-but-unopened card, preserving the reply with no phantom unread", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        // Stale-reply regression: a reply can arrive with viewed_at still NULL
        // when the open beacon is blocked. The old resend logic branched only on
        // viewed_at, so it RESET the replied card to a draft — stranding a stale
        // reply that counted as unread forever and pre-filled on re-send. The fix
        // gates the reset on replied_at too, so any replied card takes the
        // duplicate path (fresh draft; original + reply kept intact).
        const { card } = await createGuestAndDraftCard()
        await markSentViaAdmin(card.id)
        // Reply WITHOUT ever firing the open beacon — viewed_at stays NULL.
        await postReply(card.token, { emoji: "heart", message: "thank you!" })

        const before = await json(await asAdmin("/api/admin/thank-you/counts"))
        assert.strictEqual(before.unreadReplies, 1, "the original reply is unread")

        const res = await asAdmin(`/api/admin/thank-you/${card.id}/resend`, { method: "POST" })
        const data = await json(res)
        assert.strictEqual(res.status, 200)
        assert.strictEqual(data.mode, "duplicate", "a replied card duplicates even with viewed_at NULL")
        assert.notStrictEqual(data.card.id, card.id, "the clone is a new card")
        assert.notStrictEqual(data.card.token, card.token, "the clone gets a fresh token")
        assert.strictEqual(data.card.status, "draft", "the clone starts as a draft")

        // Original is completely intact: still 'sent' (not rewound), reply kept.
        const original = (await json(await asAdmin(`/api/admin/thank-you/${card.id}`))).card
        assert.strictEqual(original.status, "sent", "original stays sent — never rewound to draft")
        assert.strictEqual(original.reply_emoji, "❤️", "original keeps its reply emoji")
        assert.strictEqual(original.reply_message, "thank you!", "original keeps its reply message")

        // The count reflects ONLY the original — the fresh draft clone must not
        // add a phantom unread.
        const afterResend = await json(await asAdmin("/api/admin/thank-you/counts"))
        assert.strictEqual(afterResend.unreadReplies, 1, "only the original is unread; the clone adds no phantom")

        // Marking the original seen clears the count to zero — proving no phantom
        // (e.g. from a draft carrying a stale replied_at) lingers.
        await asAdmin(`/api/admin/thank-you/${card.id}/reply-seen`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        const afterSeen = await json(await asAdmin("/api/admin/thank-you/counts"))
        assert.strictEqual(afterSeen.unreadReplies, 0, "no phantom unread remains after the original is seen")
      })
    })

    describe("reply history + integrity", () => {
      it("keeps an ascending reply thread; latest columns mirror exactly the newest reply", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        await markSentViaAdmin(card.id)

        await postReply(card.token, { emoji: "heart", message: "First reply!" })
        // Second reply is emoji-only → it must CLEAR reply_message on the card
        // (latest columns reflect exactly the newest reply, no silent merge).
        await postReply(card.token, { emoji: "cheers" })

        const detail = await json(await asAdmin(`/api/admin/thank-you/${card.id}`))
        assert.strictEqual(detail.replies.length, 2, "full thread has both replies")
        assert.strictEqual(detail.replies[0].emoji, "❤️", "oldest reply first")
        assert.strictEqual(detail.replies[0].message, "First reply!")
        assert.strictEqual(detail.replies[1].emoji, "🥂", "newest reply last")
        assert.strictEqual(detail.replies[1].message, null)

        // Latest-reply columns on the card == reply #2 exactly.
        assert.strictEqual(detail.card.reply_emoji, "🥂")
        assert.strictEqual(detail.card.reply_message, null, "emoji-only reply cleared the message")
        // Engagement counters ride along on the card object.
        assert.strictEqual(typeof detail.card.view_count, "number")
        assert.ok("last_viewed_at" in detail.card)
      })

      it("a new reply re-flags unread after the admin has marked it seen", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        await markSentViaAdmin(card.id)

        await postReply(card.token, { emoji: "heart" })
        assert.strictEqual((await json(await asAdmin("/api/admin/thank-you/counts"))).unreadReplies, 1)

        // Admin acknowledges the reply → unread clears, reply_seen_at stamped.
        await asAdmin(`/api/admin/thank-you/${card.id}/reply-seen`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        const seen = await json(await asAdmin(`/api/admin/thank-you/${card.id}`))
        assert.ok(seen.card.reply_seen_at, "reply_seen_at set after ack")
        assert.strictEqual((await json(await asAdmin("/api/admin/thank-you/counts"))).unreadReplies, 0)

        // A fresh reply re-surfaces as unread (reply_seen_at back to NULL).
        await postReply(card.token, { emoji: "fire", message: "one more thing!" })
        const again = await json(await asAdmin(`/api/admin/thank-you/${card.id}`))
        assert.strictEqual(again.card.reply_seen_at, null, "new reply clears reply_seen_at")
        assert.strictEqual((await json(await asAdmin("/api/admin/thank-you/counts"))).unreadReplies, 1)
      })

      it("400s a contentless reply (no emoji, no message)", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        await markSentViaAdmin(card.id)
        const res = await postReply(card.token, {})
        assert.strictEqual(res.status, 400)
      })
    })

    describe("double-send guard (sequential)", () => {
      it("claims the card on the first mark-sent; a second delivery attempt 409s", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        // Races can't be tested deterministically, but the claim-first mutex is
        // observable sequentially: once a card is claimed (sent), neither a
        // repeat mark-sent nor a /send can re-deliver it.
        const { card } = await createGuestAndDraftCard()
        await markSentViaAdmin(card.id)

        const secondMark = await asAdmin(`/api/admin/thank-you/${card.id}/mark-sent`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        assert.strictEqual(secondMark.status, 409, "re-marking a claimed card 409s")

        const send = await asAdmin("/api/admin/thank-you/send", {
          method: "POST",
          body: JSON.stringify({ cardId: card.id, type: "email" }),
        })
        assert.strictEqual(send.status, 409, "/send on a claimed card 409s before any provider call")
      })
    })

    describe("send-failure compensation (A2)", () => {
      /** A dedicated server whose email provider is CONFIGURED (RESEND_API_KEY set)
       *  but deterministically FAILS every outbound call (SERVICE_FORCE_FAILURE) —
       *  no network touched. It shares this suite's DB, so the admin cookie stays
       *  valid; kept separate so the main suite's "provider not configured" tests
       *  are unaffected. Its own high port avoids colliding with the suite server.
       *  @type {{ baseUrl: string, stop: () => Promise<void> } | null} */
      let aux = null

      before(async () => {
        aux = await startAuxServer(
          {
            RESEND_API_KEY: "test-forced-fail-key",
            FROM_EMAIL: "couple@example.com",
            SERVICE_FORCE_FAILURE: "1",
          },
          TEST_PORT + 500,
        )
      })

      after(async () => {
        if (aux) await aux.stop()
        aux = null
      })

      it("rolls a failed send back to draft and logs a failed communication", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")
        const auth = admin
        if (!auth || !aux) return t.skip("admin/aux server unavailable")

        // A fresh draft card for a guest who has an email (createTestGuest seeds one).
        const guest = createTestGuest(db)
        const card = createThankYouCard({
          guestId: Number(guest.id),
          giftId: null,
          message: "Thank you!",
          theme: "classic",
          effectsConfig: undefined,
          mediaKeys: undefined,
        })

        // Drive /send against the failing-provider server, reusing the admin cookie.
        const res = await fetch(`${aux.baseUrl}/api/admin/thank-you/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cookie": auth.cookieHeader,
            "X-CSRF-Token": auth.csrfToken,
          },
          body: JSON.stringify({ cardId: card.id, type: "email" }),
        })
        assert.strictEqual(res.status, 502, "a provider failure surfaces as 502 SEND_FAILED")

        // Compensation: the claim is undone — the card is a retryable draft again.
        const row = /** @type {any} */ (
          db
            .prepare("SELECT status, sent_at, sent_via FROM thank_you_cards WHERE id = ?")
            .get(card.id)
        )
        assert.strictEqual(row.status, "draft", "card reset to draft")
        assert.strictEqual(row.sent_at, null, "sent_at cleared")
        assert.strictEqual(row.sent_via, null, "sent_via cleared")

        // And the failed attempt was recorded in the communications ledger.
        const comm = /** @type {any} */ (
          db
            .prepare(
              "SELECT type, status FROM communications WHERE guest_id = ? ORDER BY id DESC LIMIT 1",
            )
            .get(Number(guest.id))
        )
        assert.ok(comm, "a communication row was written")
        assert.strictEqual(comm.status, "failed")
        assert.strictEqual(comm.type, "email")
      })
    })

    describe("clear-reply lever", () => {
      it("clears the reply surface, retains history, and logs THANK_YOU_REPLY_CLEAR", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        await markSentViaAdmin(card.id)
        await postReply(card.token, { emoji: "heart", message: "Thank you!" })

        // Precondition: the reply surfaces (unread + latest columns set).
        const before = await json(await asAdmin(`/api/admin/thank-you/${card.id}`))
        assert.strictEqual(before.card.reply_emoji, "❤️")
        assert.strictEqual(before.replies.length, 1)
        assert.strictEqual(
          (await json(await asAdmin("/api/admin/thank-you/counts"))).unreadReplies,
          1,
        )

        const res = await asAdmin(`/api/admin/thank-you/cards/${card.id}/clear-reply`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        const data = await json(res)
        assert.strictEqual(res.status, 200)
        assert.strictEqual(data.success, true)
        // Surface columns wiped on the returned card.
        assert.strictEqual(data.card.reply_emoji, null)
        assert.strictEqual(data.card.reply_message, null)
        assert.strictEqual(data.card.replied_at, null)
        assert.strictEqual(data.card.reply_seen_at, null)

        // The append-only history rows are RETAINED (removable from view, kept).
        const after = await json(await asAdmin(`/api/admin/thank-you/${card.id}`))
        assert.strictEqual(after.replies.length, 1, "reply history row is retained")
        assert.strictEqual(after.replies[0].emoji, "❤️")

        // Dropped off the unread badge.
        assert.strictEqual(
          (await json(await asAdmin("/api/admin/thank-you/counts"))).unreadReplies,
          0,
        )

        // Audit entry recorded (the log flushes async).
        let logged = false
        for (let i = 0; i < 40 && !logged; i++) {
          logged = readAuditLog().some(
            (e) => e.action === "THANK_YOU_REPLY_CLEAR" && e.resourceId === card.id,
          )
          if (!logged) await new Promise((r) => setTimeout(r, 25))
        }
        assert.ok(logged, "THANK_YOU_REPLY_CLEAR logged")
      })

      it("retains the FULL reply history after a clear (two replies → both rows kept)", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        await markSentViaAdmin(card.id)
        await postReply(card.token, { emoji: "heart", message: "First!" })
        await postReply(card.token, { emoji: "cheers", message: "Second!" })

        // Both replies live in the append-only history before the clear.
        const before = await json(await asAdmin(`/api/admin/thank-you/${card.id}`))
        assert.strictEqual(before.replies.length, 2)

        const res = await asAdmin(`/api/admin/thank-you/cards/${card.id}/clear-reply`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        assert.strictEqual(res.status, 200)

        // Surface columns wiped, but thank_you_card_replies STILL holds both rows
        // (clearCardReply is surface-only — history is a keepsake, never deleted).
        const after = await json(await asAdmin(`/api/admin/thank-you/${card.id}`))
        assert.strictEqual(after.card.reply_emoji, null, "surface wiped")
        assert.strictEqual(after.replies.length, 2, "both history rows retained")
        // Assert directly against the table too, not just the API projection.
        const rows = /** @type {any} */ (
          db
            .prepare("SELECT COUNT(*) AS n FROM thank_you_card_replies WHERE card_id = ?")
            .get(card.id)
        )
        assert.strictEqual(rows.n, 2)
      })

      it("404s clearing a reply on an unknown card", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")
        const res = await asAdmin(`/api/admin/thank-you/cards/99999999/clear-reply`, {
          method: "POST",
          body: JSON.stringify({}),
        })
        assert.strictEqual(res.status, 404)
      })
    })

    describe("reply-ping config flag", () => {
      it("defaults off, and is settable via GET/POST /config", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        // Default OFF (cleanupTestData resets app_state between tests? — assert
        // the plumbing regardless by toggling explicitly below).
        const initial = await json(await asAdmin("/api/admin/thank-you/config"))
        assert.strictEqual(typeof initial.replyPingEnabled, "boolean")

        // Turn it on.
        const on = await asAdmin("/api/admin/thank-you/config", {
          method: "POST",
          body: JSON.stringify({ replyPingEnabled: true }),
        })
        const onData = await json(on)
        assert.strictEqual(on.status, 200)
        assert.strictEqual(onData.replyPingEnabled, true)
        assert.strictEqual(
          (await json(await asAdmin("/api/admin/thank-you/config"))).replyPingEnabled,
          true,
        )

        // Turn it back off.
        const off = await asAdmin("/api/admin/thank-you/config", {
          method: "POST",
          body: JSON.stringify({ replyPingEnabled: false }),
        })
        assert.strictEqual(off.status, 200)
        assert.strictEqual(
          (await json(await asAdmin("/api/admin/thank-you/config"))).replyPingEnabled,
          false,
        )
      })

      it("400s a non-boolean replyPingEnabled", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")
        const res = await asAdmin("/api/admin/thank-you/config", {
          method: "POST",
          body: JSON.stringify({ replyPingEnabled: "yes" }),
        })
        assert.strictEqual(res.status, 400)
      })

      it("a first reply with the ping ON still succeeds (fire-and-forget never blocks the guest)", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        await asAdmin("/api/admin/thank-you/config", {
          method: "POST",
          body: JSON.stringify({ replyPingEnabled: true }),
        })

        const { card } = await createGuestAndDraftCard()
        await markSentViaAdmin(card.id)
        // First reply — the ping guard fires (email is unconfigured in the test
        // env, so it no-ops), but the guest's reply must still 200.
        const first = await postReply(card.token, { emoji: "heart", message: "So kind!" })
        assert.strictEqual(first.status, 200)
        // A second reply is NOT a first reply — also 200, no re-ping.
        const second = await postReply(card.token, { emoji: "cheers" })
        assert.strictEqual(second.status, 200)

        // Reset the flag so it doesn't bleed into other tests.
        await asAdmin("/api/admin/thank-you/config", {
          method: "POST",
          body: JSON.stringify({ replyPingEnabled: false }),
        })
      })
    })

    describe("guest story sidecar", () => {
      it("returns the full story shape for a guest with an account, gift, card, guestbook + media", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = createTestGuest(db)
        const guestId = Number(guest.id)
        const account = createTestAccount(db, { name: guest.name, guest_id: guestId })
        const accountId = Number(account.id)

        // RSVP note.
        db.prepare(`INSERT INTO rsvps (guest_id, attending, message) VALUES (?, 1, ?)`).run(
          guestId,
          "Can't wait to celebrate!",
        )
        // Approved guestbook entry (hangs off the account).
        db.prepare(
          `INSERT INTO guestbook_entries (account_id, message, status) VALUES (?, ?, 'approved')`,
        ).run(accountId, "Beautiful wedding!")
        // Approved media (hangs off the account).
        const fileKey = crypto.randomBytes(16).toString("hex")
        db.prepare(
          `INSERT INTO media (file_key, account_id, kind, section, status) VALUES (?, ?, 'image', 'guest', 'approved')`,
        ).run(fileKey, accountId)
        // Gift + a sent card for the guest.
        const gift = createGiftDb({
          guestId,
          description: "A toaster",
          amount: "$40",
          notes: null,
          receivedAt: "2026-06-01",
        })
        const card = createThankYouCard({
          guestId,
          giftId: gift.id,
          message: "Thanks for the toaster!",
          theme: "classic",
          effectsConfig: undefined,
          mediaKeys: undefined,
        })
        markCardSent(card.id, "manual")

        const res = await asAdmin(`/api/admin/guests/${guestId}/story`)
        const data = await json(res)
        assert.strictEqual(res.status, 200)

        assert.deepStrictEqual(data.guest, { id: guestId, name: guest.name })
        assert.strictEqual(data.rsvpNote, "Can't wait to celebrate!")
        assert.ok(data.guestbookEntry)
        assert.strictEqual(data.guestbookEntry.message, "Beautiful wedding!")
        assert.ok(data.guestbookEntry.createdAt)
        assert.strictEqual(data.media.length, 1)
        assert.deepStrictEqual(data.media[0], { fileKey, kind: "image" })
        assert.strictEqual(data.gifts.length, 1)
        assert.strictEqual(data.gifts[0].id, gift.id)
        assert.strictEqual(data.gifts[0].amount, "$40")
        assert.strictEqual(data.gifts[0].physicalCardSent, false)
        assert.strictEqual(data.cards.length, 1)
        assert.strictEqual(data.cards[0].id, card.id)
        assert.strictEqual(data.cards[0].status, "sent")
        assert.strictEqual(data.cards[0].replySeen, false)
      })

      it("returns empty media + null guestbook for a guest with no account", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = createTestGuest(db)
        const guestId = Number(guest.id)
        const gift = createGiftDb({
          guestId,
          description: "Cash",
          amount: "$100",
          notes: null,
          receivedAt: null,
        })

        const res = await asAdmin(`/api/admin/guests/${guestId}/story`)
        const data = await json(res)
        assert.strictEqual(res.status, 200)
        assert.strictEqual(data.rsvpNote, null)
        assert.strictEqual(data.guestbookEntry, null, "no account → no guestbook entry")
        assert.deepStrictEqual(data.media, [], "no account → empty media")
        assert.strictEqual(data.gifts.length, 1, "gifts hang off the guest directly")
        assert.strictEqual(data.gifts[0].id, gift.id)
        assert.deepStrictEqual(data.cards, [], "no cards yet")
      })

      it("404s the story for an unknown guest", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")
        const res = await asAdmin(`/api/admin/guests/99999999/story`)
        assert.strictEqual(res.status, 404)
      })
    })

    describe("audit trail", () => {
      /** Wait for an audit entry matching a predicate (the log flushes async).
       *  @param {(e: Record<string, any>) => boolean} predicate @param {number} [tries] */
      async function waitForAudit(predicate, tries = 40) {
        for (let i = 0; i < tries; i++) {
          if (readAuditLog().some(predicate)) return true
          await new Promise((r) => setTimeout(r, 25))
        }
        return false
      }

      it("logs THANK_YOU_CARD_SEND, THANK_YOU_CARD_RESEND and THANK_YOU_REPLY", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        const { card } = await createGuestAndDraftCard()
        await markSentViaAdmin(card.id, "link") // logs THANK_YOU_CARD_SEND (via:link)
        await postReply(card.token, { emoji: "heart", message: "thanks!" }) // logs THANK_YOU_REPLY
        // A replied card resends via the DUPLICATE path (the reply gates the
        // reset), so THANK_YOU_CARD_RESEND is logged against the clone with the
        // original as details.sourceId.
        const resend = await json(await asAdmin(`/api/admin/thank-you/${card.id}/resend`, { method: "POST" }))

        assert.ok(
          await waitForAudit(
            (e) => e.action === "THANK_YOU_CARD_SEND" && e.resourceId === card.id,
          ),
          "THANK_YOU_CARD_SEND logged",
        )
        assert.ok(
          await waitForAudit(
            (e) => e.action === "THANK_YOU_REPLY" && e.resourceId === card.id,
          ),
          "THANK_YOU_REPLY logged",
        )
        assert.ok(
          await waitForAudit(
            (e) => e.action === "THANK_YOU_CARD_RESEND" && e.resourceId === resend.card.id,
          ),
          "THANK_YOU_CARD_RESEND logged (on the duplicate clone)",
        )
      })

      it("logs GIFT_CREATE/UPDATE/DELETE and THANK_YOU_CARD_CREATE/UPDATE/DELETE", async (t) => {
        if (!hasAdmin) return t.skip("TEST_ADMIN_PASSWORD not set")

        // Gift lifecycle: create → update → soft-delete.
        const { gift } = await createGuestAndGift()
        await asAdmin(`/api/admin/gifts/${gift.id}`, {
          method: "PUT",
          body: JSON.stringify({ notes: "audited" }),
        })
        await asAdmin(`/api/admin/gifts/${gift.id}`, { method: "DELETE" })

        // Card lifecycle: create → edit (while draft) → soft-delete.
        const { card } = await createGuestAndDraftCard()
        await asAdmin(`/api/admin/thank-you/${card.id}`, {
          method: "PUT",
          body: JSON.stringify({ message: "Edited before send" }),
        })
        await asAdmin(`/api/admin/thank-you/${card.id}`, { method: "DELETE" })

        /** @type {Array<[string, number]>} */
        const expected = [
          ["GIFT_CREATE", gift.id],
          ["GIFT_UPDATE", gift.id],
          ["GIFT_DELETE", gift.id],
          ["THANK_YOU_CARD_CREATE", card.id],
          ["THANK_YOU_CARD_UPDATE", card.id],
          ["THANK_YOU_CARD_DELETE", card.id],
        ]
        for (const [action, resourceId] of expected) {
          assert.ok(
            await waitForAudit((e) => e.action === action && e.resourceId === resourceId),
            `${action} logged`,
          )
        }
      })
    })
  })

  // ---- A1/D1: cross-card recent replies feed (Inbox + Mailbox) ----
  describe("GET /api/admin/thank-you/replies (recent replies)", () => {
    it("is admin-gated (401 unauthenticated)", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/thank-you/replies`)
      assert.strictEqual(res.status, 401)
    })

    it("returns replies newest-first with unread flags, clearing on reply-seen", async () => {
      if (!hasAdmin) return
      const a = seedSentCard({ message: "Card A" })
      const b = seedSentCard({ message: "Card B" })
      // Reply to A first, then B — B is newer, so it must lead the feed.
      setCardReply(a.cardId, { emoji: "❤️", message: "Loved it, thank you!" })
      setCardReply(b.cardId, { emoji: "🥂", message: "Cheers!" })

      const res = await asAdmin("/api/admin/thank-you/replies")
      assert.strictEqual(res.status, 200)
      const data = await json(res)
      assert.ok(Array.isArray(data.replies))
      const forA = data.replies.filter((/** @type {any} */ r) => r.cardId === a.cardId)
      const forB = data.replies.filter((/** @type {any} */ r) => r.cardId === b.cardId)
      assert.strictEqual(forA.length, 1)
      assert.strictEqual(forB.length, 1)
      // Newest-first: B's reply (later) appears before A's in the array.
      const idxA = data.replies.findIndex((/** @type {any} */ r) => r.cardId === a.cardId)
      const idxB = data.replies.findIndex((/** @type {any} */ r) => r.cardId === b.cardId)
      assert.ok(idxB < idxA, "newer reply (B) is listed before older (A)")
      // Both start unread; each carries the guest name + the reply glyph.
      assert.strictEqual(forA[0].unread, true)
      assert.strictEqual(forB[0].unread, true)
      assert.strictEqual(forA[0].emoji, "❤️")
      assert.ok(typeof forA[0].guestName === "string" && forA[0].guestName.length > 0)

      // Acknowledge card A → its reply flips to read; B stays unread.
      const seen = await asAdmin(`/api/admin/thank-you/${a.cardId}/reply-seen`, {
        method: "POST",
      })
      assert.strictEqual(seen.status, 200)
      const after = await json(await asAdmin("/api/admin/thank-you/replies"))
      const afterA = after.replies.find((/** @type {any} */ r) => r.cardId === a.cardId)
      const afterB = after.replies.find((/** @type {any} */ r) => r.cardId === b.cardId)
      assert.strictEqual(afterA.unread, false)
      assert.strictEqual(afterB.unread, true)
    })

    it("clamps the limit and honours it", async () => {
      if (!hasAdmin) return
      for (let i = 0; i < 3; i++) {
        const c = seedSentCard({ message: `Card ${i}` })
        setCardReply(c.cardId, { emoji: "heart", message: `reply ${i}` })
      }
      const res = await asAdmin("/api/admin/thank-you/replies?limit=2")
      const data = await json(res)
      assert.strictEqual(data.replies.length, 2)
    })
  })

  // ---- A3: "Most loved" guest media curation ----
  describe("GET /api/admin/media/guest-loved (reaction-count sort)", () => {
    /** Insert `n` distinct-account heart reactions on a media row. */
    function addReactions(/** @type {number} */ mediaId, /** @type {number} */ n) {
      for (let i = 0; i < n; i++) {
        const acct = createTestAccount(db)
        db.prepare(
          `INSERT INTO reactions (account_id, target_type, target_id, emoji)
           VALUES (?, 'media', ?, 'heart')`,
        ).run(Number(acct.id), mediaId)
      }
    }
    /** @param {string} fileKey @returns {number} */
    function mediaIdFor(fileKey) {
      const row = /** @type {any} */ (
        db.prepare(`SELECT id FROM media WHERE file_key = ?`).get(fileKey)
      )
      return Number(row.id)
    }

    it("is admin-gated (401 unauthenticated)", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/media/guest-loved`)
      assert.strictEqual(res.status, 401)
    })

    it("ranks approved guest media by total reaction count, with the total on each item", async () => {
      if (!hasAdmin) return
      const low = mediaIdFor(seedMediaRow())
      const high = mediaIdFor(seedMediaRow())
      const mid = mediaIdFor(seedMediaRow())
      addReactions(low, 1)
      addReactions(high, 3)
      addReactions(mid, 2)

      const res = await asAdmin("/api/admin/media/guest-loved")
      assert.strictEqual(res.status, 200)
      const data = await json(res)
      const ids = data.items.map((/** @type {any} */ m) => m.id)
      // Descending by reaction count: high(3) → mid(2) → low(1).
      assert.deepStrictEqual(
        [ids.indexOf(high) < ids.indexOf(mid), ids.indexOf(mid) < ids.indexOf(low)],
        [true, true],
      )
      const highItem = data.items.find((/** @type {any} */ m) => m.id === high)
      assert.strictEqual(highItem.reaction_count, 3)
    })
  })

  // ---- D5: printable memory book public page ----
  describe("GET /memory-book (public page)", () => {
    it("serves 200 HTML with the same security headers as other pages", async () => {
      const res = await fetch(`${BASE_URL}/memory-book`)
      assert.strictEqual(res.status, 200)
      assert.ok((res.headers.get("content-type") || "").includes("text/html"))
      assert.ok(res.headers.get("content-security-policy"), "has a CSP header")
      assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff")
      const body = await res.text()
      assert.ok(body.includes("Memory Book"), "renders the memory book title")
    })
  })
})
