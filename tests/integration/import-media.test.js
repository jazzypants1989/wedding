/**
 * @file Integration tests for the bulk media importer — the whole pipeline
 * against BOTH real sinks.
 *
 * The one fake is the variant builder. The repo checks in no binary files
 * (CLAUDE.md), so every media fixture is a synthetic magic-byte stub that no
 * real image backend can decode — there is nothing here for vips to resize. The
 * stub stands in for exactly that step and returns real fixture bytes as its
 * "generated" variants, which leaves the entire rest of the pipeline real:
 * sniffing, the per-variant allowlist and byte caps, Content-Length, CSRF,
 * expectedVariants at finalize, the disk writes, the manifest, and ordering.
 * That is why runImport takes injectable deps.
 */
// MUST be first: sets TEST_SERVER_PORT + DATABASE_PATH before ../helpers.js and
// the db/ and core/ modules read them.
import { LOCAL_DATA_DIR } from "./_import-media-port.js"

/** @import * as ImportTypes from '../../scripts/lib/types.js' */

import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { after, before, beforeEach, describe, it } from "node:test"

import { itemDir } from "../../core/media-storage.js"
import { parseArgs, runImport } from "../../scripts/import-media.js"
import { loadManifest } from "../../scripts/lib/import-manifest.js"
import { MediaImportError } from "../../scripts/lib/media-errors.js"
import { createHttpSink } from "../../scripts/lib/sink-http.js"
import { createLocalSink } from "../../scripts/lib/sink-local.js"
import { makeJpeg, makeJpegWithMetadata } from "../media-fixtures.js"
import { BASE_URL, TEST_DB_PATH, getTestDb, startServer, stopServer } from "../helpers.js"

const hasAdmin = !!process.env.TEST_ADMIN_PASSWORD

/** A backend object shaped like a probed one, without probing anything. */
const FAKE_BACKENDS = {
  image: {
    name: /** @type {const} */ ("vips"),
    bin: "vips",
    versionArgs: ["--version"],
    canWebp: true,
    canHeic: true,
    autoOrients: true,
    version: "vips-8.17.0 (test stub)",
    headerBin: "vipsheader",
    childEnv: {},
  },
  video: null,
}

/** Root for source directories and the stub's scratch space. */
/** @type {string} */
let root
/** @type {DatabaseSync} */
let serverDb

before(async () => {
  root = fs.mkdtempSync(path.join(LOCAL_DATA_DIR, "sources-"))
  if (hasAdmin) {
    await startServer()
    serverDb = getTestDb()
  }
})

after(async () => {
  if (hasAdmin) await stopServer()
  fs.rmSync(LOCAL_DATA_DIR, { recursive: true, force: true })
})

/** A fresh source directory per test. */
function scratch(/** @type {string} */ name) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** @param {string} dir @param {string} name @param {Buffer} contents */
function write(dir, name, contents) {
  fs.writeFileSync(path.join(dir, name), contents)
}

/** A photo whose header is real enough for planMediaFile to read it. */
function photo(width = 1200, height = 800) {
  return makeJpegWithMetadata({ width, height })
}

/**
 * The stub variant builder: writes real JPEG fixture bytes into a work dir and
 * reports them as display/thumb, with the untouched source as the original.
 * @param {(sourcePath: string) => void} [onFile] hook for forcing a failure
 */
function stubBuilder(onFile) {
  return async (/** @type {ImportTypes.MediaPlanOk} */ plan) => {
    if (onFile) onFile(plan.sourcePath)
    const workDir = fs.mkdtempSync(path.join(root, "variants-"))
    /** @param {string} name @param {number} bytes */
    const emit = (name, bytes) => {
      const target = path.join(workDir, name + ".jpg")
      fs.writeFileSync(target, makeJpeg(bytes))
      return {
        name,
        path: target,
        bytes,
        contentType: "image/jpeg",
        width: name === "thumb" ? 400 : plan.width,
        height: name === "thumb" ? 267 : plan.height,
        quality: 0.8,
        steppedDown: false,
        warnings: [],
      }
    }
    return {
      plan,
      kind: plan.kind,
      width: plan.width,
      height: plan.height,
      durationSeconds: plan.durationSeconds,
      needsDisplay: /** @type {false} */ (false),
      artifacts: [
        emit("display", 2048),
        emit("thumb", 512),
        {
          name: "original",
          path: plan.sourcePath,
          bytes: plan.originalBytes,
          contentType: "image/jpeg",
          width: plan.width,
          height: plan.height,
          quality: null,
          steppedDown: false,
          warnings: [],
        },
      ],
      warnings: [],
      workDir,
      dispose: async () => {
        await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
      },
    }
  }
}

