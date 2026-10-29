/** @file Unit test: face chip variant choice (public/pages/admin/chip-variant.js).
 *  Imports a browser admin module, so this file is excluded from the server
 *  tsconfig (see tsconfig.json).
 */

import { test } from "node:test"
import assert from "node:assert"
import { chipVariant, THUMB_LONG_EDGE } from "../../public/pages/admin/chip-variant.js"

/** A face box in a 4000x3000 original (thumb scale 0.1).
 *  @param {number} w @param {number} h */
const photo = (w, h) => ({ width: 4000, height: 3000, box: { x: 0, y: 0, w, h } })

test("a face that already fills the chip from thumb loads thumb", () => {
  // 4000px original -> thumb scale 0.1. A 1200px face is 120 thumb px >= 96.
  assert.equal(chipVariant(photo(1200, 1200), 1, 96, 1), "thumb")
})

test("a small face needs display", () => {
  // 400px face -> 40 thumb px < 64.
  assert.equal(chipVariant(photo(400, 400), 1, 64, 1), "display")
})

test("device pixel ratio raises the bar", () => {
  assert.equal(chipVariant(photo(1200, 1200), 1, 96, 1), "thumb")
  assert.equal(chipVariant(photo(1200, 1200), 1, 96, 2), "display")
})

test("the shorter box side decides, and padding counts", () => {
  assert.equal(chipVariant(photo(2000, 500), 1, 64, 1), "display", "50 thumb px on the short side")
  assert.equal(chipVariant(photo(500, 500), 2, 96, 1), "thumb", "padded to 100 thumb px")
})

test("an original smaller than the thumb edge is never 'upscaled' in the arithmetic", () => {
  // 300px original: thumb IS the original, scale 1.
  assert.ok(THUMB_LONG_EDGE > 300)
  assert.equal(chipVariant({ width: 300, height: 300, box: { x: 0, y: 0, w: 100, h: 100 } }, 1, 96, 1), "thumb")
})

test("unknown geometry or an unbounded size always means display", () => {
  assert.equal(chipVariant({ width: null, height: null, box: { x: 0, y: 0, w: 900, h: 900 } }, 1, 64, 1), "display")
  assert.equal(chipVariant({ width: 4000, height: 3000, box: null }, 1, 64, 1), "display")
  assert.equal(chipVariant(photo(4000, 3000), 1, Infinity, 1), "display")
})
