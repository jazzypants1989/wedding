/** @file Gift log database operations (Digital Thank-You Cards Phase 1) */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"

/** @type {Types.createGift} */
export function createGift({ guestId, description, amount, notes, receivedAt }) {
  const result = sql`INSERT INTO gifts (guest_id, description, amount, notes, received_at)
    VALUES (${guestId}, ${description ?? null}, ${amount ?? null}, ${notes ?? null}, ${receivedAt ?? null})`.run()
  return /** @type {import('../types.js').Gift} */ (
    getGiftById(Number(result.lastInsertRowid))
  )
}

/** @type {Types.getGiftById} */
export function getGiftById(id) {
  return sql`SELECT * FROM gifts WHERE id = ${id} AND deleted_at IS NULL`.get()
}

/** @type {Types.listGifts} */
export function listGifts() {
  // digital_card_status reflects the most recent (highest-id) non-deleted card
  // linked to this gift — a gift may be re-composed/re-sent, so this is the
  // latest attempt, not a history.
  return sql`SELECT g.*, gu.name AS guest_name,
      (SELECT t.status FROM thank_you_cards t
        WHERE t.gift_id = g.id AND t.deleted_at IS NULL
        ORDER BY t.id DESC LIMIT 1) AS digital_card_status
    FROM gifts g
    JOIN guests gu ON gu.id = g.guest_id
    WHERE g.deleted_at IS NULL
    ORDER BY g.created_at DESC`.all()
}

/** @type {Types.updateGift} */
export function updateGift(id, { description, amount, notes, receivedAt }) {
  /** @type {import('./sql.js').SqlFragment[]} */
  const sets = []
  if (description !== undefined) sets.push(sql`description = ${description}`)
  if (amount !== undefined) sets.push(sql`amount = ${amount}`)
  if (notes !== undefined) sets.push(sql`notes = ${notes}`)
  if (receivedAt !== undefined) sets.push(sql`received_at = ${receivedAt}`)

  if (sets.length === 0) return false

  const result = sql`UPDATE gifts SET ${sql.join(sets, ", ")}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.softDeleteGift} */
export function softDeleteGift(id) {
  const result = sql`UPDATE gifts SET deleted_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.setPhysicalCardSent} */
export function setPhysicalCardSent(id, sent) {
  const result = sql`UPDATE gifts
    SET physical_card_sent = ${sent ? 1 : 0},
        physical_card_sent_at = ${sent ? now() : null}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}
