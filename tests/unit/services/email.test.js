/**
 * @file Unit tests for email service
 */
/** @import { CreateMockHttpClientFn, MockHttpCall, MockResponse, MockRequest, MockRequestFn } from './types.js' */

import { describe, it, beforeEach } from "node:test"
import assert from "node:assert"
import { EventEmitter } from "node:events"
import {
  createEmailService,
  getDefaultInviteEmail,
  isRetryableError,
} from "../../../services/email.js"

/** @type {CreateMockHttpClientFn} */
function createMockHttpClient(responseConfig = {}) {
  /** @type {MockHttpCall[]} */
  const calls = []

  /** @type {MockRequestFn} */
  function request(options, callback) {
    calls.push({ options })

    /** @type {MockResponse} */
    const mockRes = Object.assign(new EventEmitter(), {
      statusCode: responseConfig.statusCode || 200,
    })

    /** @type {MockRequest} */
    const mockReq = Object.assign(new EventEmitter(), {
      write: (/** @type {string} */ data) => {
        calls[calls.length - 1].data = data
      },
      end: () => {
        setImmediate(() => {
          callback(mockRes)

          if (responseConfig.error) {
            mockReq.emit("error", new Error(responseConfig.error))
          } else if (responseConfig.timeout) {
            mockReq.emit("timeout")
          } else {
            const responseBody =
              responseConfig.body || JSON.stringify({ id: "test-email-id" })
            mockRes.emit("data", responseBody)
            mockRes.emit("end")
          }
        })
      },
      destroy: () => {},
    })

    return mockReq
  }

  return { request, calls }
}

describe("isRetryableError", () => {
  it("returns true for timeout errors", () => {
    assert.strictEqual(isRetryableError("Request timed out"), true)
    assert.strictEqual(isRetryableError("Connection timeout"), true)
  })

  it("returns true for network errors", () => {
    assert.strictEqual(isRetryableError("ECONNREFUSED"), true)
    assert.strictEqual(isRetryableError("ECONNRESET"), true)
    assert.strictEqual(isRetryableError("socket hang up"), true)
    assert.strictEqual(isRetryableError("Network error"), true)
  })

  it("returns false for auth failures", () => {
    assert.strictEqual(isRetryableError("Unauthorized"), false)
    assert.strictEqual(isRetryableError("Forbidden"), false)
    assert.strictEqual(isRetryableError("Invalid API key"), false)
  })

  it("returns false for validation errors", () => {
    assert.strictEqual(isRetryableError("Invalid email address"), false)
    assert.strictEqual(isRetryableError("Missing required field"), false)
  })

  it("returns true for unknown errors", () => {
    assert.strictEqual(isRetryableError("Something went wrong"), true)
    assert.strictEqual(isRetryableError(""), true)
    assert.strictEqual(isRetryableError(null), true)
  })
})

describe("createEmailService", () => {
  describe("isConfigured", () => {
    it("returns false when RESEND_API_KEY is not set", () => {
      // Since we can't easily control env vars, test via sendEmail behavior
      const mockClient = createMockHttpClient()
      const service = createEmailService(mockClient)
      // isConfigured checks process.env.RESEND_API_KEY which is not set in tests
      assert.strictEqual(service.isConfigured(), false)
    })
  })

  describe("sendEmail", () => {
    it("returns not configured error when API key is missing", async () => {
      const mockClient = createMockHttpClient()
      const service = createEmailService(mockClient)

      const result = await service.sendEmail({
        to: "test@example.com",
        subject: "Test",
        text: "Hello",
      })

      assert.strictEqual(result.success, false)
      assert.strictEqual(result.error, "Resend not configured")
      // Should not make any HTTP requests
      assert.strictEqual(mockClient.calls.length, 0)
    })
  })
})

describe("getDefaultInviteEmail", () => {
  it("returns email template with guest name and URL", () => {
    const result = getDefaultInviteEmail(
      "John Doe",
      "https://example.com/rsvp/ABC123"
    )

    assert.ok(result.subject.length > 0)
    assert.ok(result.text.includes("John Doe"))
    assert.ok(result.text.includes("https://example.com/rsvp/ABC123"))
    assert.ok(result.html.includes("John Doe"))
    assert.ok(result.html.includes("https://example.com/rsvp/ABC123"))
  })

  it("escapes HTML in guest name", () => {
    const result = getDefaultInviteEmail(
      '<script>alert("xss")</script>',
      "https://example.com"
    )

    // HTML should be escaped in the HTML version
    assert.ok(!result.html.includes("<script>"))
    assert.ok(result.html.includes("&lt;script&gt;"))
  })

  it("includes couple names in message", () => {
    const result = getDefaultInviteEmail("Guest", "https://example.com")

    // Should include wedding couple info from constants
    assert.ok(result.text.includes("Jesse") || result.text.includes("Jordana"))
    assert.ok(result.html.includes("Jesse") || result.html.includes("Jordana"))
  })
})

// Test the mock HTTP client helper works correctly
describe("mock HTTP client", () => {
  it("captures request options and data", async () => {
    const mockClient = createMockHttpClient({ statusCode: 200 })

    const result = await new Promise((resolve) => {
      const req = mockClient.request(
        { hostname: "test.com", path: "/api" },
        (res) => {
          let data = ""
          res.on("data", (chunk) => (data += chunk))
          res.on("end", () => resolve({ statusCode: res.statusCode, data }))
        }
      )
      req.write("test-data")
      req.end()
    })

    assert.strictEqual(result.statusCode, 200)
    assert.strictEqual(mockClient.calls.length, 1)
    assert.strictEqual(mockClient.calls[0].options.hostname, "test.com")
    assert.strictEqual(mockClient.calls[0].data, "test-data")
  })

  it("simulates error responses", async () => {
    const mockClient = createMockHttpClient({ error: "Connection refused" })

    const result = await new Promise((resolve) => {
      const req = mockClient.request({}, () => {})
      req.on("error", (err) =>
        resolve({ error: err instanceof Error ? err.message : String(err) })
      )
      req.write("")
      req.end()
    })

    assert.strictEqual(result.error, "Connection refused")
  })

  it("simulates timeout", async () => {
    const mockClient = createMockHttpClient({ timeout: true })

    const result = await new Promise((resolve) => {
      const req = mockClient.request({}, () => {})
      req.on("timeout", () => resolve({ timeout: true }))
      req.write("")
      req.end()
    })

    assert.strictEqual(result.timeout, true)
  })

  it("returns custom response body", async () => {
    const mockClient = createMockHttpClient({
      statusCode: 200,
      body: JSON.stringify({ id: "custom-id", status: "sent" }),
    })

    const result = await new Promise((resolve) => {
      const req = mockClient.request({}, (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => resolve(JSON.parse(data)))
      })
      req.write("")
      req.end()
    })

    assert.strictEqual(result.id, "custom-id")
    assert.strictEqual(result.status, "sent")
  })
})
