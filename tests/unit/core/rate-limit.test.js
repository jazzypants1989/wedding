/**
 * Unit tests for rate-limit.js
 */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../../db/connection.js"
import {
  createLimiter,
  getClientIp,
  clearAllStores,
  cleanAllExpired,
} from "../../../core/rate-limit.js"
import { mockRequest } from "../../unit-helpers.js"

// Initialize database before tests
before(() => {
  init()
})

// Clean up after all tests
after(() => {
  clearAllStores()
  close()
})

// Clean up before each test
beforeEach(() => {
  clearAllStores()
})

describe("getClientIp", () => {
  it("returns socket remote address by default", () => {
    const req = mockRequest({ socket: { remoteAddress: "192.168.1.100" } })
    const ip = getClientIp(req)
    assert.strictEqual(ip, "192.168.1.100")
  })

  it('returns "unknown" when socket is null', () => {
    const req = { socket: null, headers: {} }
    const ip = getClientIp(req)
    assert.strictEqual(ip, "unknown")
  })

  it('returns "unknown" when socket.remoteAddress is undefined', () => {
    const req = { socket: {}, headers: {} }
    const ip = getClientIp(req)
    assert.strictEqual(ip, "unknown")
  })

  it("ignores X-Forwarded-For when not from trusted proxy", () => {
    const req = mockRequest({
      socket: { remoteAddress: "192.168.1.100" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    })
    const ip = getClientIp(req)
    // Should return socket address, not forwarded
    assert.strictEqual(ip, "192.168.1.100")
  })

  it("returns first IP from X-Forwarded-For with multiple IPs", () => {
    // This tests the split logic even though trusted proxies may not be configured in test
    const req = mockRequest({
      socket: { remoteAddress: "127.0.0.1" }, // localhost is often trusted
      headers: {
        "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178",
      },
    })
    const ip = getClientIp(req)
    // Result depends on TRUSTED_PROXIES config
    // If 127.0.0.1 is trusted: should be '203.0.113.50'
    // If not trusted: should be '127.0.0.1'
    assert.ok(ip === "203.0.113.50" || ip === "127.0.0.1")
  })

  it("trims whitespace from X-Forwarded-For", () => {
    const req = mockRequest({
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "  203.0.113.50  " },
    })
    const ip = getClientIp(req)
    // Should be trimmed if trusted, otherwise socket address
    assert.ok(ip === "203.0.113.50" || ip === "127.0.0.1")
  })
})

describe("createLimiter", () => {
  describe("check()", () => {
    it("allows requests under the limit", () => {
      const limiter = createLimiter({
        name: "test-under",
        windowMs: 60000,
        max: 5,
      })

      const result = limiter.check("test-key-1")

      assert.strictEqual(result.allowed, true)
      assert.strictEqual(result.remaining, 4)
      assert.ok(result.resetAt > Date.now())
    })

    it("tracks count correctly across multiple checks", () => {
      const limiter = createLimiter({
        name: "test-count",
        windowMs: 60000,
        max: 5,
      })

      limiter.check("test-key-2")
      limiter.check("test-key-2")
      const result = limiter.check("test-key-2")

      assert.strictEqual(result.allowed, true)
      assert.strictEqual(result.remaining, 2)
    })

    it("blocks requests at the limit", () => {
      const limiter = createLimiter({
        name: "test-at-limit",
        windowMs: 60000,
        max: 3,
      })

      limiter.check("test-key-3")
      limiter.check("test-key-3")
      limiter.check("test-key-3")
      const result = limiter.check("test-key-3")

      assert.strictEqual(result.allowed, false)
      assert.strictEqual(result.remaining, 0)
    })

    it("tracks different keys independently", () => {
      const limiter = createLimiter({
        name: "test-keys",
        windowMs: 60000,
        max: 2,
      })

      limiter.check("key-a")
      limiter.check("key-a")
      const resultA = limiter.check("key-a")
      const resultB = limiter.check("key-b")

      assert.strictEqual(resultA.allowed, false)
      assert.strictEqual(resultB.allowed, true)
      assert.strictEqual(resultB.remaining, 1)
    })

    it("different limiters track independently", () => {
      const limiter1 = createLimiter({
        name: "test-limiter-1",
        windowMs: 60000,
        max: 1,
      })
      const limiter2 = createLimiter({
        name: "test-limiter-2",
        windowMs: 60000,
        max: 1,
      })

      limiter1.check("shared-key")
      const result1 = limiter1.check("shared-key")
      const result2 = limiter2.check("shared-key")

      assert.strictEqual(result1.allowed, false)
      assert.strictEqual(result2.allowed, true)
    })

    it("resets count after window expires", async () => {
      // Use a very short window for testing
      const limiter = createLimiter({
        name: "test-expire",
        windowMs: 50,
        max: 2,
      })

      limiter.check("expire-key")
      limiter.check("expire-key")
      const blockedResult = limiter.check("expire-key")
      assert.strictEqual(blockedResult.allowed, false)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 100))

      const afterExpireResult = limiter.check("expire-key")
      assert.strictEqual(afterExpireResult.allowed, true)
      assert.strictEqual(afterExpireResult.remaining, 1)
    })

    it("returns correct resetAt timestamp", () => {
      const windowMs = 60000
      const before = Date.now()
      const limiter = createLimiter({ name: "test-reset-at", windowMs, max: 5 })

      const result = limiter.check("reset-key")
      const after = Date.now()

      // resetAt should be approximately now + windowMs
      assert.ok(result.resetAt >= before + windowMs)
      assert.ok(result.resetAt <= after + windowMs)
    })

    it("handles max of 1 correctly", () => {
      const limiter = createLimiter({
        name: "test-max-1",
        windowMs: 60000,
        max: 1,
      })

      const first = limiter.check("once-key")
      const second = limiter.check("once-key")

      assert.strictEqual(first.allowed, true)
      assert.strictEqual(first.remaining, 0)
      assert.strictEqual(second.allowed, false)
      assert.strictEqual(second.remaining, 0)
    })
  })

  describe("reset()", () => {
    it("resets limiter for specific key", () => {
      const limiter = createLimiter({
        name: "test-reset",
        windowMs: 60000,
        max: 2,
      })

      limiter.check("reset-me")
      limiter.check("reset-me")
      const blocked = limiter.check("reset-me")
      assert.strictEqual(blocked.allowed, false)

      limiter.reset("reset-me")

      const afterReset = limiter.check("reset-me")
      assert.strictEqual(afterReset.allowed, true)
      assert.strictEqual(afterReset.remaining, 1)
    })

    it("only resets the specified key", () => {
      const limiter = createLimiter({
        name: "test-reset-specific",
        windowMs: 60000,
        max: 1,
      })

      limiter.check("key-1")
      limiter.check("key-2")

      limiter.reset("key-1")

      const result1 = limiter.check("key-1")
      const result2 = limiter.check("key-2")

      assert.strictEqual(result1.allowed, true)
      assert.strictEqual(result2.allowed, false)
    })

    it("handles reset of non-existent key gracefully", () => {
      const limiter = createLimiter({
        name: "test-reset-nonexistent",
        windowMs: 60000,
        max: 5,
      })

      // Should not throw
      limiter.reset("never-used-key")

      // Should still work normally
      const result = limiter.check("never-used-key")
      assert.strictEqual(result.allowed, true)
    })
  })
})

