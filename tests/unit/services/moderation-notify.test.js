/**
 * @file Unit tests for the moderation digest service (digest-only).
 */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../../db/connection.js"
import { setAppState, getAppState } from "../../../db/utils.js"
import { maybeSendModerationDigest } from "../../../services/moderation-notify.js"
import { MODERATION_NOTIFY } from "../../../types.js"

const DIGEST_KEY = "moderation_last_digest_at"

/**
 * Build an email-service stub with a recorded call log and a fixed send result.
 * @param {{ configured?: boolean, sendSuccess?: boolean }} [opts]
 */
function makeEmailStub({ configured = true, sendSuccess = true } = {}) {
  /** @type {import('../../../services/types.js').EmailOptions[]} */
  const sent = []
  return {
    sent,
    isConfigured: () => configured,
    /** @param {import('../../../services/types.js').EmailOptions} opts */
    sendEmail: async (opts) => {
      sent.push(opts)
      return sendSuccess
        ? { success: /** @type {const} */ (true), id: "stub-id" }
        : { success: /** @type {const} */ (false), error: "boom" }
    },
  }
}

/** Insert an untrusted account and return its id. */
function makeAccount() {
  const result = getDb()
    .prepare(
      `INSERT INTO accounts (guest_id, name, name_normalized, trusted)
       VALUES (NULL, ?, ?, 0)`,
    )
    .run("Pending Poster", "pending poster")
  return Number(result.lastInsertRowid)
}

/**
 * Insert a guestbook entry.
 * @param {number} accountId
 * @param {string} status
 */
function makeEntry(accountId, status = "pending") {
  getDb()
    .prepare(
      `INSERT INTO guestbook_entries (account_id, message, status) VALUES (?, ?, ?)`,
    )
    .run(accountId, "hello world", status)
}

function clearData() {
  getDb().prepare("DELETE FROM guestbook_entries").run()
  getDb().prepare("DELETE FROM accounts").run()
  getDb().prepare("DELETE FROM app_state").run()
}

describe("maybeSendModerationDigest", () => {
  before(() => {
    init()
  })

  beforeEach(() => {
    clearData()
  })

  after(() => {
    clearData()
    close()
  })

  it("does not send when email is not configured", async () => {
    const account = makeAccount()
    makeEntry(account, "pending")
    const email = makeEmailStub({ configured: false })

    const result = await maybeSendModerationDigest({ email })

    assert.strictEqual(result.sent, false)
    assert.strictEqual(result.reason, "not_configured")
    assert.strictEqual(email.sent.length, 0)
  })

  it("does not send when the pending count is 0", async () => {
    const account = makeAccount()
    makeEntry(account, "approved") // approved doesn't count as pending
    const email = makeEmailStub()

    const result = await maybeSendModerationDigest({ email })

    assert.strictEqual(result.sent, false)
    assert.strictEqual(result.reason, "no_pending")
    assert.strictEqual(email.sent.length, 0)
    assert.strictEqual(getAppState(DIGEST_KEY), null, "timestamp untouched")
  })

  it("does not send when the last digest was < 22h ago", async () => {
    const account = makeAccount()
    makeEntry(account, "pending")
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago
    setAppState(DIGEST_KEY, recent)
    const email = makeEmailStub()

    const result = await maybeSendModerationDigest({ email })

    assert.strictEqual(result.sent, false)
    assert.strictEqual(result.reason, "too_soon")
    assert.strictEqual(email.sent.length, 0)
    assert.strictEqual(getAppState(DIGEST_KEY), recent, "timestamp not advanced")
  })

  it("sends and updates the timestamp when configured, pending, and past the interval", async () => {
    const account = makeAccount()
    makeEntry(account, "pending")
    makeEntry(account, "pending")
    const old = new Date(
      Date.now() - MODERATION_NOTIFY.DIGEST_INTERVAL_MS - 60 * 60 * 1000,
    ).toISOString()
    setAppState(DIGEST_KEY, old)
    const email = makeEmailStub({ sendSuccess: true })

    const before = Date.now()
    const result = await maybeSendModerationDigest({ email })

    assert.strictEqual(result.sent, true)
    assert.strictEqual(result.reason, "sent")
    assert.strictEqual(email.sent.length, 1)
    assert.ok(email.sent[0].subject.includes("2"), "subject reflects 2 pending items")

    const stamped = getAppState(DIGEST_KEY)
    assert.ok(stamped && new Date(stamped).getTime() >= before, "timestamp advanced")
  })

  it("still advances the timestamp when the send fails (retries next-day, not next-hour)", async () => {
    const account = makeAccount()
    makeEntry(account, "pending")
    const email = makeEmailStub({ sendSuccess: false })

    const before = Date.now()
    const result = await maybeSendModerationDigest({ email })

    assert.strictEqual(result.sent, false)
    assert.strictEqual(result.reason, "send_failed")
    assert.strictEqual(email.sent.length, 1, "a send was attempted")

    const stamped = getAppState(DIGEST_KEY)
    assert.ok(
      stamped && new Date(stamped).getTime() >= before,
      "timestamp is set even though the send failed",
    )
  })
})
