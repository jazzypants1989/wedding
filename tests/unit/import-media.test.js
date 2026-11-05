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
  applySelectionCommand,
  assessCapacity,
  buildPlan,
  compareWithSelection,
  formatPlanReport,
  parseArgs,
  runImport,
  scanDirectory,
} from "../../scripts/import-media.js"
import { loadManifest, saveManifest } from "../../scripts/lib/import-manifest.js"
import { loadDotEnv } from "../../scripts/lib/load-env.js"
import {
  TRANSCODE_BYTES_PER_PIXEL,
  VARIANT_BYTES_PER_PIXEL,
  estimateStoredBytes,
} from "../../scripts/lib/media-variants.js"
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

/** A fake destination: row id → status. Shared between stub sinks, so a
 *  second run sees what the first one left, as a real server would. */
function destination() {
  return { rows: /** @type {Map<number, string>} */ (new Map()), nextId: 100 }
}

/**
 * Records every call, so a test can assert on the whole conversation.
 * @param {object} [overrides]
 * @param {ReturnType<typeof destination>} [dest]
 */
function stubSink(overrides = {}, dest = destination()) {
  /** @type {{ created: number[], put: [number, string][], finalized: number[], finalizeInputs: Array<{ sourceSha256: string | null, hidden?: boolean }>, discarded: number[], ordered: number[][], setStatus: [number, string][], looked: number[][] }} */
  const calls = {
    created: [],
    put: [],
    finalized: [],
    finalizeInputs: [],
    discarded: [],
    ordered: [],
    setStatus: [],
    looked: [],
  }
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
      const id = dest.nextId++
      calls.created.push(id)
      dest.rows.set(id, "uploading")
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
      const status = input.hidden ? "hidden" : "approved"
      dest.rows.set(id, status)
      return { id, status }
    },
    /** @param {number} id */
    async discard(id) {
      calls.discarded.push(id)
      dest.rows.delete(id)
    },
    /** @param {number[]} ids @returns {Promise<import('../../scripts/lib/types.js').RowStatusLookup>} */
    async statuses(ids) {
      calls.looked.push(ids)
      return { ok: true, statuses: new Map(ids.map((id) => [id, dest.rows.get(id) ?? null])) }
    },
    /** Like the http sink: no search by content. */
    async findByContent() {
      return null
    },
    /** @param {number} id @param {string} status */
    async setStatus(id, status) {
      calls.setStatus.push([id, status])
      if (!dest.rows.has(id)) return { ok: false, message: "gone" }
      dest.rows.set(id, status)
      return { ok: true }
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

  it("says what happened when the published row couldn't be taken back", async () => {
    const dir = scratch("sel-not-honoured-stuck")
    write(dir, "a.jpg", makeJpegWithMetadata({ width: 100, height: 100 }))
    const removed = stubSink({
      /** @param {number} id */
      async finalize(id) {
        return { id, status: "approved" }
      },
    })
    const ok = await runImport(selectionArgs(dir, []), selectionDeps({ createSink: () => removed }))
    assert.ok(ok.failed[0].message.includes("It was deleted again."), ok.failed[0].message)
    assert.ok(!ok.failed[0].message.includes("may still be public"))

    const stuckDir = scratch("sel-not-honoured-stuck-2")
    write(stuckDir, "a.jpg", makeJpegWithMetadata({ width: 100, height: 100 }))
    const stuck = stubSink({
      /** @param {number} id */
      async finalize(id) {
        return { id, status: "approved" }
      },
      async discard() {
        throw new Error("DELETE answered 500")
      },
    })
    const report = await runImport(selectionArgs(stuckDir, []), selectionDeps({ createSink: () => stuck }))
    assert.equal(report.exitCode, 2)
    const message = report.failed[0].message
    assert.ok(!message.includes("deleted again"), message)
    assert.ok(!message.includes("has been removed"), message)
    assert.ok(message.includes("Deleting it failed (DELETE answered 500)"), message)
    assert.ok(message.includes(`media ${stuck.calls.created[0]}`), message)
    assert.ok(message.includes("may still be public"), message)
  })

  it("still says when selected hashes match nothing here", async () => {
    const dir = scratch("sel-unmatched")
    write(dir, "first.jpg", makeJpegWithMetadata({ width: 300, height: 200 }))
    const stranger = sha(Buffer.from("a photo that isn't in this directory"))
    const stdout = sink1()
    const report = await runImport(
      selectionArgs(dir, [stranger]),
      selectionDeps({ stdout, createSink: () => stubSink() }),
    )
    const printed = stdout.lines.join("")
    assert.ok(printed.includes("0 file(s) finish visible, 1 finish hidden"))
    assert.ok(printed.includes("1 selected hash(es) match no file here"))
    assert.equal(report.imported[0].status, "hidden")
  })
})

