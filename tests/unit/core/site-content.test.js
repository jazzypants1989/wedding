/**
 * Unit tests for core/site-content.js deepMerge — the CONTENT ⊕ override logic
 * behind runtime-editable site content.
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { deepMerge, diffFromDefaults } from "../../../core/site-content.js"
import { CONTENT } from "../../../content.js"

/** Deep, mutable clone of the frozen defaults (any-typed to allow test edits). */
function cloneContent() {
  return /** @type {any} */ (JSON.parse(JSON.stringify(CONTENT)))
}

describe("deepMerge (site content override)", () => {
  it("empty override returns content equal to defaults", () => {
    const result = deepMerge(CONTENT, {})
    assert.deepStrictEqual(result, CONTENT)
    // Must be a fresh object, not the frozen default itself.
    assert.notStrictEqual(result, CONTENT)
  })

  it("overrides a nested scalar without disturbing siblings", () => {
    const result = deepMerge(CONTENT, { couple: { display: "Alex & Sam" } })
    assert.strictEqual(result.couple.display, "Alex & Sam")
    // Sibling keys under couple survive.
    assert.strictEqual(result.couple.monogram, CONTENT.couple.monogram)
    assert.strictEqual(result.location, CONTENT.location)
  })

  it("replaces arrays wholesale (does not element-merge nav)", () => {
    const nav = [{ href: "#", label: "Home" }]
    const result = deepMerge(CONTENT, { nav: { pre: nav } })
    assert.deepStrictEqual(result.nav.pre, nav)
    // post nav untouched.
    assert.deepStrictEqual(result.nav.post, CONTENT.nav.post)
  })

  it("merges each mode's copy independently", () => {
    const result = deepMerge(CONTENT, {
      copy: { post: { welcomeHeading: "Cheers" } },
    })
    assert.strictEqual(result.copy.post.welcomeHeading, "Cheers")
    // post.welcomeIntro preserved; pre copy untouched.
    assert.strictEqual(result.copy.post.welcomeIntro, CONTENT.copy.post.welcomeIntro)
    assert.deepStrictEqual(result.copy.pre, CONTENT.copy.pre)
  })

  it("applies an explicit null override (e.g. clearing footer link)", () => {
    const result = deepMerge(CONTENT, { footer: { githubUrl: null } })
    assert.strictEqual(result.footer.githubUrl, null)
  })

  it("does not mutate the frozen defaults", () => {
    const before = CONTENT.couple.display
    deepMerge(CONTENT, { couple: { display: "Mutated?" } })
    assert.strictEqual(CONTENT.couple.display, before)
  })

  it("ignores prototype keys from parsed JSON (no prototype pollution)", () => {
    const malicious = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"couple":{"display":"Legit"}}',
    )
    const result = deepMerge(CONTENT, malicious)
    // Object.prototype must be untouched, and no polluted key leaks onto result.
    assert.strictEqual(/** @type {any} */ ({}).polluted, undefined)
    assert.strictEqual(Object.hasOwn(result, "polluted"), false)
    // The legitimate sibling key is still applied.
    assert.strictEqual(result.couple.display, "Legit")
  })
})

describe("diffFromDefaults (sparse override storage)", () => {
  it("returns {} when the full content equals the defaults", () => {
    assert.deepStrictEqual(diffFromDefaults(CONTENT), {})
  })

  it("keeps only the changed nested scalar", () => {
    const full = cloneContent()
    full.couple.display = "Alex & Sam"
    assert.deepStrictEqual(diffFromDefaults(full), { couple: { display: "Alex & Sam" } })
  })

  it("stores a changed array wholesale and nothing else", () => {
    const full = cloneContent()
    full.nav.pre = [{ href: "#", label: "Home" }]
    assert.deepStrictEqual(diffFromDefaults(full), {
      nav: { pre: [{ href: "#", label: "Home" }] },
    })
  })

  it("round-trips: deepMerge(defaults, diff) reconstructs the full content", () => {
    const full = cloneContent()
    full.location = "Somewhere Else"
    full.couple.monogram = "A&S"
    const diff = diffFromDefaults(full)
    assert.deepStrictEqual(deepMerge(CONTENT, diff), full)
  })

  it("never emits a prototype key into the diff", () => {
    // A crafted 'full' object with an own __proto__ key must not re-parent the
    // diff or leak the key — mirrors deepMerge's guard on the diff side.
    const full = cloneContent()
    full.couple.display = "Alex & Sam"
    Object.defineProperty(full, "__proto__", {
      value: { polluted: "yes" },
      enumerable: true,
      configurable: true,
    })
    const diff = diffFromDefaults(full)
    assert.strictEqual(Object.hasOwn(diff, "__proto__"), false)
    assert.strictEqual(/** @type {any} */ ({}).polluted, undefined)
    // The legitimate change still lands.
    assert.deepStrictEqual(diff, { couple: { display: "Alex & Sam" } })
  })
})
