/** @file Unit tests for the thank-you composer's pure helpers: {token} message
 *  substitution (renderMessage) and the sparse config diff the composer stores
 *  in effects_config (diffConfig). Imports a browser module, so this file is
 *  excluded from the server tsconfig (same pattern as thank-you-card.test.js). */

import { test } from "node:test"
import assert from "node:assert"

import {
  renderMessage,
  diffConfig,
  selectTemplateId,
  weaveGift,
  buildSeedMessage,
  THANK_YOU_TEMPLATES,
} from "../../public/pages/admin/thank-you-util.js"

test("renderMessage substitutes {name} and leaves other text intact", () => {
  assert.equal(renderMessage("Dear {name}, thank you!", { name: "Ada" }), "Dear Ada, thank you!")
  // Multiple occurrences all replaced.
  assert.equal(renderMessage("{name} & {name}", { name: "Jo" }), "Jo & Jo")
})

test("renderMessage leaves unknown placeholders untouched and handles empties", () => {
  assert.equal(renderMessage("Hi {name}, see {url}", { name: "Bo" }), "Hi Bo, see {url}")
  assert.equal(renderMessage("", { name: "x" }), "")
  assert.equal(renderMessage("no tokens here", {}), "no tokens here")
  // Non-string template is coerced to empty (defensive).
  assert.equal(renderMessage(/** @type {any} */ (null), { name: "x" }), "")
})

test("renderMessage supports multiple distinct tokens", () => {
  assert.equal(
    renderMessage("Hi {name}, open {url}", { name: "Sam", url: "https://x/thanks?card=abc" }),
    "Hi Sam, open https://x/thanks?card=abc",
  )
})

test("diffConfig keeps only values that differ from the defaults", () => {
  const defaults = { petalCount: 18, sizeRange: [10, 20], colors: ["a", "b"] }
  // Nothing changed → empty partial.
  assert.deepEqual(diffConfig(defaults, { petalCount: 18, sizeRange: [10, 20], colors: ["a", "b"] }), {})
  // One scalar changed.
  assert.deepEqual(diffConfig(defaults, { petalCount: 30, sizeRange: [10, 20], colors: ["a", "b"] }), {
    petalCount: 30,
  })
  // Array changed (deep compare).
  assert.deepEqual(diffConfig(defaults, { petalCount: 18, sizeRange: [12, 24], colors: ["a", "b"] }), {
    sizeRange: [12, 24],
  })
})

test("diffConfig keeps keys absent from defaults and recurses into nested objects", () => {
  assert.deepEqual(diffConfig({ a: 1 }, { a: 1, brandNew: 5 }), { brandNew: 5 })
  // Nested object: only the differing leaf survives; an all-equal nested object is dropped.
  assert.deepEqual(diffConfig({ nest: { x: 1, y: 2 } }, { nest: { x: 1, y: 9 } }), { nest: { y: 9 } })
  assert.deepEqual(diffConfig({ nest: { x: 1, y: 2 } }, { nest: { x: 1, y: 2 } }), {})
})

// ---- smart template selection (task 2) ----

test("selectTemplateId maps gift keywords to the best-fitting template", () => {
  // Honeymoon words win, even when an amount is present (fund contribution).
  assert.equal(selectTemplateId({ description: "Honeymoon fund", amount: "$200" }), "honeymoon")
  assert.equal(selectTemplateId({ description: "Toward your trip to Italy" }), "honeymoon")
  // Cash-ish words / channels.
  assert.equal(selectTemplateId({ description: "Venmo transfer" }), "cash")
  assert.equal(selectTemplateId({ notes: "Sent a check in the mail" }), "cash")
  // Registry / household items.
  assert.equal(selectTemplateId({ description: "Stand mixer from the kitchen registry" }), "registry")
  assert.equal(selectTemplateId({ description: "Bath towel set" }), "registry")
})

test("selectTemplateId falls back on amount, then description, then generic", () => {
  // A bare monetary amount, no keywords → cash.
  assert.equal(selectTemplateId({ description: null, amount: "150", notes: null }), "cash")
  // A described physical item with no keyword hit → registry.
  assert.equal(selectTemplateId({ description: "hand-thrown ceramic mug", amount: null }), "registry")
  // Nothing to go on → generic. Null/undefined gift (gift-less card) → generic.
  assert.equal(selectTemplateId({ description: null, amount: null, notes: null }), "generic")
  assert.equal(selectTemplateId(null), "generic")
  assert.equal(selectTemplateId(undefined), "generic")
})

test("selectTemplateId is case-insensitive and only reads description/notes for keywords", () => {
  assert.equal(selectTemplateId({ description: "HONEYMOON getaway" }), "honeymoon")
  // amount text is a selection signal only via presence, never keyword-matched.
  assert.equal(selectTemplateId({ description: "gorgeous vase", amount: "$0" }), "registry")
})

// ---- gift-slot weaving (task 2) ----

test("weaveGift fills the {gift} slot with the description, else the fallback", () => {
  const tpl = "Thank you for the {gift}!"
  assert.equal(weaveGift(tpl, "stand mixer", "wonderful gift"), "Thank you for the stand mixer!")
  // No description → fallback keeps the sentence natural.
  assert.equal(weaveGift(tpl, "", "wonderful gift"), "Thank you for the wonderful gift!")
  assert.equal(weaveGift(tpl, null, "wonderful gift"), "Thank you for the wonderful gift!")
  // No fallback given → neutral "gift".
  assert.equal(weaveGift(tpl, "  ", undefined), "Thank you for the gift!")
})

test("weaveGift leaves slotless messages untouched and trims descriptions", () => {
  assert.equal(weaveGift("No slot here.", "mixer", "x"), "No slot here.")
  assert.equal(weaveGift("For the {gift}.", "  gravy boat  ", "y"), "For the gravy boat.")
  // Multiple slots all filled.
  assert.equal(weaveGift("{gift} & {gift}", "candles", "z"), "candles & candles")
})

// ---- buildSeedMessage: full smart seed (task 2) ----

test("buildSeedMessage picks a template, weaves the gift, and resolves the first name", () => {
  // No amount + a described item → registry template (which has a {gift} slot).
  const msg = buildSeedMessage(
    { description: "stand mixer", amount: null, notes: null },
    "Ada Lovelace",
  )
  // registry template chosen; {name} → first name; {gift} → description; no raw tokens left.
  assert.ok(msg.startsWith("Dear Ada,"), "resolves {name} to the first name")
  assert.ok(msg.includes("stand mixer"), "weaves the gift description")
  assert.ok(!msg.includes("{name}") && !msg.includes("{gift}"), "leaves no unresolved tokens")
})

test("buildSeedMessage handles honeymoon gifts and gift-less cards", () => {
  const honeymoon = buildSeedMessage({ description: "Honeymoon fund", amount: "$300" }, "Grace Hopper")
  assert.ok(honeymoon.startsWith("Dear Grace,"))
  assert.ok(honeymoon.includes("Honeymoon fund"))
  // Gift-less: general starter, name resolved, no gift slot to worry about.
  const giftless = buildSeedMessage(null, "Katherine Johnson")
  const generic = THANK_YOU_TEMPLATES.find((t) => t.id === "generic")
  assert.equal(giftless, renderMessage(generic.message, { name: "Katherine" }))
  assert.ok(!giftless.includes("{gift}"))
})

test("buildSeedMessage defaults the name to 'friend' when empty", () => {
  const msg = buildSeedMessage(null, "")
  assert.ok(msg.startsWith("Dear friend,"))
})
