/** @file Resend Email service using native https */
/** @import * as Types from './types.js' */

import https from "node:https"
import { escapeHtml } from "../core/utils.js"
import { WEDDING, EMAIL_SUBJECTS, BRAND } from "../types.js"
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
  const subject = EMAIL_SUBJECTS.INVITE

  const text = `Hi ${guestName}!

You're invited to ${WEDDING.COUPLE_NAMES}'s wedding!

Please RSVP by visiting: ${inviteUrl}

We can't wait to celebrate with you!

Love,
${WEDDING.COUPLE_FIRST_NAMES}`

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
  <p>You're invited to ${escapeHtml(WEDDING.COUPLE_NAMES)}'s wedding!</p>
  <p><a href="${escapeHtml(inviteUrl)}" class="btn">RSVP Now</a></p>
  <p>Or copy this link: ${escapeHtml(inviteUrl)}</p>
  <p>We can't wait to celebrate with you!</p>
  <p class="footer">Love,<br>${escapeHtml(WEDDING.COUPLE_FIRST_NAMES)}</p>
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
  isRetryableError,
}
