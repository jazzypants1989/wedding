/** @file Moderation digest notifications — digest-only (owner decision 2026-07-06)
 *
 * There is deliberately no immediate-email path and no cooldown machinery. The
 * dashboard badge is the fast signal; this ~daily email is the backstop. Content
 * endpoints (guestbook POST, and later media finalize / comment POST) never call
 * this service — that decoupling is what makes Phase 3 parallelizable with 2.
 */
/** @import * as Types from './types.js' */

import * as defaultEmailService from "./email.js"
import { getModerationDigestEmail } from "./email.js"
import {
  getModerationCounts,
  getOldestPendingGuestbookAt,
} from "../db/guestbook-entries.js"
import { countUnreadReplies } from "../db/thank-you-cards.js"
import { getAppState, setAppState } from "../db/utils.js"
import { MODERATION_NOTIFY, SERVER } from "../types.js"
import { log, AUDIT_ACTIONS } from "../core/utils.js"

const DIGEST_STATE_KEY = "moderation_last_digest_at"

/** How soon after a failed send the next sweep may retry (backdated stamp). */
const RETRY_DELAY_MS = 60 * 60 * 1000

/** @type {Types.maybeSendModerationDigest} */
export async function maybeSendModerationDigest({
  email = defaultEmailService,
  recipient = SERVER.contactEmail,
} = {}) {
  if (!email.isConfigured()) return { sent: false, reason: "not_configured" }

  const counts = getModerationCounts()
  // Unread thank-you replies alone (no pending moderation items) still count
  // as "something to send" — the couple should hear about a reply even on an
  // otherwise-quiet moderation day.
  const unreadThankYouReplies = countUnreadReplies()
  if (counts.total <= 0 && unreadThankYouReplies <= 0) {
    return { sent: false, reason: "no_pending" }
  }

  const last = getAppState(DIGEST_STATE_KEY)
  if (last) {
    const sinceMs = Date.now() - new Date(last).getTime()
    if (sinceMs < MODERATION_NOTIFY.DIGEST_INTERVAL_MS) {
      return { sent: false, reason: "too_soon", counts }
    }
  }

  // Stamp the timestamp BEFORE sending so overlapping calls can't double-send.
  // A failed send re-stamps backdated (below) so the next sweep retries in
  // ~an hour — a silently dropped digest used to mean the couple got nothing
  // for a whole interval with no signal.
  setAppState(DIGEST_STATE_KEY, new Date().toISOString())

  const oldestCreatedAt = getOldestPendingGuestbookAt()
  const { subject, text, html } = getModerationDigestEmail({
    counts,
    oldestCreatedAt,
    unreadThankYouReplies,
  })

  const result = await email.sendEmail({ to: recipient, subject, text, html })

  if (!result.success) {
    const retryAt =
      Date.now() - MODERATION_NOTIFY.DIGEST_INTERVAL_MS + RETRY_DELAY_MS
    setAppState(DIGEST_STATE_KEY, new Date(retryAt).toISOString())
  }

  log({
    action: AUDIT_ACTIONS.MODERATION_EMAIL_SENT,
    resourceType: "moderation_digest",
    details: { total: counts.total, unreadThankYouReplies, success: result.success },
  })

  return {
    sent: result.success,
    reason: result.success ? "sent" : "send_failed",
    counts,
    unreadThankYouReplies,
  }
}
