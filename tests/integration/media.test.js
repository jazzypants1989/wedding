/**
 * @file Integration tests for the media pipeline (/api/media/* + /media serving).
 */
// MUST be first: sets TEST_SERVER_PORT + storage env before ../helpers.js reads them.
import "./_media-port.js"

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
import { makeJpeg, makeMp4 } from "../media-fixtures.js"
import { WEDDING } from "../../types.js"

/** @type {DatabaseSync} */
let db

const hasAdmin = !!process.env.TEST_ADMIN_PASSWORD

/** Parse a Response body as an untyped record (tests don't need response types).
 * @param {Response} res */
async function json(res) {
  return /** @type {any} */ (await res.json().catch(() => ({})))
}

/** @param {{ trusted?: 0 | 1, name?: string }} [opts] */
function signIn({ trusted = 1, name = "Guest" } = {}) {
  const account = createTestAccount(db, { name, trusted })
  const session = createTestAccountSession(db, Number(account.id))
  return {
    accountId: Number(account.id),
    auth: { cookieHeader: session.cookieHeader, csrfToken: session.csrfToken },
  }
}

/**
 * @param {Record<string, unknown>} body
 * @param {any} auth
 * @param {any} [fetcher]
 */
async function createSession(body, auth, fetcher = accountFetch) {
  const res = await fetcher(
    "/api/media",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    auth,
  )
  return { res, data: await json(res) }
}

/**
 * @param {number} id @param {string} variant @param {Buffer} buf @param {string} contentType
 * @param {any} auth
 * @param {any} [fetcher]
 */
function putVariant(id, variant, buf, contentType, auth, fetcher = accountFetch) {
  return fetcher(
    `/api/media/${id}/${variant}`,
    /** @type {any} */ ({ method: "PUT", headers: { "Content-Type": contentType }, body: buf }),
    auth,
  )
}

/**
 * @param {number} id @param {Record<string, unknown>} body
 * @param {any} auth
 * @param {any} [fetcher]
 */
function finalize(id, body, auth, fetcher = accountFetch) {
  return fetcher(
    `/api/media/${id}/finalize`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    auth,
  )
}

/** Full image upload session helper → returns { id, fileKey }.
 * @param {any} auth */
