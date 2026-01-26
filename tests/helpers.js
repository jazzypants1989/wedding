/**
 * @file Test utilities for integration testing
 */
/** @import { StartServerFn, StopServerFn, GetTestDbFn, CreateTestGuestFn, DeleteTestGuestFn, CreateTestPetitionFn, DeleteTestPetitionFn, AddToBlocklistFn, RemoveFromBlocklistFn, AdminLoginFn, AdminFetchFn, CleanupTestDataFn } from './helpers.js' */
/** @import { ChildProcessWithoutNullStreams } from 'node:child_process' */

import { spawn } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import crypto from "node:crypto"
import { createTables, runMigrations } from "../db/schema.js"

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..")
const TEST_DB_PATH = path.join(PROJECT_ROOT, "data", "wedding.db")

// Test configuration
export const TEST_PORT = 3001
export const BASE_URL = `http://localhost:${TEST_PORT}`

/** @type {ChildProcessWithoutNullStreams | null} */
let serverProcess = null

/** @type {StartServerFn} */
export async function startServer() {
  return /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PORT: TEST_PORT.toString(),
        NODE_ENV: "test",
        // Trust localhost for X-Forwarded-For headers in tests
        TRUSTED_PROXIES: "127.0.0.1,::1,::ffff:127.0.0.1",
      }

      serverProcess = spawn("node", ["server.js"], {
        cwd: PROJECT_ROOT,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      })

      let started = false

      serverProcess.stdout.on("data", (data) => {
        const output = data.toString()
        // Server outputs "Wedding website running at..." when ready
        if (output.includes("Wedding website running") && !started) {
          started = true
          resolve()
        }
      })

      serverProcess.stderr.on("data", (data) => {
        // Ignore experimental sqlite warnings
        const output = data.toString()
        if (!output.includes("ExperimentalWarning")) {
          console.error("Server stderr:", output)
        }
      })

      serverProcess.on("error", (err) => {
        reject(new Error(`Failed to start server: ${err.message}`))
      })

      serverProcess.on("exit", (code) => {
        if (!started) {
          reject(new Error(`Server exited with code ${code} before starting`))
        }
      })

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!started && serverProcess) {
          serverProcess.kill()
          reject(new Error("Server startup timeout"))
        }
      }, 10000)
    })
  )
}

/** @type {StopServerFn} */
export async function stopServer() {
  return /** @type {Promise<void>} */ (
    new Promise((resolve) => {
      if (!serverProcess) {
        resolve()
        return
      }

      serverProcess.on("exit", () => {
        serverProcess = null
        resolve()
      })

      serverProcess.kill("SIGINT")

      // Force kill after 5 seconds
      setTimeout(() => {
        if (serverProcess) {
          serverProcess.kill("SIGKILL")
          serverProcess = null
          resolve()
        }
      }, 5000)
    })
  )
}

/** @type {GetTestDbFn} */
export function getTestDb() {
  const db = new DatabaseSync(TEST_DB_PATH)
  createTables(db)
  runMigrations(db)
  return db
}

/** @type {CreateTestGuestFn} */
export function createTestGuest(db, overrides = {}) {
  const code = overrides.invite_code || generateInviteCode()
  /** @type {import('../types.js').GuestStatusMap} */
  const status = overrides.status || "pending"
  const guest = {
    name: "Test Guest",
    email: `test-${code}@example.com`,
    phone: null,
    party_size: 2,
    invite_code: code,
    status,
    notes: null,
    ...overrides,
  }

  const stmt = db.prepare(`
    INSERT INTO guests (name, email, phone, party_size, invite_code, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    guest.name,
    guest.email,
    guest.phone,
    guest.party_size,
    guest.invite_code,
    guest.status,
    guest.notes,
  )

  return { ...guest, id: result.lastInsertRowid }
}

/** @type {DeleteTestGuestFn} */
export function deleteTestGuest(db, inviteCode) {
  // Delete RSVP first (foreign key)
  db.prepare(
    `DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE invite_code = ?)`,
  ).run(inviteCode)
  db.prepare(`DELETE FROM guests WHERE invite_code = ?`).run(inviteCode)
}

/** @type {CreateTestPetitionFn} */
export function createTestPetition(db, overrides = {}) {
  const petition = {
    name: "Test Petitioner",
    email: `petition-${Date.now()}@example.com`,
    phone: null,
    relationship: "Friend",
    message: "Please invite me!",
    status: "pending",
    ...overrides,
  }

  const stmt = db.prepare(`
    INSERT INTO petitions (name, email, phone, relationship, message, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    petition.name,
    petition.email,
    petition.phone,
    petition.relationship,
    petition.message,
    petition.status,
  )

  return { ...petition, id: result.lastInsertRowid }
}

