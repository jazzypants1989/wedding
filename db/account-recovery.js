/** @file Account recovery tokens (Phase 6): single-use, time-limited magic-link
 *  tokens for untrusted accounts that supplied a contact_email. Only the SHA-256
 *  hash is stored (hashToken pattern from db/sessions.js); the plaintext lives
 *  only in the emailed link. See docs/post-wedding/06-admin-moderation.md §1. */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { now } from "./utils.js"

/** @type {Types.createRecoveryToken} */
export function createRecoveryToken(accountId, tokenHash, expiresAt) {
  sql`INSERT INTO account_recovery_tokens (token_hash, account_id, expires_at)
    VALUES (${tokenHash}, ${accountId}, ${expiresAt})`.run()
}

/** @type {Types.consumeRecoveryToken} */
export function consumeRecoveryToken(tokenHash) {
  // Atomic single-use redemption: mark used only if currently unused AND unexpired,
  // returning the account_id. A replayed or expired token matches nothing → null.
  /** @type {{ account_id: number } | undefined} */
  const row = sql`UPDATE account_recovery_tokens
    SET used_at = ${now()}
    WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > ${now()}
    RETURNING account_id`.get()
  return row ? row.account_id : null
}
