/**
 * @file Unit tests for account recovery tokens (Phase 6): single-use redemption
 * and expiry enforcement in consumeRecoveryToken.
 */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import crypto from "node:crypto"
import { init, close, getDb } from "../../../db/connection.js"
import {
  createRecoveryToken,
  consumeRecoveryToken,
} from "../../../db/account-recovery.js"

/** @param {string} token */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

/** Insert an account directly and return its id. @param {string} [name] */
function makeAccount(name = "Recover Tester") {
  const result = getDb()
    .prepare(
      `INSERT INTO accounts (guest_id, name, name_normalized, trusted)
       VALUES (?, ?, ?, ?)`,
    )
    .run(null, name, name.toLowerCase(), 0)
  return Number(result.lastInsertRowid)
}

/** @param {number} msFromNow */
function iso(msFromNow) {
  return new Date(Date.now() + msFromNow).toISOString()
}

function clearData() {
  getDb().prepare("DELETE FROM account_recovery_tokens").run()
  getDb().prepare("DELETE FROM accounts").run()
}

describe("db/account-recovery", () => {
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

  it("stores only the hash, not the plaintext", () => {
    const accountId = makeAccount()
    const token = crypto.randomBytes(32).toString("hex")
    createRecoveryToken(accountId, hashToken(token), iso(60 * 60 * 1000))

    const row = /** @type {any} */ (
      getDb()
        .prepare(`SELECT token_hash FROM account_recovery_tokens WHERE account_id = ?`)
        .get(accountId)
    )
    assert.strictEqual(row.token_hash, hashToken(token))
    assert.notStrictEqual(row.token_hash, token)
  })

  it("consumes a valid token once, returning its account_id", () => {
    const accountId = makeAccount()
    const token = crypto.randomBytes(32).toString("hex")
    createRecoveryToken(accountId, hashToken(token), iso(60 * 60 * 1000))

    assert.strictEqual(consumeRecoveryToken(hashToken(token)), accountId)
  })

  it("is single-use: a second consume returns null", () => {
    const accountId = makeAccount()
    const token = crypto.randomBytes(32).toString("hex")
    createRecoveryToken(accountId, hashToken(token), iso(60 * 60 * 1000))

    assert.strictEqual(consumeRecoveryToken(hashToken(token)), accountId)
    assert.strictEqual(consumeRecoveryToken(hashToken(token)), null)
  })

  it("rejects an expired token (returns null, leaves it unused)", () => {
    const accountId = makeAccount()
    const token = crypto.randomBytes(32).toString("hex")
    createRecoveryToken(accountId, hashToken(token), iso(-1000)) // already expired

    assert.strictEqual(consumeRecoveryToken(hashToken(token)), null)
    const row = /** @type {any} */ (
      getDb()
        .prepare(`SELECT used_at FROM account_recovery_tokens WHERE account_id = ?`)
        .get(accountId)
    )
    assert.strictEqual(row.used_at, null, "an expired token is never marked used")
  })

  it("returns null for an unknown token", () => {
    assert.strictEqual(consumeRecoveryToken(hashToken("never-issued")), null)
  })
})
