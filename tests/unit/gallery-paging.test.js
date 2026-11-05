/** @file Unit test: the gallery's paging rules (public/pages/gallery/paging.js).
 *  Imports a browser module, so it is excluded from the server tsconfig. */

import { describe, it } from "node:test"
import assert from "node:assert"

import {
  mediaPagePath,
  freshItems,
  reachableSections,
} from "../../public/pages/gallery/paging.js"

describe("mediaPagePath", () => {
  it("asks for the first page with no cursor", () => {
    assert.strictEqual(
      mediaPagePath("official", 100, null),
      "/api/media?section=official&limit=100",
    )
    assert.strictEqual(mediaPagePath("guest", 100, null), "/api/media?section=guest&limit=100")
  })

  it("sends a guest cursor as before= and a curated one as after=", () => {
    assert.strictEqual(
      mediaPagePath("guest", 100, 42),
      "/api/media?section=guest&limit=100&before=42",
    )
    assert.strictEqual(
      mediaPagePath("official", 100, "7_42"),
      "/api/media?section=official&limit=100&after=7_42",
    )
    assert.strictEqual(
      mediaPagePath("honeymoon", 100, "0_3"),
      "/api/media?section=honeymoon&limit=100&after=0_3",
    )
  })

  it("encodes the cursor, which it never reads", () => {
    assert.strictEqual(
      mediaPagePath("official", 100, "a&b=c"),
      "/api/media?section=official&limit=100&after=a%26b%3Dc",
    )
  })
})

describe("freshItems", () => {
  /** @param {number[]} ids */
  const items = (ids) => ids.map((id) => ({ id }))

  it("passes a page of new items through in order", () => {
    assert.deepStrictEqual(freshItems(items([1, 2]), items([3, 4, 5])), items([3, 4, 5]))
  })

  it("drops an item already loaded (a deep-linked photo, or one a reorder carried forward)", () => {
    assert.deepStrictEqual(freshItems(items([1, 2, 9]), items([3, 9, 4])), items([3, 4]))
  })

  it("drops a repeat within the page itself", () => {
    assert.deepStrictEqual(freshItems([], items([3, 3, 4])), items([3, 4]))
  })

  it("keeps the incoming objects, not the loaded ones", () => {
    const incoming = { id: 5, caption: "new" }
    const [kept] = freshItems([{ id: 1, caption: "old" }], [incoming])
    assert.strictEqual(kept, incoming)
  })
})

describe("reachableSections", () => {
  const ORDER = /** @type {const} */ (["official", "honeymoon", "guest"])

  /** @param {string[]} more */
  const hasMore = (more) => (/** @type {string} */ section) => more.includes(section)

  it("stops at official while official has pages left", () => {
    assert.deepStrictEqual(reachableSections(ORDER, hasMore(["official", "guest"])), ["official"])
  })

  it("reaches honeymoon once official is loaded to the end", () => {
    assert.deepStrictEqual(reachableSections(ORDER, hasMore(["honeymoon", "guest"])), [
      "official",
      "honeymoon",
    ])
  })

  it("covers every section once the curated ones are done, guest paging or not", () => {
    assert.deepStrictEqual(reachableSections(ORDER, hasMore(["guest"])), ORDER)
    assert.deepStrictEqual(reachableSections(ORDER, hasMore([])), ORDER)
  })

  it("always includes the first section, so the list is never empty", () => {
    assert.deepStrictEqual(reachableSections(ORDER, () => true), ["official"])
  })
})
