/** @file Session database operations */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import { getDb, queryOne } from "./connection.js"
import { now } from "./utils.js"
import { SESSION } from "../types.js"

/** @type {Types.hashToken} */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

/** @type {Types.createSession} */
export function createSession() {
  const db = getDb()
  const token = crypto.randomBytes(32).toString("hex")
  const tokenHash = hashToken(token) // Hash before storing
  const csrf_token = crypto.randomBytes(32).toString("hex")
  const timestamp = new Date().toISOString()
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours

  const stmt = db.prepare(`
    INSERT INTO sessions (token, csrf_token, expires_at, csrf_rotated_at)
    VALUES (?, ?, ?, ?)
  `)
  stmt.run(tokenHash, csrf_token, expires_at, timestamp) // Store hash

  return { token, csrf_token, expires_at } // Return plaintext to client
}

/** @type {Types.getSession} */
export function getSession(token) {
  const tokenHash = hashToken(token)
  const session = queryOne("SELECT * FROM sessions WHERE token = ?", tokenHash)

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
  const db = getDb()
  const tokenHash = hashToken(token)
  db.prepare("UPDATE sessions SET last_activity_at = ? WHERE token = ?").run(
    now(),
    tokenHash
  )
}

/** @type {Types.deleteSession} */
export function deleteSession(token) {
  const db = getDb()
  const tokenHash = hashToken(token)
  const stmt = db.prepare("DELETE FROM sessions WHERE token = ?")
  stmt.run(tokenHash)
}

/** @type {Types.rotateCsrfToken} */
export function rotateCsrfToken(token) {
  const db = getDb()
  const tokenHash = hashToken(token)
  const newCsrfToken = crypto.randomBytes(32).toString("hex")
  const timestamp = new Date().toISOString()

  db.prepare(
    "UPDATE sessions SET csrf_token = ?, csrf_rotated_at = ? WHERE token = ?"
  ).run(newCsrfToken, timestamp, tokenHash)

  return newCsrfToken
}

/** @type {Types.cleanExpiredSessions} */
export function cleanExpiredSessions() {
  const db = getDb()
  const stmt = db.prepare("DELETE FROM sessions WHERE expires_at < ?")
  stmt.run(now())
}