/** @type {DeleteTestPetitionFn} */
export function deleteTestPetition(db, id) {
  db.prepare(`DELETE FROM petitions WHERE id = ?`).run(id)
}

/** @type {AddToBlocklistFn} */
export function addToBlocklist(db, overrides = {}) {
  const entry = {
    name: null,
    email: null,
    phone: null,
    reason: "Test block",
    ...overrides,
  }

  const stmt = db.prepare(`
    INSERT INTO blocklist (name, email, phone, reason)
    VALUES (?, ?, ?, ?)
  `)

  const result = stmt.run(entry.name, entry.email, entry.phone, entry.reason)
  return { ...entry, id: result.lastInsertRowid }
}

/** @type {RemoveFromBlocklistFn} */
export function removeFromBlocklist(db, id) {
  db.prepare(`DELETE FROM blocklist WHERE id = ?`).run(id)
}

/**
 * Generate a random invite code (8 alphanumeric chars)
 */
function generateInviteCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let code = ""
  const randomBytes = crypto.randomBytes(8)
  for (let i = 0; i < 8; i++) {
    code += chars[randomBytes[i] % chars.length]
  }
  return code
}

/** @type {AdminLoginFn} */
export async function adminLogin(
  password = process.env.TEST_ADMIN_PASSWORD || "testpassword",
) {
  const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  })

  if (!loginRes.ok) {
    throw new Error(`Admin login failed: ${loginRes.status}`)
  }

  // Extract cookies from response
  const cookies = loginRes.headers.getSetCookie()
  const sessionCookie = cookies.find((c) => c.startsWith("session="))
  const csrfCookie = cookies.find((c) => c.startsWith("csrf="))

  if (!sessionCookie || !csrfCookie) {
    throw new Error("Login did not return expected cookies")
  }

  // Extract csrf token value
  const csrfToken = csrfCookie.split("=")[1].split(";")[0]

  return {
    sessionCookie: sessionCookie.split(";")[0],
    csrfCookie: csrfCookie.split(";")[0],
    csrfToken,
    // Combined cookie header for requests
    cookieHeader: `${sessionCookie.split(";")[0]}; ${csrfCookie.split(";")[0]}`,
  }
}

/** @type {AdminFetchFn} */
export async function adminFetch(path, options = {}, auth) {
  const headers = {
    ...options.headers,
    "Cookie": auth.cookieHeader,
    "X-CSRF-Token": auth.csrfToken,
  }

  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  })
}

/** @type {CleanupTestDataFn} */
export function cleanupTestData(db) {
  // Delete test guests (those with test- email prefix)
  db.prepare(
    `DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE 'test-%')`,
  ).run()
  db.prepare(`DELETE FROM guests WHERE email LIKE 'test-%'`).run()

  // Delete test petitions
  db.prepare(`DELETE FROM petitions WHERE email LIKE 'petition-%'`).run()

  // Delete test blocklist entries
  db.prepare(`DELETE FROM blocklist WHERE reason = 'Test block'`).run()

  // Clear rate limits to start fresh
  try {
    db.prepare(`DELETE FROM rate_limits`).run()
  } catch (e) {
    // Table might not exist in old databases
  }
}
