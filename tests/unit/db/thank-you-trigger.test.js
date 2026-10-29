/**
 * @file Unit tests for the thank-you reply-emoji triggers and the
 * `reply_emoji_glyphs` migration (issue #8).
 *
 * Replies used to be one of six REACTION_EMOJI keys, enforced by `NOT IN (…)`
 * triggers. They now take any single emoji, stored as its glyph: the app
 * validates (public/components/emoji.js), and the triggers are a size backstop.
 * Two angles:
 *   1. Fresh database: the final triggers accept glyphs (including long ZWJ
 *      sequences) and reject empty or oversized values.
 *   2. Pinned database: a database still at the key-only state, holding key
 *      rows, comes through the migration with every key rewritten to its glyph
 *      and the new triggers in place.
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import { DatabaseSync } from "node:sqlite"

import { createTables, runMigrations } from "../../../db/schema.js"
import { REACTION_EMOJI_VALUES } from "../../../types.js"
import { LEGACY_REPLY_GLYPHS } from "../../../public/components/emoji.js"

/** @param {DatabaseSync} db @returns {number} a sent card's id */
function seedCard(db) {
  const guestId = Number(
    db
      .prepare(
        `INSERT INTO guests (name, email, phone, party_size, invite_code, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("Trigger Test", null, null, 2, "TRGTEST1", "pending", null).lastInsertRowid,
  )
  return Number(
    db
      .prepare(
        `INSERT INTO thank_you_cards (token, guest_id, message, theme, status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("TRGTOKEN", guestId, "hi", "classic", "sent").lastInsertRowid,
  )
}

/** @param {DatabaseSync} db @param {number} cardId @param {string | null} emoji */
function insertReply(db, cardId, emoji) {
  db.prepare(
    `INSERT INTO thank_you_card_replies (card_id, emoji, message, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(cardId, emoji, null, "2026-01-01 00:00:00")
}

/** @returns {DatabaseSync} */
function freshDb() {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  createTables(db)
  runMigrations(db)
  return db
}

describe("reply-emoji triggers: any single emoji, size-bounded", () => {
  /** @type {DatabaseSync} */
  let db
  /** @type {number} */
  let cardId

  before(() => {
    db = freshDb()
    cardId = seedCard(db)
  })

  after(() => {
    db.close()
  })

  it("accepts glyphs on thank_you_cards.reply_emoji, including long sequences", () => {
    for (const emoji of ["❤️", "🥹", "👨‍👩‍👧‍👦", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "1️⃣"]) {
      assert.doesNotThrow(() => {
        db.prepare(`UPDATE thank_you_cards SET reply_emoji = ? WHERE id = ?`).run(emoji, cardId)
      }, `emoji ${JSON.stringify(emoji)} should be accepted`)
    }
  })

  it("rejects empty and oversized values on both columns", () => {
    for (const bad of ["", "x".repeat(17)]) {
      assert.throws(() => {
        db.prepare(`UPDATE thank_you_cards SET reply_emoji = ? WHERE id = ?`).run(bad, cardId)
      }, `card reply ${JSON.stringify(bad)} should be rejected`)
      assert.throws(() => insertReply(db, cardId, bad), `reply ${JSON.stringify(bad)} should be rejected`)
    }
  })

  it("still allows NULL (a message-only reply)", () => {
    assert.doesNotThrow(() => insertReply(db, cardId, null))
    assert.doesNotThrow(() => {
      db.prepare(`UPDATE thank_you_cards SET reply_emoji = NULL WHERE id = ?`).run(cardId)
    })
  })
})

describe("reply_emoji_glyphs migration over a key-only database", () => {
  it("rewrites every legacy key to its glyph and installs the new triggers", () => {
    const db = freshDb()
    const cardId = seedCard(db)

    // Pin the pre-migration state: the key-only triggers, and no ledger row.
    const keys = REACTION_EMOJI_VALUES.map((k) => `'${k}'`).join(", ")
    db.exec(`
      DROP TRIGGER check_tyc_reply_emoji_insert;
      DROP TRIGGER check_tyc_reply_emoji_update;
      DROP TRIGGER check_tycr_emoji_insert;
      CREATE TRIGGER check_tyc_reply_emoji_update BEFORE UPDATE ON thank_you_cards
      FOR EACH ROW WHEN NEW.reply_emoji IS NOT NULL AND NEW.reply_emoji NOT IN (${keys})
      BEGIN SELECT RAISE(ABORT, 'Invalid reply emoji'); END;
      CREATE TRIGGER check_tycr_emoji_insert BEFORE INSERT ON thank_you_card_replies
      FOR EACH ROW WHEN NEW.emoji IS NOT NULL AND NEW.emoji NOT IN (${keys})
      BEGIN SELECT RAISE(ABORT, 'Invalid reply emoji'); END;
      DELETE FROM migrations WHERE name = 'reply_emoji_glyphs';
    `)
    db.prepare(`UPDATE thank_you_cards SET reply_emoji = 'cheers' WHERE id = ?`).run(cardId)
    for (const key of REACTION_EMOJI_VALUES) insertReply(db, cardId, key)
    insertReply(db, cardId, null)
    // The old trigger is really in place: a glyph is refused before migrating.
    assert.throws(() => insertReply(db, cardId, "🥹"))

    runMigrations(db)

    const card = /** @type {{ reply_emoji: string }} */ (
      db.prepare(`SELECT reply_emoji FROM thank_you_cards WHERE id = ?`).get(cardId)
    )
    assert.strictEqual(card.reply_emoji, LEGACY_REPLY_GLYPHS.cheers)
    const replies = /** @type {Array<{ emoji: string | null }>} */ (
      db.prepare(`SELECT emoji FROM thank_you_card_replies ORDER BY id`).all()
    )
    assert.deepStrictEqual(
      replies.map((r) => r.emoji),
      [...REACTION_EMOJI_VALUES.map((k) => LEGACY_REPLY_GLYPHS[k]), null],
    )
    // New triggers: glyphs in, oversize out.
    assert.doesNotThrow(() => insertReply(db, cardId, "🥹"))
    assert.throws(() => insertReply(db, cardId, "x".repeat(17)))
    assert.ok(db.prepare(`SELECT 1 FROM migrations WHERE name = 'reply_emoji_glyphs'`).get())
    db.close()
  })
})
