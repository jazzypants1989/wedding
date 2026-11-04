/** @file Unit tests for the importer's selection file and the curated grid's order
 *  merge. All synthetic: hashes are hashes of made-up strings. */

import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import {
  applyShownOrder,
  isCuratedRowOffSite,
  isCuratedRowOnSite,
} from "../../public/pages/admin/curated-order.js"
import { hashFile } from "../../scripts/lib/import-manifest.js"
import { isSha256Hex, loadSelection, parseSelection } from "../../scripts/lib/import-selection.js"

const HASH = crypto.createHash("sha256").update("a fictional photo").digest("hex")

describe("parseSelection", () => {
  it("reads the agreed format into a set", () => {
    const parsed = parseSelection(JSON.stringify({ version: 1, visible: [HASH] }))
    assert.equal(parsed.valid, true)
    if (parsed.valid) assert.deepEqual([...parsed.value], [HASH])
  })

  it("accepts an empty list: a run where everything finishes hidden", () => {
    const parsed = parseSelection(JSON.stringify({ version: 1, visible: [] }))
    assert.equal(parsed.valid, true)
    if (parsed.valid) assert.equal(parsed.value.size, 0)
  })

  it("refuses anything malformed, naming what is wrong", () => {
    /** @type {[string, string][]} */
    const cases = [
      ["not json", "JSON"],
      ["null", "object"],
      ["[]", "object"],
      ['"a string"', "object"],
      [JSON.stringify({ visible: [HASH] }), "version"],
      [JSON.stringify({ version: 2, visible: [HASH] }), "version"],
      [JSON.stringify({ version: "1", visible: [HASH] }), "version"],
      [JSON.stringify({ version: 1 }), "visible"],
      [JSON.stringify({ version: 1, visible: HASH }), "visible"],
      [JSON.stringify({ version: 1, visible: [HASH, 7] }), "visible[1]"],
      [JSON.stringify({ version: 1, visible: [HASH.toUpperCase()] }), "visible[0]"],
      [JSON.stringify({ version: 1, visible: [HASH.slice(1)] }), "visible[0]"],
      [JSON.stringify({ version: 1, visible: [`${HASH}0`] }), "visible[0]"],
      [JSON.stringify({ version: 1, visible: [`${HASH.slice(1)}g`] }), "visible[0]"],
    ]
    for (const [raw, mentions] of cases) {
      const parsed = parseSelection(raw)
      assert.equal(parsed.valid, false, raw)
      if (!parsed.valid) assert.ok(parsed.error.includes(mentions), `${raw}: ${parsed.error}`)
    }
  })

  it("isSha256Hex takes only 64 lowercase hex characters", () => {
    assert.equal(isSha256Hex(HASH), true)
    assert.equal(isSha256Hex(HASH.toUpperCase()), false)
    assert.equal(isSha256Hex(""), false)
    assert.equal(isSha256Hex(null), false)
  })
})

describe("loadSelection", () => {
  it("treats a missing file as invalid rather than as an empty selection", () => {
    const loaded = loadSelection(path.join(os.tmpdir(), `no-such-selection-${process.pid}.json`))
    assert.equal(loaded.valid, false)
  })

  it("names files by the same hash the manifest records", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "selection-hash-"))
    try {
      const photo = path.join(dir, "fictional.bin")
      fs.writeFileSync(photo, "the bytes of a fictional original")
      // The culling page's half of the contract, stated independently of hashFile.
      const expected = crypto
        .createHash("sha256")
        .update("the bytes of a fictional original")
        .digest("hex")
      assert.equal(await hashFile(photo), expected)
      assert.equal(isSha256Hex(await hashFile(photo)), true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("applyShownOrder", () => {
  const row = (/** @type {number} */ id) => ({ id })
  const ids = (/** @type {{ id: number }[]} */ rows) => rows.map((r) => r.id)

  it("reorders the shown rows within their own slots, leaving the rest where they are", () => {
    const all = [1, 2, 3, 4, 5, 6].map(row)
    // Shown: 2, 4, 6. The couple moves 6 to the front.
    const merged = applyShownOrder(all, [row(6), row(2), row(4)])
    assert.deepEqual(ids(merged), [1, 6, 3, 2, 5, 4])
  })

  it("always names the whole set, which is what reorder demands", () => {
    const all = [10, 11, 12, 13].map(row)
    const merged = applyShownOrder(all, [row(13), row(11)])
    assert.deepEqual(ids(merged).sort(), [10, 11, 12, 13])
  })

  it("changes nothing when nothing moved or nothing is shown", () => {
    const all = [1, 2, 3].map(row)
    assert.deepEqual(ids(applyShownOrder(all, all)), [1, 2, 3])
    assert.deepEqual(ids(applyShownOrder(all, [])), [1, 2, 3])
  })
})

describe("which side of the curated grid a row is on", () => {
  it("shows approved on the site, hidden and pending under Hidden, the others nowhere", () => {
    /** @type {[string, boolean, boolean][]} */
    const table = [
      ["approved", true, false],
      ["hidden", false, true],
      ["pending", false, true],
      ["rejected", false, false],
      ["uploading", false, false],
    ]
    for (const [status, onSite, offSite] of table) {
      assert.equal(isCuratedRowOnSite({ status }), onSite, status)
      assert.equal(isCuratedRowOffSite({ status }), offSite, status)
    }
  })
})
