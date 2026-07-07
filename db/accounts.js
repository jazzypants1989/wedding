/** @file Guest account database operations */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { normalizeName, normalizeEmail } from "./utils.js"

/** @type {Types.createAccount} */
export function createAccount({ guestId, name, relation = null, contactEmail = null, trusted }) {
  const nameNormalized = normalizeName(name)
  const result = sql`INSERT INTO accounts (guest_id, name, name_normalized, relation, contact_email, trusted)
    VALUES (${guestId}, ${name}, ${nameNormalized}, ${relation}, ${normalizeEmail(contactEmail)}, ${trusted})`.run()

  return /** @type {import('../types.js').Account} */ (
    getAccountById(Number(result.lastInsertRowid))
  )
}

/** @type {Types.findAccountByGuestAndName} */
export function findAccountByGuestAndName(guestId, nameNormalized) {
  return sql`SELECT * FROM accounts
    WHERE guest_id = ${guestId} AND name_normalized = ${nameNormalized} AND deleted_at IS NULL`.get()
}

/** @type {Types.getAccountById} */
export function getAccountById(id) {
  return sql`SELECT * FROM accounts WHERE id = ${id} AND deleted_at IS NULL`.get()
}
