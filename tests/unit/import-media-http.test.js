/** @file Unit tests for the importer's HTTP sink, against a bare node:http
 *  server rather than the real app.
 *
 *  The point is the transport contract, which is where this sink can go wrong in
 *  ways the real server would only reveal on a 200-photo run: an exact
 *  Content-Length (streamToStaging 411s without one and verifies it
 *  byte-for-byte), the CSRF header, absorbing a rotated cookie mid-run, and a
 *  retry policy that backs off on 5xx but never re-sends a 413. */

import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import { createHttpSink } from "../../scripts/lib/sink-http.js"

/** Every request the fake server saw. */
/** @type {{ method: string, url: string, headers: import('node:http').IncomingHttpHeaders, bodyBytes: number, body: string }[]} */
let seen = []

/** Queued responses, consumed in order; the last one repeats. */
/** @type {{ status: number, json?: unknown, setCookie?: string[] }[]} */
let responses = []

/** @type {http.Server} */
let server
/** @type {string} */
let origin
/** @type {string} */
let tmpDir

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "import-http-test-"))
  server = http.createServer((req, res) => {
    /** @type {Buffer[]} */
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      const body = Buffer.concat(chunks)
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        bodyBytes: body.length,
        body: body.toString("utf8"),
      })
      const next = responses.length > 1 ? responses.shift() : responses[0]
      const reply = next ?? { status: 200, json: {} }
      /** @type {Record<string, string | string[]>} */
      const headers = { "Content-Type": "application/json" }
      if (reply.setCookie) headers["Set-Cookie"] = reply.setCookie
      res.writeHead(reply.status, headers)
      res.end(JSON.stringify(reply.json ?? {}))
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(null)))
  const address = /** @type {import('node:net').AddressInfo} */ (server.address())
  origin = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise((resolve) => server.close(() => resolve(null)))
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

/** Reset the fake server between tests. */
function reset(/** @type {{ status: number, json?: unknown, setCookie?: string[] }[]} */ queue) {
  seen = []
  responses = queue
}

/** Cookies the login step hands back. */
const LOGIN_COOKIES = [
  "session=sess-1; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400",
  "csrf=csrf-1; Path=/; SameSite=Strict; Max-Age=86400",
]

/** A sink with the password supplied out-of-band, as a non-TTY run would. */
function sink(overrides = {}) {
  process.env.WEDDING_ADMIN_PASSWORD = "test-password"
  return createHttpSink({ url: origin, stderr: { write: () => {} }, ...overrides })
}

/** @param {string} name @param {number} bytes */
function fixtureFile(name, bytes) {
  const target = path.join(tmpDir, name)
  fs.writeFileSync(target, Buffer.alloc(bytes, 0x41))
  return target
}

describe("sink-http preflight", () => {
  it("checks the destination over an unauthenticated GET, so --dry-run never logs in", async () => {
    reset([{ status: 200, json: { uploadsFreeBytes: 12345 } }])
    delete process.env.WEDDING_ADMIN_PASSWORD

    const result = await createHttpSink({ url: origin }).preflight()

    assert.equal(result.ok, true)
    assert.equal(result.freeBytes, 12345)
    assert.deepEqual(
      seen.map((r) => [r.method, r.url]),
      [["GET", "/api/health"]],
    )
    // The caveats are surfaced up front, not discovered after 200 uploads.
    assert.ok(!result.message?.includes("hidden or rejected"), "reorder can name those now")
    assert.ok(result.message?.includes("sort_order"))
    assert.ok(result.message?.includes("attributed to the couple"))
  })

  it("reports a wrong URL as a failed preflight rather than throwing", async () => {
    reset([{ status: 404, json: {} }])
    const result = await createHttpSink({ url: origin }).preflight()
    assert.equal(result.ok, false)
    assert.ok(result.message?.includes("wrong URL"))
  })
})

