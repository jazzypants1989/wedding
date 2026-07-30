#!/usr/bin/env node

/**
 * @file Admin password setup script
 */

import fs from "node:fs"
import path from "node:path"
import { hashPassword, validatePasswordStrength } from "../core/password-policy.js"
import { prompt } from "./lib/prompt.js"

const ENV_PATH = path.join(import.meta.dirname, "..", ".env")

async function main() {
  console.log("\n=== Wedding Admin Password Setup ===\n")

  // Check if .env exists
  let envContent = ""
  let hasExistingHash = false

  try {
    envContent = fs.readFileSync(ENV_PATH, "utf8")
    hasExistingHash =
      envContent.includes("ADMIN_PASSWORD_HASH=") &&
      !envContent.includes("ADMIN_PASSWORD_HASH=\n") &&
      !envContent.includes("ADMIN_PASSWORD_HASH=#")
  } catch (err) {
    if (
      err instanceof Error &&
      /** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT"
    )
      throw err
    console.log("No .env file found. Will create one.\n")
  }

  if (hasExistingHash) {
    const confirm = await prompt(
      "Admin password is already set. Overwrite? (y/N): ",
    )
    if (confirm.toLowerCase() !== "y") {
      console.log("Aborted.")
      process.exit(0)
    }
    console.log("")
  }

  // Get password
  console.log("Password requirements:")
  console.log("  - At least 12 characters")
  console.log("  - At least one uppercase letter (A-Z)")
  console.log("  - At least one lowercase letter (a-z)")
  console.log("  - At least one digit (0-9)")
  console.log("")
  const password = await prompt("Enter admin password: ", true)

  const passwordError = validatePasswordStrength(password)
  if (passwordError) {
    console.error(`\nError: ${passwordError}`)
    process.exit(1)
  }

  const confirm = await prompt("Confirm password: ", true)

  if (password !== confirm) {
    console.error("\nError: Passwords do not match.")
    process.exit(1)
  }

  // Generate hash
  const hash = hashPassword(password)

  // Update .env file
  if (envContent.includes("ADMIN_PASSWORD_HASH=")) {
    // Replace existing - process line by line
    const lines = envContent.split("\n")
    const newLines = lines.map((line) =>
      line.startsWith("ADMIN_PASSWORD_HASH=")
        ? `ADMIN_PASSWORD_HASH=${hash}`
        : line,
    )
    envContent = newLines.join("\n")
  } else {
    // Add new
    if (envContent && !envContent.endsWith("\n")) {
      envContent += "\n"
    }
    envContent += `ADMIN_PASSWORD_HASH=${hash}\n`
  }

  // Atomic write: write to temp file, then rename (atomic on POSIX)
  const tmpPath = ENV_PATH + ".tmp"
  fs.writeFileSync(tmpPath, envContent)
  fs.renameSync(tmpPath, ENV_PATH)

  console.log("\nAdmin password hash saved to .env")
  console.log("Restart the server for changes to take effect.\n")
}

main().catch((err) => {
  console.error("Error:", err.message)
  process.exit(1)
})
