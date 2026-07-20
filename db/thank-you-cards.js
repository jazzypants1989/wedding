/** @file Digital thank-you card database operations (Phase 1) */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now, generateInviteCode, getAppState, setAppState } from "./utils.js"

// generateInviteCode() draws from a 62-char alphabet at 8 chars — collision
// odds against the live card set are astronomically small; this cap just
// guards against an infinite loop if something is ever wrong with entropy.
const MAX_TOKEN_ATTEMPTS = 10

// app_state flag: opt-in instant ping to the couple on a card's FIRST reply
// (owner-approved amendment to the digest-only default; OFF unless set to "on").
const REPLY_PING_STATE_KEY = "thank_you_reply_ping"

/** @type {Types.createThankYouCard} */
export function createThankYouCard({ guestId, giftId, message, theme, effectsConfig, mediaKeys }) {
  const token = generateUniqueToken("token")
  // Every new card gets a read-only share token alongside its reply-capable
  // primary token (generated with the same generator, checked for uniqueness).
  const shareToken = generateUniqueToken("share_token")

  const result = sql`INSERT INTO thank_you_cards
      (token, share_token, guest_id, gift_id, message, theme, effects_config, media_keys, status)
    VALUES (${token}, ${shareToken}, ${guestId}, ${giftId ?? null}, ${message}, ${theme},
      ${effectsConfig !== undefined ? JSON.stringify(effectsConfig) : null},
      ${mediaKeys !== undefined ? JSON.stringify(mediaKeys) : null}, 'draft')`.run()
  return /** @type {import('../types.js').ThankYouCard} */ (
    getCardById(Number(result.lastInsertRowid))
  )
}

/**
 * Generate a code that no row (including soft-deleted) already holds in the
 * given column — the UNIQUE indexes on token/share_token ignore deleted_at, so
 * availability must be checked against every row, not just live ones.
 * @param {"token" | "share_token"} column
 * @returns {string}
 */
function generateUniqueToken(column) {
  for (let i = 0; i < MAX_TOKEN_ATTEMPTS; i++) {
    const candidate = generateInviteCode()
    // Column name is a fixed literal (never user input) injected via sql.raw;
    // the candidate is a bound param. One helper covers both unique columns.
    const exists = sql`SELECT 1 FROM thank_you_cards WHERE ${sql.raw(column)} = ${candidate}`.get()
    if (!exists) return candidate
  }
  throw new Error(`Could not generate a unique card ${column}`)
}

/** @type {Types.getCardById} */
export function getCardById(id) {
  return sql`SELECT * FROM thank_you_cards WHERE id = ${id} AND deleted_at IS NULL`.get()
}

/** @type {Types.getCardByToken} */
export function getCardByToken(token) {
  return sql`SELECT * FROM thank_you_cards WHERE token = ${token} AND deleted_at IS NULL`.get()
}

/** @type {Types.getPublicCardByToken} */
export function getPublicCardByToken(token) {
  // Public token-auth surface: only sent/viewed cards resolve — a draft token
  // (not yet delivered) 404s the same as an unknown one.
  return sql`SELECT t.*, g.name AS recipient_name
    FROM thank_you_cards t
    JOIN guests g ON g.id = t.guest_id
    WHERE t.token = ${token} AND t.deleted_at IS NULL
      AND t.status IN ('sent', 'viewed')`.get()
}

/** @type {Types.getPublicCardByShareToken} */
export function getPublicCardByShareToken(shareToken) {
  // Read-only share surface: resolves the same sent/viewed rows as the primary
  // token, but by the share_token column. The caller (api/thank-you.js) suppresses
  // reply capability + never echoes the primary token back for this access path.
  return sql`SELECT t.*, g.name AS recipient_name
    FROM thank_you_cards t
    JOIN guests g ON g.id = t.guest_id
    WHERE t.share_token = ${shareToken} AND t.deleted_at IS NULL
      AND t.status IN ('sent', 'viewed')`.get()
}

