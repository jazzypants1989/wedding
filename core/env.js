/**
 * Environment loader - must be imported before any other modules that use env vars
 */

import path from "node:path"

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", ".env"))
} catch (err) {
  console.warn(
    "Warning: Could not load .env file:",
    err instanceof Error ? err.message : String(err)
  )
}

const RECOMMENDED_ENV_VARS = [
  {
    name: "ADMIN_PASSWORD_HASH",
    message:
      "Admin dashboard will be unavailable. Run: node scripts/setup-admin.js",
  },
  {
    name: "BASE_URL",
    message:
      "Invite URLs will default to localhost (not suitable for production)",
  },
]

for (const { name, message } of RECOMMENDED_ENV_VARS) {
  if (!process.env[name]) {
    console.warn(`WARNING: ${name} not set. ${message}`)
  }
}

if (process.env.NODE_ENV === "production") {
  const trustedProxies =
    process.env.TRUSTED_PROXIES?.split(",").map((s) => s.trim()) || []
  if (trustedProxies.length === 0) {
    console.warn("=".repeat(70))
    console.warn("WARNING: TRUSTED_PROXIES not configured")
    console.warn("If running behind a reverse proxy (nginx, Cloudflare, etc.),")
    console.warn("rate limiting will not work correctly.")
    console.warn("Set TRUSTED_PROXIES=127.0.0.1 (or your proxy IP) in .env")
    console.warn("=".repeat(70))
  }
}

const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH

if (!ADMIN_PASSWORD_HASH) {
  console.warn("\n⚠️  ADMIN_PASSWORD_HASH not set in .env")
  console.warn("   Run: node scripts/setup-admin.js to set up admin password\n")
}
