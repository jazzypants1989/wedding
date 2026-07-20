/** @file Resend Email service using native https */
/** @import * as Types from './types.js' */

import https from "node:https"
import { escapeHtml } from "../core/utils.js"
import { BRAND, SERVER } from "../types.js"
import { getWeddingFacts, getEmailSubjects } from "../core/wedding-facts.js"
import { withRetry, isRetryableError } from "./retry.js"
import { makeServiceRequest } from "./http-client.js"

const API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || "wedding@example.com"

/** @type {Types.HttpClient} */
const defaultHttpClient = {
  request(options, callback) {
    return https.request(options, callback)
  },
}

/** @type {Types.createEmailService} */
function createEmailService(httpClient = defaultHttpClient) {
  function isConfigured() {
    return !!API_KEY
  }

  /** @type {Types.sendEmailRequest} */
  function sendEmailRequest({ to, subject, text, html }) {
    const postData = JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      text,
      html: html || undefined,
    })

    const options = {
      hostname: "api.resend.com",
      port: 443,
      path: "/emails",
      method: "POST",
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        "Authorization": `Bearer ${API_KEY}`,
      },
    }

    return makeServiceRequest(httpClient, options, postData).then((result) => {
      if (result.success) {
        return { success: true, id: /** @type {string | undefined} */ (result.data?.id) }
      }
      return { success: false, error: result.error }
    })
  }

  /** @type {Types.sendEmail} */
  async function sendEmail({ to, subject, text, html }) {
    if (!isConfigured()) {
      return { success: false, error: "Resend not configured" }
    }

    return withRetry(() => sendEmailRequest({ to, subject, text, html }), {
      maxRetries: 3,
      baseDelayMs: 1000,
    })
  }

  return {
    isConfigured,
    sendEmail,
  }
}

const defaultService = createEmailService()

