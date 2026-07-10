#!/usr/bin/env node
/**
 * @file Preflight config doctor. Detects the config-drift bug class before it
 * bites in production: `.env` ↔ `.env.example` ↔ what-the-code-reads drift,
 * production-required gaps (TRUSTED_PROXIES etc.), placeholder values, upload
 * disk headroom, and the Node version. Zero-dep, no regex.
 *
 * Usage: npm run doctor   (exit 0 = ok, non-zero = has a ✗ failure)
 */

import fs from "node:fs"
import path from "node:path"

const ROOT = path.join(import.meta.dirname, "..")
const ENV_PATH = path.join(ROOT, ".env")
const EXAMPLE_PATH = path.join(ROOT, ".env.example")

/**
 * Every env var the code reads. Keep in sync when adding a new `process.env.*`
 * read — the doctor uses this to flag vars documented nowhere. (This is the one
 * list of "what matters"; `core/env.js` warns about a subset at boot.)
 */
export const CODE_ENV_VARS = [
  "PORT",
  "BASE_URL",
  "NODE_ENV",
  "SITE_MODE",
  "ADMIN_PASSWORD_HASH",
  "CONTACT_EMAIL",
  "TRUSTED_PROXIES",
  "TRUSTED_PROXY_DEPTH",
  "CSP_NONCE",
  "DATABASE_PATH",
  "AUDIT_LOG_DIR",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "RESEND_API_KEY",
  "FROM_EMAIL",
  "TEST_ADMIN_PASSWORD",
  "MEDIA_MIN_FREE_BYTES",
  "MEDIA_MAX_TOTAL_BYTES",
  "MEDIA_UNTRUSTED_QUOTA_BYTES",
]

const PLACEHOLDER_CONTACT = "contact@example.com"
const DEFAULT_MEDIA = {
  MEDIA_MIN_FREE_BYTES: 5 * 1024 * 1024 * 1024,
  MEDIA_MAX_TOTAL_BYTES: 45 * 1024 * 1024 * 1024,
  MEDIA_UNTRUSTED_QUOTA_BYTES: 250 * 1024 * 1024,
}

/** @typedef {{ level: "ok" | "warn" | "fail", msg: string }} Finding */

/**
 * Parse a dotenv-style file body into a key→value map. Splits each line on the
 * first "=", ignoring blank/`#` lines, stripping trailing " # comments" and
 * surrounding quotes. No regex.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseEnv(text) {
  /** @type {Map<string, string>} */
  const map = new Map()
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    // Quoted values are taken verbatim (a " #" inside quotes is not a comment);
    // only unquoted values get a trailing " # comment" stripped.
    const quote = val.startsWith('"') ? '"' : val.startsWith("'") ? "'" : ""
    if (quote) {
      const close = val.indexOf(quote, 1)
      if (close !== -1) val = val.slice(1, close)
    } else {
      const commentAt = val.indexOf(" #")
      if (commentAt !== -1) val = val.slice(0, commentAt).trim()
    }
    map.set(key, val)
  }
  return map
}

/** @param {string} p @returns {string | null} */
function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf-8")
  } catch {
    return null
  }
}

/** @param {number} bytes @returns {string} */
function humanBytes(bytes) {
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return gb.toFixed(1) + "GB"
  return (bytes / (1024 * 1024)).toFixed(0) + "MB"
}

/**
 * @param {Set<string>} envKeys
 * @param {Set<string>} exampleKeys
 * @returns {Finding[]}
 */
export function checkEnvDrift(envKeys, exampleKeys) {
  /** @type {Finding[]} */
  const out = []

  const missingFromEnv = [...exampleKeys].filter((k) => !envKeys.has(k))
  if (missingFromEnv.length === 0) {
    out.push({ level: "ok", msg: ".env has every key documented in .env.example" })
  } else {
    out.push({
      level: "warn",
      msg: "documented in .env.example but missing from .env: " + missingFromEnv.join(", "),
    })
  }

  const undocumented = CODE_ENV_VARS.filter((k) => !exampleKeys.has(k))
  if (undocumented.length === 0) {
    out.push({ level: "ok", msg: "every env var the code reads is documented in .env.example" })
  } else {
    out.push({
      level: "warn",
      msg: "read by code but undocumented in .env.example: " + undocumented.join(", "),
    })
  }
  return out
}

/**
 * @param {(k: string) => string | undefined} get
 * @param {boolean} isProd
 * @returns {Finding[]}
 */
export function checkProdRequired(get, isProd) {
  /** @type {Finding[]} */
  const out = []
  if (!isProd) {
    out.push({ level: "ok", msg: "NODE_ENV is not production — skipping prod-required checks" })
    return out
  }
  const trusted = (get("TRUSTED_PROXIES") || "").trim()
  out.push(
    trusted
      ? { level: "ok", msg: "TRUSTED_PROXIES is set" }
      : {
          level: "warn",
          msg: "TRUSTED_PROXIES unset — RFC-1918 peers are trusted by default (fine for Traefik on a private docker network); set this only if the proxy is on a public IP",
        },
  )
  out.push(
    (get("ADMIN_PASSWORD_HASH") || "").trim()
      ? { level: "ok", msg: "ADMIN_PASSWORD_HASH is set" }
      : { level: "fail", msg: "ADMIN_PASSWORD_HASH unset — admin dashboard unavailable" },
  )
  const baseUrl = (get("BASE_URL") || "").trim()
  out.push(
    baseUrl && !baseUrl.includes("localhost")
      ? { level: "ok", msg: "BASE_URL is a real host" }
      : { level: "fail", msg: "BASE_URL is empty or localhost in production: " + (baseUrl || "(unset)") },
  )
  return out
}

