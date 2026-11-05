/** @file Unit test: the Effects tab's page table, without the DOM. A tick must
 *  change only the `pages` key of one effect and leave the rest of the override
 *  blob exactly as it was; and the thank-you composer must not copy `pages` onto
 *  a card. Imports browser modules, so this file is excluded from the server
 *  tsconfig (same pattern as effect-themes.test.js).
 */

import { test } from "node:test"
import assert from "node:assert"
import {
  parseOverrideText,
  placementOf,
  toggledPlacement,
  withPlacement,
} from "../../public/pages/admin/effect-placement.js"
import { themeSeedConfig } from "../../public/pages/admin/thank-you-util.js"
import { resolveTheme } from "../../public/effects/themes.js"

const disco = resolveTheme("mermaid-disco")

test("parseOverrideText: blank is {}, and anything the table can't edit is null", () => {
  assert.deepEqual(parseOverrideText("   "), {})
  assert.deepEqual(parseOverrideText('{ "cursor": { "size": 2 } }'), { cursor: { size: 2 } })
  assert.equal(parseOverrideText("{ nope"), null)
  assert.equal(parseOverrideText("[]"), null)
  assert.equal(parseOverrideText('{ "cursor": 5 }'), null)
})

test("placementOf: the override's pages, else the theme's", () => {
  assert.equal(placementOf({}, disco, "cursor"), "all")
  assert.equal(placementOf({}, disco, "shimmer"), undefined)
  assert.deepEqual(placementOf({ cursor: { pages: ["home"] } }, disco, "cursor"), ["home"])
  assert.equal(placementOf({ cursor: { size: 2 } }, disco, "cursor"), "all")
})

test("toggledPlacement: one page at a time, collapsing to all", () => {
  assert.deepEqual(toggledPlacement("all", "gallery", false), ["home", "guestbook", "rsvp"])
  assert.deepEqual(toggledPlacement(undefined, "guestbook", true), ["home", "guestbook"])
  assert.deepEqual(toggledPlacement(undefined, "home", false), [])
  assert.equal(toggledPlacement(["home", "guestbook", "gallery"], "rsvp", true), "all")
})

test("withPlacement keeps every other key in the blob", () => {
  const before = {
    cursor: { size: 2, colors: ["#fff"] },
    snow: { flakeCount: 9 },
    parallaxsparkles: { density: 30 },
  }
  const snapshot = structuredClone(before)
  const after = withPlacement(before, disco, "cursor", ["home"])
  assert.deepEqual(after, {
    cursor: { size: 2, colors: ["#fff"], pages: ["home"] },
    snow: { flakeCount: 9 },
    parallaxsparkles: { density: 30 },
  })
  assert.deepEqual(before, snapshot, "the input is not mutated")
})

test("withPlacement says nothing when the theme already says it", () => {
  // Back to the theme's "all": the key goes, the tuned value stays.
  const tuned = { cursor: { size: 2, pages: ["home"] } }
  assert.deepEqual(withPlacement(tuned, disco, "cursor", "all"), { cursor: { size: 2 } })
  // An entry with nothing left goes too.
  const placedOnly = { cursor: { pages: ["home"] }, snow: { flakeCount: 9 } }
  assert.deepEqual(withPlacement(placedOnly, disco, "cursor", "all"), { snow: { flakeCount: 9 } })
  // No theme pages = home only, so ["home"] matches it.
  assert.deepEqual(withPlacement({ shimmer: { pages: "all" } }, disco, "shimmer", ["home"]), {})
  // A list naming every page is the same as "all".
  assert.deepEqual(withPlacement({}, disco, "cursor", ["home", "guestbook", "gallery", "rsvp"]), {})
})

test("the composer seeds a card from a theme without its pages key", () => {
  assert.deepEqual(themeSeedConfig(disco, "cursor"), {})
  assert.deepEqual(themeSeedConfig(disco, "shimmer"), {})
  const elegant = resolveTheme("elegant")
  assert.deepEqual(themeSeedConfig(elegant, "namespark"), { shimmerColor: "gold" })
  // A copy: editing the card can't edit the theme.
  const seeded = themeSeedConfig(elegant, "parallaxsparkles")
  seeded.density = 1
  assert.equal(elegant.configs?.parallaxsparkles.density, 10)
})
