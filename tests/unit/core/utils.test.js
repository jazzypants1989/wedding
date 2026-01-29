/**
 * @file Unit tests for core utility functions
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { escapeHtml } from "../../../core/utils.js"

describe("escapeHtml", () => {
  it("escapes ampersand", () => {
    assert.strictEqual(escapeHtml("a & b"), "a &amp; b")
  })

  it("escapes less-than", () => {
    assert.strictEqual(escapeHtml("<div>"), "&lt;div&gt;")
  })

  it("escapes greater-than", () => {
    assert.strictEqual(escapeHtml("a > b"), "a &gt; b")
  })

  it("escapes double quotes", () => {
    assert.strictEqual(escapeHtml('say "hello"'), "say &quot;hello&quot;")
  })

  it("escapes single quotes", () => {
    assert.strictEqual(escapeHtml("it's"), "it&#39;s")
  })

  it("escapes all special characters together", () => {
    const input = `<script>alert("xss" & 'evil')</script>`
    const expected = "&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;evil&#39;)&lt;/script&gt;"
    assert.strictEqual(escapeHtml(input), expected)
  })

  it("returns empty string for null", () => {
    assert.strictEqual(escapeHtml(/** @type {string} */ (/** @type {unknown} */ (null))), "")
  })

  it("returns empty string for undefined", () => {
    assert.strictEqual(escapeHtml(/** @type {string} */ (/** @type {unknown} */ (undefined))), "")
  })

  it("returns empty string for empty string", () => {
    assert.strictEqual(escapeHtml(""), "")
  })

  it("returns plain text unchanged", () => {
    assert.strictEqual(escapeHtml("hello world"), "hello world")
  })

  it("converts non-string values to string", () => {
    assert.strictEqual(escapeHtml(/** @type {string} */ (/** @type {unknown} */ (42))), "42")
    assert.strictEqual(escapeHtml(/** @type {string} */ (/** @type {unknown} */ (true))), "true")
  })

  it("handles strings with multiple ampersands", () => {
    assert.strictEqual(escapeHtml("a & b & c"), "a &amp; b &amp; c")
  })
})
