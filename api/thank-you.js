/** @file Public digital thank-you card endpoints: token-authed card read (GET),
 *  recipient reply (POST — token IS the auth, no account required), and the
 *  signed-in "card waiting" banner surfacing (GET /mine). Never returns gift/
 *  amount data — that stays admin-only (api/admin/thank-you.js, a later phase).
 *  See docs plan "Digital Thank-You Cards" Phase 3. */
/** @import * as Types from './types.js' */

import { sendJson, parseBody, checkRateLimit, sanitize } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import { getOptionalAccount } from "../core/auth.js"
import {
  getCardByToken,
  getCardById,
  getPublicCardByToken,
  getPublicCardByShareToken,
  recordCardOpen,
  setCardReply,
  getCardsForGuest,
  getReplyPingEnabled,
} from "../db/thank-you-cards.js"
import { getMediaByFileKey } from "../db/media.js"
import { getGuestById } from "./guests/data.js"
import * as email from "../services/email.js"
import { validateCardToken, ValidationError, NotFoundError } from "../core/validation.js"
import { isSingleEmoji, replyGlyph } from "../public/components/emoji.js"
import { LIMITS, MEDIA_STATUS, THANK_YOU_CARD_STATUS, SERVER } from "../types.js"
import { log, AUDIT_ACTIONS } from "../core/utils.js"

/**
 * Resolve the card's media_keys JSON into public media items, filtered to
 * approved + non-deleted rows only — a key pointing at a since-rejected or
 * deleted item silently drops rather than 404ing the whole card. Order is
 * preserved from the authored array.
 * @param {string | null} mediaKeysJson
 * @returns {Types.ThankYouCardMediaItem[]}
 */
function resolveMedia(mediaKeysJson) {
  if (!mediaKeysJson) return []
  /** @type {unknown} */
  let keys
  try {
    keys = JSON.parse(mediaKeysJson)
  } catch {
    return []
  }
  if (!Array.isArray(keys)) return []

  /** @type {Types.ThankYouCardMediaItem[]} */
  const items = []
  for (const key of keys) {
    if (typeof key !== "string") continue
    const row = getMediaByFileKey(key)
    if (!row || row.deleted_at || row.status !== MEDIA_STATUS.APPROVED) continue
    items.push({
      file_key: row.file_key,
      kind: row.kind,
      width: row.width,
      height: row.height,
      needs_display: !!row.needs_display,
    })
  }
  return items
}

/**
 * Parse the opaque effects_config JSON text column, guarding against
 * malformed or non-object JSON (never trust a DB text column blindly — the
 * backend never interprets the shape beyond "is it an object").
 * @param {string | null} json
 * @returns {Record<string, unknown> | null}
 */
function parseEffectsConfig(json) {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Validate the optional reply emoji: any single emoji, stored as its glyph.
 * Returns undefined when the field wasn't provided at all (absent/null); throws
 * when provided but not exactly one emoji. A legacy reaction key (`heart`) — what
 * a page cached from before the free picker still sends — maps to its glyph.
 * @param {unknown} raw
 * @returns {string | undefined}
 */
function validateOptionalEmoji(raw) {
  if (raw === undefined || raw === null) return undefined
  const glyph = typeof raw === "string" ? replyGlyph(raw) : raw
  if (!isSingleEmoji(glyph)) throw new ValidationError("Reply emoji must be a single emoji")
  return glyph
}

/**
 * Validate + sanitize the optional reply message. Rejects (400s) anything
 * over the cap rather than silently truncating like
 * core/validation.js#validateOptionalString — the recipient should know their
 * message got cut, not have it happen invisibly. Returns undefined when the
 * field wasn't meaningfully provided (absent/null/blank).
 * @param {unknown} raw
 * @returns {string | undefined}
 */
function sanitizeReplyMessage(raw) {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== "string") {
    throw new ValidationError("message must be a string")
  }
  const trimmed = raw.trim()
  if (trimmed.length > LIMITS.THANK_YOU_REPLY_MAX_LENGTH) {
    throw new ValidationError(
      `Reply message must be ${LIMITS.THANK_YOU_REPLY_MAX_LENGTH} characters or fewer`,
    )
  }
  if (!trimmed) return undefined
  return sanitize(trimmed, LIMITS.THANK_YOU_REPLY_MAX_LENGTH) ?? undefined
}