// --- What a selection guarantees on later runs ----------------------------------

describe("a selection, on later runs", () => {
  /** @param {Buffer} bytes */
  const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")

  const A = makeJpegWithMetadata({ width: 1000, height: 700 })
  const B = makeJpegWithMetadata({ width: 1100, height: 700 })

  /** A.jpg and B.jpg, plus a selection file that can be rewritten per run. */
  function photos(/** @type {string} */ name) {
    const dir = scratch(name)
    write(dir, "A.jpg", A)
    write(dir, "B.jpg", B)
    return dir
  }

  /** @param {string} dir @param {string[] | null} visible @param {object} [overrides] */
  function runArgsFor(dir, visible, overrides = {}) {
    /** @type {string | null} */
    let selectionPath = null
    if (visible) {
      selectionPath = path.join(dir, "selection.json")
      fs.writeFileSync(selectionPath, JSON.stringify({ version: 1, visible }))
    }
    return {
      ...args([dir]),
      manifestPath: path.join(dir, "manifest.json"),
      concurrency: 1,
      selectionPath,
      ...overrides,
    }
  }

  /** One run against a destination; returns the report, both streams and the sink. */
  async function run(
    /** @type {ReturnType<typeof runArgsFor>} */ cliArgs,
    /** @type {ReturnType<typeof destination>} */ dest,
    /** @type {object} */ overrides = {},
  ) {
    const stdout = sink1()
    const stderr = sink1()
    const sink = stubSink(overrides, dest)
    let sinkMade = false
    const report = await runImport(cliArgs, {
      probeBackends: async () => FAKE_BACKENDS,
      buildMediaVariants: stubBuilder(),
      stdout,
      stderr,
      createSink: () => {
        sinkMade = true
        return sink
      },
    })
    return {
      report,
      sink,
      sinkMade,
      out: stdout.lines.join(""),
      err: stderr.lines.join(""),
    }
  }

  it("parses --apply-selection and --no-selection, and refuses them in the wrong company", () => {
    assert.equal(args(["/p", "--selection=/s.json", "--apply-selection"]).applySelection, true)
    assert.equal(args(["/p", "--no-selection"]).noSelection, true)
    assert.equal(args(["/p"]).applySelection, false)
    assert.equal(args(["/p"]).noSelection, false)
    const lonely = parseArgs(["/p", "--apply-selection"])
    assert.equal(lonely.valid, false)
    assert.ok(!lonely.valid && lonely.error.includes("--selection"))
    assert.equal(parseArgs(["/p", "--selection=/s.json", "--no-selection"]).valid, false)
  })

  it("refuses a resume without --selection, before any sink exists", async () => {
    const dir = photos("later-resume-refused")
    const dest = destination()
    const first = await run(runArgsFor(dir, [sha(A)]), dest)
    assert.equal(first.report.exitCode, 0)

    // A new photo arrives; the owner re-runs from shell history without the flag.
    write(dir, "C.jpg", makeJpegWithMetadata({ width: 1200, height: 700 }))
    const second = await run(runArgsFor(dir, null), dest)
    assert.equal(second.report.exitCode, 2)
    assert.equal(second.sinkMade, false, "nothing was uploaded, nothing was even asked")
    assert.ok(second.err.includes("an earlier run to this destination used --selection="), second.err)
    assert.ok(second.err.includes(path.join(dir, "selection.json")), second.err)
    assert.ok(second.err.includes("--no-selection"), second.err)
    assert.equal(dest.rows.get(101), "hidden", "the reject is still hidden")
  })

  it("refuses the same way with --force, which would otherwise publish every reject again", async () => {
    const dir = photos("later-force-refused")
    const dest = destination()
    await run(runArgsFor(dir, [sha(A)]), dest)
    const forced = await run(runArgsFor(dir, null, { force: true }), dest)
    assert.equal(forced.report.exitCode, 2)
    assert.equal(forced.sinkMade, false)
  })

  it("--no-selection is the override, and says what it means", async () => {
    const dir = photos("later-no-selection")
    const dest = destination()
    await run(runArgsFor(dir, [sha(A)]), dest)
    write(dir, "C.jpg", makeJpegWithMetadata({ width: 1200, height: 700 }))

    const opted = await run(runArgsFor(dir, null, { noSelection: true }), dest)
    assert.equal(opted.report.exitCode, 0)
    assert.deepEqual(
      opted.report.imported.map((row) => [row.file, row.status]),
      [["C.jpg", "approved"]],
    )
    assert.ok(opted.out.includes("--no-selection: every file this run uploads finishes visible"))
    assert.ok(opted.out.includes("Rows already imported keep their status."))
    assert.equal(dest.rows.get(101), "hidden", "existing rows are untouched")
    assert.deepEqual(opted.sink.calls.setStatus, [])
  })

  it("an ordinary resume with the same selection is quiet", async () => {
    const dir = photos("later-ordinary")
    const dest = destination()
    await run(runArgsFor(dir, [sha(A)]), dest)
    write(dir, "C.jpg", makeJpegWithMetadata({ width: 1200, height: 700 }))

    const again = await run(runArgsFor(dir, [sha(A)]), dest)
    assert.equal(again.report.exitCode, 0)
    assert.deepEqual(
      again.report.imported.map((row) => [row.file, row.status]),
      [["C.jpg", "hidden"]],
    )
    assert.ok(again.out.includes("✓ The 2 row(s) already imported match the selection."), again.out)
    assert.ok(!again.out.includes("not what the selection says"), again.out)
    assert.ok(!again.out.includes("aren't in the selection"), again.out)
    assert.equal(again.err.includes("✗"), false, again.err)
    assert.deepEqual(again.sink.calls.setStatus, [])
  })

  it("a flipped selection names each row, refuses, and --apply-selection makes them match", async () => {
    const dir = photos("later-flipped")
    const dest = destination()
    const first = await run(runArgsFor(dir, [sha(A)]), dest)
    assert.deepEqual(
      first.report.imported.map((row) => [row.file, row.id, row.status]),
      [
        ["A.jpg", 100, "approved"],
        ["B.jpg", 101, "hidden"],
      ],
    )

    // The couple changed their minds: B in, A out.
    const flipped = await run(runArgsFor(dir, [sha(B)]), dest)
    assert.equal(flipped.report.exitCode, 2)
    assert.ok(flipped.out.includes("✗ A.jpg  media 100  approved; the selection leaves it out"), flipped.out)
    assert.ok(flipped.out.includes("! B.jpg  media 101  hidden; the selection lists it"), flipped.out)
    assert.ok(flipped.err.includes("1 row(s) the selection leaves out are public"), flipped.err)
    assert.ok(
      flipped.err.includes(
        `npm run import:media -- ${dir} --selection=${path.join(dir, "selection.json")} ` +
          `--manifest=${path.join(dir, "manifest.json")} --apply-selection`,
      ),
      flipped.err,
    )
    assert.deepEqual(flipped.sink.calls.setStatus, [], "nothing changed without the flag")
    assert.equal(dest.rows.get(100), "approved")

    // A dry run says the same, and also fails.
    const dry = await run(runArgsFor(dir, [sha(B)], { dryRun: true }), dest)
    assert.equal(dry.report.exitCode, 2)
    assert.ok(dry.err.includes("--apply-selection"))

    const applied = await run(runArgsFor(dir, [sha(B)], { applySelection: true }), dest)
    assert.equal(applied.report.exitCode, 0, applied.err)
    assert.deepEqual(applied.sink.calls.setStatus, [
      [100, "hidden"],
      [101, "approved"],
    ])
    assert.ok(applied.out.includes("Hid 1 row(s) and showed 1 to match the selection."), applied.out)
    assert.equal(dest.rows.get(100), "hidden")
    assert.equal(dest.rows.get(101), "approved")
    const recorded = loadManifest(path.join(dir, "manifest.json")).origins["local:" + dir]
    assert.deepEqual(
      Object.values(recorded).map((entry) => [entry.name, entry.status]).sort(),
      [
        ["A.jpg", "hidden"],
        ["B.jpg", "approved"],
      ],
    )

    // And afterwards, the same selection is an ordinary, quiet resume.
    const after = await run(runArgsFor(dir, [sha(B)]), dest)
    assert.equal(after.report.exitCode, 0)
    assert.ok(after.out.includes("✓ The 2 row(s) already imported match the selection."))
  })

  it("reads the destination's status, not the manifest's: a reject published since is caught", async () => {
    const dir = photos("later-published-since")
    const dest = destination()
    await run(runArgsFor(dir, [sha(A)]), dest)
    // Someone approved the reject in the admin since. The manifest still says hidden.
    dest.rows.set(101, "approved")

    const again = await run(runArgsFor(dir, [sha(A)]), dest)
    assert.equal(again.report.exitCode, 2)
    assert.ok(again.out.includes("✗ B.jpg  media 101  approved; the selection leaves it out"), again.out)
    assert.deepEqual(again.sink.calls.looked, [[100, 101]])
  })

  it("dry run with --apply-selection says what it would do, and changes nothing", async () => {
    const dir = photos("later-apply-dry")
    const dest = destination()
    await run(runArgsFor(dir, [sha(A)]), dest)
    const dry = await run(runArgsFor(dir, [sha(B)], { dryRun: true, applySelection: true }), dest)
    assert.equal(dry.report.exitCode, 0)
    assert.ok(dry.out.includes("--apply-selection would hide 1 and show 1 row(s)."), dry.out)
    assert.deepEqual(dry.sink.calls.setStatus, [])
    assert.equal(dest.rows.get(100), "approved")
  })

  it("stops before uploading when a row can't be hidden", async () => {
    const dir = photos("later-apply-fails")
    const dest = destination()
    await run(runArgsFor(dir, [sha(A)]), dest)
    write(dir, "C.jpg", makeJpegWithMetadata({ width: 1200, height: 700 }))
    const failing = await run(runArgsFor(dir, [sha(B)], { applySelection: true }), dest, {
      async setStatus() {
        return { ok: false, message: "answered 409" }
      },
    })
    assert.equal(failing.report.exitCode, 2)
    assert.deepEqual(failing.sink.calls.created, [], "no upload after a failed hide")
    assert.ok(failing.err.includes("Couldn't hide A.jpg  media 100: answered 409"), failing.err)
    assert.ok(failing.err.includes("may still be public"), failing.err)
  })

  it("--force with a rejected file hides the earlier public copy and keeps tracking it", async () => {
    const dir = photos("later-force-reject")
    const dest = destination()
    await run(runArgsFor(dir, [sha(A), sha(B)]), dest)
    assert.equal(dest.rows.get(100), "approved")

    // A is now a reject, and the owner re-imports everything with --force.
    const refused = await run(runArgsFor(dir, [sha(B)], { force: true }), dest)
    assert.equal(refused.report.exitCode, 2)
    assert.deepEqual(refused.sink.calls.created, [], "no second copy while the first is public")
    assert.ok(refused.out.includes("✗ A.jpg  media 100  approved"), refused.out)
    assert.ok(refused.err.includes("--force"), "the fix command keeps the owner's --force")

    const forced = await run(runArgsFor(dir, [sha(B)], { force: true, applySelection: true }), dest)
    assert.equal(forced.report.exitCode, 0, forced.err)
    assert.equal(dest.rows.get(100), "hidden", "the earlier public copy is down")
    const newA = forced.report.imported.find((row) => row.file === "A.jpg")
    assert.equal(newA?.status, "hidden")
    const entry = loadManifest(path.join(dir, "manifest.json")).origins["local:" + dir][sha(A)]
    assert.equal(entry.id, newA?.id)
    assert.deepEqual(
      entry.earlier?.map((row) => [row.id, row.status]),
      [[100, "hidden"]],
      "the replaced row is still tracked",
    )

    // Both copies stay within reach of a later selection.
    const back = await run(runArgsFor(dir, [sha(A), sha(B)]), dest)
    assert.ok(back.out.includes(`A.jpg  media ${newA?.id}  hidden; the selection lists it`), back.out)
    assert.ok(back.out.includes("A.jpg  media 100  hidden; the selection lists it"), back.out)
  })

  describe("a manifest written before statuses were recorded", () => {
    /** Strip what the old format didn't have. @param {string} manifestPath */
    function makeOld(manifestPath) {
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      delete raw.selections
      for (const entries of Object.values(raw.origins)) {
        for (const entry of Object.values(/** @type {Record<string, any>} */ (entries))) {
          delete entry.status
        }
      }
      fs.writeFileSync(manifestPath, JSON.stringify(raw))
    }

    it("refuses an unselected run when the destination shows a selection was used", async () => {
      const dir = photos("old-hidden")
      const dest = destination()
      const cliArgs = runArgsFor(dir, [sha(A)])
      await run(cliArgs, dest)
      makeOld(cliArgs.manifestPath)
      write(dir, "C.jpg", makeJpegWithMetadata({ width: 1200, height: 700 }))

      const plain = await run(runArgsFor(dir, null), dest)
      assert.equal(plain.report.exitCode, 2)
      assert.ok(plain.err.includes("predates recording selections, and 1 of its rows are hidden"), plain.err)
      assert.deepEqual(plain.sink.calls.created, [])
    })

    it("refuses when the destination can't be asked", async () => {
      const dir = photos("old-unknown")
      const dest = destination()
      const cliArgs = runArgsFor(dir, null)
      await run(cliArgs, dest)
      makeOld(cliArgs.manifestPath)

      const plain = await run(runArgsFor(dir, null), dest, {
        async statuses() {
          return { ok: false, message: "No admin password available." }
        },
      })
      assert.equal(plain.report.exitCode, 2)
      assert.ok(plain.err.includes("couldn't say whether its 2 row(s) are hidden"), plain.err)
    })

    it("lets an unselected run through when nothing is hidden, and fills the statuses in", async () => {
      const dir = photos("old-plain")
      const dest = destination()
      const cliArgs = runArgsFor(dir, null)
      await run(cliArgs, dest)
      makeOld(cliArgs.manifestPath)
      write(dir, "C.jpg", makeJpegWithMetadata({ width: 1200, height: 700 }))

      const plain = await run(runArgsFor(dir, null), dest)
      assert.equal(plain.report.exitCode, 0, plain.err)
      assert.deepEqual(plain.report.imported.map((row) => row.file), ["C.jpg"])
      const entries = Object.values(loadManifest(cliArgs.manifestPath).origins["local:" + dir])
      assert.deepEqual(entries.map((entry) => entry.status), ["approved", "approved", "approved"])
    })

    it("a selection run says so, and checks the rows against the destination", async () => {
      const dir = photos("old-selection")
      const dest = destination()
      const cliArgs = runArgsFor(dir, null)
      await run(cliArgs, dest)
      makeOld(cliArgs.manifestPath)

      const selected = await run(runArgsFor(dir, [sha(A)]), dest)
      assert.equal(selected.report.exitCode, 2)
      assert.ok(selected.out.includes("2 recorded row(s) predate the manifest keeping statuses"), selected.out)
      assert.ok(selected.out.includes("✗ B.jpg  media 101  approved; the selection leaves it out"), selected.out)
    })
  })

  it("a guest-section run that hid everything doesn't call it live", async () => {
    const dir = photos("later-guest-hidden")
    const { report, out } = await run(runArgsFor(dir, [], { section: "guest" }), destination())
    assert.equal(report.exitCode, 0)
    assert.ok(out.includes("Imported 2 of 2 file(s): 0 public, 2 hidden."), out)
    assert.ok(!out.includes("live in the guest gallery"), out)
    assert.ok(out.includes("Hidden photos are under Hidden in the admin Review tab"), out)
  })

  it("the summary always counts public and hidden, selection or not", async () => {
    const dir = photos("later-summary")
    const { out } = await run(runArgsFor(dir, null, { section: "guest" }), destination())
    assert.ok(out.includes("Imported 2 of 2 file(s): 2 public, 0 hidden."), out)
    assert.ok(out.includes("They are live in the guest gallery at /gallery."), out)

    const mixed = await run(runArgsFor(photos("later-summary-mixed"), [sha(A)], { section: "guest" }), destination())
    assert.ok(mixed.out.includes("1 public, 1 hidden."), mixed.out)
    assert.ok(mixed.out.includes("The 1 public one(s) are live in the guest gallery"), mixed.out)
  })

  it("quotes the fix command for a directory with spaces and quotes in its name", () => {
    const command = applySelectionCommand({
      ...args(["/Volumes/Photos/Jo's wedding", "--selection=/tmp/keep it.json"]),
      manifestPath: "/data/import-manifest.json",
    })
    assert.ok(command.includes("-- '/Volumes/Photos/Jo'\\''s wedding'"), command)
    assert.ok(command.includes("'--selection=/tmp/keep it.json'"), command)
    assert.ok(command.endsWith("--apply-selection"), command)
  })
})

