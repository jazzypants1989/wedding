/**
 * @file Unit tests for Twilio SMS service
 */
/** @import { CreateMockHttpClientFn, MockHttpCall, MockResponse, MockRequest, MockRequestFn } from './types.js' */

import { describe, it, beforeEach } from "node:test"
import assert from "node:assert"
import { EventEmitter } from "node:events"
import {
  createSMSService,
  getDefaultInviteMessage,
  isRetryableError,
} from "../../../services/twilio.js"

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
              responseConfig.body || JSON.stringify({ sid: "test-sms-sid" })
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

  it("returns true for unknown errors", () => {
    assert.strictEqual(isRetryableError("Something went wrong"), true)
    assert.strictEqual(isRetryableError(""), true)
    assert.strictEqual(isRetryableError(null), true)
  })
})

describe("createSMSService", () => {
  describe("isConfigured", () => {
    it("returns false when Twilio credentials are not set", () => {
      const mockClient = createMockHttpClient()
      const service = createSMSService(mockClient)
      // isConfigured checks env vars which are not set in tests
      assert.strictEqual(service.isConfigured(), false)
    })
  })

  describe("sendSMS", () => {
    it("returns not configured error when credentials are missing", async () => {
      const mockClient = createMockHttpClient()
      const service = createSMSService(mockClient)

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

// Test the mock HTTP client helper works correctly
describe("mock HTTP client (twilio)", () => {
  it("captures request options and data", async () => {
    const mockClient = createMockHttpClient({ statusCode: 201 })

    const result = await new Promise((resolve) => {
      const req = mockClient.request(
        { hostname: "api.twilio.com", path: "/messages" },
        (res) => {
          let data = ""
          res.on("data", (chunk) => (data += chunk))
          res.on("end", () => resolve({ statusCode: res.statusCode, data }))
        }
      )
      req.write("To=+15551234567&Body=test")
      req.end()
    })

    assert.strictEqual(result.statusCode, 201)
    assert.strictEqual(mockClient.calls.length, 1)
    assert.strictEqual(mockClient.calls[0].options.hostname, "api.twilio.com")
    assert.strictEqual(mockClient.calls[0].data, "To=+15551234567&Body=test")
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

  it("returns custom response body with Twilio format", async () => {
    const mockClient = createMockHttpClient({
      statusCode: 201,
      body: JSON.stringify({ sid: "SM123", status: "queued" }),
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

    assert.strictEqual(result.sid, "SM123")
    assert.strictEqual(result.status, "queued")
  })
})
