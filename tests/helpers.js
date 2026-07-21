/**
 * @file Test utilities for integration testing
 */
/** @import { StartServerFn, StopServerFn, GetTestDbFn, CreateTestGuestFn, DeleteTestGuestFn, CreateTestPetitionFn, DeleteTestPetitionFn, AddToBlocklistFn, RemoveFromBlocklistFn, AdminLoginFn, AdminFetchFn, CleanupTestDataFn, CreateTestAccountFn, CreateTestAccountSessionFn, AccountRegisterFn, AccountFetchFn } from './helpers.js' */
/** @import { ChildProcessWithoutNullStreams } from 'node:child_process' */

import { spawn } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import { createTables, runMigrations } from "../db/schema.js"

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..")

// Load .env so TEST_ADMIN_PASSWORD is available to test runner
try {
  process.loadEnvFile(path.join(PROJECT_ROOT, ".env"))
} catch {
  // .env file is optional
}

// Use a temporary database file for test isolation (never touch production DB).
// Exported so tests can derive the server's uploads dir (media-storage.js builds
// it from dirname(DATABASE_PATH)) to assert on-disk file cleanup.
export const TEST_DB_PATH = path.join(os.tmpdir(), `wedding-test-${process.pid}-${Date.now()}.db`)

// Where the spawned server writes its JSONL audit log. Exported so tests can
// assert that state-changing endpoints logged the expected action.
export const TEST_AUDIT_DIR = path.join(os.tmpdir(), `wedding-test-audit-${process.pid}`)

/**
 * Read every audit-log entry the test server has written so far, oldest first.
 * The server appends asynchronously, so callers that need an entry immediately
 * after an action should poll (record the length before, then re-read).
 * @returns {Array<Record<string, any>>}
 */
export function readAuditLog() {
  /** @type {Array<Record<string, any>>} */
  const entries = []
  let files = []
  try {
    files = fs.readdirSync(TEST_AUDIT_DIR).filter((f) => f.endsWith(".jsonl")).sort()
  } catch {
    return entries // dir not created yet
  }
  for (const file of files) {
    const text = fs.readFileSync(path.join(TEST_AUDIT_DIR, file), "utf8")
    for (const line of text.split("\n")) {
      if (line.trim()) entries.push(JSON.parse(line))
    }
  }
  return entries
}

// Test configuration. Port is overridable via TEST_SERVER_PORT so a second
// integration file (which node --test may run concurrently with api.test.js)
// can bind its own port instead of colliding on 3001. Set the env var before
// importing this module — see tests/integration/accounts.test.js.
export const TEST_PORT = Number(process.env.TEST_SERVER_PORT) || 3001
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
        DATABASE_PATH: TEST_DB_PATH,
        AUDIT_LOG_DIR: TEST_AUDIT_DIR,
        // Trust localhost for X-Forwarded-For headers in tests
        TRUSTED_PROXIES: "127.0.0.1,::1,::ffff:127.0.0.1",
      }

      serverProcess = spawn("node", ["server.js"], {
        cwd: PROJECT_ROOT,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      })

      let started = false

      // Timeout after 10 seconds
      const startupTimer = setTimeout(() => {
        if (!started && serverProcess) {
          serverProcess.kill()
          reject(new Error("Server startup timeout"))
        }
      }, 10000)

      serverProcess.stdout.on("data", (data) => {
        const output = data.toString()
        // Server outputs "Wedding website running at..." when ready
        if (output.includes("Wedding website running") && !started) {
          started = true
          clearTimeout(startupTimer)
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
        clearTimeout(startupTimer)
        serverProcess = null
        reject(new Error(`Failed to start server: ${err.message}`))
      })

      serverProcess.on("exit", (code) => {
        if (!started) {
          clearTimeout(startupTimer)
          serverProcess = null
          reject(new Error(`Server exited with code ${code} before starting`))
        }
      })
    })
  )
}

