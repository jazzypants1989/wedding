/** @file Session database operations */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import { sql } from "./sql.js"
import { now } from "./utils.js"
import { SESSION } from "../types.js"

/** @type {Types.hashToken} */
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

/** @type {Types.createSession} */
export function createSession() {
  // Several concurrent admin sessions (the couple on two devices, a second tab,
  // a review script) — a new login used to delete every other session, which
  // silently signed out whoever was already working. Expired rows go now; idle
  // ones are dropped on their next lookup; the cap below bounds the table.
  sql`DELETE FROM sessions WHERE expires_at < ${new Date().toISOString()}`.run()

  const token = crypto.randomBytes(32).toString("hex")
  const tokenHash = hashToken(token) // Hash before storing
  const csrf_token = crypto.randomBytes(32).toString("hex")
  const timestamp = now()
  const expires_at = new Date(Date.now() + SESSION.DURATION_MS).toISOString()

  // last_activity_at is set here in ISO form: the column default is CURRENT_TIMESTAMP
  // ('YYYY-MM-DD HH:MM:SS'), and cleanExpiredSessions compares it as a string with an
  // ISO cutoff, where a space sorts before 'T' and an unused session looked idle.
  sql`INSERT INTO sessions (token, csrf_token, expires_at, csrf_rotated_at, last_activity_at)
    VALUES (${tokenHash}, ${csrf_token}, ${expires_at}, ${timestamp}, ${timestamp})`.run()

  // Keep the MAX_CONCURRENT most recently active; the longest-idle login is the one
  // signed out, so a script's logins can't evict the session someone is using. Ties
  // (same-millisecond logins) fall to rowid, newest kept.
  sql`DELETE FROM sessions WHERE rowid NOT IN
    (SELECT rowid FROM sessions ORDER BY last_activity_at DESC, rowid DESC
     LIMIT ${SESSION.MAX_CONCURRENT})`.run()

  return { token, csrf_token, expires_at } // Return plaintext to client
}

/** @type {Types.getSession} */
export function getSession(token) {
  const tokenHash = hashToken(token)
  const session = sql`SELECT * FROM sessions WHERE token = ${tokenHash}`.get()

  if (!session) return null

  const currentTime = new Date()

  // Check absolute expiration
  if (new Date(session.expires_at) < currentTime) {
    deleteSession(token)
    return null
  }

  // Check idle timeout
  if (session.last_activity_at) {
    const lastActivity = new Date(session.last_activity_at)
    const idleMs = currentTime.getTime() - lastActivity.getTime()
    if (idleMs > SESSION.IDLE_TIMEOUT_MS) {
      deleteSession(token)
      return null
    }
  }

  return session
}

/** @type {Types.updateSessionActivity} */
export function updateSessionActivity(token) {
  const tokenHash = hashToken(token)
  sql`UPDATE sessions SET last_activity_at = ${now()} WHERE token = ${tokenHash}`.run()
}

/** @type {Types.deleteSession} */
export function deleteSession(token) {
  const tokenHash = hashToken(token)
  sql`DELETE FROM sessions WHERE token = ${tokenHash}`.run()
}

/** @type {Types.rotateCsrfToken} */
export function rotateCsrfToken(token) {
  const tokenHash = hashToken(token)
  const newCsrfToken = crypto.randomBytes(32).toString("hex")
  const timestamp = now()

  sql`UPDATE sessions SET csrf_token = ${newCsrfToken}, csrf_rotated_at = ${timestamp} WHERE token = ${tokenHash}`.run()

  return newCsrfToken
}

/** @type {Types.cleanExpiredSessions} */
export function cleanExpiredSessions() {
  const currentTime = now()
  const idleCutoff = new Date(Date.now() - SESSION.IDLE_TIMEOUT_MS).toISOString()
  sql`DELETE FROM sessions WHERE expires_at < ${currentTime} OR last_activity_at < ${idleCutoff}`.run()
}
