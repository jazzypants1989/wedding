/** @file Drift test: the server-side EFFECT_CONFIG_KEYS mirror (core/) must stay
 *  in lockstep with the browser EFFECT_CONFIGS defaults (public/effects/config.js).
 *  Imports the browser config module, so this file is excluded from the server
 *  tsconfig (see tsconfig.json) — same pattern as effect-themes.test.js.
 */

import { test } from "node:test"
import assert from "node:assert"
import { EFFECT_CONFIG_KEYS } from "../../core/effect-config-schema.js"
import { EFFECT_CONFIGS } from "../../public/effects/config.js"

test("schema ids match EFFECT_CONFIGS ids exactly", () => {
  const schemaIds = Object.keys(EFFECT_CONFIG_KEYS).sort()
  const configIds = Object.keys(EFFECT_CONFIGS).sort()
  assert.deepStrictEqual(schemaIds, configIds)
})

test("each effect's schema keys match its EFFECT_CONFIGS default keys", () => {
  for (const id of Object.keys(EFFECT_CONFIGS)) {
    const entry = EFFECT_CONFIGS[/** @type {keyof typeof EFFECT_CONFIGS} */ (id)]
    const defaultKeys = Object.keys(entry.defaults).sort()
    const schemaKeys = Array.from(EFFECT_CONFIG_KEYS[id]).sort()
    assert.deepStrictEqual(schemaKeys, defaultKeys, `effect "${id}" keys drifted`)
  }
})
