/** @file Unit tests for core/mp4-probe.js — duration and display dimensions
 *  read straight from the container, which is what lets scripts/import-media.js
 *  import videos without ffprobe. */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import { probeMp4 } from "../../../core/mp4-probe.js"
import { makeMp4, makeMp4WithMetadata } from "../../media-fixtures.js"

/** @type {string} */
let workDir

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp4-probe-"))
})

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

/**
 * Write a buffer to a scratch file and probe it.
 * @param {Buffer} buf @param {string} name
 * @returns {Promise<import('../../../core/types.js').Mp4ProbeResult | null>}
 */
async function probeBuffer(buf, name) {
  const file = path.join(workDir, name)
  fs.writeFileSync(file, buf)
  return probeMp4(file)
}

describe("probeMp4", () => {
  it("reads duration and dimensions from a version 0 mvhd", async () => {
    const result = await probeBuffer(makeMp4WithMetadata({}), "v0.mp4")
    assert.deepEqual(result, {
      durationSeconds: 15.651,
      width: 1920,
      height: 1080,
      rotation: 0,
    })
  })

  it("reads a 64-bit version 1 mvhd", async () => {
    const buf = makeMp4WithMetadata({ version: 1, durationSeconds: 42.5, timescale: 600 })
    const result = await probeBuffer(buf, "v1.mp4")
    assert.equal(result?.durationSeconds, 42.5)
    assert.equal(result?.width, 1920)
  })

  it("swaps dimensions for a 90-degree rotation matrix", async () => {
    const buf = makeMp4WithMetadata({ width: 1920, height: 1080, rotation: 90 })
    const result = await probeBuffer(buf, "rot90.mp4")
    assert.equal(result?.width, 1080, "portrait after the quarter turn")
    assert.equal(result?.height, 1920)
    assert.equal(result?.rotation, 90)
  })

  it("swaps dimensions for a 270-degree rotation matrix", async () => {
    const buf = makeMp4WithMetadata({ width: 1920, height: 1080, rotation: 270 })
    const result = await probeBuffer(buf, "rot270.mp4")
    assert.equal(result?.width, 1080)
    assert.equal(result?.height, 1920)
    assert.equal(result?.rotation, 270)
  })

  it("picks the video trak even when an audio trak comes first", async () => {
    const buf = makeMp4WithMetadata({ audioTrakFirst: true, width: 1280, height: 720 })
    const result = await probeBuffer(buf, "audio-first.mp4")
    assert.equal(result?.width, 1280)
    assert.equal(result?.height, 720)
  })

  it("falls back to the first usable trak when no handler says 'vide'", async () => {
    const buf = makeMp4WithMetadata({ videoHandler: false, width: 640, height: 360 })
    const result = await probeBuffer(buf, "no-handler.mp4")
    assert.equal(result?.width, 640)
    assert.equal(result?.height, 360)
  })

  it("reports null duration for the 'unknown' sentinel rather than a huge number", async () => {
    const buf = makeMp4WithMetadata({ unknownDuration: true })
    const result = await probeBuffer(buf, "unknown-duration.mp4")
    assert.equal(result?.durationSeconds, null)
    assert.equal(result?.width, 1920, "dimensions still readable")
  })

  it("returns null for a file with no moov", async () => {
    assert.equal(await probeBuffer(makeMp4(256), "no-moov.mp4"), null)
  })

  it("returns null for a non-MP4 file", async () => {
    assert.equal(await probeBuffer(Buffer.from("just some text", "latin1"), "text.mp4"), null)
  })

  it("returns null for a missing file rather than throwing", async () => {
    assert.equal(await probeMp4(path.join(workDir, "does-not-exist.mp4")), null)
  })

  it("never throws on a truncated file", async () => {
    const full = makeMp4WithMetadata({})
    for (let cut = 0; cut < full.length; cut += 7) {
      const result = await probeBuffer(full.subarray(0, cut), "cut.mp4")
      assert.ok(result === null || typeof result === "object", `cut ${cut}`)
    }
  })

  it("skips a large mdat by header rather than reading it", async () => {
    // The fixture already writes mdat before moov. A probe that scanned bytes
    // instead of walking box headers would either miss moov or read 256 MB.
    const buf = makeMp4WithMetadata({})
    assert.ok(buf.includes(Buffer.from("mdat", "latin1")))
    const mdatAt = buf.indexOf(Buffer.from("mdat", "latin1"))
    const moovAt = buf.indexOf(Buffer.from("moov", "latin1"))
    assert.ok(mdatAt < moovAt, "fixture puts mdat first")
    const result = await probeBuffer(buf, "mdat-first.mp4")
    assert.equal(result?.width, 1920)
  })
})

describe("probeMp4 against a real encoder's output", () => {
  // The demo seed caches real sample videos under data/.seed-cache. They are not
  // in the repo (CLAUDE.md keeps no binaries), so this only runs after
  // `npm run seed:demo` has populated the cache.
  const sample = path.join(import.meta.dirname, "../../../data/.seed-cache/sample-15s.mp4")
  const available = fs.existsSync(sample)

  it("matches the container's declared duration and dimensions", { skip: !available }, async () => {
    const result = await probeMp4(sample)
    assert.ok(result, "sample probed")
    assert.equal(result?.width, 1920)
    assert.equal(result?.height, 1080)
    assert.ok(
      result?.durationSeconds && Math.abs(result.durationSeconds - 15.651) < 0.01,
      `duration ${result?.durationSeconds} near 15.651`,
    )
  })
})
