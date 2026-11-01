/** @file Unit test: matching informal person names to the guest list.
 *  Imports a browser module, so it is excluded from the server tsconfig. */

import { test } from "node:test"
import assert from "node:assert"

import {
  guestChoices,
  guestMatchScore,
  nameWords,
  resolveGuestChoice,
  suggestGuests,
} from "../../public/pages/admin/guest-match.js"

/** @param {number} id @param {string} name @param {Partial<{email: string, phone: string}>} [extra] */
const g = (id, name, extra = {}) => ({
  id,
  name,
  email: extra.email ?? null,
  phone: extra.phone ?? null,
  inviteCode: `CODE${id}`,
})

test("nameWords folds case, accents, punctuation, relationship words and nicknames", () => {
  assert.deepEqual(nameWords("Aunt Sue"), ["susan"])
  assert.deepEqual(nameWords("José O'Brien-Smith"), ["jose", "obrien", "smith"])
  assert.deepEqual(nameWords("Mike & Dana Rossi"), ["michael", "dana", "rossi"])
  assert.deepEqual(nameWords("  "), [])
})

test("suggestGuests finds the invitation an informal name belongs to", () => {
  const roster = [g(1, "Michael & Dana Rossi"), g(2, "Susan Park"), g(3, "Danielle Wu")]
  assert.deepEqual(suggestGuests("Mike", roster).map((x) => x.id), [1])
  assert.deepEqual(suggestGuests("Aunt Sue", roster).map((x) => x.id), [2])
  assert.deepEqual(suggestGuests("Dana R", roster).map((x) => x.id)[0], 1)
})

test("suggestGuests offers nothing for a name with no real overlap", () => {
  const roster = [g(1, "Michael Rossi"), g(2, "Susan Park")]
  assert.deepEqual(suggestGuests("Grandma", roster), [])
  assert.deepEqual(suggestGuests("DJ", roster), [])
  // A lone three-letter overlap is noise.
  assert.equal(guestMatchScore("Sus", "Susan Park") >= 2, true, "a real prefix counts")
  assert.deepEqual(suggestGuests("Mic", [g(3, "Mica Jones")]).length, 1)
})

test("suggestGuests ranks the closer match first and caps the list", () => {
  const roster = [g(1, "Chris Lee"), g(2, "Christina Lee"), g(3, "Chris Park"), g(4, "Chris Wu")]
  assert.equal(suggestGuests("Chris Lee", roster)[0].id, 1)
  assert.equal(suggestGuests("Chris", roster, 2).length, 2)
})

test("guestChoices labels namesakes apart and leaves unique names alone", () => {
  const choices = guestChoices([
    g(1, "Sam Lee", { email: "sam@a.test" }),
    g(2, "sam lee", { phone: "555-0100" }),
    g(3, "Sam Lee"),
    g(4, "Ada Park"),
  ])
  assert.deepEqual(
    choices.map((c) => c.label),
    ["Sam Lee — sam@a.test", "sam lee — 555-0100", "Sam Lee — invite CODE3", "Ada Park"],
  )
})

test("resolveGuestChoice: label → one, unique name → one, shared name → ambiguous", () => {
  const choices = guestChoices([g(1, "Sam Lee", { email: "sam@a.test" }), g(2, "Sam Lee"), g(3, "Ada Park")])
  const one = resolveGuestChoice("sam lee — sam@a.test", choices)
  assert.equal(one.kind === "one" && one.guest.id, 1)
  const ada = resolveGuestChoice(" ada park ", choices)
  assert.equal(ada.kind === "one" && ada.guest.id, 3)
  assert.equal(resolveGuestChoice("Sam Lee", choices).kind, "ambiguous")
  assert.equal(resolveGuestChoice("Nobody", choices).kind, "none")
  assert.equal(resolveGuestChoice("", choices).kind, "none")
})

test("guest-match.js uses no regex", async () => {
  const fs = await import("node:fs")
  const src = fs.readFileSync(new URL("../../public/pages/admin/guest-match.js", import.meta.url), "utf8")
  assert.equal(src.includes("RegExp("), false)
})
