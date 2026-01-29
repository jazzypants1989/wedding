/**
 * @file Unit tests for message template utilities
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import {
  PLACEHOLDERS,
  formatTemplate,
  getTemplateExample,
} from "../../../services/templates.js"

describe("PLACEHOLDERS", () => {
  it("defines expected placeholder tokens", () => {
    assert.strictEqual(PLACEHOLDERS.NAME, "{name}")
    assert.strictEqual(PLACEHOLDERS.URL, "{url}")
    assert.strictEqual(PLACEHOLDERS.DATE, "{date}")
    assert.strictEqual(PLACEHOLDERS.LOCATION, "{location}")
  })

  it("is frozen", () => {
    assert.ok(Object.isFrozen(PLACEHOLDERS))
  })
})

describe("formatTemplate", () => {
  it("replaces all placeholders", () => {
    const template = "Hi {name}! RSVP at {url} on {date} at {location}."
    const result = formatTemplate(template, {
      name: "John",
      url: "https://example.com",
      date: "June 15",
      location: "The Grand Hall",
    })

    assert.strictEqual(
      result,
      "Hi John! RSVP at https://example.com on June 15 at The Grand Hall.",
    )
  })

  it("replaces multiple occurrences of the same placeholder", () => {
    const template = "{name} and {name} again"
    const result = formatTemplate(template, {
      name: "Alice",
      url: "https://example.com",
    })

    assert.strictEqual(result, "Alice and Alice again")
  })

  it("replaces missing values with empty strings", () => {
    const template = "Hi {name}! Date: {date}"
    const result = formatTemplate(template, {
      name: "John",
      url: "https://example.com",
    })

    assert.strictEqual(result, "Hi John! Date: ")
  })

  it("returns falsy template as-is", () => {
    assert.strictEqual(
      formatTemplate("", { name: "John", url: "https://example.com" }),
      "",
    )
    assert.strictEqual(
      formatTemplate(/** @type {string} */ (/** @type {unknown} */ (null)), { name: "John", url: "https://example.com" }),
      null,
    )
    assert.strictEqual(
      formatTemplate(/** @type {string} */ (/** @type {unknown} */ (undefined)), { name: "John", url: "https://example.com" }),
      undefined,
    )
  })

  it("handles template with no placeholders", () => {
    const template = "No placeholders here"
    const result = formatTemplate(template, {
      name: "John",
      url: "https://example.com",
    })

    assert.strictEqual(result, "No placeholders here")
  })

  it("handles special characters in replacement values", () => {
    const template = "Hi {name}!"
    const result = formatTemplate(template, {
      name: 'O\'Brien & "Friends"',
      url: "https://example.com",
    })

    assert.strictEqual(result, "Hi O'Brien & \"Friends\"!")
  })

  it("handles partial placeholder objects", () => {
    const template = "{name} at {url} on {date}"
    const result = formatTemplate(template, {
      name: "Jane",
      url: "https://site.com",
    })

    assert.strictEqual(result, "Jane at https://site.com on ")
  })
})

describe("getTemplateExample", () => {
  it("returns a non-empty string", () => {
    const result = getTemplateExample()
    assert.ok(typeof result === "string")
    assert.ok(result.length > 0)
  })

  it("contains name and URL placeholders", () => {
    const result = getTemplateExample()
    assert.ok(result.includes("{name}"))
    assert.ok(result.includes("{url}"))
  })
})