/**
 * @param {(k: string) => string | undefined} get
 * @param {boolean} isProd
 * @returns {Finding[]}
 */
export function checkPlaceholders(get, isProd) {
  /** @type {Finding[]} */
  const out = []
  const contact = (get("CONTACT_EMAIL") || "").trim()
  if (!contact || contact === PLACEHOLDER_CONTACT) {
    out.push({
      level: "warn",
      msg: "CONTACT_EMAIL is the placeholder/default (" + (contact || "unset") + ") — guests see it",
    })
  } else {
    out.push({ level: "ok", msg: "CONTACT_EMAIL is set" })
  }

  if (isProd && (get("TEST_ADMIN_PASSWORD") || "").trim()) {
    out.push({ level: "fail", msg: "TEST_ADMIN_PASSWORD is set under production" })
  }

  for (const key of ["TWILIO_AUTH_TOKEN", "RESEND_API_KEY"]) {
    const val = (get(key) || "").trim().toLowerCase()
    if (val && (val.includes("example") || val.includes("xxxx") || val.startsWith("your"))) {
      out.push({ level: "warn", msg: key + " looks like a placeholder value" })
    }
  }
  return out
}

/**
 * @param {(k: string) => string | undefined} get
 * @returns {Finding[]}
 */
export function checkDisk(get) {
  /** @type {Finding[]} */
  const out = []
  const candidates = [
    path.join(ROOT, "data", "uploads"),
    path.join(ROOT, "data"),
    ROOT,
  ]
  const dir = candidates.find((d) => fs.existsSync(d)) || ROOT

  // Mirror the app's envBytes guard (types.js): an empty/whitespace value is
  // "unset" → the default applies, not 0. Otherwise doctor would report "ok"
  // while the app actually enforces the 5GB default.
  const minFreeRaw = (get("MEDIA_MIN_FREE_BYTES") || "").trim()
  const raw = minFreeRaw ? Number(minFreeRaw) : NaN
  const minFree = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MEDIA.MEDIA_MIN_FREE_BYTES

  try {
    const s = fs.statfsSync(dir)
    const free = s.bavail * s.bsize
    out.push(
      free >= minFree
        ? { level: "ok", msg: "free disk " + humanBytes(free) + " ≥ MEDIA_MIN_FREE_BYTES " + humanBytes(minFree) }
        : { level: "warn", msg: "free disk " + humanBytes(free) + " is BELOW MEDIA_MIN_FREE_BYTES " + humanBytes(minFree) + " — uploads will pause" },
    )
  } catch {
    out.push({ level: "warn", msg: "could not stat disk for " + dir })
  }

  for (const key of ["MEDIA_MIN_FREE_BYTES", "MEDIA_MAX_TOTAL_BYTES", "MEDIA_UNTRUSTED_QUOTA_BYTES"]) {
    const rawVal = (get(key) || "").trim()
    const v = rawVal ? Number(rawVal) : NaN
    const eff = Number.isFinite(v) && v >= 0 ? v : DEFAULT_MEDIA[/** @type {keyof typeof DEFAULT_MEDIA} */ (key)]
    const src = rawVal ? "set" : "default"
    out.push({ level: "ok", msg: key + " = " + humanBytes(eff) + " (" + src + ")" })
  }
  return out
}

/** @returns {Finding[]} */
export function checkRuntime() {
  const major = Number(process.versions.node.split(".")[0])
  return [
    major >= 22
      ? { level: "ok", msg: "Node " + process.versions.node + " (≥ 22)" }
      : { level: "fail", msg: "Node " + process.versions.node + " is below the required 22" },
  ]
}

const ICONS = { ok: "✓", warn: "⚠", fail: "✗" }

/**
 * @param {string} title
 * @param {Finding[]} findings
 */
function printGroup(title, findings) {
  console.log("\n" + title)
  for (const f of findings) {
    console.log("  " + ICONS[f.level] + " " + f.msg)
  }
}

function main() {
  const envText = readFileSafe(ENV_PATH)
  const exampleText = readFileSafe(EXAMPLE_PATH)

  if (exampleText === null) {
    console.error("✗ .env.example not found at " + EXAMPLE_PATH)
    process.exit(1)
  }

  const envMap = envText === null ? new Map() : parseEnv(envText)
  const exampleMap = parseEnv(exampleText)

  // Prefer a live process.env value (e.g. NODE_ENV set by the shell / compose)
  // over the file, falling back to the parsed .env for everything else.
  /** @param {string} k */
  const get = (k) => process.env[k] ?? envMap.get(k)
  const isProd = get("NODE_ENV") === "production"

  console.log("wedding config doctor" + (envText === null ? "  (no .env file found — checking .env.example only)" : ""))

  /** @type {Finding[]} */
  const all = []
  const groups = [
    ["Env drift (.env ↔ .env.example ↔ code)", checkEnvDrift(new Set(envMap.keys()), new Set(exampleMap.keys()))],
    ["Production-required", checkProdRequired(get, isProd)],
    ["Placeholder / weak values", checkPlaceholders(get, isProd)],
    ["Upload disk headroom", checkDisk(get)],
    ["Runtime", checkRuntime()],
  ]
  for (const [title, findings] of groups) {
    printGroup(/** @type {string} */ (title), /** @type {Finding[]} */ (findings))
    all.push(.../** @type {Finding[]} */ (findings))
  }

  const fails = all.filter((f) => f.level === "fail").length
  const warns = all.filter((f) => f.level === "warn").length
  console.log("\n" + (fails ? "✗ " + fails + " failure(s)" : "✓ no failures") + (warns ? ", " + warns + " warning(s)" : ""))
  process.exit(fails > 0 ? 1 : 0)
}

// Run only when invoked directly (not when imported by a unit test).
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main()
}
