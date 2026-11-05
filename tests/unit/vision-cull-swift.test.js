/** @file End-to-end test: cull-scores-macos.swift on generated images, through
 *  cull-data.js. Every image comes from vision-cull-fixtures.swift, which draws
 *  them; nothing here touches a photograph.
 *
 *  Skipped wherever the toolchain is absent, because the scorer is a dev-machine
 *  tool and CI runs on Linux. The skip reason says so rather than passing silently.
 */
/** @import * as Types from '../../scripts/vision/types.js' */

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, describe, test } from "node:test"

import { runCullData } from "../../scripts/vision/cull-data.js"
import { CULL_DEFAULTS, buildSelection } from "../../scripts/vision/cull-logic.js"
import { makeJpeg, makeMp4 } from "../media-fixtures.js"

const SCORER = path.join(import.meta.dirname, "../../scripts/vision/cull-scores-macos.swift")
const FIXTURES = path.join(import.meta.dirname, "vision-cull-fixtures.swift")

/**
 * Probed by trying to run it, per CLAUDE.md: never `which`, never a hard-coded path.
 * @returns {string | null} why this cannot run, or null if it can
 */
function whyNot() {
  if (process.platform !== "darwin") return "the scorer needs macOS's Vision.framework"
  const probe = spawnSync("swiftc", ["--version"], { encoding: "utf8" })
  if (probe.error) return "swiftc could not be run"
  return probe.status === 0 ? null : "swiftc did not run cleanly"
}

/**
 * @param {string} source
 * @param {string} binary
 */
function compile(source, binary) {
  const built = spawnSync("swiftc", ["-o", binary, source], { encoding: "utf8" })
  assert.equal(built.status, 0, built.stderr)
}

/**
 * @param {string} file
 * @returns {Array<Types.CullScoreRow | Types.CullMetaRow>}
 */