/** @type {Types.getDefaultInviteEmail} */
function getDefaultInviteEmail(guestName, inviteUrl) {
  const { coupleNames, coupleFirstNames } = getWeddingFacts()
  const subject = getEmailSubjects().invite

  const text = `Hi ${guestName}!

You're invited to ${coupleNames}'s wedding!

Please RSVP by visiting: ${inviteUrl}

We can't wait to celebrate with you!

Love,
${coupleFirstNames}`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Georgia, serif; color: ${
      BRAND.PRIMARY_COLOR
    }; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 24px; margin-bottom: 20px; }
    p { line-height: 1.6; margin-bottom: 16px; }
    .btn { display: inline-block; background: ${
      BRAND.PRIMARY_COLOR
    }; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
    .footer { margin-top: 40px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <h1>You're Invited!</h1>
  <p>Hi ${escapeHtml(guestName)},</p>
  <p>You're invited to ${escapeHtml(coupleNames)}'s wedding!</p>
  <p><a href="${escapeHtml(inviteUrl)}" class="btn">RSVP Now</a></p>
  <p>Or copy this link: ${escapeHtml(inviteUrl)}</p>
  <p>We can't wait to celebrate with you!</p>
  <p class="footer">Love,<br>${escapeHtml(coupleFirstNames)}</p>
</body>
</html>`

  return { subject, text, html }
}

/** @type {Types.getThankYouCardEmail} */
function getThankYouCardEmail(guestName, cardUrl) {
  const { coupleFirstNames } = getWeddingFacts()
  const subject = getEmailSubjects().thankYou

  const text = `Hi ${guestName},

We wanted to say thank you — it means so much to us. We put together a little
keepsake for you:

${cardUrl}

With so much love,
${coupleFirstNames}`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Georgia, serif; color: ${
      BRAND.PRIMARY_COLOR
    }; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 24px; margin-bottom: 20px; }
    p { line-height: 1.6; margin-bottom: 16px; }
    .btn { display: inline-block; background: ${
      BRAND.PRIMARY_COLOR
    }; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
    .footer { margin-top: 40px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <h1>A little thank-you 💌</h1>
  <p>Hi ${escapeHtml(guestName)},</p>
  <p>We wanted to say thank you — it means so much to us. We put together a little keepsake for you.</p>
  <p><a href="${escapeHtml(cardUrl)}" class="btn">Open your card</a></p>
  <p>Or copy this link: ${escapeHtml(cardUrl)}</p>
  <p class="footer">With so much love,<br>${escapeHtml(coupleFirstNames)}</p>
</body>
</html>`

  return { subject, text, html }
}

/** Display glyphs for the REACTION_EMOJI keys (email-friendly). */
const REPLY_EMOJI_GLYPHS = Object.freeze({
  heart: "❤️",
  clap: "👏",
  laugh: "😄",
  heart_eyes: "😍",
  cheers: "🥂",
  fire: "🔥",
})

/** @type {Types.getThankYouReplyPingEmail} */
function getThankYouReplyPingEmail({ guestName, emoji, message }) {
  const { coupleFirstNames } = getWeddingFacts()
  const adminUrl = `${SERVER.baseUrl}/admin`
  const glyph = emoji ? REPLY_EMOJI_GLYPHS[/** @type {keyof typeof REPLY_EMOJI_GLYPHS} */ (emoji)] : ""

  // Short warm preview of the reply message (couples get the full text in the
  // dashboard); cap so a long note doesn't bloat the notification.
  const preview =
    message && message.length > 140 ? message.slice(0, 140) + "…" : message || ""

  const subject = `💌 ${guestName} just replied to your thank-you card`

  const reactionLine = glyph ? `They sent ${glyph}` : "They sent a reply"
  const messageLine = preview ? `\n\n“${preview}”` : ""

  const text = `Hi ${coupleFirstNames},

${guestName} just replied to your thank-you card. ${reactionLine}.${messageLine}

See it in your dashboard: ${adminUrl}`

  const htmlPreview = preview
    ? `<blockquote style="margin:16px 0;padding-left:16px;border-left:3px solid ${BRAND.PRIMARY_COLOR};color:#444;">${escapeHtml(preview)}</blockquote>`
    : ""

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Georgia, serif; color: ${BRAND.PRIMARY_COLOR}; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 22px; margin-bottom: 16px; }
    p { line-height: 1.6; margin-bottom: 16px; }
    .btn { display: inline-block; background: ${BRAND.PRIMARY_COLOR}; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
    .footer { margin-top: 40px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <h1>💌 A reply just landed</h1>
  <p>Hi ${escapeHtml(coupleFirstNames)},</p>
  <p>${escapeHtml(guestName)} just replied to your thank-you card. ${escapeHtml(reactionLine)}.</p>${htmlPreview}
  <p><a href="${escapeHtml(adminUrl)}" class="btn">See the reply</a></p>
  <p class="footer">You're receiving this because instant reply pings are on for your wedding site.</p>
</body>
</html>`

  return { subject, text, html }
}

/**
 * Human-readable age of the oldest pending item, e.g. "3 days" or "2 hours".
 * @param {string | null} iso
 * @returns {string}
 */
function formatAge(iso) {
  if (!iso) return "some time"
  const ms = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours < 1) return "less than an hour"
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`
  const days = Math.floor(hours / 24)
  return days === 1 ? "1 day" : `${days} days`
}

/** @type {Types.getModerationDigestEmail} */
function getModerationDigestEmail({ counts, oldestCreatedAt, unreadThankYouReplies = 0 }) {
  // Unread thank-you replies are NOT "awaiting review" (nothing to moderate —
  // just unread), so they get their own line + CTA rather than being folded
  // into the moderation count/subject. They still ride the same ~daily digest
  // so the couple gets one email, not two. See services/moderation-notify.js.
  const reviewTotal = counts.total
  const noun = reviewTotal === 1 ? "item" : "items"
  const replyNoun = unreadThankYouReplies === 1 ? "reply" : "replies"
  const adminUrl = `${SERVER.baseUrl}/admin`
  const repliesUrl = `${SERVER.baseUrl}/admin#thankyous`
  const age = formatAge(oldestCreatedAt)

  // Subject reflects both signals without conflating the counts: the review
  // number is moderation-only; replies are called out separately.
  let subject
  if (reviewTotal > 0 && unreadThankYouReplies > 0) {
    subject = `Wedding site: ${reviewTotal} ${noun} to review + ${unreadThankYouReplies} card ${replyNoun} 💌`
  } else if (reviewTotal > 0) {
    subject = `Wedding site: ${reviewTotal} ${noun} awaiting review`
  } else {
    subject = `Wedding site: ${unreadThankYouReplies} new card ${replyNoun} 💌`
  }

  /** @type {string[]} */
  const rows = []
  if (counts.guestbook > 0) rows.push(`Guestbook messages: ${counts.guestbook}`)
  if (counts.media > 0) rows.push(`Photos & videos: ${counts.media}`)
  if (counts.comments > 0) rows.push(`Comments: ${counts.comments}`)

  const { coupleFirstNames } = getWeddingFacts()

  // Reply line (its own section, separate from the moderation queue).
  const replyLine =
    unreadThankYouReplies > 0
      ? `${unreadThankYouReplies} new card ${replyNoun} 💌`
      : null

  /** @type {string[]} */
  const textParts = [`Hi ${coupleFirstNames},`, ""]
  if (reviewTotal > 0) {
    textParts.push(
      `You have ${reviewTotal} ${noun} awaiting review on your wedding site.`,
      "",
      rows.join("\n"),
      "",
      `The oldest has been waiting ${age}.`,
      "",
      `Review them here: ${adminUrl}`,
    )
  }
  if (replyLine) {
    if (reviewTotal > 0) textParts.push("")
    textParts.push(replyLine, "", `See your replies here: ${repliesUrl}`)
  }
  const text = textParts.join("\n")

  const listHtml = rows
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("\n      ")

  // Heading leads with whichever signal is present (moderation first if any).
  const heading =
    reviewTotal > 0
      ? `${escapeHtml(String(reviewTotal))} ${noun} awaiting review`
      : `${escapeHtml(String(unreadThankYouReplies))} new card ${replyNoun} 💌`

  const moderationBlock =
    reviewTotal > 0
      ? `
  <ul>
      ${listHtml}
  </ul>
  <p>The oldest has been waiting ${escapeHtml(age)}.</p>
  <p><a href="${escapeHtml(adminUrl)}" class="btn">Review now</a></p>`
      : ""

  const replyBlock = replyLine
    ? `
  <p>${escapeHtml(replyLine)}</p>
  <p><a href="${escapeHtml(repliesUrl)}" class="btn">See replies</a></p>`
    : ""

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Georgia, serif; color: ${BRAND.PRIMARY_COLOR}; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 22px; margin-bottom: 16px; }
    p { line-height: 1.6; margin-bottom: 16px; }
    ul { line-height: 1.8; margin-bottom: 16px; }
    .btn { display: inline-block; background: ${BRAND.PRIMARY_COLOR}; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
    .footer { margin-top: 40px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <h1>${heading}</h1>
  <p>Hi ${escapeHtml(coupleFirstNames)},</p>${moderationBlock}${replyBlock}
  <p class="footer">You're receiving this because there are items pending on your wedding site.</p>
</body>
</html>`

  return { subject, text, html }
}

const { isConfigured, sendEmail } = defaultService
export {
  createEmailService,
  isConfigured,
  sendEmail,
  getDefaultInviteEmail,
  getModerationDigestEmail,
  getThankYouCardEmail,
  getThankYouReplyPingEmail,
  isRetryableError,
}
