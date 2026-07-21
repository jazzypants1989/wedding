/** @file Unit tests for the thank-you composer's occasion presets (D3) and the
 *  "↻ Reroll" seed-copy helper (D2). Pure modules only — no DOM. Imports the
 *  browser effect schema/themes, so this file is excluded from the server
 *  tsconfig (same pattern as effect-themes.test.js). */

import { test } from "node:test"
import assert from "node:assert"
import {
  OCCASION_PRESETS,
  rerollSeedMessage,
  buildSeedMessage,
  THANK_YOU_TEMPLATES,
} from "../../public/pages/admin/thank-you-util.js"
import { EFFECT_CONFIG_SPECS } from "../../core/effect-config-schema.js"
import { EFFECT_THEMES } from "../../public/effects/themes.js"

test("every occasion preset uses a real theme + schema-valid effect ids/keys", () => {
  const themeIds = new Set(EFFECT_THEMES.map((t) => t.id))
  assert.ok(OCCASION_PRESETS.length > 0)
  for (const preset of OCCASION_PRESETS) {
    assert.ok(themeIds.has(preset.theme), `${preset.id}: theme "${preset.theme}" is a real theme`)
    assert.ok(preset.effects.length > 0, `${preset.id}: has at least one effect`)
    for (const eff of preset.effects) {
      const spec = EFFECT_CONFIG_SPECS[eff.id]
      assert.ok(spec, `${preset.id}: effect "${eff.id}" is in the effect-config schema`)
      for (const key of Object.keys(eff.config)) {
        assert.ok(key in spec, `${preset.id}: "${eff.id}.${key}" is a valid config key`)
      }
    }
  }
})

test("occasion preset ids are unique", () => {
  const ids = OCCASION_PRESETS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
})

test("rerollSeedMessage cycles to a different starter than the seeded default", () => {
  const gift = { description: "KitchenAid stand mixer" } // → registry template
  const base = buildSeedMessage(gift, "Alex Rivera")
  const first = rerollSeedMessage(gift, "Alex Rivera", 1)
  assert.notEqual(first, base, "first reroll differs from the gift's best-fit default")
  // Deterministic per click count.
  assert.equal(rerollSeedMessage(gift, "Alex Rivera", 1), first)
  // A full rotation returns to the anchor (== the seeded default).
  const n = THANK_YOU_TEMPLATES.length
  assert.equal(rerollSeedMessage(gift, "Alex Rivera", n), base)
})

test("rerollSeedMessage resolves {name} and weaves the gift slot", () => {
  const out = rerollSeedMessage({ description: "a trip to Kyoto" }, "Sam Lee", 1)
  assert.ok(!out.includes("{name}"), "{name} is resolved")
  assert.ok(!out.includes("{gift}"), "{gift} is woven")
  assert.ok(out.includes("Sam"), "recipient first name appears")
})

test("rerollSeedMessage is stable for a null (gift-less) card and never leaves tokens", () => {
  const a = rerollSeedMessage(null, "Jamie", 2)
  const b = rerollSeedMessage(null, "Jamie", 2)
  assert.equal(a, b)
  assert.ok(!a.includes("{"), "no unresolved placeholders remain")
})
