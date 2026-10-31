/** @file Admin gift log + digital thank-you card management + delivery
 *  endpoints (Phase 5/6). Gifts CRUD (+ physical-card toggle); cards CRUD
 *  (draft-only edits — a sent/viewed card is immutable, 409 otherwise);
 *  counts for the tab badge (unread replies + drafts); delivery flow mirrors
 *  api/admin/invites.js (config/preview/send) plus a manual/link mark-sent
 *  path modeled on api/admin/manual-sms.js. Amount is admin-only and is never
 *  read back out through the public surface (api/thank-you.js) — this module
 *  is the only place it's written or returned. */
/** @import * as Types from './types.js' */

import {
  createGift as createGiftDb,
  getGiftById,
  listGifts as listGiftsDb,
  updateGift as updateGiftDb,
  softDeleteGift,
  setPhysicalCardSent,
} from "../../db/gifts.js"
import {
  createThankYouCard,
  getCardById,
  listCards as listCardsDb,
  updateCard as updateCardDb,
  markCardSent,
  resetCardToDraft,
  duplicateCardToDraft,
  getCardReplies,
  clearCardReply,
  softDeleteCard,
  countUnreadReplies,
  markRepliesSeen,
  getReplyPingEnabled,
  setReplyPingEnabled,
  getGuestStory,
  getRecentReplies,
} from "../../db/thank-you-cards.js"
import { getMediaFeaturingGuest } from "../../db/guest-photos.js"
import { getGuestById } from "../guests/data.js"
import { getRsvpByGuestId } from "../rsvp.js"
import { getMediaByFileKey } from "../../db/media.js"
import { logCommunication } from "../../db/utils.js"
import { sendJson, parseBody, checkRateLimit, sendCsv } from "../../core/http.js"
import { giftsToCSV, thankYouCardsToCSV } from "../../core/csv.js"
import { limiters, getClientIp } from "../../core/rate-limit.js"
import { getEmailSubjects } from "../../core/wedding-facts.js"
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  validateId,
  validateOptionalString,
  validateRequiredString,
  validateCommunicationType,
  validateServiceConfigured,
} from "../../core/validation.js"
import {
  LIMITS,
  SERVER,
  MEDIA_STATUS,
  THANK_YOU_CARD_STATUS,
  THANK_YOU_THEME_VALUES,
} from "../../types.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { formatTemplate } from "../../services/templates.js"
import * as twilio from "../../services/twilio.js"
import * as email from "../../services/email.js"

// Free-form date-ish text (e.g. "2026-06-14") — generous cap, no shape check.
const RECEIVED_AT_MAX_LENGTH = 32

/**
 * Validate the card theme against the shared allowlist (single source of
 * truth with the visuals planner's EFFECT_THEMES — see types.js comment).
 * @param {unknown} value
 * @returns {import('../../types.js').ValidationResult<string>}
 */
function validateTheme(value) {
  if (
    typeof value !== "string" ||
    !/** @type {readonly string[]} */ (THANK_YOU_THEME_VALUES).includes(value)
  ) {
    return {
      valid: false,
      error: `theme must be one of: ${THANK_YOU_THEME_VALUES.join(", ")}`,
    }
  }
  return { valid: true, value }
}

/**
 * Validate the optional gift_id link: undefined (omitted) passes through,
 * null (explicit clear) passes through, otherwise must resolve to a real,
 * non-deleted gift that ALSO belongs to this card's recipient (a card can only
 * reference a gift from the same guest — cross-guest links would misattribute
 * the admin-only amount).
 * @param {unknown} value
 * @param {number} guestId
 * @returns {import('../../types.js').ValidationResult<number | null | undefined>}
 */
function validateOptionalGiftId(value, guestId) {
  if (value === undefined) return { valid: true, value: undefined }
  if (value === null) return { valid: true, value: null }
  const idResult = validateId(value, "gift_id")
  if (!idResult.valid) return idResult
  const gift = getGiftById(idResult.value)
  if (!gift) {
    return { valid: false, error: "Gift not found" }
  }
  if (gift.guest_id !== guestId) {
    return { valid: false, error: "Gift does not belong to this guest" }
  }
  return { valid: true, value: idResult.value }
}

