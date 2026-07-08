import { describe, it } from "node:test"
import assert from "node:assert"
import { parseRange } from "../../../core/media-serve.js"

const SIZE = 1000

describe("parseRange", () => {
  it("returns null when there is no Range header (serve full 200)", () => {
    assert.strictEqual(parseRange(null, SIZE), null)
    assert.strictEqual(parseRange(undefined, SIZE), null)
    assert.strictEqual(parseRange("", SIZE), null)
  })

  it("returns null for a non-bytes unit (ignored)", () => {
    assert.strictEqual(parseRange("items=0-10", SIZE), null)
  })

  it("parses a normal closed range 0-499", () => {
    assert.deepStrictEqual(parseRange("bytes=0-499", SIZE), { start: 0, end: 499 })
  })

  it("parses an open-ended range 500-", () => {
    assert.deepStrictEqual(parseRange("bytes=500-", SIZE), { start: 500, end: 999 })
  })

  it("parses a suffix range -500 (last N bytes)", () => {
    assert.deepStrictEqual(parseRange("bytes=-500", SIZE), { start: 500, end: 999 })
  })

  it("clamps end to size-1", () => {
    assert.deepStrictEqual(parseRange("bytes=0-99999", SIZE), { start: 0, end: 999 })
  })

  it("clamps a suffix larger than the file to the whole file", () => {
    assert.deepStrictEqual(parseRange("bytes=-99999", SIZE), { start: 0, end: 999 })
  })

  it("returns null for a multi-range request (serve full 200)", () => {
    assert.strictEqual(parseRange("bytes=0-10,20-30", SIZE), null)
  })

  it("returns 'invalid' when start > end", () => {
    assert.strictEqual(parseRange("bytes=500-100", SIZE), "invalid")
  })

  it("returns 'invalid' when start >= size", () => {
    assert.strictEqual(parseRange("bytes=1000-1005", SIZE), "invalid")
  })

  it("returns 'invalid' for a zero-length suffix (bytes=-0)", () => {
    assert.strictEqual(parseRange("bytes=-0", SIZE), "invalid")
  })

  it("returns 'invalid' for garbage / non-digit bytes", () => {
    assert.strictEqual(parseRange("bytes=abc-def", SIZE), "invalid")
    assert.strictEqual(parseRange("bytes=", SIZE), "invalid")
  })

  it("returns 'invalid' on a 16-digit overflow value", () => {
    assert.strictEqual(parseRange("bytes=0-1234567890123456", SIZE), "invalid")
  })
})
