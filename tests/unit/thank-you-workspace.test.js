/** @file The thank-yous workspace's pure helpers: card status words, the
 *  compact row times, the "write the next one" pick, and channel availability
 *  for batch send (public/pages/admin/thank-you-util.js). */
import { test } from "node:test"
import assert from "node:assert"

import {
  cardStatus,
  shortAgo,
  parseStamp,
  computeWorklist,
  nextToWrite,
  channelOptions,
  defaultChannel,
} from "../../public/pages/admin/thank-you-util.js"

test("cardStatus: a reply outranks an open, an open outranks a send", () => {
  const base = { status: "sent", viewed_at: null, replied_at: null }
  assert.strictEqual(cardStatus({ ...base, status: "draft" }), "draft")
  assert.strictEqual(cardStatus(base), "sent")
  assert.strictEqual(cardStatus({ ...base, status: "viewed", viewed_at: "x" }), "opened")
  assert.strictEqual(cardStatus({ ...base, replied_at: "x" }), "replied")
  assert.strictEqual(cardStatus({ ...base, status: "viewed", viewed_at: "x", replied_at: "x" }), "replied")
})

test("shortAgo: minutes, hours, days, then a date; SQLite and ISO stamps agree", () => {
  const now = Date.parse("2026-10-30T12:00:00Z")
  assert.strictEqual(shortAgo("2026-10-30T11:59:50Z", now), "just now")
  assert.strictEqual(shortAgo("2026-10-30T11:10:00.000Z", now), "50m ago")
  assert.strictEqual(shortAgo("2026-10-30 07:00:00", now), "5h ago")
  assert.strictEqual(shortAgo("2026-10-27T12:00:00Z", now), "3d ago")
  assert.ok(shortAgo("2026-09-01T12:00:00Z", now).startsWith("Sep"))
  assert.strictEqual(shortAgo(null, now), "")
  assert.strictEqual(shortAgo("not a date", now), "")
  assert.strictEqual(parseStamp("2026-10-30 07:00:00"), Date.parse("2026-10-30T07:00:00Z"))
  assert.strictEqual(parseStamp("2026-10-30T07:00:00-07:00"), Date.parse("2026-10-30T14:00:00Z"))
})

/** @param {number} id @param {number} guest @param {string} name */
const gift = (id, guest, name) => ({ id, guest_id: guest, guest_name: name })
/** @param {number} id @param {number} guest @param {string} status @param {number | null} giftId */
const card = (id, guest, status, giftId) => ({
  id,
  guest_id: guest,
  guest_name: "G" + guest,
  gift_id: giftId,
  status,
  sent_at: status === "draft" ? null : "2026-10-30T00:00:00Z",
})

test("computeWorklist: owed, thanked, remaining in gift order", () => {
  const gifts = [gift(1, 10, "Ann"), gift(2, 11, "Bo"), gift(3, 10, "Ann"), gift(4, 12, "Cy")]
  const cards = [card(1, 11, "sent", 2), card(2, 13, "draft", null)]
  const w = computeWorklist(gifts, cards)
  assert.strictEqual(w.owed, 4)
  assert.strictEqual(w.thanked, 1)
  assert.deepStrictEqual(
    w.remaining.map((r) => r.guestId),
    [10, 12, 13],
  )
})

test("nextToWrite: skips the guest just written and anyone already drafted; null at the end", () => {
  const gifts = [gift(1, 10, "Ann"), gift(2, 11, "Bo"), gift(3, 12, "Cy")]
  const cards = [card(1, 11, "draft", 2)]
  assert.deepStrictEqual(nextToWrite(gifts, cards, null), { guestId: 10, name: "Ann", giftId: 1 })
  assert.deepStrictEqual(nextToWrite(gifts, cards, 10), { guestId: 12, name: "Cy", giftId: 3 })
  // Ann and Cy drafted too: everyone has a card → "Save and finish".
  const all = [...cards, card(2, 10, "draft", 1), card(3, 12, "draft", 3)]
  assert.strictEqual(nextToWrite(gifts, all, 12), null)
  // A guest thanked by a SENT card is not owed any more.
  assert.strictEqual(nextToWrite([gift(1, 10, "Ann")], [card(9, 10, "sent", 1)], null), null)
})

test("channelOptions/defaultChannel: disabled with a reason, never hidden; link always works", () => {
  const both = { email: true, sms: true }
  const none = { email: false, sms: false }
  const full = { email: "a@example.com", phone: "+15550100000" }
  assert.strictEqual(defaultChannel(full, both), "email")
  assert.strictEqual(defaultChannel({ email: null, phone: "+1555" }, both), "sms")
  assert.strictEqual(defaultChannel({ email: null, phone: null }, both), "link")
  // No keys on the site (scratch, a fresh clone): everything goes as a link.
  assert.strictEqual(defaultChannel(full, none), "link")
  const opts = channelOptions({ email: null, phone: "+1555" }, { email: true, sms: false })
  assert.deepStrictEqual(
    opts.map((o) => [o.key, o.ok, o.why]),
    [
      ["email", false, "no email on file"],
      ["sms", false, "not set up on this site"],
      ["link", true, ""],
    ],
  )
})