describe("sink-http session and upload", () => {
  it("logs in once, then sends the CSRF header on every mutation", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 201, json: { id: 5, fileKey: "abc" } },
      { status: 201, json: { id: 6, fileKey: "def" } },
    ])
    const s = sink()

    const first = await s.createSession({ kind: "image", originalBytes: 100, section: "official" })
    const second = await s.createSession({ kind: "image", originalBytes: 200, section: "official" })

    assert.deepEqual(first, { id: 5, fileKey: "abc" })
    assert.deepEqual(second, { id: 6, fileKey: "def" })
    assert.deepEqual(
      seen.map((r) => [r.method, r.url]),
      [
        ["POST", "/api/admin/login"],
        ["POST", "/api/media"],
        ["POST", "/api/media"],
      ],
    )
    // The password is in the login body only, never a query string or a header.
    assert.ok(seen[0].body.includes("test-password"))
    assert.equal(seen[1].headers["x-csrf-token"], "csrf-1")
    assert.equal(seen[2].headers["x-csrf-token"], "csrf-1")
    assert.ok(String(seen[1].headers.cookie).includes("session=sess-1"))
  })

  it("logs in exactly once even when several workers start at the same moment", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 201, json: { id: 1, fileKey: "a" } },
    ])
    const s = sink()

    // Without a shared in-flight login promise this issues four logins, each
    // one's Set-Cookie overwriting the jar — so a request already in flight
    // pairs one login's session cookie with another's CSRF token and 401s.
    await Promise.all(
      [1, 2, 3, 4].map(() =>
        s.createSession({ kind: "image", originalBytes: 1, section: "official" }),
      ),
    )

    assert.deepEqual(
      seen.filter((r) => r.url === "/api/admin/login").map((r) => r.method),
      ["POST"],
    )
    assert.equal(seen.filter((r) => r.url === "/api/media").length, 4)
  })

  it("streams a variant with the exact Content-Length the server verifies", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 201, json: { id: 9, fileKey: "k" } },
      { status: 200, json: { variant: "display", bytes: 4096 } },
    ])
    const s = sink()
    await s.createSession({ kind: "image", originalBytes: 4096, section: "official" })
    const file = fixtureFile("display.webp", 4096)

    const result = await s.putVariant(9, "display", {
      path: file,
      bytes: 4096,
      contentType: "image/webp",
    })

    const put = seen[seen.length - 1]
    assert.equal(put.method, "PUT")
    assert.equal(put.url, "/api/media/9/display")
    // No Content-Length means chunked, which core/upload.js rejects with 411.
    assert.equal(put.headers["content-length"], "4096")
    assert.equal(put.headers["transfer-encoding"], undefined)
    assert.equal(put.headers["content-type"], "image/webp")
    assert.equal(put.bodyBytes, 4096)
    assert.equal(result.bytes, 4096)
  })

  it("absorbs a rotated CSRF cookie mid-run and uses it on the next request", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      // The one-hour rotation: a normal 201 that happens to carry a new token.
      {
        status: 201,
        json: { id: 1, fileKey: "a" },
        setCookie: ["csrf=csrf-2; Path=/; SameSite=Strict; Max-Age=86400"],
      },
      { status: 201, json: { id: 2, fileKey: "b" } },
    ])
    const s = sink()

    await s.createSession({ kind: "image", originalBytes: 1, section: "official" })
    await s.createSession({ kind: "image", originalBytes: 1, section: "official" })

    assert.equal(seen[1].headers["x-csrf-token"], "csrf-1")
    assert.equal(seen[2].headers["x-csrf-token"], "csrf-2")
  })

  it("retries a rotated-CSRF 403 exactly once, with the refreshed token", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      {
        status: 403,
        json: { error: "Invalid CSRF token", code: "CSRF" },
        setCookie: ["csrf=csrf-fresh; Path=/; SameSite=Strict; Max-Age=86400"],
      },
      { status: 201, json: { id: 3, fileKey: "c" } },
    ])
    const s = sink()

    const created = await s.createSession({ kind: "image", originalBytes: 1, section: "official" })

    assert.deepEqual(created, { id: 3, fileKey: "c" })
    assert.equal(seen.length, 3)
    assert.equal(seen[1].headers["x-csrf-token"], "csrf-1")
    assert.equal(seen[2].headers["x-csrf-token"], "csrf-fresh")
  })

  it("gives up on a second consecutive CSRF 403 instead of looping", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 403, json: { error: "Invalid CSRF token", code: "CSRF" } },
    ])
    const s = sink()

    await assert.rejects(
      () => s.createSession({ kind: "image", originalBytes: 1, section: "official" }),
      (/** @type {Error} */ err) => err.message.includes("403"),
    )
    // Login + the original + one retry. Not an unbounded loop.
    assert.equal(seen.length, 3)
  })

  it("retries a 5xx and succeeds on the next attempt", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 503, json: { error: "Service unavailable" } },
      { status: 201, json: { id: 4, fileKey: "d" } },
    ])
    const s = sink()

    const created = await s.createSession({ kind: "image", originalBytes: 1, section: "official" })
    assert.deepEqual(created, { id: 4, fileKey: "d" })
    assert.equal(seen.length, 3)
  })

  it("never re-sends a body the server already refused", async () => {
    for (const [status, expected] of [
      [413, "VARIANT_TOO_LARGE"],
      [415, "VARIANT_FORMAT_MISMATCH"],
      // 507 and 401 map to run-fatal codes: the next 199 files would fail the
      // same way, so the run stops instead of repeating the error.
      [507, "DESTINATION_FULL"],
      [401, "AUTH_LOST"],
      [409, "BACKEND_FAILED"],
    ]) {
      reset([
        { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
        { status: /** @type {number} */ (status), json: { error: "refused" } },
      ])
      const s = sink()
      await s.createSession({ kind: "image", originalBytes: 1, section: "official" }).catch(() => {})
      const file = fixtureFile("original.jpg", 64)

      await assert.rejects(
        () => s.putVariant(1, "original", { path: file, bytes: 64, contentType: "image/jpeg" }),
        (/** @type {Error & { code?: string }} */ err) => {
          assert.equal(err.code, expected, `${status} should map to ${expected}`)
          return true
        },
      )
      // Login + the create attempt + exactly one PUT. Re-uploading a 30MB
      // original the server has already rejected would be pure waste.
      assert.equal(seen.filter((r) => r.method === "PUT").length, 1, `${status} was retried`)
    }
  })

  it("refuses to run when no password is available and there is no terminal", async () => {
    reset([{ status: 200, json: {} }])
    delete process.env.WEDDING_ADMIN_PASSWORD
    const s = createHttpSink({ url: origin })

    await assert.rejects(
      () => s.createSession({ kind: "image", originalBytes: 1, section: "official" }),
      (/** @type {Error} */ err) => {
        assert.ok(err.message.includes("WEDDING_ADMIN_PASSWORD"))
        // The reason a flag is not offered is stated where someone would look.
        assert.ok(err.message.includes("shell history"))
        return true
      },
    )
  })
})

