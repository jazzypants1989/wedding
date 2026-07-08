/**
 * @file Unit tests for the combined moderation queue (Phase 6): the UNION-ALL
 * projection shape across guestbook/media/comments and its type/status/account
 * filters.
 */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import crypto from "node:crypto"
import { init, close, getDb } from "../../../db/connection.js"
import { getModerationQueue } from "../../../db/moderation.js"

/** @param {{ name?: string, trusted?: 0 | 1 }} [opts] */
function makeAccount({ name = "Q Tester", trusted = 0 } = {}) {
  const r = getDb()
    .prepare(
      `INSERT INTO accounts (guest_id, name, name_normalized, trusted) VALUES (?, ?, ?, ?)`,
    )
    .run(null, name, name.toLowerCase(), trusted)
  return Number(r.lastInsertRowid)
}

/** @param {number} accountId @param {string} [status] */
function makeEntry(accountId, status = "pending") {
  const r = getDb()
    .prepare(`INSERT INTO guestbook_entries (account_id, message, status) VALUES (?, ?, ?)`)
    .run(accountId, "hello world", status)
  return Number(r.lastInsertRowid)
}

/** @param {number} accountId @param {string} [status] */
function makeMedia(accountId, status = "pending") {
  const key = crypto.randomBytes(16).toString("hex")
  const r = getDb()
    .prepare(
      `INSERT INTO media (file_key, account_id, kind, section, status) VALUES (?, ?, 'image', 'guest', ?)`,
    )
    .run(key, accountId, status)
  return { id: Number(r.lastInsertRowid), key }
}

/** @param {number} accountId @param {number} targetId @param {string} [status] */
function makeComment(accountId, targetId, status = "pending") {
  const r = getDb()
    .prepare(
      `INSERT INTO comments (account_id, target_type, target_id, message, status)
       VALUES (?, 'guestbook', ?, ?, ?)`,
    )
    .run(accountId, targetId, "nice one", status)
  return Number(r.lastInsertRowid)
}

function clearData() {
  const db = getDb()
  db.prepare("DELETE FROM comments").run()
  db.prepare("DELETE FROM media").run()
  db.prepare("DELETE FROM guestbook_entries").run()
  db.prepare("DELETE FROM accounts").run()
}

describe("db/moderation getModerationQueue", () => {
  before(() => init())
  beforeEach(() => clearData())
  after(() => {
    clearData()
    close()
  })

  it("interleaves all three content types with a common projection", () => {
    const acct = makeAccount()
    const entryId = makeEntry(acct)
    const media = makeMedia(acct)
    makeComment(acct, entryId)

    const rows = getModerationQueue({ limit: 50, offset: 0 })
    assert.strictEqual(rows.length, 3)

    const types = rows.map((r) => r.content_type).sort()
    assert.deepStrictEqual(types, ["comment", "guestbook", "media"])

    const gb = rows.find((r) => r.content_type === "guestbook")
    assert.ok(gb)
    assert.strictEqual(gb.message, "hello world")
    assert.strictEqual(gb.file_key, null, "text rows null-fill media columns")
    assert.strictEqual(gb.author_name, "Q Tester")

    const md = rows.find((r) => r.content_type === "media")
    assert.ok(md)
    assert.strictEqual(md.file_key, media.key)
    assert.strictEqual(md.kind, "image")
    assert.strictEqual(md.message, null, "media rows null-fill the message column")

    const cm = rows.find((r) => r.content_type === "comment")
    assert.ok(cm)
    assert.strictEqual(cm.target_type, "guestbook")
    assert.strictEqual(cm.target_id, entryId)
  })

  it("narrows to a single table when type is set", () => {
    const acct = makeAccount()
    makeEntry(acct)
    makeMedia(acct)

    const onlyMedia = getModerationQueue({ type: "media", limit: 50, offset: 0 })
    assert.strictEqual(onlyMedia.length, 1)
    assert.strictEqual(onlyMedia[0].content_type, "media")
  })

  it("defaults to pending and honors an explicit status filter", () => {
    const acct = makeAccount()
    makeEntry(acct, "pending")
    makeEntry(acct, "approved")

    const pending = getModerationQueue({ limit: 50, offset: 0 })
    assert.strictEqual(pending.length, 1)
    assert.strictEqual(pending[0].status, "pending")

    const approved = getModerationQueue({ status: "approved", limit: 50, offset: 0 })
    assert.strictEqual(approved.length, 1)
    assert.strictEqual(approved[0].status, "approved")
  })

  it("filters to one author when accountId is set", () => {
    const a = makeAccount({ name: "Author A" })
    const b = makeAccount({ name: "Author B" })
    makeEntry(a)
    makeEntry(b)
    makeMedia(b)

    const rows = getModerationQueue({ accountId: b, limit: 50, offset: 0 })
    assert.strictEqual(rows.length, 2)
    assert.ok(rows.every((r) => r.account_id === b))
  })

  it("excludes soft-deleted rows", () => {
    const acct = makeAccount()
    const entryId = makeEntry(acct)
    getDb()
      .prepare(`UPDATE guestbook_entries SET deleted_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), entryId)

    assert.strictEqual(getModerationQueue({ limit: 50, offset: 0 }).length, 0)
  })
})
