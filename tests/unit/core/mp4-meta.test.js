import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { blankVideoGps } from "../../../core/mp4-meta.js"
import { makeMp4WithGps, makeMp4WithLoci, makeMp4 } from "../../media-fixtures.js"

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
  it("blanks both GPS carriers (ISO fullbox meta) and keeps the tree byte-length identical", async () => {
    const { buffer, coord } = makeMp4WithGps()
    const before = Buffer.from(buffer)
    assert.ok(before.includes(coord), "coord present before blanking")

    const p = tmpFile(buffer, "iso.mp4")
    const regions = await blankVideoGps(p)

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

  it("handles QuickTime-style meta (no version/flags)", async () => {
    const { buffer, coord } = makeMp4WithGps({ isoMeta: false })
    const p = tmpFile(buffer, "qt.mp4")
    const regions = await blankVideoGps(p)
    const after = fs.readFileSync(p)
    assert.strictEqual(regions.length, 2)
    assert.ok(!after.includes(coord))
  })

  // Regression: `loci` survived a real import and its coordinates were
  // recoverable from the stored original — which for a video IS the public
  // `video` variant (core/media-serve.js resolveServable). ffmpeg writes this
  // carrier, so any clip a guest trimmed or re-encoded can have one.
  it("zeroes the 3GPP loci box, coordinates and place name alike", async () => {
    const { buffer, longitude, latitude, name } = makeMp4WithLoci()
    const before = Buffer.from(buffer)
    const p = tmpFile(buffer, "loci.mp4")

    const regions = await blankVideoGps(p)
    const after = fs.readFileSync(p)

    assert.strictEqual(after.length, before.length, "no re-mux: same byte length")
    assert.deepStrictEqual(
      regions.map((r) => r.type),
      ["loci"],
    )

    // The coordinates must not be recoverable from the fixed-point fields.
    const at = after.indexOf(Buffer.from("loci", "latin1"))
    let off = at + 4 + 4 + 2 // type + version/flags + language
    while (after[off] !== 0) off++ // name (now empty, so this does not advance)
    off += 2 // name terminator + role
    assert.strictEqual(after.readInt32BE(off) / 65536, 0, "longitude zeroed")
    assert.strictEqual(after.readInt32BE(off + 4) / 65536, 0, "latitude zeroed")
    assert.ok(before.includes(Buffer.from(name, "latin1")), "name present before")
    assert.ok(!after.includes(Buffer.from(name, "latin1")), "place name gone too")

    // Zero, not the space fill the text carriers use: 0x20202020 as 16.16 would
    // decode to 8225.98 degrees, which is worse than a well-formed 0.0.
    assert.notStrictEqual(longitude, 0)
    assert.notStrictEqual(latitude, 0)
    for (let i = 0; i < after.length; i++) {
      if (after[i] !== before[i]) assert.strictEqual(after[i], 0x00, `changed byte at ${i} is zero`)
    }
    // version/flags survive, so the box is still a well-formed FullBox.
    assert.strictEqual(after.readUInt32BE(at + 4), before.readUInt32BE(at + 4))
  })

  it("blanks loci alongside the Apple carriers when a file has both", async () => {
    // Belt and braces: a re-encode can leave the Apple atoms in place and add
    // loci, and one carrier being handled must not short-circuit the others.
    const apple = makeMp4WithGps()
    const loci = makeMp4WithLoci()
    // Two moov boxes is not legal MP4, but blankVideoGps only reads the first,
    // so instead assert each carrier independently reaches its handler.
    const pa = tmpFile(apple.buffer, "both-apple.mp4")
    const pl = tmpFile(loci.buffer, "both-loci.mp4")
    const ra = await blankVideoGps(pa)
    const rl = await blankVideoGps(pl)
    assert.deepStrictEqual(new Set(ra.map((r) => r.type)), new Set(["©xyz", "mdta"]))
    assert.deepStrictEqual(new Set(rl.map((r) => r.type)), new Set(["loci"]))
  })

  it("is a byte-exact no-op on a GPS-free file", async () => {
    // A plain ftyp+filler mp4 has no moov/gps atoms.
    const buffer = makeMp4(128)
    const before = Buffer.from(buffer)
    const p = tmpFile(buffer, "clean.mp4")
    const regions = await blankVideoGps(p)
    const after = fs.readFileSync(p)
    assert.strictEqual(regions.length, 0)
    assert.deepStrictEqual(after, before)
  })

  it("bails cleanly (no reject) on malformed atom structure", async () => {
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
    await assert.doesNotReject(async () => {
      regions = await blankVideoGps(p)
    })
    assert.deepStrictEqual(regions, [])
  })
})