/**
 * Validate the opaque effects_config value: accepts either a plain object
 * (the normal case — it arrives already parsed inside the JSON request body)
 * or a JSON-text string (defensive), and enforces the serialized byte cap.
 * The backend never inspects the shape beyond "is it a JSON object".
 * @param {unknown} value
 * @returns {import('../../types.js').ValidationResult<Record<string, unknown> | null | undefined>}
 */
function validateEffectsConfig(value) {
  if (value === undefined) return { valid: true, value: undefined }
  if (value === null) return { valid: true, value: null }

  /** @type {unknown} */
  let obj = value
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value)
    } catch {
      return { valid: false, error: "effects_config must be valid JSON" }
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { valid: false, error: "effects_config must be a JSON object" }
  }
  const bytes = Buffer.byteLength(JSON.stringify(obj), "utf8")
  if (bytes > LIMITS.THANK_YOU_EFFECTS_CONFIG_MAX_BYTES) {
    return {
      valid: false,
      error: `effects_config exceeds ${LIMITS.THANK_YOU_EFFECTS_CONFIG_MAX_BYTES} bytes`,
    }
  }
  return { valid: true, value: /** @type {Record<string, unknown>} */ (obj) }
}

/**
 * Validate the optional media_keys array: each entry must resolve to an
 * approved, non-deleted media row via getMediaByFileKey, capped at
 * LIMITS.THANK_YOU_MEDIA_MAX_KEYS. Order is preserved.
 * @param {unknown} value
 * @returns {import('../../types.js').ValidationResult<string[] | null | undefined>}
 */
function validateMediaKeys(value) {
  if (value === undefined) return { valid: true, value: undefined }
  if (value === null) return { valid: true, value: null }
  if (!Array.isArray(value)) {
    return { valid: false, error: "media_keys must be an array" }
  }
  if (value.length > LIMITS.THANK_YOU_MEDIA_MAX_KEYS) {
    return {
      valid: false,
      error: `media_keys exceeds maximum of ${LIMITS.THANK_YOU_MEDIA_MAX_KEYS} items`,
    }
  }
  /** @type {string[]} */
  const keys = []
  for (const key of value) {
    if (typeof key !== "string" || !key) {
      return { valid: false, error: "media_keys must contain non-empty strings" }
    }
    const row = getMediaByFileKey(key)
    if (!row || row.deleted_at || row.status !== MEDIA_STATUS.APPROVED) {
      return { valid: false, error: `Unknown or unapproved media key: ${key}` }
    }
    keys.push(key)
  }
  return { valid: true, value: keys }
}

// ==================== Gifts ====================

/** @type {Types.adminGiftsListHandler} */
export async function listGifts(req, res) {
  return sendJson(res, 200, { gifts: listGiftsDb() })
}

/** @type {Types.adminGiftCreateHandler} */
export async function createGift(req, res, { session }) {
  const body = await parseBody(req)
  const { guest_id, description, amount, notes, received_at } = body

  const guestIdResult = validateId(guest_id, "guest_id")
  if (!guestIdResult.valid) throw new ValidationError(guestIdResult.error)

  const guest = getGuestById(guestIdResult.value)
  if (!guest) throw new NotFoundError("Guest")

  const descriptionResult = validateOptionalString(description, LIMITS.NOTES_MAX_LENGTH)
  const amountResult = validateOptionalString(amount, LIMITS.GIFT_AMOUNT_MAX_LENGTH)
  const notesResult = validateOptionalString(notes, LIMITS.NOTES_MAX_LENGTH)
  const receivedAtResult = validateOptionalString(received_at, RECEIVED_AT_MAX_LENGTH)

  const gift = createGiftDb({
    guestId: guestIdResult.value,
    description: descriptionResult.value,
    amount: amountResult.value,
    notes: notesResult.value,
    receivedAt: receivedAtResult.value,
  })

  log({
    action: AUDIT_ACTIONS.GIFT_CREATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "gift",
    resourceId: gift.id,
    details: { guestId: guestIdResult.value },
  })

  return sendJson(res, 201, { success: true, gift })
}

