/** @file Unit tests for scripts/lib/image-backend.js, plus the PPM parser on the
 *  other side of its raw-pixel seam (scripts/vision/pixels-cli.js) — an argv
 *  that asks for 8-bit samples and a header check that verifies it got them are
 *  one guarantee, and splitting them across two files would let one drift.
 *
 *  The parsers and argv builders are tested against canned strings and
 *  hand-built buffers so they run on any machine, installed backends or not.
 *  The few tests that need a real binary probe for one first and skip when it
 *  is absent. No image file is read and no binary is invoked. */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  buildDimensionCommand,
  buildPixelCommand,
  buildPosterCommand,
  buildResizeCommands,
  describeBackends,
  firstLine,
  imageBackendInstallHint,
  magickOrientationToExif,
  parseDimensionOutput,
  parseUint,
  probeImageBackend,
  probeVideoBackend,
  sipsProp,
} from "../../scripts/lib/image-backend.js"
import { MediaImportError } from "../../scripts/lib/media-errors.js"
import { parsePpm } from "../../scripts/vision/pixels-cli.js"

/** @param {Partial<import('../../scripts/lib/types.js').ImageBackend>} [over] */
function backend(over = {}) {
  return /** @type {import('../../scripts/lib/types.js').ImageBackend} */ ({
    name: "vips",
    bin: "vips",
    versionArgs: ["--version"],
    canWebp: true,
    canHeic: true,
    autoOrients: true,
    canRawPixels: true,
    version: "vips-8.17.0",
    headerBin: "vipsheader",
    childEnv: {},
    ...over,
  })
}

describe("parseUint", () => {
  it("parses a run of digits", () => {
    assert.equal(parseUint("1200"), 1200)
    assert.equal(parseUint("  1200\n"), 1200)
    assert.equal(parseUint("0"), 0)
  })

  it("rejects anything that is not purely digits", () => {
    for (const bad of ["", "   ", "12a", "a12", "-1", "1.5", "1 2", "+3", "١٢٣"]) {
      assert.equal(parseUint(bad), null, `rejects ${JSON.stringify(bad)}`)
    }
  })

  it("rejects absurdly long input rather than overflowing", () => {
    assert.equal(parseUint("12345678901234567890"), null)
    assert.equal(parseUint("9999999999"), 9999999999, "10 digits is still fine")
  })
})

describe("sipsProp", () => {
  const output = [
    "/Users/someone/Wedding Photos/IMG_2841.jpg",
    "  pixelWidth: 4032",
    "  pixelHeight: 3024",
  ].join("\n")

  it("reads a property value", () => {
    assert.equal(sipsProp(output, "pixelWidth"), "4032")
    assert.equal(sipsProp(output, "pixelHeight"), "3024")
  })

  it("returns null for a property that is not there", () => {
    assert.equal(sipsProp(output, "orientation"), null)
  })

  it("is not fooled by a path that looks like a property line", () => {
    // A real directory can be named anything, including this.
    const tricky = ["/photos/pixelWidth: 9", "  pixelWidth: 4032"].join("\n")
    assert.equal(sipsProp(tricky, "pixelWidth"), "4032", "scans from the end")
  })

  it("handles a path containing a pipe, which the -1 output form would break on", () => {
    const piped = ["/photos/a|b/IMG.jpg", "  pixelWidth: 800"].join("\n")
    assert.equal(sipsProp(piped, "pixelWidth"), "800")
  })
})

describe("magickOrientationToExif", () => {
  it("maps every ImageMagick orientation word", () => {
    const expected = {
      TopLeft: 1,
      TopRight: 2,
      BottomRight: 3,
      BottomLeft: 4,
      LeftTop: 5,
      RightTop: 6,
      RightBottom: 7,
      LeftBottom: 8,
    }
    for (const [word, value] of Object.entries(expected)) {
      assert.equal(magickOrientationToExif(word), value, word)
    }
  })

  it("treats Undefined and anything unknown as upright", () => {
    assert.equal(magickOrientationToExif("Undefined"), 1)
    assert.equal(magickOrientationToExif("Sideways"), 1)
    assert.equal(magickOrientationToExif(""), 1)
    assert.equal(magickOrientationToExif("constructor"), 1, "no prototype leakage")
    assert.equal(magickOrientationToExif("toString"), 1)
  })
})

