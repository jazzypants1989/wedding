/** @file Twilio SMS service using native https */
/** @import * as Types from './types.js' */

import https from "node:https"
import { WEDDING } from "../types.js"
import { withRetry, isRetryableError } from "./retry.js"

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
      timeout: 30000, // 30 second timeout
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        "Authorization":
          "Basic " +
          Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64"),
      },
    }

    return new Promise((resolve) => {
      const req = httpClient.request(options, (res) => {
        let data = ""
        res.on("data", (/** @type {string} */ chunk) => {
          data += chunk
        })
        res.on("end", () => {
          try {
            const json = JSON.parse(data)
            const statusCode = res.statusCode ?? 0
            if (statusCode >= 200 && statusCode < 300) {
              resolve({ success: true, sid: json.sid })
            } else {
              resolve({
                success: false,
                error:
                  json.message || json.error_message || `HTTP ${statusCode}`,
              })
            }
          } catch (e) {
            resolve({
              success: false,
              error: `Parse error: ${
                e instanceof Error ? e.message : String(e)
              }`,
            })
          }
        })
      })

      req.on("timeout", () => {
        req.destroy()
        resolve({ success: false, error: "Request timed out" })
      })

      req.on("error", (/** @type {Error} */ e) => {
        resolve({ success: false, error: e.message })
      })

      req.write(postData)
      req.end()
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
  return `Hi ${guestName}! You're invited to ${WEDDING.COUPLE_NAMES}'s wedding! Please RSVP at: ${inviteUrl}`
}

const { isConfigured, sendSMS } = defaultService
export {
  createSMSService,
  isConfigured,
  sendSMS,
  getDefaultInviteMessage,
  isRetryableError,
}
