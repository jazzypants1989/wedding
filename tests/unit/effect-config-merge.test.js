/** @file Unit tests for public/effects/config.js#mergeConfig — the deep-merge
 *  the thank-you card page + composer use to layer a stored partial effect config
 *  over an effect's defaults. Imports a browser module, so this file is excluded
 *  from the server tsconfig (same pattern as effect-themes.test.js). */

import { test } from "node:test"
import assert from "node:assert"

import { mergeConfig } from "../../public/effects/config.js"

test("mergeConfig deep-merges nested plain objects key-by-key", () => {
  const base = { a: { x: 1, y: 2 }, top: "keep" }
  const out = mergeConfig(base, { a: { y: 9, z: 3 } })
  assert.deepEqual(out, { a: { x: 1, y: 9, z: 3 }, top: "keep" })
})

test("mergeConfig replaces arrays wholesale (no element-wise merge)", () => {
  const base = { sizeRange: [2, 5], colors: ["a", "b", "c"] }
  const out = mergeConfig(base, { sizeRange: [7], colors: ["z"] })
  assert.deepEqual(out.sizeRange, [7])
  assert.deepEqual(out.colors, ["z"])
})

test("mergeConfig ignores undefined override values (keeps the base value)", () => {
  const out = mergeConfig({ a: 1, b: 2 }, { a: undefined, b: 5 })
  assert.deepEqual(out, { a: 1, b: 5 })
})

test("mergeConfig does not mutate the base object", () => {
  const base = { a: { x: 1 }, arr: [1, 2] }
  const out = mergeConfig(base, { a: { x: 2 }, arr: [9] })
  // The returned object reflects the override…
  assert.equal(out.a.x, 2)
  assert.deepEqual(out.arr, [9])
  // …but the original is untouched (structuredClone under the hood).
  assert.equal(base.a.x, 1)
  assert.deepEqual(base.arr, [1, 2])
  assert.notStrictEqual(out.a, base.a)
})

test("mergeConfig skips prototype-pollution keys (__proto__, constructor, prototype)", () => {
  // JSON.parse yields these as OWN keys, so the merge must drop them explicitly.
  const evil = JSON.parse(
    '{"density": 3, "__proto__": {"polluted": true}, "constructor": {"bad": 1}, "prototype": {"bad": 1}}',
  )
  const out = mergeConfig({ density: 1 }, evil)
  assert.equal(out.density, 3, "benign sibling key still merges")
  assert.equal(/** @type {*} */ ({}).polluted, undefined, "Object.prototype not polluted")
  // The dangerous keys never became own data properties of the result.
  assert.ok(!Object.prototype.hasOwnProperty.call(out, "polluted"))
})
