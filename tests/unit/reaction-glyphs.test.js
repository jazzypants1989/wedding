/** @file Unit test: the reaction-bar key→glyph map stays in sync with the
 *  server's REACTION_EMOJI enum (a missing glyph would render a blank pill). */

import { test } from "node:test"
import assert from "node:assert"
import { REACTION_GLYPHS } from "../../public/components/reaction-bar.js"
import { REACTION_EMOJI_VALUES } from "../../types.js"

test("REACTION_GLYPHS maps exactly the REACTION_EMOJI keys, each to a glyph", () => {
  const glyphKeys = Object.keys(REACTION_GLYPHS).sort()
  const emojiKeys = [...REACTION_EMOJI_VALUES].sort()
  assert.deepStrictEqual(glyphKeys, emojiKeys)
  for (const key of emojiKeys) {
    assert.ok(
      typeof REACTION_GLYPHS[key] === "string" && REACTION_GLYPHS[key].length > 0,
      `glyph for "${key}" must be a non-empty string`,
    )
  }
})
