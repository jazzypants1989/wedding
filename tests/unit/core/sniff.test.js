import { describe, it } from "node:test"
import assert from "node:assert"
import { sniffMagic, extForSniff, contentTypeAgrees } from "../../../core/sniff.js"
import {
  makeJpeg,
  makePng,
  makeWebp,
  makeMp4,
  makeHeic,
  makeMov,
  makeFtyp,
} from "../../media-fixtures.js"

describe("sniffMagic", () => {
  it("detects jpeg", () => {
    assert.strictEqual(sniffMagic(makeJpeg()), "jpeg")
  })

  it("detects png", () => {
    assert.strictEqual(sniffMagic(makePng()), "png")
  })

  it("detects webp (RIFF + WEBP)", () => {
    assert.strictEqual(sniffMagic(makeWebp()), "webp")
  })

  it("detects mp4 (isom)", () => {
    assert.strictEqual(sniffMagic(makeMp4()), "mp4")
  })

  it("detects heic", () => {
    assert.strictEqual(sniffMagic(makeHeic()), "heic")
  })

  it("detects mov (qt  major brand)", () => {
    assert.strictEqual(sniffMagic(makeMov()), "mov")
  })

  it("detects every registered heic brand", () => {
    for (const brand of ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]) {
      assert.strictEqual(sniffMagic(makeFtyp(brand)), "heic", `brand ${brand}`)
    }
  })

  it("detects every registered mp4 brand incl. the 3gpN camcorder brands", () => {
    for (const brand of ["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "3gp4", "3gp5", "3gp6"]) {
      assert.strictEqual(sniffMagic(makeFtyp(brand)), "mp4", `brand ${brand}`)
    }
  })

  it("returns '' for dead/dropped brands (heif, mp4v)", () => {
    assert.strictEqual(sniffMagic(makeFtyp("heif")), "")
    assert.strictEqual(sniffMagic(makeFtyp("mp4v")), "")
  })

  it("returns '' for an unknown ftyp brand", () => {
    assert.strictEqual(sniffMagic(makeFtyp("xxxx")), "")
  })

  it("returns '' for truncated input (< 12 bytes)", () => {
    assert.strictEqual(sniffMagic(Buffer.from([0xff, 0xd8, 0xff])), "")
    assert.strictEqual(sniffMagic(Buffer.alloc(0)), "")
  })

  it("returns '' for random bytes", () => {
    assert.strictEqual(sniffMagic(Buffer.from("not a real media file!!", "latin1")), "")
  })

  it("does not treat a non-ftyp RIFF as webp", () => {
    const buf = Buffer.alloc(16, 0)
    buf.write("RIFF", 0, "latin1")
    buf.write("AVI ", 8, "latin1")
    assert.strictEqual(sniffMagic(buf), "")
  })
})

describe("extForSniff", () => {
  it("maps jpeg -> jpg and others to themselves", () => {
    assert.strictEqual(extForSniff("jpeg"), "jpg")
    assert.strictEqual(extForSniff("png"), "png")
    assert.strictEqual(extForSniff("webp"), "webp")
    assert.strictEqual(extForSniff("heic"), "heic")
    assert.strictEqual(extForSniff("mp4"), "mp4")
    assert.strictEqual(extForSniff("mov"), "mov")
  })

  it("returns '' for unknown", () => {
    assert.strictEqual(extForSniff(""), "")
    assert.strictEqual(extForSniff("bogus"), "")
  })
})

describe("contentTypeAgrees", () => {
  it("accepts matching content types", () => {
    assert.ok(contentTypeAgrees("image/jpeg", "jpeg"))
    assert.ok(contentTypeAgrees("image/png", "png"))
    assert.ok(contentTypeAgrees("image/webp", "webp"))
    assert.ok(contentTypeAgrees("image/heic", "heic"))
    assert.ok(contentTypeAgrees("image/heif", "heic")) // heif is an alias
    assert.ok(contentTypeAgrees("video/mp4", "mp4"))
    assert.ok(contentTypeAgrees("video/quicktime", "mov"))
  })

  it("ignores case and parameters", () => {
    assert.ok(contentTypeAgrees("IMAGE/JPEG; charset=binary", "jpeg"))
  })

  it("rejects mismatches and missing headers", () => {
    assert.ok(!contentTypeAgrees("image/png", "jpeg"))
    assert.ok(!contentTypeAgrees("application/octet-stream", "jpeg"))
    assert.ok(!contentTypeAgrees(undefined, "jpeg"))
    assert.ok(!contentTypeAgrees("image/jpeg", ""))
  })
})
