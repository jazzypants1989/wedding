/** @file Unit test: effect theme resolution + getEffectiveConfig's layered
 *  merge (defaults ⊕ active theme ⊕ localStorage), including the corrupt-JSON
 *  guard. Imports browser effect modules, so this file is excluded from the
 *  server tsconfig (see tsconfig.json) — same pattern as reaction-glyphs.test.js.
 */

import { test } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import {
  resolveTheme,
  DEFAULT_THEME_ID,
  EFFECT_THEMES,
} from "../../public/effects/themes.js"
import { getEffectiveConfig, getDefaultConfig, EFFECT_CONFIGS } from "../../public/effects/config.js"
import {
  EFFECT_DEFINITIONS,
  EFFECT_PAGES,
  PLACEABLE_EFFECT_PAGES,
  effectRunsOn,
  effectPlacedOn,
  effectStartsOn,
  effectPageFromPath,
} from "../../public/effects/registry.js"
import { LABELS } from "../../public/effects/control-meta.js"
import { THEME_IDS } from "../../api/admin/site-content.js"
import { THANK_YOU_THEME_VALUES } from "../../types.js"
import { CONTENT } from "../../content.js"

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
  // No globalThis.document → default theme (mermaid-disco), whose only override
  // for these two is where they run.
  assert.deepEqual(getEffectiveConfig("parallaxsparkles"), {
    ...getDefaultConfig("parallaxsparkles"),
    pages: "all",
  })
  assert.deepEqual(getEffectiveConfig("shimmer"), getDefaultConfig("shimmer"))
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

test("app_state override (data-effect-config) layers over theme, under localStorage", () => {
  // The server inlines a site-wide override onto <html data-effect-config>; the
  // client layers it defaults ⊕ theme ⊕ app_state ⊕ localStorage.
  globalThis.document = {
    documentElement: {
      dataset: {
        effectTheme: "elegant",
        effectConfig: JSON.stringify({ parallaxsparkles: { density: 42, glowThreshold: 0.9 } }),
      },
    },
  }
  try {
    const cfg = getEffectiveConfig("parallaxsparkles")
    assert.ok(cfg)
    assert.equal(cfg.density, 42) // app_state beats the theme's 10
    assert.equal(cfg.glowThreshold, 0.9) // app_state sets a key the theme didn't
    assert.equal(cfg.colorScheme, "gold") // theme layer still applies where app_state is silent

    // localStorage still wins over the app_state layer.
    globalThis.localStorage = {
      getItem: () => JSON.stringify({ parallaxsparkles: { density: 7 } }),
    }
    const cfg2 = getEffectiveConfig("parallaxsparkles")
    assert.ok(cfg2)
    assert.equal(cfg2.density, 7) // localStorage beats app_state's 42
    assert.equal(cfg2.glowThreshold, 0.9) // app_state key survives where localStorage is silent
  } finally {
    delete globalThis.localStorage
    delete globalThis.document
  }
})

