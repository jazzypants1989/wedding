/**
 * @file Test environment setup — loaded via --import before any test file.
 * Sets DATABASE_PATH and AUDIT_LOG_DIR to temp locations for test isolation.
 * Warns when TEST_ADMIN_PASSWORD is missing (admin tests will be skipped).
 */

import os from "node:os"
import path from "node:path"
import fs from "node:fs"

// Load .env so TEST_ADMIN_PASSWORD and other vars are available
const envPath = path.resolve(import.meta.dirname, "..", ".env")
try {
  process.loadEnvFile(envPath)
} catch {
  // .env file is optional
}

// Warn about missing TEST_ADMIN_PASSWORD — admin integration tests will be skipped
if (!process.env.TEST_ADMIN_PASSWORD) {
  const isCI = process.env.CI === "true" || process.env.CI === "1"
  const msg = "WARNING: TEST_ADMIN_PASSWORD is not set. Admin endpoint tests will be SKIPPED."
  if (isCI) {
    console.error("\n" + "=".repeat(70))
    console.error(msg)
    console.error("Set TEST_ADMIN_PASSWORD in CI to enable full test coverage.")
    console.error("=".repeat(70) + "\n")
  } else {
    console.warn("\n" + msg + "\n")
  }
}

const pid = process.pid
const tmpDir = os.tmpdir()

if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = path.join(tmpDir, `wedding-unit-${pid}.db`)
}

if (!process.env.AUDIT_LOG_DIR) {
  process.env.AUDIT_LOG_DIR = path.join(tmpDir, `wedding-unit-audit-${pid}`)
}

// Clean up temp files when the process exits
process.on("exit", () => {
  const dbPath = process.env.DATABASE_PATH || ""
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix)
    } catch {
      // file may not exist
    }
  }

  const auditDir = process.env.AUDIT_LOG_DIR || ""
  try {
    fs.rmSync(auditDir, { recursive: true, force: true })
  } catch {
    // directory may not exist
  }
})
