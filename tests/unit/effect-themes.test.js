/** @file Unit test: effect theme resolution + getEffectiveConfig's layered
 *  merge (defaults ⊕ active theme ⊕ localStorage), including the corrupt-JSON
 *  guard. Imports browser effect modules, so this file is excluded from the
 *  server tsconfig (see tsconfig.json) — same pattern as reaction-glyphs.test.js.
 */

import { test } from "node:test"
import assert from "node:assert"
import {
  resolveTheme,
  DEFAULT_THEME_ID,
  EFFECT_THEMES,
} from "../../public/effects/themes.js"
import { getEffectiveConfig, getDefaultConfig } from "../../public/effects/config.js"
import { THEME_IDS } from "../../api/admin/site-content.js"

test("resolveTheme returns the matching theme, else the default", () => {
  assert.equal(resolveTheme("elegant").id, "elegant")
  assert.equal(resolveTheme("nope").id, DEFAULT_THEME_ID)
  assert.equal(resolveTheme(undefined).id, DEFAULT_THEME_ID)
})

test("every theme references only registered effect ids", () => {
  for (const theme of EFFECT_THEMES) {
    for (const id of theme.effectIds) {
      assert.ok(getDefaultConfig(id), `theme ${theme.id}: effect "${id}" has a config`)
    }
    for (const id of Object.keys(theme.configs || {})) {
      assert.ok(theme.effectIds.includes(id), `theme ${theme.id}: config "${id}" is in effectIds`)
      assert.ok(getDefaultConfig(id), `theme ${theme.id}: config "${id}" has a config`)
    }
  }
})

test("getEffectiveConfig equals defaults with no DOM/localStorage (default theme)", () => {
  // No globalThis.document → default theme (mermaid-disco, no config overrides).
  assert.deepEqual(getEffectiveConfig("parallaxsparkles"), getDefaultConfig("parallaxsparkles"))
})

test("getEffectiveConfig merges the active theme's per-effect override", () => {
  globalThis.document = { documentElement: { dataset: { effectTheme: "elegant" } } }
  try {
    const cfg = getEffectiveConfig("parallaxsparkles")
    assert.ok(cfg)
    assert.equal(cfg.colorScheme, "gold") // elegant softens parallax to gold
    assert.equal(cfg.density, 10)
    // Untouched default keys survive the merge.
    assert.deepEqual(cfg.sizeRange, getDefaultConfig("parallaxsparkles").sizeRange)
  } finally {
    delete globalThis.document
  }
})

test("localStorage override wins over theme + defaults; corrupt JSON is ignored", () => {
  globalThis.document = { documentElement: { dataset: { effectTheme: "elegant" } } }
  globalThis.localStorage = {
    getItem: () => JSON.stringify({ parallaxsparkles: { density: 99 } }),
  }
  try {
    const cfg = getEffectiveConfig("parallaxsparkles")
    assert.ok(cfg)
    assert.equal(cfg.density, 99) // localStorage beats the theme's 10
    assert.equal(cfg.colorScheme, "gold") // theme layer still applies where localStorage is silent
  } finally {
    delete globalThis.localStorage
  }

  globalThis.localStorage = { getItem: () => "{ not json" }
  try {
    const cfg = getEffectiveConfig("parallaxsparkles")
    assert.ok(cfg)
    // Corrupt JSON → override ignored, theme layer still applied.
    assert.equal(cfg.density, 10)
  } finally {
    delete globalThis.localStorage
    delete globalThis.document
  }
})

test("array-valued config keys replace wholesale (no element merge)", () => {
  // parallaxsparkles.sizeRange defaults to [2, 5]. A single-element override must
  // REPLACE the array, not index-merge into [7, 5].
  globalThis.localStorage = {
    getItem: () => JSON.stringify({ parallaxsparkles: { sizeRange: [7] } }),
  }
  try {
    const cfg = getEffectiveConfig("parallaxsparkles")
    assert.ok(cfg)
    assert.deepEqual(cfg.sizeRange, [7])
  } finally {
    delete globalThis.localStorage
  }
})

test("prototype-pollution keys in an override are skipped", () => {
  // A malicious stored blob carrying a nested __proto__ must not reach
  // Object.prototype. JSON.parse gives it as an own key, so the merge must drop it.
  globalThis.localStorage = {
    getItem: () =>
      '{ "parallaxsparkles": { "__proto__": { "polluted": true }, "density": 3 } }',
  }
  try {
    const cfg = getEffectiveConfig("parallaxsparkles")
    assert.ok(cfg)
    assert.equal(cfg.density, 3) // benign sibling key still applied
    assert.equal(/** @type {*} */ ({}).polluted, undefined) // prototype untouched
  } finally {
    delete globalThis.localStorage
  }
})

test("server THEME_IDS allowlist stays in sync with EFFECT_THEMES", () => {
  // The server validates against a hand-maintained THEME_IDS Set (it can't import
  // the browser themes module). This asserts the two never silently drift: every
  // shipped theme is accepted, and the allowlist names no phantom theme.
  const themeIds = EFFECT_THEMES.map((t) => t.id).sort()
  const allowIds = Array.from(THEME_IDS).sort()
  assert.deepEqual(allowIds, themeIds)
})

test("getEffectiveConfig returns null for an unknown effect id", () => {
  assert.equal(getEffectiveConfig("does-not-exist"), null)
})
