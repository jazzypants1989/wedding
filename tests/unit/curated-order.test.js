/** @file Unit test: the curated grid's pure ordering rules
 *  (public/pages/admin/curated-order.js). Imports a browser module, so it is
 *  excluded from the server tsconfig. */

import { describe, it } from "node:test"
import assert from "node:assert"

import { applyShownOrder, curatedDropIndex } from "../../public/pages/admin/curated-order.js"

/**
 * What the grid does with a drop: take the photo out, put it in at the index.
 * @param {string[]} list @param {number} from @param {number} over @param {boolean} after
 */
function drop(list, from, over, after) {
  const next = list.slice()
  const [moved] = next.splice(from, 1)
  next.splice(curatedDropIndex(from, over, after), 0, moved)
  return next.join("")
}

describe("curatedDropIndex", () => {
  it("lands on the side of the card it was dropped on, dragging forward", () => {
    assert.strictEqual(drop(["a", "b", "c", "d"], 0, 2, false), "bacd")
    assert.strictEqual(drop(["a", "b", "c", "d"], 0, 2, true), "bcad")
    assert.strictEqual(drop(["a", "b", "c", "d"], 0, 3, true), "bcda")
  })

  it("lands on the side of the card it was dropped on, dragging back", () => {
    assert.strictEqual(drop(["a", "b", "c", "d"], 3, 1, false), "adbc")
    assert.strictEqual(drop(["a", "b", "c", "d"], 3, 1, true), "abdc")
    assert.strictEqual(drop(["a", "b", "c", "d"], 3, 0, false), "dabc")
  })

  it("is where it started when dropped against a neighbour's near side", () => {
    assert.strictEqual(curatedDropIndex(1, 0, true), 1)
    assert.strictEqual(curatedDropIndex(1, 2, false), 1)
  })
})

describe("applyShownOrder", () => {
  it("reorders the shown rows inside their own slots and leaves the rest", () => {
    const all = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    const shown = [all[3], all[0]]
    assert.deepStrictEqual(
      applyShownOrder(all, shown).map((row) => row.id),
      [4, 2, 3, 1],
    )
  })
})
