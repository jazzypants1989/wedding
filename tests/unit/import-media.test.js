/** @file Unit tests for the bulk media importer's CLI layer: argument parsing,
 *  directory scanning, planning against the manifest, and the run loop.
 *
 *  The run loop is driven with a stub sink and a stub variant builder, so these
 *  tests exercise the taxonomy, ordering, manifest and abort logic with no
 *  binary backend and no database. The real local sink is covered by the
 *  integration test, which is the only place a fake would hide a bug. */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import {
  buildPlan,
  formatPlanReport,
  parseArgs,
  runImport,
  scanDirectory,
} from "../../scripts/import-media.js"
import { loadManifest, saveManifest } from "../../scripts/lib/import-manifest.js"
import { MediaImportError } from "../../scripts/lib/media-errors.js"
import { makeExifTiff, makeJpegWithMetadata, makeMov, makeMp4 } from "../media-fixtures.js"

/** A backend object shaped like a probed one, without probing anything. */
const FAKE_BACKENDS = {
  image: {
    name: /** @type {const} */ ("vips"),
    bin: "vips",
    versionArgs: ["--version"],
    canWebp: true,
    canHeic: true,
    autoOrients: true,
    version: "vips-8.17.0",
    headerBin: "vipsheader",
    childEnv: {},
  },
  video: null,
}

/** @type {string} */
let root

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "import-media-test-"))
})

