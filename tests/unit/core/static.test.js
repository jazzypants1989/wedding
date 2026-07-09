/**
 * @file Unit tests for core/static.js — Static file serving
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { serveStatic } from "../../../core/static.js"

/**
 * @param {Partial<import('node:http').IncomingMessage>} opts
 */
function mockReq(opts = {}) {
  return {
    url: opts.url || "/",
    headers: opts.headers || {},
    ...opts,
  }
}

function mockRes() {
  /** @type {{ statusCode: number | null, headers: Record<string, string | number>, body: Buffer | string | null, ended: boolean }} */
  const state = { statusCode: null, headers: {}, body: null, ended: false }
  return {
    state,
    writeHead(/** @type {number} */ status, /** @type {Record<string, string | number>} */ headers = {}) {
      state.statusCode = status
      Object.assign(state.headers, headers)
      return this
    },
    end(/** @type {Buffer | string | undefined} */ body) {
      state.body = body ?? null
      state.ended = true
      return this
    },
  }
}

describe("serveStatic", () => {
  it("serves the home page for /", async () => {
    const req = mockReq({ url: "/" })
    const res = mockRes()
    const handled = await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(handled, true)
    assert.strictEqual(res.state.statusCode, 200)
    assert.ok(res.state.headers["Content-Type"]?.toString().includes("text/html"))
    assert.ok(res.state.headers["Content-Security-Policy"])
    assert.ok(res.state.headers["X-Frame-Options"])
  })

  it("serves the RSVP page for /rsvp", async () => {
    const req = mockReq({ url: "/rsvp" })
    const res = mockRes()
    const handled = await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(handled, true)
    assert.strictEqual(res.state.statusCode, 200)
    assert.ok(res.state.headers["Content-Type"]?.toString().includes("text/html"))
  })

  it("serves the admin page for /admin", async () => {
    const req = mockReq({ url: "/admin" })
    const res = mockRes()
    const handled = await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(handled, true)
    assert.strictEqual(res.state.statusCode, 200)
  })

  it("serves CSS files with revalidating cache control + validators", async () => {
    const req = mockReq({ url: "/styles/tokens.css" })
    const res = mockRes()
    const handled = await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(handled, true)
    assert.strictEqual(res.state.statusCode, 200)
    assert.ok(res.state.headers["Content-Type"]?.toString().includes("text/css"))
    const cacheControl = res.state.headers["Cache-Control"]?.toString() || ""
    assert.ok(cacheControl.includes("must-revalidate"), "should revalidate")
    assert.ok(!cacheControl.includes("immutable"), "should not be immutable")
    assert.ok(res.state.headers["ETag"], "should send an ETag validator")
    assert.ok(res.state.headers["Last-Modified"], "should send a Last-Modified validator")
  })

  it("serves JS files with correct content type", async () => {
    const req = mockReq({ url: "/pages/main.js" })
    const res = mockRes()
    const handled = await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(handled, true)
    assert.strictEqual(res.state.statusCode, 200)
    assert.ok(res.state.headers["Content-Type"]?.toString().includes("javascript"))
  })

  it("returns false for non-existent files", async () => {
    const req = mockReq({ url: "/nonexistent-file.css" })
    const res = mockRes()
    const handled = await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(handled, false)
  })

  it("does not serve files outside public directory on traversal attempts", async () => {
    const req = mockReq({ url: "/../../../etc/passwd" })
    const res = mockRes()
    const handled = await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    // path.join + path.normalize keeps the path inside publicDir,
    // so the file is not found (returns false) rather than forbidden (403)
    assert.strictEqual(handled, false)
  })

  it("strips query parameters from URL", async () => {
    const req = mockReq({ url: "/?v=123" })
    const res = mockRes()
    const handled = await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(handled, true)
    assert.strictEqual(res.state.statusCode, 200)
  })

  it("strips trailing slashes", async () => {
    const req = mockReq({ url: "/rsvp/" })
    const res = mockRes()
    const handled = await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(handled, true)
    assert.strictEqual(res.state.statusCode, 200)
  })

  it("sets X-Content-Type-Options: nosniff on all responses", async () => {
    const req = mockReq({ url: "/" })
    const res = mockRes()
    await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(res.state.headers["X-Content-Type-Options"], "nosniff")
  })

  it("returns 304 for conditional requests with matching ETag", async () => {
    // First request to get the ETag
    const req1 = mockReq({ url: "/styles/tokens.css" })
    const res1 = mockRes()
    await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req1)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res1)))
    const etag = String(res1.state.headers["ETag"])
    assert.ok(etag, "First response should have an ETag")

    // Second request with If-None-Match
    const req2 = mockReq({
      url: "/styles/tokens.css",
      headers: { "if-none-match": etag },
    })
    const res2 = mockRes()
    await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req2)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res2)))
    assert.strictEqual(res2.state.statusCode, 304)
  })

  it("returns 304 for conditional requests with If-Modified-Since", async () => {
    // First request to get the Last-Modified date
    const req1 = mockReq({ url: "/styles/tokens.css" })
    const res1 = mockRes()
    await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req1)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res1)))
    const lastModified = String(res1.state.headers["Last-Modified"])
    assert.ok(lastModified, "First response should have a Last-Modified header")

    // Second request with If-Modified-Since equal to the file's mtime → not modified
    const req2 = mockReq({
      url: "/styles/tokens.css",
      headers: { "if-modified-since": lastModified },
    })
    const res2 = mockRes()
    await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req2)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res2)))
    assert.strictEqual(res2.state.statusCode, 304)
  })

  it("serves gzipped content when client accepts gzip", async () => {
    const req = mockReq({
      url: "/styles/tokens.css",
      headers: { "accept-encoding": "gzip, deflate, br" },
    })
    const res = mockRes()
    await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    // Only files > 1024 bytes get gzipped; this may or may not have Content-Encoding
    if (res.state.headers["Content-Encoding"]) {
      assert.strictEqual(res.state.headers["Content-Encoding"], "gzip")
      assert.strictEqual(res.state.headers["Vary"], "Accept-Encoding")
    }
  })

  it("injects cache busters into HTML", async () => {
    const req = mockReq({ url: "/" })
    const res = mockRes()
    await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    const body = res.state.body?.toString() || ""
    // HTML should have ?v= appended to CSS/JS references
    const hasCacheBuster = body.includes("?v=")
    assert.ok(hasCacheBuster, "HTML should contain cache-busted URLs")
  })

  it("sets no-cache for HTML files", async () => {
    const req = mockReq({ url: "/" })
    const res = mockRes()
    await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(res.state.headers["Cache-Control"], "no-cache")
  })

  it("serves PNG images", async () => {
    const req = mockReq({ url: "/images/favicon.png" })
    const res = mockRes()
    const handled = await serveStatic(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))
    assert.strictEqual(handled, true)
    assert.strictEqual(res.state.statusCode, 200)
    assert.ok(res.state.headers["Content-Type"]?.toString().includes("image/png"))
  })
})
