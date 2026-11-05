/** @file Unit test: the Guests list's rows — each invitation carries whoever
 *  signed in with its code, people with no invitation are rows of their own,
 *  the "No invitation" filter shows just them, and search finds a person by
 *  the name they signed in with. Fictional names only. */

import { test } from "node:test"
import assert from "node:assert"
import {
  accountsByGuest,
  accountMatches,
  guestMatches,
  rosterEntries,
  uninvitedCount,
  parseRosterSel,
  entryPath,
} from "../../public/pages/admin/guest-accounts.js"

/** @import { AccountRow } from '../../public/pages/admin/types.js' */
/** @import { GuestWithInviteCount } from '../../types.js' */

/** @param {number} id @param {string} name @param {Partial<GuestWithInviteCount>} [extra] */
function guest(id, name, extra = {}) {
  return /** @type {GuestWithInviteCount} */ ({
    id,
    name,
    email: `g${id}@example.test`,
    phone: null,
    party_size: 2,
    invite_code: `CODE${id}`,
    status: "invited",
    notes: null,
    last_invited_at: null,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    deleted_at: null,
    invite_count: 0,
    ...extra,
  })
}

/** @param {number} id @param {string} name @param {number | null} guestId @param {Partial<AccountRow>} [extra] */
function account(id, name, guestId, extra = {}) {
  return /** @type {AccountRow} */ ({
    id,
    name,
    relation: null,
    trusted: false,
    source: guestId === null ? "open registration" : "household",
    guest_id: guestId,
    contact_email: null,
    post_count: 0,
    pending_count: 0,
    created_at: "2026-02-01 00:00:00",
    last_seen_at: null,
    ...extra,
  })
}

const guests = [guest(1, "The Méndez Family"), guest(2, "Theo Lindqvist"), guest(3, "Ann Ash")]
const accounts = [
  account(10, "Rosa Méndez", 1, { trusted: true }),
  account(11, "Daniel Méndez", 1),
  account(12, "Priya Raman", null, { contact_email: "priya@example.test" }),
  account(13, "Marcus Bell", 99), // signed in with a code whose invitation is archived
]
/** @param {GuestWithInviteCount} g @returns {"yes" | "no" | "awaiting"} */
const rsvpOf = (g) => (g.id === 2 ? "yes" : "awaiting")

/** @param {Partial<import('../../public/pages/admin/types.js').RosterInput>} over */
const roster = (over) =>
  rosterEntries({ guests, archived: null, accounts, filter: "all", q: "", rsvpOf, ...over })

test("an invitation carries everyone who signed in with its code, by name", () => {
  const map = accountsByGuest(accounts)
  assert.deepStrictEqual(
    map.get(1)?.map((a) => a.name),
    ["Daniel Méndez", "Rosa Méndez"],
  )
  assert.strictEqual(map.has(2), false)
  // Nobody without an invitation is filed under one.
  assert.ok(![...map.values()].flat().some((a) => a.guest_id === null))
})

test("Everyone: every invitation, plus a marked row for each person with none on the list", () => {
  const rows = roster({})
  assert.deepStrictEqual(
    rows.map((e) => e.key),
    ["g3", "a13", "a12", "g1", "g2"],
  )
  const rosa = rows.find((e) => e.key === "g1")
  assert.ok(rosa && rosa.kind === "guest")
  assert.deepStrictEqual(
    rosa.accounts.map((a) => a.id),
    [11, 10],
  )
  const priya = rows.find((e) => e.key === "a12")
  assert.ok(priya && priya.kind === "person")
  assert.strictEqual(priya.archivedInvite, false)
  const marcus = rows.find((e) => e.key === "a13")
  assert.ok(marcus && marcus.kind === "person")
  assert.strictEqual(marcus.archivedInvite, true)
})

test("No invitation shows just the people who signed up without one", () => {
  const rows = roster({ filter: "uninvited" })
  assert.deepStrictEqual(
    rows.map((e) => e.key),
    ["a12"],
  )
  assert.strictEqual(uninvitedCount(accounts), 1)
})

test("an RSVP filter shows invitations only", () => {
  assert.deepStrictEqual(
    roster({ filter: "yes" }).map((e) => e.key),
    ["g2"],
  )
  assert.deepStrictEqual(
    roster({ filter: "awaiting" }).map((e) => e.key),
    ["g3", "g1"],
  )
})

test("Archived shows the archived invitations with their people", () => {
  const archived = [guest(99, "Marcus Bell & Co", { deleted_at: "2026-03-01 00:00:00" })]
  const rows = roster({ filter: "archived", archived })
  assert.strictEqual(rows.length, 1)
  const only = rows[0]
  assert.ok(only.kind === "guest")
  assert.deepStrictEqual(
    only.accounts.map((a) => a.id),
    [13],
  )
})

test("search finds an invitation by the name someone signed in with", () => {
  // "Daniel" is nowhere in the invitation itself: only a person who signed in under it.
  assert.deepStrictEqual(
    roster({ q: "Daniel" }).map((e) => e.key),
    ["g1"],
  )
  // A person with no invitation by name, and by recovery email.
  assert.deepStrictEqual(
    roster({ q: "priya" }).map((e) => e.key),
    ["a12"],
  )
  assert.deepStrictEqual(
    roster({ q: "priya@example" }).map((e) => e.key),
    ["a12"],
  )
  // The guest's own fields still match.
  assert.deepStrictEqual(
    roster({ q: "code2" }).map((e) => e.key),
    ["g2"],
  )
  assert.strictEqual(roster({ q: "nobody-like-this" }).length, 0)
})

test("match helpers: lowercased needle, empty matches all", () => {
  assert.strictEqual(accountMatches(accounts[0], ""), true)
  assert.strictEqual(accountMatches(accounts[0], "rosa"), true)
  assert.strictEqual(accountMatches(accounts[0], "theo"), false)
  assert.strictEqual(guestMatches(guests[1], [], "theo"), true)
  assert.strictEqual(guestMatches(guests[1], [accounts[0]], "rosa"), true)
  const phoned = guest(5, "Phone Person", { phone: "+15551234567" })
  assert.strictEqual(guestMatches(phoned, [], "555-123"), true)
  assert.strictEqual(guestMatches(phoned, [], "999"), false)
})

test("a :guest selection is an invitation (g) or a person (a); nothing else", () => {
  assert.deepStrictEqual(parseRosterSel("g12"), { kind: "guest", id: 12 })
  assert.deepStrictEqual(parseRosterSel("a7"), { kind: "account", id: 7 })
  assert.strictEqual(parseRosterSel(undefined), null)
  assert.strictEqual(parseRosterSel(""), null)
  assert.strictEqual(parseRosterSel("g"), null)
  assert.strictEqual(parseRosterSel("x3"), null)
  assert.strictEqual(parseRosterSel("g0"), null)
  assert.strictEqual(parseRosterSel("a-1"), null)
  assert.strictEqual(parseRosterSel("g1.5"), null)
})

test("a row's path is its selection under /admin/guests", () => {
  const [first] = roster({ q: "theo" })
  assert.strictEqual(entryPath(first), "/admin/guests/g2")
  const [priya] = roster({ q: "priya" })
  assert.strictEqual(entryPath(priya), "/admin/guests/a12")
})
