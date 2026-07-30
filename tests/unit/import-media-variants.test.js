/** @file Unit tests for scripts/lib/media-variants.js.
 *
 *  The planning and skip paths run everywhere. The generation tests need a real
 *  backend and skip when none is installed — CI without vips/magick/sips still
 *  gets full coverage of the decisions, just not of the pixels. */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import { hasImageMetadata, readImageHeader } from "../../core/image-meta.js"
import { sniffMagic } from "../../core/sniff.js"
import { MEDIA_LIMITS } from "../../types.js"
import {
  buildMediaVariants,
  planMediaFile,
  probeBackends,
  sniffFile,
  variantNamesFor,
} from "../../scripts/lib/media-variants.js"
import {
  makeExifTiff,
  makeJpegWithMetadata,
  makeMp4,
  makeMp4WithMetadata,
} from "../../tests/media-fixtures.js"

/** @type {string} */
let workDir
/** @type {import('../../scripts/lib/types.js').MediaBackends} */
let backends
/** @type {import('../../scripts/lib/types.js').MediaBackends} */
let noBackends

before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "variants-test-"))
  backends = await probeBackends()
  noBackends = { image: null, video: null }
})

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

/** @param {string} name @param {Buffer} buf @returns {string} */
function write(name, buf) {
  const file = path.join(workDir, name)
  fs.writeFileSync(file, buf)
  return file
}

describe("variantNamesFor", () => {
  it("gives images display and thumb", () => {
    assert.deepEqual(variantNamesFor("image", "guest"), ["display", "thumb"])
    assert.deepEqual(variantNamesFor("image", "official"), ["display", "thumb"])
  })

  it("gives content-section images the responsive ladder", () => {
    assert.deepEqual(variantNamesFor("image", "content"), ["w400", "w800", "w1600"])
  })

  it("gives videos a poster", () => {
    assert.deepEqual(variantNamesFor("video", "guest"), ["poster"])
  })

  it("matches what the server requires at finalize", async () => {
    // expectedVariants() is the gate finalize applies; ours must be that set
    // minus `original`, which the caller appends.
    const { expectedVariants } = await import("../../types.js")
    /** @type {[import('../../types.js').MediaKind, import('../../types.js').MediaSection][]} */
    const combinations = [
      ["image", "guest"],
      ["image", "official"],
      ["image", "content"],
      ["video", "guest"],
    ]
    for (const [kind, section] of combinations) {
      const expected = expectedVariants(kind, section, false).filter((v) => v !== "original")
      assert.deepEqual(
        variantNamesFor(kind, section).sort(),
        expected.sort(),
        `${kind}/${section}`,
      )
    }
  })
})

describe("sniffFile", () => {
  it("identifies a file by its magic bytes, not its name", () => {
    const jpegNamedPng = write("actually-a-jpeg.png", makeJpegWithMetadata({}))
    assert.equal(sniffFile(jpegNamedPng), "jpeg")
  })

  it("returns empty for a non-media file", () => {
    assert.equal(sniffFile(write("notes.txt", Buffer.from("hello", "utf8"))), "")
  })

  it("returns empty for an empty file", () => {
    assert.equal(sniffFile(write("empty.jpg", Buffer.alloc(0))), "")
  })
})

describe("planMediaFile — skip paths", () => {
  it("skips a file that is not media at all", async () => {
    const plan = await planMediaFile(write("readme.txt", Buffer.from("not media")), backends)
    assert.equal(plan.ok, false)
    if (plan.ok) return
    assert.equal(plan.code, "UNSUPPORTED_SOURCE")
    assert.ok(plan.message.includes("readme.txt"))
  })

  it("skips an image over the original size cap", async () => {
    // A sparse file, so the test does not actually write 31MB.
    const file = path.join(workDir, "huge.jpg")
    fs.writeFileSync(file, makeJpegWithMetadata({}))
    fs.truncateSync(file, MEDIA_LIMITS.IMAGE_ORIGINAL_MAX + 1)
    const plan = await planMediaFile(file, backends)
    assert.equal(plan.ok, false)
    if (plan.ok) return
    assert.equal(plan.code, "SOURCE_TOO_LARGE")
    assert.ok(plan.message.includes("30"), "names the limit")
  })

  it("skips a video when there is no poster-frame tool", async () => {
    const file = write("clip.mp4", makeMp4WithMetadata({}))
    const plan = await planMediaFile(file, { image: backends.image, video: null })
    assert.equal(plan.ok, false)
    if (plan.ok) return
    assert.equal(plan.code, "NO_VIDEO_BACKEND")
    assert.ok(plan.message.includes("ffmpeg"), "says what to install")
  })

  it("skips an image when there is no image backend", async () => {
    const plan = await planMediaFile(write("photo.jpg", makeJpegWithMetadata({})), noBackends)
    assert.equal(plan.ok, false)
    if (plan.ok) return
    assert.equal(plan.code, "NO_IMAGE_BACKEND")
  })

  it("skips a video whose container has no readable dimensions", async () => {
    const fakeVideo = { name: "ffmpeg", bin: "ffmpeg", versionArgs: [], version: "x", childEnv: {} }
    const plan = await planMediaFile(write("bad.mp4", makeMp4(256)), {
      image: backends.image,
      video: /** @type {never} */ (fakeVideo),
    })
    assert.equal(plan.ok, false)
    if (plan.ok) return
    assert.equal(plan.code, "UNREADABLE_DIMENSIONS")
  })

  it("skips a video longer than the duration cap", async () => {
    const fakeVideo = { name: "ffmpeg", bin: "ffmpeg", versionArgs: [], version: "x", childEnv: {} }
    const long = makeMp4WithMetadata({ durationSeconds: MEDIA_LIMITS.VIDEO_MAX_DURATION_S + 30 })
    const plan = await planMediaFile(write("long.mp4", long), {
      image: backends.image,
      video: /** @type {never} */ (fakeVideo),
    })
    assert.equal(plan.ok, false)
    if (plan.ok) return
    assert.equal(plan.code, "VIDEO_TOO_LONG")
  })
})

