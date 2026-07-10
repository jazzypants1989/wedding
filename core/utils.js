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

/** @type {Types.log} */
export function log({
  action,
  adminId,
  ip,
  resourceType,
  resourceId,
  details,
}) {
  ensureLogDir()

  const entry = {
    timestamp: new Date().toISOString(),
    action,
    // Store only an 8-char prefix of the session token: enough to correlate an
    // admin's actions within the log without persisting a full, still-valid
    // session token to disk (the audit log is retained 30 days).
    adminId: adminId ? adminId.slice(0, 8) : null,
    ip: ip || null,
    resourceType: resourceType || null,
    resourceId: resourceId || null,
    details: details || null,
  }

  const line = JSON.stringify(entry) + "\n"

  fs.appendFile(getLogFilename(), line, (err) => {
    if (err) {
      console.error("Failed to write audit log:", err.message)
    }
  })
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
  MODERATION_EMAIL_SENT: "MODERATION_EMAIL_SENT",
  ACCOUNT_TRUST: "ACCOUNT_TRUST",
  ACCOUNT_UNTRUST: "ACCOUNT_UNTRUST",
  ACCOUNT_DELETE: "ACCOUNT_DELETE",
  MEDIA_REORDER: "MEDIA_REORDER",
  MEDIA_PROMOTE: "MEDIA_PROMOTE",
  ACCOUNT_RECOVER_REQUEST: "ACCOUNT_RECOVER_REQUEST",
  ACCOUNT_RECOVER_LOGIN: "ACCOUNT_RECOVER_LOGIN",
})
