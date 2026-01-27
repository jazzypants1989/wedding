/**
 * Unit tests for CSV parsing and formatting
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import {
  parseCSV,
  escapeCSVField,
  guestsToCSV,
  rsvpsToCSV,
} from "../../../core/csv.js"

describe("parseCSV", () => {
  it("parses simple CSV", () => {
    const csv = "name,email\nJohn,john@example.com"
    const result = parseCSV(csv)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].name, "John")
    assert.strictEqual(result[0].email, "john@example.com")
  })

  it("parses multiple rows", () => {
    const csv = "name,email\nJohn,john@test.com\nJane,jane@test.com"
    const result = parseCSV(csv)
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].name, "John")
    assert.strictEqual(result[1].name, "Jane")
  })

  it("handles quoted fields", () => {
    const csv = 'name,notes\n"John Doe","Hello, World"'
    const result = parseCSV(csv)
    assert.strictEqual(result[0].name, "John Doe")
    assert.strictEqual(result[0].notes, "Hello, World")
  })

  it("handles escaped quotes within quoted fields", () => {
    const csv = 'name,notes\n"John ""Johnny"" Doe","He said ""hello"""'
    const result = parseCSV(csv)
    assert.strictEqual(result[0].name, 'John "Johnny" Doe')
    assert.strictEqual(result[0].notes, 'He said "hello"')
  })

  it("handles newlines within quoted fields", () => {
    const csv = 'name,notes\n"John","Line 1\nLine 2"'
    const result = parseCSV(csv)
    assert.strictEqual(result[0].notes, "Line 1\nLine 2")
  })

  it("handles empty fields", () => {
    const csv = "name,email,phone\nJohn,,555-1234"
    const result = parseCSV(csv)
    assert.strictEqual(result[0].name, "John")
    assert.strictEqual(result[0].email, "")
    assert.strictEqual(result[0].phone, "555-1234")
  })

  it("handles CRLF line endings", () => {
    const csv = "name,email\r\nJohn,john@test.com\r\nJane,jane@test.com"
    const result = parseCSV(csv)
    assert.strictEqual(result.length, 2)
  })

  it("lowercases header names", () => {
    const csv = "Name,EMAIL\nJohn,john@test.com"
    const result = parseCSV(csv)
    assert.ok("name" in result[0])
    assert.ok("email" in result[0])
  })

  it("trims whitespace from header names", () => {
    const csv = " name , email \nJohn,john@test.com"
    const result = parseCSV(csv)
    assert.ok("name" in result[0])
    assert.ok("email" in result[0])
  })

  it("throws error for empty input", () => {
    assert.throws(() => parseCSV(""), { message: "CSV must have a header row and at least one data row" })
  })

  it("throws error for header-only CSV", () => {
    assert.throws(() => parseCSV("name,email"), { message: "CSV must have a header row and at least one data row" })
  })

  it("includes line numbers in result", () => {
    const csv = "name\nJohn\nJane"
    const result = parseCSV(csv)
    assert.strictEqual(result[0]._lineNumber, 2)
    assert.strictEqual(result[1]._lineNumber, 3)
  })

  it("handles more columns in data than headers", () => {
    const csv = "name,email\nJohn,john@test.com,extra"
    const result = parseCSV(csv)
    assert.strictEqual(result[0].name, "John")
    assert.strictEqual(result[0].email, "john@test.com")
  })

  it("handles fewer columns in data than headers", () => {
    const csv = "name,email,phone\nJohn,john@test.com"
    const result = parseCSV(csv)
    assert.strictEqual(result[0].name, "John")
    assert.strictEqual(result[0].email, "john@test.com")
    assert.strictEqual(result[0].phone, "")
  })

  it("handles commas inside quoted fields", () => {
    const csv = 'name,address\nJohn,"123 Main St, Apt 4"'
    const result = parseCSV(csv)
    assert.strictEqual(result[0].address, "123 Main St, Apt 4")
  })
})

describe("escapeCSVField", () => {
  it("returns simple string unchanged", () => {
    assert.strictEqual(escapeCSVField("hello"), "hello")
  })

  it("quotes strings with commas", () => {
    assert.strictEqual(escapeCSVField("hello, world"), '"hello, world"')
  })

  it("quotes strings with newlines", () => {
    assert.strictEqual(escapeCSVField("line1\nline2"), '"line1\nline2"')
  })

  it("escapes and quotes strings with quotes", () => {
    assert.strictEqual(escapeCSVField('say "hello"'), '"say ""hello"""')
  })

  it("handles empty string", () => {
    assert.strictEqual(escapeCSVField(""), "")
  })

  it("handles null", () => {
    assert.strictEqual(escapeCSVField(null), "")
  })

  it("handles undefined", () => {
    assert.strictEqual(escapeCSVField(undefined), "")
  })

  it("handles numbers", () => {
    assert.strictEqual(escapeCSVField(123), "123")
  })

  it("handles numbers with special characters in string form", () => {
    assert.strictEqual(escapeCSVField("1,234"), '"1,234"')
  })

  it("handles strings with both quotes and commas", () => {
    assert.strictEqual(
      escapeCSVField('He said, "hello"'),
      '"He said, ""hello"""'
    )
  })

  it("handles carriage returns", () => {
    const result = escapeCSVField("line1\r\nline2")
    assert.ok(result.startsWith('"'))
  })
})

describe("guestsToCSV", () => {
  it("generates valid CSV from guest array", () => {
    const guests = [
      {
        name: "John",
        email: "john@test.com",
        phone: "+15551234567",
        party_size: 2,
      },
    ]
    const csv = guestsToCSV(guests)
    assert.ok(csv.includes("name,"))
    assert.ok(csv.includes("John"))
    assert.ok(csv.includes("john@test.com"))
  })

  it("includes all expected headers", () => {
    const csv = guestsToCSV([])
    const firstLine = csv.split("\n")[0]
    assert.ok(firstLine.includes("name"))
    assert.ok(firstLine.includes("email"))
    assert.ok(firstLine.includes("phone"))
    assert.ok(firstLine.includes("party_size"))
    assert.ok(firstLine.includes("status"))
    assert.ok(firstLine.includes("invite_code"))
    assert.ok(firstLine.includes("notes"))
    assert.ok(firstLine.includes("created_at"))
    assert.ok(firstLine.includes("last_invited_at"))
  })

  it("handles empty array", () => {
    const csv = guestsToCSV([])
    assert.ok(csv.startsWith("name,")) // Should have header
    assert.strictEqual(csv.split("\n").length, 1) // Only header row
  })

  it("escapes special characters", () => {
    const guests = [
      { name: "John, Jr.", email: "john@test.com", phone: "", party_size: 1 },
    ]
    const csv = guestsToCSV(guests)
    assert.ok(csv.includes('"John, Jr."'))
  })

  it("handles multiple guests", () => {
    const guests = [
      { name: "John", email: "john@test.com", party_size: 2 },
      { name: "Jane", email: "jane@test.com", party_size: 1 },
    ]
    const csv = guestsToCSV(guests)
    const lines = csv.split("\n")
    assert.strictEqual(lines.length, 3) // Header + 2 data rows
  })

  it("handles undefined guest properties", () => {
    const guests = [
      { name: "John" }, // Missing most properties
    ]
    const csv = guestsToCSV(guests)
    assert.ok(csv.includes("John"))
  })
})

describe("rsvpsToCSV", () => {
  it("generates valid CSV from RSVP array", () => {
    const rsvps = [
      {
        name: "John",
        email: "john@test.com",
        phone: "+15551234567",
        attending: 1,
        actual_party_size: 2,
        dietary_restrictions: "Vegetarian",
        message: "Thanks!",
        submitted_at: "2024-01-01",
      },
    ]
    const csv = rsvpsToCSV(rsvps)
    assert.ok(csv.includes("John"))
    assert.ok(csv.includes("john@test.com"))
    assert.ok(csv.includes("Yes")) // attending = true
    assert.ok(csv.includes("Vegetarian"))
  })

  it("includes all expected headers", () => {
    const csv = rsvpsToCSV([])
    const firstLine = csv.split("\n")[0]
    assert.ok(firstLine.includes("name"))
    assert.ok(firstLine.includes("email"))
    assert.ok(firstLine.includes("phone"))
    assert.ok(firstLine.includes("attending"))
    assert.ok(firstLine.includes("party_size"))
    assert.ok(firstLine.includes("dietary_restrictions"))
    assert.ok(firstLine.includes("message"))
    assert.ok(firstLine.includes("submitted_at"))
  })

  it("handles empty array", () => {
    const csv = rsvpsToCSV([])
    assert.ok(csv.startsWith("name,"))
    assert.strictEqual(csv.split("\n").length, 1)
  })

  it("converts attending to Yes/No", () => {
    const rsvps = [
      { name: "John", attending: 1 },
      { name: "Jane", attending: 0 },
    ]
    const csv = rsvpsToCSV(rsvps)
    const lines = csv.split("\n")
    assert.ok(lines[1].includes("Yes"))
    assert.ok(lines[2].includes("No"))
  })

  it("handles messages with special characters", () => {
    const rsvps = [
      { name: "John", attending: 1, message: "Thanks, looking forward to it!" },
    ]
    const csv = rsvpsToCSV(rsvps)
    assert.ok(csv.includes('"Thanks, looking forward to it!"'))
  })
})
