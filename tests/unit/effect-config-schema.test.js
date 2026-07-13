/** @file Drift test: the server-side effect-config schema mirror (core/) must
 *  stay in lockstep with the browser EFFECT_CONFIGS defaults (public/effects/
 *  config.js). Imports the browser config module, so this file is excluded from
 *  the server tsconfig (see tsconfig.json) — same pattern as effect-themes.test.js.
 *
 *  Beyond id/key parity, this asserts each per-key spec's `kind` and numeric
 *  bounds are consistent with the shipped default value, so a mis-classified key
 *  (e.g. tagging a color-string key as a number) or a bound tighter than the
 *  real default is caught here rather than silently rejecting valid overrides.
 */

import { test } from "node:test"
import assert from "node:assert"
import { EFFECT_CONFIG_KEYS, EFFECT_CONFIG_SPECS } from "../../core/effect-config-schema.js"
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

test("each key spec's kind and bounds accept the shipped default", () => {
  for (const id of Object.keys(EFFECT_CONFIGS)) {
    const entry = EFFECT_CONFIGS[/** @type {keyof typeof EFFECT_CONFIGS} */ (id)]
    const defaults = /** @type {Record<string, unknown>} */ (entry.defaults)
    const specs = EFFECT_CONFIG_SPECS[id]
    for (const key of Object.keys(defaults)) {
      const spec = specs[key]
      const dv = defaults[key]
      const label = `${id}.${key}`
      switch (spec.kind) {
        case "number":
        case "count":
          assert.strictEqual(typeof dv, "number", `${label} default should be a number`)
          assert.ok(
            typeof dv === "number" && dv >= spec.min && dv <= spec.max,
            `${label} default ${dv} outside [${spec.min}, ${spec.max}]`,
          )
          break
        case "string":
          assert.strictEqual(typeof dv, "string", `${label} default should be a string`)
          break
        case "numberArray":
          assert.ok(Array.isArray(dv), `${label} default should be an array`)
          if (Array.isArray(dv)) {
            assert.ok(
              dv.length >= spec.minItems && dv.length <= spec.maxItems,
              `${label} default arity ${dv.length} outside [${spec.minItems}, ${spec.maxItems}]`,
            )
            for (const el of dv) {
              assert.strictEqual(typeof el, "number", `${label} element should be a number`)
              assert.ok(
                typeof el === "number" && el >= spec.min && el <= spec.max,
                `${label} element ${el} outside [${spec.min}, ${spec.max}]`,
              )
            }
          }
          break
        case "stringArray":
          assert.ok(Array.isArray(dv), `${label} default should be an array`)
          if (Array.isArray(dv)) {
            assert.ok(dv.length <= spec.maxItems, `${label} default has too many entries`)
            for (const el of dv) {
              assert.strictEqual(typeof el, "string", `${label} element should be a string`)
            }
          }
          break
        default:
          assert.fail(`${label} has an unrecognized spec kind`)
      }
    }
  }
})