describe("firstLine", () => {
  it("takes the first line and drops ImageMagick's prefix", () => {
    assert.equal(firstLine("vips-8.17.0\n"), "vips-8.17.0")
    assert.equal(
      firstLine("Version: ImageMagick 7.1.1-47 Q16-HDRI\nCopyright: (C) 1999"),
      "ImageMagick 7.1.1-47 Q16-HDRI",
    )
    assert.equal(firstLine("sips-316\n"), "sips-316")
  })
})

describe("parseDimensionOutput", () => {
  it("reads vips' two bare numbers", () => {
    assert.deepEqual(parseDimensionOutput(backend(), ["2400\n", "1600\n"]), {
      width: 2400,
      height: 1600,
      orientation: 1,
    })
  })

  it("returns null when vips printed only one value", () => {
    assert.equal(parseDimensionOutput(backend(), ["2400\n"]), null)
  })

  it("reads magick's space-separated triple", () => {
    const be = backend({ name: "magick", bin: "magick" })
    assert.deepEqual(parseDimensionOutput(be, ["2400 1600 RightTop"]), {
      width: 2400,
      height: 1600,
      orientation: 6,
    })
    assert.deepEqual(parseDimensionOutput(be, ["800 600 Undefined"]), {
      width: 800,
      height: 600,
      orientation: 1,
    })
  })

  it("reads sips' multi-line properties", () => {
    const be = backend({ name: "sips", bin: "sips", canWebp: false, autoOrients: false })
    const out = ["/photos/IMG.jpg", "  pixelWidth: 4032", "  pixelHeight: 3024"].join("\n")
    assert.deepEqual(parseDimensionOutput(be, [out]), {
      width: 4032,
      height: 3024,
      orientation: 1,
    })
  })

  it("returns null rather than zero when a dimension is unreadable", () => {
    // Reporting 0 would land a broken aspect ratio in the database — exactly
    // the failure needs_display exists to avoid.
    const be = backend({ name: "sips", bin: "sips" })
    assert.equal(parseDimensionOutput(be, ["/photos/IMG.jpg\n  pixelWidth: what"]), null)
    assert.equal(parseDimensionOutput(be, ["/photos/IMG.jpg"]), null)
    assert.equal(parseDimensionOutput(backend({ name: "magick" }), ["0 0 TopLeft"]), null)
  })
})

