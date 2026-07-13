/**
 * @file Integration tests for the admin effect-config editor: GET/PUT/DELETE
 * round-trips through the `effect_config` app_state override, validation of
 * unknown ids/keys, sparse storage, and propagation to the inlined
 * `data-effect-config` attribute on the templated home page.
 */
// MUST be first: sets TEST_SERVER_PORT before ../helpers.js reads it.
import "./_effect-config-port.js"

import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import { DatabaseSync } from "node:sqlite"
import {
  startServer,
  stopServer,
  adminLogin,
  adminFetch,
  BASE_URL,
  TEST_DB_PATH,
} from "../helpers.js"

const hasAdmin = Boolean(process.env.TEST_ADMIN_PASSWORD)

/** Raw stored effect_config override straight from the server DB, parsed. */
function readStoredOverride() {
  const db = new DatabaseSync(TEST_DB_PATH, { readOnly: true })
  try {
    const row = /** @type {{ value: string } | undefined} */ (
      db.prepare("SELECT value FROM app_state WHERE key = 'effect_config'").get()
    )
    return row ? JSON.parse(row.value) : null
  } finally {
    db.close()
  }
}

/** @typedef {{ override: Record<string, Record<string, unknown>> }} OverrideResp */

/** @param {Response} res @returns {Promise<OverrideResp>} */
async function overrideJson(res) {
  return /** @type {OverrideResp} */ (await res.json())
}

/** Pull the value of `data-effect-config="…"` off the served home page HTML. The
 *  attribute is HTML-escaped (quotes → &quot;), so decode before JSON.parse. */
async function homeEffectConfig() {
  const html = await (await fetch(`${BASE_URL}/`)).text()
  const marker = 'data-effect-config="'
  const start = html.indexOf(marker)
  if (start === -1) return null
  const from = start + marker.length
  const end = html.indexOf('"', from)
  const raw = html.slice(from, end)
  const decoded = raw
    .split("&quot;").join('"')
    .split("&amp;").join("&")
    .split("&lt;").join("<")
    .split("&gt;").join(">")
  if (!decoded) return ""
  return JSON.parse(decoded)
}

describe("admin effect-config editor", () => {
  before(async () => {
    await startServer()
  })

  after(async () => {
    if (hasAdmin) {
      try {
        const auth = await adminLogin()
        await adminFetch("/api/admin/effect-config", { method: "DELETE" }, auth)
      } catch {
        // ignore
      }
    }
    await stopServer()
  })

  it("requires admin auth", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/effect-config`)
    assert.strictEqual(res.status, 401)
  })

  it("GET returns an empty override before any save", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const res = await adminFetch("/api/admin/effect-config", {}, auth)
    assert.strictEqual(res.status, 200)
    const data = await overrideJson(res)
    assert.deepStrictEqual(data.override, {})
  })

  it("PUT persists a sparse override and inlines it into the home page", { skip: !hasAdmin }, async () => {
    // Prime the page cache so the save must evict it.
    await fetch(`${BASE_URL}/`)

    const auth = await adminLogin()
    const put = await adminFetch(
      "/api/admin/effect-config",
      { method: "PUT", body: JSON.stringify({ override: { snow: { flakeCount: 99 }, dividers: { color: 0.9 } } }) },
      auth,
    )
    assert.strictEqual(put.status, 200)
    const data = await overrideJson(put)
    assert.strictEqual(data.override.snow.flakeCount, 99)
    assert.strictEqual(data.override.dividers.color, 0.9)

    // Stored blob is exactly the sparse map.
    assert.deepStrictEqual(readStoredOverride(), { snow: { flakeCount: 99 }, dividers: { color: 0.9 } })

    // Home page carries the inlined attribute (cache evicted on save).
    assert.deepStrictEqual(await homeEffectConfig(), { snow: { flakeCount: 99 }, dividers: { color: 0.9 } })
  })

  it("rejects an unknown effect id", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const res = await adminFetch(
      "/api/admin/effect-config",
      { method: "PUT", body: JSON.stringify({ override: { notaneffect: { x: 1 } } }) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("rejects an unknown key for a known effect", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const res = await adminFetch(
      "/api/admin/effect-config",
      { method: "PUT", body: JSON.stringify({ override: { snow: { bogusKey: 1 } } }) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("rejects an out-of-range count (visitor-DoS guard)", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const res = await adminFetch(
      "/api/admin/effect-config",
      { method: "PUT", body: JSON.stringify({ override: { snow: { flakeCount: 1e9 } } }) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("rejects a wrong-typed value (string where a number is expected)", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const res = await adminFetch(
      "/api/admin/effect-config",
      { method: "PUT", body: JSON.stringify({ override: { snow: { flakeCount: "lots" } } }) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("rejects a scalar where a color array is expected", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const res = await adminFetch(
      "/api/admin/effect-config",
      { method: "PUT", body: JSON.stringify({ override: { disco: { rayColors: 5 } } }) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("rejects a range with the wrong arity", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const res = await adminFetch(
      "/api/admin/effect-config",
      { method: "PUT", body: JSON.stringify({ override: { snow: { sizeRange: [1, 2, 3] } } }) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("an all-empty override clears the stored key", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    // First set something.
    await adminFetch(
      "/api/admin/effect-config",
      { method: "PUT", body: JSON.stringify({ override: { snow: { flakeCount: 50 } } }) },
      auth,
    )
    // Then submit an empty per-effect partial → drops to {} → clears the key.
    const put = await adminFetch(
      "/api/admin/effect-config",
      { method: "PUT", body: JSON.stringify({ override: { snow: {} } }) },
      auth,
    )
    assert.strictEqual(put.status, 200)
    assert.strictEqual(readStoredOverride(), null)
    assert.strictEqual(await homeEffectConfig(), "")
  })

  it("DELETE resets to defaults", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    await adminFetch(
      "/api/admin/effect-config",
      { method: "PUT", body: JSON.stringify({ override: { snow: { flakeCount: 12 } } }) },
      auth,
    )
    const del = await adminFetch("/api/admin/effect-config", { method: "DELETE" }, auth)
    assert.strictEqual(del.status, 200)
    assert.strictEqual(readStoredOverride(), null)
    assert.strictEqual(await homeEffectConfig(), "")
  })
})
