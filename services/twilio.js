/** @file Twilio SMS service using native https */
/** @import * as Types from './types.js' */

import https from "node:https"
import { getWeddingFacts } from "../core/wedding-facts.js"
import { withRetry, isRetryableError } from "./retry.js"
import { makeServiceRequest } from "./http-client.js"

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER

/** @type {Types.HttpClient} */
const defaultHttpClient = {
  request(options, callback) {
    return https.request(options, callback)
  },
}

/** @type {Types.createSMSService} */
function createSMSService(httpClient = defaultHttpClient) {
  function isConfigured() {
    return !!(ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER)
  }

  /** @type {Types.sendSMSRequest} */
  function sendSMSRequest(to, body) {
    const postData = new URLSearchParams({
      To: to,
      From: FROM_NUMBER ?? "",
      Body: body,
    }).toString()

    const options = {
      hostname: "api.twilio.com",
      port: 443,
      path: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      method: "POST",
      timeout: 30000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        "Authorization":
          "Basic " +
          Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64"),
      },
    }

    return makeServiceRequest(httpClient, options, postData).then((result) => {
      if (result.success) {
        return { success: true, sid: /** @type {string | undefined} */ (result.data?.sid) }
      }
      return { success: false, error: result.error }
    })
  }

  /** @type {Types.sendSMS} */
  async function sendSMS(to, body) {
    if (!isConfigured()) {
      return { success: false, error: "Twilio not configured" }
    }

    return withRetry(() => sendSMSRequest(to, body), {
      maxRetries: 3,
      baseDelayMs: 1000,
    })
  }

  return {
    isConfigured,
    sendSMS,
  }
}

const defaultService = createSMSService()

/** @type {Types.getDefaultInviteMessage} */
function getDefaultInviteMessage(guestName, inviteUrl) {
  return `Hi ${guestName}! You're invited to ${getWeddingFacts().coupleNames}'s wedding! Please RSVP at: ${inviteUrl}`
}

/** @type {Types.getDefaultThankYouMessage} */
function getDefaultThankYouMessage(guestName, cardUrl) {
  return `Hi ${guestName}! ${getWeddingFacts().coupleNames} left you a little thank-you: ${cardUrl}`
}

const { isConfigured, sendSMS } = defaultService
export {
  createSMSService,
  isConfigured,
  sendSMS,
  getDefaultInviteMessage,
  getDefaultThankYouMessage,
  isRetryableError,
}