/** @type {Types.adminGiftUpdateHandler} */
export async function updateGift(req, res, { params, session }) {
  const idResult = validateId(params.id, "gift ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const existing = getGiftById(idResult.value)
  if (!existing) throw new NotFoundError("Gift")

  const body = await parseBody(req)
  /** @type {import('../../db/types.js').UpdateGiftFields} */
  const updates = {}

  if (body.description !== undefined) {
    updates.description = validateOptionalString(body.description, LIMITS.NOTES_MAX_LENGTH).value
  }
  if (body.amount !== undefined) {
    updates.amount = validateOptionalString(body.amount, LIMITS.GIFT_AMOUNT_MAX_LENGTH).value
  }
  if (body.notes !== undefined) {
    updates.notes = validateOptionalString(body.notes, LIMITS.NOTES_MAX_LENGTH).value
  }
  if (body.received_at !== undefined) {
    updates.receivedAt = validateOptionalString(body.received_at, RECEIVED_AT_MAX_LENGTH).value
  }

  if (Object.keys(updates).length === 0) {
    throw new ValidationError("No valid fields to update")
  }

  updateGiftDb(idResult.value, updates)

  log({
    action: AUDIT_ACTIONS.GIFT_UPDATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "gift",
    resourceId: idResult.value,
    details: { fields: Object.keys(updates) },
  })

  return sendJson(res, 200, { success: true, gift: getGiftById(idResult.value) })
}

/** @type {Types.adminGiftDeleteHandler} */
export async function deleteGift(req, res, { params, session }) {
  const idResult = validateId(params.id, "gift ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const existing = getGiftById(idResult.value)
  if (!existing) throw new NotFoundError("Gift")

  softDeleteGift(idResult.value)

  log({
    action: AUDIT_ACTIONS.GIFT_DELETE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "gift",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true })
}

/** @type {Types.adminGiftPhysicalCardHandler} */
export async function togglePhysicalCard(req, res, { params, session }) {
  const idResult = validateId(params.id, "gift ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const existing = getGiftById(idResult.value)
  if (!existing) throw new NotFoundError("Gift")

  const body = await parseBody(req)
  if (typeof body.sent !== "boolean") {
    throw new ValidationError("sent must be a boolean")
  }

  setPhysicalCardSent(idResult.value, body.sent)

  log({
    action: AUDIT_ACTIONS.GIFT_PHYSICAL_TOGGLE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "gift",
    resourceId: idResult.value,
    details: { sent: body.sent },
  })

  return sendJson(res, 200, { success: true, gift: getGiftById(idResult.value) })
}

/** @type {Types.adminGiftsExportHandler} */
export function exportGiftsCSV(req, res) {
  const gifts = listGiftsDb()
  const csv = giftsToCSV(gifts)
  const filename = `gifts-${new Date().toISOString().slice(0, 10)}.csv`

  log({
    action: AUDIT_ACTIONS.GIFT_EXPORT,
    ip: getClientIp(req),
    details: { giftCount: gifts.length, filename },
  })

  return sendCsv(res, filename, csv)
}

// ==================== Cards ====================

/** @type {Types.adminThankYouListHandler} */
export async function listCards(req, res) {
  return sendJson(res, 200, { cards: listCardsDb() })
}

/** @type {Types.adminThankYouExportHandler} */
export function exportCardsCSV(req, res) {
  const cards = listCardsDb()
  const csv = thankYouCardsToCSV(cards)
  const filename = `thank-you-cards-${new Date().toISOString().slice(0, 10)}.csv`

  log({
    action: AUDIT_ACTIONS.THANK_YOU_CARD_EXPORT,
    ip: getClientIp(req),
    details: { cardCount: cards.length, filename },
  })

  return sendCsv(res, filename, csv)
}

/** @type {Types.adminThankYouGetHandler} */
export async function getCard(req, res, { params }) {
  const idResult = validateId(params.id, "card ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const card = getCardById(idResult.value)
  if (!card) throw new NotFoundError("Card")

  const guest = getGuestById(card.guest_id)
  // Detail view carries the full reply thread (oldest first) plus the
  // engagement counters (view_count/last_viewed_at ride along on ...card).
  const replies = getCardReplies(card.id).map((r) => ({
    emoji: r.emoji,
    message: r.message,
    created_at: r.created_at,
  }))
  return sendJson(res, 200, {
    card: { ...card, guest_name: guest ? guest.name : null },
    replies,
  })
}

/** @type {Types.adminThankYouCreateHandler} */
export async function createCard(req, res, { session }) {
  const body = await parseBody(req)
  const { guest_id, gift_id, message, theme, effects_config, media_keys } = body

  const guestIdResult = validateId(guest_id, "guest_id")
  if (!guestIdResult.valid) throw new ValidationError(guestIdResult.error)

  const guest = getGuestById(guestIdResult.value)
  if (!guest) throw new NotFoundError("Guest")

  const messageResult = validateRequiredString(
    message,
    "message",
    LIMITS.THANK_YOU_MESSAGE_MAX_LENGTH,
  )
  if (!messageResult.valid) throw new ValidationError(messageResult.error)

  const themeResult = validateTheme(theme === undefined ? "classic" : theme)
  if (!themeResult.valid) throw new ValidationError(themeResult.error)

  const giftIdResult = validateOptionalGiftId(gift_id, guestIdResult.value)
  if (!giftIdResult.valid) throw new ValidationError(giftIdResult.error)

  const effectsResult = validateEffectsConfig(effects_config)
  if (!effectsResult.valid) throw new ValidationError(effectsResult.error)

  const mediaKeysResult = validateMediaKeys(media_keys)
  if (!mediaKeysResult.valid) throw new ValidationError(mediaKeysResult.error)

  const card = createThankYouCard({
    guestId: guestIdResult.value,
    giftId: giftIdResult.value ?? null,
    message: messageResult.value,
    theme: themeResult.value,
    effectsConfig: effectsResult.value,
    mediaKeys: mediaKeysResult.value ?? undefined,
  })

  log({
    action: AUDIT_ACTIONS.THANK_YOU_CARD_CREATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "thank_you_card",
    resourceId: card.id,
    details: { guestId: guestIdResult.value },
  })

  return sendJson(res, 201, { success: true, card })
}

/** @type {Types.adminThankYouUpdateHandler} */
export async function updateCard(req, res, { params, session }) {
  const idResult = validateId(params.id, "card ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const existing = getCardById(idResult.value)
  if (!existing) throw new NotFoundError("Card")

  // Only draft cards are editable — once sent, the recipient's link is live;
  // rewriting the message/theme/media out from under them would be surprising
  // (and viewed_at/reply are keyed off the delivered content). Re-compose a
  // fresh card + re-send instead.
  if (existing.status !== THANK_YOU_CARD_STATUS.DRAFT) {
    throw new ConflictError("Only draft cards can be edited")
  }

  const body = await parseBody(req)
  /** @type {import('../../db/types.js').UpdateCardFields} */
  const updates = {}

  if (body.gift_id !== undefined) {
    const r = validateOptionalGiftId(body.gift_id, existing.guest_id)
    if (!r.valid) throw new ValidationError(r.error)
    updates.giftId = r.value
  }
  if (body.message !== undefined) {
    const r = validateRequiredString(body.message, "message", LIMITS.THANK_YOU_MESSAGE_MAX_LENGTH)
    if (!r.valid) throw new ValidationError(r.error)
    updates.message = r.value
  }
  if (body.theme !== undefined) {
    const r = validateTheme(body.theme)
    if (!r.valid) throw new ValidationError(r.error)
    updates.theme = r.value
  }
  if (body.effects_config !== undefined) {
    const r = validateEffectsConfig(body.effects_config)
    if (!r.valid) throw new ValidationError(r.error)
    updates.effectsConfig = r.value
  }
  if (body.media_keys !== undefined) {
    const r = validateMediaKeys(body.media_keys)
    if (!r.valid) throw new ValidationError(r.error)
    updates.mediaKeys = r.value
  }

  if (Object.keys(updates).length === 0) {
    throw new ValidationError("No valid fields to update")
  }

  updateCardDb(idResult.value, updates)

  log({
    action: AUDIT_ACTIONS.THANK_YOU_CARD_UPDATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "thank_you_card",
    resourceId: idResult.value,
    details: { fields: Object.keys(updates) },
  })

  return sendJson(res, 200, { success: true, card: getCardById(idResult.value) })
}

/** @type {Types.adminThankYouDeleteHandler} */
export async function deleteCard(req, res, { params, session }) {
  const idResult = validateId(params.id, "card ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const existing = getCardById(idResult.value)
  if (!existing) throw new NotFoundError("Card")

  softDeleteCard(idResult.value)

  log({
    action: AUDIT_ACTIONS.THANK_YOU_CARD_DELETE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "thank_you_card",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true })
}

/** @type {Types.adminThankYouReplySeenHandler} */
export async function markReplySeen(req, res, { params }) {
  const idResult = validateId(params.id, "card ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const existing = getCardById(idResult.value)
  if (!existing) throw new NotFoundError("Card")

  markRepliesSeen([idResult.value])

  return sendJson(res, 200, { success: true, card: getCardById(idResult.value) })
}

/** @type {Types.adminThankYouClearReplyHandler} */
export async function clearReply(req, res, { params, session }) {
  const idResult = validateId(params.id, "card ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const existing = getCardById(idResult.value)
  if (!existing) throw new NotFoundError("Card")

  // Wipes the reply SURFACE columns; the append-only thank_you_card_replies
  // history rows are deliberately retained (removable from view, kept in history).
  clearCardReply(idResult.value)

  log({
    action: AUDIT_ACTIONS.THANK_YOU_REPLY_CLEAR,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "thank_you_card",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true, card: getCardById(idResult.value) })
}

/** @type {Types.adminThankYouGuestStoryHandler} */
export async function guestStory(req, res, { params }) {
  const idResult = validateId(params.id, "guest ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const guest = getGuestById(idResult.value)
  if (!guest) throw new NotFoundError("Guest")

  const rsvp = getRsvpByGuestId(idResult.value)
  const story = getGuestStory(idResult.value)

  return sendJson(res, 200, {
    guest: { id: guest.id, name: guest.name },
    rsvpNote: rsvp && rsvp.message ? rsvp.message : null,
    guestbookEntry: story.guestbookEntry,
    media: story.media,
    gifts: story.gifts,
    cards: story.cards,
  })
}

/** @type {Types.adminThankYouGuestPhotosHandler} */
export async function guestPhotos(req, res, { params }) {
  const idResult = validateId(params.id, "guest ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const guest = getGuestById(idResult.value)
  if (!guest) throw new NotFoundError("Guest")

  // The composer's photo picker lists these first, then the rest of the gallery.
  return sendJson(res, 200, { items: getMediaFeaturingGuest(idResult.value) })
}

/** @type {Types.adminThankYouCountsHandler} */
export async function counts(req, res) {
  // Guest lists here are wedding-sized (dozens-hundreds), so filtering the
  // full admin list in-process is simpler than adding a dedicated draft-count
  // query — same posture as this module's other small aggregate reads.
  const drafts = listCardsDb().filter((c) => c.status === THANK_YOU_CARD_STATUS.DRAFT).length
  return sendJson(res, 200, { unreadReplies: countUnreadReplies(), drafts })
}

/** Default + hard cap for the recent-replies feed page size. */
const REPLIES_DEFAULT_LIMIT = 50
const REPLIES_MAX_LIMIT = 200

/** @type {Types.adminThankYouRecentRepliesHandler} */
export async function recentReplies(req, res) {
  // Cross-card mailbox/inbox feed. `limit` is clamped: a bad/absent value falls
  // back to the default rather than erroring — this is a convenience read.
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const raw = parseInt(url.searchParams.get("limit") ?? "", 10)
  const limit = Number.isNaN(raw)
    ? REPLIES_DEFAULT_LIMIT
    : Math.min(Math.max(raw, 1), REPLIES_MAX_LIMIT)
  return sendJson(res, 200, { replies: getRecentReplies(limit) })
}

// ==================== Delivery ====================

/** @type {Types.adminThankYouConfigHandler} */
export async function sendConfig(req, res) {
  return sendJson(res, 200, {
    email: {
      configured: email.isConfigured(),
      defaultMessage: email.getThankYouCardEmail("{name}", "{url}").text,
    },
    sms: {
      configured: twilio.isConfigured(),
      defaultMessage: twilio.getDefaultThankYouMessage("{name}", "{url}"),
    },
    // Opt-in instant first-reply ping (default off). The admin UI wires a checkbox
    // to GET/POST this same /config route.
    replyPingEnabled: getReplyPingEnabled(),
  })
}

/** @type {Types.adminThankYouSetConfigHandler} */
export async function setConfig(req, res, { session }) {
  const body = await parseBody(req)
  if (typeof body.replyPingEnabled !== "boolean") {
    throw new ValidationError("replyPingEnabled must be a boolean")
  }

  setReplyPingEnabled(body.replyPingEnabled)

  log({
    action: AUDIT_ACTIONS.THANK_YOU_REPLY_PING,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "app_state",
    details: { setting: "reply_ping", enabled: body.replyPingEnabled },
  })

  return sendJson(res, 200, { success: true, replyPingEnabled: body.replyPingEnabled })
}

/** @type {Types.adminThankYouPreviewHandler} */
export async function sendPreview(req, res) {
  const body = await parseBody(req)
  const { cardId, type, customMessage } = body

  const idResult = validateId(cardId, "cardId")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const typeResult = validateCommunicationType(type)
  if (!typeResult.valid) throw new ValidationError(typeResult.error)

  const card = getCardById(idResult.value)
  if (!card) throw new NotFoundError("Card")

  const serviceResult = validateServiceConfigured(typeResult.value)
  if (!serviceResult.valid) throw new ValidationError(serviceResult.error ?? "Service not configured")

  const guest = getGuestById(card.guest_id)
  if (!guest) throw new NotFoundError("Guest")

  const commType = typeResult.value
  const template = typeof customMessage === "string" ? customMessage : null

  if (commType === "sms" && !guest.phone) {
    return sendJson(res, 200, {
      type: commType,
      recipient: { id: guest.id, name: guest.name, contact: null },
      skipped: { reason: "No phone number" },
    })
  }
  if (commType === "email" && !guest.email) {
    return sendJson(res, 200, {
      type: commType,
      recipient: { id: guest.id, name: guest.name, contact: null },
      skipped: { reason: "No email address" },
    })
  }

  const cardUrl = `${SERVER.baseUrl}/thanks?card=${card.token}`
  let messagePreview
  // Full branded HTML for the email channel (rendered by the admin UI in a
  // sandboxed iframe); null for SMS or a custom-text template with no HTML.
  /** @type {string | null} */
  let emailHtml = null

  if (commType === "sms") {
    messagePreview = template
      ? formatTemplate(template, { name: guest.name, url: cardUrl })
      : twilio.getDefaultThankYouMessage(guest.name, cardUrl)
  } else {
    const emailData = template
      ? { subject: getEmailSubjects().thankYou, text: formatTemplate(template, { name: guest.name, url: cardUrl }), html: undefined }
      : email.getThankYouCardEmail(guest.name, cardUrl)
    messagePreview = emailData.text
    emailHtml = emailData.html ?? null
  }

  return sendJson(res, 200, {
    type: commType,
    recipient: {
      id: guest.id,
      name: guest.name,
      contact: commType === "sms" ? guest.phone : guest.email,
      // Append the ellipsis only when actually truncated (mirrors invites.js).
      messagePreview:
        messagePreview.length > 200 ? messagePreview.slice(0, 200) + "…" : messagePreview,
    },
    emailHtml,
    skipped: null,
  })
}

/** @type {Types.adminThankYouSendHandler} */
export async function send(req, res, { session }) {
  if (checkRateLimit(res, limiters.adminThankYou, session.token)) return

  const body = await parseBody(req)
  const { cardId, type, customMessage } = body

  const idResult = validateId(cardId, "cardId")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const typeResult = validateCommunicationType(type)
  if (!typeResult.valid) throw new ValidationError(typeResult.error)

  const card = getCardById(idResult.value)
  if (!card) throw new NotFoundError("Card")

  // Draft-only: a card that's already sent/viewed keeps its original token
  // delivery — re-sending would silently rewrite what the recipient already
  // opened. Re-compose (a fresh card) instead. Checked before service
  // configuration so an already-sent card reliably 409s regardless of
  // whether email/SMS happens to be configured.
  if (card.status !== THANK_YOU_CARD_STATUS.DRAFT) {
    throw new ConflictError("Card has already been sent")
  }

  const serviceResult = validateServiceConfigured(typeResult.value)
  if (!serviceResult.valid) throw new ValidationError(serviceResult.error ?? "Service not configured")

  const guest = getGuestById(card.guest_id)
  if (!guest) throw new NotFoundError("Guest")

  const commType = typeResult.value
  const template = typeof customMessage === "string" ? customMessage : null

  if (commType === "sms" && !guest.phone) {
    throw new ValidationError("Guest has no phone number")
  }
  if (commType === "email" && !guest.email) {
    throw new ValidationError("Guest has no email address")
  }

  // Atomic claim-then-compensate (A2): claim the card FIRST via markCardSent —
  // its `WHERE status='draft'` is the mutex, so two racing sends can't both
  // dispatch (the loser gets a 409, no double email/SMS). Only after winning
  // the claim do we call the provider; a provider failure compensates by
  // resetting the card to draft so it stays retryable.
  if (!markCardSent(card.id, commType)) {
    throw new ConflictError("Card has already been sent")
  }

  const cardUrl = `${SERVER.baseUrl}/thanks?card=${card.token}`
  /** @type {import('../../services/types.js').SendResult | import('../../services/types.js').SendSMSResult} */
  let sendResult
  /** @type {string | null} */
  let messagePreview = null

  // The provider await sits between the markCardSent claim and the success
  // check. A thrown exception (network error, unexpected provider failure) must
  // trigger the SAME compensation as a {success:false} result — otherwise the
  // claimed card is stranded 'sent' but undelivered, with no failed-comm
  // record. Wrap it so any throw is funneled into the failure path below.
  try {
    if (commType === "sms") {
      const message = template
        ? formatTemplate(template, { name: guest.name, url: cardUrl })
        : twilio.getDefaultThankYouMessage(guest.name, cardUrl)
      messagePreview = message.slice(0, 100)
      sendResult = await twilio.sendSMS(/** @type {string} */ (guest.phone), message)
    } else {
      const emailData = template
        ? {
            subject: getEmailSubjects().thankYou,
            text: formatTemplate(template, { name: guest.name, url: cardUrl }),
            html: undefined,
          }
        : email.getThankYouCardEmail(guest.name, cardUrl)
      messagePreview = emailData.text.slice(0, 100)
      sendResult = await email.sendEmail({
        to: /** @type {string} */ (guest.email),
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      })
    }
  } catch (err) {
    // Same compensation as the {success:false} branch: undo the claim (guarded
    // by viewed_at IS NULL — the recipient can't have opened it, delivery never
    // completed) and record the failed send. 502 because the request was valid;
    // the outbound provider call is what failed.
    const detail = err instanceof Error ? err.message : String(err)
    resetCardToDraft(card.id)
    logCommunication(guest.id, commType, "failed", messagePreview, detail)
    throw new AppError(detail || "Failed to send", 502, "SEND_FAILED")
  }

  if (!sendResult.success) {
    // Compensate: undo the claim so the card is a retryable draft again. The
    // reset is guarded by `viewed_at IS NULL` — it can only rewind a card the
    // recipient hasn't opened (they can't have, since delivery just failed).
    resetCardToDraft(card.id)
    logCommunication(guest.id, commType, "failed", messagePreview, sendResult.error)
    // 502, not 400 — the request itself was valid; the outbound provider call
    // failed. Surfaced verbatim so the admin sees the actual provider error.
    throw new AppError(sendResult.error || "Failed to send", 502, "SEND_FAILED")
  }

  logCommunication(guest.id, commType, "sent", messagePreview, null)

  log({
    action: AUDIT_ACTIONS.THANK_YOU_CARD_SEND,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "thank_you_card",
    resourceId: card.id,
    details: { type: commType, guestId: guest.id },
  })

  return sendJson(res, 200, { success: true, card: getCardById(card.id) })
}

/** @type {Types.adminThankYouMarkSentHandler} */
export async function markSentManual(req, res, { params, session }) {
  const idResult = validateId(params.id, "card ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const card = getCardById(idResult.value)
  if (!card) throw new NotFoundError("Card")

  if (card.status !== THANK_YOU_CARD_STATUS.DRAFT) {
    throw new ConflictError("Card has already been sent")
  }

  const body = await parseBody(req)
  const via = body.via === "link" ? "link" : "manual"

  const marked = markCardSent(idResult.value, via)
  if (!marked) throw new ConflictError("Card has already been sent")

  // NOTE: no logCommunication() here, deliberately — the communications table
  // has a hard type-enum trigger restricted to 'email'|'sms' (db/schema.js),
  // and 'manual'/'link' aren't a real send channel to misrepresent as either.
  // The audit log below is the record of this transition.
  log({
    action: AUDIT_ACTIONS.THANK_YOU_CARD_SEND,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "thank_you_card",
    resourceId: idResult.value,
    details: { via },
  })

  return sendJson(res, 200, { success: true, card: getCardById(idResult.value) })
}

/** @type {Types.adminThankYouResendHandler} */
export async function resendCard(req, res, { params, session }) {
  const idResult = validateId(params.id, "card ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const existing = getCardById(idResult.value)
  if (!existing) throw new NotFoundError("Card")

  // A draft was never delivered — there's nothing to resend. Use the normal
  // send flow instead.
  if (existing.status === THANK_YOU_CARD_STATUS.DRAFT) {
    throw new ConflictError("Card is still a draft — send it instead of resending")
  }

  // Untouched (sent, never opened AND never replied to): reset in place so the
  // SAME token link keeps working after the re-send. Once the recipient has
  // opened the envelope OR sent a reply, clone to a fresh draft (new token) so
  // the already-delivered card — and any reply keepsake — stays intact. (A
  // reply can arrive with viewed_at still NULL when the open beacon is blocked,
  // so replied_at must gate the reset too, not just viewed_at.)
  if (!existing.viewed_at && !existing.replied_at) {
    const reset = resetCardToDraft(idResult.value)
    if (!reset) throw new ConflictError("Card can no longer be reset")

    log({
      action: AUDIT_ACTIONS.THANK_YOU_CARD_RESEND,
      adminId: session?.token,
      ip: getClientIp(req),
      resourceType: "thank_you_card",
      resourceId: idResult.value,
      details: { mode: "reset" },
    })

    return sendJson(res, 200, { mode: "reset", card: getCardById(idResult.value) })
  }

  const clone = duplicateCardToDraft(idResult.value)
  if (!clone) throw new NotFoundError("Card")

  log({
    action: AUDIT_ACTIONS.THANK_YOU_CARD_RESEND,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "thank_you_card",
    resourceId: clone.id,
    details: { mode: "duplicate", sourceId: idResult.value },
  })

  return sendJson(res, 200, { mode: "duplicate", card: clone })
}
