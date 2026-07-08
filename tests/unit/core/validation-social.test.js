/** @file Unit tests for the Phase 5 social validators (target type + reaction emoji). */

import { describe, it } from "node:test"
import assert from "node:assert"
import {
  validateTargetType,
  validateReactionEmoji,
} from "../../../core/validation.js"
import { TARGET_TYPE_VALUES, REACTION_EMOJI_VALUES } from "../../../types.js"

describe("validateTargetType", () => {
  it("accepts every TARGET_TYPE value", () => {
    for (const value of TARGET_TYPE_VALUES) {
      const result = validateTargetType(value)
      assert.strictEqual(result.valid, true)
      if (result.valid) assert.strictEqual(result.value, value)
    }
  })

  it("rejects unknown / wrong-type input", () => {
    for (const bad of ["comment", "", "GUESTBOOK", 1, null, undefined, {}]) {
      assert.strictEqual(validateTargetType(bad).valid, false)
    }
  })
})

describe("validateReactionEmoji", () => {
  it("accepts every REACTION_EMOJI key", () => {
    for (const value of REACTION_EMOJI_VALUES) {
      const result = validateReactionEmoji(value)
      assert.strictEqual(result.valid, true)
      if (result.valid) assert.strictEqual(result.value, value)
    }
  })

  it("rejects unknown / wrong-type input", () => {
    for (const bad of ["banana", "❤️", "Heart", "", 0, null, undefined, []]) {
      assert.strictEqual(validateReactionEmoji(bad).valid, false)
    }
  })
})
