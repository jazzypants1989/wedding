/** @file First-run setup wizard integration tests.
 *
 *  Spawns a dedicated server WITHOUT ADMIN_PASSWORD_HASH (so it's un-onboarded),
 *  captures the one-time token from stdout, and walks the token-gated flow. Runs
 *  on its own port + DB so it can't collide with the shared suites, which boot
 *  env-configured (already-complete). No regex.
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..")
const PORT = 3009
const BASE = `http://localhost:${PORT}`
const DB = path.join(os.tmpdir(), `wedding-setup-test-${process.pid}-${Date.now()}.db`)
const AUDIT = path.join(os.tmpdir(), `wedding-setup-audit-${process.pid}`)

const STRONG_PASSWORD = "SetupTest1234"

/** True when `s` is exactly 64 hex characters — the printed setup token.
 *  @param {string} s */
function isHexToken(s) {
  if (s.length !== 64) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const isDigit = c >= 48 && c <= 57
    const isLower = c >= 97 && c <= 102 // a-f
    if (!isDigit && !isLower) return false
  }
  return true
}

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let proc = null
let token = ""

describe("First-run setup", () => {
  before(async () => {
    /** @type {NodeJS.ProcessEnv} */
    const env = {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "test",
      DATABASE_PATH: DB,
      AUDIT_LOG_DIR: AUDIT,
      TRUSTED_PROXIES: "127.0.0.1,::1,::ffff:127.0.0.1",
      // Force first-run: the empty value stays set, so the server's own
      // process.loadEnvFile(.env) won't re-populate ADMIN_PASSWORD_HASH from a
      // developer's .env (loadEnvFile never overrides an already-present var).
      ADMIN_PASSWORD_HASH: "",
    }

    proc = spawn("node", ["server.js"], { cwd: PROJECT_ROOT, env, stdio: ["pipe", "pipe", "pipe"] })
    let out = ""
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Setup server startup timeout")), 10000)
      const child = /** @type {import('node:child_process').ChildProcessWithoutNullStreams} */ (proc)
      child.stdout.on("data", (d) => {
        out += d.toString()
        if (out.includes("Wedding website running")) {
          clearTimeout(timer)
          resolve(undefined)
        }
      })
      child.stderr.on("data", (d) => {
        const o = d.toString()
        if (!o.includes("ExperimentalWarning")) console.error("setup server stderr:", o)
      })
      child.on("exit", (code) => reject(new Error("Setup server exited early: " + code)))
    })
    for (const line of out.split("\n")) {
      const t = line.trim()
      if (isHexToken(t)) {
        token = t
        break
      }
    }
  })

  after(async () => {
    if (proc) {
      proc.kill()
      await new Promise((r) => setTimeout(r, 200))
    }
    for (const p of [DB, DB + "-wal", DB + "-shm"]) {
      try {
        fs.rmSync(p, { force: true })
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(AUDIT, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it("prints a one-time setup token on first boot", () => {
    assert.ok(token, "expected a 64-hex setup token in server stdout")
  })

  it("redirects the landing page to /setup while un-onboarded", async () => {
    const res = await fetch(BASE + "/", { redirect: "manual" })
    assert.equal(res.status, 302)
    assert.equal(res.headers.get("location"), "/setup")
  })

  it("GET /api/setup reports incomplete + seed content", async () => {
    const res = await fetch(BASE + "/api/setup")
    assert.equal(res.status, 200)
    const data = /** @type {{ complete: boolean, content?: { couple?: { display?: string } } }} */ (await res.json())
    assert.equal(data.complete, false)
    assert.ok(data.content?.couple?.display, "expected seed content")
  })

  it("rejects a bad token", async () => {
    const res = await fetch(BASE + "/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "deadbeef", password: STRONG_PASSWORD, content: seedContent() }),
    })
    assert.equal(res.status, 403)
  })

  it("rejects a weak password", async () => {
    const res = await fetch(BASE + "/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "short", content: seedContent() }),
    })
    assert.equal(res.status, 400)
  })

  it("completes setup with the token + strong password", async () => {
    const content = seedContent()
    content.couple.display = "Alex & Sam"
    content.location = "Testville"
    const res = await fetch(BASE + "/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: STRONG_PASSWORD, content }),
    })
    assert.equal(res.status, 200)
    const data = /** @type {{ success: boolean }} */ (await res.json())
    assert.equal(data.success, true)
    // Auto-login: a session cookie is set so the owner lands in /admin.
    assert.ok((res.headers.get("set-cookie") || "").includes("session="))
  })

  it("is complete afterward and re-locks the wizard", async () => {
    const status = await fetch(BASE + "/api/setup")
    assert.equal(/** @type {{ complete: boolean }} */ (await status.json()).complete, true)

    // /setup now redirects to /admin.
    const page = await fetch(BASE + "/setup", { redirect: "manual" })
    assert.equal(page.status, 302)
    assert.equal(page.headers.get("location"), "/admin")

    // A replayed submit is refused (token retired → 403, or already-complete 409).
    const replay = await fetch(BASE + "/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: STRONG_PASSWORD, content: seedContent() }),
    })
    assert.ok(replay.status === 409 || replay.status === 403, "replay should be refused, got " + replay.status)
  })

  it("the new password logs in via the app_state hash", async () => {
    const res = await fetch(BASE + "/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: STRONG_PASSWORD }),
    })
    assert.equal(res.status, 200)
    assert.equal(/** @type {{ success: boolean }} */ (await res.json()).success, true)
  })

  it("the effective couple name reflects the wizard edit", async () => {
    // Tokens were rebuilt on save (onContentChanged) — a templated page now
    // carries the wizard-entered couple name, not the shipped default.
    const res = await fetch(BASE + "/rsvp", { redirect: "manual" })
    const htmlText = await res.text()
    assert.ok(htmlText.includes("Alex &amp; Sam"), "expected the wizard couple name in templated HTML")
  })
})

/** A minimal complete SiteContent body for POSTs that only need to pass
 *  validation. Mirrors the shipped defaults' shape. */
function seedContent() {
  return {
    couple: { display: "Alex & Sam", first: "Alex and Sam", monogram: "A&S", fullNames: ["Alex Rivera", "Sam Lee"] },
    weddingDate: "2027-09-18T16:00:00-07:00",
    location: "Testville, OR",
    theme: "garden",
    schedule: { title: "Schedule", items: [] },
    dressCode: { title: "Dress Code", body: "Wear what you like.", images: [] },
    registry: {
      title: "Registry",
      body: "No gifts needed.",
      frameNote: "Frame note.",
      url: "https://example.com/registry",
      label: "Open registry",
    },
    memories: { title: "Memories", body: "Relive the day." },
    contactEmail: null,
    nav: {
      pre: [{ href: "#", label: "Home" }],
      post: [{ href: "#", label: "Home" }],
    },
    footer: { githubUrl: null, eventHeading: "Wedding Day" },
    copy: {
      pre: { welcomeHeading: "Welcome", welcomeIntro: "Join us!" },
      post: { welcomeHeading: "Thanks", welcomeIntro: "Thanks for coming!" },
    },
  }
}
