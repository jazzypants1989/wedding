/** @file Unit test: the list pane's dragged width stays usable on both sides.
 *  Imports a browser module, so it is excluded from the server tsconfig. */

import { test } from "node:test"
import assert from "node:assert"

import { clampListWidth } from "../../public/pages/admin/split-resize.js"

test("a width inside the range is kept, rounded to a pixel", () => {
  assert.strictEqual(clampListWidth(420.4, 1600), 420)
})

test("the list never gets narrower than 280px", () => {
  assert.strictEqual(clampListWidth(120, 1600), 280)
  assert.strictEqual(clampListWidth(-40, 1600), 280)
})

test("the list never gets wider than 720px on a wide screen", () => {
  assert.strictEqual(clampListWidth(1100, 1700), 720)
})

test("the detail keeps at least 480px", () => {
  assert.strictEqual(clampListWidth(700, 1000), 520)
})

test("a split too narrow for both minimums keeps the list's minimum", () => {
  assert.strictEqual(clampListWidth(500, 700), 280)
})
