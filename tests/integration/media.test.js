/**
 * @file Integration tests for the media pipeline (/api/media/* + /media serving).
 */
// MUST be first: sets TEST_SERVER_PORT + storage env before ../helpers.js reads them.
import "./_media-port.js"

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
import { makeJpeg, makeMp4 } from "../media-fixtures.js"
import { getWeddingFacts } from "../../core/wedding-facts.js"

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

/** Full content-section (dress-code) upload with the responsive width ladder.
 * @param {any} adminAuth */
async function uploadContentImage(adminAuth) {
  const { data } = await createSession(
    { kind: "image", originalBytes: 256, section: "content" },
    adminAuth,
    adminFetch,
  )
  await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", adminAuth, adminFetch)
  await putVariant(data.id, "w400", makeJpeg(120), "image/jpeg", adminAuth, adminFetch)
  await putVariant(data.id, "w800", makeJpeg(180), "image/jpeg", adminAuth, adminFetch)
  await putVariant(data.id, "w1600", makeJpeg(240), "image/jpeg", adminAuth, adminFetch)
  const fin = await finalize(data.id, { width: 1200, height: 800 }, adminAuth, adminFetch)
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
    const { res, data } = await createSession(
      { kind: "image", originalBytes: 2 * 1024 * 1024 },
      auth,
    )
    assert.strictEqual(res.status, 507)
    // Personal quota gets distinct copy/code from the site-wide disk guards —
    // the client surfaces this message verbatim.
    assert.strictEqual(data.code, "UPLOAD_QUOTA_EXCEEDED")
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

  it("caps the original upload at the declared size + slack (413 on under-declare)", async () => {
    // The quota bypass: declare a tiny originalBytes (passes the create-time
    // guard), then try to stream far more than declared + the 64KB slack. The
    // putVariant cap must 413 it rather than accept up to the 30MB kind cap.
    const { auth } = signIn({ trusted: 0, name: "Underdeclare" })
    const { res: createRes, data } = await createSession(
      { kind: "image", originalBytes: 100 },
      auth,
    )
    assert.strictEqual(createRes.status, 201)
    // 200KB is well over declared(100) + 64KB slack → rejected.
    const put = await putVariant(data.id, "original", makeJpeg(200 * 1024), "image/jpeg", auth)
    assert.strictEqual(put.status, 413)
  })

  it("accepts an original modestly over the declared size (within slack)", async () => {
    // Honest Content-Length vs File.size drift must not 413 — a small overshoot
    // inside the slack window still uploads.
    const { auth } = signIn({ trusted: 1 })
    const { data } = await createSession({ kind: "image", originalBytes: 100 }, auth)
    const put = await putVariant(data.id, "original", makeJpeg(2000), "image/jpeg", auth)
    assert.strictEqual(put.status, 200)
  })

  it("re-checks the untrusted quota against actual bytes at finalize (507)", async () => {
    // _media-port.js sets MEDIA_UNTRUSTED_QUOTA_BYTES = 1MB. Declare just under it
    // (passes the create-time guard), then — within the declared+slack window —
    // actually store slightly OVER the quota. The finalize re-guard must catch the
    // real bytes, reject with 507/UPLOAD_QUOTA_EXCEEDED, and discard the upload.
    const QUOTA = 1024 * 1024
    const { auth } = signIn({ trusted: 0, name: "FinalizeQuota" })
    const declared = QUOTA - 100 // create guard: 0 + declared <= quota ✓
    const { res: createRes, data } = await createSession(
      { kind: "image", originalBytes: declared },
      auth,
    )
    assert.strictEqual(createRes.status, 201)

    // Actual original is ~10KB over the quota but still within declared + 64KB slack.
    const actual = QUOTA + 10 * 1024
    const putOriginal = await putVariant(data.id, "original", makeJpeg(actual), "image/jpeg", auth)
    assert.strictEqual(putOriginal.status, 200)
    await putVariant(data.id, "display", makeJpeg(200), "image/jpeg", auth)
    await putVariant(data.id, "thumb", makeJpeg(120), "image/jpeg", auth)

    const fin = await finalize(data.id, { width: 1200, height: 800 }, auth)
    assert.strictEqual(fin.status, 507)
    assert.strictEqual((await json(fin)).code, "UPLOAD_QUOTA_EXCEEDED")

    // The whole upload was discarded (row + files) like an abandoned session.
    const get = await fetch(`${BASE_URL}/media/${data.fileKey}/display`)
    assert.strictEqual(get.status, 404)
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
    assert.strictEqual(item.author_name, getWeddingFacts().coupleNames)
    assert.strictEqual(item.section, "official")
    assert.strictEqual(body.nextCursor, null, "one photo fits one page")
  })

  it("hiding an approved item pulls it from BOTH the public file server and the id API", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    // A trusted guest upload auto-approves and is publicly visible both ways.
    const { auth } = signIn({ trusted: 1 })
    const { id, fileKey } = await uploadImage(auth)
    assert.strictEqual(
      (await fetch(`${BASE_URL}/media/${fileKey}/display`)).status,
      200,
      "approved: display served",
    )
    assert.strictEqual(
      (await fetch(`${BASE_URL}/api/media/${id}`)).status,
      200,
      "approved: id API 200",
    )

    // Admin hides it (approved → hidden).
    const admin = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
    const hide = await adminFetch(
      `/api/admin/moderation/media/${id}/hide`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      admin,
    )
    assert.strictEqual(hide.status, 200, "hide succeeds on an approved item")

    // Anonymous public access now 404s through both surfaces (approval gate).
    assert.strictEqual(
      (await fetch(`${BASE_URL}/media/${fileKey}/display`)).status,
      404,
      "hidden: public file server 404s",
    )
    assert.strictEqual(
      (await fetch(`${BASE_URL}/api/media/${id}`)).status,
      404,
      "hidden: id API 404s for anonymous",
    )
  })
})

