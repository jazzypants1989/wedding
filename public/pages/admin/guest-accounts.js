/** @file The Guests list's rows, pure (no DOM), so they are unit-tested.
 *
 *  A guest row is an invitation (a household). A person who signs in to the
 *  website with its code gets an account under it, so an invitation row
 *  carries everyone who signed in with it. Someone who signed up without a
 *  code (guest_id NULL), or whose invitation was archived, has no invitation
 *  row to sit under: they are a row of their own, marked as such. No regex
 *  (CLAUDE.md). */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../../types.js' */

/** @type {Types.accountsByGuest} */
export function accountsByGuest(accounts) {
  /** @type {Map<number, Types.AccountRow[]>} */
  const map = new Map()
  for (const a of accounts) {
    if (a.guest_id === null) continue
    const list = map.get(a.guest_id)
    if (list) list.push(a)
    else map.set(a.guest_id, [a])
  }
  for (const list of map.values()) list.sort(byName)
  return map
}

/** @param {{ name: string }} a @param {{ name: string }} b */
function byName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
}

/** @type {Types.accountMatches} */
export function accountMatches(a, q) {
  if (!q) return true
  return [a.name, a.contact_email ?? "", a.relation ?? ""].join(" ").toLowerCase().includes(q)
}

/** @type {Types.guestMatches} */
export function guestMatches(g, accounts, q) {
  if (!q) return true
  const hay = [g.name, g.email ?? "", g.phone ?? "", g.invite_code].join(" ").toLowerCase()
  if (hay.includes(q)) return true
  if (accounts.some((a) => accountMatches(a, q))) return true
  const digits = [...q].filter((c) => c >= "0" && c <= "9").join("")
  return digits.length >= 3 && (g.phone ?? "").includes(digits)
}

/** @type {Types.rosterEntries} */
export function rosterEntries({ guests, archived, accounts, filter, q, rsvpOf }) {
  const needle = q.trim().toLowerCase()
  const byGuest = accountsByGuest(accounts)
  /** @type {Types.RosterEntry[]} */
  const out = []
  /** @param {GlobalTypes.GuestWithInviteCount} g */
  const guestEntry = (g) => {
    const own = byGuest.get(g.id) ?? []
    if (guestMatches(g, own, needle)) {
      out.push({ kind: "guest", key: `g${g.id}`, guest: g, accounts: own })
    }
  }

  if (filter === "archived") {
    for (const g of archived ?? []) guestEntry(g)
    return sortEntries(out)
  }
  if (filter !== "uninvited") {
    for (const g of guests) if (filter === "all" || rsvpOf(g) === filter) guestEntry(g)
  }
  if (filter === "all" || filter === "uninvited") {
    const onList = new Set(guests.map((g) => g.id))
    for (const a of accounts) {
      const noInvite = a.guest_id === null
      // An archived invitation's people stay findable under Everyone; the
      // "without an invitation" filter is only the ones who never had a code.
      const archivedInvite = !noInvite && !onList.has(/** @type {number} */ (a.guest_id))
      if (!(noInvite || (filter === "all" && archivedInvite))) continue
      if (!accountMatches(a, needle)) continue
      out.push({ kind: "person", key: `a${a.id}`, account: a, archivedInvite })
    }
  }
  return sortEntries(out)
}

/** @param {Types.RosterEntry[]} entries */
function sortEntries(entries) {
  /** @param {Types.RosterEntry} e */
  const name = (e) => (e.kind === "guest" ? e.guest.name : e.account.name)
  return entries.sort((a, b) => byName({ name: name(a) }, { name: name(b) }))
}

/** @type {Types.uninvitedCount} */
export function uninvitedCount(accounts) {
  return accounts.filter((a) => a.guest_id === null).length
}

/** @type {Types.parseRosterSel} */
export function parseRosterSel(sel) {
  if (!sel || sel.length < 2) return null
  const head = sel[0]
  if (head !== "g" && head !== "a") return null
  const n = Number(sel.slice(1))
  if (!Number.isInteger(n) || n <= 0) return null
  return head === "g" ? { kind: "guest", id: n } : { kind: "account", id: n }
}

/** @type {Types.entryPath} */
export function entryPath(entry) {
  return `/admin/guests/${entry.key}`
}