/**
 * Spawn an ADDITIONAL server process on its own port, sharing the SAME test DB +
 * audit dir as the main suite server, with extra environment overrides (e.g. a
 * configured-but-failing provider for send-failure compensation). This lets a
 * single test exercise a "configured provider that fails" path without
 * reconfiguring — and breaking — the shared suite server's other tests.
 *
 * The returned stop() kills the process but — unlike stopServer() — never
 * deletes the shared DB (the main suite still needs it).
 * @param {Record<string, string>} extraEnv
 * @param {number} port
 * @returns {Promise<{ baseUrl: string, stop: () => Promise<void> }>}
 */
export async function startAuxServer(extraEnv, port) {
  /** @type {ChildProcessWithoutNullStreams} */
  const proc = await /** @type {Promise<ChildProcessWithoutNullStreams>} */ (
    new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "test",
        DATABASE_PATH: TEST_DB_PATH,
        AUDIT_LOG_DIR: TEST_AUDIT_DIR,
        TRUSTED_PROXIES: "127.0.0.1,::1,::ffff:127.0.0.1",
        ...extraEnv,
      }
      const child = spawn("node", ["server.js"], {
        cwd: PROJECT_ROOT,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      })
      let started = false
      const timer = setTimeout(() => {
        if (!started) {
          child.kill()
          reject(new Error("Aux server startup timeout"))
        }
      }, 10000)
      child.stdout.on("data", (data) => {
        if (data.toString().includes("Wedding website running") && !started) {
          started = true
          clearTimeout(timer)
          resolve(child)
        }
      })
      child.stderr.on("data", (data) => {
        const output = data.toString()
        if (!output.includes("ExperimentalWarning")) console.error("Aux server stderr:", output)
      })
      child.on("error", (err) => {
        clearTimeout(timer)
        reject(new Error(`Failed to start aux server: ${err.message}`))
      })
      child.on("exit", (code) => {
        if (!started) {
          clearTimeout(timer)
          reject(new Error(`Aux server exited with code ${code} before starting`))
        }
      })
    })
  )

  return {
    baseUrl: `http://localhost:${port}`,
    stop: () =>
      /** @type {Promise<void>} */ (
        new Promise((resolve) => {
          const killTimer = setTimeout(() => {
            proc.kill("SIGKILL")
            resolve()
          }, 5000)
          proc.on("exit", () => {
            clearTimeout(killTimer)
            resolve()
          })
          proc.kill("SIGINT")
        })
      ),
  }
}

/** @type {StopServerFn} */
export async function stopServer() {
  await /** @type {Promise<void>} */ (
    new Promise((resolve) => {
      if (!serverProcess) {
        resolve()
        return
      }

      // Force kill after 5 seconds
      const killTimer = setTimeout(() => {
        if (serverProcess) {
          serverProcess.kill("SIGKILL")
          serverProcess = null
          resolve()
        }
      }, 5000)

      serverProcess.on("exit", () => {
        clearTimeout(killTimer)
        serverProcess = null
        resolve()
      })

      serverProcess.kill("SIGINT")
    })
  )

  // Clean up temp database files
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB_PATH + suffix)
    } catch {
      // file may not exist
    }
  }

  // Clean up temp audit log directory
  const auditDir = path.join(os.tmpdir(), `wedding-test-audit-${process.pid}`)
  try {
    fs.rmSync(auditDir, { recursive: true, force: true })
  } catch {
    // directory may not exist
  }
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
  /** @type {import('../types.js').GuestStatus} */
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

/**
 * Local copy of db/utils.js normalizeName (helpers avoid importing db modules).
 * @param {string} name
 */
function normalizeNameLocal(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .split(" ")
    .filter((w) => w !== "")
    .join(" ")
}

/**
 * Local copy of db/sessions.js hashToken (helpers avoid importing db modules).
 * @param {string} token
 */