describe("planMediaFile — reading a source", () => {
  it("reads dimensions, orientation and GPS from a JPEG with no subprocess", async () => {
    const exif = makeExifTiff({ orientation: 6, gps: true, capturedAt: "2026:06:14 15:04:05" })
    const file = write("rotated.jpg", makeJpegWithMetadata({ width: 2400, height: 1600, exif }))
    // Deliberately pass no backend: a JPEG must resolve from its header alone.
    const plan = await planMediaFile(file, { image: backends.image ?? null, video: null })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.kind, "image")
    assert.equal(plan.sniffed, "jpeg")
    assert.equal(plan.originalExt, "jpg")
    assert.equal(plan.orientation, 6)
    assert.equal(plan.hasGps, true)
    assert.equal(plan.capturedAt, "2026-06-14 15:04:05")
    // Orientation 6 is a quarter turn, so the stored 2400x1600 is shown 1600x2400.
    assert.equal(plan.width, 1600)
    assert.equal(plan.height, 2400)
  })

  it("leaves dimensions alone for an upright image", async () => {
    const file = write("upright.jpg", makeJpegWithMetadata({ width: 2400, height: 1600 }))
    const plan = await planMediaFile(file, backends)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.width, 2400)
    assert.equal(plan.height, 1600)
    assert.equal(plan.orientation, 1)
    assert.equal(plan.hasGps, false)
  })

  it("reads a video's duration and dimensions from its container", async () => {
    const fakeVideo = { name: "ffmpeg", bin: "ffmpeg", versionArgs: [], version: "x", childEnv: {} }
    const file = write("clip2.mp4", makeMp4WithMetadata({ durationSeconds: 12.5, width: 1280, height: 720 }))
    const plan = await planMediaFile(file, {
      image: backends.image,
      video: /** @type {never} */ (fakeVideo),
    })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.kind, "video")
    assert.equal(plan.width, 1280)
    assert.equal(plan.height, 720)
    assert.equal(plan.durationSeconds, 12.5)
  })
})

describe("buildMediaVariants failure handling", () => {
  // `backends` is resolved in before(), so the skip decision has to happen
  // inside the test body — a `{ skip: ... }` option is evaluated at
  // registration time, when it would always be true.

  it("fails loudly on an undecodable source rather than emitting a broken variant", async (t) => {
    if (!backends.image) return t.skip("no image backend installed")
    // The in-repo fixtures carry real magic bytes but no decodable scan data,
    // which makes them a good stand-in for a truncated or corrupt photo.
    const exif = makeExifTiff({ orientation: 1, gps: true })
    const file = write("undecodable.jpg", makeJpegWithMetadata({ width: 40, height: 30, exif }))
    const plan = await planMediaFile(file, backends)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    await assert.rejects(() => buildMediaVariants(plan, backends, { tmpRoot: workDir }))
  })

  it("leaves no work directory behind when generation fails", async (t) => {
    if (!backends.image) return t.skip("no image backend installed")
    const count = () => fs.readdirSync(workDir).filter((n) => n.startsWith("wedding-import-")).length
    const before = count()
    const plan = await planMediaFile(write("broken.jpg", makeJpegWithMetadata({})), backends)
    if (!plan.ok) return
    await buildMediaVariants(plan, backends, { tmpRoot: workDir }).catch(() => {})
    assert.equal(count(), before, "no work directory left behind")
  })

  it("refuses to build without an image backend", async () => {
    const plan = {
      ok: /** @type {const} */ (true),
      sourcePath: write("x.jpg", makeJpegWithMetadata({})),
      kind: /** @type {const} */ ("image"),
      sniffed: /** @type {const} */ ("jpeg"),
      originalExt: "jpg",
      originalBytes: 100,
      width: 10,
      height: 10,
      durationSeconds: null,
      orientation: 1,
      hasGps: false,
      capturedAt: null,
      mtimeMs: 0,
    }
    await assert.rejects(
      () => buildMediaVariants(plan, noBackends, { tmpRoot: workDir }),
      (/** @type {import('../../scripts/lib/media-errors.js').MediaImportError} */ err) =>
        err.code === "NO_IMAGE_BACKEND",
    )
  })
})

