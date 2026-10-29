/** @file Unit test: no client module builds markup with a `style="…"` attribute.
 *
 *  The CSP's style-src has no 'unsafe-inline' and no style-src-attr allowance,
 *  so an inline style attribute in a template is silently dropped by the
 *  browser — no error, no test failure, just a progress bar stuck at full width
 *  or every monogram avatar the same blue (T18). CSSOM writes (`el.style.x = …`)
 *  are not covered by style-src-attr and are the working alternative; so are
 *  classes. This scan is the only guard, so it walks every served .js file.
 *
 *  Skips public/pages/demo/_demo/ — generated, dev-only snapshots.
 */

import { test } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"

const PUBLIC = path.join(import.meta.dirname, "..", "..", "public")
const SKIP = path.join(PUBLIC, "pages", "demo", "_demo")

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (full === SKIP) continue
    if (entry.isDirectory()) out.push(...jsFiles(full))
    else if (entry.name.endsWith(".js")) out.push(full)
  }
  return out
}

test("no served client module emits an inline style attribute", () => {
  /** @type {string[]} */
  const offenders = []
  for (const file of jsFiles(PUBLIC)) {
    const lines = fs.readFileSync(file, "utf8").split("\n")
    lines.forEach((line, i) => {
      if (line.includes('style="') || line.includes("style='")) {
        offenders.push(`${path.relative(PUBLIC, file)}:${i + 1}`)
      }
    })
  }
  assert.deepStrictEqual(offenders, [], "inline style attributes are blocked by the CSP")
})
