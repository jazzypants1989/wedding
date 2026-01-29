/**
 * @file Unit tests for api/admin/invites.js — Invite preview and send handlers
 *
 * Tests the withAdmin-wrapped handlers with real sessions and database state.
 * External services (email/SMS) are not configured, so send tests verify
 * validation and service-not-configured error paths.
 */

import { describe, it, before, after, afterEach } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../../db/connection.js"
import { createSession } from "../../../db/sessions.js"
import { createGuest } from "../../../api/guests/data.js"
import { withAdmin } from "../../../core/auth.js"
import * as invites from "../../../api/admin/invites.js"

// Wrap handlers the same way the router does (with auth + error handling)
const config = withAdmin(invites.config)
const preview = withAdmin(invites.preview)
const send = withAdmin(invites.send)

const PREFIX = "invtest-"

/**
 * Creates a mock request that works with parseBody and withAdmin.
 * @param {object} opts
 * @param {string} opts.method
 * @param {object | null} [opts.body]
 * @param {string} opts.sessionToken
 * @param {string} opts.csrfToken
 */
function authedReq({ method, body = null, sessionToken, csrfToken }) {
  const bodyStr = body ? JSON.stringify(body) : ""
  return {
    method,
    url: "/api/admin/invite/preview",
    headers: {
      cookie: `session=${sessionToken}; csrf=${csrfToken}`,
      "x-csrf-token": csrfToken,
      "content-type": "application/json",
    },
    socket: { remoteAddress: "127.0.0.1" },
    on(/** @type {string} */ event, /** @type {Function} */ handler) {
      if (event === "data" && bodyStr) handler(Buffer.from(bodyStr))
      if (event === "end") handler()
    },
    destroy() {},
  }
}

function captureRes() {
  /** @type {{ statusCode: number | null, headers: Record<string, unknown>, body: string | null }} */
  const state = { statusCode: null, headers: {}, body: null }
  return {
    state,
    req: { headers: {} },
    writeHead(/** @type {number} */ status, /** @type {Record<string, unknown>} */ headers = {}) {
      state.statusCode = status
      Object.assign(state.headers, headers)
      return this
    },
    setHeader(/** @type {string} */ name, /** @type {unknown} */ value) {
      state.headers[name] = value
      return this
    },
    end(/** @type {string | Buffer | undefined} */ body) {
      state.body = body ? body.toString() : null
      return this
    },
    getBody() {
      if (state.body) {
        try { return JSON.parse(state.body) } catch { return state.body }
      }
      return null
    },
  }
}

/** @type {string} */
let sessionToken
/** @type {string} */
let csrfToken

before(() => {
  init()
  const session = createSession()
  sessionToken = session.token
  csrfToken = session.csrf_token
})

after(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM communications WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM guests WHERE email LIKE '${PREFIX}%'`).run()
    db.prepare("DELETE FROM sessions").run()
  } catch { /* ignore */ }
  close()
})

afterEach(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM communications WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM guests WHERE email LIKE '${PREFIX}%'`).run()
  } catch { /* ignore */ }
})

describe("invite config", () => {
  it("returns service configuration status", async () => {
    const req = authedReq({ method: "GET", sessionToken, csrfToken })
    const res = captureRes()
    await config(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), { params: {} })
    assert.strictEqual(res.state.statusCode, 200)
    const body = res.getBody()
    assert.ok("sms" in body)
    assert.ok("email" in body)
    assert.strictEqual(typeof body.sms.configured, "boolean")
    assert.strictEqual(typeof body.email.configured, "boolean")
  })
})

describe("invite preview", () => {
  it("returns 401 without session", async () => {
    const req = {
      method: "POST",
      url: "/api/admin/invite/preview",
      headers: { "content-type": "application/json" },
      socket: { remoteAddress: "127.0.0.1" },
      on(/** @type {string} */ event, /** @type {Function} */ handler) {
        if (event === "end") handler()
      },
      destroy() {},
    }
    const res = captureRes()
    await preview(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), { params: {} })
    assert.strictEqual(res.state.statusCode, 401)
  })

  it("returns validation error for missing guestIds", async () => {
    const req = authedReq({
      method: "POST",
      body: { type: "email" },
      sessionToken,
      csrfToken,
    })
    const res = captureRes()
    await preview(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), { params: {} })
    assert.ok(res.state.statusCode === 400 || res.state.statusCode === 422)
  })

  it("returns validation error for invalid type", async () => {
    const { id } = createGuest({ name: "PrevTest", email: `${PREFIX}prev@example.com` })
    const req = authedReq({
      method: "POST",
      body: { guestIds: [Number(id)], type: "pigeon" },
      sessionToken,
      csrfToken,
    })
    const res = captureRes()
    await preview(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), { params: {} })
    assert.ok(res.state.statusCode !== null && res.state.statusCode >= 400)
  })

  it("returns error for valid type but unconfigured service", async () => {
    const { id } = createGuest({ name: "PrevSvc", email: `${PREFIX}prevsvc@example.com` })
    const req = authedReq({
      method: "POST",
      body: { guestIds: [Number(id)], type: "email" },
      sessionToken,
      csrfToken,
    })
    const res = captureRes()
    await preview(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), { params: {} })
    // Email service is not configured in tests, so valid type still fails
    assert.strictEqual(res.state.statusCode, 400)
    const body = res.getBody()
    assert.ok(body.error.includes("not configured"))
  })
})

describe("invite send", () => {
  it("returns 401 without session", async () => {
    const req = {
      method: "POST",
      url: "/api/admin/invite/send",
      headers: { "content-type": "application/json" },
      socket: { remoteAddress: "127.0.0.1" },
      on(/** @type {string} */ event, /** @type {Function} */ handler) {
        if (event === "end") handler()
      },
      destroy() {},
    }
    const res = captureRes()
    await send(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), { params: {} })
    assert.strictEqual(res.state.statusCode, 401)
  })

  it("returns validation error for missing guestIds", async () => {
    const req = authedReq({
      method: "POST",
      body: { type: "sms" },
      sessionToken,
      csrfToken,
    })
    const res = captureRes()
    await send(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), { params: {} })
    assert.ok(res.state.statusCode !== null && res.state.statusCode >= 400)
  })

  it("returns validation error for invalid communication type", async () => {
    const { id } = createGuest({ name: "SendTest", email: `${PREFIX}send@example.com` })
    const req = authedReq({
      method: "POST",
      body: { guestIds: [Number(id)], type: "fax" },
      sessionToken,
      csrfToken,
    })
    const res = captureRes()
    await send(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), { params: {} })
    assert.ok(res.state.statusCode !== null && res.state.statusCode >= 400)
  })

  it("returns error for valid type but unconfigured service", async () => {
    const { id } = createGuest({ name: "SendSvc", email: `${PREFIX}sendsvc@example.com` })
    const req = authedReq({
      method: "POST",
      body: { guestIds: [Number(id)], type: "sms" },
      sessionToken,
      csrfToken,
    })
    const res = captureRes()
    await send(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), { params: {} })
    // SMS service is not configured in tests, so valid type still fails
    assert.strictEqual(res.state.statusCode, 400)
    const body = res.getBody()
    assert.ok(body.error.includes("not configured"))
  })

  it("rejects empty guestIds array", async () => {
    const req = authedReq({
      method: "POST",
      body: { guestIds: [], type: "email" },
      sessionToken,
      csrfToken,
    })
    const res = captureRes()
    await send(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)), { params: {} })
    assert.ok(res.state.statusCode !== null && res.state.statusCode >= 400)
  })
})
