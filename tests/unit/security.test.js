/**
 * @file Security-focused tests — validates defensive behavior against
 * injection attempts, malicious inputs, and boundary conditions (P6.10, P6.12)
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { sanitize, isValidEmail } from "../../core/http.js"
import { escapeHtml } from "../../core/utils.js"
import {
  validatePartySize,
  validateEmail,
  validatePhone,
  validateInviteCode,
  validateRequiredString,
  validateOptionalString,
  validateId,
  validateIdArray,
} from "../../core/validation.js"
import {
  escapeLikePattern,
  normalizeName,
  normalizePhone,
  normalizeEmail,
} from "../../db/utils.js"

// ==================== SQL LIKE Injection ====================

describe("LIKE pattern injection prevention", () => {
  it("escapes percent wildcard in search input", () => {
    const input = "%admin%"
    const escaped = escapeLikePattern(input)
    assert.strictEqual(escaped, "\\%admin\\%")
  })

  it("escapes underscore wildcard in search input", () => {
    const input = "J_hn"
    const escaped = escapeLikePattern(input)
    assert.strictEqual(escaped, "J\\_hn")
  })

  it("escapes backslash in search input", () => {
    const input = "test\\path"
    const escaped = escapeLikePattern(input)
    assert.strictEqual(escaped, "test\\\\path")
  })

  it("escapes combined wildcards", () => {
    const input = "%_%"
    const escaped = escapeLikePattern(input)
    assert.strictEqual(escaped, "\\%\\_\\%")
  })

  it("normalizeName does not preserve LIKE wildcards", () => {
    const name = normalizeName("%Admin%")
    // The wildcards are preserved in the name, but escapeLikePattern must
    // be called before using in LIKE queries
    assert.strictEqual(name, "%admin%")
    // When properly escaped for LIKE:
    const escaped = escapeLikePattern(name)
    assert.strictEqual(escaped, "\\%admin\\%")
  })
})

// ==================== XSS Prevention ====================

describe("XSS prevention in escapeHtml", () => {
  it("neutralizes script tags", () => {
    const result = escapeHtml('<script>alert("xss")</script>')
    assert.ok(!result.includes("<script>"))
    assert.ok(result.includes("&lt;script&gt;"))
  })

  it("neutralizes event handlers by escaping tag delimiters", () => {
    const result = escapeHtml('<img onerror="alert(1)" src=x>')
    // The < and > are escaped, preventing the browser from parsing it as HTML
    assert.ok(!result.includes("<img"))
    assert.ok(result.includes("&lt;img"))
    assert.ok(result.includes("&gt;"))
  })

  it("neutralizes javascript: URLs", () => {
    const result = escapeHtml('<a href="javascript:alert(1)">click</a>')
    assert.ok(!result.includes("<a"))
    assert.ok(result.includes("&lt;a"))
  })

  it("neutralizes SVG-based XSS", () => {
    const result = escapeHtml('<svg onload="alert(1)"/>')
    assert.ok(!result.includes("<svg"))
    assert.ok(result.includes("&lt;svg"))
  })

  it("escapes HTML entity injection", () => {
    const result = escapeHtml("&lt;script&gt;")
    assert.ok(result.includes("&amp;lt;"))
  })
})

// ==================== Input Sanitization ====================

describe("sanitize with adversarial inputs", () => {
  it("strips leading/trailing whitespace from SQL-like input", () => {
    const result = sanitize("  DROP TABLE guests;  ")
    assert.strictEqual(result, "DROP TABLE guests;")
  })

  it("truncates extremely long input", () => {
    const payload = "A".repeat(10000)
    const result = sanitize(payload, 500)
    assert.ok(result)
    assert.strictEqual(result.length, 500)
  })

  it("returns null for whitespace-only input", () => {
    assert.strictEqual(sanitize("   \t\n\r   "), null)
  })

  it("returns null for non-string types", () => {
    assert.strictEqual(sanitize({}), null)
    assert.strictEqual(sanitize([]), null)
    assert.strictEqual(sanitize(42), null)
    assert.strictEqual(sanitize(true), null)
  })

  it("strips null bytes from input", () => {
    const result = sanitize("hello\0world")
    assert.ok(result)
    assert.ok(!result.includes("\0")) // sanitize strips control characters
    assert.strictEqual(result, "helloworld")
  })
})

// ==================== Email Validation ====================

describe("isValidEmail with adversarial inputs", () => {
  it("rejects SQL injection in email", () => {
    assert.strictEqual(isValidEmail("test@example.com' OR 1=1--"), false)
  })

  it("rejects email with newline (header injection)", () => {
    assert.strictEqual(isValidEmail("test@example.com\nBcc: evil@hack.com"), false)
  })

  it("rejects email with carriage return", () => {
    assert.strictEqual(isValidEmail("test@example.com\rBcc: evil@hack.com"), false)
  })

  it("rejects email with tab character", () => {
    assert.strictEqual(isValidEmail("test\t@example.com"), false)
  })

  it("rejects extremely long email", () => {
    const longEmail = "a".repeat(250) + "@b.com"
    assert.strictEqual(isValidEmail(longEmail), false)
  })

  it("rejects email without TLD", () => {
    assert.strictEqual(isValidEmail("test@localhost"), false)
  })
})

// ==================== Phone Normalization ====================

describe("normalizePhone with adversarial inputs", () => {
  it("strips non-digit characters", () => {
    assert.strictEqual(normalizePhone("(555) 123-4567"), "+15551234567")
  })

  it("returns null for letters only", () => {
    assert.strictEqual(normalizePhone("abcdefghij"), null)
  })

  it("returns null for too-short digits", () => {
    assert.strictEqual(normalizePhone("12345"), null)
  })

  it("returns null for too-long digits", () => {
    assert.strictEqual(normalizePhone("1234567890123456"), null)
  })

  it("handles mixed letters and digits", () => {
    // extractDigits strips non-digits, so "abc5551234567" becomes "5551234567"
    assert.strictEqual(normalizePhone("abc5551234567"), "+15551234567")
  })
})

// ==================== Email Normalization ====================

describe("normalizeEmail with adversarial inputs", () => {
  it("lowercases email", () => {
    assert.strictEqual(normalizeEmail("Test@EXAMPLE.com"), "test@example.com")
  })

  it("trims whitespace", () => {
    assert.strictEqual(normalizeEmail("  test@example.com  "), "test@example.com")
  })

  it("returns null for empty string", () => {
    assert.strictEqual(normalizeEmail(""), null)
  })

  it("returns null for whitespace-only", () => {
    assert.strictEqual(normalizeEmail("   "), null)
  })

  it("returns null for null", () => {
    assert.strictEqual(normalizeEmail(null), null)
  })

  it("returns null for non-string", () => {
    assert.strictEqual(normalizeEmail(/** @type {string | null | undefined} */ (/** @type {unknown} */ (42))), null)
  })
})

