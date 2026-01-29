/**
 * @file Unit tests for email service
 */

import { describe, it, beforeEach } from "node:test"
import assert from "node:assert"
import {
  createEmailService,
  getDefaultInviteEmail,
  isRetryableError,
} from "../../../services/email.js"
import { createMockHttpClient } from "../../mocks/http-client.js"

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

  it("returns false for unknown errors", () => {
    assert.strictEqual(isRetryableError("Something went wrong"), false)
    assert.strictEqual(isRetryableError(""), false)
    assert.strictEqual(isRetryableError(null), false)
  })

  it("returns true for HTTP server errors and rate limits", () => {
    assert.strictEqual(isRetryableError("HTTP 429"), true)
    assert.strictEqual(isRetryableError("HTTP 500"), true)
    assert.strictEqual(isRetryableError("HTTP 502"), true)
    assert.strictEqual(isRetryableError("HTTP 503"), true)
    assert.strictEqual(isRetryableError("HTTP 504"), true)
  })

  it("returns true for pipe and host unreachable errors", () => {
    assert.strictEqual(isRetryableError("EPIPE"), true)
    assert.strictEqual(isRetryableError("EHOSTUNREACH"), true)
  })
})

describe("createEmailService", () => {
  describe("isConfigured", () => {
    it("returns false when RESEND_API_KEY is not set", () => {
      // Since we can't easily control env vars, test via sendEmail behavior
      const mockClient = createMockHttpClient()
      const service = createEmailService(/** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)))
      // isConfigured checks process.env.RESEND_API_KEY which is not set in tests
      assert.strictEqual(service.isConfigured(), false)
    })
  })

  describe("sendEmail", () => {
    it("returns not configured error when API key is missing", async () => {
      const mockClient = createMockHttpClient()
      const service = createEmailService(/** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)))

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

