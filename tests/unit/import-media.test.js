/** @file Unit tests for the bulk media importer's CLI layer: argument parsing,
 *  directory scanning, planning against the manifest, and the run loop.
 *
 *  The run loop is driven with a stub sink and a stub variant builder, so these
 *  tests exercise the taxonomy, ordering, manifest and abort logic with no
 *  binary backend and no database. The real local sink is covered by the
 *  integration test, which is the only place a fake would hide a bug. */

import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import {
  assessCapacity,
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
    canRawPixels: true,
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
    assert.ok(!parsed.valid && parsed.error.includes("--section=official|honeymoon|guest"))
  })

  it("accepts --section=honeymoon, and still refuses a section it doesn't know", () => {
    assert.equal(args(["/photos", "--section=honeymoon"]).section, "honeymoon")
    assert.equal(args(["/photos", "--section=guest"]).section, "guest")
    for (const bad of ["content", "Honeymoon", "honeymoon "]) {
      const parsed = parseArgs(["/photos", `--section=${bad}`])
      assert.equal(parsed.valid, false, `--section=${bad} refused`)
    }
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

  it("refuses an empty directory argument — the unset-$PHOTOS shape", () => {
    const result = parseArgs([""])
    assert.equal(result.valid, false)
    assert.ok(!result.valid && result.error.includes("empty"))
  })

  it("refuses the repository's own root directory", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..")
    const result = parseArgs([repoRoot])
    assert.equal(result.valid, false)
    assert.ok(!result.valid && result.error.includes("repository"))
  })

  it("resolves the directory to an absolute path", () => {
    // Not "." — tests run from the repo root, and the repo itself is refused.
    assert.equal(args(["tmp/photos"]).dir, path.resolve("tmp/photos"))
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
  /** @type {{ created: number[], put: [number, string][], finalized: number[], finalizeInputs: Array<{ sourceSha256: string | null, hidden?: boolean }>, discarded: number[], ordered: number[][] }} */
  const calls = { created: [], put: [], finalized: [], finalizeInputs: [], discarded: [], ordered: [] }
  let nextId = 100
  const sink = {
    name: /** @type {const} */ ("local"),
    calls,
    async preflight() {
      return { ok: true, freeBytes: 1e12, storedBytes: 0 }
    },
    /** @returns {Promise<any>} */
    async capacity() {
      return {
        ok: true,
        storedBytes: 0,
        maxTotalBytes: 1e12,
        freeBytes: 1e12,
        minFreeBytes: 0,
        remainingBytes: 1e12,
        limitedBy: "cap",
      }
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
    /** @param {number} id @param {{ sourceSha256: string | null, hidden?: boolean }} input */
    async finalize(id, input) {
      calls.finalized.push(id)
      calls.finalizeInputs.push(input)
      return { id, status: input.hidden ? "hidden" : "approved" }
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
    // Every finalize carries the origin file's content hash — the join key the
    // face pipeline matches detection runs against, stamped at import time.
    for (const input of sink.calls.finalizeInputs) {
      assert.equal(typeof input.sourceSha256, "string")
      assert.equal(/** @type {string} */ (input.sourceSha256).length, 64)
    }
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

  // SIGINT is emitted on `process` directly rather than sent as a real signal:
  // process.emit() invokes the listener synchronously, so there is no timing
  // window and nothing to make the suite flaky. What is under test is the
  // handler's contract, not the kernel's signal delivery.
  it("finishes the files in flight on SIGINT, leaves the rest, and exits 130", async () => {
    const dir = scratch("run-sigint")
    // Distinct dimensions per file: the manifest is keyed by content hash, so
    // four byte-identical fixtures would collapse to one record and the resume
    // assertions below would be measuring dedup rather than the interrupt.
    const names = ["a.jpg", "b.jpg", "c.jpg", "d.jpg"]
    names.forEach((name, i) => {
      write(dir, name, makeJpegWithMetadata({ width: 100 + i, height: 100 }))
    })
    let finalizes = 0
    const sink = stubSink({
      /** @param {number} id */
      async finalize(id) {
        finalizes++
        if (finalizes === 1) process.emit("SIGINT")
        return { id, status: "approved" }
      },
    })

    const report = await runImport(
      runArgs(dir, { concurrency: 1 }),
      runDeps({ createSink: () => sink }),
    )

    assert.equal(report.exitCode, 130, "killed by a signal, not a destination failure")
    assert.equal(report.imported.length, 1, "the file in flight still completed")
    assert.deepEqual(report.unattempted, ["b.jpg", "c.jpg", "d.jpg"])
    assert.equal(report.failed.length, 0, "an interrupt is not a per-file failure")
    // Nothing may be left half-created: every session opened was also finalized.
    assert.deepEqual(sink.calls.discarded, [])
    assert.equal(finalizes, sink.calls.created.length)
  })

  it("records the interrupted run's imports in the manifest so a re-run resumes", async () => {
    const dir = scratch("run-sigint-manifest")
    const names = ["a.jpg", "b.jpg", "c.jpg"]
    names.forEach((name, i) => {
      write(dir, name, makeJpegWithMetadata({ width: 100 + i, height: 100 }))
    })
    const cliArgs = runArgs(dir, { concurrency: 1 })
    let finalizes = 0
    const first = await runImport(
      cliArgs,
      runDeps({
        createSink: () =>
          stubSink({
            /** @param {number} id */
            async finalize(id) {
              finalizes++
              if (finalizes === 1) process.emit("SIGINT")
              return { id, status: "approved" }
            },
          }),
      }),
    )
    assert.equal(first.exitCode, 130)
    assert.deepEqual(first.imported.map((i) => i.file), ["a.jpg"])

    // The resume imports exactly what the interrupt missed.
    const second = await runImport(cliArgs, runDeps({ createSink: () => stubSink() }))
    assert.equal(second.exitCode, 0)
    assert.deepEqual(second.imported.map((i) => i.file), ["b.jpg", "c.jpg"])
    assert.deepEqual(
      second.skipped.map((s) => s.code),
      ["ALREADY_IMPORTED"],
    )
  })

  it("a fatal destination failure still exits 2, not 130", async () => {
    // Guards the split: only a signal earns 130.
    const dir = scratch("run-fatal-not-130")
    write(dir, "a.jpg", makeJpegWithMetadata({ width: 100, height: 100 }))
    write(dir, "b.jpg", makeJpegWithMetadata({ width: 100, height: 100 }))
    const sink = stubSink({
      async createSession() {
        throw new MediaImportError("DESTINATION_FULL", "Storage is full")
      },
    })
    const report = await runImport(
      runArgs(dir, { concurrency: 1 }),
      runDeps({ createSink: () => sink }),
    )
    assert.equal(report.exitCode, 2)
  })

  it("keeps a finalized row when the post-finalize bookkeeping throws", async () => {
    // saveManifest() writes wherever --manifest= points, and §3 suggests putting
    // it beside the photos on an external drive — read-only or full media is a
    // real failure mode. By then the row has been created AND approved, and the
    // report has already counted it as imported. Discarding it would delete a
    // good import over failed bookkeeping and make the report a lie.
    //
    // The throw is injected through `now`, which runImport calls once for
    // startedAt and then again to stamp the manifest entry — immediately after
    // finalize, in the same try block as saveManifest. That reaches the branch
    // deterministically, with no dependency on how a given filesystem fails.
    const dir = scratch("run-bookkeeping-throws")
    write(dir, "a.jpg", makeJpegWithMetadata({ width: 100, height: 100 }))
    const sink = stubSink()
    let calls = 0

    const report = await runImport(
      runArgs(dir, { concurrency: 1 }),
      runDeps({
        createSink: () => sink,
        now: () => {
          calls++
          if (calls === 2) throw new Error("ENOSPC: no space left on device")
          return "2026-07-29T12:00:00.000Z"
        },
      }),
    )

    assert.deepEqual(sink.calls.finalized, sink.calls.created, "the row was finalized")
    assert.deepEqual(sink.calls.discarded, [], "and must not be discarded afterwards")
    assert.equal(report.failed.length, 1, "the run still reports the bookkeeping failure")
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

// --- --selection ---------------------------------------------------------------

describe("--selection", () => {
  /** @param {Buffer} bytes */
  const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")

  /** @param {string} dir @param {string[]} visible @param {object} [overrides] */
  function selectionArgs(dir, visible, overrides = {}) {
    const selectionPath = path.join(dir, "selection.json")
    fs.writeFileSync(selectionPath, JSON.stringify({ version: 1, visible }))
    return {
      ...args([dir]),
      manifestPath: path.join(dir, "manifest.json"),
      concurrency: 1,
      selectionPath,
      ...overrides,
    }
  }

  /** @param {object} deps */
  function selectionDeps(deps = {}) {
    return {
      probeBackends: async () => FAKE_BACKENDS,
      buildMediaVariants: stubBuilder(),
      stdout: sink1(),
      stderr: sink1(),
      ...deps,
    }
  }

  it("parses as an explicit path with no default", () => {
    assert.equal(args(["/photos"]).selectionPath, null)
    assert.equal(
      args(["/photos", "--selection=/cull/keep.json"]).selectionPath,
      path.resolve("/cull/keep.json"),
    )
    assert.equal(parseArgs(["/photos", "--selection"]).valid, false)
    assert.equal(parseArgs(["/photos", "--selection="]).valid, false)
  })

  it("hides whatever isn't listed, and asks nothing else of the sink", async () => {
    const dir = scratch("sel-mixed")
    const kept = makeJpegWithMetadata({ width: 1200, height: 800 })
    const cut = makeJpegWithMetadata({ width: 800, height: 1200 })
    write(dir, "a-kept.jpg", kept)
    write(dir, "b-cut.jpg", cut)
    const sink = stubSink()

    const report = await runImport(
      selectionArgs(dir, [sha(kept)]),
      selectionDeps({ createSink: () => sink }),
    )

    assert.equal(report.exitCode, 0)
    assert.deepEqual(
      report.imported.map((row) => [row.file, row.status]),
      [
        ["a-kept.jpg", "approved"],
        ["b-cut.jpg", "hidden"],
      ],
    )
    assert.deepEqual(
      sink.calls.finalizeInputs.map((input) => input.hidden),
      [false, true],
    )
    assert.equal(report.skipped.length, 0, "the selection file itself isn't reported as a skip")
  })

  it("treats a video like any other file: hidden unless its hash is listed", async () => {
    const dir = scratch("sel-video")
    const listed = makeMp4(4096)
    const unlisted = makeMp4(8192)
    write(dir, "listed.mp4", listed)
    write(dir, "unlisted.mp4", unlisted)
    const sink = stubSink()

    const report = await runImport(
      selectionArgs(dir, [sha(listed)]),
      selectionDeps({
        createSink: () => sink,
        // No ffmpeg in a unit test, so the plan is stated rather than probed.
        /** @param {string} sourcePath */
        planMediaFile: async (sourcePath) => ({
          ok: true,
          kind: "video",
          sourcePath,
          width: 1280,
          height: 720,
          durationSeconds: 5,
          originalBytes: fs.statSync(sourcePath).size,
          mtimeMs: 0,
          hasGps: false,
        }),
      }),
    )

    assert.equal(report.exitCode, 0, JSON.stringify(report.failed))
    assert.deepEqual(
      report.imported.map((row) => [row.file, row.status]),
      [
        ["listed.mp4", "approved"],
        ["unlisted.mp4", "hidden"],
      ],
    )
  })

  it("changes nothing when the flag is absent", async () => {
    const dir = scratch("sel-absent")
    write(dir, "one.jpg", makeJpegWithMetadata({}))
    const sink = stubSink()
    const report = await runImport(
      { ...args([dir]), manifestPath: path.join(dir, "manifest.json"), concurrency: 1 },
      selectionDeps({ createSink: () => sink }),
    )
    assert.equal(report.imported[0].status, "approved")
    assert.equal(sink.calls.finalizeInputs[0].hidden, false)
  })

  it("fails before any sink exists when the file is malformed", async () => {
    for (const bad of ['{"version":2,"visible":[]}', "nope", '{"version":1,"visible":["ABC"]}']) {
      const dir = scratch(`sel-bad-${sha(Buffer.from(bad)).slice(0, 8)}`)
      write(dir, "one.jpg", makeJpegWithMetadata({}))
      const selectionPath = path.join(dir, "selection.json")
      fs.writeFileSync(selectionPath, bad)
      const stderr = sink1()
      let sinkMade = false
      const report = await runImport(
        { ...args([dir]), manifestPath: path.join(dir, "m.json"), selectionPath },
        selectionDeps({
          stderr,
          createSink: () => {
            sinkMade = true
            return stubSink()
          },
        }),
      )
      assert.equal(report.exitCode, 2, bad)
      assert.equal(sinkMade, false, bad)
      assert.ok(stderr.lines.join("").includes("--selection"), bad)
    }
  })

  it("fails the same way when the file is missing", async () => {
    const dir = scratch("sel-missing")
    write(dir, "one.jpg", makeJpegWithMetadata({}))
    let sinkMade = false
    const report = await runImport(
      {
        ...args([dir]),
        manifestPath: path.join(dir, "m.json"),
        selectionPath: path.join(dir, "absent.json"),
      },
      selectionDeps({
        createSink: () => {
          sinkMade = true
          return stubSink()
        },
      }),
    )
    assert.equal(report.exitCode, 2)
    assert.equal(sinkMade, false)
  })

  it("discards the row and stops when a server publishes what it was told to hide", async () => {
    const dir = scratch("sel-not-honoured")
    write(dir, "a.jpg", makeJpegWithMetadata({ width: 100, height: 100 }))
    write(dir, "b.jpg", makeJpegWithMetadata({ width: 200, height: 200 }))
    const sink = stubSink({
      /** @param {number} id */
      async finalize(id) {
        return { id, status: "approved" }
      },
    })

    const report = await runImport(selectionArgs(dir, []), selectionDeps({ createSink: () => sink }))

    assert.equal(report.exitCode, 2)
    assert.deepEqual(report.imported, [])
    assert.deepEqual(
      report.failed.map((failure) => failure.code),
      ["HIDDEN_NOT_HONOURED"],
    )
    assert.deepEqual(sink.calls.discarded, sink.calls.created, "the published row is taken back")
    assert.equal(sink.calls.created.length, 1, "the run stops at the first one")
    assert.deepEqual(report.unattempted, ["b.jpg"])
  })

  it("warns, with counts only, about what a selection can't reach", async () => {
    const dir = scratch("sel-warnings")
    const first = makeJpegWithMetadata({ width: 300, height: 200 })
    write(dir, "first.jpg", first)
    const manifestPath = path.join(dir, "manifest.json")
    await runImport(
      { ...args([dir]), manifestPath, concurrency: 1 },
      selectionDeps({ createSink: () => stubSink() }),
    )

    write(dir, "second.jpg", makeJpegWithMetadata({ width: 200, height: 300 }))
    const stranger = sha(Buffer.from("a photo that isn't in this directory"))
    const stdout = sink1()
    const report = await runImport(
      selectionArgs(dir, [stranger], { manifestPath }),
      selectionDeps({ stdout, createSink: () => stubSink() }),
    )
    const printed = stdout.lines.join("")
    assert.ok(printed.includes("0 file(s) finish visible, 1 finish hidden"))
    assert.ok(printed.includes("1 selected hash(es) match no file here"))
    assert.ok(printed.includes("1 already-imported file(s) aren't in the selection"))
    assert.equal(report.imported[0].status, "hidden")
  })
})

// --- Storage preflight -----------------------------------------------------------

describe("the storage check", () => {
  const GB = 1024 * 1024 * 1024
  /** @param {object} [overrides] @returns {any} */
  const capacity = (overrides = {}) => ({
    ok: true,
    storedBytes: 40 * GB,
    maxTotalBytes: 45 * GB,
    freeBytes: 500 * GB,
    minFreeBytes: 5 * GB,
    remainingBytes: 5 * GB,
    limitedBy: "cap",
    ...overrides,
  })

  describe("assessCapacity", () => {
    it("passes a plan with room to spare", () => {
      const result = assessCapacity(GB, capacity())
      assert.equal(result.level, "ok")
      assert.ok(result.lines[0].includes("5.00 GB remaining"))
    })

    it("refuses a plan that doesn't fit, and says hiding saves no room", () => {
      const result = assessCapacity(6 * GB, capacity())
      assert.equal(result.level, "over")
      const text = result.lines.join(" ")
      assert.ok(text.includes("MEDIA_MAX_TOTAL_BYTES"))
      assert.ok(text.includes("507"))
      assert.ok(text.includes("Hidden photos count"))
    })

    it("names the disk when the disk is the closer wall", () => {
      const result = assessCapacity(6 * GB, capacity({ limitedBy: "disk" }))
      assert.ok(result.lines.join(" ").includes("MEDIA_MIN_FREE_BYTES"))
    })

    it("flags a plan that only just fits", () => {
      assert.equal(assessCapacity(4.8 * GB, capacity()).level, "tight")
    })

    it("reports a check it couldn't do, rather than passing it", () => {
      const result = assessCapacity(GB, { ok: false, reason: "unavailable", message: "No password." })
      assert.equal(result.level, "unknown")
      assert.ok(result.lines[0].includes("No password."))
    })
  })

  /** @param {string} dir @param {object} sink @param {object} [overrides] */
  async function run(dir, sink, overrides = {}) {
    const stdout = sink1()
    const reportPath = path.join(dir, "report.json")
    const report = await runImport(
      {
        ...args([dir]),
        manifestPath: path.join(dir, "manifest.json"),
        concurrency: 1,
        reportPath,
        ...overrides,
      },
      {
        probeBackends: async () => FAKE_BACKENDS,
        buildMediaVariants: stubBuilder(),
        stdout,
        stderr: sink1(),
        createSink: () => /** @type {any} */ (sink),
      },
    )
    return { report, printed: stdout.lines.join(""), written: fs.readFileSync(reportPath, "utf8") }
  }

  /** @param {string} name */
  function photoDir(name) {
    const dir = scratch(name)
    write(dir, "one.jpg", makeJpegWithMetadata({}))
    return dir
  }

  const full = () =>
    stubSink({
      async capacity() {
        return capacity({ remainingBytes: 1 })
      },
    })

  it("--dry-run refuses an import that wouldn't fit, on stdout and never in a file", async () => {
    const sink = full()
    const { report, printed, written } = await run(photoDir("cap-dry-over"), sink, { dryRun: true })
    assert.equal(report.exitCode, 2)
    assert.ok(printed.includes("✗ Storage"))
    assert.equal(sink.calls.created.length, 0)
    assert.ok(!written.includes("remaining"), "nothing about capacity reaches --report")
    assert.ok(!written.includes("Storage"), "nothing about capacity reaches --report")
  })

  it("--dry-run stays clean when it fits, and when the check can't be done", async () => {
    const fits = await run(photoDir("cap-dry-ok"), stubSink(), { dryRun: true })
    assert.equal(fits.report.exitCode, 0)
    assert.ok(fits.printed.includes("✓ Storage"))

    const unknown = await run(
      photoDir("cap-dry-unknown"),
      stubSink({
        async capacity() {
          return { ok: false, reason: "unavailable", message: "No admin password available." }
        },
      }),
      { dryRun: true },
    )
    assert.equal(unknown.report.exitCode, 0)
    assert.ok(unknown.printed.includes("! Storage not checked: No admin password available."))
  })

  it("a run with a selection doesn't start what it can't finish", async () => {
    const dir = photoDir("cap-sel-over")
    const selectionPath = path.join(dir, "selection.json")
    fs.writeFileSync(selectionPath, JSON.stringify({ version: 1, visible: [] }))
    const sink = full()
    const { report } = await run(dir, sink, { selectionPath })
    assert.equal(report.exitCode, 2)
    assert.equal(sink.calls.created.length, 0)
  })

  it("a server without the endpoint is refused before any upload, dry run or not", async () => {
    const unsupported = () =>
      stubSink({
        async capacity() {
          return { ok: false, reason: "unsupported", message: "It predates hidden imports." }
        },
      })
    for (const dryRun of [true, false]) {
      const dir = photoDir(`cap-sel-old-${dryRun}`)
      const selectionPath = path.join(dir, "selection.json")
      fs.writeFileSync(selectionPath, JSON.stringify({ version: 1, visible: [] }))
      const sink = unsupported()
      const { report } = await run(dir, sink, { selectionPath, dryRun })
      assert.equal(report.exitCode, 2, `dryRun=${dryRun}`)
      assert.equal(sink.calls.created.length, 0, `dryRun=${dryRun}`)
    }
  })

  it("without a selection, a real run still goes as far as it can, as it always did", async () => {
    const sink = full()
    const { report, printed } = await run(photoDir("cap-plain-over"), sink)
    assert.equal(report.exitCode, 0)
    assert.equal(report.imported.length, 1)
    assert.ok(printed.includes("✗ Storage"), "but it says so first")
  })

  it("doesn't ask for capacity when there is nothing to import", async () => {
    let asked = false
    const dir = scratch("cap-nothing")
    write(dir, "notes.txt", Buffer.from("not media"))
    const sink = stubSink({
      async capacity() {
        asked = true
        return capacity()
      },
    })
    await run(dir, sink, { dryRun: true })
    assert.equal(asked, false, "a dry run with nothing to do never asks for a password")
  })
})