describe("buildResizeCommands", () => {
  const common = {
    sourcePath: "/work/src.jpg",
    outPath: "/work/display.webp",
    midPath: "/work/display-rotated.jpg",
    maxEdge: 2000,
    quality: 0.82,
    sourceWidth: 4032,
    sourceHeight: 3024,
  }

  it("builds one vips command with the options in the output filename", () => {
    const cmds = buildResizeCommands(backend(), { ...common, format: "webp", orientation: 1 })
    assert.equal(cmds.length, 1)
    assert.deepEqual(cmds[0], {
      bin: "vips",
      args: [
        "thumbnail",
        "/work/src.jpg",
        "/work/display.webp[Q=82,keep=icc]",
        "2000",
        "--height",
        "2000",
        "--size",
        "down",
      ],
    })
  })

  it("keeps ICC on vips rather than dropping all metadata", () => {
    // keep=none would strip the colour profile too, desaturating Display-P3.
    const cmds = buildResizeCommands(backend(), { ...common, format: "webp", orientation: 1 })
    assert.ok(cmds[0].args.some((a) => a.includes("keep=icc")))
    assert.ok(!cmds[0].args.some((a) => a.includes("keep=none")))
  })

  it("builds one magick command that only shrinks and keeps ICC", () => {
    const be = backend({ name: "magick", bin: "magick" })
    const cmds = buildResizeCommands(be, { ...common, format: "webp", orientation: 6 })
    assert.equal(cmds.length, 1)
    assert.ok(cmds[0].args.includes("-auto-orient"))
    assert.ok(cmds[0].args.includes("2000x2000>"), "the > suffix means shrink-only")
    const profileAt = cmds[0].args.indexOf("+profile")
    assert.equal(cmds[0].args[profileAt + 1], "!icc,*", "drops everything except ICC")
  })

  it("uses IM6's separate identify binary for dimensions", () => {
    const be = backend({ name: "convert", bin: "/opt/homebrew/bin/convert" })
    const cmds = buildDimensionCommand(be, "/work/src.jpg")
    assert.equal(cmds[0].bin, "/opt/homebrew/bin/identify")
  })

  it("gives sips a separate rotate pass when the source is not upright", () => {
    const be = backend({ name: "sips", bin: "sips", canWebp: false, autoOrients: false })
    const cmds = buildResizeCommands(be, { ...common, format: "jpeg", orientation: 6 })
    assert.equal(cmds.length, 2, "rotate then resize")
    assert.deepEqual(cmds[0].args, ["-r", "90", "/work/src.jpg", "--out", "/work/display-rotated.jpg"])
    assert.ok(cmds[1].args.includes("/work/display-rotated.jpg"), "resize reads the rotated file")
  })

  it("skips the sips rotate pass for an upright source", () => {
    const be = backend({ name: "sips", bin: "sips", canWebp: false, autoOrients: false })
    const cmds = buildResizeCommands(be, { ...common, format: "jpeg", orientation: 1 })
    assert.equal(cmds.length, 1)
    assert.ok(cmds[0].args.includes("/work/src.jpg"))
  })

  it("covers every EXIF orientation with a sips transform", () => {
    const be = backend({ name: "sips", bin: "sips", canWebp: false, autoOrients: false })
    for (let orientation = 2; orientation <= 8; orientation++) {
      const cmds = buildResizeCommands(be, { ...common, format: "jpeg", orientation })
      assert.equal(cmds.length, 2, `orientation ${orientation} rotates`)
    }
  })

  it("omits sips -Z when the source already fits, because -Z upscales", () => {
    // Verified against sips-316: `-Z 4000` on a 2400px source produced 4000px.
    const be = backend({ name: "sips", bin: "sips", canWebp: false, autoOrients: false })
    const small = buildResizeCommands(be, {
      ...common,
      format: "jpeg",
      orientation: 1,
      sourceWidth: 800,
      sourceHeight: 600,
    })
    assert.ok(!small[0].args.includes("-Z"), "no resize for an already-small source")

    const large = buildResizeCommands(be, { ...common, format: "jpeg", orientation: 1 })
    assert.ok(large[0].args.includes("-Z"), "resizes when the source is too big")
  })

  it("never emits a shell string — every command is an argv array", () => {
    for (const name of /** @type {const} */ (["vips", "magick", "convert", "sips"])) {
      const be = backend({ name, bin: name, canWebp: name !== "sips" })
      for (const cmd of buildResizeCommands(be, { ...common, format: "jpeg", orientation: 6 })) {
        assert.ok(Array.isArray(cmd.args), `${name} args is an array`)
        for (const arg of cmd.args) assert.equal(typeof arg, "string")
      }
    }
  })

  it("passes a filename with shell metacharacters through untouched", () => {
    const nasty = "/photos/a b; rm -rf $HOME/IMG'1\".jpg"
    const cmds = buildResizeCommands(backend(), {
      ...common,
      sourcePath: nasty,
      format: "webp",
      orientation: 1,
    })
    assert.ok(cmds[0].args.includes(nasty), "no quoting, no escaping — execFile handles it")
  })
})