test("corrupt data-effect-config is ignored (falls back to theme + defaults)", () => {
  globalThis.document = {
    documentElement: { dataset: { effectTheme: "elegant", effectConfig: "{ not json" } },
  }
  try {
    const cfg = getEffectiveConfig("parallaxsparkles")
    assert.ok(cfg)
    assert.equal(cfg.density, 10) // corrupt app_state ignored → theme's 10 stands
    assert.equal(cfg.colorScheme, "gold")
  } finally {
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

test("the effect registry and EFFECT_CONFIGS cover exactly the same ids", () => {
  // A new effect added to one but not the other ships broken: a registered id
  // with no config runs on {} defaults; a config with no factory is dead weight.
  const registryIds = EFFECT_DEFINITIONS.map((d) => d.id).sort()
  const configIds = Object.keys(EFFECT_CONFIGS).sort()
  assert.deepEqual(registryIds, configIds)
})

test("the backend card-theme allowlist matches the shipped EFFECT_THEMES ids exactly", () => {
  // types.js keeps THANK_YOU_THEME_VALUES as a hand-maintained literal (the
  // backend can't import the browser themes module). It's the source of truth
  // the card composer/validator use, so it must be a set-equal mirror of the
  // real EFFECT_THEMES — a drift either way ships a theme one layer can't render
  // or accept.
  const themeIds = EFFECT_THEMES.map((t) => t.id).sort()
  const cardValues = [...THANK_YOU_THEME_VALUES].sort()
  assert.deepEqual(cardValues, themeIds)
})

test("every registered effect id has a human LABELS entry in control-meta.js", () => {
  // The composer's effect editor (and the studio) render LABELS[id]; a registered
  // effect with no label would surface its raw id in the UI.
  for (const def of EFFECT_DEFINITIONS) {
    assert.equal(
      typeof (/** @type {Record<string, string>} */ (LABELS)[def.id]),
      "string",
      `effect "${def.id}" has a LABELS entry`,
    )
    assert.ok(
      (/** @type {Record<string, string>} */ (LABELS)[def.id]).length > 0,
      `effect "${def.id}" label is non-empty`,
    )
  }
})

test("the shipped default theme id agrees across every source of truth", () => {
  // DEFAULT_THEME_ID (themes.js), the content.js CONTENT default, and the server
  // allowlist must all name the same theme, or a fresh page could pick a theme the
  // others reject / don't render.
  assert.equal(CONTENT.theme, DEFAULT_THEME_ID)
  assert.ok(THEME_IDS.has(DEFAULT_THEME_ID))
  assert.ok(
    EFFECT_THEMES.some((t) => t.id === DEFAULT_THEME_ID),
    "DEFAULT_THEME_ID is a real theme",
  )
})

test("registry pages lists name only known pages, and landing set pieces stay home", () => {
  for (const def of EFFECT_DEFINITIONS) {
    for (const page of def.pages || []) {
      assert.ok(EFFECT_PAGES.includes(page), `${def.id}: unknown page "${page}"`)
    }
  }
  const disco = EFFECT_DEFINITIONS.find((d) => d.id === "disco")
  assert.ok(disco)
  assert.equal(effectRunsOn(disco, "home"), true)
  assert.equal(effectRunsOn(disco, "guestbook"), false)
  const unscoped = EFFECT_DEFINITIONS.find((d) => !d.pages)
  assert.ok(unscoped)
  for (const page of EFFECT_PAGES) assert.equal(effectRunsOn(unscoped, page), true)
})

test("effectPageFromPath maps guest pages and rejects everything else", () => {
  assert.equal(effectPageFromPath("/"), "home")
  assert.equal(effectPageFromPath("/guestbook"), "guestbook")
  assert.equal(effectPageFromPath("/guestbook/"), "guestbook")
  assert.equal(effectPageFromPath("/memory-book"), "memory-book")
  assert.equal(effectPageFromPath("/home"), null)
  assert.equal(effectPageFromPath("/admin"), null)
  assert.equal(effectPageFromPath("/studio"), null)
})

// --- Where effects run: the registry limit and the `pages` config key -----------

/** @param {string} id */
function def(id) {
  const found = EFFECT_DEFINITIONS.find((d) => d.id === id)
  assert.ok(found, `registered: ${id}`)
  return found
}

test("a missing pages key means the landing page only", () => {
  const shimmer = def("shimmer")
  assert.equal(effectStartsOn(shimmer, undefined, "home"), true)
  for (const page of /** @type {const} */ (["guestbook", "gallery", "rsvp", "memory-book"])) {
    assert.equal(effectStartsOn(shimmer, undefined, page), false, page)
  }
  // Garbage counts as missing, not as everywhere.
  assert.equal(effectPlacedOn("everywhere", "guestbook"), false)
  assert.equal(effectPlacedOn(7, "home"), true)
})

test('"all" means every placeable page and never the memory book', () => {
  assert.deepEqual([...PLACEABLE_EFFECT_PAGES], ["home", "guestbook", "gallery", "rsvp"])
  const cursor = def("cursor")
  for (const page of PLACEABLE_EFFECT_PAGES) assert.equal(effectStartsOn(cursor, "all", page), true)
  assert.equal(effectStartsOn(cursor, "all", "memory-book"), false)
  // Not even by name: the memory book prints.
  assert.equal(effectStartsOn(cursor, ["memory-book"], "memory-book"), false)
})

test("an explicit list places an effect on exactly those pages", () => {
  const cursor = def("cursor")
  assert.equal(effectStartsOn(cursor, ["guestbook"], "guestbook"), true)
  assert.equal(effectStartsOn(cursor, ["guestbook"], "home"), false)
  assert.equal(effectStartsOn(cursor, ["guestbook"], "gallery"), false)
  assert.equal(effectStartsOn(cursor, [], "home"), false)
})

test("the registry limit wins over any pages config", () => {
  for (const id of ["disco", "textglow", "entrance", "spotlight", "reflections", "tiltdepth"]) {
    const landing = def(id)
    assert.equal(effectStartsOn(landing, "all", "home"), true, id)
    assert.equal(effectStartsOn(landing, "all", "guestbook"), false, id)
    assert.equal(effectStartsOn(landing, ["gallery", "rsvp"], "gallery"), false, id)
  }
})

test("Mermaid Disco sends the cursor trail and parallax sparkles everywhere, nothing else", () => {
  const theme = resolveTheme("mermaid-disco")
  /** @param {string} id @param {import("../../public/effects/types.js").EffectPage} page */
  const startsOn = (id, page) => effectStartsOn(def(id), getEffectiveConfig(id)?.pages, page)
  for (const page of /** @type {const} */ (["guestbook", "gallery", "rsvp"])) {
    const running = theme.effectIds.filter((id) => startsOn(id, page))
    assert.deepEqual(running, ["cursor", "parallaxsparkles"], page)
  }
  assert.deepEqual(theme.effectIds.filter((id) => startsOn(id, "home")), theme.effectIds)
  assert.deepEqual(theme.effectIds.filter((id) => startsOn(id, "memory-book")), [])
})

test("every other theme keeps every effect on the landing page", () => {
  for (const theme of EFFECT_THEMES) {
    if (theme.id === "mermaid-disco") continue
    for (const [id, cfg] of Object.entries(theme.configs || {})) {
      assert.equal(cfg.pages, undefined, `${theme.id}.${id}`)
    }
  }
})

test("the site override's pages layers over the theme's, and the studio's over that", () => {
  globalThis.document = {
    documentElement: {
      dataset: {
        effectTheme: "mermaid-disco",
        effectConfig: JSON.stringify({ cursor: { pages: ["home"] }, shimmer: { pages: "all" } }),
      },
    },
  }
  try {
    assert.deepEqual(getEffectiveConfig("cursor")?.pages, ["home"])
    assert.equal(getEffectiveConfig("shimmer")?.pages, "all")
    globalThis.localStorage = { getItem: () => JSON.stringify({ cursor: { pages: "all" } }) }
    assert.equal(getEffectiveConfig("cursor")?.pages, "all")
  } finally {
    delete globalThis.localStorage
    delete globalThis.document
  }
})

test("autostart is wired into guestbook, gallery and RSVP, and no other page", () => {
  const pagesDir = path.join(import.meta.dirname, "..", "..", "public", "pages")
  const TAG = '<script type="module" src="/effects/autostart.js"></script>'
  /** @type {string[]} */
  const wired = []
  for (const entry of fs.readdirSync(pagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = path.join(pagesDir, entry.name, "index.html")
    if (!fs.existsSync(file)) continue
    const page = fs.readFileSync(file, "utf8")
    if (!page.includes(TAG)) continue
    wired.push(entry.name)
    // What the manager needs on a page it starts on.
    assert.ok(page.includes('data-effect-config="{{effectConfig}}"'), `${entry.name}: config`)
    assert.ok(page.includes('href="/styles/effects.css"'), `${entry.name}: effects.css`)
    assert.equal(page.split(TAG).length, 2, `${entry.name}: one tag`)
  }
  assert.deepEqual(wired.sort(), ["gallery", "guestbook", "rsvp"])
  // The landing page starts the manager itself and must not start it twice.
  assert.ok(!fs.readFileSync(path.join(pagesDir, "index.html"), "utf8").includes(TAG))
})
