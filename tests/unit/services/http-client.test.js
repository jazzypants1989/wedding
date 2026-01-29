/**
 * @file Unit tests for shared HTTP client helper
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { makeServiceRequest } from "../../../services/http-client.js"
import { createMockHttpClient } from "../../mocks/http-client.js"

describe("makeServiceRequest", () => {
  it("returns success with parsed JSON on 200 response", async () => {
    const mockClient = createMockHttpClient({
      statusCode: 200,
      body: JSON.stringify({ id: "msg-123", status: "sent" }),
    })

    const result = await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      { hostname: "api.example.com", path: "/send" },
      "test-data",
    )

    assert.strictEqual(result.success, true)
    assert.deepStrictEqual(result.data, { id: "msg-123", status: "sent" })
    assert.strictEqual(mockClient.calls.length, 1)
    assert.strictEqual(mockClient.calls[0].data, "test-data")
  })

  it("returns success for any 2xx status code", async () => {
    const mockClient = createMockHttpClient({
      statusCode: 201,
      body: JSON.stringify({ id: "created" }),
    })

    const result = await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      {},
      "",
    )

    assert.strictEqual(result.success, true)
    assert.strictEqual(/** @type {Record<string, unknown>} */ (result.data).id, "created")
  })

  it("returns error with message field from response", async () => {
    const mockClient = createMockHttpClient({
      statusCode: 400,
      body: JSON.stringify({ message: "Bad request: missing field" }),
    })

    const result = await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      {},
      "",
    )

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, "Bad request: missing field")
  })

  it("returns error with nested error.message from response", async () => {
    const mockClient = createMockHttpClient({
      statusCode: 422,
      body: JSON.stringify({ error: { message: "Invalid email format" } }),
    })

    const result = await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      {},
      "",
    )

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, "Invalid email format")
  })

  it("returns error with error_message from response", async () => {
    const mockClient = createMockHttpClient({
      statusCode: 500,
      body: JSON.stringify({ error_message: "Internal failure" }),
    })

    const result = await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      {},
      "",
    )

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, "Internal failure")
  })

  it("returns HTTP status code when no error message in body", async () => {
    const mockClient = createMockHttpClient({
      statusCode: 403,
      body: JSON.stringify({ ok: false }),
    })

    const result = await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      {},
      "",
    )

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, "HTTP 403")
  })

  it("returns parse error for non-JSON response", async () => {
    const mockClient = createMockHttpClient({
      statusCode: 200,
      body: "Not JSON at all",
    })

    const result = await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      {},
      "",
    )

    assert.strictEqual(result.success, false)
    assert.ok(/** @type {string} */ (result.error).startsWith("Parse error:"))
  })

  it("returns timeout error when request times out", async () => {
    const mockClient = createMockHttpClient({ timeout: true })

    const result = await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      {},
      "",
    )

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, "Request timed out")
  })

  it("returns error message on connection error", async () => {
    const mockClient = createMockHttpClient({ error: "ECONNREFUSED" })

    const result = await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      {},
      "",
    )

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, "ECONNREFUSED")
  })

  it("rejects response exceeding 64KB size limit", async () => {
    const mockClient = createMockHttpClient({ largeResponse: true })

    const result = await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      {},
      "",
    )

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, "Response too large")
  })

  it("passes options to the HTTP client", async () => {
    const mockClient = createMockHttpClient({
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    })

    await makeServiceRequest(
      /** @type {import('../../../services/types.js').HttpClient} */ (/** @type {unknown} */ (mockClient)),
      {
        hostname: "api.example.com",
        path: "/v1/messages",
        method: "POST",
        port: 443,
        headers: { "Authorization": "Bearer key123" },
      },
      "body-data",
    )

    assert.strictEqual(mockClient.calls[0].options.hostname, "api.example.com")
    assert.strictEqual(mockClient.calls[0].options.path, "/v1/messages")
    assert.strictEqual(mockClient.calls[0].options.method, "POST")
    assert.strictEqual(mockClient.calls[0].data, "body-data")
  })
})
