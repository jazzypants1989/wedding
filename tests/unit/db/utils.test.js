/**
 * Unit tests for database utility functions (pure functions only)
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import {
  generateInviteCode,
  normalizePhone,
  extractDigits,
  levenshteinDistance,
  normalizeName,
  maskEmail,
  maskPhone,
  escapeLikePattern,
  now,
} from "../../../db/utils.js"

describe("generateInviteCode", () => {
  it("returns an 8-character string", () => {
    const code = generateInviteCode()
    assert.strictEqual(typeof code, "string")
    assert.strictEqual(code.length, 8)
  })

  it("contains only alphanumeric characters", () => {
    const code = generateInviteCode()
    const alphanumeric = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    for (const char of code) {
      assert.ok(alphanumeric.includes(char), `Unexpected character: ${char}`)
    }
  })

  it("generates unique codes", () => {
    const codes = new Set()
    for (let i = 0; i < 100; i++) {
      codes.add(generateInviteCode())
    }
    assert.strictEqual(codes.size, 100)
  })
})

describe("extractDigits", () => {
  it("extracts digits from mixed string", () => {
    assert.strictEqual(extractDigits("abc123def456"), "123456")
  })

  it("returns empty string for no digits", () => {
    assert.strictEqual(extractDigits("abcdef"), "")
  })

  it("returns all digits from digit-only string", () => {
    assert.strictEqual(extractDigits("12345"), "12345")
  })

  it("handles formatted phone number", () => {
    assert.strictEqual(extractDigits("(555) 123-4567"), "5551234567")
  })

  it("handles empty string", () => {
    assert.strictEqual(extractDigits(""), "")
  })

  it("handles special characters", () => {
    assert.strictEqual(extractDigits("+1-555-123-4567"), "15551234567")
  })
})

describe("normalizePhone", () => {
  it("normalizes 10-digit US number", () => {
    assert.strictEqual(normalizePhone("5551234567"), "+15551234567")
  })

  it("normalizes 11-digit US number starting with 1", () => {
    assert.strictEqual(normalizePhone("15551234567"), "+15551234567")
  })

  it("normalizes formatted phone", () => {
    assert.strictEqual(normalizePhone("(555) 123-4567"), "+15551234567")
  })

  it("handles international number with + prefix", () => {
    assert.strictEqual(normalizePhone("+447911123456"), "+447911123456")
  })

  it("returns null for empty input", () => {
    assert.strictEqual(normalizePhone(""), null)
  })

  it("returns null for null input", () => {
    assert.strictEqual(normalizePhone(null), null)
  })

  it("returns null for too-short number", () => {
    assert.strictEqual(normalizePhone("12345"), null)
  })

  it("returns null for too-long number", () => {
    assert.strictEqual(normalizePhone("1234567890123456"), null)
  })

  it("normalizes 7-digit number", () => {
    assert.strictEqual(normalizePhone("5551234"), "+5551234")
  })
})

describe("normalizeName", () => {
  it("lowercases name", () => {
    assert.strictEqual(normalizeName("John Doe"), "john doe")
  })

  it("trims whitespace", () => {
    assert.strictEqual(normalizeName("  John  "), "john")
  })

  it("collapses multiple spaces", () => {
    assert.strictEqual(normalizeName("John    Doe"), "john doe")
  })

  it("returns empty string for null", () => {
    assert.strictEqual(normalizeName(null), "")
  })

  it("returns empty string for empty string", () => {
    assert.strictEqual(normalizeName(""), "")
  })

  it("handles single word", () => {
    assert.strictEqual(normalizeName("John"), "john")
  })

  it("handles leading/trailing/internal whitespace", () => {
    assert.strictEqual(normalizeName("  John   Q   Doe  "), "john q doe")
  })
})

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    assert.strictEqual(levenshteinDistance("abc", "abc"), 0)
  })

  it("returns string length for empty second string", () => {
    assert.strictEqual(levenshteinDistance("abc", ""), 3)
  })

  it("returns other string length for empty first string", () => {
    assert.strictEqual(levenshteinDistance("", "abc"), 3)
  })

  it("returns 0 for two empty strings", () => {
    assert.strictEqual(levenshteinDistance("", ""), 0)
  })

  it("handles null inputs", () => {
    assert.strictEqual(levenshteinDistance(null, "abc"), 3)
    assert.strictEqual(levenshteinDistance("abc", null), 3)
  })

  it("calculates single insertion", () => {
    assert.strictEqual(levenshteinDistance("abc", "abcd"), 1)
  })

  it("calculates single deletion", () => {
    assert.strictEqual(levenshteinDistance("abcd", "abc"), 1)
  })

  it("calculates single substitution", () => {
    assert.strictEqual(levenshteinDistance("abc", "axc"), 1)
  })

  it("calculates multi-edit distance", () => {
    assert.strictEqual(levenshteinDistance("kitten", "sitting"), 3)
  })

  it("is symmetric", () => {
    const d1 = levenshteinDistance("abc", "xyz")
    const d2 = levenshteinDistance("xyz", "abc")
    assert.strictEqual(d1, d2)
  })
})

describe("maskEmail", () => {
  it("masks email keeping first char and domain", () => {
    assert.strictEqual(maskEmail("john@example.com"), "j***@example.com")
  })

  it("returns null for null input", () => {
    assert.strictEqual(maskEmail(null), null)
  })

  it("returns null for empty string", () => {
    assert.strictEqual(maskEmail(""), null)
  })

  it("handles single-char local part", () => {
    assert.strictEqual(maskEmail("j@test.com"), "j***@test.com")
  })

  it("returns email unchanged if no @ sign", () => {
    assert.strictEqual(maskEmail("noemail"), "noemail")
  })
})

describe("maskPhone", () => {
  it("masks phone showing last 4 digits", () => {
    assert.strictEqual(maskPhone("+15551234567"), "***-***-4567")
  })

  it("returns null for null input", () => {
    assert.strictEqual(maskPhone(null), null)
  })

  it("returns null for empty string", () => {
    assert.strictEqual(maskPhone(""), null)
  })

  it("returns *** for very short input", () => {
    assert.strictEqual(maskPhone("123"), "***")
  })

  it("handles formatted phone", () => {
    assert.strictEqual(maskPhone("(555) 123-4567"), "***-***-4567")
  })
})

describe("escapeLikePattern", () => {
  it("escapes percent sign", () => {
    assert.strictEqual(escapeLikePattern("50%"), "50\\%")
  })

  it("escapes underscore", () => {
    assert.strictEqual(escapeLikePattern("a_b"), "a\\_b")
  })

  it("escapes backslash", () => {
    assert.strictEqual(escapeLikePattern("a\\b"), "a\\\\b")
  })

  it("returns normal string unchanged", () => {
    assert.strictEqual(escapeLikePattern("hello"), "hello")
  })

  it("returns empty string unchanged", () => {
    assert.strictEqual(escapeLikePattern(""), "")
  })

  it("returns null for null input", () => {
    assert.strictEqual(escapeLikePattern(null), null)
  })

  it("escapes multiple special chars", () => {
    assert.strictEqual(escapeLikePattern("a%b_c\\d"), "a\\%b\\_c\\\\d")
  })
})

describe("now", () => {
  it("returns an ISO 8601 string", () => {
    const result = now()
    assert.ok(typeof result === "string")
    assert.ok(result.includes("T"))
    assert.ok(result.endsWith("Z"))
    // Should be parseable as a date
    assert.ok(!isNaN(new Date(result).getTime()))
  })

  it("returns approximately current time", () => {
    const before = Date.now()
    const result = now()
    const after = Date.now()
    const resultMs = new Date(result).getTime()
    assert.ok(resultMs >= before - 1000)
    assert.ok(resultMs <= after + 1000)
  })
})