describe("sink-http finalize", () => {
  const FILE = { width: 10, height: 10, durationS: null, caption: null, sourceSha256: null }

  /** @param {any} input @returns {Promise<any>} the JSON body the server received */
  async function finalizeBody(input) {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 201, json: { id: 7, fileKey: "k" } },
      { status: 200, json: { id: 7, status: "hidden" } },
    ])
    const s = sink()
    await s.createSession({ kind: "image", originalBytes: 1, section: "official" })
    await s.finalize(7, input)
    return JSON.parse(seen[seen.length - 1].body)
  }

  it("asks for hidden only when told to, so a plain import sends what it always sent", async () => {
    assert.equal((await finalizeBody({ ...FILE, hidden: true })).hidden, true)
    assert.equal("hidden" in (await finalizeBody({ ...FILE, hidden: false })), false)
    assert.equal("hidden" in (await finalizeBody(FILE)), false)
  })
})

describe("sink-http capacity", () => {
  const ANSWER = {
    storedBytes: 100,
    maxTotalBytes: 1000,
    freeBytes: 5000,
    minFreeBytes: 10,
    remainingBytes: 900,
    limitedBy: "cap",
  }

  it("reads the admin endpoint, logging in first", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 200, json: ANSWER },
    ])
    const result = await sink().capacity()
    assert.deepEqual(result, { ok: true, ...ANSWER })
    assert.deepEqual(
      seen.map((r) => [r.method, r.url]),
      [
        ["POST", "/api/admin/login"],
        ["GET", "/api/admin/media/capacity"],
      ],
    )
    assert.ok(String(seen[1].headers.cookie).includes("session=sess-1"))
  })

  it("says the server predates it on a 404", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 404, json: {} },
    ])
    const result = await sink().capacity()
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, "unsupported")
  })

  it("reports no password as unavailable, instead of throwing or prompting", async () => {
    reset([{ status: 200, json: {} }])
    delete process.env.WEDDING_ADMIN_PASSWORD
    const result = await createHttpSink({ url: origin }).capacity()
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, "unavailable")
      assert.ok(result.message.includes("WEDDING_ADMIN_PASSWORD"))
    }
    assert.equal(seen.length, 0)
  })

  it("reports a malformed answer as unavailable, instead of trusting it", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 200, json: { remainingBytes: "lots" } },
    ])
    const result = await sink().capacity()
    assert.equal(result.ok, false)
  })
})