describe("buildPixelCommand", () => {
  const common = {
    sourcePath: "/work/src.jpg",
    maxEdge: 2000,
    ppmPath: "/work/out.ppm",
  }

  /**
   * @param {import('../../scripts/lib/types.js').ImageBackend} be
   * @param {Partial<import('../../scripts/lib/types.js').PixelCommandOptions>} [over]
   * @returns {import('../../scripts/lib/types.js').PixelCommandPlan}
   */
  function plan(be, over = {}) {
    const built = buildPixelCommand(be, { ...common, ...over })
    if (!built) throw new Error(`${be.name} returned no pixel plan`)
    return built
  }

  it("has vips write a scratch PPM, because its stdout target syntax is per-format", () => {
    const built = plan(backend())
    assert.equal(built.readFrom, "file")
    assert.equal(built.commands.length, 1)
    assert.deepEqual(built.commands[0], {
      bin: "vips",
      args: [
        "thumbnail",
        "/work/src.jpg",
        "/work/out.ppm",
        "2000",
        "--height",
        "2000",
        "--size",
        "down",
      ],
    })
  })

  it("keeps vips' --size down, which is what makes it shrink-only", () => {
    // Same guarantee as magick's `>` suffix below: upscaling would move small
    // faces out of the band the detector was trained on without adding
    // information. Both backends have to agree or the two paths disagree.
    const args = plan(backend()).commands[0].args
    const at = args.indexOf("--size")
    assert.notEqual(at, -1, "vips passes --size")
    assert.equal(args[at + 1], "down")
  })

  it("streams magick's PPM from stdout, decode hint before the source", () => {
    const be = backend({ name: "magick", bin: "magick" })
    const built = plan(be)
    assert.equal(built.readFrom, "stdout")
    assert.equal(built.commands.length, 1)
    assert.deepEqual(built.commands[0], {
      bin: "magick",
      args: [
        "-define",
        "jpeg:size=4000x4000",
        "/work/src.jpg",
        "-auto-orient",
        "-resize",
        "2000x2000>",
        "-depth",
        "8",
        "ppm:-",
      ],
    })
    const args = built.commands[0].args
    assert.ok(
      args.indexOf("-define") < args.indexOf("/work/src.jpg"),
      "a decode hint only helps if it precedes the file it is a hint for",
    )
    assert.ok(args.includes("2000x2000>"), "the > suffix means shrink-only")
  })

  it("asks magick for -depth 8 — a Q16 build otherwise writes 16-bit samples", () => {
    // NOT optional and NOT tidy-away-able. Verified on ImageMagick 7.1.2
    // Q16-HDRI: `ppm:-` emits maxval 65535 without it, i.e. two big-endian
    // bytes per sample. parsePpm catches that (see below) but only because the
    // format has a header; the fix belongs here, at the ask.
    for (const name of /** @type {const} */ (["magick", "convert"])) {
      const args = plan(backend({ name, bin: name })).commands[0].args
      const at = args.indexOf("-depth")
      assert.notEqual(at, -1, `${name} passes -depth`)
      assert.equal(args[at + 1], "8", `${name} asks for 8 bits per sample`)
      assert.ok(at < args.indexOf("ppm:-"), "and asks before the output target")
    }
  })

  it("auto-orients on magick, so the pixels arrive upright", () => {
    const args = plan(backend({ name: "convert", bin: "convert" })).commands[0].args
    assert.ok(args.includes("-auto-orient"))
  })

  it("scales the jpeg decode hint with the requested edge", () => {
    const be = backend({ name: "magick", bin: "magick" })
    const args = plan(be, { maxEdge: 640 }).commands[0].args
    assert.ok(
      args.includes("jpeg:size=1280x1280"),
      "2x the target leaves headroom for the resample to work from",
    )
    assert.ok(args.includes("640x640>"))
  })

  it("uses the binary it was handed rather than assuming `magick` is on PATH", () => {
    const be = backend({ name: "convert", bin: "/opt/homebrew/bin/convert" })
    assert.equal(plan(be).commands[0].bin, "/opt/homebrew/bin/convert")
    assert.equal(plan(backend({ bin: "/opt/homebrew/bin/vips" })).commands[0].bin, "/opt/homebrew/bin/vips")
  })

  it("returns null for sips, which has no pixel path at all", () => {
    // The caller must fall back to another backend or refuse the run; it must
    // not get a command that quietly produces something that is not a PPM.
    const be = backend({
      name: "sips",
      bin: "sips",
      canWebp: false,
      autoOrients: false,
      canRawPixels: false,
    })
    assert.equal(buildPixelCommand(be, common), null)
  })

  it("never emits a shell string — every command is an argv array", () => {
    for (const name of /** @type {const} */ (["vips", "magick", "convert"])) {
      const built = plan(backend({ name, bin: name }))
      for (const cmd of built.commands) {
        assert.ok(Array.isArray(cmd.args), `${name} args is an array`)
        for (const arg of cmd.args) assert.equal(typeof arg, "string", `${name} arg is a string`)
        assert.ok(
          !cmd.args.some((a) => a.includes(" ") && a !== common.sourcePath),
          `${name} never packs two arguments into one element`,
        )
      }
    }
  })

  it("passes a filename with shell metacharacters through as exactly one element", () => {
    // Filenames come from a user's photo directory: spaces, quotes, $, ; and
    // newlines are all legal. execFile takes an argv array, so the right answer
    // is no quoting and no escaping at all.
    const nasty = "/photos/a b; rm -rf $HOME/IMG'1\".jpg\nnext"
    for (const name of /** @type {const} */ (["vips", "magick", "convert"])) {
      const args = plan(backend({ name, bin: name }), { sourcePath: nasty }).commands[0].args
      const hits = args.filter((a) => a === nasty)
      assert.equal(hits.length, 1, `${name} passes the path once, verbatim`)
      assert.equal(
        args.filter((a) => a.includes("rm -rf")).length,
        1,
        `${name} did not split the path on whitespace`,
      )
      assert.ok(!args.some((a) => a.includes("\\$")), `${name} added no escaping`)
      assert.ok(!args.some((a) => a.includes("'/photos") || a.includes('"/photos')), `${name} added no quoting`)
    }
  })
})