describe("compareWithSelection", () => {
  const row = (/** @type {object} */ over) => ({
    sha256: "a",
    name: "a.jpg",
    id: 1,
    status: /** @type {string | null} */ ("approved"),
    unrecorded: false,
    ...over,
  })

  it("leaves rejected and in-flight rows alone, and counts an unknown status as a risk", () => {
    const check = compareWithSelection(
      [
        row({ id: 1, status: "rejected" }),
        row({ id: 2, status: "uploading" }),
        row({ id: 3, status: null }),
        row({ id: 4, status: "hidden" }),
        row({ id: 4, status: "approved" }),
      ],
      new Set(),
    )
    assert.deepEqual(check.toHide.map((r) => r.id), [3])
    assert.equal(check.checked, 2, "a duplicate id is compared once")
  })

  it("shows a hidden or pending row the selection lists", () => {
    const check = compareWithSelection(
      [row({ id: 1, status: "hidden" }), row({ id: 2, status: "pending" }), row({ id: 3 })],
      new Set(["a"]),
    )
    assert.deepEqual(check.toShow.map((r) => r.id), [1, 2])
    assert.deepEqual(check.toHide, [])
  })
})

describe("sizing a plan", () => {
  /** @param {object} over @returns {any} */
  const plan = (over) => ({
    ok: true,
    sourcePath: "/x",
    kind: "image",
    sniffed: "jpeg",
    originalExt: "jpg",
    originalBytes: 2_000_000,
    width: 4000,
    height: 3000,
    durationSeconds: null,
    orientation: 1,
    hasGps: false,
    capturedAt: null,
    mtimeMs: 0,
    ...over,
  })

  it("estimates a HEIC stored as JPEG above its source size, and keeps a kept one exact", () => {
    const heic = plan({ sniffed: "heic", originalExt: "heic" })
    const kept = estimateStoredBytes(heic, { section: "official", heicOriginal: "keep" })
    assert.equal(kept.originalBytes, 2_000_000)
    assert.equal(kept.originalExact, true)
    const jpeg = estimateStoredBytes(heic, { section: "official", heicOriginal: "jpeg" })
    assert.equal(jpeg.originalExact, false)
    assert.equal(jpeg.originalBytes, Math.ceil(4000 * 3000 * TRANSCODE_BYTES_PER_PIXEL))
    // A JPEG never shrinks it below the HEIC's own size.
    const tiny = estimateStoredBytes(plan({ sniffed: "heic", width: 10, height: 10 }), {
      section: "official",
      heicOriginal: "jpeg",
    })
    assert.equal(tiny.originalBytes, 2_000_000)
  })

  it("counts display and thumb at their target sizes, within the server's caps", () => {
    const estimate = estimateStoredBytes(plan({}), { section: "official", heicOriginal: "keep" })
    const display = Math.ceil(2000 * 1500 * VARIANT_BYTES_PER_PIXEL)
    const thumb = Math.ceil(400 * 300 * VARIANT_BYTES_PER_PIXEL)
    assert.equal(estimate.variantBytes, display + thumb)
  })

  it("counts variants against the disk, not the cap on originals", () => {
    const GB = 1024 * 1024 * 1024
    const result = assessCapacity(
      { originals: GB, variants: 3 * GB, estimatedOriginals: 0 },
      {
        ok: true,
        storedBytes: 0,
        maxTotalBytes: 45 * GB,
        freeBytes: 7 * GB,
        minFreeBytes: 5 * GB,
        remainingBytes: 2 * GB,
        limitedBy: "disk",
      },
    )
    assert.equal(result.level, "over")
    const text = result.lines.join("\n")
    assert.ok(text.includes("✓ Storage: 1.00 GB of originals planned"), text)
    assert.ok(text.includes("✗ Disk: about 4.00 GB with variants"), text)
    assert.ok(text.includes("MEDIA_MIN_FREE_BYTES"), text)
  })

  it("a --dry-run with --heic-original=jpeg plans the size it will store, and says it's an estimate", async () => {
    const dir = scratch("size-heic")
    write(dir, "IMG_0001.HEIC", Buffer.from("stand-in bytes; the plan below is stated"))
    const stdout = sink1()
    const MB = 1024 * 1024
    const report = await runImport(
      {
        ...args([dir, "--heic-original=jpeg"]),
        manifestPath: path.join(dir, "manifest.json"),
        dryRun: true,
      },
      {
        probeBackends: async () => FAKE_BACKENDS,
        buildMediaVariants: stubBuilder(),
        /** @param {string} sourcePath */
        planMediaFile: async (sourcePath) =>
          plan({ sourcePath, sniffed: "heic", originalExt: "heic", originalBytes: 2 * MB }),
        stdout,
        stderr: sink1(),
        createSink: () =>
          stubSink({
            // Room for the HEIC as it is on disk, not for the JPEG it becomes.
            async capacity() {
              return {
                ok: true,
                storedBytes: 0,
                maxTotalBytes: 5 * MB,
                freeBytes: null,
                minFreeBytes: 0,
                remainingBytes: 5 * MB,
                limitedBy: "cap",
              }
            },
          }),
      },
    )
    const printed = stdout.lines.join("")
    assert.equal(report.exitCode, 2, printed)
    assert.ok(printed.includes("about 9.2 MB of originals"), printed)
    assert.ok(printed.includes("1 HEIC original(s) will be stored as JPEG, estimated at 0.8 bytes per pixel"), printed)
    assert.ok(printed.includes("display/thumb/poster variants, estimated at 0.35 bytes per pixel"), printed)
    assert.ok(printed.includes("✗ Storage: about 9.2 MB of originals planned"), printed)
  })
})

