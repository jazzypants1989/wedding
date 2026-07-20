/**
 * @file Unit tests keeping the SQLite reply-emoji CHECK triggers in sync with the
 * REACTION_EMOJI enum. Two complementary angles:
 *   1. Source parse (bidirectional set-equality): read the enumerated `NOT IN
 *      (...)` list straight out of db/schema.js — no regex, string methods only —
 *      and assert it equals REACTION_EMOJI_VALUES. Catches drift in either
 *      direction (a trigger value the enum dropped, or an enum value the trigger
 *      forgot).
 *   2. Runtime probe: spin up an in-memory DB, run the migrations, and prove the
 *      triggers actually accept every enum value and reject a non-member.
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { createTables, runMigrations } from "../../../db/schema.js"
import { REACTION_EMOJI_VALUES } from "../../../types.js"

const SCHEMA_PATH = path.join(import.meta.dirname, "..", "..", "..", "db", "schema.js")

/**
 * Extract every `<field> NOT IN ( … )` value list that follows an emoji field in
 * the schema source. Pure string scanning (no regex): find each occurrence of
 * the marker, slice to the closing paren, split on commas and strip quotes.
 * @param {string} source
 * @returns {string[][]} one array of literal values per matched list
 */
function extractEmojiInLists(source) {
  const marker = "emoji NOT IN ("
  /** @type {string[][]} */
  const lists = []
  let from = 0
  while (true) {
    const at = source.indexOf(marker, from)
    if (at === -1) break
    const open = at + marker.length
    const close = source.indexOf(")", open)
    if (close === -1) break
    const inner = source.slice(open, close)
    const values = inner
      .split(",")
      .map((part) => {
        const trimmed = part.trim()
        // Strip the surrounding single quotes without a regex.
        if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
          return trimmed.slice(1, -1)
        }
        return trimmed
      })
      .filter((v) => v.length > 0)
    lists.push(values)
    from = close + 1
  }
  return lists
}

describe("reply-emoji CHECK triggers stay in sync with REACTION_EMOJI", () => {
  it("every enumerated NOT IN (...) list in the schema equals REACTION_EMOJI_VALUES", () => {
    const source = fs.readFileSync(SCHEMA_PATH, "utf8")
    const lists = extractEmojiInLists(source)

    // Card insert + update triggers and the replies-table insert trigger → 3.
    assert.ok(lists.length >= 3, `found ${lists.length} emoji NOT IN lists (expected ≥ 3)`)

    const expected = [...REACTION_EMOJI_VALUES].sort()
    for (const list of lists) {
      assert.deepEqual(
        [...list].sort(),
        expected,
        "a schema emoji allowlist drifted from REACTION_EMOJI",
      )
    }
  })

  describe("runtime enforcement", () => {
    /** @type {DatabaseSync} */
    let db
    /** @type {number} */
    let cardId

    before(() => {
      db = new DatabaseSync(":memory:")
      db.exec("PRAGMA foreign_keys = ON")
      createTables(db)
      runMigrations(db)

      const guestId = Number(
        db
          .prepare(
            `INSERT INTO guests (name, email, phone, party_size, invite_code, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run("Trigger Test", null, null, 2, "TRGTEST1", "pending", null).lastInsertRowid,
      )
      cardId = Number(
        db
          .prepare(
            `INSERT INTO thank_you_cards (token, guest_id, message, theme, status)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run("TRGTOKEN", guestId, "hi", "classic", "sent").lastInsertRowid,
      )
    })

    after(() => {
      db.close()
    })

    it("accepts every REACTION_EMOJI value on thank_you_cards.reply_emoji", () => {
      for (const emoji of REACTION_EMOJI_VALUES) {
        assert.doesNotThrow(() => {
          db.prepare(`UPDATE thank_you_cards SET reply_emoji = ? WHERE id = ?`).run(emoji, cardId)
        }, `emoji "${emoji}" should be accepted`)
      }
    })

    it("rejects a non-member emoji on thank_you_cards.reply_emoji", () => {
      assert.throws(() => {
        db.prepare(`UPDATE thank_you_cards SET reply_emoji = ? WHERE id = ?`).run("banana", cardId)
      })
    })

    it("accepts every REACTION_EMOJI value on thank_you_card_replies.emoji and rejects others", () => {
      for (const emoji of REACTION_EMOJI_VALUES) {
        assert.doesNotThrow(() => {
          db.prepare(
            `INSERT INTO thank_you_card_replies (card_id, emoji, message, created_at)
             VALUES (?, ?, ?, ?)`,
          ).run(cardId, emoji, null, "2026-01-01 00:00:00")
        }, `reply emoji "${emoji}" should be accepted`)
      }
      assert.throws(() => {
        db.prepare(
          `INSERT INTO thank_you_card_replies (card_id, emoji, message, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(cardId, "banana", null, "2026-01-01 00:00:00")
      })
    })
  })
})