describe("parsePpm", () => {
  const HEADER = "P6\n4 2\n255\n"
  /** 4x2 RGB: distinct byte values so a wrong offset shows up immediately. */
  const body24 = () => Buffer.from(Array.from({ length: 24 }, (_, i) => i * 10))

  /** @param {string} header @param {Buffer} [body] @returns {Buffer} */
  function ppm(header, body = Buffer.alloc(0)) {
    return Buffer.concat([Buffer.from(header, "latin1"), body])
  }

  /**
   * @param {Buffer} buf
   * @param {(err: MediaImportError) => void} check
   */
  function rejects(buf, check) {
    assert.throws(
      () => parsePpm(buf, { file: "/photos/IMG_0001.jpg" }),
      (/** @type {MediaImportError} */ err) => {
        assert.ok(err instanceof MediaImportError, "throws the importer's error type")
        assert.equal(err.code, "BACKEND_FAILED", "a malformed buffer means the backend misbehaved")
        assert.equal(err.file, "/photos/IMG_0001.jpg", "carries the file from the context argument")
        check(err)
        return true
      },
    )
  }

  it("parses a minimal P6 file", () => {
    const image = parsePpm(ppm(HEADER, body24()))
    assert.equal(image.width, 4)
    assert.equal(image.height, 2)
    assert.equal(image.rgb.length, 24, "w*h*3")
    assert.equal(image.rgb.length, image.width * image.height * 3)
    assert.equal(image.rgb[0], 0)
    assert.equal(image.rgb[23], 230)
  })

  it("returns a view into the caller's buffer, not a copy", () => {
    // The doc comment promises a view, and a 2000px frame is ~12MB — copying
    // it per photograph is the difference between one allocation and a run's
    // worth of them.
    const buf = ppm(HEADER, body24())
    const image = parsePpm(buf)
    assert.equal(image.rgb.buffer, buf.buffer, "same ArrayBuffer")
    assert.equal(
      image.rgb.byteOffset,
      buf.byteOffset + HEADER.length,
      "offset accounts for Buffer.concat's pooled byteOffset, not just the header",
    )
    buf[buf.length - 1] = 42
    assert.equal(image.rgb[23], 42, "a copy would not have seen that write")
  })

  it("skips a # comment line before the dimensions", () => {
    // vips writes `#vips2ppm - <timestamp>` into every file it produces, so
    // this is load-bearing on one of the two backends, not spec completeness.
    const image = parsePpm(ppm("P6\n#vips2ppm - Wed Jul 29 12:00:00 2026\n4 2\n255\n", body24()))
    assert.equal(image.width, 4)
    assert.equal(image.height, 2)
    assert.equal(image.rgb[0], 0)
    assert.equal(image.rgb[23], 230)
  })

  it("skips a comment sitting between two header tokens", () => {
    const image = parsePpm(ppm("P6\n4 #width was 4\n2\n#and again\n255\n", body24()))
    assert.equal(image.width, 4)
    assert.equal(image.height, 2)
    assert.equal(image.rgb.length, 24)
  })

  it("skips a comment butted straight against the magic number", () => {
    const image = parsePpm(ppm("P6#no whitespace before me\n4 2\n255\n", body24()))
    assert.equal(image.width, 4)
    assert.equal(image.height, 2)
  })

  it("rejects maxval 65535 and names the bit depth", () => {
    // The Q16 trap: two big-endian bytes per sample. Read as 8-bit that data is
    // not "slightly wrong", it is unrecognisable — and a headerless format
    // would have nothing to catch it with.
    rejects(ppm("P6\n4 2\n65535\n", Buffer.alloc(48)), (err) => {
      assert.ok(err.message.includes("65535"), "says what it saw")
      assert.ok(err.message.includes("16-bit"), "names the bit depth")
    })
  })

  it("rejects any maxval that is not 255", () => {
    for (const maxval of ["1", "15", "254", "256", "65535"]) {
      rejects(ppm(`P6\n4 2\n${maxval}\n`, Buffer.alloc(48)), (err) => {
        assert.ok(err.message.includes("maxval"))
      })
    }
  })

  it("rejects P3, the ASCII variant, rather than mis-parsing it", () => {
    // No backend here emits P3 and decoding it needs a whole second parser, so
    // it is a refusal, not a TODO.
    rejects(ppm("P3\n4 2\n255\n0 0 0 1 1 1\n"), (err) => {
      assert.ok(err.message.includes("P6"), "names what it wanted")
      assert.ok(err.message.includes("P3"), "and what it got")
    })
  })

  it("rejects a magic number that is not a PPM at all", () => {
    rejects(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), (err) => {
      assert.ok(err.message.includes("P6"))
    })
    rejects(Buffer.alloc(0), (err) => {
      assert.ok(err.message.includes("P6"))
    })
  })

  it("rejects a truncated body with both byte counts in the message", () => {
    rejects(ppm(HEADER, Buffer.alloc(10)), (err) => {
      assert.ok(err.message.includes("10 body bytes"), "says what arrived")
      assert.ok(err.message.includes("24"), "says what was needed")
      assert.ok(err.message.includes("4x2"), "and for what dimensions")
    })
  })

  it("rejects a header with no whitespace after maxval", () => {
    // Not pedantry: without the separator there is no way to know whether the
    // next byte is more maxval or the first sample. Two ways to arrive here,
    // because a token ends only at whitespace or at `#`:
    //   - first body byte is `#`, which ends the token but is not a separator
    rejects(ppm("P6\n4 2\n255", Buffer.alloc(24, 0x23)), (err) => {
      assert.ok(err.message.includes("no whitespace after maxval"))
    })
    //   - anything else, which the maxval token swallows and then cannot parse
    rejects(ppm("P6\n4 2\n255", Buffer.alloc(24)), (err) => {
      assert.ok(err.message.includes("maxval"), "still refuses, by a different route")
    })
  })

  it("eats exactly one whitespace byte, so a body starting with 0x20 survives", () => {
    // The separator is a single character by spec, not a run, because the first
    // body byte may itself be a whitespace value — 0x20 is a perfectly ordinary
    // dark grey.
    const body = Buffer.alloc(24, 0x20)
    const image = parsePpm(ppm(HEADER, body))
    assert.equal(image.rgb.length, 24)
    for (let i = 0; i < 24; i++) assert.equal(image.rgb[i], 0x20, `sample ${i} not eaten`)
  })

  it("stops at the header ceiling instead of scanning a whole frame for a token", () => {
    // A header this long is a lie about the magic number. Walking 48MB of pixel
    // data looking for a number is how a corrupt file becomes a hang.
    const filler = Buffer.alloc(4096, 0x20) // whitespace: a scanner with no ceiling would sail past
    const late = Buffer.concat([ppm("P6\n"), filler, ppm("4 2\n255\n", body24())])
    rejects(late, (err) => {
      assert.ok(err.message.includes("header ended"), "gives up rather than finding the late header")
    })

    const garbage = Buffer.concat([ppm("P6\n"), Buffer.alloc(65536, 0x41)])
    rejects(garbage, (err) => {
      assert.ok(err.message.length > 0)
    })
  })

  it("rejects nonsense dimensions rather than returning a zero-length frame", () => {
    rejects(ppm("P6\n0 0\n255\n", Buffer.alloc(24)), (err) => {
      assert.ok(err.message.includes("dimensions"))
    })
    rejects(ppm("P6\nwide 2\n255\n", Buffer.alloc(24)), (err) => {
      assert.ok(err.message.includes("dimensions"))
    })
  })

  it("throws even with no context argument, leaving file undefined", () => {
    assert.throws(
      () => parsePpm(ppm("P3\n1 1\n255\n")),
      (/** @type {MediaImportError} */ err) => {
        assert.ok(err instanceof MediaImportError)
        assert.equal(err.code, "BACKEND_FAILED")
        assert.equal(err.file, undefined)
        return true
      },
    )
  })
})

