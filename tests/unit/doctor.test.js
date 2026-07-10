/**
 * @file Unit tests for scripts/doctor.js — the .env parser + drift checks
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { parseEnv, checkEnvDrift, checkProdRequired, checkDisk, CODE_ENV_VARS } from "../../scripts/doctor.js"

describe("parseEnv", () => {
  it("parses keys and values, ignoring blanks and # comments", () => {
    const m = parseEnv("# comment\nPORT=3000\n\nBASE_URL=http://x\n")
    assert.strictEqual(m.get("PORT"), "3000")
    assert.strictEqual(m.get("BASE_URL"), "http://x")
    assert.strictEqual(m.size, 2)
  })

  it("strips inline comments and surrounding quotes", () => {
    const m = parseEnv('A=5368709120        # 5GB\nB="quoted value"\nC=\n')
    assert.strictEqual(m.get("A"), "5368709120")
    assert.strictEqual(m.get("B"), "quoted value")
    assert.strictEqual(m.get("C"), "") // empty value is still a declared key
    assert.ok(m.has("C"))
  })

  it("ignores lines without a key=value shape", () => {
    const m = parseEnv("NOTANASSIGNMENT\n=novalue\nOK=1\n")
    assert.ok(!m.has("NOTANASSIGNMENT"))
    assert.strictEqual(m.get("OK"), "1")
    assert.strictEqual(m.size, 1)
  })

  it("keeps a ' #' inside a quoted value (comment strip runs on unquoted only)", () => {
    const m = parseEnv('KEY="a # b"\nBARE=a # c\n')
    assert.strictEqual(m.get("KEY"), "a # b")
    assert.strictEqual(m.get("BARE"), "a")
  })
})

describe("checkEnvDrift", () => {
  it("warns about keys documented in .env.example but missing from .env", () => {
    const findings = checkEnvDrift(new Set(["PORT"]), new Set(["PORT", "BASE_URL"]))
    assert.ok(findings.some((f) => f.level === "warn" && f.msg.includes("BASE_URL")))
  })

  it("warns about code-read vars undocumented in .env.example", () => {
    const findings = checkEnvDrift(new Set(), new Set())
    const undoc = findings.find((f) => f.msg.startsWith("read by code but undocumented"))
    assert.ok(undoc && undoc.level === "warn")
    assert.ok(undoc.msg.includes(CODE_ENV_VARS[0]))
  })

  it("reports ok when everything aligns", () => {
    const full = new Set(CODE_ENV_VARS)
    const findings = checkEnvDrift(full, full)
    assert.ok(findings.every((f) => f.level === "ok"))
  })
})

describe("checkProdRequired", () => {
  it("warns (not fails) when TRUSTED_PROXIES is unset under production", () => {
    const env = { NODE_ENV: "production", ADMIN_PASSWORD_HASH: "h", BASE_URL: "https://x.com" }
    const findings = checkProdRequired((k) => env[/** @type {keyof typeof env} */ (k)], true)
    const tp = findings.find((f) => f.msg.includes("TRUSTED_PROXIES"))
    assert.ok(tp && tp.level === "warn", "TRUSTED_PROXIES unset should warn, not fail")
    // A healthy private-network deploy must not produce a hard failure.
    assert.ok(!findings.some((f) => f.level === "fail"))
  })

  it("still fails when ADMIN_PASSWORD_HASH is unset under production", () => {
    const env = { NODE_ENV: "production", BASE_URL: "https://x.com" }
    const findings = checkProdRequired((k) => env[/** @type {keyof typeof env} */ (k)], true)
    assert.ok(findings.some((f) => f.level === "fail" && f.msg.includes("ADMIN_PASSWORD_HASH")))
  })

  it("skips prod checks when not production", () => {
    const findings = checkProdRequired(() => undefined, false)
    assert.ok(findings.every((f) => f.level === "ok"))
  })
})

describe("checkDisk", () => {
  it("treats an empty MEDIA_MIN_FREE_BYTES as unset → 5GB default, not 0", () => {
    /** @type {Record<string, string>} */
    const env = { MEDIA_MIN_FREE_BYTES: "" }
    const findings = checkDisk((k) => env[k])
    const eff = findings.find((f) => f.msg.startsWith("MEDIA_MIN_FREE_BYTES ="))
    assert.ok(eff, "reports the effective MEDIA_MIN_FREE_BYTES")
    assert.ok(eff.msg.includes("5.0GB"), "empty value falls back to the 5GB default")
    assert.ok(eff.msg.includes("(default)"), "labels the empty value as default, not set")
  })
})
