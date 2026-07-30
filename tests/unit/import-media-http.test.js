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

  it("warns rather than failing when the gallery holds photos it cannot enumerate", async () => {
    reset([
      { status: 200, json: { success: true }, setCookie: LOGIN_COOKIES },
      { status: 200, json: { items: [{ id: 1 }], nextCursor: null } },
      { status: 400, json: { error: "ids must match the current official set exactly" } },
    ])
    const s = sink()

    const result = await s.applyOrder([2])

    // The photos imported fine; only their order is unset. Failing the whole run
    // over this would be wrong, and the admin drag-and-drop UI has the same gap.
    assert.equal(result.ok, false)
    assert.ok(result.message?.includes("hidden or rejected"))
    assert.ok(result.message?.includes("import locally for exact ordering"))
  })

  it("does nothing when there is nothing to order", async () => {
    reset([{ status: 500, json: {} }])
    const result = await sink().applyOrder([])
    assert.deepEqual(result, { ok: true })
    assert.equal(seen.length, 0)
  })
})