function rowsOf(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

const reason = whyNot()

describe("cull-scores-macos, end to end", { skip: reason ?? false }, () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cull-swift-"))
  const photos = path.join(scratch, "generated images")
  const outDir = path.join(scratch, "tmp", "cull")
  const scorer = path.join(scratch, "scorer")
  const scoresFile = path.join(outDir, "scores.jsonl")
  /** @type {Map<string, Types.CullScoreRow>} */
  const byRel = new Map()
  /** @type {Types.CullMetaRow} */
  let meta
  /** @type {ReturnType<typeof spawnSync>} */
  let firstRun

  before(() => {
    const generator = path.join(scratch, "fixtures")
    compile(SCORER, scorer)
    compile(FIXTURES, generator)
    const made = spawnSync(generator, [photos], { encoding: "utf8" })
    assert.equal(made.status, 0, made.stderr)

    // What the Swift has to cope with beyond well-formed images.
    fs.writeFileSync(path.join(photos, "reception", "note.txt"), "not media")
    fs.writeFileSync(path.join(photos, "reception", "corrupt.jpg"), makeJpeg(64))
    fs.writeFileSync(path.join(photos, "reception", "stub.mp4"), makeMp4(64))
    fs.copyFileSync(
      path.join(photos, "ceremony", "a1.jpg"),
      path.join(photos, "reception", "copy of a1.jpg"),
    )

    firstRun = spawnSync(scorer, [photos, "--out", outDir], { encoding: "utf8" })
    assert.equal(firstRun.status, 0, String(firstRun.stderr))
    for (const row of rowsOf(scoresFile)) {
      if (row.kind === "meta") meta = row
      else byRel.set(row.rel, row)
    }
  })
  after(() => fs.rmSync(scratch, { recursive: true, force: true }))

  test("records which APIs are available, and every one is on this machine or says why", () => {
    for (const name of ["aesthetics", "featurePrint", "faceLandmarks", "faceCaptureQuality"]) {
      const api = meta.apis[name]
      assert.ok(api, name)
      assert.ok(api.available || typeof api.note === "string", name)
    }
  })

  test("--probe reports without needing a directory", () => {
    const probe = spawnSync(scorer, ["--probe"], { encoding: "utf8" })
    assert.equal(probe.status, 0)
    assert.equal(JSON.parse(probe.stdout).kind, "meta")
  })

  test("the directory is an argument, and nothing searches for one", () => {
    const run = spawnSync(scorer, [], { encoding: "utf8", cwd: scratch })
    assert.equal(run.status, 2)
    assert.ok(!fs.existsSync(path.join(scratch, "tmp", "cull", "absent")))
  })

  test("output anywhere but a tmp directory is refused", () => {
    const elsewhere = path.join(scratch, "not-scratch")
    const run = spawnSync(scorer, [photos, "--out", elsewhere], { encoding: "utf8" })
    assert.equal(run.status, 2)
    assert.equal(fs.existsSync(elsewhere), false)
  })

  test("a tmp directory inside a repository, but not its top-level tmp/, is refused", () => {
    // public/tmp/cull passed the old "a component named tmp" rule, inside the web root.
    const repo = path.join(scratch, "a-repo")
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true })
    const served = path.join(repo, "public", "tmp", "cull")
    const run = spawnSync(scorer, [photos, "--out", served], { encoding: "utf8" })
    assert.equal(run.status, 2)
    assert.ok(run.stderr.includes("top-level tmp/"), run.stderr)
    assert.equal(fs.existsSync(path.join(repo, "public")), false)
  })

  test("scores an image: aesthetics, a feature print, a capture time, thumb and preview", () => {
    const row = /** @type {Types.CullScoreRow} */ (byRel.get("ceremony/a1.jpg"))
    assert.equal(row.kind, "image")
    if (meta.apis.aesthetics.available) assert.equal(typeof row.aesthetics, "number")
    if (meta.apis.featurePrint.available) {
      assert.ok(row.featurePrint && row.featurePrint.count > 0)
    }
    assert.deepEqual(row.faces, [])
    assert.equal(row.captured, "2025:06:14 17:02:11")
    assert.equal(row.subsec, "120")
    assert.ok(row.thumb && fs.existsSync(path.join(outDir, row.thumb)))
    assert.ok(row.preview && fs.existsSync(path.join(outDir, row.preview)))
  })

  test("derived images carry no metadata", () => {
    const row = /** @type {Types.CullScoreRow} */ (byRel.get("ceremony/a1.jpg"))
    for (const relative of [row.thumb, row.preview]) {
      const bytes = fs.readFileSync(path.join(outDir, String(relative)))
      assert.equal(bytes[0], 0xff, "a JPEG")
      assert.ok(!bytes.includes("2025:06:14"), "no capture date")
    }
  })

  test("applies EXIF orientation: stored landscape reads as portrait", () => {
    const row = /** @type {Types.CullScoreRow} */ (byRel.get("reception/rotated.jpg"))
    assert.deepEqual([row.w, row.h], [800, 1200])
  })

  test("a HEIC gets a JPEG preview, because that is the only form Chrome can show", () => {
    const row = /** @type {Types.CullScoreRow} */ (byRel.get("reception/phone.heic"))
    assert.equal(row.kind, "image")
    assert.equal(row.captured, "2025:06:14 21:30:00")
    assert.equal(fs.readFileSync(path.join(outDir, String(row.preview)))[0], 0xff)
  })

  test("derived files have distinct names, and no name a photograph's filename is in", () => {
    const rows = Array.from(byRel.values())
    const thumbs = rows.flatMap((row) => (row.thumb ? [row.thumb] : []))
    assert.equal(new Set(thumbs).size, thumbs.length)
    for (const name of thumbs) assert.ok(!name.includes("wide") && !name.includes("narrow"))
  })

  test("a drawn face yields quality and eye readings that move with the eye", () => {
    const wide = byRel.get("reception/wide.jpg")?.faces ?? []
    const narrow = byRel.get("reception/narrow.jpg")?.faces ?? []
    assert.equal(wide.length, 1, "Vision found the drawn face")
    assert.equal(narrow.length, 1, "Vision found the drawn face")
    const [a] = wide
    const [b] = narrow
    assert.equal(typeof a.quality, "number", "capture quality joined to the landmark face")
    assert.ok(a.x > 0 && a.y > 0 && a.w > 0 && a.h > 0 && a.x + a.w < 1 && a.y + a.h < 1)
    assert.ok(/** @type {number} */ (a.px) > 100)
    const openness = (/** @type {Types.CullFaceScore} */ face) =>
      (/** @type {number} */ (face.leftEye) + /** @type {number} */ (face.rightEye)) / 2
    assert.ok(openness(a) > openness(b), `${openness(a)} should exceed ${openness(b)}`)
  })

  test("a filename a shell would misread comes through intact", () => {
    const names = Array.from(byRel.keys()).map((name) => name.normalize("NFC"))
    assert.ok(names.includes('reception/café $x; "q".jpg'))
  })

  test("what will not decode is recorded, not dropped; non-media is left out", () => {
    assert.equal(byRel.get("reception/corrupt.jpg")?.error, "decode")
    assert.equal(byRel.has("reception/note.txt"), false)
  })

  test("a video gets a row and no scores, even when it yields no poster", () => {
    const row = /** @type {Types.CullScoreRow} */ (byRel.get("reception/stub.mp4"))
    assert.equal(row.kind, "video")
    assert.equal(row.aesthetics, undefined)
    assert.equal(row.faces, undefined)
  })

  test("a re-run is a resume: decoded files are skipped, and a failed one retried", () => {
    const before = rowsOf(scoresFile).length
    const again = spawnSync(scorer, [photos, "--out", outDir], { encoding: "utf8" })
    assert.equal(again.status, 0)
    const rows = rowsOf(scoresFile).slice(before)
    assert.deepEqual(
      rows.map((row) => (row.kind === "meta" ? "meta" : row.rel)),
      ["meta", "reception/corrupt.jpg"],
    )
    // The resumed run must not have written over an earlier photograph's derived files.
    for (const row of byRel.values()) {
      if (row.thumb) assert.ok(fs.existsSync(path.join(outDir, row.thumb)), row.rel)
    }
  })

  test("a half-written last line does not swallow the next row", () => {
    fs.appendFileSync(scoresFile, '{"kind":"image","rel":"half')
    const again = spawnSync(scorer, [photos, "--out", outDir], { encoding: "utf8" })
    assert.equal(again.status, 0)
    const lines = fs.readFileSync(scoresFile, "utf8").split("\n")
    assert.ok(lines.includes('{"kind":"image","rel":"half'))
    assert.ok(lines.some((line) => line.includes('"kind":"meta"')))
  })

  test("a run against another directory is refused rather than mixed in", () => {
    const other = path.join(scratch, "other")
    fs.mkdirSync(other)
    const run = spawnSync(scorer, [other, "--out", outDir], { encoding: "utf8" })
    assert.equal(run.status, 2)
    assert.ok(String(run.stderr).includes("--force"))
  })

  test("flows into cull-data: bursts, a pick, a copy collapsed, a valid selection", async () => {
    /** @type {string[]} */
    const lines = []
    const { data } = await runCullData(
      { dir: photos, outDir, labels: null, identities: null, run: null, defaults: CULL_DEFAULTS },
      { log: (line) => void lines.push(line) },
    )
    assert.ok(
      !lines.some((line) => line.includes("different directory")),
      "the scorer and the join resolve the photo directory the same way",
    )
    assert.ok(data.items.find((item) => item.rel === "reception/phone.heic")?.preview)

    const rels = data.groups.map((group) => group.items.map((id) => data.items[id].rel))
    const burst = rels.find((list) => list.includes("ceremony/a1.jpg"))
    assert.deepEqual(burst, ["ceremony/a1.jpg", "ceremony/a2.jpg", "ceremony/a3.jpg"])
    assert.ok(rels.some((list) => list.length === 1 && list[0] === "ceremony/other.jpg"))
    assert.ok(
      rels.some((list) => list.includes("reception/wide.jpg") && list.includes("reception/narrow.jpg")),
      "two drawn faces a second apart are a burst",
    )

    const first = data.items.find((item) => item.rel === "ceremony/a1.jpg")
    assert.deepEqual(first?.alsoAt, ["reception/copy of a1.jpg"])
    assert.equal(
      first?.sha,
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(photos, "ceremony", "a1.jpg")))
        .digest("hex"),
    )

    const corrupt = data.items.find((item) => item.rel === "reception/corrupt.jpg")
    assert.ok(corrupt?.flags.includes("no-scores"), "listed, and marked rather than rejected")

    // Nothing decided: nothing is listed, the video included. Kept, the stub counts as one.
    assert.deepEqual(buildSelection(data.items, {}).visible, [])
    const video = crypto.createHash("sha256").update(makeMp4(64)).digest("hex")
    assert.ok(data.items.some((item) => item.kind === "video" && item.sha === video))
    assert.deepEqual(buildSelection(data.items, { [video]: "keep" }).visible, [video])
  })
})
