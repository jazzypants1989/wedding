/**
 * @file Unit tests for db/thank-you-cards countCardsReferencingFileKey — the
 * lookup that warns an admin before removing/rejecting a gallery photo embedded
 * in thank-you cards. Verifies the json_each match (cards referencing a file_key
 * vs none), the delivered (sent/viewed) vs total split, and that draft and
 * soft-deleted cards are counted/excluded correctly.
 */

import { describe, it, before, beforeEach, after } from "node:test"
import assert from "node:assert"

import { init, close, getDb } from "../../../db/connection.js"
import {
  countCardsReferencingFileKey,
  createThankYouCard,
  markCardSent,
  setCardReply,
  resetCardToDraft,
  getCardById,
} from "../../../db/thank-you-cards.js"

/** @param {string} code */
function makeGuest(code) {
  return Number(
    getDb()
      .prepare(
        `INSERT INTO guests (name, email, phone, party_size, invite_code, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("Ref Test", null, null, 2, code, "responded", null).lastInsertRowid,
  )
}

let tokenSeq = 0

/**
 * Insert a card directly with an explicit media_keys JSON + status.
 * @param {number} guestId
 * @param {string[] | null} mediaKeys
 * @param {"draft" | "sent" | "viewed"} status
 * @param {boolean} [deleted]
 */
function makeCard(guestId, mediaKeys, status, deleted = false) {
  tokenSeq++
  return Number(
    getDb()
      .prepare(
        `INSERT INTO thank_you_cards
           (token, share_token, guest_id, message, theme, media_keys, status, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `TOK${tokenSeq}`,
        `SHR${tokenSeq}`,
        guestId,
        "thanks",
        "classic",
        mediaKeys === null ? null : JSON.stringify(mediaKeys),
        status,
        deleted ? "2026-01-01 00:00:00" : null,
      ).lastInsertRowid,
  )
}

function clearData() {
  const db = getDb()
  db.prepare("DELETE FROM thank_you_card_replies").run()
  db.prepare("DELETE FROM thank_you_cards").run()
  db.prepare("DELETE FROM guests").run()
}

describe("db/thank-you-cards countCardsReferencingFileKey", () => {
  before(() => init())
  beforeEach(() => clearData())
  after(() => {
    clearData()
    close()
  })

  it("returns zero for a file_key no card references", () => {
    const guest = makeGuest("REFNONE1")
    makeCard(guest, ["other-key"], "sent")
    const counts = countCardsReferencingFileKey("orphan-key")
    assert.deepEqual(counts, { total: 0, delivered: 0 })
  })

  it("counts every non-deleted card and breaks out the delivered subset", () => {
    const guest = makeGuest("REFSOME1")
    // Two delivered cards (sent + viewed) and one draft all embed the key.
    makeCard(guest, ["kept-key", "extra"], "sent")
    makeCard(guest, ["kept-key"], "viewed")
    makeCard(guest, ["kept-key"], "draft")
    const counts = countCardsReferencingFileKey("kept-key")
    assert.strictEqual(counts.total, 3)
    assert.strictEqual(counts.delivered, 2) // sent + viewed only
  })

  it("ignores soft-deleted cards and cards with no media", () => {
    const guest = makeGuest("REFDEL01")
    makeCard(guest, ["kept-key"], "sent", true) // soft-deleted → excluded
    makeCard(guest, null, "sent") // NULL media_keys → no json_each rows
    makeCard(guest, [], "sent") // empty array → no json_each rows
    const counts = countCardsReferencingFileKey("kept-key")
    assert.deepEqual(counts, { total: 0, delivered: 0 })
  })

  it("counts a card once even if the key appears twice in its array", () => {
    const guest = makeGuest("REFDUP01")
    makeCard(guest, ["dup-key", "dup-key"], "sent")
    const counts = countCardsReferencingFileKey("dup-key")
    assert.deepEqual(counts, { total: 1, delivered: 1 })
  })
})

describe("db/thank-you-cards resetCardToDraft rail", () => {
  before(() => init())
  beforeEach(() => clearData())
  after(() => {
    clearData()
    close()
  })

  /** @param {number} guestId */
  function freshSentCard(guestId) {
    const card = createThankYouCard({
      guestId,
      giftId: null,
      message: "thank you",
      theme: "classic",
      effectsConfig: undefined,
      mediaKeys: undefined,
    })
    assert.ok(markCardSent(card.id, "manual"), "card marked sent")
    return card
  }

  it("resets a plain sent-but-unopened, unreplied card to draft", () => {
    const guest = makeGuest("RESETOK1")
    const card = freshSentCard(guest)

    assert.strictEqual(resetCardToDraft(card.id), true)
    const after = /** @type {any} */ (getCardById(card.id))
    assert.strictEqual(after.status, "draft")
    assert.strictEqual(after.sent_at, null)
    assert.strictEqual(after.sent_via, null)
  })

  it("REFUSES to reset a sent card that already has a reply (replied_at rail)", () => {
    const guest = makeGuest("RESETNO1")
    const card = freshSentCard(guest)
    // A reply can land while viewed_at is still NULL (the open beacon can be
    // blocked/fail), so replied_at — not just viewed_at — must gate the reset.
    assert.ok(setCardReply(card.id, { emoji: "heart", message: "so kind!" }))

    const before = /** @type {any} */ (getCardById(card.id))
    assert.strictEqual(before.viewed_at, null, "precondition: never opened")
    assert.ok(before.replied_at, "precondition: has a reply")

    assert.strictEqual(resetCardToDraft(card.id), false, "a replied card must not rewind")
    const after = /** @type {any} */ (getCardById(card.id))
    assert.strictEqual(after.status, "sent", "still sent — the reply keepsake is preserved")
  })
})