/** @type {Types.thankYouGet} */
export async function get(req, res, { params }) {
  const clientIp = getClientIp(req)
  if (checkRateLimit(res, limiters.thankYou, clientIp)) return

  const tokenResult = validateCardToken(params.token)
  if (!tokenResult.valid) throw new NotFoundError("Card")

  // Resolve by the primary (reply-capable) token first; fall back to the
  // read-only share token. viaPrimary drives canReply, and only the primary
  // access path is ever handed back the raw share token (so a recipient can build
  // the forward link) — a share-token viewer never sees the primary token.
  let card = getPublicCardByToken(tokenResult.value)
  const viaPrimary = !!card
  if (!card) card = getPublicCardByShareToken(tokenResult.value)
  // Unknown token, wrong shape, or a draft (not yet delivered) card all 404
  // identically — never confirm existence of an undelivered card by guessing.
  if (!card) throw new NotFoundError("Card")

  /** @type {Types.PublicThankYouCardResponse} */
  const payload = {
    recipient_name: card.recipient_name,
    message: card.message,
    theme: card.theme,
    effects_config: parseEffectsConfig(card.effects_config),
    media: resolveMedia(card.media_keys),
    reply: card.replied_at
      ? { emoji: card.reply_emoji, message: card.reply_message, replied_at: card.replied_at }
      : null,
    viewed_at: card.viewed_at,
    // Replying requires the primary token; a share-token viewer is read-only.
    canReply: viaPrimary,
  }
  // Only the primary access path carries the share token (to build the forward
  // link). Never echo the primary token to a share-token viewer.
  if (viaPrimary) payload.shareToken = card.share_token

  // GET is read-only now: "opened" is stamped by the POST /:token/opened
  // beacon (the envelope-open moment), not a page-load fetch. no-store keeps
  // the token-bearing response out of shared/proxy caches.
  return sendJson(res, 200, payload, { "Cache-Control": "no-store" })
}

/** @type {Types.thankYouOpened} */
export async function opened(req, res, { params }) {
  const clientIp = getClientIp(req)
  if (checkRateLimit(res, limiters.thankYou, clientIp)) return

  const tokenResult = validateCardToken(params.token)
  if (!tokenResult.valid) throw new NotFoundError("Card")

  // Rate-limit per TOKEN as well as per IP (mirrors the reply endpoint's
  // `tyreply:` bucket): a single card's view_count can't be inflated from
  // rotating IPs, and shared-NAT guests don't starve each other. Both must pass.
  if (checkRateLimit(res, limiters.thankYou, `tybeacon:${tokenResult.value}`)) return

  // Single atomic UPDATE (race-safe for a double-fire): first open of a still-
  // 'sent' card flips it to 'viewed'; every open bumps view_count. Unknown /
  // draft / deleted tokens match no row and 404 identically to the GET.
  const result = recordCardOpen(tokenResult.value)
  if (!result) throw new NotFoundError("Card")

  return sendJson(
    res,
    200,
    { viewed_at: result.viewed_at, view_count: result.view_count },
    { "Cache-Control": "no-store" },
  )
}

