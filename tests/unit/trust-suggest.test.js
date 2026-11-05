/** @file Unit test: when Review offers to trust an author.
 *  Imports a browser module, so it is excluded from the server tsconfig. */

import { test } from "node:test"
import assert from "node:assert"

import { shouldSuggestTrust } from "../../public/pages/admin/trust-suggest.js"

/** @param {Partial<{ pending: number, approved: number, hidden: number, rejected: number }>} counts
 *  @param {boolean} [trusted] */
function author(counts, trusted = false) {
  return { trusted, counts: { pending: 0, approved: 0, hidden: 0, rejected: 0, ...counts } }
}

test("offered once nothing is waiting and everything was approved", () => {
  assert.strictEqual(shouldSuggestTrust(author({ approved: 1 })), true)
  assert.strictEqual(shouldSuggestTrust(author({ approved: 9 })), true)
})

test("not while anything from them still waits, however much was approved", () => {
  assert.strictEqual(shouldSuggestTrust(author({ approved: 7, pending: 1 })), false)
  assert.strictEqual(shouldSuggestTrust(author({ approved: 1, pending: 6 })), false)
})

test("not if any of their posts was hidden or rejected", () => {
  assert.strictEqual(shouldSuggestTrust(author({ approved: 4, hidden: 1 })), false)
  assert.strictEqual(shouldSuggestTrust(author({ approved: 4, rejected: 1 })), false)
})

test("not for someone already trusted", () => {
  assert.strictEqual(shouldSuggestTrust(author({ approved: 4 }, true)), false)
})

test("not for someone with nothing approved yet", () => {
  assert.strictEqual(shouldSuggestTrust(author({})), false)
})
