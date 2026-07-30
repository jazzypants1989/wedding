/** @file Unit test: the constraints on public/vision/ itself.
 *
 *  SPEC-vision-lab.md §4 rests on one property — that public/vision/ is pure
 *  numeric JS with no node:* and no DOM — because that is what lets the same
 *  code serve the CLI, a Web Worker and these tests without forking the
 *  pipeline. `npm run typecheck` catches a node: import (public/tsconfig.json
 *  declares no node types), but nothing catches a DOM reference, and nothing at
 *  all catches it if the tsconfig is ever changed. So it is asserted here too.
 *
 *  Also checks that the defaults table stays the shape effect-controls.js can
 *  build a UI from, which is what makes the tier-5 vision bench nearly free —
 *  the same guarantee tests/unit/effect-themes.test.js provides for effects.
 *
 *  Imports browser vision modules, so this file is excluded from the server
 *  tsconfig (see tsconfig.json).
 */

import { test } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { allDefaults, configSections, getDefaults } from "../../public/vision/defaults.js"

const VISION_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/vision")

/** Every .js file in public/vision/, read as source. */
function visionSources() {
  return fs
    .readdirSync(VISION_DIR)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, source: fs.readFileSync(path.join(VISION_DIR, name), "utf8") }))
}

test("public/vision/ has modules to check", () => {
  // Guards against this whole file passing vacuously if the directory moves.
  assert.ok(visionSources().length >= 4)
})

test("no module in public/vision/ imports node:*", () => {
  for (const { name, source } of visionSources()) {
    assert.ok(!source.includes('"node:'), `${name} imports a node: builtin`)
    assert.ok(!source.includes("'node:"), `${name} imports a node: builtin`)
    assert.ok(!source.includes("require("), `${name} uses require()`)
  }
})

test("no module in public/vision/ touches the DOM or the network", () => {
  // Not exhaustive, and not meant to be — it catches the reflexive additions
  // (a canvas for decoding, a fetch for weights) that would quietly make this
  // code browser-only and untestable.
  const banned = ["document.", "window.", "fetch(", "localStorage", "OffscreenCanvas", "createImageBitmap"]
  for (const { name, source } of visionSources()) {
    for (const token of banned) {
      assert.ok(!source.includes(token), `${name} references ${token}`)
    }
  }
})

test("public/vision/ imports nothing outside itself", () => {
  for (const { name, source } of visionSources()) {
    for (const line of source.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("import ")) continue
      assert.ok(
        !trimmed.includes("../"),
        `${name} reaches outside public/vision/: ${trimmed}`,
      )
    }
  }
})

test("every defaults section is a flat table of plain values", () => {
  // effect-controls.js infers a control from each value's runtime type. A nested
  // object or an array of objects would silently get no control, which is how a
  // knob ends up hard-coded after all.
  for (const section of configSections()) {
    const values = getDefaults(section)
    assert.ok(Object.keys(values).length > 0, `${section} is empty`)
    for (const [key, value] of Object.entries(values)) {
      const kind = typeof value
      assert.ok(
        kind === "number" || kind === "boolean" || kind === "string",
        `${section}.${key} is ${kind}, which no control can be inferred from`,
      )
      if (kind === "number") {
        assert.ok(Number.isFinite(value), `${section}.${key} is not finite`)
      }
    }
  }
})

test("getDefaults hands out copies, so a caller cannot retune the table", () => {
  const first = getDefaults("gate")
  first.minBoxPx = 9999
  assert.notEqual(getDefaults("gate").minBoxPx, 9999)

  const all = allDefaults()
  all.detect.longEdge = 1
  assert.notEqual(allDefaults().detect.longEdge, 1)
})

test("getDefaults rejects an unknown section instead of returning empty", () => {
  assert.throws(() => getDefaults("nope"), /Unknown vision config section/)
})

test("the grouping cutoff is tighter than the reference verification threshold", () => {
  // The design deliberately over-splits: one person in three groups costs two
  // clicks, two people welded into one is expensive to notice and annoying to
  // unpick. 0.363 is a cosine SIMILARITY, so the equivalent distance is 1-0.363
  // — and if this assertion ever fails, someone has confused the two
  // conventions, which is the single easiest mistake to make here.
  const { cutoff } = getDefaults("group")
  assert.ok(typeof cutoff === "number" && cutoff < 1 - 0.363, `cutoff ${cutoff} is not tight`)
})
