/**
 * Unit tests for HTTP utility functions
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { EventEmitter } from "node:events"
import {
  sanitize,
  isValidEmail,
  sendJson,
  sendError,
  sendCsv,
  parseBody,
  checkRateLimit,
} from "../../../core/http.js"
import {
  ValidationError,
  PayloadTooLargeError,
} from "../../../core/validation.js"
import { mockResponse } from "../../unit-helpers.js"

describe("sanitize", () => {
  it("trims whitespace from string", () => {
    assert.strictEqual(sanitize("  hello  "), "hello")
  })

  it("returns null for non-string input (number)", () => {
    assert.strictEqual(sanitize(123), null)
  })

  it("returns null for null input", () => {
    assert.strictEqual(sanitize(null), null)
  })

  it("returns null for undefined input", () => {
    assert.strictEqual(sanitize(undefined), null)
  })

  it("truncates to maxLen", () => {
    assert.strictEqual(sanitize("abcdef", 3), "abc")
  })

  it("uses default maxLen of 500", () => {
    const long = "a".repeat(600)
    const result = sanitize(long)
    assert.ok(result)
    assert.strictEqual(result.length, 500)
  })

  it("returns null for empty string after trim", () => {
    assert.strictEqual(sanitize("   "), null)
  })

  it("returns null for empty string", () => {
    assert.strictEqual(sanitize(""), null)
  })

  it("handles string within length limit", () => {
    assert.strictEqual(sanitize("hello", 10), "hello")
  })
})

describe("isValidEmail", () => {
  it("returns true for empty email (optional)", () => {
    assert.strictEqual(isValidEmail(""), true)
  })

  it("returns true for null email", () => {
    assert.strictEqual(isValidEmail(null), true)
  })

  it("returns true for valid email", () => {
    assert.strictEqual(isValidEmail("test@example.com"), true)
  })

  it("returns true for email with subdomain", () => {
    assert.strictEqual(isValidEmail("user@mail.example.com"), true)
  })

  it("returns false for email without @", () => {
    assert.strictEqual(isValidEmail("testexample.com"), false)
  })

  it("returns false for multiple @ signs", () => {
    assert.strictEqual(isValidEmail("a@b@c.com"), false)
  })

  it("returns false for empty local part", () => {
    assert.strictEqual(isValidEmail("@example.com"), false)
  })

  it("returns false for empty domain", () => {
    assert.strictEqual(isValidEmail("test@"), false)
  })

  it("returns false for domain starting with dot", () => {
    assert.strictEqual(isValidEmail("test@.example.com"), false)
  })

  it("returns false for domain ending with dot", () => {
    assert.strictEqual(isValidEmail("test@example."), false)
  })

  it("returns false for no TLD", () => {
    assert.strictEqual(isValidEmail("test@example"), false)
  })

  it("returns false for single-char TLD", () => {
    assert.strictEqual(isValidEmail("test@example.a"), false)
  })

  it("returns false for email over 254 chars", () => {
    const longLocal = "a".repeat(243)
    const email = longLocal + "@example.com" // 255 chars
    assert.strictEqual(isValidEmail(email), false)
  })

  it("returns false for email with whitespace", () => {
    assert.strictEqual(isValidEmail("test @example.com"), false)
    assert.strictEqual(isValidEmail("test\t@example.com"), false)
    assert.strictEqual(isValidEmail("test\n@example.com"), false)
  })
})

describe("sendJson", () => {
  it("sends JSON response with correct status and headers", () => {
    const res = mockResponse()
    sendJson(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), 200, { ok: true })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.headers["Content-Type"], "application/json")
    assert.strictEqual(res.headers["X-Content-Type-Options"], "nosniff")
    assert.ok(res.ended)

    const body = JSON.parse(/** @type {string} */ (res.body))
    assert.deepStrictEqual(body, { ok: true })
  })

  it("sets Content-Length header", () => {
    const res = mockResponse()
    sendJson(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), 200, { key: "value" })

    const expectedLength = Buffer.byteLength(JSON.stringify({ key: "value" }))
    assert.strictEqual(res.headers["Content-Length"], expectedLength)
  })

  it("merges extra headers", () => {
    const res = mockResponse()
    sendJson(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), 200, {}, { "X-Custom": "value" })

    assert.strictEqual(res.headers["X-Custom"], "value")
  })

  it("handles empty data object", () => {
    const res = mockResponse()
    sendJson(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), 204, {})

    assert.strictEqual(res.statusCode, 204)
    assert.strictEqual(JSON.parse(/** @type {string} */ (res.body)).constructor, Object)
  })
})

describe("sendError", () => {
  it("sends error response with message", () => {
    const res = mockResponse()
    sendError(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), 400, "Bad request")

    assert.strictEqual(res.statusCode, 400)
    const body = JSON.parse(/** @type {string} */ (res.body))
    assert.strictEqual(body.error, "Bad request")
  })

  it("includes error code when provided", () => {
    const res = mockResponse()
    sendError(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), 404, "Not found", "NOT_FOUND")

    const body = JSON.parse(/** @type {string} */ (res.body))
    assert.strictEqual(body.error, "Not found")
    assert.strictEqual(body.code, "NOT_FOUND")
  })

  it("omits code when not provided", () => {
    const res = mockResponse()
    sendError(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), 500, "Server error")

    const body = JSON.parse(/** @type {string} */ (res.body))
    assert.strictEqual(body.error, "Server error")
    assert.strictEqual(body.code, undefined)
  })
})

