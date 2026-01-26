/**
 * Unit tests for authentication module
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import {
  hashPassword,
  verifyPassword,
  parseCookies,
  validateCsrf,
} from "../../../core/auth.js"

describe("hashPassword", () => {
  it("returns a string with salt:hash format", () => {
    const result = hashPassword("test123")
    assert.ok(typeof result === "string")
    assert.ok(result.includes(":"))
    const [salt, hash] = result.split(":")
    assert.strictEqual(salt.length, 32) // 16 bytes = 32 hex chars
    assert.strictEqual(hash.length, 128) // 64 bytes = 128 hex chars
  })

  it("produces different hashes for same password (random salt)", () => {
    const hash1 = hashPassword("test123")
    const hash2 = hashPassword("test123")
    assert.notStrictEqual(hash1, hash2)
  })

  it("handles empty password", () => {
    const result = hashPassword("")
    assert.ok(typeof result === "string")
    assert.ok(result.includes(":"))
  })

  it("handles unicode characters", () => {
    const result = hashPassword("пароль123")
    assert.ok(typeof result === "string")
    assert.ok(result.includes(":"))
  })

  it("handles very long passwords", () => {
    const longPassword = "a".repeat(10000)
    const result = hashPassword(longPassword)
    assert.ok(typeof result === "string")
    assert.ok(result.includes(":"))
  })
})

describe("verifyPassword", () => {
  it("returns true for correct password", () => {
    const hash = hashPassword("correct")
    assert.strictEqual(verifyPassword("correct", hash), true)
  })

  it("returns false for incorrect password", () => {
    const hash = hashPassword("correct")
    assert.strictEqual(verifyPassword("wrong", hash), false)
  })

  it("returns false for malformed hash (missing colon)", () => {
    assert.strictEqual(verifyPassword("test", "nocolon"), false)
  })

  it("returns false for malformed hash (wrong hash length)", () => {
    // Valid salt length (32 hex chars) but wrong hash length
    const invalidHash = "a".repeat(32) + ":" + "b".repeat(64)
    assert.strictEqual(verifyPassword("test", invalidHash), false)
  })

  it("returns false for null hash", () => {
    assert.strictEqual(verifyPassword("test", null), false)
  })

  it("returns false for undefined hash", () => {
    assert.strictEqual(verifyPassword("test", undefined), false)
  })

  it("returns false for empty string hash", () => {
    assert.strictEqual(verifyPassword("test", ""), false)
  })

  it("handles unicode passwords correctly", () => {
    const hash = hashPassword("пароль123")
    assert.strictEqual(verifyPassword("пароль123", hash), true)
    assert.strictEqual(verifyPassword("пароль124", hash), false)
  })

  it("is case sensitive", () => {
    const hash = hashPassword("Password")
    assert.strictEqual(verifyPassword("Password", hash), true)
    assert.strictEqual(verifyPassword("password", hash), false)
    assert.strictEqual(verifyPassword("PASSWORD", hash), false)
  })
})

describe("parseCookies", () => {
  it("parses simple cookie string", () => {
    const result = parseCookies("name=value")
    assert.deepStrictEqual(result, { name: "value" })
  })

  it("parses multiple cookies", () => {
    const result = parseCookies("a=1; b=2; c=3")
    assert.deepStrictEqual(result, { a: "1", b: "2", c: "3" })
  })

  it("handles empty string", () => {
    const result = parseCookies("")
    assert.deepStrictEqual(result, {})
  })

  it("handles null", () => {
    assert.deepStrictEqual(parseCookies(null), {})
  })

  it("handles undefined", () => {
    assert.deepStrictEqual(parseCookies(undefined), {})
  })

  it("handles cookies with = in value", () => {
    const result = parseCookies("token=abc=def=ghi")
    assert.strictEqual(result.token, "abc=def=ghi")
  })

  it("handles cookies with empty value", () => {
    const result = parseCookies("empty=; hasvalue=test")
    assert.strictEqual(result.empty, "")
    assert.strictEqual(result.hasvalue, "test")
  })

  it("handles whitespace around cookies", () => {
    // parseCookies trims each cookie pair but not name/value individually
    const result = parseCookies("  name = value ; other = test  ")
    // After trim and split: 'name ' = ' value' and 'other ' = ' test'
    assert.strictEqual(result["name "], " value")
    assert.strictEqual(result["other "], " test")
  })

  it("handles URL-encoded values without decoding", () => {
    const result = parseCookies("name=hello%20world")
    // parseCookies does NOT URL-decode, so this is the raw value
    assert.strictEqual(result.name, "hello%20world")
  })
})

describe("validateCsrf", () => {
  it("returns true for matching tokens", () => {
    const req = { headers: { "x-csrf-token": "abc123" } }
    const session = { csrf_token: "abc123" }
    assert.strictEqual(validateCsrf(req, session), true)
  })

  it("returns false for mismatched tokens", () => {
    const req = { headers: { "x-csrf-token": "abc123" } }
    const session = { csrf_token: "xyz789" }
    assert.strictEqual(validateCsrf(req, session), false)
  })

  it("returns false for missing header", () => {
    const req = { headers: {} }
    const session = { csrf_token: "abc123" }
    assert.strictEqual(validateCsrf(req, session), false)
  })

  it("returns false for null session", () => {
    const req = { headers: { "x-csrf-token": "abc123" } }
    assert.strictEqual(validateCsrf(req, null), false)
  })

  it("returns false for undefined session", () => {
    const req = { headers: { "x-csrf-token": "abc123" } }
    assert.strictEqual(validateCsrf(req, undefined), false)
  })

  it("returns false for session without csrf_token", () => {
    const req = { headers: { "x-csrf-token": "abc123" } }
    const session = {}
    assert.strictEqual(validateCsrf(req, session), false)
  })

  it("returns false for different length tokens", () => {
    const req = { headers: { "x-csrf-token": "short" } }
    const session = { csrf_token: "muchlongertoken" }
    assert.strictEqual(validateCsrf(req, session), false)
  })

  it("returns false for empty header token", () => {
    const req = { headers: { "x-csrf-token": "" } }
    const session = { csrf_token: "validtoken" }
    assert.strictEqual(validateCsrf(req, session), false)
  })

  it("returns false for null header token", () => {
    const req = { headers: { "x-csrf-token": null } }
    const session = { csrf_token: "validtoken" }
    assert.strictEqual(validateCsrf(req, session), false)
  })

  it("handles long tokens correctly", () => {
    const longToken = "a".repeat(64)
    const req = { headers: { "x-csrf-token": longToken } }
    const session = { csrf_token: longToken }
    assert.strictEqual(validateCsrf(req, session), true)
  })
})
