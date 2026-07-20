/** @file Unit tests for the guest thank-you card page's pure logic: the reveal
 *  stage machine's exported order, card-theme resolution, and that the card
 *  presentation layer covers exactly the shipped backend theme allowlist.
 *  Imports browser modules, so this file is excluded from the server tsconfig
 *  (same pattern as effect-themes.test.js). */

import { test } from "node:test"
import assert from "node:assert"

import { REVEAL_STAGES } from "../../public/pages/thanks/reveal.js"
import { CARD_THEMES, resolveCardTheme } from "../../public/pages/thanks/card-themes.js"
import { THANK_YOU_THEME_VALUES } from "../../types.js"

test("REVEAL_STAGES lists the reveal choreography in order, ending at complete", () => {
  assert.deepEqual(REVEAL_STAGES, [
    "sealed",
    "opening",
    "unfolding",
    "message",
    "photos",
    "ambient",
    "reply",
    "complete",
  ])
  // The stage machine's skip() jumps to the final stage — assert that's `complete`.
  assert.equal(REVEAL_STAGES[REVEAL_STAGES.length - 1], "complete")
  // sealed is first (the interaction gate that waits for the envelope tap).
  assert.equal(REVEAL_STAGES[0], "sealed")
})

test("resolveCardTheme returns the matching theme, else falls back to classic", () => {
  assert.equal(resolveCardTheme("gratitude"), CARD_THEMES.gratitude)
  assert.equal(resolveCardTheme("celebration"), CARD_THEMES.celebration)
  // Unknown / garbage id → the classic paper palette, never undefined.
  assert.equal(resolveCardTheme("nope"), CARD_THEMES.classic)
  assert.equal(resolveCardTheme(""), CARD_THEMES.classic)
})

test("CARD_THEMES covers exactly the backend THANK_YOU_THEME_VALUES", () => {
  const cardIds = Object.keys(CARD_THEMES).sort()
  const themeIds = [...THANK_YOU_THEME_VALUES].sort()
  assert.deepEqual(cardIds, themeIds)
})

test("every card theme carries the four paper vars", () => {
  for (const [id, theme] of Object.entries(CARD_THEMES)) {
    for (const key of ["paper", "ink", "accent", "envelope"]) {
      assert.equal(typeof theme[key], "string", `${id}.${key} is a string`)
      assert.ok(theme[key].length > 0, `${id}.${key} is non-empty`)
    }
  }
})
