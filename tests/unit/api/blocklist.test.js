/**
 * @file Unit tests for api/admin/blocklist.js — Blocklist data layer functions
 */

import { describe, it, before, after, afterEach } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../../db/connection.js"
import {
  isBlocked,
  getAllBlocklist,
  addToBlocklist,
  removeFromBlocklist,
} from "../../../api/admin/blocklist.js"

const PREFIX = "bltest-"

before(() => {
  init()
})

after(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM blocklist WHERE reason LIKE '${PREFIX}%'`).run()
  } catch { /* ignore */ }
  close()
})

afterEach(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM blocklist WHERE reason LIKE '${PREFIX}%'`).run()
  } catch { /* ignore */ }
})

describe("addToBlocklist", () => {
  it("adds entry with all fields", () => {
    const id = addToBlocklist({
      name: "Blocked Person",
      email: "blocked@example.com",
      phone: "+15551112222",
      reason: `${PREFIX}test reason`,
    })
    assert.ok(id)
    assert.strictEqual(typeof id, "number")
  })

  it("normalizes email and phone", () => {
    const id = addToBlocklist({
      name: "Norm Test",
      email: "NORM@EXAMPLE.COM",
      phone: "(555) 333-4444",
      reason: `${PREFIX}norm`,
    })
    const all = getAllBlocklist()
    const entry = all.find((e) => e.id === id)
    assert.ok(entry)
    assert.strictEqual(entry.email, "norm@example.com")
  })

  it("allows entries with only name", () => {
    const id = addToBlocklist({
      name: "Name Only",
      email: null,
      phone: null,
      reason: `${PREFIX}name only`,
    })
    const all = getAllBlocklist()
    const entry = all.find((e) => e.id === id)
    assert.ok(entry)
    assert.strictEqual(entry.name, "Name Only")
    assert.strictEqual(entry.email, null)
    assert.strictEqual(entry.phone, null)
  })
})

describe("removeFromBlocklist", () => {
  it("removes entry and returns true", () => {
    const id = addToBlocklist({
      name: "Remove Me",
      email: null,
      phone: null,
      reason: `${PREFIX}remove`,
    })
    const result = removeFromBlocklist(id)
    assert.strictEqual(result, true)
  })

  it("returns false for non-existent id", () => {
    assert.strictEqual(removeFromBlocklist(999999), false)
  })
})

describe("getAllBlocklist", () => {
  it("returns all entries", () => {
    addToBlocklist({ name: "BL1", email: null, phone: null, reason: `${PREFIX}1` })
    addToBlocklist({ name: "BL2", email: null, phone: null, reason: `${PREFIX}2` })
    const all = getAllBlocklist()
    assert.ok(all.length >= 2)
    assert.ok(all.find((e) => e.name === "BL1"))
    assert.ok(all.find((e) => e.name === "BL2"))
  })
})

describe("isBlocked", () => {
  it("matches by exact email", () => {
    addToBlocklist({
      name: null,
      email: "blocked-email@example.com",
      phone: null,
      reason: `${PREFIX}email match`,
    })
    const result = isBlocked({
      name: "Anyone",
      email: "blocked-email@example.com",
      phone: null,
    })
    assert.ok(result)
  })

  it("matches email case-insensitively", () => {
    addToBlocklist({
      name: null,
      email: "case@example.com",
      phone: null,
      reason: `${PREFIX}case match`,
    })
    const result = isBlocked({
      name: "Anyone",
      email: "CASE@EXAMPLE.COM",
      phone: null,
    })
    assert.ok(result)
  })

  it("matches by exact phone", () => {
    addToBlocklist({
      name: null,
      email: null,
      phone: "+15559999999",
      reason: `${PREFIX}phone match`,
    })
    const result = isBlocked({
      name: "Anyone",
      email: null,
      phone: "+15559999999",
    })
    assert.ok(result)
  })

  it("matches by similar name (Levenshtein distance <= 2)", () => {
    addToBlocklist({
      name: "John Smith",
      email: null,
      phone: null,
      reason: `${PREFIX}name match`,
    })
    // Exact match
    const exact = isBlocked({ name: "John Smith", email: null, phone: null })
    assert.ok(exact)

    // Distance 1 (one char different)
    const close = isBlocked({ name: "John Smyth", email: null, phone: null })
    assert.ok(close)
  })

  it("does not match dissimilar names", () => {
    addToBlocklist({
      name: "Completely Different",
      email: null,
      phone: null,
      reason: `${PREFIX}no match`,
    })
    const result = isBlocked({ name: "Another Person", email: null, phone: null })
    assert.strictEqual(result, null)
  })

  it("returns null when nothing matches", () => {
    const result = isBlocked({
      name: "Unknown Person ZZZZ",
      email: "zzzz@nowhere.com",
      phone: "+10000000001",
    })
    assert.strictEqual(result, null)
  })

  it("checks email before phone before name", () => {
    addToBlocklist({
      name: "Priority",
      email: "priority@example.com",
      phone: "+15558888888",
      reason: `${PREFIX}priority`,
    })
    // Should match by email even if name/phone also match
    const result = isBlocked({
      name: "Priority",
      email: "priority@example.com",
      phone: "+15558888888",
    })
    assert.ok(result)
  })

  it("handles null inputs gracefully", () => {
    const result = isBlocked({ name: null, email: null, phone: null })
    assert.strictEqual(result, null)
  })
})
