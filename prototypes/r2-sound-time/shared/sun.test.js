/** @file Checks for the sun model. Run: node --test prototypes/r2-sound-time/shared/sun.test.js */

import { test } from "node:test"
import assert from "node:assert/strict"
import { sunAt, shadowOf, canonicalHour, anniversaryOf, dayOfYear } from "./sun.js"

test("day of year", () => {
  assert.equal(dayOfYear(2026, 1, 1), 1)
  assert.equal(dayOfYear(2026, 4, 26), 116)
})

test("Portland, late April: high sun at solar noon, set at night", () => {
  // Solar noon in Portland in PDT is ~1:10 pm. Max elevation ≈ 90 − 45.5 + 13.5 ≈ 58°.
  const noon = sunAt({ y: 2026, mo: 4, d: 26, minutes: 13 * 60 + 10 })
  assert.ok(noon.elevation > 55 && noon.elevation < 61, `noon ${noon.elevation}`)
  assert.ok(Math.abs(noon.azimuth - 180) < 5, `due south ${noon.azimuth}`)
  const night = sunAt({ y: 2026, mo: 4, d: 26, minutes: 23 * 60 })
  assert.ok(night.elevation < 0)
  // Sunrise ~6:10 am, sunset ~8:10 pm in late April.
  assert.ok(sunAt({ y: 2026, mo: 4, d: 26, minutes: 5 * 60 + 45 }).elevation < 0)
  assert.ok(sunAt({ y: 2026, mo: 4, d: 26, minutes: 6 * 60 + 45 }).elevation > 0)
  assert.ok(sunAt({ y: 2026, mo: 4, d: 26, minutes: 19 * 60 + 45 }).elevation > 0)
  assert.ok(sunAt({ y: 2026, mo: 4, d: 26, minutes: 20 * 60 + 45 }).elevation < 0)
})

test("morning sun in the east casts shadows west (left); evening east (right)", () => {
  const am = shadowOf(sunAt({ y: 2026, mo: 4, d: 27, minutes: 8 * 60 }))
  const pm = shadowOf(sunAt({ y: 2026, mo: 4, d: 27, minutes: 18 * 60 }))
  assert.ok(am.dx < 0 && pm.dx > 0)
  const noon = shadowOf(sunAt({ y: 2026, mo: 4, d: 27, minutes: 13 * 60 + 10 }))
  assert.ok(noon.dy < 0, "noon shadow points north, up the page")
  assert.ok(Math.hypot(noon.dx, noon.dy) < Math.hypot(pm.dx, pm.dy), "long evening shadow")
  assert.ok(pm.warmth > noon.warmth)
})

test("night is lamplit, not shadowed", () => {
  const s = shadowOf(sunAt({ y: 2026, mo: 4, d: 28, minutes: 3 * 60 + 36 }))
  assert.equal(s.night, true)
})

test("canonical hours and anniversaries", () => {
  assert.equal(canonicalHour(3 * 60 + 36).name, "Lauds")
  assert.equal(canonicalHour(23 * 60 + 59).name, "Compline")
  assert.equal(canonicalHour(0).name, "Matins")
  assert.equal(anniversaryOf(0).name, "fresh ink")
  assert.equal(anniversaryOf(1).name, "paper")
  assert.equal(anniversaryOf(12).name, "tin")
  assert.equal(anniversaryOf(25).name, "silver")
})