describe("buildPosterCommand", () => {
  it("seeks before -i and drops metadata", () => {
    const video = /** @type {import('../../scripts/lib/types.js').VideoBackend} */ ({
      name: "ffmpeg",
      bin: "ffmpeg",
      versionArgs: ["-version"],
      version: "ffmpeg version 7.0",
      childEnv: {},
    })
    const cmd = buildPosterCommand(video, {
      sourcePath: "/work/src.mp4",
      outPath: "/work/still.png",
      atSeconds: 0.5,
    })
    const ssAt = cmd.args.indexOf("-ss")
    const inputAt = cmd.args.indexOf("-i")
    assert.ok(ssAt !== -1 && ssAt < inputAt, "fast seek comes before the input")
    assert.deepEqual(cmd.args.slice(ssAt, ssAt + 2), ["-ss", "0.5"])
    assert.ok(cmd.args.includes("-map_metadata"), "strips container metadata")
    assert.deepEqual(cmd.args.slice(cmd.args.indexOf("-frames:v"), cmd.args.indexOf("-frames:v") + 2), [
      "-frames:v",
      "1",
    ])
  })
})

describe("describeBackends", () => {
  it("reports an installed pair as ok", () => {
    const video = /** @type {import('../../scripts/lib/types.js').VideoBackend} */ ({
      name: "ffmpeg",
      bin: "ffmpeg",
      versionArgs: [],
      version: "ffmpeg version 7.0",
      childEnv: {},
    })
    const notes = describeBackends({ image: backend(), video })
    assert.equal(notes.length, 2)
    assert.ok(notes.every((n) => n.level === "ok"))
  })

  it("errors on a missing image backend and warns on a missing video one", () => {
    const notes = describeBackends({ image: null, video: null })
    assert.equal(notes[0].level, "error")
    assert.ok(notes[0].message.includes("brew install vips"))
    assert.equal(notes[1].level, "warn")
    assert.ok(notes[1].message.includes("brew install ffmpeg"))
  })

  it("calls out that sips cannot write WebP", () => {
    const sips = backend({ name: "sips", bin: "sips", canWebp: false, autoOrients: false, version: "sips-316" })
    const notes = describeBackends({ image: sips, video: null })
    assert.ok(notes[0].message.includes("JPEG output only"))
  })
})

