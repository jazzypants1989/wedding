#!/usr/bin/env node
/** @file CLI: sign in as a fictional guest in one preview state's scratch database.
 *
 *  Run by `preview-states.js` for its signed-in guest view. Prints the session cookies
 *  as JSON. Uses the state's first guest account, so the review sees a guest with their
 *  own posts, or adds one if the state has none. It refuses any database outside
 *  `tmp/states/`, so it can never touch real data.
 */
import { createAccountSessionCookies } from "../../core/auth.js"
import { createAccountSession } from "../../db/account-sessions.js"
import { createAccount } from "../../db/accounts.js"
import { getDb, init } from "../../db/connection.js"
import { isPreviewDatabasePath } from "./preview-fixtures.js"

if (!isPreviewDatabasePath(process.env.DATABASE_PATH ?? "")) {
  console.error("DATABASE_PATH must be inside tmp/states/. This tool signs in a fictional guest.")
  process.exit(1)
}

init()
const first = /** @type {{ id: number } | undefined} */ (
  /** @type {unknown} */ (
    getDb().prepare("SELECT id FROM accounts WHERE deleted_at IS NULL ORDER BY id LIMIT 1").get()
  )
)
const accountId =
  first?.id ?? createAccount({ guestId: null, name: "Preview Guest", trusted: 0 }).id
console.log(JSON.stringify(createAccountSessionCookies(createAccountSession(accountId))))
