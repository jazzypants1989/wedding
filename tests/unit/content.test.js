/**
 * @file Unit tests for content.js — timeline mode + date formatting
 */

import { describe, it, afterEach } from "node:test"
import assert from "node:assert"
import { getTimelineMode, formatWeddingDate, formatWeddingDateShort, CONTENT } from "../../content.js"

const WEDDING_MS = Date.parse(CONTENT.weddingDate)

describe("getTimelineMode", () => {
  const original = process.env.SITE_MODE
  afterEach(() => {
    if (original === undefined) delete process.env.SITE_MODE
    else process.env.SITE_MODE = original
  })

  it("returns 'pre' before the wedding date", () => {
    delete process.env.SITE_MODE
    assert.strictEqual(getTimelineMode(WEDDING_MS - 1000), "pre")
  })

  it("returns 'post' at/after the wedding date", () => {
    delete process.env.SITE_MODE
    assert.strictEqual(getTimelineMode(WEDDING_MS), "post")
    assert.strictEqual(getTimelineMode(WEDDING_MS + 1000), "post")
  })

  it("honors SITE_MODE=pre override regardless of date", () => {
    process.env.SITE_MODE = "pre"
    assert.strictEqual(getTimelineMode(WEDDING_MS + 1_000_000), "pre")
  })

  it("honors SITE_MODE=post override regardless of date", () => {
    process.env.SITE_MODE = "post"
    assert.strictEqual(getTimelineMode(WEDDING_MS - 1_000_000), "post")
  })

  it("ignores an invalid SITE_MODE and falls back to the date", () => {
    process.env.SITE_MODE = "sideways"
    assert.strictEqual(getTimelineMode(WEDDING_MS - 1000), "pre")
    assert.strictEqual(getTimelineMode(WEDDING_MS + 1000), "post")
  })
})

describe("formatWeddingDate", () => {
  it("derives the human date from the ISO wedding date", () => {
    assert.strictEqual(formatWeddingDate(), "April 26, 2026")
  })

  it("formats an arbitrary ISO date in Pacific time", () => {
    assert.strictEqual(formatWeddingDate("2026-12-31T20:00:00-08:00"), "December 31, 2026")
  })

  it("derives the short date", () => {
    assert.strictEqual(formatWeddingDateShort(), "04/26/2026")
  })
})