function hashTokenLocal(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

/** @type {CreateTestAccountFn} */
export function createTestAccount(db, overrides = {}) {
  const name = overrides.name ?? "Test Account"
  const trusted = /** @type {0 | 1} */ (overrides.trusted ?? 0)
  const account = {
    guest_id: null,
    relation: null,
    contact_email: null,
    ...overrides,
    name,
    trusted,
  }
  const nameNormalized = normalizeNameLocal(account.name)

  const result = db
    .prepare(
      `INSERT INTO accounts (guest_id, name, name_normalized, relation, contact_email, trusted)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      account.guest_id,
      account.name,
      nameNormalized,
      account.relation,
      account.contact_email,
      account.trusted,
    )

  return { ...account, id: result.lastInsertRowid, name_normalized: nameNormalized }
}

/** @type {CreateTestAccountSessionFn} */
export function createTestAccountSession(db, accountId) {
  const token = crypto.randomBytes(32).toString("hex")
  const csrfToken = crypto.randomBytes(32).toString("hex")
  const tokenHash = hashTokenLocal(token)
  const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()

  db.prepare(
    `INSERT INTO account_sessions (token, account_id, csrf_token, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(tokenHash, accountId, csrfToken, expiresAt)

  return {
    token,
    csrfToken,
    cookieHeader: `guest_session=${token}; guest_csrf=${csrfToken}`,
  }
}

/** @type {AccountRegisterFn} */
export async function accountRegister(body, { ip } = {}) {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" }
  // Each caller passes a unique IP so the shared 10/h ACCOUNT_REGISTER limiter
  // (per-IP) doesn't trip when a single test file registers many accounts.
  if (ip) headers["X-Forwarded-For"] = ip

  const res = await fetch(`${BASE_URL}/api/account/register`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const data = /** @type {Record<string, unknown>} */ (await res.json())

  const cookies = res.headers.getSetCookie()
  const sessionCookie = cookies.find((c) => c.startsWith("guest_session="))
  const csrfCookie = cookies.find((c) => c.startsWith("guest_csrf="))
  const csrfToken = csrfCookie ? csrfCookie.split("=")[1].split(";")[0] : null
  const cookieHeader =
    sessionCookie && csrfCookie
      ? `${sessionCookie.split(";")[0]}; ${csrfCookie.split(";")[0]}`
      : null

  return { status: res.status, data, csrfToken, cookieHeader }
}

/** @type {AccountFetchFn} */
export async function accountFetch(path, options = {}, auth) {
  /** @type {Record<string, string>} */
  const headers = { ...options.headers }
  if (auth.cookieHeader) headers["Cookie"] = auth.cookieHeader
  if (auth.csrfToken) headers["X-CSRF-Token"] = auth.csrfToken

  return fetch(`${BASE_URL}${path}`, { ...options, headers })
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

  // Clear guest accounts, their sessions, guestbook entries, and app_state
  // (wrapped like rate_limits above so older DBs without these tables don't
  // break cleanup). Delete guestbook_entries explicitly: this helper's own
  // DatabaseSync connection doesn't enable foreign_keys, so the accounts →
  // guestbook_entries ON DELETE CASCADE would not fire here.
  try {
    db.prepare(`DELETE FROM reactions`).run()
    db.prepare(`DELETE FROM comments`).run()
    db.prepare(`DELETE FROM media`).run()
    db.prepare(`DELETE FROM guestbook_entries`).run()
    db.prepare(`DELETE FROM account_recovery_tokens`).run()
    db.prepare(`DELETE FROM account_sessions`).run()
    db.prepare(`DELETE FROM accounts`).run()
    db.prepare(`DELETE FROM app_state`).run()
  } catch (e) {
    // Tables might not exist in old databases
  }

  // Digital thank-you cards (Phase 1+): FK to guests isn't enforced on this
  // helper's own connection (no foreign_keys pragma here), so clear these
  // explicitly before/alongside the guest wipe above rather than relying on
  // ON DELETE CASCADE.
  try {
    db.prepare(`DELETE FROM thank_you_card_replies`).run()
    db.prepare(`DELETE FROM thank_you_cards`).run()
    db.prepare(`DELETE FROM gifts`).run()
  } catch (e) {
    // Tables might not exist in old databases
  }
}
