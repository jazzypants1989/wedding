import { describe, it } from "node:test"
import assert from "node:assert"
import {
  validatePartySize,
  validateEmail,
  validatePhone,
  validateInviteCode,
  validateId,
  validateIdArray,
} from "../../../core/validation.js"

describe("validatePartySize", () => {
  it("accepts valid party size", () => {
    const result = validatePartySize(4)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 4)
  })

  it("accepts string numbers", () => {
    const result = validatePartySize("5")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 5)
  })

  it("accepts minimum (1)", () => {
    const result = validatePartySize(1)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 1)
  })

  it("accepts maximum (20)", () => {
    const result = validatePartySize(20)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 20)
  })

  it("rejects zero", () => {
    const result = validatePartySize(0)
    assert.strictEqual(result.valid, false)
    assert.ok(result.error.includes("between"))
  })

  it("rejects negative numbers", () => {
    const result = validatePartySize(-5)
    assert.strictEqual(result.valid, false)
  })

  it("rejects numbers over maximum", () => {
    const result = validatePartySize(21)
    assert.strictEqual(result.valid, false)
  })

  it("rejects non-numeric strings", () => {
    const result = validatePartySize("abc")
    assert.strictEqual(result.valid, false)
  })

  it("rejects null", () => {
    const result = validatePartySize(null)
    assert.strictEqual(result.valid, false)
  })

  it("rejects undefined", () => {
    const result = validatePartySize(undefined)
    assert.strictEqual(result.valid, false)
  })
})

describe("validateEmail", () => {
  it("accepts valid email", () => {
    const result = validateEmail("test@example.com")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "test@example.com")
  })

  it("accepts email with subdomain", () => {
    const result = validateEmail("user@mail.example.com")
    assert.strictEqual(result.valid, true)
  })

  it("trims whitespace", () => {
    const result = validateEmail("  test@example.com  ")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "test@example.com")
  })

  it("returns null for empty when not required", () => {
    const result = validateEmail("")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, null)
  })

  it("returns null for whitespace when not required", () => {
    const result = validateEmail("   ")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, null)
  })

  it("rejects empty when required", () => {
    const result = validateEmail("", { required: true })
    assert.strictEqual(result.valid, false)
    assert.ok(result.error.includes("required"))
  })

  it("rejects email without @", () => {
    const result = validateEmail("testexample.com")
    assert.strictEqual(result.valid, false)
  })

  it("rejects email without domain", () => {
    const result = validateEmail("test@")
    assert.strictEqual(result.valid, false)
  })

  it("rejects email without local part", () => {
    const result = validateEmail("@example.com")
    assert.strictEqual(result.valid, false)
  })

  it("rejects email with multiple @", () => {
    const result = validateEmail("test@test@example.com")
    assert.strictEqual(result.valid, false)
  })

  it("rejects email without TLD", () => {
    const result = validateEmail("test@example")
    assert.strictEqual(result.valid, false)
  })

  it("rejects email with single-char TLD", () => {
    const result = validateEmail("test@example.a")
    assert.strictEqual(result.valid, false)
  })
})

describe("validatePhone", () => {
  it("normalizes 10-digit US number", () => {
    const result = validatePhone("5551234567")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "+15551234567")
  })

  it("normalizes formatted phone", () => {
    const result = validatePhone("(555) 123-4567")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "+15551234567")
  })

  it("normalizes 11-digit with country code", () => {
    const result = validatePhone("15551234567")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "+15551234567")
  })

  it("accepts international format", () => {
    const result = validatePhone("+447911123456")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "+447911123456")
  })

  it("returns null for empty when not required", () => {
    const result = validatePhone("")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, null)
  })

  it("rejects empty when required", () => {
    const result = validatePhone("", { required: true })
    assert.strictEqual(result.valid, false)
  })

  it("rejects too short", () => {
    const result = validatePhone("12345")
    assert.strictEqual(result.valid, false)
  })

  it("rejects too long", () => {
    const result = validatePhone("1234567890123456")
    assert.strictEqual(result.valid, false)
  })
})

describe("validateInviteCode", () => {
  it("accepts valid 8-char alphanumeric", () => {
    const result = validateInviteCode("ABcd1234")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "ABcd1234")
  })

  it("trims whitespace", () => {
    const result = validateInviteCode("  ABcd1234  ")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, "ABcd1234")
  })

  it("rejects too short", () => {
    const result = validateInviteCode("ABC1234")
    assert.strictEqual(result.valid, false)
  })

  it("rejects too long", () => {
    const result = validateInviteCode("ABcd12345")
    assert.strictEqual(result.valid, false)
  })

  it("rejects special characters", () => {
    const result = validateInviteCode("ABcd123!")
    assert.strictEqual(result.valid, false)
  })

  it("rejects spaces", () => {
    const result = validateInviteCode("AB cd1234")
    assert.strictEqual(result.valid, false)
  })

  it("rejects null", () => {
    const result = validateInviteCode(null)
    assert.strictEqual(result.valid, false)
  })
})

describe("validateId", () => {
  it("accepts positive integer", () => {
    const result = validateId(123)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 123)
  })

  it("accepts string number", () => {
    const result = validateId("456")
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value, 456)
  })

  it("rejects zero", () => {
    const result = validateId(0)
    assert.strictEqual(result.valid, false)
  })

  it("rejects negative", () => {
    const result = validateId(-1)
    assert.strictEqual(result.valid, false)
  })

  it("rejects non-numeric", () => {
    const result = validateId("abc")
    assert.strictEqual(result.valid, false)
  })
})

describe("validateIdArray", () => {
  it("accepts array of valid IDs", () => {
    const result = validateIdArray([1, 2, 3])
    assert.strictEqual(result.valid, true)
    assert.deepStrictEqual(result.value, [1, 2, 3])
  })

  it("accepts array of string IDs", () => {
    const result = validateIdArray(["1", "2", "3"])
    assert.strictEqual(result.valid, true)
    assert.deepStrictEqual(result.value, [1, 2, 3])
  })

  it("rejects empty array", () => {
    const result = validateIdArray([])
    assert.strictEqual(result.valid, false)
  })

  it("rejects non-array", () => {
    const result = validateIdArray("not an array")
    assert.strictEqual(result.valid, false)
  })

  it("rejects array with invalid ID", () => {
    const result = validateIdArray([1, "abc", 3])
    assert.strictEqual(result.valid, false)
  })

  it("rejects array exceeding default max length of 50", () => {
    const ids = Array.from({ length: 51 }, (_, i) => i + 1)
    const result = validateIdArray(ids)
    assert.strictEqual(result.valid, false)
    assert.ok(result.error.includes("exceeds maximum"))
    assert.ok(result.error.includes("50"))
  })

  it("accepts array at exactly max length", () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1)
    const result = validateIdArray(ids)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.value.length, 50)
  })

  it("accepts custom max length", () => {
    const ids = [1, 2, 3, 4, 5]
    const result = validateIdArray(ids, "IDs", 10)
    assert.strictEqual(result.valid, true)
  })

  it("rejects array exceeding custom max length", () => {
    const ids = [1, 2, 3, 4, 5]
    const result = validateIdArray(ids, "guestIds", 3)
    assert.strictEqual(result.valid, false)
    assert.ok(result.error.includes("3"))
  })
})