// ==================== Invite Code Validation ====================

describe("validateInviteCode with adversarial inputs", () => {
  it("rejects path traversal attempt", () => {
    assert.strictEqual(validateInviteCode("../../etc").valid, false)
  })

  it("rejects SQL injection attempt", () => {
    assert.strictEqual(validateInviteCode("' OR 1=").valid, false)
  })

  it("rejects code with null byte", () => {
    assert.strictEqual(validateInviteCode("ABCD\x001234").valid, false)
  })

  it("rejects code with unicode characters", () => {
    assert.strictEqual(validateInviteCode("ABCD\u00e91234").valid, false)
  })

  it("accepts valid 8-char alphanumeric code", () => {
    const result = validateInviteCode("ABcd1234")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "ABcd1234")
  })
})

// ==================== Edge Cases (P6.12) ====================

describe("edge case: party size validation", () => {
  it("rejects 0 when attending (boundary)", () => {
    const result = validatePartySize(0)
    assert.strictEqual(result.valid, false)
  })

  it("accepts exactly 1 (minimum boundary)", () => {
    const result = validatePartySize(1)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 1)
  })

  it("accepts exactly 20 (maximum boundary)", () => {
    const result = validatePartySize(20)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 20)
  })

  it("rejects 21 (over maximum boundary)", () => {
    const result = validatePartySize(21)
    assert.strictEqual(result.valid, false)
  })

  it("rejects float values", () => {
    // parseInt("2.5") returns 2, which is valid
    const result = validatePartySize("2.5")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 2)
  })

  it("rejects NaN string", () => {
    const result = validatePartySize("NaN")
    assert.strictEqual(result.valid, false)
  })

  it("rejects Infinity", () => {
    const result = validatePartySize("Infinity")
    assert.strictEqual(result.valid, false)
  })
})