describe("an uploader's own pending photo", () => {
  /** @param {number} id @param {string} status */
  function setStatus(id, status) {
    db.prepare("UPDATE media SET status = ? WHERE id = ?").run(status, id)
  }

  /**
   * @param {string} fileKey @param {string} variant @param {any} [auth]
   * @param {{ headers?: Record<string, string> }} [init]
   */
  function getMedia(fileKey, variant, auth, init = {}) {
    const path = `/media/${fileKey}/${variant}`
    return auth ? accountFetch(path, init, auth) : fetch(`${BASE_URL}${path}`, init)
  }

  it("serves its public variants to the uploader, and no shared cache may keep them", async () => {
    const { auth } = signIn({ trusted: 0 })
    const { fileKey, finalizeRes } = await uploadImage(auth)
    assert.strictEqual((await json(finalizeRes)).status, "pending")
    for (const variant of ["display", "thumb"]) {
      const res = await getMedia(fileKey, variant, auth)
      assert.strictEqual(res.status, 200, variant)
      assert.strictEqual(res.headers.get("cache-control"), "private, no-cache", variant)
      assert.ok((await res.arrayBuffer()).byteLength > 0, variant)
    }
  })

  it("a pending video plays for its uploader, poster and Range included", async () => {
    const { auth } = signIn({ trusted: 0 })
    const { auth: other } = signIn({ trusted: 0, name: "Someone Else" })
    const mp4 = makeMp4(1024)
    const { data } = await createSession({ kind: "video", originalBytes: mp4.length }, auth)
    await putVariant(data.id, "original", mp4, "video/mp4", auth)
    await putVariant(data.id, "poster", makeJpeg(300), "image/jpeg", auth)
    const fin = await finalize(data.id, { width: 1280, height: 720, durationS: 12 }, auth)
    assert.strictEqual((await json(fin)).status, "pending")

    const poster = await getMedia(data.fileKey, "poster", auth)
    assert.strictEqual(poster.status, 200)
    assert.strictEqual(poster.headers.get("cache-control"), "private, no-cache")
    await poster.arrayBuffer()
    const ranged = await getMedia(data.fileKey, "video", auth, { headers: { Range: "bytes=0-9" } })
    assert.strictEqual(ranged.status, 206)
    assert.strictEqual(ranged.headers.get("cache-control"), "private, no-cache")
    await ranged.arrayBuffer()

    assert.strictEqual((await getMedia(data.fileKey, "video", other)).status, 404)
    assert.strictEqual((await getMedia(data.fileKey, "poster")).status, 404)
    assert.strictEqual((await getMedia(data.fileKey, "original", auth)).status, 404)
  })

  it("revalidates through the gate: a conditional 304 stays private", async () => {
    const { auth } = signIn({ trusted: 0 })
    const { fileKey } = await uploadImage(auth)
    const first = await getMedia(fileKey, "thumb", auth)
    await first.arrayBuffer()
    const etag = first.headers.get("etag")
    assert.ok(etag)
    const again = await getMedia(fileKey, "thumb", auth, { headers: { "If-None-Match": etag } })
    assert.strictEqual(again.status, 304)
    assert.strictEqual(again.headers.get("cache-control"), "private, no-cache")
  })

  it("is a 404 for another account and for a visitor, conditional or not", async () => {
    const { auth } = signIn({ trusted: 0 })
    const { auth: other } = signIn({ trusted: 0, name: "Someone Else" })
    const { fileKey } = await uploadImage(auth)
    const etag = `"${fileKey}-thumb"`
    assert.strictEqual((await getMedia(fileKey, "thumb", other)).status, 404, "other account")
    assert.strictEqual((await getMedia(fileKey, "thumb")).status, 404, "visitor")
    for (const who of [other, undefined]) {
      const res = await getMedia(fileKey, "thumb", who, { headers: { "If-None-Match": etag } })
      assert.strictEqual(res.status, 404, "an ETag proves nothing")
    }
    const missing = "0".repeat(32)
    const indistinct = await getMedia(missing, "thumb", other)
    const pendingBody = await (await getMedia(fileKey, "thumb", other)).text()
    assert.strictEqual(await indistinct.text(), pendingBody, "same answer as no such photo")
  })

  it("never opens the original, even to the uploader", async () => {
    const { auth } = signIn({ trusted: 0 })
    const { fileKey } = await uploadImage(auth)
    assert.strictEqual((await getMedia(fileKey, "original", auth)).status, 404)
  })

  for (const status of ["hidden", "rejected", "uploading"]) {
    it(`status ${status} stays closed to the uploader`, async () => {
      const { auth } = signIn({ trusted: 0 })
      const { id, fileKey } = await uploadImage(auth)
      setStatus(id, status)
      for (const variant of ["display", "thumb", "original"]) {
        assert.strictEqual((await getMedia(fileKey, variant, auth)).status, 404, variant)
      }
    })
  }

  it("a soft-deleted row stays closed to the uploader", async () => {
    const { auth } = signIn({ trusted: 0 })
    const { id, fileKey } = await uploadImage(auth)
    db.prepare("UPDATE media SET deleted_at = datetime('now') WHERE id = ?").run(id)
    assert.strictEqual((await getMedia(fileKey, "thumb", auth)).status, 404)
  })

  it("a stale guest cookie is a visitor", async () => {
    const { auth } = signIn({ trusted: 0 })
    const { fileKey } = await uploadImage(auth)
    const stale = { cookieHeader: "guest_session=" + "a".repeat(64), csrfToken: "x" }
    assert.strictEqual((await getMedia(fileKey, "thumb", stale)).status, 404)
  })

  it("goes public once approved, and an admin's view is unchanged", async (t) => {
    const { auth } = signIn({ trusted: 0 })
    const { id, fileKey } = await uploadImage(auth)
    if (hasAdmin) {
      const admin = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
      const asAdmin = await adminFetch(`/media/${fileKey}/thumb`, {}, admin)
      assert.strictEqual(asAdmin.status, 200)
      assert.strictEqual(asAdmin.headers.get("cache-control"), "private, no-cache")
      await asAdmin.arrayBuffer()
    } else {
      t.diagnostic("no TEST_ADMIN_PASSWORD: the admin half did not run")
    }
    setStatus(id, "approved")
    const open = await getMedia(fileKey, "thumb")
    assert.strictEqual(open.status, 200)
    assert.strictEqual(open.headers.get("cache-control"), "public, max-age=86400")
    await open.arrayBuffer()
  })
})