/** @type {Types.listCards} */
export function listCards() {
  return sql`SELECT t.*, g.name AS guest_name
    FROM thank_you_cards t
    JOIN guests g ON g.id = t.guest_id
    WHERE t.deleted_at IS NULL
    ORDER BY t.created_at DESC`.all()
}

/** @type {Types.updateCard} */
export function updateCard(id, { giftId, message, theme, effectsConfig, mediaKeys }) {
  /** @type {import('./sql.js').SqlFragment[]} */
  const sets = []
  if (giftId !== undefined) sets.push(sql`gift_id = ${giftId}`)
  if (message !== undefined) sets.push(sql`message = ${message}`)
  if (theme !== undefined) sets.push(sql`theme = ${theme}`)
  if (effectsConfig !== undefined) {
    sets.push(sql`effects_config = ${effectsConfig === null ? null : JSON.stringify(effectsConfig)}`)
  }
  if (mediaKeys !== undefined) {
    sets.push(sql`media_keys = ${mediaKeys === null ? null : JSON.stringify(mediaKeys)}`)
  }

  if (sets.length === 0) return false

  // Defense-in-depth: only draft cards are editable (the API layer 409s a
  // sent/viewed card before reaching here, but the DB refuses regardless so a
  // stray caller can't rewrite delivered content).
  const result = sql`UPDATE thank_you_cards SET ${sql.join(sets, ", ")}
    WHERE id = ${id} AND deleted_at IS NULL AND status = 'draft'`.run()
  return result.changes > 0
}

/** @type {Types.markCardSent} */
export function markCardSent(id, sentVia) {
  const result = sql`UPDATE thank_you_cards
    SET status = 'sent', sent_via = ${sentVia}, sent_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL AND status = 'draft'`.run()
  return result.changes > 0
}

/** @type {Types.recordCardOpen} */
export function recordCardOpen(token) {
  // Envelope-open beacon (POST /:token/opened). One atomic UPDATE so a double-
  // fire is race-safe: every successful call bumps view_count + last_viewed_at;
  // the FIRST open of a still-'sent' card also flips it to 'viewed' and stamps
  // viewed_at (the CASE guards keep later opens from rewriting those). Only
  // sent/viewed live cards match — a draft/unknown/deleted token returns
  // undefined so the endpoint 404s like the GET.
  const ts = now()
  return sql`UPDATE thank_you_cards
    SET view_count = view_count + 1,
        last_viewed_at = ${ts},
        status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
        viewed_at = CASE WHEN viewed_at IS NULL THEN ${ts} ELSE viewed_at END
    WHERE token = ${token} AND deleted_at IS NULL AND status IN ('sent', 'viewed')
    RETURNING viewed_at, view_count`.get()
}

