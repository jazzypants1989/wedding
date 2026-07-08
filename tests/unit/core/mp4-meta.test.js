import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { blankVideoGps } from "../../../core/mp4-meta.js"
import { makeMp4WithGps, makeMp4 } from "../../media-fixtures.js"

let dir = ""

/**
 * Write a buffer to a temp file and return its path.
 * @param {Buffer} buf @param {string} name @returns {string}
 */
function tmpFile(buf, name) {
  const p = path.join(dir, name)
  fs.writeFileSync(p, buf)
  return p
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp4meta-test-"))
})
after(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true })
})

describe("blankVideoGps", () => {
  it("blanks both GPS carriers (ISO fullbox meta) and keeps the tree byte-length identical", () => {
    const { buffer, coord } = makeMp4WithGps()
    const before = Buffer.from(buffer)
    assert.ok(before.includes(coord), "coord present before blanking")

    const p = tmpFile(buffer, "iso.mp4")
    const regions = blankVideoGps(p)

    const after = fs.readFileSync(p)
    assert.strictEqual(after.length, before.length, "no re-mux: same byte length")
    assert.strictEqual(regions.length, 2, "both carriers blanked")
    assert.ok(regions.some((r) => r.type === "©xyz"))
    assert.ok(regions.some((r) => r.type === "mdta"))
    // The coordinate string must be gone; only the value bytes changed.
    assert.ok(!after.includes(coord), "coord absent after blanking")
    assert.ok(!after.toString("latin1").includes("-098.7654"))
    // Every changed byte is a space, and nothing outside the regions moved.
    for (let i = 0; i < after.length; i++) {
      if (after[i] !== before[i]) {
        assert.strictEqual(after[i], 0x20, `changed byte at ${i} is a space`)
      }
    }
  })

  it("handles QuickTime-style meta (no version/flags)", () => {
    const { buffer, coord } = makeMp4WithGps({ isoMeta: false })
    const p = tmpFile(buffer, "qt.mp4")
    const regions = blankVideoGps(p)
    const after = fs.readFileSync(p)
    assert.strictEqual(regions.length, 2)
    assert.ok(!after.includes(coord))
  })

  it("is a byte-exact no-op on a GPS-free file", () => {
    // A plain ftyp+filler mp4 has no moov/gps atoms.
    const buffer = makeMp4(128)
    const before = Buffer.from(buffer)
    const p = tmpFile(buffer, "clean.mp4")
    const regions = blankVideoGps(p)
    const after = fs.readFileSync(p)
    assert.strictEqual(regions.length, 0)
    assert.deepStrictEqual(after, before)
  })

  it("bails cleanly (no throw) on malformed atom structure", () => {
    // A truncated moov box with a bogus oversized child size.
    const bad = Buffer.concat([
      makeMp4(16),
      Buffer.from([0x00, 0x00, 0x00, 0x30]), // moov size 48...
      Buffer.from("moov", "latin1"),
      Buffer.from([0xff, 0xff, 0xff, 0xff]), // child size = 4GB (overruns)
      Buffer.from("udta", "latin1"),
    ])
    const p = tmpFile(bad, "bad.mp4")
    let regions
    assert.doesNotThrow(() => {
      regions = blankVideoGps(p)
    })
    assert.deepStrictEqual(regions, [])
  })
})
