/** @file Core Utilities for route handlers */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import path from "node:path"

/** @type {Types.escapeHtml} */
export function escapeHtml(str) {
  if (!str) return ""
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const LOG_DIR =
  process.env.AUDIT_LOG_DIR ||
  path.resolve(import.meta.dirname, "../data/audit")
const RETENTION_DAYS = 30

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 })
  }
}

function getLogFilename() {
  const date = new Date().toISOString().split("T")[0]
  return path.join(LOG_DIR, date + ".jsonl")
}

/** @type {Types.cleanOldLogs} */
export function cleanOldLogs() {
  ensureLogDir()

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000

  try {
    const files = fs.readdirSync(LOG_DIR)
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue

      const dateStr = file.slice(0, 10) // YYYY-MM-DD (10 characters)
      const fileDate = new Date(dateStr + "T00:00:00Z").getTime()

      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(LOG_DIR, file))
        console.log("Deleted old audit log:", file)
      }
    }
  } catch (err) {
    console.error(
      "Error cleaning old audit logs:",
      err instanceof Error ? err.message : String(err),
    )
  }
}

/**
 * Fold an admin session identifier down to the prefix worth writing down.
 *
 * What a handler receives as `session.token` is the sessions ROW's token column
 * (`core/auth.js`'s `withAdmin` passes the row through), and `db/sessions.js`
 * stores the SHA-256 hash of the cookie value there — so this is a hash, NOT
 * the plaintext bearer token, and holding it does not let anyone authenticate.
 * The point of truncating is therefore not credential leakage:
 *
 *  - it is the primary key of the `sessions` table, and the only thing an actor
 *    field needs is to tell two admins' actions apart, which 8 chars does;
 *  - the audit log has always truncated to 8 (`buildLogEntry` below), and having
 *    the durable columns store 64 meant "the actor" was two different values
 *    depending on where you read it;
 *  - `people.created_by` and `face_identities.confirmed_by` outlive the log's
 *    30-day retention, and Phase 9's hand-off export carries the people rows to
 *    another machine, where a session key from this machine means nothing.
 *
 * One definition, used by both the log and the durable columns.
 *
 * @type {Types.actorId}
 */
export function actorId(token) {
  return token ? token.slice(0, 8) : null
}

/** @param {Types.AuditEvent} event */
function buildLogEntry({ action, adminId, ip, resourceType, resourceId, details }) {
  return {
    timestamp: new Date().toISOString(),
    action,
    adminId: actorId(adminId),
    ip: ip || null,
    resourceType: resourceType || null,
    resourceId: resourceId || null,
    details: details || null,
  }
}

/** @param {string} data */
function appendLog(data) {
  fs.appendFile(getLogFilename(), data, (err) => {
    if (err) {
      console.error("Failed to write audit log:", err.message)
    }
  })
}

/** @type {Types.log} */
export function log(event) {
  ensureLogDir()
  appendLog(JSON.stringify(buildLogEntry(event)) + "\n")
}

/** @type {Types.logBatch} */
export function logBatch(events) {
  if (events.length === 0) return
  ensureLogDir()
  // One append for the whole batch — a 5000-item approve-all used to fire 5000
  // separate appendFile opens against the same daily file.
  appendLog(events.map((e) => JSON.stringify(buildLogEntry(e)) + "\n").join(""))
}