describe("content section: dress-code images (requires TEST_ADMIN_PASSWORD)", () => {
  /** @returns {Promise<any>} */
  async function adminAuthFor() {
    const a = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
    return { cookieHeader: a.cookieHeader, csrfToken: a.csrfToken }
  }

  it("admin content upload finalizes approved as section=content, account_id NULL, immutable-cached ladder", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const adminAuth = await adminAuthFor()
    const { id, fileKey, finalizeRes } = await uploadContentImage(adminAuth)
    assert.strictEqual((await json(finalizeRes)).status, "approved")

    const row = /** @type {any} */ (
      db.prepare("SELECT account_id, section FROM media WHERE id = ?").get(id)
    )
    assert.strictEqual(row.account_id, null)
    assert.strictEqual(row.section, "content")

    // Each ladder variant is publicly servable by file_key with the immutable cache.
    for (const v of ["w400", "w800", "w1600"]) {
      const get = await fetch(`${BASE_URL}/media/${fileKey}/${v}`)
      assert.strictEqual(get.status, 200, `${v} servable`)
      assert.strictEqual(
        get.headers.get("cache-control"),
        "public, max-age=31536000, immutable",
      )
    }
  })

  it("content is excluded from every public gallery feed (and ?section=content clamps to guest)", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const adminAuth = await adminAuthFor()
    const content = await uploadContentImage(adminAuth)
    const { auth } = signIn({ trusted: 1 })
    const guest = await uploadImage(auth)

    for (const section of ["content", "guest", "official"]) {
      const body = await json(await fetch(`${BASE_URL}/api/media?section=${section}`))
      const ids = body.items.map((/** @type {any} */ i) => i.id)
      assert.ok(!ids.includes(content.id), `content absent from section=${section}`)
    }
    // The unknown 'content' param falls back to the guest feed rather than erroring.
    const asContent = await json(await fetch(`${BASE_URL}/api/media?section=content`))
    assert.ok(
      asContent.items.some((/** @type {any} */ i) => i.id === guest.id),
      "section=content clamps to the guest feed",
    )
  })

  it("content is not deep-linkable via GET /api/media/:id (even for admin)", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const adminAuth = await adminAuthFor()
    const content = await uploadContentImage(adminAuth)
    assert.strictEqual(
      (await fetch(`${BASE_URL}/api/media/${content.id}`)).status,
      404,
      "content excluded from the public id deep-link",
    )
    assert.strictEqual(
      (await adminFetch(`/api/media/${content.id}`, {}, adminAuth)).status,
      404,
      "content is not a gallery feed item",
    )
  })

  it("content never appears in the moderation queue", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const adminAuth = await adminAuthFor()
    const content = await uploadContentImage(adminAuth)
    for (const status of ["approved", "pending", "hidden"]) {
      const q = await json(
        await adminFetch(`/api/admin/moderation/queue?type=media&status=${status}`, {}, adminAuth),
      )
      const ids = (q.items || []).map((/** @type {any} */ i) => i.id)
      assert.ok(!ids.includes(content.id), `content absent from moderation status=${status}`)
    }
  })

  it("finalize requires the full ladder for content (original-only → 409)", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const adminAuth = await adminAuthFor()
    const { data } = await createSession(
      { kind: "image", originalBytes: 256, section: "content" },
      adminAuth,
      adminFetch,
    )
    await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", adminAuth, adminFetch)
    // No ladder variants uploaded.
    const fin = await finalize(data.id, { width: 1200, height: 800 }, adminAuth, adminFetch)
    assert.strictEqual(fin.status, 409, "content finalize demands the ladder variants")
  })

  it("content section is admin-only — a guest is forced into the guest section", async () => {
    const { auth, accountId } = signIn({ trusted: 1 })
    const { data } = await createSession(
      { kind: "image", originalBytes: 256, section: "content" },
      auth,
    )
    const row = /** @type {any} */ (
      db.prepare("SELECT section, account_id FROM media WHERE id = ?").get(data.id)
    )
    assert.strictEqual(row.section, "guest", "non-admin cannot create content-section media")
    assert.strictEqual(row.account_id, accountId)
  })

  it("content section is image-only — admin video → 400", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const adminAuth = await adminAuthFor()
    const { res } = await createSession(
      { kind: "video", originalBytes: 4096, section: "content" },
      adminAuth,
      adminFetch,
    )
    assert.strictEqual(res.status, 400, "content section rejects video uploads")
  })
})