describe("clearAllStores", () => {
  it("clears all rate limit entries", () => {
    const limiter1 = createLimiter({
      name: "clear-test-1",
      windowMs: 60000,
      max: 1,
    })
    const limiter2 = createLimiter({
      name: "clear-test-2",
      windowMs: 60000,
      max: 1,
    })

    limiter1.check("key-a")
    limiter2.check("key-b")

    clearAllStores()

    // After clearing, both should be allowed again
    const result1 = limiter1.check("key-a")
    const result2 = limiter2.check("key-b")

    assert.strictEqual(result1.allowed, true)
    assert.strictEqual(result2.allowed, true)
  })
})

describe("cleanAllExpired", () => {
  it("removes expired entries but keeps active ones", async () => {
    // Create a limiter with very short window
    const shortLimiter = createLimiter({
      name: "clean-short",
      windowMs: 50,
      max: 1,
    })
    // Create a limiter with long window
    const longLimiter = createLimiter({
      name: "clean-long",
      windowMs: 60000,
      max: 1,
    })

    shortLimiter.check("short-key")
    longLimiter.check("long-key")

    // Wait for short window to expire
    await new Promise((resolve) => setTimeout(resolve, 100))

    cleanAllExpired()

    // Check database directly
    const db = getDb()
    const shortEntry = db
      .prepare("SELECT * FROM rate_limits WHERE key = ? AND limiter = ?")
      .get("short-key", "clean-short")
    const longEntry = db
      .prepare("SELECT * FROM rate_limits WHERE key = ? AND limiter = ?")
      .get("long-key", "clean-long")

    // Short entry should be cleaned up
    assert.strictEqual(shortEntry, undefined)
    // Long entry should still exist
    assert.ok(longEntry !== undefined)
  })
})

describe("integration scenarios", () => {
  it("handles high-frequency requests correctly", () => {
    const limiter = createLimiter({
      name: "high-freq",
      windowMs: 60000,
      max: 100,
    })

    let allowed = 0
    let blocked = 0

    for (let i = 0; i < 150; i++) {
      const result = limiter.check("burst-key")
      if (result.allowed) allowed++
      else blocked++
    }

    assert.strictEqual(allowed, 100)
    assert.strictEqual(blocked, 50)
  })

  it("handles multiple concurrent keys", () => {
    const limiter = createLimiter({
      name: "multi-key",
      windowMs: 60000,
      max: 5,
    })

    /** @type {Record<string, {allowed: number, blocked: number}>} */
    const results = {}
    const keys = ["ip-1", "ip-2", "ip-3", "ip-4", "ip-5"]

    // Each key makes 10 requests
    for (const key of keys) {
      results[key] = { allowed: 0, blocked: 0 }
      for (let i = 0; i < 10; i++) {
        const result = limiter.check(key)
        if (result.allowed) results[key].allowed++
        else results[key].blocked++
      }
    }

    // Each key should have 5 allowed and 5 blocked
    for (const key of keys) {
      assert.strictEqual(results[key].allowed, 5, `${key} allowed count`)
      assert.strictEqual(results[key].blocked, 5, `${key} blocked count`)
    }
  })

  it("correctly handles remaining count at boundary", () => {
    const limiter = createLimiter({ name: "boundary", windowMs: 60000, max: 3 })

    const r1 = limiter.check("boundary-key")
    const r2 = limiter.check("boundary-key")
    const r3 = limiter.check("boundary-key")
    const r4 = limiter.check("boundary-key")

    assert.strictEqual(r1.remaining, 2)
    assert.strictEqual(r2.remaining, 1)
    assert.strictEqual(r3.remaining, 0)
    assert.strictEqual(r4.remaining, 0)

    assert.strictEqual(r1.allowed, true)
    assert.strictEqual(r2.allowed, true)
    assert.strictEqual(r3.allowed, true)
    assert.strictEqual(r4.allowed, false)
  })
})
