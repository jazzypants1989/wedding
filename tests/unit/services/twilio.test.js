/**
 * @file Unit tests for Twilio SMS service
 */

import { describe, it, beforeEach } from "node:test"
import assert from "node:assert"
import {
  createSMSService,
  getDefaultInviteMessage,
  isRetryableError,
} from "../../../services/twilio.js"
import { createMockHttpClient } from "../../mocks/http-client.js"

describe("isRetryableError (twilio)", () => {
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
  })

  it("returns false for invalid errors", () => {
    // Twilio's isRetryableError also matches 'invalid' broadly
    assert.strictEqual(isRetryableError("Invalid phone number"), false)
    assert.strictEqual(isRetryableError("Invalid credentials"), false)
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

describe("createSMSService", () => {
  describe("isConfigured", () => {
    it("returns false when Twilio credentials are not set", () => {
      const mockClient = createMockHttpClient()
      const service = createSMSService(/** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)))
      // isConfigured checks env vars which are not set in tests
      assert.strictEqual(service.isConfigured(), false)
    })
  })

  describe("sendSMS", () => {
    it("returns not configured error when credentials are missing", async () => {
      const mockClient = createMockHttpClient()
      const service = createSMSService(/** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)))

      const result = await service.sendSMS("+15551234567", "Test message")

      assert.strictEqual(result.success, false)
      assert.strictEqual(result.error, "Twilio not configured")
      // Should not make any HTTP requests
      assert.strictEqual(mockClient.calls.length, 0)
    })
  })
})

describe("getDefaultInviteMessage", () => {
  it("returns SMS template with guest name and URL", () => {
    const result = getDefaultInviteMessage(
      "John Doe",
      "https://example.com/rsvp/ABC123"
    )

    assert.ok(result.includes("John Doe"))
    assert.ok(result.includes("https://example.com/rsvp/ABC123"))
    assert.ok(result.includes("invited"))
    assert.ok(result.includes("RSVP"))
  })

  it("includes couple names in message", () => {
    const result = getDefaultInviteMessage("Guest", "https://example.com")

    // Should include wedding couple info from constants
    assert.ok(result.includes("Jesse") || result.includes("Jordana"))
  })

  it("keeps message concise for SMS", () => {
    const result = getDefaultInviteMessage(
      "Guest Name",
      "https://example.com/rsvp/ABCD1234"
    )

    // SMS should be reasonably short (under 160 chars ideally, definitely under 320)
    assert.ok(result.length < 320, `Message too long: ${result.length} chars`)
  })
})