/** Silence the CLI's output; tests assert on the report, not the prose. */
function quiet() {
  return { write: () => true }
}

/** @param {string} dir @param {Partial<ImportTypes.ImportArgs>} [overrides] */
function argsFor(dir, overrides = {}) {
  const parsed = parseArgs([dir])
  assert.ok(parsed.valid)
  return {
    ...parsed.value,
    manifestPath: path.join(dir, "manifest.json"),
    concurrency: 2,
    ...overrides,
  }
}

/** @param {{ sink: () => ImportTypes.ImportSink, onFile?: (p: string) => void }} options */
function depsFor(options) {
  return {
    probeBackends: async () => FAKE_BACKENDS,
    buildMediaVariants: stubBuilder(options.onFile),
    createSink: options.sink,
    stdout: quiet(),
    stderr: quiet(),
  }
}

/**
 * Rows the local sink wrote. Read through a separate read-only connection rather
 * than the sink's, so the assertions can't be served stale prepared statements.
 */
function localRows() {
  const dbPath = process.env.DATABASE_PATH ?? ""
  if (!fs.existsSync(dbPath)) return []
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return /** @type {any[]} */ (db.prepare("SELECT * FROM media ORDER BY sort_order, id").all())
  } finally {
    db.close()
  }
}

// ---- the local sink -------------------------------------------------------

