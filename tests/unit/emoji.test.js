/** @file Unit test: the free-emoji reply check (public/components/emoji.js).
 *  Imports a browser component module, so this file is excluded from the server
 *  tsconfig (see tsconfig.json) — same pattern as reaction-glyphs.test.js.
 */

import { test } from "node:test"
import assert from "node:assert"
import {
  isSingleEmoji,
  replyGlyph,
  LEGACY_REPLY_GLYPHS,
  REPLY_QUICK_PICKS,
  MAX_EMOJI_LENGTH,
  lastEmojiIn,
} from "../../public/components/emoji.js"
import { REACTION_GLYPHS } from "../../public/components/reaction-bar.js"

test("accepts single emoji of every construction", () => {
  for (const e of [
    "😀", // plain
    "❤️", // base + VS16
    "☺", // BMP symbol, no selector
    "👍🏽", // skin tone
    "👨‍👩‍👧‍👦", // ZWJ family
    "🧑🏿‍🦱", // skin tone + ZWJ hair
    "🏳️‍🌈", // ZWJ flag with selector
    "🇯🇵", // regional-indicator flag
    "🏴󠁧󠁢󠁳󠁣󠁴󠁿", // subdivision flag (tags)
    "1️⃣", // keycap
    "#️⃣",
    "🫶", // Symbols and Pictographs Extended-A
  ]) {
    assert.ok(isSingleEmoji(e), `should accept ${JSON.stringify(e)}`)
  }
})

test("rejects text, multiples, lone parts and non-strings", () => {
  for (const v of [
    "",
    "a",
    "1", // keycap base without the keycap
    "hi😀",
    "😀😀", // two graphemes
    "😀 ",
    "‍", // lone ZWJ
    "️", // lone selector
    "🇯", // lone regional indicator
    "🏽", // lone skin-tone modifier
    "<script>",
    "é",
    "中",
  ]) {
    assert.strictEqual(isSingleEmoji(v), false, `should reject ${JSON.stringify(v)}`)
  }
  for (const v of [null, undefined, 1, {}, ["😀"]]) assert.strictEqual(isSingleEmoji(v), false)
  assert.strictEqual(isSingleEmoji("😀".repeat(MAX_EMOJI_LENGTH)), false, "over the length cap")
})

test("legacy keys map to the reaction glyphs, and every quick pick is valid", () => {
  assert.deepStrictEqual({ ...LEGACY_REPLY_GLYPHS }, { ...REACTION_GLYPHS })
  for (const key of Object.keys(LEGACY_REPLY_GLYPHS)) {
    assert.strictEqual(replyGlyph(key), REACTION_GLYPHS[/** @type {keyof typeof REACTION_GLYPHS} */ (key)])
  }
  assert.strictEqual(replyGlyph("🥹"), "🥹")
  assert.strictEqual(replyGlyph(null), "")
  assert.strictEqual(replyGlyph("toString"), "toString", "no prototype lookups")
  for (const { glyph, label } of REPLY_QUICK_PICKS) {
    assert.ok(isSingleEmoji(glyph), glyph)
    assert.ok(label.length > 0, `${glyph} has an accessible name`)
  }
  const glyphs = REPLY_QUICK_PICKS.map((p) => p.glyph)
  assert.strictEqual(new Set(glyphs).size, glyphs.length, "no duplicates")
})

test("lastEmojiIn keeps the last emoji typed and ignores text", () => {
  assert.strictEqual(lastEmojiIn("🥹"), "🥹")
  assert.strictEqual(lastEmojiIn("😀 and 👨‍👩‍👧"), "👨‍👩‍👧")
  assert.strictEqual(lastEmojiIn("👍🏽ok"), "👍🏽")
  assert.strictEqual(lastEmojiIn("hello"), null)
  assert.strictEqual(lastEmojiIn(""), null)
})
