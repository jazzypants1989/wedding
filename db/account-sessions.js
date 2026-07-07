/** @file Guest account session database operations (template: db/sessions.js) */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import { sql } from "./sql.js"
import { hashToken } from "./sessions.js"
import { now } from "./utils.js"
import { GUEST_SESSION } from "../types.js"

/** @type {Types.createAccountSession} */
export function createAccountSession(accountId) {
  const token = crypto.randomBytes(32).toString("hex")
  const tokenHash = hashToken(token) // Hash before storing
  const csrf_token = crypto.randomBytes(32).toString("hex")
  const timestamp = now()
  const expires_at = new Date(Date.now() + GUEST_SESSION.DURATION_MS).toISOString()

  sql`INSERT INTO account_sessions (token, account_id, csrf_token, expires_at, csrf_rotated_at)
    VALUES (${tokenHash}, ${accountId}, ${csrf_token}, ${expires_at}, ${timestamp})`.run()

  // Unlike the single-admin sessions table, guests keep N concurrent sessions
  // (multiple devices); cap per account, trimming the oldest. The rowid tiebreak
  // matters: created_at has second granularity, and on ties SQLite's pick is
  // arbitrary — without it this can delete the session just created.
  sql`DELETE FROM account_sessions WHERE account_id = ${accountId} AND token NOT IN (
    SELECT token FROM account_sessions WHERE account_id = ${accountId}
    ORDER BY created_at DESC, rowid DESC LIMIT ${GUEST_SESSION.MAX_SESSIONS_PER_ACCOUNT}
  )`.run()

  return { token, csrf_token, expires_at } // Return plaintext to client
}

/** @type {Types.getAccountSession} */
export function getAccountSession(token) {
  const tokenHash = hashToken(token)
  // Join accounts so a soft-deleted account instantly invalidates its sessions.
  const session = sql`SELECT s.*, a.name, a.trusted, a.guest_id
    FROM account_sessions s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.token = ${tokenHash} AND a.deleted_at IS NULL`.get()

  if (!session) return null

  const currentTime = new Date()

  // Check absolute expiration
  if (new Date(session.expires_at) < currentTime) {
    deleteAccountSession(token)
    return null
  }

  // Check idle timeout
  if (session.last_activity_at) {
    const lastActivity = new Date(session.last_activity_at)
    const idleMs = currentTime.getTime() - lastActivity.getTime()
    if (idleMs > GUEST_SESSION.IDLE_TIMEOUT_MS) {
      deleteAccountSession(token)
      return null
    }
  }

  return session
}

/** @type {Types.updateAccountSessionActivity} */
export function updateAccountSessionActivity(token) {
  const tokenHash = hashToken(token)
  sql`UPDATE account_sessions SET last_activity_at = ${now()} WHERE token = ${tokenHash}`.run()
}

/** @type {Types.deleteAccountSession} */
export function deleteAccountSession(token) {
  const tokenHash = hashToken(token)
  sql`DELETE FROM account_sessions WHERE token = ${tokenHash}`.run()
}

/** @type {Types.rotateAccountCsrfToken} */
export function rotateAccountCsrfToken(token) {
  const tokenHash = hashToken(token)
  const newCsrfToken = crypto.randomBytes(32).toString("hex")
  const timestamp = now()

  sql`UPDATE account_sessions SET csrf_token = ${newCsrfToken}, csrf_rotated_at = ${timestamp} WHERE token = ${tokenHash}`.run()

  return newCsrfToken
}

/** @type {Types.cleanExpiredAccountSessions} */
export function cleanExpiredAccountSessions() {
  const currentTime = now()
  const idleCutoff = new Date(Date.now() - GUEST_SESSION.IDLE_TIMEOUT_MS).toISOString()
  sql`DELETE FROM account_sessions WHERE expires_at < ${currentTime} OR last_activity_at < ${idleCutoff}`.run()
}