describe("import-media — local sink", () => {
  /** @type {ImportTypes.ImportSink | null} */
  let sink = null

  beforeEach(() => {
    sink = null
  })

  /** One shared sink per run, closed afterwards. */
  function makeSink() {
    sink = createLocalSink()
    return sink
  }

  /** @param {ReturnType<typeof argsFor>} args @param {(p: string) => void} [onFile] */
  async function run(args, onFile) {
    try {
      return await runImport(args, depsFor({ sink: makeSink, onFile }))
    } finally {
      await sink?.close()
    }
  }

  it("writes rows and files that look exactly like an admin upload", async () => {
    const dir = scratch("local-happy")
    write(dir, "IMG_0002.jpg", photo(1200, 800))
    write(dir, "IMG_0001.jpg", photo(800, 1200))
    write(dir, "notes.txt", Buffer.from("not media"))

    const report = await run(argsFor(dir))

    assert.strictEqual(report.exitCode, 0)
    assert.strictEqual(report.imported.length, 2)
    assert.strictEqual(report.failed.length, 0)

    const rows = localRows().filter((r) => report.imported.some((i) => i.id === r.id))
    assert.strictEqual(rows.length, 2)
    for (const row of rows) {
      assert.strictEqual(row.section, "official")
      assert.strictEqual(row.status, "approved")
      assert.strictEqual(row.account_id, null)
      assert.strictEqual(row.needs_display, 0)
      assert.strictEqual(row.kind, "image")
      assert.strictEqual(row.original_ext, "jpg")
      assert.ok(row.width > 0 && row.height > 0)
      assert.strictEqual(row.display_bytes, 2048)
      assert.strictEqual(row.thumb_bytes, 512)
      assert.ok(row.original_bytes > 0)
      // Every file the server's expectedVariants() requires is really there.
      for (const name of ["display.jpg", "thumb.jpg", "original.jpg"]) {
        assert.ok(
          fs.existsSync(path.join(itemDir(row.file_key), name)),
          `${name} missing for ${row.file_key}`,
        )
      }
    }

    // sort_order follows filename order, so IMG_0001 leads despite importing second.
    const byOrder = rows.slice().sort((a, b) => a.sort_order - b.sort_order)
    const nameById = new Map(report.imported.map((i) => [i.id, i.file]))
    assert.deepStrictEqual(
      byOrder.map((r) => nameById.get(r.id)),
      ["IMG_0001.jpg", "IMG_0002.jpg"],
    )
  })

  it("is a no-op on a second run, and re-imports once the manifest is gone", async () => {
    const dir = scratch("local-idempotent")
    write(dir, "one.jpg", photo(300, 200))
    const args = argsFor(dir)

    const first = await run(args)
    assert.strictEqual(first.imported.length, 1)

    const second = await run(args)
    assert.strictEqual(second.imported.length, 0)
    assert.strictEqual(second.exitCode, 0)
    assert.deepStrictEqual(
      second.skipped.map((s) => s.code),
      ["ALREADY_IMPORTED"],
    )

    // Renaming the source changes nothing: the manifest is keyed by content.
    fs.renameSync(path.join(dir, "one.jpg"), path.join(dir, "renamed.jpg"))
    const third = await run(args)
    assert.strictEqual(third.imported.length, 0)
    assert.strictEqual(third.skipped[0].code, "ALREADY_IMPORTED")

    fs.rmSync(args.manifestPath)
    const fourth = await run(args)
    assert.strictEqual(fourth.imported.length, 1)
  })

  it("keeps going when one file fails, and leaves no half-finished row behind", async () => {
    const dir = scratch("local-partial")
    write(dir, "good-1.jpg", photo(100, 100))
    write(dir, "bad.jpg", photo(200, 200))
    write(dir, "good-2.jpg", photo(300, 300))

    const before = localRows().length
    const report = await run(argsFor(dir, { concurrency: 1 }), (sourcePath) => {
      if (sourcePath.endsWith("bad.jpg")) {
        throw new MediaImportError("VARIANT_TOO_LARGE", "display stayed over its cap")
      }
    })

    assert.strictEqual(report.exitCode, 1)
    assert.strictEqual(report.imported.length, 2)
    assert.deepStrictEqual(
      report.failed.map((f) => f.code),
      ["VARIANT_TOO_LARGE"],
    )
    // Two new rows, not three — no 'uploading' row was orphaned by the failure.
    assert.strictEqual(localRows().length, before + 2)
    assert.strictEqual(localRows().filter((r) => r.status === "uploading").length, 0)

    // The failed file is absent from the manifest, so a re-run retries it.
    const manifest = loadManifest(argsFor(dir).manifestPath)
    const entries = Object.values(manifest.origins)[0] ?? {}
    assert.strictEqual(Object.keys(entries).length, 2)
  })

  it("creates nothing on a dry run", async () => {
    const dir = scratch("local-dry")
    write(dir, "one.jpg", photo())
    const args = argsFor(dir, { dryRun: true })

    const before = localRows().length
    const report = await runImport(args, depsFor({ sink: () => createLocalSink({ readOnly: true }) }))

    assert.strictEqual(report.exitCode, 0)
    assert.strictEqual(report.imported.length, 0)
    assert.strictEqual(localRows().length, before)
    assert.strictEqual(fs.existsSync(args.manifestPath), false)
  })

  it("stops the run when the site-wide byte cap is reached", async () => {
    const dir = scratch("local-full")
    // MEDIA_MAX_TOTAL_BYTES is 5MB for this file (see _import-media-port.js).
    // Filler after EOI keeps it sniffing as a JPEG with a readable header.
    write(dir, "a-huge.jpg", Buffer.concat([photo(10, 10), Buffer.alloc(6 * 1024 * 1024)]))
    write(dir, "b-small.jpg", photo(20, 20))
    write(dir, "c-small.jpg", photo(30, 30))

    const report = await run(argsFor(dir, { concurrency: 1 }))

    assert.strictEqual(report.exitCode, 2)
    assert.strictEqual(report.imported.length, 0)
    assert.deepStrictEqual(
      report.failed.map((f) => f.code),
      ["DESTINATION_FULL"],
    )
    // The files it never got to are named, so nothing is silently dropped.
    assert.deepStrictEqual(report.unattempted, ["b-small.jpg", "c-small.jpg"])
  })
})

