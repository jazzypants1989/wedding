/** @file Unit tests for scripts/lib/image-backend.js.
 *
 *  The parsers and argv builders are tested against canned strings so they run
 *  on any machine, installed backends or not. The few tests that need a real
 *  binary probe for one first and skip when it is absent. */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  buildDimensionCommand,
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

/** @param {Partial<import('../../scripts/lib/types.js').ImageBackend>} [over] */
function backend(over = {}) {
  return /** @type {import('../../scripts/lib/types.js').ImageBackend} */ ({
    name: "vips",
    bin: "vips",
    versionArgs: ["--version"],
    canWebp: true,
    canHeic: true,
    autoOrients: true,
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