describe("sink-http applyOrder", () => {
  it("submits the existing official ids plus the imported ones, in plan order", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 200, json: { items: [{ id: 1 }, { id: 2 }, { id: 40 }], nextCursor: null } },
      { status: 200, json: { success: true } },
    ])
    const s = sink()

    const result = await s.applyOrder([40, 41])

    assert.deepEqual(result, { ok: true })
    const reorder = seen[seen.length - 1]
    assert.equal(reorder.url, "/api/admin/media/reorder")
    // 40 was already listed, so it appears once — in its imported position.
    assert.deepEqual(JSON.parse(reorder.body).ids, [1, 2, 40, 41])
  })

  it("reads the set from the admin listing, because the public feed leaves out hidden rows", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 200, json: { items: [{ id: 1 }] } },
      { status: 200, json: { success: true } },
    ])
    await sink().applyOrder([2], "honeymoon")
    assert.equal(seen[1].url, "/api/admin/media/curated?section=honeymoon")
    assert.ok(!seen.some((r) => r.url.startsWith("/api/media")))
    assert.equal(JSON.parse(seen[2].body).section, "honeymoon")
  })

  it("warns rather than failing when the section changes under it", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 200, json: { items: [{ id: 1 }], nextCursor: null } },
      { status: 400, json: { error: "ids must match the current official set exactly" } },
    ])
    const s = sink()

    const result = await s.applyOrder([2])

    // The photos imported fine; only their order is unset. Failing the whole run
    // over this would be wrong.
    assert.equal(result.ok, false)
    assert.ok(result.message?.includes("changed while it was being set"))
    assert.ok(result.message?.includes("import locally for exact ordering"))
  })

  it("does nothing when there is nothing to order", async () => {
    reset([{ status: 500, json: {} }])
    const result = await sink().applyOrder([])
    assert.deepEqual(result, { ok: true })
    assert.equal(seen.length, 0)
  })
})

describe("sink-http statuses, setStatus and discard", () => {
  it("reads statuses from the curated listings, then asks one by one for the rest", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      {
        status: 200,
        json: {
          items: [
            { id: 1, status: "approved" },
            { id: 9, status: "hidden" },
          ],
        },
      },
      { status: 200, json: { items: [] } },
      { status: 200, json: { item: { id: 2, status: "hidden" } } },
      { status: 404, json: { error: "Post not found" } },
    ])
    const result = await sink().statuses([1, 2, 3])
    assert.ok(result.ok)
    assert.deepEqual(
      [...result.statuses],
      [
        [1, "approved"],
        [2, "hidden"],
        [3, null],
      ],
    )
    assert.deepEqual(
      seen.slice(1).map((r) => r.url),
      [
        "/api/admin/media/curated?section=official",
        "/api/admin/media/curated?section=honeymoon",
        "/api/admin/moderation/media/2",
        "/api/admin/moderation/media/3",
      ],
    )
  })

  it("says it couldn't read statuses rather than guessing", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 403, json: { error: "Forbidden" } },
    ])
    const result = await sink().statuses([1])
    assert.equal(result.ok, false)
  })

  it("hides and approves through the admin moderation endpoints", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 200, json: { success: true } },
      { status: 409, json: { error: "Cannot approve this item" } },
    ])
    const s = sink()
    assert.deepEqual(await s.setStatus(4, "hidden"), { ok: true })
    const refused = await s.setStatus(5, "approved")
    assert.equal(refused.ok, false)
    assert.ok(refused.message?.includes("Cannot approve this item"))
    assert.deepEqual(
      seen.slice(1).map((r) => [r.method, r.url, r.headers["x-csrf-token"]]),
      [
        ["POST", "/api/admin/moderation/media/4/hide", "csrf-1"],
        ["POST", "/api/admin/moderation/media/5/approve", "csrf-1"],
      ],
    )
  })

  it("can't search by content, and says so with null", async () => {
    assert.equal(await sink().findByContent(["a".repeat(64)]), null)
  })

  it("throws when a delete fails, so nobody is told a public row was removed", async () => {
    reset([{ status: 409, json: { error: "nope" } }])
    await assert.rejects(() => sink().discard(12), /Deleting media 12/)
    reset([{ status: 404, json: { error: "Media not found" } }])
    await sink().discard(12)
  })
})