// ---- the http sink -------------------------------------------------------

describe("import-media — http sink", { skip: !hasAdmin && "TEST_ADMIN_PASSWORD not set" }, () => {
  before(() => {
    process.env.WEDDING_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD
  })

  /** Rows in the spawned server's database. */
  function serverRows() {
    return /** @type {any[]} */ (
      serverDb.prepare("SELECT * FROM media ORDER BY sort_order, id").all()
    )
  }

  /** @param {ReturnType<typeof argsFor>} args */
  async function run(args) {
    // Held in an object rather than a plain `let`: the sink is created inside a
    // callback, and TypeScript would otherwise narrow the variable to `never`.
    /** @type {{ current: ImportTypes.ImportSink | null }} */
    const held = { current: null }
    try {
      return await runImport(
        args,
        depsFor({
          sink: () => {
            held.current = createHttpSink({ url: BASE_URL, stderr: quiet() })
            return held.current
          },
        }),
      )
    } finally {
      await held.current?.close()
    }
  }

  it("imports over the real API into the real server", async () => {
    const dir = scratch("http-happy")
    write(dir, "IMG_0002.jpg", photo(1200, 800))
    write(dir, "IMG_0001.jpg", photo(800, 1200))

    const report = await run(argsFor(dir, { url: BASE_URL }))

    assert.strictEqual(report.exitCode, 0, JSON.stringify(report.failed))
    assert.strictEqual(report.imported.length, 2)

    const ids = new Set(report.imported.map((i) => i.id))
    const rows = serverRows().filter((r) => ids.has(r.id))
    assert.strictEqual(rows.length, 2)
    for (const row of rows) {
      assert.strictEqual(row.section, "official")
      assert.strictEqual(row.status, "approved")
      assert.strictEqual(row.account_id, null)
      assert.strictEqual(row.needs_display, 0)
      assert.strictEqual(row.display_bytes, 2048)
      assert.strictEqual(row.thumb_bytes, 512)
      // The server writes into its own tree, derived from its DATABASE_PATH.
      const serverItemDir = path.join(
        path.dirname(TEST_DB_PATH),
        "uploads",
        "media",
        row.file_key.slice(0, 2),
        row.file_key,
      )
      for (const name of ["display.jpg", "thumb.jpg", "original.jpg"]) {
        assert.ok(fs.existsSync(path.join(serverItemDir, name)), `${name} missing over HTTP`)
      }
    }

    // The reorder call ran and put them in filename order.
    const nameById = new Map(report.imported.map((i) => [i.id, i.file]))
    assert.deepStrictEqual(
      rows.slice().sort((a, b) => a.sort_order - b.sort_order).map((r) => nameById.get(r.id)),
      ["IMG_0001.jpg", "IMG_0002.jpg"],
    )
  })

  it("keys the manifest by the URL, so a local run does not suppress a remote one", async () => {
    const dir = scratch("http-origin")
    write(dir, "one.jpg", photo(640, 480))
    const args = argsFor(dir, { url: BASE_URL })

    const first = await run(args)
    assert.strictEqual(first.imported.length, 1)
    assert.deepStrictEqual(Object.keys(loadManifest(args.manifestPath).origins), [BASE_URL])

    const second = await run(args)
    assert.strictEqual(second.imported.length, 0)

    // Same directory, same manifest, different destination → imports again.
    /** @type {{ current: ImportTypes.ImportSink | null }} */
    const held = { current: null }
    try {
      const local = await runImport(
        { ...args, url: null },
        depsFor({
          sink: () => {
            held.current = createLocalSink()
            return held.current
          },
        }),
      )
      assert.strictEqual(local.imported.length, 1)
    } finally {
      await held.current?.close()
    }
    assert.strictEqual(Object.keys(loadManifest(args.manifestPath).origins).length, 2)
  })
})
