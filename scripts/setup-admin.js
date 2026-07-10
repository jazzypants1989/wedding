#!/usr/bin/env node

/**
 * @file Admin password setup script
 */
/** @import * as Types from '../types.js' */

import readline from "node:readline"
import fs from "node:fs"
import path from "node:path"
import { hashPassword, validatePasswordStrength } from "../core/password-policy.js"

const ENV_PATH = path.join(import.meta.dirname, "..", ".env")

/** @type {Types.Prompt} */
function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    if (hidden && process.stdin.isTTY) {
      // Hide input for password
      process.stdout.write(question)
      let password = ""

      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.setEncoding("utf8")

      /** @type {Types.OnData} */
      const onData = (char) => {
        if (char === "\n" || char === "\r") {
          process.stdin.setRawMode(false)
          process.stdin.removeListener("data", onData)
          process.stdout.write("\n")
          rl.close()
          resolve(password)
        } else if (char === "\u0003") {
          // Ctrl+C
          process.exit(1)
        } else if (char === "\u007F" || char === "\b") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1)
            process.stdout.write("\b \b")
          }
        } else {
          password += char
          process.stdout.write("*")
        }
      }

      process.stdin.on("data", onData)
    } else {
      // Fallback for non-TTY (password will be visible)
      rl.question(question, (answer) => {
        rl.close()
        resolve(answer)
      })
    }
  })
}

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
