/** @file Unit test: the pure dress-code descriptor math (srcset widths, small-image
 *  dedup, portrait handling) and ladder parity with the server's CONTENT_IMAGE_LADDER.
 *  Imports a browser leaf module, so it's excluded from the server tsconfig. */

import { test } from "node:test"
import assert from "node:assert"
import {
  DRESSCODE_LADDER,
  DRESSCODE_SIZES,
  buildDressCodeDescriptor,
} from "../../public/pages/admin/dresscode-descriptor.js"
import { CONTENT_IMAGE_LADDER } from "../../types.js"

test("landscape image gets three distinct rung widths", () => {
  const d = buildDressCodeDescriptor({ fileKey: "abc", width: 2000, height: 1000 })
  assert.strictEqual(d.src, "/media/abc/w1600")
  assert.strictEqual(
    d.srcset,
    "/media/abc/w400 400w, /media/abc/w800 800w, /media/abc/w1600 1600w",
  )
  assert.strictEqual(d.sizes, DRESSCODE_SIZES)
  assert.strictEqual(d.width, 2000)
  assert.strictEqual(d.height, 1000)
})

test("portrait image scales by the long edge (height), not width", () => {
  // longEdge = 2000 (height). Widths: w=1000 → 200 / 400 / 800.
  const d = buildDressCodeDescriptor({ fileKey: "p", width: 1000, height: 2000 })
  assert.strictEqual(
    d.srcset,
    "/media/p/w400 200w, /media/p/w800 400w, /media/p/w1600 800w",
  )
})

test("small image that can't upscale collapses to one width → no srcset/sizes", () => {
  // longEdge = 300, below every rung's maxEdge → every rung is 300w → deduped to one.
  const d = buildDressCodeDescriptor({ fileKey: "s", width: 300, height: 200 })
  assert.strictEqual(d.src, "/media/s/w1600")
  assert.strictEqual(d.srcset, null)
  assert.strictEqual(d.sizes, null)
})

test("medium image dedups the rungs that collapse to the same width", () => {
  // longEdge = 600. w400 → round(600*400/600)=400w; w800/w1600 clamp to scale 1 → 600w (dup).
  const d = buildDressCodeDescriptor({ fileKey: "m", width: 600, height: 400 })
  assert.strictEqual(d.srcset, "/media/m/w400 400w, /media/m/w800 600w")
  assert.strictEqual(d.sizes, DRESSCODE_SIZES)
})

test("zero dimensions degrade safely (null width/height, single rung)", () => {
  const d = buildDressCodeDescriptor({ fileKey: "z", width: 0, height: 0 })
  assert.strictEqual(d.width, null)
  assert.strictEqual(d.height, null)
  assert.strictEqual(d.srcset, null)
  assert.strictEqual(d.src, "/media/z/w1600")
})

test("client ladder names + edges match the server CONTENT_IMAGE_LADDER", () => {
  assert.deepStrictEqual(
    DRESSCODE_LADDER.map((r) => ({ name: r.name, maxEdge: r.maxEdge })),
    CONTENT_IMAGE_LADDER.map((r) => ({ name: r.name, maxEdge: r.maxEdge })),
  )
})