describe("buildMediaVariants on genuine encoder output", () => {
  /** @type {string | null} */
  let realJpeg = null

  before(async () => {
    if (!backends?.image) return
    // Ask the backend itself to make a decodable source, so this works with
    // whichever tool happens to be installed.
    const { runBinary } = await import("../../scripts/lib/image-backend.js")
    const out = path.join(workDir, "generated.jpg")
    const be = backends.image
    try {
      if (be.name === "magick" || be.name === "convert") {
        await runBinary(be.bin, ["-size", "1200x800", "gradient:red-blue", out])
      } else if (be.name === "vips") {
        await runBinary(be.bin, ["black", out, "1200", "800", "--bands", "3"])
      } else {
        return // sips cannot synthesize an image
      }
      realJpeg = fs.existsSync(out) ? out : null
    } catch {
      realJpeg = null
    }
  })

  it("produces variants that satisfy every server-side gate", async (t) => {
    if (!backends?.image || !realJpeg) return t.skip("no backend able to synthesize a source")
    const plan = await planMediaFile(realJpeg, backends)
    assert.equal(plan.ok, true)
    if (!plan.ok) return

    const built = await buildMediaVariants(plan, backends, { tmpRoot: workDir })
    try {
      assert.equal(built.needsDisplay, false, "a CLI import is never original-only")

      const names = built.artifacts.map((a) => a.name)
      assert.deepEqual(names, ["display", "thumb", "original"], "original goes last")

      const caps = { display: MEDIA_LIMITS.DISPLAY_MAX, thumb: MEDIA_LIMITS.THUMB_MAX }
      for (const artifact of built.artifacts) {
        if (artifact.name === "original") continue
        const bytes = fs.readFileSync(artifact.path)

        assert.equal(bytes.length, artifact.bytes, `${artifact.name} bytes match the file exactly`)
        assert.ok(
          artifact.bytes <= caps[/** @type {"display"|"thumb"} */ (artifact.name)],
          `${artifact.name} is under its cap`,
        )

        const sniffed = sniffMagic(bytes.subarray(0, 32))
        assert.ok(["jpeg", "webp"].includes(sniffed), `${artifact.name} sniffs as jpeg or webp`)
        assert.equal(
          artifact.contentType,
          sniffed === "webp" ? "image/webp" : "image/jpeg",
          `${artifact.name} Content-Type agrees with its bytes`,
        )

        assert.equal(hasImageMetadata(bytes), false, `${artifact.name} carries no metadata`)

        const header = readImageHeader(bytes)
        assert.ok(header, `${artifact.name} is a readable image`)
        const maxEdge = Math.max(header?.width ?? 0, header?.height ?? 0)
        assert.ok(
          maxEdge <= (artifact.name === "display" ? 2000 : 400),
          `${artifact.name} respects its long edge`,
        )
      }
    } finally {
      await built.dispose()
      assert.equal(fs.existsSync(built.workDir), false, "dispose removes the work directory")
    }
  })

  it("never upscales a source smaller than the target", async (t) => {
    if (!backends?.image || !realJpeg) return t.skip("no backend able to synthesize a source")
    const { runBinary } = await import("../../scripts/lib/image-backend.js")
    const small = path.join(workDir, "small.jpg")
    const be = backends.image
    if (be.name === "magick" || be.name === "convert") {
      await runBinary(be.bin, ["-size", "300x200", "gradient:red-blue", small])
    } else if (be.name === "vips") {
      await runBinary(be.bin, ["black", small, "300", "200", "--bands", "3"])
    } else {
      return t.skip("backend cannot synthesize a source")
    }

    const plan = await planMediaFile(small, backends)
    if (!plan.ok) return
    const built = await buildMediaVariants(plan, backends, { tmpRoot: workDir })
    try {
      const display = built.artifacts.find((a) => a.name === "display")
      assert.equal(display?.width, 300, "display keeps the source width")
      assert.equal(display?.height, 200)
    } finally {
      await built.dispose()
    }
  })
})
