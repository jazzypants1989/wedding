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
import { getAppState, setAppState } from "../db/utils.js"
import { MODERATION_NOTIFY, SERVER } from "../types.js"
import { log, AUDIT_ACTIONS } from "../core/utils.js"

const DIGEST_STATE_KEY = "moderation_last_digest_at"

/** @type {Types.maybeSendModerationDigest} */
export async function maybeSendModerationDigest({
  email = defaultEmailService,
  recipient = SERVER.contactEmail,
} = {}) {
  if (!email.isConfigured()) return { sent: false, reason: "not_configured" }

  const counts = getModerationCounts()
  if (counts.total <= 0) return { sent: false, reason: "no_pending" }

  const last = getAppState(DIGEST_STATE_KEY)
  if (last) {
    const sinceMs = Date.now() - new Date(last).getTime()
    if (sinceMs < MODERATION_NOTIFY.DIGEST_INTERVAL_MS) {
      return { sent: false, reason: "too_soon", counts }
    }
  }

  // Stamp the timestamp BEFORE sending: if the send fails we wait until the next
  // interval rather than retrying every hour (the badge covers the gap). This is
  // deliberate per the spec.
  setAppState(DIGEST_STATE_KEY, new Date().toISOString())

  const oldestCreatedAt = getOldestPendingGuestbookAt()
  const { subject, text, html } = getModerationDigestEmail({
    counts,
    oldestCreatedAt,
  })

  const result = await email.sendEmail({ to: recipient, subject, text, html })

  log({
    action: AUDIT_ACTIONS.MODERATION_EMAIL_SENT,
    resourceType: "moderation_digest",
    details: { total: counts.total, success: result.success },
  })

  return {
    sent: result.success,
    reason: result.success ? "sent" : "send_failed",
    counts,
  }
}