/** @type {Types.resetCardToDraft} */
export function resetCardToDraft(id) {
  // Compensating action for a failed send (A2) and the "resend an unopened
  // card" path (C1). The viewed_at IS NULL guard is the safety rail: once the
  // recipient has opened the envelope we never silently rewind their card.
  const result = sql`UPDATE thank_you_cards
    SET status = 'draft', sent_via = NULL, sent_at = NULL
    WHERE id = ${id} AND status = 'sent' AND viewed_at IS NULL AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.duplicateCardToDraft} */
export function duplicateCardToDraft(id) {
  // Resend of an already-opened card (C1): clone the authored content into a
  // brand-new draft with a fresh token, leaving the original untouched.
  const source = getCardById(id)
  if (!source) return undefined

  /** @type {unknown} */
  const effectsConfig = source.effects_config ? JSON.parse(source.effects_config) : undefined
  /** @type {string[] | undefined} */
  let mediaKeys
  if (source.media_keys) {
    const parsed = JSON.parse(source.media_keys)
    if (Array.isArray(parsed)) mediaKeys = parsed
  }

  return createThankYouCard({
    guestId: source.guest_id,
    giftId: source.gift_id,
    message: source.message,
    theme: source.theme,
    effectsConfig,
    mediaKeys,
  })
}

/** @type {Types.setCardReply} */
export function setCardReply(id, { emoji, message }) {
  // Append-only history + latest-columns mirror. The card's reply_* columns
  // always reflect EXACTLY the newest reply (no silent merge): an emoji-only
  // reply clears reply_message and vice-versa. The full thread lives in
  // thank_you_card_replies. replied_at refreshes and reply_seen_at clears so
  // each new reply re-surfaces as unread for admin.
  const emojiVal = emoji ?? null
  const messageVal = message ?? null
  // Reply floor (C5): reject a contentless reply at the DB boundary too.
  if (emojiVal === null && messageVal === null) return false

  const ts = now()
  const result = sql`UPDATE thank_you_cards
    SET reply_emoji = ${emojiVal}, reply_message = ${messageVal},
        replied_at = ${ts}, reply_seen_at = NULL
    WHERE id = ${id} AND deleted_at IS NULL AND status IN ('sent', 'viewed')`.run()
  if (result.changes === 0) return false

  // Only appends once the card gate above passed — never orphan a reply row.
  sql`INSERT INTO thank_you_card_replies (card_id, emoji, message, created_at)
    VALUES (${id}, ${emojiVal}, ${messageVal}, ${ts})`.run()
  return true
}

/** @type {Types.clearCardReply} */
export function clearCardReply(id) {
  // Admin "clear reply" lever: wipe the card's latest-reply surface columns
  // (emoji/message/replied_at/reply_seen_at) so it drops off the unread badge and
  // the guest-facing reply view. The append-only thank_you_card_replies history
  // rows are DELIBERATELY retained — removable from the surface, preserved in
  // history. No status gate: a reply can only exist on a delivered card anyway.
  const result = sql`UPDATE thank_you_cards
    SET reply_emoji = NULL, reply_message = NULL, replied_at = NULL, reply_seen_at = NULL
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.getCardReplies} */
export function getCardReplies(cardId) {
  return sql`SELECT id, card_id, emoji, message, created_at
    FROM thank_you_card_replies
    WHERE card_id = ${cardId}
    ORDER BY id ASC`.all()
}

