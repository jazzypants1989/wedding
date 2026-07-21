/** @file Unit test: the monogram avatar's initial + hue derivation is
 *  deterministic and degrades gracefully on empty / emoji / multi-word names. */

import { test } from "node:test"
import assert from "node:assert"
import { monogramData } from "../../public/components/monogram.js"

test("empty / whitespace names fall back to a glyph", () => {
  for (const name of ["", "   ", "\t\n"]) {
    const { initial } = monogramData(name)
    assert.strictEqual(initial, "✦", `"${name}" should fall back`)
  }
})

test("single Latin word → one uppercased initial", () => {
  assert.strictEqual(monogramData("carol").initial, "C")
  assert.strictEqual(monogramData("Bob").initial, "B")
})

test("multi-word Latin names → first + last word initials, uppercased", () => {
  assert.strictEqual(monogramData("Aunt Carol").initial, "AC")
  assert.strictEqual(monogramData("jesse pence").initial, "JP")
  // First + LAST word (middle names ignored).
  assert.strictEqual(monogramData("Mary Jane Watson").initial, "MW")
  // Couple display name style.
  assert.strictEqual(monogramData("Jesse & Jordana").initial, "JJ")
})

test("emoji-leading names show the leading grapheme (surrogate-safe, not blank)", () => {
  assert.strictEqual(monogramData("🎉Party").initial, "🎉")
  assert.strictEqual(monogramData("😍 love").initial, "😍")
})

test("non-Latin / accented leading char is shown verbatim", () => {
  assert.strictEqual(monogramData("Élise").initial, "É")
  assert.strictEqual(monogramData("张伟").initial, "张")
})

test("digit-leading names keep the digit", () => {
  assert.strictEqual(monogramData("007 Bond").initial, "0")
})

test("hue is deterministic and within [0, 360)", () => {
  const a = monogramData("Aunt Carol")
  const b = monogramData("Aunt Carol")
  assert.strictEqual(a.hue, b.hue)
  assert.ok(a.hue >= 0 && a.hue < 360)
  // Different names generally differ (sanity, not a guarantee).
  assert.notStrictEqual(monogramData("Alice").hue, monogramData("Bob").hue)
})