after(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

/** A fresh scratch directory per test, so nothing leaks between them. */
function scratch(/** @type {string} */ name) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** @param {string} dir @param {string} relative @param {Buffer | string} contents */
function write(dir, relative, contents) {
  const target = path.join(dir, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
  return target
}

/** parseArgs, asserting it succeeded. */
function args(/** @type {string[]} */ argv) {
  const parsed = parseArgs(argv)
  assert.equal(parsed.valid, true, parsed.valid ? "" : parsed.error)
  assert.ok(parsed.valid)
  return parsed.value
}

describe("parseArgs", () => {
  it("requires a directory, and says so with the usage block", () => {
    const parsed = parseArgs([])
    assert.equal(parsed.valid, false)
    assert.ok(!parsed.valid && parsed.error.includes("No directory given"))
    assert.ok(!parsed.valid && parsed.error.includes("--section=official|guest"))
  })

  it("defaults to the official section, name order and a real concurrency", () => {
    const value = args(["/photos"])
    assert.equal(value.section, "official")
    assert.equal(value.order, "name")
    assert.equal(value.captions, "none")
    assert.equal(value.heicOriginal, "keep")
    assert.equal(value.videos, "skip")
    assert.equal(value.url, null)
    assert.equal(value.dryRun, false)
    assert.ok(value.concurrency >= 1 && value.concurrency <= 8)
    assert.ok(value.manifestPath.endsWith("import-manifest.json"))
  })

  it("resolves the directory to an absolute path", () => {
    assert.equal(args(["."]).dir, path.resolve("."))
    assert.ok(path.isAbsolute(args(["some/relative/dir"]).dir))
  })

  it("accepts every documented flag", () => {
    const value = args([
      "/photos",
      "--section=guest",
      "--dry-run",
      "--url=http://example.test:3000",
      "--recursive",
      "--order=mtime",
      "--captions=sidecar",
      "--concurrency=3",
      "--manifest=/tmp/m.json",
      "--report=/tmp/r.json",
      "--force",
      "--skip-reorder",
      "--strip-original",
      "--heic-original=jpeg",
      "--videos=require",
      "--verbose",
    ])
    assert.equal(value.section, "guest")
    assert.equal(value.dryRun, true)
    assert.equal(value.url, "http://example.test:3000")
    assert.equal(value.recursive, true)
    assert.equal(value.order, "mtime")
    assert.equal(value.captions, "sidecar")
    assert.equal(value.concurrency, 3)
    assert.equal(value.manifestPath, "/tmp/m.json")
    assert.equal(value.reportPath, "/tmp/r.json")
    assert.equal(value.force, true)
    assert.equal(value.skipReorder, true)
    assert.equal(value.stripOriginal, true)
    assert.equal(value.heicOriginal, "jpeg")
    assert.equal(value.videos, "require")
    assert.equal(value.verbose, true)
  })

  it("strips a trailing slash from --url so the manifest keys one origin", () => {
    assert.equal(args(["/photos", "--url=http://example.test:3000/"]).url, "http://example.test:3000")
  })

  it("rejects a value outside a flag's fixed set", () => {
    for (const bad of ["--section=bogus", "--order=random", "--heic-original=png", "--videos=maybe"]) {
      const parsed = parseArgs(["/photos", bad])
      assert.equal(parsed.valid, false, bad + " should be rejected")
      assert.ok(!parsed.valid && parsed.error.includes("must be one of"))
    }
  })

  it("rejects a value flag written with a space instead of =", () => {
    // Without this, `--section official` would parse `official` as a second
    // directory and silently import into the default section.
    const parsed = parseArgs(["/photos", "--section", "official"])
    assert.equal(parsed.valid, false)
    assert.ok(!parsed.valid && parsed.error.includes("--section=VALUE"))
  })

  it("rejects a boolean flag given a value, and unknown flags", () => {
    const withValue = parseArgs(["/photos", "--dry-run=yes"])
    assert.ok(!withValue.valid && withValue.error.includes("takes no value"))
    const unknown = parseArgs(["/photos", "--recurse"])
    assert.ok(!unknown.valid && unknown.error.includes("Unknown option --recurse"))
  })

  it("rejects a second positional rather than guessing which is the directory", () => {
    const parsed = parseArgs(["/photos", "/more-photos"])
    assert.equal(parsed.valid, false)
    assert.ok(!parsed.valid && parsed.error.includes("Quote paths containing spaces"))
  })

  it("rejects a nonsensical --concurrency", () => {
    for (const bad of ["--concurrency=0", "--concurrency=abc", "--concurrency=-2", "--concurrency=999"]) {
      assert.equal(parseArgs(["/photos", bad]).valid, false, bad)
    }
  })

  it("treats --help as a request for the usage block", () => {
    const parsed = parseArgs(["--help"])
    assert.equal(parsed.valid, false)
    assert.ok(!parsed.valid && parsed.error.startsWith("Usage:"))
  })
})

describe("scanDirectory", () => {
  it("returns every file in code-unit order, filtering nothing by name", () => {
    const dir = scratch("scan-order")
    write(dir, "a.jpg", makeJpegWithMetadata({}))
    write(dir, "Z.jpg", makeJpegWithMetadata({}))
    write(dir, "_x.jpg", makeJpegWithMetadata({}))
    write(dir, ".DS_Store", Buffer.from([0, 1, 2]))

    // Uppercase and "_" sort before lowercase in code-unit order, which is not
    // what localeCompare would do. That is the point: the ordering is identical
    // on every machine and in every locale, so a re-run reproduces it.
    assert.deepEqual(
      scanDirectory(dir).map((f) => f.relative),
      [".DS_Store", "Z.jpg", "_x.jpg", "a.jpg"],
    )
  })

  it("ignores subdirectories unless --recursive, and prefixes them when it does", () => {
    const dir = scratch("scan-recursive")
    write(dir, "top.jpg", makeJpegWithMetadata({}))
    write(dir, "sub/deep.jpg", makeJpegWithMetadata({}))

    assert.deepEqual(
      scanDirectory(dir).map((f) => f.relative),
      ["top.jpg"],
    )
    assert.deepEqual(
      scanDirectory(dir, { recursive: true }).map((f) => f.relative),
      ["sub/deep.jpg", "top.jpg"],
    )
  })

  it("follows a symlink to a file and steps over a broken one", () => {
    const dir = scratch("scan-symlinks")
    const real = write(dir, "real.jpg", makeJpegWithMetadata({}))
    fs.symlinkSync(real, path.join(dir, "link.jpg"))
    fs.symlinkSync(path.join(dir, "gone.jpg"), path.join(dir, "broken.jpg"))

    assert.deepEqual(
      scanDirectory(dir).map((f) => f.relative),
      ["link.jpg", "real.jpg"],
    )
  })
})

describe("buildPlan", () => {
  /** @param {string} dir @param {object} [overrides] */
  function planInput(dir, overrides = {}) {
    return {
      files: scanDirectory(dir, { recursive: true }),
      backends: FAKE_BACKENDS,
      manifest: loadManifest(path.join(dir, "no-such-manifest.json")),
      origin: "local:" + dir,
      force: false,
      captions: /** @type {"none" | "sidecar"} */ ("none"),
      order: /** @type {"name" | "mtime"} */ ("name"),
      concurrency: 2,
      ...overrides,
    }
  }

  it("classifies by content, not extension, and skips what the site can't take", async () => {
    const dir = scratch("plan-classify")
    write(dir, "photo.jpg", makeJpegWithMetadata({ width: 1200, height: 800 }))
    write(dir, "actually-a-jpeg.png", makeJpegWithMetadata({ width: 640, height: 480 }))
    write(dir, "notes.txt", "just text")
    write(dir, ".DS_Store", Buffer.from([0, 1, 2, 3]))

    const { items, skipped } = await buildPlan(planInput(dir))

    assert.deepEqual(
      items.map((i) => i.file.relative),
      ["actually-a-jpeg.png", "photo.jpg"],
    )
    // The mis-named JPEG is planned as a jpeg — the sniffer decided, not the name.
    assert.equal(items[0].plan.sniffed, "jpeg")
    assert.equal(items[0].plan.originalExt, "jpg")
    assert.deepEqual(
      skipped.map((s) => [s.file.relative, s.code]),
      [
        [".DS_Store", "UNSUPPORTED_SOURCE"],
        ["notes.txt", "UNSUPPORTED_SOURCE"],
      ],
    )
  })

  it("skips a video when there is no video backend, without failing the run", async () => {
    const dir = scratch("plan-no-video")
    write(dir, "clip.mov", makeMov(4096))
    write(dir, "photo.jpg", makeJpegWithMetadata({}))

    const { items, skipped } = await buildPlan(planInput(dir))
    assert.deepEqual(items.map((i) => i.file.relative), ["photo.jpg"])
    assert.deepEqual(
      skipped.map((s) => [s.file.relative, s.code]),
      [["clip.mov", "NO_VIDEO_BACKEND"]],
    )
  })

  it("skips what the manifest already records, and imports it again under --force", async () => {
    const dir = scratch("plan-manifest")
    write(dir, "one.jpg", makeJpegWithMetadata({ width: 100, height: 100 }))
    write(dir, "two.jpg", makeJpegWithMetadata({ width: 200, height: 200 }))

    const first = await buildPlan(planInput(dir))
    assert.equal(first.items.length, 2)

    // Seed the manifest with one of the two hashes, as a finished import would.
    // Kept outside the scanned directory: buildPlan sees whatever the scan hands
    // it, and filtering the importer's own files is runImport's job.
    const manifestPath = path.join(root, "plan-manifest-record.json")
    const manifest = loadManifest(manifestPath)
    const already = first.items[0]
    manifest.origins["local:" + dir] = {
      [already.sha256]: {
        id: 7,
        fileKey: "deadbeef",
        section: "official",
        name: already.file.relative,
        bytes: already.plan.originalBytes,
        at: "2026-07-29T00:00:00.000Z",
      },
    }
    saveManifest(manifestPath, manifest)

    const second = await buildPlan(planInput(dir, { manifest: loadManifest(manifestPath) }))
    assert.deepEqual(second.items.map((i) => i.file.relative), ["two.jpg"])
    assert.deepEqual(
      second.skipped.map((s) => [s.file.relative, s.code]),
      [["one.jpg", "ALREADY_IMPORTED"]],
    )

    const forced = await buildPlan(
      planInput(dir, { manifest: loadManifest(manifestPath), force: true }),
    )
    assert.equal(forced.items.length, 2)
    assert.equal(forced.skipped.length, 0)
  })

  it("keys the manifest by content, so a rename is still a skip", async () => {
    const dir = scratch("plan-rename")
    write(dir, "before.jpg", makeJpegWithMetadata({ width: 300, height: 200 }))
    const before = await buildPlan(planInput(dir))

    fs.renameSync(path.join(dir, "before.jpg"), path.join(dir, "after.jpg"))
    const after = await buildPlan(planInput(dir))
    assert.equal(after.items[0].sha256, before.items[0].sha256)
  })

  it("reads a sidecar caption only when asked, sanitized like the API would", async () => {
    const dir = scratch("plan-captions")
    write(dir, "IMG_1234.jpg", makeJpegWithMetadata({}))
    write(dir, "IMG_1234.txt", "  Dancing at the reception.\n")
    write(dir, "IMG_5678.jpg", makeJpegWithMetadata({}))

    const without = await buildPlan(planInput(dir))
    assert.deepEqual(without.items.map((i) => i.caption), [null, null])

    const withSidecars = await buildPlan(planInput(dir, { captions: "sidecar" }))
    assert.deepEqual(
      withSidecars.items.map((i) => [i.file.relative, i.caption]),
      [
        ["IMG_1234.jpg", "Dancing at the reception."],
        ["IMG_5678.jpg", null],
      ],
    )
  })

  it("orders by mtime when asked, falling back to name for a tie", async () => {
    const dir = scratch("plan-mtime")
    write(dir, "a-newest.jpg", makeJpegWithMetadata({ width: 10, height: 10 }))
    write(dir, "b-oldest.jpg", makeJpegWithMetadata({ width: 20, height: 20 }))
    fs.utimesSync(path.join(dir, "a-newest.jpg"), new Date(2_000_000), new Date(2_000_000))
    fs.utimesSync(path.join(dir, "b-oldest.jpg"), new Date(1_000_000), new Date(1_000_000))

    const byName = await buildPlan(planInput(dir))
    assert.deepEqual(byName.items.map((i) => i.file.relative), ["a-newest.jpg", "b-oldest.jpg"])

    const byMtime = await buildPlan(planInput(dir, { order: "mtime" }))
    assert.deepEqual(byMtime.items.map((i) => i.file.relative), ["b-oldest.jpg", "a-newest.jpg"])
  })
})

// --- The run loop, against a stub sink -------------------------------------

/** Records every call, so a test can assert on the whole conversation. */
function stubSink(overrides = {}) {
  /** @type {{ created: number[], put: [number, string][], finalized: number[], discarded: number[], ordered: number[][] }} */
  const calls = { created: [], put: [], finalized: [], discarded: [], ordered: [] }
  let nextId = 100
  const sink = {
    name: /** @type {const} */ ("local"),
    calls,
    async preflight() {
      return { ok: true, freeBytes: 1e12, storedBytes: 0 }
    },
    async createSession() {
      const id = nextId++
      calls.created.push(id)
      return { id, fileKey: "key" + id }
    },
    /** @param {number} id @param {string} variant */
    async putVariant(id, variant) {
      calls.put.push([id, variant])
      return { bytes: 1 }
    },
    /** @param {number} id */
    async finalize(id) {
      calls.finalized.push(id)
      return { id, status: "approved" }
    },
    /** @param {number} id */
    async discard(id) {
      calls.discarded.push(id)
    },
    /** @param {number[]} ids */
    async applyOrder(ids) {
      calls.ordered.push(ids)
      return { ok: true }
    },
    async close() {},
    ...overrides,
  }
  return sink
}

/** A variant builder that produces plausible artifacts without touching pixels. */
function stubBuilder(onFile = (/** @type {string} */ _path) => {}) {
  return async (/** @type {import('../../scripts/lib/types.js').MediaPlanOk} */ plan) => {
    onFile(plan.sourcePath)
    return {
      plan,
      kind: plan.kind,
      width: plan.width,
      height: plan.height,
      durationSeconds: plan.durationSeconds,
      needsDisplay: /** @type {false} */ (false),
      artifacts: [
        { name: "display", path: plan.sourcePath, bytes: 900, contentType: "image/webp", width: plan.width, height: plan.height, quality: 0.82, steppedDown: false, warnings: [] },
        { name: "thumb", path: plan.sourcePath, bytes: 100, contentType: "image/webp", width: 400, height: 400, quality: 0.7, steppedDown: false, warnings: [] },
        { name: "original", path: plan.sourcePath, bytes: plan.originalBytes, contentType: "image/jpeg", width: plan.width, height: plan.height, quality: null, steppedDown: false, warnings: [] },
      ],
      warnings: [],
      workDir: "/nonexistent",
      dispose: async () => {},
    }
  }
}

/** Swallow the CLI's output so the test log stays readable. */
function sink1() {
  /** @type {string[]} */
  const lines = []
  return { lines, write: (/** @type {string} */ chunk) => lines.push(chunk) }
}

describe("runImport", () => {
  /** @param {string} dir @param {object} [overrides] */
  function runArgs(dir, overrides = {}) {
    return {
      ...args([dir]),
      manifestPath: path.join(dir, "manifest.json"),
      concurrency: 2,
      ...overrides,
    }
  }

  /** @param {object} deps */
  function runDeps(deps = {}) {
    return {
      probeBackends: async () => FAKE_BACKENDS,
      buildMediaVariants: stubBuilder(),
      stdout: sink1(),
      stderr: sink1(),
      now: () => "2026-07-29T12:00:00.000Z",
      ...deps,
    }
  }

  it("imports every planned file, records the manifest and sets the order", async () => {
    const dir = scratch("run-happy")
    write(dir, "IMG_0002.jpg", makeJpegWithMetadata({ width: 1200, height: 800 }))
    write(dir, "IMG_0001.jpg", makeJpegWithMetadata({ width: 800, height: 1200 }))
    const sink = stubSink()
    const cliArgs = runArgs(dir)

    const report = await runImport(cliArgs, runDeps({ createSink: () => sink }))

    assert.equal(report.exitCode, 0)
    assert.equal(report.failed.length, 0)
    assert.deepEqual(report.imported.map((r) => r.file), ["IMG_0001.jpg", "IMG_0002.jpg"])
    // Derived variants first, original last — the retryable tail goes last.
    assert.deepEqual(
      sink.calls.put.filter(([id]) => id === sink.calls.created[0]).map(([, v]) => v),
      ["display", "thumb", "original"],
    )
    assert.equal(sink.calls.finalized.length, 2)
    assert.equal(sink.calls.discarded.length, 0)
    // sort_order follows filename order, which is why IMG_0001 leads.
    assert.deepEqual(sink.calls.ordered, [
      [
        /** @type {number} */ (report.imported[0].id),
        /** @type {number} */ (report.imported[1].id),
      ],
    ])

    const manifest = loadManifest(cliArgs.manifestPath)
    assert.equal(Object.keys(manifest.origins["local:" + dir]).length, 2)

    // Re-running is a no-op: everything is in the manifest now. The manifest
    // itself lives in the imported directory here, and must not be reported as
    // an unsupported file — only the two photos are skipped.
    const second = await runImport(cliArgs, runDeps({ createSink: () => stubSink() }))
    assert.equal(second.imported.length, 0)
    assert.deepEqual(
      second.skipped.map((s) => s.code),
      ["ALREADY_IMPORTED", "ALREADY_IMPORTED"],
    )
    assert.equal(second.exitCode, 0)
  })

  it("fails one file without losing the others, and cleans up its session", async () => {
    const dir = scratch("run-partial")
    write(dir, "good-1.jpg", makeJpegWithMetadata({ width: 100, height: 100 }))
    write(dir, "bad.jpg", makeJpegWithMetadata({ width: 200, height: 200 }))
    write(dir, "good-2.jpg", makeJpegWithMetadata({ width: 300, height: 300 }))
    const sink = stubSink()

    const report = await runImport(
      runArgs(dir, { concurrency: 1 }),
      runDeps({
        createSink: () => sink,
        buildMediaVariants: async (/** @type {any} */ plan) => {
          if (plan.sourcePath.endsWith("bad.jpg")) {
            throw new MediaImportError("VARIANT_TOO_LARGE", "display stayed over the cap", {
              file: plan.sourcePath,
            })
          }
          return stubBuilder()(plan)
        },
      }),
    )

    assert.equal(report.exitCode, 1)
    assert.deepEqual(report.imported.map((r) => r.file), ["good-1.jpg", "good-2.jpg"])
    assert.deepEqual(
      report.failed.map((f) => [f.file, f.code]),
      [["bad.jpg", "VARIANT_TOO_LARGE"]],
    )
    // The failure happened before a session existed, so nothing to discard.
    assert.equal(sink.calls.discarded.length, 0)
    assert.equal(sink.calls.finalized.length, 2)
    // A failed file must not enter the manifest, or a re-run would skip it.
    const manifest = loadManifest(runArgs(dir).manifestPath)
    assert.equal(Object.keys(manifest.origins["local:" + dir] ?? {}).length, 2)
  })

  it("discards the row when a file fails after its session was created", async () => {
    const dir = scratch("run-discard")
    write(dir, "one.jpg", makeJpegWithMetadata({}))
    const sink = stubSink({
      /** @param {number} id @param {string} variant */
      async putVariant(id, variant) {
        if (variant === "original") throw new MediaImportError("VARIANT_TOO_LARGE", "too big")
        return { bytes: 1 }
      },
    })

    const report = await runImport(runArgs(dir), runDeps({ createSink: () => sink }))

    assert.equal(report.exitCode, 1)
    assert.equal(report.imported.length, 0)
    assert.deepEqual(sink.calls.discarded, sink.calls.created)
    assert.equal(sink.calls.finalized.length, 0)
  })

  it("stops the whole run when the destination fills up", async () => {
    const dir = scratch("run-fills-up")
    for (const name of ["a.jpg", "b.jpg", "c.jpg", "d.jpg"]) {
      write(dir, name, makeJpegWithMetadata({ width: 100, height: 100 }))
    }
    let created = 0
    const sink = stubSink({
      async createSession() {
        created++
        if (created > 1) throw new MediaImportError("DESTINATION_FULL", "Storage is full")
        return { id: 500, fileKey: "k500" }
      },
    })

    const report = await runImport(
      runArgs(dir, { concurrency: 1 }),
      runDeps({ createSink: () => sink }),
    )

    // One landed, one failed fatally, and the remaining two were not attempted —
    // rather than four identical "storage is full" errors.
    assert.equal(report.exitCode, 2)
    assert.equal(report.imported.length, 1)
    assert.deepEqual(
      report.failed.map((f) => f.code),
      ["DESTINATION_FULL"],
    )
    assert.deepEqual(report.unattempted, ["c.jpg", "d.jpg"])
  })

  it("stops the whole run when the admin session dies mid-flight", async () => {
    const dir = scratch("run-auth-lost")
    for (const name of ["a.jpg", "b.jpg", "c.jpg"]) {
      write(dir, name, makeJpegWithMetadata({ width: 100, height: 100 }))
    }
    const sink = stubSink({
      async createSession() {
        throw new MediaImportError("AUTH_LOST", "The admin session expired mid-run")
      },
    })

    const report = await runImport(
      runArgs(dir, { concurrency: 1 }),
      runDeps({ createSink: () => sink }),
    )
    assert.equal(report.exitCode, 2)
    assert.equal(report.failed.length, 1)
    assert.equal(report.unattempted.length, 2)
  })

  it("writes nothing at all on a dry run", async () => {
    const dir = scratch("run-dry")
    write(dir, "one.jpg", makeJpegWithMetadata({}))
    const sink = stubSink()
    const cliArgs = runArgs(dir, { dryRun: true })

    const report = await runImport(cliArgs, runDeps({ createSink: () => sink }))

    assert.equal(report.exitCode, 0)
    assert.equal(report.imported.length, 0)
    assert.deepEqual(sink.calls.created, [])
    assert.equal(fs.existsSync(cliArgs.manifestPath), false)
  })

  it("refuses to start when the destination is out of room", async () => {
    const dir = scratch("run-full")
    write(dir, "one.jpg", makeJpegWithMetadata({}))
    const sink = stubSink({
      async preflight() {
        return { ok: false, freeBytes: 0, storedBytes: 1e12, message: "Storage is full" }
      },
    })

    const report = await runImport(runArgs(dir), runDeps({ createSink: () => sink }))
    assert.equal(report.exitCode, 2)
    assert.deepEqual(sink.calls.created, [])
  })

  it("aborts before scanning when there is no image backend", async () => {
    const dir = scratch("run-no-backend")
    write(dir, "one.jpg", makeJpegWithMetadata({}))
    const stderr = sink1()

    const report = await runImport(
      runArgs(dir),
      runDeps({
        stderr,
        probeBackends: async () => ({ image: null, video: null }),
        createSink: () => {
          throw new Error("sink must not be built when there is no backend")
        },
      }),
    )
    assert.equal(report.exitCode, 2)
    assert.ok(stderr.lines.join("").includes("brew install vips"))
  })

  it("aborts when --videos=require has no ffmpeg to require", async () => {
    const dir = scratch("run-videos-require")
    write(dir, "clip.mp4", makeMp4(4096))
    const report = await runImport(
      runArgs(dir, { videos: "require" }),
      runDeps({ createSink: () => stubSink() }),
    )
    assert.equal(report.exitCode, 2)
  })

  it("leaves the order alone for the guest section and under --skip-reorder", async () => {
    const dir = scratch("run-order-off")
    write(dir, "one.jpg", makeJpegWithMetadata({}))

    const guest = stubSink()
    await runImport(runArgs(dir, { section: "guest" }), runDeps({ createSink: () => guest }))
    assert.deepEqual(guest.calls.ordered, [])

    const skipped = stubSink()
    await runImport(
      runArgs(dir, { skipReorder: true, force: true }),
      runDeps({ createSink: () => skipped }),
    )
    assert.deepEqual(skipped.calls.ordered, [])
  })

  it("writes the run summary as JSON when asked", async () => {
    const dir = scratch("run-report")
    write(dir, "one.jpg", makeJpegWithMetadata({ width: 640, height: 480 }))
    write(dir, "notes.txt", "text")
    const reportPath = path.join(dir, "out", "report.json")

    await runImport(
      runArgs(dir, { reportPath }),
      runDeps({ createSink: () => stubSink() }),
    )

    const written = JSON.parse(fs.readFileSync(reportPath, "utf8"))
    assert.equal(written.exitCode, 0)
    assert.equal(written.sink, "local")
    assert.equal(written.imported.length, 1)
    assert.equal(written.skipped[0].code, "UNSUPPORTED_SOURCE")
  })
})

describe("formatPlanReport", () => {
  it("discloses how many originals carry GPS, and what that does and doesn't mean", async () => {
    const dir = scratch("report-gps")
    write(dir, "located.jpg", makeJpegWithMetadata({ exif: makeExifTiff({ gps: true }) }))
    write(dir, "anonymous.jpg", makeJpegWithMetadata({}))

    const plan = await buildPlan({
      files: scanDirectory(dir),
      backends: FAKE_BACKENDS,
      manifest: { version: 1, origins: {} },
      origin: "local:" + dir,
      force: false,
      captions: /** @type {"none"} */ ("none"),
      order: /** @type {"name"} */ ("name"),
      concurrency: 1,
    })

    const lines = formatPlanReport(
      args([dir]),
      FAKE_BACKENDS,
      { ok: true, freeBytes: 1e12, storedBytes: 0 },
      plan,
    ).join("\n")

    assert.ok(lines.includes("1 of 2 photos carry GPS coordinates"))
    assert.ok(lines.includes("never served publicly"))
    assert.ok(lines.includes("--strip-original"))
  })

  it("says nothing about GPS when no original carries any", async () => {
    const dir = scratch("report-no-gps")
    write(dir, "anonymous.jpg", makeJpegWithMetadata({}))
    const plan = await buildPlan({
      files: scanDirectory(dir),
      backends: FAKE_BACKENDS,
      manifest: { version: 1, origins: {} },
      origin: "local:" + dir,
      force: false,
      captions: /** @type {"none"} */ ("none"),
      order: /** @type {"name"} */ ("name"),
      concurrency: 1,
    })
    const lines = formatPlanReport(
      args([dir]),
      FAKE_BACKENDS,
      { ok: true, freeBytes: 1e12, storedBytes: 0 },
      plan,
    ).join("\n")
    assert.ok(!lines.includes("GPS"))
  })
})