/** @type {Types.softDeleteCard} */
export function softDeleteCard(id) {
  const result = sql`UPDATE thank_you_cards SET deleted_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.getCardsForGuest} */
export function getCardsForGuest(guestId) {
  // Signed-in "card waiting" banner surfacing: only delivered cards, newest
  // sent first. Carries just enough (theme + booleans) for the banner copy —
  // still absolutely no amount/gift fields.
  /** @type {Array<{ token: string, sent_at: string | null, viewed_at: string | null, theme: string, media_keys: string | null, replied_at: string | null }>} */
  const rows = sql`SELECT token, sent_at, viewed_at, theme, media_keys, replied_at
    FROM thank_you_cards
    WHERE guest_id = ${guestId} AND deleted_at IS NULL AND status IN ('sent', 'viewed')
    ORDER BY sent_at DESC`.all()
  return rows.map((r) => ({
    token: r.token,
    sent_at: r.sent_at,
    viewed_at: r.viewed_at,
    theme: r.theme,
    has_photos: hasCardPhotos(r.media_keys),
    replied: r.replied_at !== null,
  }))
}

/**
 * True when a card's media_keys JSON holds at least one key. Robust to null,
 * empty string, and a bare "[]" — parses defensively (never trusts a DB text
 * column's shape).
 * @param {string | null} mediaKeysJson
 * @returns {boolean}
 */
function hasCardPhotos(mediaKeysJson) {
  if (!mediaKeysJson) return false
  try {
    const parsed = JSON.parse(mediaKeysJson)
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

/** @type {Types.countUnreadReplies} */
export function countUnreadReplies() {
  // The status gate is defense-in-depth: only a delivered card can carry a real
  // reply, so a draft (e.g. a resend clone that inherited a stale replied_at)
  // can never contribute a phantom unread count.
  /** @type {import('./types.js').CountResult | undefined} */
  const result = sql`SELECT COUNT(*) AS count FROM thank_you_cards
    WHERE replied_at IS NOT NULL AND reply_seen_at IS NULL AND deleted_at IS NULL
      AND status IN ('sent', 'viewed')`.get()
  return result ? result.count : 0
}

/** @type {Types.markRepliesSeen} */
export function markRepliesSeen(ids) {
  if (ids.length === 0) return 0
  const result = sql`UPDATE thank_you_cards SET reply_seen_at = ${now()}
    WHERE id IN ${sql.list(ids)} AND deleted_at IS NULL
      AND replied_at IS NOT NULL AND reply_seen_at IS NULL`.run()
  return Number(result.changes)
}

/** @type {Types.getReplyPingEnabled} */
export function getReplyPingEnabled() {
  return getAppState(REPLY_PING_STATE_KEY) === "on"
}

/** @type {Types.setReplyPingEnabled} */
export function setReplyPingEnabled(enabled) {
  setAppState(REPLY_PING_STATE_KEY, enabled ? "on" : "off")
}

/** @type {Types.getGuestStory} */
export function getGuestStory(guestId) {
  // Composer sidecar / guest detail panel: the guest's own approved content plus
  // their gift + card ledger. Guestbook/media hang off ACCOUNTS (account_id), which
  // link to a guest via accounts.guest_id — a guest with no account yields
  // null/empty for those. Amount rides along here because this is an admin surface.
  const guestbookEntry = /** @type {{ message: string, created_at: string } | undefined} */ (
    sql`SELECT e.message, e.created_at
      FROM guestbook_entries e
      JOIN accounts a ON a.id = e.account_id
      WHERE a.guest_id = ${guestId} AND a.deleted_at IS NULL
        AND e.status = 'approved' AND e.deleted_at IS NULL
      ORDER BY e.id DESC
      LIMIT 1`.get()
  )

  const media = /** @type {Array<{ file_key: string, kind: string }>} */ (
    sql`SELECT m.file_key, m.kind
      FROM media m
      JOIN accounts a ON a.id = m.account_id
      WHERE a.guest_id = ${guestId} AND a.deleted_at IS NULL
        AND m.status = 'approved' AND m.deleted_at IS NULL
      ORDER BY m.id DESC
      LIMIT 12`.all()
  )

  const gifts = /** @type {Array<{ id: number, description: string | null, amount: string | null, received_at: string | null, physical_card_sent: number }>} */ (
    sql`SELECT id, description, amount, received_at, physical_card_sent
      FROM gifts
      WHERE guest_id = ${guestId} AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC`.all()
  )

  const cards = /** @type {Array<{ id: number, status: string, sent_at: string | null, viewed_at: string | null, replied_at: string | null, reply_seen_at: string | null }>} */ (
    sql`SELECT id, status, sent_at, viewed_at, replied_at, reply_seen_at
      FROM thank_you_cards
      WHERE guest_id = ${guestId} AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC`.all()
  )

  return {
    guestbookEntry: guestbookEntry
      ? { message: guestbookEntry.message, createdAt: guestbookEntry.created_at }
      : null,
    media: media.map((m) => ({
      fileKey: m.file_key,
      kind: /** @type {"image" | "video"} */ (m.kind),
    })),
    gifts: gifts.map((g) => ({
      id: g.id,
      description: g.description,
      amount: g.amount,
      receivedAt: g.received_at,
      physicalCardSent: !!g.physical_card_sent,
    })),
    cards: cards.map((c) => ({
      id: c.id,
      status: /** @type {import('../types.js').ThankYouCardStatus} */ (c.status),
      sentAt: c.sent_at,
      viewedAt: c.viewed_at,
      repliedAt: c.replied_at,
      replySeen: c.reply_seen_at !== null,
    })),
  }
}