async function uploadImage(auth) {
  const { data } = await createSession({ kind: "image", originalBytes: 256 }, auth)
  await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", auth)
  await putVariant(data.id, "display", makeJpeg(200), "image/jpeg", auth)
  await putVariant(data.id, "thumb", makeJpeg(120), "image/jpeg", auth)
  const fin = await finalize(data.id, { width: 1200, height: 800 }, auth)
  return { id: data.id, fileKey: data.fileKey, finalizeRes: fin }
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

describe("media upload session", () => {
  it("trusted image: full session finalizes approved and serves the display variant", async () => {
    const { auth } = signIn({ trusted: 1 })
    const { id, fileKey, finalizeRes } = await uploadImage(auth)
    assert.strictEqual(finalizeRes.status, 200)
    assert.strictEqual((await json(finalizeRes)).status, "approved")

    const get = await fetch(`${BASE_URL}/media/${fileKey}/display`)
    assert.strictEqual(get.status, 200)
    assert.strictEqual(get.headers.get("content-type"), "image/jpeg")
    assert.strictEqual(get.headers.get("cache-control"), "public, max-age=86400")
    assert.strictEqual(get.headers.get("accept-ranges"), "bytes")
    assert.ok(id > 0)
  })

  it("untrusted image: finalizes pending and stays invisible to the public", async () => {
    const { auth } = signIn({ trusted: 0, name: "Stranger" })
    const { fileKey, finalizeRes } = await uploadImage(auth)
    assert.strictEqual((await json(finalizeRes)).status, "pending")

    const get = await fetch(`${BASE_URL}/media/${fileKey}/display`)
    assert.strictEqual(get.status, 404) // pending → 404 for the public
  })

  it("video: finalizes and serves /video as video/mp4 with Range + conditional support", async () => {
    const { auth } = signIn({ trusted: 1 })
    const mp4 = makeMp4(1024)
    const { data } = await createSession({ kind: "video", originalBytes: mp4.length }, auth)
    await putVariant(data.id, "original", mp4, "video/mp4", auth)
    await putVariant(data.id, "poster", makeJpeg(300), "image/jpeg", auth)
    const fin = await finalize(data.id, { width: 1280, height: 720, durationS: 12 }, auth)
    assert.strictEqual((await json(fin)).status, "approved")

    // Full GET → 200, always video/mp4.
    const full = await fetch(`${BASE_URL}/media/${data.fileKey}/video`)
    assert.strictEqual(full.status, 200)
    assert.strictEqual(full.headers.get("content-type"), "video/mp4")
    const etag = full.headers.get("etag")
    assert.ok(etag)

    // Range → 206 with exact Content-Range and 10 bytes.
    const ranged = await fetch(`${BASE_URL}/media/${data.fileKey}/video`, {
      headers: { Range: "bytes=0-9" },
    })
    assert.strictEqual(ranged.status, 206)
    assert.strictEqual(ranged.headers.get("content-range"), `bytes 0-9/${mp4.length}`)
    assert.strictEqual(ranged.headers.get("content-length"), "10")
    assert.strictEqual((await ranged.arrayBuffer()).byteLength, 10)

    // HEAD mirrors GET headers with an empty body.
    const head = await fetch(`${BASE_URL}/media/${data.fileKey}/video`, { method: "HEAD" })
    assert.strictEqual(head.status, 200)
    assert.strictEqual(head.headers.get("content-length"), String(mp4.length))
    assert.strictEqual((await head.arrayBuffer()).byteLength, 0)

    // If-None-Match → 304, both with and without a Range header (RFC 9110 §13.2.2).
    const nm1 = await fetch(`${BASE_URL}/media/${data.fileKey}/video`, {
      headers: { "If-None-Match": etag },
    })
    assert.strictEqual(nm1.status, 304)
    const nm2 = await fetch(`${BASE_URL}/media/${data.fileKey}/video`, {
      headers: { "If-None-Match": etag, Range: "bytes=0-9" },
    })
    assert.strictEqual(nm2.status, 304)
  })

  it("rejects a wrong-magic body with 415", async () => {
    const { auth } = signIn({ trusted: 1 })
    const { data } = await createSession({ kind: "video", originalBytes: 1024 }, auth)
    // A JPEG sent to a video item's original (expects mp4/mov).
    const res = await putVariant(data.id, "original", makeJpeg(512), "image/jpeg", auth)
    assert.strictEqual(res.status, 415)
  })

  it("blocks variant PUT after finalize (409 — the moderation-bypass gate)", async () => {
    const { auth } = signIn({ trusted: 1 })
    const { id } = await uploadImage(auth)
    const res = await putVariant(id, "display", makeJpeg(200), "image/jpeg", auth)
    assert.strictEqual(res.status, 409)
  })

  it("allows re-PUT of a variant within the uploading window", async () => {
    const { auth } = signIn({ trusted: 1 })
    const { data } = await createSession({ kind: "image", originalBytes: 256 }, auth)
    const first = await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", auth)
    const second = await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", auth)
    assert.strictEqual(first.status, 200)
    assert.strictEqual(second.status, 200)
  })

  it("re-finalize is an idempotent no-op returning the current status", async () => {
    const { auth } = signIn({ trusted: 1 })
    const { id } = await uploadImage(auth)
    const again = await finalize(id, { width: 1200, height: 800 }, auth)
    assert.strictEqual(again.status, 200)
    assert.strictEqual((await json(again)).status, "approved")
  })

  it("finalize with a missing required variant → 409", async () => {
    const { auth } = signIn({ trusted: 1 })
    const { data } = await createSession({ kind: "image", originalBytes: 256 }, auth)
    await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", auth)
    // No display/thumb, and displayMissing not set → required variants absent.
    const res = await finalize(data.id, { width: 100, height: 100 }, auth)
    assert.strictEqual(res.status, 409)
  })

  it("HEIC fallback: displayMissing finalizes with only the original", async () => {
    const { auth } = signIn({ trusted: 1 })
    const { data } = await createSession({ kind: "image", originalBytes: 256 }, auth)
    await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", auth)
    const res = await finalize(data.id, { width: 0, height: 0, displayMissing: true }, auth)
    assert.strictEqual(res.status, 200)
    assert.strictEqual((await json(res)).status, "approved")
  })

  it("self-delete unlinks files → the variant 404s afterward", async () => {
    const { auth } = signIn({ trusted: 1 })
    const { id, fileKey } = await uploadImage(auth)
    assert.strictEqual((await fetch(`${BASE_URL}/media/${fileKey}/display`)).status, 200)
    const del = await accountFetch(`/api/media/${id}`, { method: "DELETE" }, auth)
    assert.strictEqual(del.status, 200)
    assert.strictEqual((await fetch(`${BASE_URL}/media/${fileKey}/display`)).status, 404)
  })

  it("rejects an over-cap create with 413", async () => {
    const { auth } = signIn({ trusted: 1 })
    const { res } = await createSession({ kind: "image", originalBytes: 40 * 1024 * 1024 }, auth)
    assert.strictEqual(res.status, 413)
  })

  it("enforces the untrusted per-account quota with 507", async () => {
    const { auth } = signIn({ trusted: 0, name: "Quota" })
    // _media-port.js sets MEDIA_UNTRUSTED_QUOTA_BYTES=1MB; 2MB exceeds it.
    const { res } = await createSession({ kind: "image", originalBytes: 2 * 1024 * 1024 }, auth)
    assert.strictEqual(res.status, 507)
  })

  it("rejects a PUT without Content-Length (411)", async () => {
    const { auth } = signIn({ trusted: 1 })
    const { data } = await createSession({ kind: "image", originalBytes: 256 }, auth)
    // A streamed body sends Transfer-Encoding: chunked (no Content-Length).
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(makeJpeg(256)))
        c.close()
      },
    })
    const res = await fetch(`${BASE_URL}/api/media/${data.id}/original`, /** @type {any} */ ({
      method: "PUT",
      headers: {
        "Content-Type": "image/jpeg",
        "Cookie": auth.cookieHeader,
        "X-CSRF-Token": auth.csrfToken,
      },
      body: stream,
      duplex: "half",
    }))
    assert.strictEqual(res.status, 411)
  })

  it("requires authentication for a variant PUT (401)", async () => {
    const res = await fetch(`${BASE_URL}/api/media/1/original`, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: makeJpeg(64),
    })
    assert.strictEqual(res.status, 401)
  })
})