describe("probeImageBackend", () => {
  it("rejects an unknown WEDDING_IMAGE_BACKEND by name", async () => {
    await assert.rejects(
      () => probeImageBackend({ backendName: "photoshop" }),
      (/** @type {MediaImportError} */ err) => {
        assert.ok(err instanceof MediaImportError)
        assert.equal(err.code, "NO_IMAGE_BACKEND")
        assert.ok(err.message.includes("vips"))
        return true
      },
    )
  })

  it("rejects a WEDDING_IMAGE_BIN it cannot classify", async () => {
    await assert.rejects(
      () => probeImageBackend({ bin: "/usr/local/bin/mystery-resizer" }),
      (/** @type {MediaImportError} */ err) => err.code === "NO_IMAGE_BACKEND",
    )
  })

  it("returns null for a named backend that is not installed", async () => {
    assert.equal(await probeImageBackend({ bin: "/nonexistent/vips" }), null)
  })

  it("finds a real backend on a machine that has one", async () => {
    const found = await probeImageBackend()
    if (!found) return // no backend installed; nothing to assert
    assert.ok(found.version.length > 0, "reports a version")
    assert.ok(["vips", "magick", "convert", "sips"].includes(found.name))
    if (found.name === "vips") assert.ok(found.headerBin, "vips needs vipsheader")
  })
})

describe("probeVideoBackend", () => {
  it("honours an explicit opt-out", async () => {
    assert.equal(await probeVideoBackend({ backendName: "none" }), null)
  })

  it("returns null when the named binary is absent", async () => {
    assert.equal(await probeVideoBackend({ bin: "/nonexistent/ffmpeg" }), null)
  })
})

describe("imageBackendInstallHint", () => {
  it("names a package for each supported OS", () => {
    const hint = imageBackendInstallHint()
    assert.ok(hint.includes("brew install vips"))
    assert.ok(hint.includes("apt install libvips-tools"))
    assert.ok(hint.includes("brew install imagemagick"))
    assert.ok(hint.includes("WEDDING_IMAGE_BACKEND"))
  })
})