describe("loading .env", () => {
  it("fills in what's unset, never overrides the shell, and shrugs at a missing file", () => {
    const dir = scratch("dotenv")
    const file = path.join(dir, ".env")
    fs.writeFileSync(file, "IMPORT_TEST_FROM_FILE=file\nIMPORT_TEST_ALREADY_SET=file\n")
    process.env.IMPORT_TEST_ALREADY_SET = "shell"
    try {
      assert.equal(loadDotEnv(file), true)
      assert.equal(process.env.IMPORT_TEST_FROM_FILE, "file")
      assert.equal(process.env.IMPORT_TEST_ALREADY_SET, "shell")
      assert.equal(loadDotEnv(path.join(dir, "absent.env")), false)
    } finally {
      delete process.env.IMPORT_TEST_FROM_FILE
      delete process.env.IMPORT_TEST_ALREADY_SET
    }
  })

  it("is the CLI's first import, ahead of anything that reads MEDIA_* at load", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "scripts", "import-media.js"), "utf8")
    const firstImport = source.slice(source.indexOf("\nimport "))
    assert.ok(firstImport.startsWith('\nimport "./lib/load-env.js"'), firstImport.slice(0, 80))
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

  /** @param {number} originals @param {number} [variants] */
  const planned = (originals, variants = 0) => ({ originals, variants, estimatedOriginals: 0 })

  describe("assessCapacity", () => {
    it("passes a plan with room to spare", () => {
      const result = assessCapacity(planned(GB), capacity())
      assert.equal(result.level, "ok")
      assert.ok(result.lines[0].includes("5.00 GB remaining"))
    })

    it("refuses a plan that doesn't fit, and says hiding saves no room", () => {
      const result = assessCapacity(planned(6 * GB), capacity())
      assert.equal(result.level, "over")
      const text = result.lines.join(" ")
      assert.ok(text.includes("MEDIA_MAX_TOTAL_BYTES"))
      assert.ok(text.includes("507"))
      assert.ok(text.includes("Hidden photos count"))
    })

    it("names the disk when the disk is the closer wall", () => {
      const result = assessCapacity(planned(6 * GB), capacity({ limitedBy: "disk" }))
      assert.ok(result.lines.join(" ").includes("MEDIA_MIN_FREE_BYTES"))
    })

    it("flags a plan that only just fits", () => {
      assert.equal(assessCapacity(planned(4.8 * GB), capacity()).level, "tight")
    })

    it("reports a check it couldn't do, rather than passing it", () => {
      const result = assessCapacity(planned(GB), { ok: false, reason: "unavailable", message: "No password." })
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