describe("sendCsv", () => {
  it("sends CSV with correct content-type", () => {
    const res = mockResponse()
    sendCsv(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), "guests.csv", "name,email\nJohn,john@test.com")

    assert.ok(String(res.headers["Content-Type"]).includes("text/csv"))
  })

  it("sets Content-Disposition with filename", () => {
    const res = mockResponse()
    sendCsv(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), "export.csv", "data")

    assert.ok(
      String(res.headers["Content-Disposition"]).includes('filename="export.csv"'),
    )
  })

  it("sets no-store cache control", () => {
    const res = mockResponse()
    sendCsv(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), "test.csv", "data")

    assert.ok(String(res.headers["Cache-Control"]).includes("no-store"))
  })

  it("sets Content-Length", () => {
    const content = "name,email\nJohn,john@test.com"
    const res = mockResponse()
    sendCsv(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), "test.csv", content)

    assert.strictEqual(
      res.headers["Content-Length"],
      Buffer.byteLength(content),
    )
  })

  it("sends status 200", () => {
    const res = mockResponse()
    sendCsv(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), "test.csv", "data")

    assert.strictEqual(res.statusCode, 200)
  })
})

describe("parseBody", () => {
  /**
   * @param {{ body?: unknown, empty?: boolean, chunks?: string[], error?: string }} [options]
   * @returns {import('node:http').IncomingMessage}
   */
  function createMockReq(options = {}) {
    const emitter = new EventEmitter()
    /** @type {() => void} */
    const destroy = () => {}
    Object.assign(emitter, { destroy })
    const req = /** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (emitter))

    if (options.body !== undefined) {
      setImmediate(() => {
        const data =
          typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body)
        req.emit("data", Buffer.from(data))
        req.emit("end")
      })
    } else if (options.empty) {
      setImmediate(() => {
        req.emit("end")
      })
    } else if (options.chunks) {
      const chunks = options.chunks
      setImmediate(() => {
        for (const chunk of chunks) {
          req.emit("data", Buffer.from(chunk))
        }
        req.emit("end")
      })
    } else if (options.error) {
      setImmediate(() => {
        req.emit("error", new Error(options.error))
      })
    }

    return req
  }

  it("parses valid JSON body", async () => {
    const req = createMockReq({ body: { key: "value" } })
    const result = await parseBody(req)
    assert.deepStrictEqual(result, { key: "value" })
  })

  it("returns empty object for empty body", async () => {
    const req = createMockReq({ empty: true })
    const result = await parseBody(req)
    assert.deepStrictEqual(result, {})
  })

  it("rejects invalid JSON", async () => {
    const req = createMockReq({ body: "not valid json" })
    await assert.rejects(
      () => parseBody(req),
      (err) => {
        assert.ok(err instanceof ValidationError)
        assert.strictEqual(err.message, "Invalid JSON body")
        return true
      },
    )
  })

  it("rejects payload exceeding maxSize", async () => {
    const largeData = "a".repeat(100)
    const req = createMockReq({ body: largeData })
    await assert.rejects(
      () => parseBody(req, 10),
      (err) => {
        assert.ok(err instanceof PayloadTooLargeError)
        assert.strictEqual(err.message, "Payload too large")
        return true
      },
    )
  })

  it("handles request errors", async () => {
    const req = createMockReq({ error: "Connection reset" })
    await assert.rejects(() => parseBody(req), { message: "Connection reset" })
  })
})

describe("checkRateLimit", () => {
  it("returns false when request is allowed", () => {
    const res = mockResponse()
    const limiter = {
      check: () => ({
        allowed: true,
        remaining: 5,
        resetAt: Date.now() + 60000,
      }),
    }

    const blocked = checkRateLimit(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), /** @type {import('../../../core/types.js').RateLimiter} */ (/** @type {unknown} */ (limiter)), "test-key")
    assert.strictEqual(blocked, false)
    assert.strictEqual(res.ended, false)
  })

  it("returns true and sends 429 when blocked", () => {
    const res = mockResponse()
    const limiter = {
      check: () => ({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30000,
      }),
    }

    const blocked = checkRateLimit(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), /** @type {import('../../../core/types.js').RateLimiter} */ (/** @type {unknown} */ (limiter)), "test-key")
    assert.strictEqual(blocked, true)
    assert.strictEqual(res.statusCode, 429)
  })

  it("includes Retry-After header when blocked", () => {
    const res = mockResponse()
    const limiter = {
      check: () => ({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30000,
      }),
    }

    checkRateLimit(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), /** @type {import('../../../core/types.js').RateLimiter} */ (/** @type {unknown} */ (limiter)), "test-key")
    assert.ok(res.headers["Retry-After"])
    assert.ok(parseInt(String(res.headers["Retry-After"]), 10) > 0)
  })

  it("includes error message when blocked", () => {
    const res = mockResponse()
    const limiter = {
      check: () => ({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30000,
      }),
    }

    checkRateLimit(/** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), /** @type {import('../../../core/types.js').RateLimiter} */ (/** @type {unknown} */ (limiter)), "test-key")
    const body = JSON.parse(/** @type {string} */ (res.body))
    assert.ok(body.error.includes("Too many requests"))
  })
})