/** @type {Types.thankYouReply} */
export async function reply(req, res, { params }) {
  const clientIp = getClientIp(req)
  if (checkRateLimit(res, limiters.thankYouReply, clientIp)) return

  const tokenResult = validateCardToken(params.token)
  if (!tokenResult.valid) throw new NotFoundError("Card")

  // Reply integrity (D4): rate-limit per TOKEN as well as per IP so a single
  // card can't be griefed from rotating IPs, and shared-NAT guests don't starve
  // each other. Both checks must pass.
  if (checkRateLimit(res, limiters.thankYouReply, `tyreply:${tokenResult.value}`)) return

  const card = getCardByToken(tokenResult.value)
  // Token IS the auth here — no account required. A draft (not yet sent) or
  // unknown token 404s identically. Only the primary token column is matched, so
  // a share token 404s here exactly like an unknown token (reply is primary-only).
  if (
    !card ||
    (card.status !== THANK_YOU_CARD_STATUS.SENT && card.status !== THANK_YOU_CARD_STATUS.VIEWED)
  ) {
    throw new NotFoundError("Card")
  }

  // Key the "first reply" ping off the PRE-write state — before setCardReply
  // stamps replied_at (a re-reply must not re-ping).
  const wasFirstReply = !card.replied_at

  const body = await parseBody(req)
  // Body-shape guard: a JSON `null` or non-object body must be a clean 400, not
  // a 500 from reading `.emoji` off a non-object.
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("Request body must be a JSON object")
  }
  const emoji = validateOptionalEmoji(body.emoji)
  const message = sanitizeReplyMessage(body.message)

  if (emoji === undefined && message === undefined) {
    throw new ValidationError("Provide an emoji or a message")
  }

  // Append-only history + latest-columns mirror (setCardReply refreshes
  // replied_at and clears reply_seen_at so each new reply re-surfaces as unread).
  const saved = setCardReply(card.id, { emoji, message })
  if (!saved) throw new NotFoundError("Card")

  const updated = getCardById(card.id)
  if (!updated) throw new NotFoundError("Card")

  log({
    action: AUDIT_ACTIONS.THANK_YOU_REPLY,
    ip: clientIp,
    resourceType: "thank_you_card",
    resourceId: card.id,
  })

  // Opt-in instant ping to the couple on a card's FIRST reply (default OFF). Only
  // on the first reply, only when the flag is on. Fire-and-forget: it must never
  // fail or delay the guest's reply, so it isn't awaited and swallows its errors.
  if (wasFirstReply && getReplyPingEnabled()) {
    void maybeSendFirstReplyPing(updated)
  }

  return sendJson(res, 200, {
    success: true,
    reply: {
      emoji: updated.reply_emoji,
      message: updated.reply_message,
      replied_at: updated.replied_at,
    },
  })
}

/**
 * Best-effort "first reply just landed" email to the couple. Guarded by the
 * email-configured check (same recipient as the moderation digest). Any failure
 * is logged and swallowed — the guest's reply already succeeded.
 * @param {import('../types.js').ThankYouCard} card
 * @returns {Promise<void>}
 */
async function maybeSendFirstReplyPing(card) {
  try {
    if (!email.isConfigured()) return
    const guest = getGuestById(card.guest_id)
    const guestName = guest ? guest.name : "A guest"
    const { subject, text, html } = email.getThankYouReplyPingEmail({
      guestName,
      emoji: card.reply_emoji,
      message: card.reply_message,
    })
    const result = await email.sendEmail({ to: SERVER.contactEmail, subject, text, html })
    log({
      action: AUDIT_ACTIONS.THANK_YOU_REPLY_PING,
      resourceType: "thank_you_card",
      resourceId: card.id,
      details: { success: result.success },
    })
  } catch (err) {
    log({
      action: AUDIT_ACTIONS.THANK_YOU_REPLY_PING,
      resourceType: "thank_you_card",
      resourceId: card.id,
      details: { success: false, error: err instanceof Error ? err.message : String(err) },
    })
  }
}

/** @type {Types.thankYouMine} */
export async function mine(req, res) {
  // Generous shared public-read bucket — this is a cheap own-cards lookup,
  // same posture as the other public GETs (guestbook/media list).
  if (checkRateLimit(res, limiters.publicRead, getClientIp(req))) return

  const account = getOptionalAccount(req)
  // Never 401s: signed-out or account with no linked guest both just mean
  // "nothing to show" for the banner.
  if (!account || !account.guest_id) {
    return sendJson(res, 200, { cards: [] })
  }

  return sendJson(res, 200, { cards: getCardsForGuest(account.guest_id) })
}