describe("honeymoon section: a second curated set", () => {
  /** @returns {Promise<any>} */
  async function adminAuthFor() {
    const a = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
    return { cookieHeader: a.cookieHeader, csrfToken: a.csrfToken }
  }

  /** Full admin image upload into a curated section → { id, fileKey, status }.
   * @param {any} adminAuth @param {string} section */
  async function uploadCurated(adminAuth, section) {
    const { res, data } = await createSession(
      { kind: "image", originalBytes: 256, section },
      adminAuth,
      adminFetch,
    )
    assert.strictEqual(res.status, 201)
    await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", adminAuth, adminFetch)
    await putVariant(data.id, "display", makeJpeg(200), "image/jpeg", adminAuth, adminFetch)
    await putVariant(data.id, "thumb", makeJpeg(120), "image/jpeg", adminAuth, adminFetch)
    const fin = await finalize(data.id, { width: 1200, height: 800 }, adminAuth, adminFetch)
    return { id: Number(data.id), fileKey: String(data.fileKey), status: (await json(fin)).status }
  }

  /** @param {string} section @returns {Promise<number[]>} public feed ids, in order */
  async function feedIds(section) {
    const body = await json(await fetch(`${BASE_URL}/api/media?section=${section}`))
    return body.items.map((/** @type {any} */ i) => i.id)
  }

  /** @param {any} adminAuth @param {Record<string, unknown>} body */
  function reorder(adminAuth, body) {
    return adminFetch(
      "/api/admin/media/reorder",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      adminAuth,
    )
  }

  /** @param {any} adminAuth @param {number} id @param {string} section */
  function moveTo(adminAuth, id, section) {
    return adminFetch(
      `/api/admin/media/${id}/section`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section }),
      },
      adminAuth,
    )
  }

  it("a guest can never upload into honeymoon — the session lands in guest, like official", async () => {
    const { auth, accountId } = signIn({ trusted: 1, name: "Sneaky" })
    for (const section of ["honeymoon", "official"]) {
      const { res, data } = await createSession(
        { kind: "image", originalBytes: 256, section },
        auth,
      )
      assert.strictEqual(res.status, 201, "the upload itself is allowed")
      const row = /** @type {any} */ (
        db.prepare("SELECT section, account_id FROM media WHERE id = ?").get(data.id)
      )
      assert.strictEqual(row.section, "guest", `a guest asking for ${section} gets guest`)
      assert.strictEqual(row.account_id, accountId)
    }

    // End to end: a finished guest upload asking for honeymoon is never listed there.
    const { data } = await createSession(
      { kind: "image", originalBytes: 256, section: "honeymoon" },
      auth,
    )
    await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", auth)
    await putVariant(data.id, "display", makeJpeg(200), "image/jpeg", auth)
    await putVariant(data.id, "thumb", makeJpeg(120), "image/jpeg", auth)
    await finalize(data.id, { width: 1200, height: 800 }, auth)
    assert.ok(!(await feedIds("honeymoon")).includes(data.id), "absent from honeymoon")
    assert.ok((await feedIds("guest")).includes(data.id), "present in guest")
  })

  it("admin upload: auto-approved, account_id NULL, listed in honeymoon only", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const adminAuth = await adminAuthFor()
    const one = await uploadCurated(adminAuth, "honeymoon")
    const two = await uploadCurated(adminAuth, "honeymoon")
    assert.strictEqual(one.status, "approved")

    const row = /** @type {any} */ (
      db.prepare("SELECT account_id, section FROM media WHERE id = ?").get(one.id)
    )
    assert.strictEqual(row.account_id, null)
    assert.strictEqual(row.section, "honeymoon")

    // The public list: sort_order order, all on one page, the couple as author.
    const body = await json(await fetch(`${BASE_URL}/api/media?section=honeymoon`))
    assert.deepStrictEqual(
      body.items.map((/** @type {any} */ i) => i.id),
      [one.id, two.id],
    )
    assert.strictEqual(body.items[0].section, "honeymoon")
    assert.strictEqual(body.items[0].author_name, getWeddingFacts().coupleNames)
    assert.strictEqual(body.nextCursor, null, "two photos fit one page")
    assert.strictEqual(body.contributors, undefined, "no guest contributors strip")

    // Kept out of the other feeds.
    assert.ok(!(await feedIds("official")).includes(one.id))
    assert.ok(!(await feedIds("guest")).includes(one.id))

    // Deep link + curated (immutable) caching, like official.
    assert.strictEqual((await fetch(`${BASE_URL}/api/media/${one.id}`)).status, 200)
    const get = await fetch(`${BASE_URL}/media/${one.fileKey}/display`)
    assert.strictEqual(get.headers.get("cache-control"), "public, max-age=31536000, immutable")
  })

  it("guests react to and comment on a honeymoon photo exactly as on official", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const adminAuth = await adminAuthFor()
    const photo = await uploadCurated(adminAuth, "honeymoon")
    const { auth } = signIn({ trusted: 1, name: "Reactor" })

    const react = await accountFetch(
      "/api/reactions/toggle",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: "media", target_id: photo.id, emoji: "heart" }),
      },
      auth,
    )
    assert.strictEqual(react.status, 200)
    const comment = await accountFetch(
      `/api/media/${photo.id}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Gorgeous!" }),
      },
      auth,
    )
    assert.strictEqual(comment.status, 201)
  })

  it("admin reorders honeymoon on its own; official's order and calls are untouched", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const adminAuth = await adminAuthFor()
    const o1 = await uploadCurated(adminAuth, "official")
    const o2 = await uploadCurated(adminAuth, "official")
    const h1 = await uploadCurated(adminAuth, "honeymoon")
    const h2 = await uploadCurated(adminAuth, "honeymoon")
    const h3 = await uploadCurated(adminAuth, "honeymoon")

    const reversed = [h3.id, h2.id, h1.id]
    const ok = await reorder(adminAuth, { ids: reversed, section: "honeymoon" })
    assert.strictEqual(ok.status, 200)
    assert.deepStrictEqual(await feedIds("honeymoon"), reversed)
    assert.deepStrictEqual(await feedIds("official"), [o1.id, o2.id], "official untouched")

    // The set is checked per section: official ids against honeymoon → 400.
    const crossed = await reorder(adminAuth, { ids: [o2.id, o1.id], section: "honeymoon" })
    assert.strictEqual(crossed.status, 400)
    // A short honeymoon set → 400.
    const short = await reorder(adminAuth, { ids: [h1.id, h2.id], section: "honeymoon" })
    assert.strictEqual(short.status, 400)
    // Not a curated section → 400, never a guess.
    const guestSection = await reorder(adminAuth, { ids: [h1.id], section: "guest" })
    assert.strictEqual(guestSection.status, 400)

    // No section still means official (the HTTP import sink's call shape).
    const legacy = await reorder(adminAuth, { ids: [o2.id, o1.id] })
    assert.strictEqual(legacy.status, 200)
    assert.deepStrictEqual(await feedIds("official"), [o2.id, o1.id])
    assert.deepStrictEqual(await feedIds("honeymoon"), reversed)
  })

  it("admin moves a photo between official and honeymoon, appended at the end", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const adminAuth = await adminAuthFor()
    const official = await uploadCurated(adminAuth, "official")
    const h1 = await uploadCurated(adminAuth, "honeymoon")
    const h2 = await uploadCurated(adminAuth, "honeymoon")
    await reorder(adminAuth, { ids: [h2.id, h1.id], section: "honeymoon" })

    const moved = await moveTo(adminAuth, official.id, "honeymoon")
    assert.strictEqual(moved.status, 200)
    assert.deepStrictEqual(await feedIds("honeymoon"), [h2.id, h1.id, official.id])
    assert.deepStrictEqual(await feedIds("official"), [])

    // And back again.
    assert.strictEqual((await moveTo(adminAuth, official.id, "official")).status, 200)
    assert.deepStrictEqual(await feedIds("official"), [official.id])

    // Already there → 409; a guest photo isn't curated → 409 (promote is its path);
    // a non-curated target → 400.
    assert.strictEqual((await moveTo(adminAuth, official.id, "official")).status, 409)
    const { auth } = signIn({ trusted: 1 })
    const guest = await uploadImage(auth)
    assert.strictEqual((await moveTo(adminAuth, guest.id, "honeymoon")).status, 409)
    assert.strictEqual((await moveTo(adminAuth, official.id, "content")).status, 400)
    const row = /** @type {any} */ (
      db.prepare("SELECT section FROM media WHERE id = ?").get(guest.id)
    )
    assert.strictEqual(row.section, "guest", "the guest photo stayed put")
  })

  it("the section move is admin-only", async () => {
    const { auth } = signIn({ trusted: 1 })
    const guest = await uploadImage(auth)
    const res = await accountFetch(
      `/api/admin/media/${guest.id}/section`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "honeymoon" }),
      },
      auth,
    )
    assert.ok(res.status === 401 || res.status === 403, `refused (${res.status})`)
  })
})

describe("guest photo captions", () => {
  it("finalize stores an optional caption, surfaced on the item", async () => {
    const { auth } = signIn({ trusted: 1, name: "Capper" })
    const { data } = await createSession({ kind: "image", originalBytes: 256 }, auth)
    await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", auth)
    await putVariant(data.id, "display", makeJpeg(200), "image/jpeg", auth)
    await putVariant(data.id, "thumb", makeJpeg(120), "image/jpeg", auth)
    const fin = await finalize(
      data.id,
      { width: 1200, height: 800, caption: "  Golden hour  " },
      auth,
    )
    assert.strictEqual(fin.status, 200)

    const item = await json(await fetch(`${BASE_URL}/api/media/${data.id}`))
    assert.strictEqual(item.caption, "Golden hour", "caption trimmed + stored at finalize")
  })

  it("PATCH caption updates the owner's item; a non-owner gets 404", async () => {
    const { auth } = signIn({ trusted: 1, name: "Owner" })
    const { id } = await uploadImage(auth)

    const patched = await accountFetch(
      `/api/media/${id}/caption`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: "Later thought" }),
      },
      auth,
    )
    assert.strictEqual(patched.status, 200)
    assert.strictEqual((await json(patched)).caption, "Later thought")

    // A different account cannot caption someone else's item.
    const { auth: other } = signIn({ trusted: 1, name: "Nosy" })
    const denied = await accountFetch(
      `/api/media/${id}/caption`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: "hijack" }),
      },
      other,
    )
    assert.strictEqual(denied.status, 404, "non-owner caption edit is 404")

    // Empty caption clears it back to null.
    const cleared = await accountFetch(
      `/api/media/${id}/caption`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: "   " }),
      },
      auth,
    )
    assert.strictEqual((await json(cleared)).caption, null, "blank caption → null")
  })
})

describe("gallery contributors + moments-count aggregates (wow pack)", () => {
  it("contributors strip: distinct visible authors, excludes others' pending", async () => {
    const { auth: alice } = signIn({ trusted: 1, name: "Alice" })
    await uploadImage(alice)
    await uploadImage(alice)
    const { auth: bob } = signIn({ trusted: 1, name: "Bob" })
    await uploadImage(bob)
    // Untrusted Cara → pending upload must not credit her nor count.
    const { auth: cara } = signIn({ trusted: 0, name: "Cara" })
    const pending = await uploadImage(cara)
    assert.strictEqual((await json(pending.finalizeRes)).status, "pending")

    const body = await json(await fetch(`${BASE_URL}/api/media?section=guest`))
    assert.ok(body.contributors, "contributors aggregate rides on the first guest page")
    assert.strictEqual(body.contributors.photos, 3, "3 approved guest photos")
    assert.strictEqual(body.contributors.guests, 2, "2 distinct visible contributors")
    assert.ok(body.contributors.names.includes("Alice"), "Alice credited")
    assert.ok(body.contributors.names.includes("Bob"), "Bob credited")
    assert.ok(!body.contributors.names.includes("Cara"), "pending uploader not credited")
  })

  it("contributors: attached to the first page only, not later keyset pages", async () => {
    const { auth } = signIn({ trusted: 1, name: "Solo" })
    for (let i = 0; i < 3; i++) await uploadImage(auth)

    const page1 = await json(await fetch(`${BASE_URL}/api/media?section=guest&limit=2`))
    assert.ok(page1.contributors, "first page carries the aggregate")
    assert.strictEqual(page1.contributors.photos, 3)

    const page2 = await json(
      await fetch(`${BASE_URL}/api/media?section=guest&limit=2&before=${page1.nextCursor}`),
    )
    assert.strictEqual(page2.contributors, undefined, "later pages omit the aggregate")
  })

  it("contributors: a self-deleted photo drops from the counts", async () => {
    const { auth } = signIn({ trusted: 1, name: "Deleter" })
    const first = await uploadImage(auth)
    await uploadImage(auth)

    const del = await accountFetch(`/api/media/${first.id}`, { method: "DELETE" }, auth)
    assert.strictEqual(del.status, 200, "owner self-delete succeeds")

    const body = await json(await fetch(`${BASE_URL}/api/media?section=guest`))
    assert.strictEqual(body.contributors.photos, 1, "deleted photo no longer counted")
    assert.strictEqual(body.contributors.guests, 1)
  })

  it("contributors: a soft-deleted account's uploads don't credit or count", async () => {
    const { auth: keep, accountId: keepId } = signIn({ trusted: 1, name: "Keeper" })
    await uploadImage(keep)
    const { auth: gone, accountId: goneId } = signIn({ trusted: 1, name: "Ghost" })
    await uploadImage(gone)

    // Soft-delete Ghost's account: their approved upload must drop out (mirrors
    // the feed's account-liveness gate), leaving one visible contributor.
    db.prepare(`UPDATE accounts SET deleted_at = datetime('now') WHERE id = ?`).run(goneId)

    const body = await json(await fetch(`${BASE_URL}/api/media?section=guest`))
    assert.strictEqual(body.contributors.photos, 1, "only the live account's photo counts")
    assert.strictEqual(body.contributors.guests, 1)
    assert.ok(body.contributors.names.includes("Keeper"))
    assert.ok(!body.contributors.names.includes("Ghost"))
    assert.ok(keepId && goneId)
  })

  it("/api/config exposes the public moments count (photos + notes)", async () => {
    const { auth, accountId } = signIn({ trusted: 1, name: "Counter" })
    await uploadImage(auth) // approved guest photo
    await uploadImage(auth) // approved guest photo
    // One approved guestbook note + one pending (pending excluded from the tally).
    db.prepare(
      `INSERT INTO guestbook_entries (account_id, message, status) VALUES (?, ?, 'approved')`,
    ).run(accountId, "What a day!")
    db.prepare(
      `INSERT INTO guestbook_entries (account_id, message, status) VALUES (?, ?, 'pending')`,
    ).run(accountId, "held for review")

    const cfg = await json(await fetch(`${BASE_URL}/api/config`))
    assert.ok(cfg.counts, "config carries the counts object")
    assert.strictEqual(cfg.counts.photos, 2, "approved guest photos counted")
    assert.strictEqual(cfg.counts.notes, 1, "only approved guestbook notes counted")
  })
})

describe("finishing an upload hidden: a culled import", () => {
  /** @returns {Promise<any>} */
  async function adminAuthFor() {
    const a = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
    return { cookieHeader: a.cookieHeader, csrfToken: a.csrfToken }
  }

  /** Full image upload → { id, fileKey, finalizeRes }.
   * @param {any} auth @param {any} fetcher @param {Record<string, unknown>} finalizeBody
   * @param {string} [section] @param {string} [kind] */
  async function upload(auth, fetcher, finalizeBody, section = "official", kind = "image") {
    const { res, data } = await createSession({ kind, originalBytes: 256, section }, auth, fetcher)
    assert.strictEqual(res.status, 201)
    if (kind === "video") {
      await putVariant(data.id, "original", makeMp4(256), "video/mp4", auth, fetcher)
      await putVariant(data.id, "poster", makeJpeg(120), "image/jpeg", auth, fetcher)
    } else {
      await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", auth, fetcher)
      await putVariant(data.id, "display", makeJpeg(200), "image/jpeg", auth, fetcher)
      await putVariant(data.id, "thumb", makeJpeg(120), "image/jpeg", auth, fetcher)
    }
    const finalizeRes = await finalize(
      data.id,
      { width: 1200, height: 800, ...finalizeBody },
      auth,
      fetcher,
    )
    return { id: Number(data.id), fileKey: String(data.fileKey), finalizeRes }
  }

  /** Every public read of a media row, and that the row is in none of them.
   * @param {{ id: number, fileKey: string }} item @param {any} [guestAuth] */
  async function assertNowherePublic(item, guestAuth) {
    const reads = [
      (/** @type {string} */ path) => fetch(`${BASE_URL}${path}`),
      ...(guestAuth
        ? [(/** @type {string} */ path) => accountFetch(path, { method: "GET" }, guestAuth)]
        : []),
    ]
    for (const read of reads) {
      for (const section of ["official", "honeymoon", "guest"]) {
        const page = await json(await read(`/api/media?section=${section}`))
        assert.ok(
          !page.items.some((/** @type {any} */ row) => row.id === item.id),
          `listed in ${section}`,
        )
      }
      assert.strictEqual((await read(`/api/media/${item.id}`)).status, 404, "by id")
      assert.strictEqual((await read(`/api/media/${item.id}/comments`)).status, 404, "comments")
      for (const variant of ["thumb", "display", "original", "poster", "video"]) {
        const res = await read(`/media/${item.fileKey}/${variant}`)
        assert.strictEqual(res.status, 404, `bytes: ${variant}`)
        await res.arrayBuffer()
      }
    }
    // HEAD and Range go through the same gate.
    const head = await fetch(`${BASE_URL}/media/${item.fileKey}/thumb`, { method: "HEAD" })
    assert.strictEqual(head.status, 404, "HEAD")
    const ranged = await fetch(`${BASE_URL}/media/${item.fileKey}/thumb`, {
      headers: { Range: "bytes=0-1" },
    })
    assert.strictEqual(ranged.status, 404, "Range")
    const conditional = await fetch(`${BASE_URL}/media/${item.fileKey}/thumb`, {
      headers: { "If-None-Match": `"${item.fileKey}-thumb"` },
    })
    assert.strictEqual(conditional.status, 404, "a conditional request confirms nothing")
  }

  /** @param {any} auth @param {string} [section] @returns {Promise<any[]>} */
  async function adminList(auth, section = "official") {
    const res = await adminFetch(`/api/admin/media/curated?section=${section}`, {}, auth)
    assert.strictEqual(res.status, 200)
    return (await json(res)).items
  }

  /** @param {any} auth @param {Record<string, unknown>} body */
  function reorder(auth, body) {
    return adminFetch(
      "/api/admin/media/reorder",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      auth,
    )
  }

  it("an admin finishes a photo and a video hidden, and they are public nowhere", async () => {
    const auth = await adminAuthFor()
    const { auth: guest } = signIn({ trusted: 1, name: "Curious" })
    for (const kind of ["image", "video"]) {
      const item = await upload(auth, adminFetch, { hidden: true }, "official", kind)
      assert.strictEqual(item.finalizeRes.status, 200)
      assert.strictEqual((await json(item.finalizeRes)).status, "hidden")
      await assertNowherePublic(item, guest)
    }
  })

  it("never reaches first-page aggregates or public counts", async () => {
    const auth = await adminAuthFor()
    const before = {
      feed: await json(await fetch(`${BASE_URL}/api/media?section=guest`)),
      config: await json(await fetch(`${BASE_URL}/api/config`)),
    }
    const item = await upload(auth, adminFetch, { hidden: true }, "guest")
    assert.strictEqual((await json(item.finalizeRes)).status, "hidden")
    await upload(auth, adminFetch, { hidden: true }, "official")

    const after = {
      feed: await json(await fetch(`${BASE_URL}/api/media?section=guest`)),
      config: await json(await fetch(`${BASE_URL}/api/config`)),
    }
    assert.deepStrictEqual(after.feed.contributors, before.feed.contributors, "contributors")
    assert.deepStrictEqual(after.config.counts, before.config.counts, "landing-page counts")
    await assertNowherePublic(item)
  })

  it("can't be reacted to or commented on by a guest who guesses the id", async () => {
    const auth = await adminAuthFor()
    const item = await upload(auth, adminFetch, { hidden: true })
    const { auth: guest } = signIn({ trusted: 1, name: "Guesser" })
    const headers = { "Content-Type": "application/json" }
    const comment = await accountFetch(
      `/api/media/${item.id}/comments`,
      { method: "POST", headers, body: JSON.stringify({ message: "hello" }) },
      guest,
    )
    assert.strictEqual(comment.status, 404)
    const reaction = await accountFetch(
      "/api/reactions/toggle",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ target_type: "media", target_id: item.id, emoji: "heart" }),
      },
      guest,
    )
    assert.strictEqual(reaction.status, 404)
  })

  it("a guest asking for hidden gets normal moderation, trusted or not", async () => {
    for (const hidden of [true, "true", 1]) {
      const trusted = signIn({ trusted: 1, name: "Trusted Guest" })
      const asTrusted = await upload(trusted.auth, accountFetch, { hidden }, "guest")
      assert.strictEqual(asTrusted.finalizeRes.status, 200)
      assert.strictEqual((await json(asTrusted.finalizeRes)).status, "approved")

      const untrusted = signIn({ trusted: 0, name: "Untrusted Guest" })
      const asUntrusted = await upload(untrusted.auth, accountFetch, { hidden }, "guest")
      assert.strictEqual(asUntrusted.finalizeRes.status, 200)
      assert.strictEqual((await json(asUntrusted.finalizeRes)).status, "pending")
    }
    // Naming the status directly does nothing, for anyone.
    const { auth } = signIn({ trusted: 1, name: "Status Namer" })
    const named = await upload(auth, accountFetch, { status: "hidden" }, "guest")
    assert.strictEqual((await json(named.finalizeRes)).status, "approved")
  })

  it("refuses an admin's malformed value rather than publishing the photo", async () => {
    const auth = await adminAuthFor()
    for (const hidden of ["true", 1, null]) {
      const { res, data } = await createSession(
        { kind: "image", originalBytes: 256, section: "official" },
        auth,
        adminFetch,
      )
      assert.strictEqual(res.status, 201)
      await putVariant(data.id, "original", makeJpeg(256), "image/jpeg", auth, adminFetch)
      await putVariant(data.id, "display", makeJpeg(200), "image/jpeg", auth, adminFetch)
      await putVariant(data.id, "thumb", makeJpeg(120), "image/jpeg", auth, adminFetch)
      const refused = await finalize(data.id, { width: 10, height: 10, hidden }, auth, adminFetch)
      assert.strictEqual(refused.status, 400, String(hidden))
      const row = /** @type {any} */ (db.prepare("SELECT status FROM media WHERE id = ?").get(data.id))
      assert.strictEqual(row.status, "uploading", "still unfinished, so it can be retried")
      const retried = await finalize(data.id, { width: 10, height: 10, hidden: false }, auth, adminFetch)
      assert.strictEqual((await json(retried)).status, "approved")
    }
  })

  it("re-finalizing a hidden row stays hidden, so a retried request can't publish it", async () => {
    const auth = await adminAuthFor()
    const item = await upload(auth, adminFetch, { hidden: true })
    const again = await finalize(item.id, { width: 1, height: 1 }, auth, adminFetch)
    assert.strictEqual((await json(again)).status, "hidden")
  })

  it("serves hidden bytes to an admin, marked so no shared cache keeps them", async () => {
    const auth = await adminAuthFor()
    const item = await upload(auth, adminFetch, { hidden: true })
    const res = await adminFetch(`/media/${item.fileKey}/thumb`, {}, auth)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get("cache-control"), "private, no-cache")
    await res.arrayBuffer()

    // Unhidden, it's an ordinary curated photo again, and public.
    const unhide = await adminFetch(
      `/api/admin/moderation/media/${item.id}/approve`,
      { method: "POST" },
      auth,
    )
    assert.strictEqual(unhide.status, 200)
    const open = await fetch(`${BASE_URL}/media/${item.fileKey}/thumb`)
    assert.strictEqual(open.status, 200)
    assert.strictEqual(open.headers.get("cache-control"), "public, max-age=31536000, immutable")
    await open.arrayBuffer()
  })

  it("the admin listing is admin-only, and names exactly the set reorder accepts", async () => {
    const auth = await adminAuthFor()
    const anon = await fetch(`${BASE_URL}/api/admin/media/curated?section=official`)
    assert.strictEqual(anon.status, 401)
    const { auth: guest } = signIn({ trusted: 1, name: "Prober" })
    const asGuest = await accountFetch("/api/admin/media/curated?section=official", {}, guest)
    assert.strictEqual(asGuest.status, 401)
    const bad = await adminFetch("/api/admin/media/curated?section=content", {}, auth)
    assert.strictEqual(bad.status, 400)

    const shown = await upload(auth, adminFetch, {})
    const hidden = await upload(auth, adminFetch, { hidden: true })
    // A session left open: no public view has it, and reorder still demands it.
    const { data: inFlight } = await createSession(
      { kind: "image", originalBytes: 16, section: "official" },
      auth,
      adminFetch,
    )
    const items = await adminList(auth)
    const byId = new Map(items.map((row) => [row.id, row.status]))
    assert.strictEqual(byId.get(shown.id), "approved")
    assert.strictEqual(byId.get(hidden.id), "hidden")
    assert.strictEqual(byId.get(Number(inFlight.id)), "uploading")

    const ok = await reorder(auth, { ids: items.map((row) => row.id).reverse() })
    assert.strictEqual(ok.status, 200, "the listing is a set reorder accepts")

    // The public feed is not: that's the bug this listing fixes.
    const feed = await json(await fetch(`${BASE_URL}/api/media?section=official`))
    const refused = await reorder(auth, { ids: feed.items.map((/** @type {any} */ r) => r.id) })
    assert.strictEqual(refused.status, 400)
  })

  it("reorders a mostly hidden section, and guests see the new order", async () => {
    const auth = await adminAuthFor()
    const items = []
    for (let i = 0; i < 9; i++) {
      items.push(await upload(auth, adminFetch, { hidden: i % 3 !== 0 }, "honeymoon"))
    }
    const listed = await adminList(auth, "honeymoon")
    const reversed = listed.map((row) => row.id).reverse()
    const res = await reorder(auth, { ids: reversed, section: "honeymoon" })
    assert.strictEqual(res.status, 200)

    assert.deepStrictEqual(
      (await adminList(auth, "honeymoon")).map((row) => row.id),
      reversed,
      "every row moved, hidden ones included",
    )
    const visibleIds = new Set(items.filter((_, i) => i % 3 === 0).map((item) => item.id))
    const feed = await json(await fetch(`${BASE_URL}/api/media?section=honeymoon`))
    assert.deepStrictEqual(
      feed.items.map((/** @type {any} */ row) => row.id),
      reversed.filter((id) => visibleIds.has(id)),
      "guests see the visible ones, in the new order",
    )
    for (const row of listed) {
      if (row.status === "hidden") {
        assert.ok(!feed.items.some((/** @type {any} */ item) => item.id === row.id))
      }
    }
  })

  it("moves a hidden photo between sections, still hidden, and unhides it there", async () => {
    const auth = await adminAuthFor()
    const item = await upload(auth, adminFetch, { hidden: true })
    const moved = await adminFetch(
      `/api/admin/media/${item.id}/section`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "honeymoon" }),
      },
      auth,
    )
    assert.strictEqual(moved.status, 200)
    const there = (await adminList(auth, "honeymoon")).find((row) => row.id === item.id)
    assert.strictEqual(there?.status, "hidden", "moving doesn't publish it")
    assert.ok(!(await adminList(auth, "official")).some((row) => row.id === item.id))
    await assertNowherePublic(item)

    const unhide = await adminFetch(
      `/api/admin/moderation/media/${item.id}/approve`,
      { method: "POST" },
      auth,
    )
    assert.strictEqual(unhide.status, 200)
    const feed = await json(await fetch(`${BASE_URL}/api/media?section=honeymoon`))
    assert.ok(feed.items.some((/** @type {any} */ row) => row.id === item.id), "public once unhidden")
  })

  it("an unhidden photo returns to its place in the order", async () => {
    const auth = await adminAuthFor()
    const first = await upload(auth, adminFetch, {}, "honeymoon")
    const second = await upload(auth, adminFetch, { hidden: true }, "honeymoon")
    const third = await upload(auth, adminFetch, {}, "honeymoon")
    const others = (await adminList(auth, "honeymoon"))
      .map((row) => row.id)
      .filter((id) => ![first.id, second.id, third.id].includes(id))
    const order = [first.id, second.id, third.id, ...others]
    assert.strictEqual((await reorder(auth, { ids: order, section: "honeymoon" })).status, 200)

    await adminFetch(`/api/admin/moderation/media/${second.id}/approve`, { method: "POST" }, auth)
    const feed = await json(await fetch(`${BASE_URL}/api/media?section=honeymoon`))
    assert.deepStrictEqual(
      feed.items.slice(0, 3).map((/** @type {any} */ row) => row.id),
      [first.id, second.id, third.id],
    )
  })

  it("the capacity endpoint is admin-only, and counts hidden rows", async () => {
    const anon = await fetch(`${BASE_URL}/api/admin/media/capacity`)
    assert.strictEqual(anon.status, 401)
    const { auth: guest } = signIn({ trusted: 1, name: "Sizer" })
    assert.strictEqual((await accountFetch("/api/admin/media/capacity", {}, guest)).status, 401)

    const auth = await adminAuthFor()
    const read = async () => json(await adminFetch("/api/admin/media/capacity", {}, auth))
    const before = await read()
    assert.strictEqual(typeof before.maxTotalBytes, "number")
    assert.strictEqual(typeof before.remainingBytes, "number")
    assert.ok(before.limitedBy === "cap" || before.limitedBy === "disk")

    const item = await upload(auth, adminFetch, { hidden: true })
    assert.strictEqual((await json(item.finalizeRes)).status, "hidden")
    const after = await read()
    assert.ok(after.storedBytes > before.storedBytes, "a hidden row's bytes count")
    assert.ok(after.remainingBytes < before.remainingBytes || after.limitedBy === "disk")
  })
})

describe("curated sections page in the couple's order", () => {
  /** @typedef {{ section?: string, status?: string, sortOrder: number, deleted?: boolean }} SeedRow */

  /**
   * Seed curated rows straight into the table: listing reads rows, never bytes.
   * @param {SeedRow[]} rows
   * @returns {number[]} the new ids, in the order given
   */
  function seed(rows) {
    const insert = db.prepare(
      `INSERT INTO media (file_key, kind, section, status, sort_order, width, height, deleted_at)
       VALUES (?, 'image', ?, ?, ?, 800, 600, ?)`,
    )
    /** @type {number[]} */
    const ids = []
    db.exec("BEGIN")
    for (const row of rows) {
      const result = insert.run(
        crypto.randomBytes(16).toString("hex"),
        row.section ?? "official",
        row.status ?? "approved",
        row.sortOrder,
        row.deleted ? new Date().toISOString() : null,
      )
      ids.push(Number(result.lastInsertRowid))
    }
    db.exec("COMMIT")
    return ids
  }

  /** The ids a guest should see, in the order they should see them.
   * @param {string} section @returns {number[]} */
  function expectedOrder(section) {
    return db
      .prepare(
        `SELECT id FROM media WHERE section = ? AND status = 'approved' AND deleted_at IS NULL
         ORDER BY sort_order, id`,
      )
      .all(section)
      .map((row) => Number(/** @type {any} */ (row).id))
  }

  /**
   * Follow nextCursor to the end, the way the gallery does.
   * @param {string} section @param {number | null} limit
   * @returns {Promise<{ ids: number[], pages: any[] }>}
   */
  async function walk(section, limit) {
    /** @type {any[]} */
    const pages = []
    /** @type {string | null} */
    let cursor = null
    do {
      const query = new URLSearchParams({ section })
      if (limit !== null) query.set("limit", String(limit))
      if (cursor !== null) query.set("after", cursor)
      const res = await fetch(`${BASE_URL}/api/media?${query}`)
      assert.strictEqual(res.status, 200)
      const page = await json(res)
      pages.push(page)
      cursor = page.nextCursor
      assert.ok(pages.length < 100, "the walk ends")
    } while (cursor !== null)
    return { ids: pages.flatMap((page) => page.items.map((/** @type {any} */ i) => i.id)), pages }
  }

  it("returns every visible row once, in (sort_order, id) order, across pages", async () => {
    // Ties on sort_order (an import appends several at one value), ids that run
    // against the order, and every status a guest must never see, interleaved.
    /** @type {SeedRow[]} */
    const rows = []
    for (let i = 0; i < 23; i++) rows.push({ sortOrder: 10 - Math.floor(i / 3) })
    for (const status of ["hidden", "pending", "rejected", "uploading"]) {
      rows.push({ status, sortOrder: 4 }, { status, sortOrder: 0 })
    }
    rows.push({ sortOrder: 5, deleted: true }, { section: "honeymoon", sortOrder: 5 })
    seed(rows)

    const expected = expectedOrder("official")
    assert.strictEqual(expected.length, 23)

    const { ids, pages } = await walk("official", 5)
    assert.deepStrictEqual(ids, expected, "every row, once, in order")
    assert.strictEqual(pages.length, 5, "5 + 5 + 5 + 5 + 3")
    for (const page of pages.slice(0, -1)) {
      assert.strictEqual(page.items.length, 5)
      assert.strictEqual(typeof page.nextCursor, "string", "a curated cursor is opaque")
    }
    assert.strictEqual(pages[pages.length - 1].nextCursor, null)
    assert.ok(
      pages.every((page) => page.items.every((/** @type {any} */ i) => i.status === "approved")),
      "hidden, pending, rejected and in-flight rows never appear",
    )

    // A signed-in guest walks the same rows: no one's pending curated row leaks.
    const { auth } = signIn({ trusted: 1, name: "Walker" })
    const first = await json(await accountFetch("/api/media?section=official&limit=50", {}, auth))
    assert.deepStrictEqual(
      first.items.map((/** @type {any} */ i) => i.id),
      expected,
    )
  })

  it("a section that fills its last page exactly ends there, not on an empty page", async () => {
    seed(Array.from({ length: 6 }, (_, i) => ({ sortOrder: i })))
    const { pages } = await walk("official", 3)
    assert.strictEqual(pages.length, 2)
    assert.strictEqual(pages[1].items.length, 3)
    assert.strictEqual(pages[1].nextCursor, null)
  })

  it("more than 500 official photos: the newest import is no longer cut off", async () => {
    // The launch bug: one 500-row page and nextCursor null, so whatever an
    // import appended past row 500 was invisible. Default page size here.
    seed(Array.from({ length: 620 }, (_, i) => ({ sortOrder: i })))
    const expected = expectedOrder("official")
    const { ids, pages } = await walk("official", null)
    assert.strictEqual(pages[0].items.length, 500, "the page cap is unchanged")
    assert.strictEqual(ids.length, 620)
    assert.deepStrictEqual(ids, expected)
    assert.strictEqual(ids[ids.length - 1], expected[619], "the last photo is reachable")
  })

  it("honeymoon pages the same way", async () => {
    seed(Array.from({ length: 7 }, (_, i) => ({ section: "honeymoon", sortOrder: 7 - i })))
    const { ids } = await walk("honeymoon", 2)
    assert.deepStrictEqual(ids, expectedOrder("honeymoon"))
  })

  it("refuses a malformed cursor with a 400, and ignores the other section kind's", async () => {
    seed(Array.from({ length: 4 }, (_, i) => ({ sortOrder: i })))
    const bad = [
      "abc",
      "12",
      "1_",
      "_1",
      "1_2_3",
      "1.5_2",
      "1_2.0",
      "01_2",
      "1e3_2",
      " 1_2",
      "1_0",
      "1_-2",
      "9007199254740993_1",
    ]
    for (const cursor of bad) {
      for (const section of ["official", "honeymoon"]) {
        const res = await fetch(
          `${BASE_URL}/api/media?section=${section}&after=${encodeURIComponent(cursor)}`,
        )
        assert.strictEqual(res.status, 400, `${section} after=${JSON.stringify(cursor)}`)
        assert.strictEqual((await json(res)).code, "VALIDATION_ERROR")
      }
    }

    // A negative sort_order is a real position, not a malformed one.
    const negative = await fetch(`${BASE_URL}/api/media?section=official&after=-3_1`)
    assert.strictEqual(negative.status, 200)
    assert.strictEqual((await json(negative)).items.length, 4)

    // `before` means nothing to a curated section, `after` nothing to guest.
    const curated = await json(await fetch(`${BASE_URL}/api/media?section=official&before=2`))
    assert.strictEqual(curated.items.length, 4)
    const guest = await fetch(`${BASE_URL}/api/media?section=guest&after=nonsense`)
    assert.strictEqual(guest.status, 200)
  })

  it("a cursor still works after its row is deleted: a position, not a reference", async () => {
    const ids = seed(Array.from({ length: 6 }, (_, i) => ({ sortOrder: i })))
    const page1 = await json(await fetch(`${BASE_URL}/api/media?section=official&limit=3`))
    db.prepare("UPDATE media SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), ids[2])
    const page2 = await json(
      await fetch(`${BASE_URL}/api/media?section=official&limit=3&after=${page1.nextCursor}`),
    )
    assert.deepStrictEqual(
      page2.items.map((/** @type {any} */ i) => i.id),
      ids.slice(3),
    )
  })

  it("a reorder between two page loads answers from the new order, without failing", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    // Documented behaviour (public/pages/gallery/grid.js): the cursor is the last
    // row's (sort_order, id) position, so the next page is whatever follows that
    // position in the NEW order. A photo moved from page one onto a later page
    // comes back again — the client drops it by id (paging.js freshItems) — and
    // a photo moved onto page one is missed until the next visit. Nothing 400s,
    // and nothing a guest may not see appears.
    const ids = seed([
      ...Array.from({ length: 8 }, (_, i) => ({ sortOrder: i })),
      { status: "hidden", sortOrder: 8 },
    ])
    const page1 = await json(await fetch(`${BASE_URL}/api/media?section=official&limit=4`))
    assert.deepStrictEqual(
      page1.items.map((/** @type {any} */ i) => i.id),
      ids.slice(0, 4),
    )

    const auth = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
    const reversed = [...ids].reverse()
    const res = await adminFetch(
      "/api/admin/media/reorder",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reversed, section: "official" }),
      },
      auth,
    )
    assert.strictEqual(res.status, 200)

    const after = await fetch(
      `${BASE_URL}/api/media?section=official&limit=4&after=${page1.nextCursor}`,
    )
    assert.strictEqual(after.status, 200, "a stale cursor is not an error")
    const page2 = await json(after)
    const page2Ids = page2.items.map((/** @type {any} */ i) => i.id)
    // Reversed, sort_order runs ids[8]=0 … ids[0]=8. The stale cursor is
    // (3, ids[3]), so the page starts at ids[5] (sort_order 3, larger id):
    // ids[5], ids[4], then ids[3] and ids[2], which page one already showed.
    // ids[7] and ids[6] now sit before the cursor and are missed this visit.
    assert.deepStrictEqual(page2Ids, [ids[5], ids[4], ids[3], ids[2]])
    assert.ok(!page2Ids.includes(ids[8]), "the hidden row stays hidden")

    // What the client keeps: page one, plus page two minus what it already has.
    const seen = new Set(page1.items.map((/** @type {any} */ i) => i.id))
    const fresh = page2Ids.filter((/** @type {number} */ id) => !seen.has(id))
    assert.deepStrictEqual(fresh, [ids[5], ids[4]], "repeats are dropped, so no cell renders twice")

    // And the walk still ends.
    const page3 = await json(
      await fetch(`${BASE_URL}/api/media?section=official&limit=4&after=${page2.nextCursor}`),
    )
    assert.deepStrictEqual(
      page3.items.map((/** @type {any} */ i) => i.id),
      [ids[1], ids[0]],
    )
    assert.strictEqual(page3.nextCursor, null)
  })
})
