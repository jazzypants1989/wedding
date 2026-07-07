/**
 * Unit tests for withAccount() middleware (401/403 branches + happy path)
 */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../../db/connection.js"
import { createAccountSession } from "../../../db/account-sessions.js"
import { withAccount } from "../../../core/auth.js"
import { mockRequest, mockResponse } from "../../unit-helpers.js"

/** @param {ReturnType<typeof mockRequest>} r */
function asReq(r) {
  return /** @type {import('node:http').IncomingMessage} */ (
    /** @type {unknown} */ (r)
  )
}
/** @param {ReturnType<typeof mockResponse>} r */
function asRes(r) {
  return /** @type {import('node:http').ServerResponse} */ (
    /** @type {unknown} */ (r)
  )
}

/** @param {{ name?: string, trusted?: 0 | 1 }} [opts] */
function makeAccount({ name = "Guest User", trusted = 1 } = {}) {
  const result = getDb()
    .prepare(
      `INSERT INTO accounts (guest_id, name, name_normalized, trusted)
       VALUES (NULL, ?, ?, ?)`,
    )
    .run(name, name.toLowerCase(), trusted)
  return Number(result.lastInsertRowid)
}

function clearAccountData() {
  getDb().prepare("DELETE FROM account_sessions").run()
  getDb().prepare("DELETE FROM accounts").run()
}

describe("withAccount()", () => {
  before(() => init())
  beforeEach(() => clearAccountData())
  after(() => {
    clearAccountData()
    close()
  })

  it("401s with 'Sign in to participate' when no guest_session cookie", async () => {
    let called = false
    const handler = withAccount(async () => {
      called = true
    })
    const res = mockResponse()
    await handler(asReq(mockRequest({ method: "GET", headers: {} })), asRes(res), {
      params: {},
    })

    assert.strictEqual(res.statusCode, 401)
    const body = /** @type {{ error: string }} */ (res.getBody())
    assert.strictEqual(body.error, "Sign in to participate")
    assert.strictEqual(called, false)
  })

  it("401s with 'Session expired or invalid' for an unknown token", async () => {
    const handler = withAccount(async () => {})
    const res = mockResponse()
    await handler(
      asReq(
        mockRequest({
          method: "GET",
          headers: { cookie: `guest_session=${"a".repeat(64)}` },
        }),
      ),
      asRes(res),
      { params: {} },
    )

    assert.strictEqual(res.statusCode, 401)
    const body = /** @type {{ error: string }} */ (res.getBody())
    assert.strictEqual(body.error, "Session expired or invalid")
  })

  it("passes the account to the handler on a valid GET", async () => {
    const accountId = makeAccount({ name: "Dana", trusted: 1 })
    const session = createAccountSession(accountId)

    let receivedAccountId = 0
    let receivedName = ""
    const handler = withAccount(async (_req, res, routeInfo) => {
      receivedAccountId = routeInfo.account.account_id
      receivedName = routeInfo.account.name
      const { sendJson } = await import("../../../core/http.js")
      sendJson(res, 200, { ok: true })
    })
    const res = mockResponse()
    await handler(
      asReq(
        mockRequest({
          method: "GET",
          headers: { cookie: `guest_session=${session.token}` },
        }),
      ),
      asRes(res),
      { params: {} },
    )

    assert.strictEqual(receivedAccountId, accountId)
    assert.strictEqual(receivedName, "Dana")
    assert.strictEqual(res.statusCode, 200)
  })

  it("403s a mutating request that lacks X-CSRF-Token", async () => {
    const accountId = makeAccount()
    const session = createAccountSession(accountId)

    let called = false
    const handler = withAccount(async () => {
      called = true
    })
    const res = mockResponse()
    await handler(
      asReq(
        mockRequest({
          method: "POST",
          headers: { cookie: `guest_session=${session.token}` },
        }),
      ),
      asRes(res),
      { params: {} },
    )

    assert.strictEqual(res.statusCode, 403)
    const body = /** @type {{ error: string }} */ (res.getBody())
    assert.strictEqual(body.error, "Invalid CSRF token")
    assert.strictEqual(called, false)
  })

  it("allows a mutating request with the matching X-CSRF-Token", async () => {
    const accountId = makeAccount()
    const session = createAccountSession(accountId)

    let called = false
    const handler = withAccount(async (_req, res) => {
      called = true
      const { sendJson } = await import("../../../core/http.js")
      sendJson(res, 200, { ok: true })
    })
    const res = mockResponse()
    await handler(
      asReq(
        mockRequest({
          method: "POST",
          headers: {
            cookie: `guest_session=${session.token}`,
            "x-csrf-token": session.csrf_token,
          },
        }),
      ),
      asRes(res),
      { params: {} },
    )

    assert.strictEqual(called, true)
    assert.strictEqual(res.statusCode, 200)
  })
})
