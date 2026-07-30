/** @file Interactive terminal prompt with optional hidden (password) input.
 *  Extracted from setup-admin.js so scripts/import-media.js can ask for the
 *  admin password the same way rather than taking it as a flag — a flag lands
 *  in shell history and in `ps` output. */
/** @import * as Types from '../types.js' */

import readline from "node:readline"

// Compared by code point rather than as literals, so no raw control bytes end
// up in the source.
const CTRL_C = 3
const BACKSPACE = 8
const LINE_FEED = 10
const CARRIAGE_RETURN = 13
const DELETE = 127

/** @type {Types.prompt} */
export function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    if (hidden && process.stdin.isTTY) {
      // Echo asterisks instead of the characters themselves.
      process.stdout.write(question)
      let password = ""

      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.setEncoding("utf8")

      /** @type {Types.onPromptData} */
      const onData = (char) => {
        const code = char.charCodeAt(0)
        if (code === LINE_FEED || code === CARRIAGE_RETURN) {
          process.stdin.setRawMode(false)
          process.stdin.removeListener("data", onData)
          process.stdout.write("\n")
          rl.close()
          resolve(password)
        } else if (code === CTRL_C) {
          process.stdin.setRawMode(false)
          process.stdout.write("\n")
          process.exit(1)
        } else if (code === DELETE || code === BACKSPACE) {
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
      // Non-TTY: readline can't hide input, so the answer will be visible.
      rl.question(question, (answer) => {
        rl.close()
        resolve(answer)
      })
    }
  })
}

/** @type {Types.canPrompt} */
export function canPrompt() {
  return Boolean(process.stdin.isTTY)
}
