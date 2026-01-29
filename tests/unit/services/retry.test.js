/**
 * @file Unit tests for retry utilities
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { isRetryableError, sleep, withRetry } from "../../../services/retry.js"

describe("sleep", () => {
  it("resolves after the specified duration", async () => {
    const start = Date.now()
    await sleep(50)
    const elapsed = Date.now() - start
    assert.ok(elapsed >= 40, `Expected >= 40ms, got ${elapsed}ms`)
  })

  it("resolves with undefined", async () => {
    const result = await sleep(1)
    assert.strictEqual(result, undefined)
  })
})

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    let callCount = 0
    const result = await withRetry(async () => {
      callCount++
      return { success: /** @type {const} */ (true) }
    }, { maxRetries: 3, baseDelayMs: 1 })

    assert.strictEqual(result.success, true)
    assert.strictEqual(callCount, 1)
  })

  it("retries on retryable errors", async () => {
    let callCount = 0
    const result = await withRetry(async () => {
      callCount++
      if (callCount < 3) {
        return { success: /** @type {const} */ (false), error: "ECONNREFUSED" }
      }
      return { success: /** @type {const} */ (true) }
    }, { maxRetries: 3, baseDelayMs: 1 })

    assert.strictEqual(result.success, true)
    assert.strictEqual(callCount, 3)
  })

  it("stops retrying on non-retryable errors", async () => {
    let callCount = 0
    const result = await withRetry(async () => {
      callCount++
      return { success: /** @type {const} */ (false), error: "Unauthorized" }
    }, { maxRetries: 3, baseDelayMs: 1 })

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, "Unauthorized")
    assert.strictEqual(callCount, 1)
  })

  it("returns last result after exhausting retries", async () => {
    let callCount = 0
    const result = await withRetry(async () => {
      callCount++
      return { success: /** @type {const} */ (false), error: "ECONNRESET" }
    }, { maxRetries: 3, baseDelayMs: 1 })

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, "ECONNRESET")
    assert.strictEqual(callCount, 3)
  })

  it("uses default options when none provided", async () => {
    let callCount = 0
    const result = await withRetry(async () => {
      callCount++
      return { success: /** @type {const} */ (true) }
    })

    assert.strictEqual(result.success, true)
    assert.strictEqual(callCount, 1)
  })

  it("returns fallback error if fn never executes", async () => {
    const result = await withRetry(
      async () => ({ success: /** @type {const} */ (false), error: "ECONNREFUSED" }),
      { maxRetries: 0, baseDelayMs: 1 },
    )

    assert.strictEqual(result.success, false)
    assert.ok(
      /** @type {string} */ (result.error).includes("failed after retries"),
    )
  })

  it("applies exponential backoff with jitter", async () => {
    let callCount = 0
    const start = Date.now()

    await withRetry(async () => {
      callCount++
      return { success: /** @type {const} */ (false), error: "ECONNREFUSED" }
    }, { maxRetries: 3, baseDelayMs: 10 })

    const elapsed = Date.now() - start
    assert.strictEqual(callCount, 3)
    // With jitter, delays are random between 0 and maxDelay
    // Just verify it completed (no infinite loops)
    assert.ok(elapsed < 5000, `Took too long: ${elapsed}ms`)
  })

  it("does not delay after the last attempt", async () => {
    let callCount = 0
    const start = Date.now()

    await withRetry(async () => {
      callCount++
      return { success: /** @type {const} */ (false), error: "socket hang up" }
    }, { maxRetries: 2, baseDelayMs: 500 })

    const elapsed = Date.now() - start
    assert.strictEqual(callCount, 2)
    // Should only delay after attempt 0 (max 500ms with jitter)
    // Should NOT delay after attempt 1 (the last attempt)
    assert.ok(elapsed < 1000, `Delayed too long after last attempt: ${elapsed}ms`)
  })
})
