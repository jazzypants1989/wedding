/**
 * @file Unit tests for guestbook message validation bounds.
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { validateRequiredString } from "../../../core/validation.js"
import { LIMITS } from "../../../types.js"

const MAX = LIMITS.GUESTBOOK_MESSAGE_MAX_LENGTH

describe("guestbook message validation", () => {
  it("has a 2000-character ceiling", () => {
    assert.strictEqual(MAX, 2000)
  })

  it("rejects an empty / whitespace-only message", () => {
    for (const value of ["", "   ", "\n\t "]) {
      const result = validateRequiredString(value, "Message", MAX)
      assert.strictEqual(result.valid, false)
    }
  })

  it("rejects a non-string message", () => {
    const result = validateRequiredString(42, "Message", MAX)
    assert.strictEqual(result.valid, false)
  })

  it("accepts a normal message and trims surrounding whitespace", () => {
    const result = validateRequiredString("  Congrats!  ", "Message", MAX)
    assert.strictEqual(result.valid, true)
    if (result.valid) assert.strictEqual(result.value, "Congrats!")
  })

  it("accepts a message exactly at the limit", () => {
    const atLimit = "x".repeat(MAX)
    const result = validateRequiredString(atLimit, "Message", MAX)
    assert.strictEqual(result.valid, true)
    if (result.valid) assert.strictEqual(result.value.length, MAX)
  })

  it("truncates an over-length message to the limit (sanitize slices)", () => {
    const tooLong = "y".repeat(MAX + 500)
    const result = validateRequiredString(tooLong, "Message", MAX)
    assert.strictEqual(result.valid, true)
    if (result.valid) assert.strictEqual(result.value.length, MAX)
  })
})