export const AUDIT_ACTIONS = Object.freeze({
  LOGIN: "LOGIN",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGOUT: "LOGOUT",
  GUEST_CREATE: "GUEST_CREATE",
  GUEST_UPDATE: "GUEST_UPDATE",
  GUEST_DELETE: "GUEST_DELETE",
  GUEST_RESTORE: "GUEST_RESTORE",
  GUEST_IMPORT: "GUEST_IMPORT",
  GUEST_EXPORT: "GUEST_EXPORT",
  PETITION_APPROVE: "PETITION_APPROVE",
  PETITION_DENY: "PETITION_DENY",
  PETITION_CREATE: "PETITION_CREATE",
  BLOCKLIST_ADD: "BLOCKLIST_ADD",
  BLOCKLIST_REMOVE: "BLOCKLIST_REMOVE",
  INVITE_SEND: "INVITE_SEND",
  INVITE_SEND_FAILED: "INVITE_SEND_FAILED",
  MANUAL_SMS_MARK: "MANUAL_SMS_MARK",
  RSVP_SUBMIT: "RSVP_SUBMIT",
  CSRF_FAILURE: "CSRF_FAILURE",
  ACCOUNT_REGISTER: "ACCOUNT_REGISTER",
  ACCOUNT_LOGIN: "ACCOUNT_LOGIN",
  ACCOUNT_LOGOUT: "ACCOUNT_LOGOUT",
  GUESTBOOK_CREATE: "GUESTBOOK_CREATE",
  GUESTBOOK_DELETE: "GUESTBOOK_DELETE",
  GUESTBOOK_PIN: "GUESTBOOK_PIN",
  GUESTBOOK_UNPIN: "GUESTBOOK_UNPIN",
  COMMENT_CREATE: "COMMENT_CREATE",
  COMMENT_DELETE: "COMMENT_DELETE",
  MEDIA_CREATE: "MEDIA_CREATE",
  MEDIA_FINALIZE: "MEDIA_FINALIZE",
  MEDIA_UPDATE: "MEDIA_UPDATE",
  MEDIA_DELETE: "MEDIA_DELETE",
  MODERATION_APPROVE: "MODERATION_APPROVE",
  MODERATION_REJECT: "MODERATION_REJECT",
  MODERATION_HIDE: "MODERATION_HIDE",
  MODERATION_UNHIDE: "MODERATION_UNHIDE",
  MODERATION_UNDO: "MODERATION_UNDO",
  MODERATION_EMAIL_SENT: "MODERATION_EMAIL_SENT",
  ACCOUNT_TRUST: "ACCOUNT_TRUST",
  ACCOUNT_UNTRUST: "ACCOUNT_UNTRUST",
  ACCOUNT_DELETE: "ACCOUNT_DELETE",
  MEDIA_REORDER: "MEDIA_REORDER",
  MEDIA_PROMOTE: "MEDIA_PROMOTE",
  ACCOUNT_RECOVER_REQUEST: "ACCOUNT_RECOVER_REQUEST",
  ACCOUNT_RECOVER_LOGIN: "ACCOUNT_RECOVER_LOGIN",
  SITE_CONTENT_UPDATE: "SITE_CONTENT_UPDATE",
  SITE_CONTENT_RESET: "SITE_CONTENT_RESET",
  EFFECT_CONFIG_UPDATE: "EFFECT_CONFIG_UPDATE",
  EFFECT_CONFIG_RESET: "EFFECT_CONFIG_RESET",
  SETUP_COMPLETE: "SETUP_COMPLETE",
  SETUP_FAILED: "SETUP_FAILED",
  GIFT_CREATE: "GIFT_CREATE",
  GIFT_UPDATE: "GIFT_UPDATE",
  GIFT_DELETE: "GIFT_DELETE",
  GIFT_PHYSICAL_TOGGLE: "GIFT_PHYSICAL_TOGGLE",
  GIFT_EXPORT: "GIFT_EXPORT",
  THANK_YOU_CARD_EXPORT: "THANK_YOU_CARD_EXPORT",
  THANK_YOU_CARD_CREATE: "THANK_YOU_CARD_CREATE",
  THANK_YOU_CARD_UPDATE: "THANK_YOU_CARD_UPDATE",
  THANK_YOU_CARD_DELETE: "THANK_YOU_CARD_DELETE",
  THANK_YOU_CARD_SEND: "THANK_YOU_CARD_SEND",
  THANK_YOU_CARD_RESEND: "THANK_YOU_CARD_RESEND",
  THANK_YOU_REPLY: "THANK_YOU_REPLY",
  THANK_YOU_REPLY_CLEAR: "THANK_YOU_REPLY_CLEAR",
  THANK_YOU_REPLY_PING: "THANK_YOU_REPLY_PING",
})