describe("admin media upload (requires TEST_ADMIN_PASSWORD)", () => {
  it("admin session drives a full session storing account_id NULL and auto-approves", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const admin = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
    const adminAuth = { cookieHeader: admin.cookieHeader, csrfToken: admin.csrfToken }

    const { data } = await createSession(
      { kind: "image", originalBytes: 256, section: "official" },
      adminAuth,
      adminFetch,
    )
    await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", adminAuth, adminFetch)
    await putVariant(data.id, "display", makeJpeg(200), "image/jpeg", adminAuth, adminFetch)
    await putVariant(data.id, "thumb", makeJpeg(120), "image/jpeg", adminAuth, adminFetch)
    const fin = await finalize(data.id, { width: 1200, height: 800 }, adminAuth, adminFetch)
    assert.strictEqual((await json(fin)).status, "approved")

    const row = /** @type {any} */ (
      db.prepare(`SELECT account_id, section FROM media WHERE id = ?`).get(data.id)
    )
    assert.strictEqual(row.account_id, null)
    assert.strictEqual(row.section, "official")

    // Official-section variants are immutable-cached.
    const get = await fetch(`${BASE_URL}/media/${data.fileKey}/display`)
    assert.strictEqual(get.headers.get("cache-control"), "public, max-age=31536000, immutable")
  })
})

