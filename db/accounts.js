/** @file Guest account database operations */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"
import { normalizeName, normalizeEmail, now } from "./utils.js"

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

/** @type {Types.findAccountByContactEmail} */
export function findAccountByContactEmail(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return undefined
  // Most-recent non-deleted account with this recovery email. Multiple people in
  // one household could share an email; the newest registration is the best guess.
  return sql`SELECT * FROM accounts
    WHERE contact_email = ${normalized} AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC LIMIT 1`.get()
}

/** @type {Types.listAccounts} */
export function listAccounts({ trusted = null, limit, offset }) {
  const trustedFilter =
    trusted !== null ? sql`AND a.trusted = ${trusted ? 1 : 0}` : sql.empty
  return sql`SELECT a.id, a.name, a.relation, a.trusted, a.guest_id,
      a.contact_email, a.created_at, g.name AS guest_name,
      (SELECT COUNT(*) FROM guestbook_entries e WHERE e.account_id = a.id AND e.deleted_at IS NULL)
      + (SELECT COUNT(*) FROM comments c WHERE c.account_id = a.id AND c.deleted_at IS NULL)
      + (SELECT COUNT(*) FROM media m WHERE m.account_id = a.id AND m.deleted_at IS NULL)
      AS post_count
    FROM accounts a
    LEFT JOIN guests g ON g.id = a.guest_id
    WHERE a.deleted_at IS NULL ${trustedFilter}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${limit} OFFSET ${offset}`.all()
}

/** @type {Types.countAccounts} */
export function countAccounts({ trusted = null }) {
  const trustedFilter =
    trusted !== null ? sql`AND trusted = ${trusted ? 1 : 0}` : sql.empty
  /** @type {import('./types.js').CountResult | undefined} */
  const row = sql`SELECT COUNT(*) AS count FROM accounts
    WHERE deleted_at IS NULL ${trustedFilter}`.get()
  return row ? row.count : 0
}

/** @type {Types.setAccountTrusted} */
export function setAccountTrusted(id, trusted) {
  const result = sql`UPDATE accounts SET trusted = ${trusted ? 1 : 0}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}

/** @type {Types.softDeleteAccount} */
export function softDeleteAccount(id) {
  const result = sql`UPDATE accounts SET deleted_at = ${now()}
    WHERE id = ${id} AND deleted_at IS NULL`.run()
  return result.changes > 0
}