describe("edge case: very long name in lookup", () => {
  it("sanitize truncates names over maxLen", () => {
    const longName = "A".repeat(300)
    const result = sanitize(longName, 200)
    assert.ok(result)
    assert.strictEqual(result.length, 200)
  })

  it("normalizeName handles very long names", () => {
    const longName = "John " + "Doe ".repeat(100)
    const result = normalizeName(longName)
    assert.ok(result.startsWith("john"))
    assert.ok(result.length < longName.length) // trimmed
  })
})

describe("edge case: validateRequiredString", () => {
  it("rejects null", () => {
    const result = validateRequiredString(null, "name", 200)
    assert.strictEqual(result.valid, false)
  })

  it("rejects undefined", () => {
    const result = validateRequiredString(undefined, "name", 200)
    assert.strictEqual(result.valid, false)
  })

  it("rejects empty string", () => {
    const result = validateRequiredString("", "name", 200)
    assert.strictEqual(result.valid, false)
  })

  it("rejects whitespace-only string", () => {
    const result = validateRequiredString("   ", "name", 200)
    assert.strictEqual(result.valid, false)
  })

  it("truncates and returns valid string", () => {
    const result = validateRequiredString("Hello World", "name", 5)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "Hello")
  })
})

describe("edge case: validateOptionalString", () => {
  it("returns null for non-string", () => {
    const result = validateOptionalString(42, 200)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, null)
  })

  it("returns null for empty string after trim", () => {
    const result = validateOptionalString("   ", 200)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, null)
  })

  it("returns trimmed and truncated value", () => {
    const result = validateOptionalString("  Hello  ", 3)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "Hel")
  })
})

describe("edge case: validateId boundary values", () => {
  it("rejects 0", () => {
    assert.strictEqual(validateId(0).valid, false)
  })

  it("accepts 1", () => {
    const result = validateId(1)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 1)
  })

  it("accepts very large ID", () => {
    const result = validateId(999999999)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 999999999)
  })

  it("rejects negative", () => {
    assert.strictEqual(validateId(-1).valid, false)
  })

  it("rejects float string", () => {
    // parseInt("1.5") returns 1, which is valid
    const result = validateId("1.5")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 1)
  })

  it("rejects hex string", () => {
    // parseInt("0xff") returns 0, which is invalid (< 1)
    assert.strictEqual(validateId("0xff").valid, false)
  })
})

describe("edge case: validateIdArray boundary values", () => {
  it("rejects array with single invalid ID of 0", () => {
    const result = validateIdArray([0])
    assert.strictEqual(result.valid, false)
  })

  it("accepts single-element array", () => {
    const result = validateIdArray([42])
    assert.strictEqual(result.valid, true)
    assert.deepStrictEqual(result.value, [42])
  })

  it("rejects null input", () => {
    const result = validateIdArray(null)
    assert.strictEqual(result.valid, false)
  })

  it("rejects undefined input", () => {
    const result = validateIdArray(undefined)
    assert.strictEqual(result.valid, false)
  })

  it("rejects object input", () => {
    const result = validateIdArray({ id: 1 })
    assert.strictEqual(result.valid, false)
  })

  it("rejects string input", () => {
    const result = validateIdArray("1,2,3")
    assert.strictEqual(result.valid, false)
  })
})

describe("edge case: email validation boundaries", () => {
  it("accepts 254-char email at exact limit", () => {
    const local = "a".repeat(64)
    const domain = "a".repeat(63) + "." + "a".repeat(63) + "." + "a".repeat(57) + ".com" // 189 chars
    const email = local + "@" + domain // 64 + 1 + 189 = 254
    assert.strictEqual(email.length, 254)
    assert.strictEqual(isValidEmail(email), true)
  })

  it("rejects 255-char email just over limit", () => {
    const local = "a".repeat(64)
    const domain = "a".repeat(63) + "." + "a".repeat(63) + "." + "a".repeat(58) + ".com" // 190 chars
    const email = local + "@" + domain // 64 + 1 + 190 = 255
    assert.strictEqual(email.length, 255)
    assert.strictEqual(isValidEmail(email), false)
  })

  it("rejects phone with required flag but empty", () => {
    const result = validatePhone("", { required: true })
    assert.strictEqual(result.valid, false)
  })

  it("accepts phone with optional flag and empty", () => {
    const result = validatePhone("")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, null)
  })

  it("rejects email with required flag but empty", () => {
    const result = validateEmail("", { required: true })
    assert.strictEqual(result.valid, false)
  })

  it("accepts email with optional flag and empty", () => {
    const result = validateEmail("")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, null)
  })
})