describe("gallery list + single-item API", () => {
  it("guest list is approved, newest-first, and excludes others' pending", async () => {
    const { auth: aliceAuth } = signIn({ trusted: 1, name: "Alice" })
    const first = await uploadImage(aliceAuth)
    const second = await uploadImage(aliceAuth)

    // Untrusted upload → pending → must not appear in the public feed.
    const { auth: bobAuth } = signIn({ trusted: 0, name: "Bob" })
    const pending = await uploadImage(bobAuth)
    assert.strictEqual((await json(pending.finalizeRes)).status, "pending")

    const body = await json(await fetch(`${BASE_URL}/api/media?section=guest`))
    const ids = body.items.map((/** @type {any} */ i) => i.id)
    assert.ok(ids.includes(first.id) && ids.includes(second.id))
    assert.ok(!ids.includes(pending.id), "others' pending excluded from public list")
    assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id), "newest-first (id DESC)")

    const item = body.items.find((/** @type {any} */ i) => i.id === second.id)
    assert.strictEqual(item.is_own, false)
    assert.strictEqual(item.author_name, "Alice")
    assert.strictEqual(item.section, "guest")
    assert.strictEqual(typeof item.file_key, "string")
    assert.ok(!("account_id" in item), "account_id never leaked to the client")
  })

  it("owner sees their own pending item with is_own true", async () => {
    const { auth } = signIn({ trusted: 0, name: "Cara" })
    const pending = await uploadImage(auth)
    const body = await json(await accountFetch("/api/media?section=guest", {}, auth))
    const item = body.items.find((/** @type {any} */ i) => i.id === pending.id)
    assert.ok(item, "own pending item present for its author")
    assert.strictEqual(item.is_own, true)
    assert.strictEqual(item.status, "pending")
  })

  it("keyset pagination walks the guest feed with before/limit", async () => {
    const { auth } = signIn({ trusted: 1 })
    for (let i = 0; i < 3; i++) await uploadImage(auth)

    const page1 = await json(await fetch(`${BASE_URL}/api/media?section=guest&limit=2`))
    assert.strictEqual(page1.items.length, 2)
    assert.strictEqual(page1.nextCursor, page1.items[page1.items.length - 1].id)

    const page2 = await json(
      await fetch(`${BASE_URL}/api/media?section=guest&limit=2&before=${page1.nextCursor}`),
    )
    const p1ids = page1.items.map((/** @type {any} */ i) => i.id)
    for (const it of page2.items) {
      assert.ok(!p1ids.includes(it.id), "no overlap across keyset pages")
    }
  })

  it("single item: approved public 200, others' pending 404, owner 200, missing 404", async () => {
    const { auth: aAuth } = signIn({ trusted: 1, name: "Approved" })
    const approved = await uploadImage(aAuth)
    const pub = await fetch(`${BASE_URL}/api/media/${approved.id}`)
    assert.strictEqual(pub.status, 200)
    const item = await json(pub)
    assert.strictEqual(item.id, approved.id)
    assert.strictEqual(item.is_own, false)

    const { auth: pAuth } = signIn({ trusted: 0, name: "Pend" })
    const pending = await uploadImage(pAuth)
    assert.strictEqual(
      (await fetch(`${BASE_URL}/api/media/${pending.id}`)).status,
      404,
      "others' pending item → 404 (no id-guessing leak)",
    )
    assert.strictEqual(
      (await accountFetch(`/api/media/${pending.id}`, {}, pAuth)).status,
      200,
      "owner sees their own pending item",
    )
    assert.strictEqual((await fetch(`${BASE_URL}/api/media/99999`)).status, 404)
  })

  it("official list coalesces author_name for account_id NULL uploads", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const admin = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
    const adminAuth = { cookieHeader: admin.cookieHeader, csrfToken: admin.csrfToken }
    const { data } = await createSession(
      { kind: "image", originalBytes: 256, section: "official" },
      adminAuth,
      adminFetch,
    )
    await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", adminAuth, adminFetch)
    await putVariant(data.id, "display", makeJpeg(200), "image/jpeg", adminAuth, adminFetch)
    await putVariant(data.id, "thumb", makeJpeg(120), "image/jpeg", adminAuth, adminFetch)
    await finalize(data.id, { width: 800, height: 600 }, adminAuth, adminFetch)

    const body = await json(await fetch(`${BASE_URL}/api/media?section=official`))
    const item = body.items.find((/** @type {any} */ i) => i.id === data.id)
    assert.ok(item, "official item listed")
    assert.strictEqual(item.author_name, WEDDING.COUPLE_NAMES)
    assert.strictEqual(item.section, "official")
    assert.strictEqual(body.nextCursor, null, "official section is a single page")
  })
})
