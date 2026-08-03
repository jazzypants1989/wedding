/** @file Unit test: the weight verifier's classification and its git-lfs
 *  pointer sniff.
 *
 *  The thing worth testing here is not "does sha256 work" — it is that the
 *  three ways a weights directory goes wrong are told apart, because they have
 *  three different fixes and only one of them is "re-download". A pointer file
 *  reported as a mismatch sends you looking for corruption that isn't there.
 *
 *  Fixtures are a few hundred bytes each, written under tmp/. The real models
 *  are 38 MB and 10 MB and are deliberately not involved: a content match is
 *  asserted by pinning the fixture's own digest, which exercises the same code
 *  path at four orders of magnitude less I/O.
 */

import { test } from "node:test"
import assert from "node:assert"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  PINNED_WEIGHTS,
  parseLfsPointer,
  readLfsPointer,
  verifyAgainst,
  verifyWeights,
} from "../../scripts/vision/verify-weights.js"

const YUNET = PINNED_WEIGHTS[0]
const SFACE = PINNED_WEIGHTS[1]

/**
 * @param {string} label
 * @returns {string}
 */
function scratchDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vision-weights-${label}-`))
  return dir
}

/**
 * A pointer file exactly as git-lfs writes one, for a given object.
 *
 * @param {string} oid
 * @param {number} size
 * @returns {string}
 */
function pointerText(oid, size) {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`
}

/**
 * @param {string} dir
 * @param {string} name
 * @param {string} contents
 * @returns {void}
 */
function write(dir, name, contents) {
  fs.writeFileSync(path.join(dir, name), contents)
}

/**
 * @param {string} contents
 * @returns {string}
 */
function digestOf(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex")
}

/**
 * A pinned entry standing for `contents`, so the classifier can be exercised at
 * fixture scale. The shape is the real one; only the numbers are small.
 *
 * @param {string} contents
 * @returns {import("../../scripts/vision/types.js").PinnedWeight}
 */
function fixtureEntry(contents) {
  return {
    name: "fixture-model.onnx",
    bytes: Buffer.byteLength(contents),
    sha256: digestOf(contents),
    licence: "MIT",
    role: "fixture",
    url: "https://media.githubusercontent.com/media/example/repo/deadbeef/fixture-model.onnx",
  }
}

/**
 * @param {import("../../scripts/vision/types.js").WeightCheck[]} checks
 * @param {string} name
 * @returns {import("../../scripts/vision/types.js").WeightCheck}
 */
function find(checks, name) {
  const check = checks.find((entry) => entry.name === name)
  assert.ok(check, `no check reported for ${name}`)
  return check
}

// --- The pinned table itself -------------------------------------------------

/** Everything served from opencv_zoo, which is everything but the challenger. */
const LFS_MEDIA_HOST = "https://media.githubusercontent.com/media/"

test("pinned table is well formed", () => {
  assert.equal(PINNED_WEIGHTS.length, 4)
  for (const pinned of PINNED_WEIGHTS) {
    assert.equal(pinned.sha256.length, 64, `${pinned.name} digest is not 64 hex chars`)
    assert.equal(pinned.sha256, pinned.sha256.toLowerCase(), `${pinned.name} digest is not lowercase`)
    assert.ok(pinned.bytes > 0)
    assert.ok(pinned.name.endsWith(".onnx"))
    assert.ok(pinned.licence.length > 0)
    assert.ok(pinned.url.endsWith(pinned.name))
    if (pinned.url.startsWith(LFS_MEDIA_HOST)) {
      // Pinned to a commit, never to a branch — the URL has to be immutable.
      assert.ok(!pinned.url.includes("/main/"), `${pinned.name} is pinned to a branch, not a commit`)
    } else {
      // Not every publisher is opencv_zoo. What must hold for all of them is
      // that the URL is not raw.githubusercontent.com, which serves the LFS
      // pointer rather than the model — the failure this table exists to name.
      assert.ok(
        !pinned.url.startsWith("https://raw.githubusercontent.com/"),
        `${pinned.name} points at the pointer host, not the file`,
      )
    }
  }
  const names = new Set(PINNED_WEIGHTS.map((pinned) => pinned.name))
  assert.equal(names.size, PINNED_WEIGHTS.length, "duplicate name in the pinned table")
})

// --- The pointer sniff -------------------------------------------------------

test("parseLfsPointer extracts the oid and size", () => {
  const parsed = parseLfsPointer(pointerText(YUNET.sha256, YUNET.bytes))
  assert.ok(parsed)
  assert.equal(parsed.oid, YUNET.sha256)
  assert.equal(parsed.size, YUNET.bytes)
})

test("parseLfsPointer tolerates CRLF and trailing whitespace", () => {
  const text = `version https://git-lfs.github.com/spec/v1\r\noid sha256:${SFACE.sha256}  \r\nsize ${SFACE.bytes}\r\n`
  const parsed = parseLfsPointer(text)
  assert.ok(parsed)
  assert.equal(parsed.oid, SFACE.sha256)
  assert.equal(parsed.size, SFACE.bytes)
})

test("parseLfsPointer uppercases down to the pinned form", () => {
  const parsed = parseLfsPointer(pointerText(YUNET.sha256.toUpperCase(), YUNET.bytes))
  assert.ok(parsed)
  assert.equal(parsed.oid, YUNET.sha256)
})

test("parseLfsPointer ignores a non-sha256 oid rather than reporting it", () => {
  const parsed = parseLfsPointer("version https://git-lfs.github.com/spec/v1\noid md5:abc\nsize 12\n")
  assert.ok(parsed)
  assert.equal(parsed.oid, "")
  assert.equal(parsed.size, 12)
})

test("parseLfsPointer reports absent fields rather than guessing", () => {
  const parsed = parseLfsPointer("version https://git-lfs.github.com/spec/v1\n")
  assert.ok(parsed)
  assert.equal(parsed.oid, "")
  assert.equal(parsed.size, -1)
})

test("parseLfsPointer rejects anything that is not a pointer", () => {
  assert.equal(parseLfsPointer(""), null)
  assert.equal(parseLfsPointer("onnx-model"), null)
  // Near-misses: the prefix has to be at the very start.
  assert.equal(parseLfsPointer(`\n${pointerText(YUNET.sha256, 1)}`), null)
  assert.equal(parseLfsPointer("version https://git-lfs.github.com/spec/v2\noid sha256:aa\n"), null)
})

test("readLfsPointer refuses to sniff a file too large to be one", () => {
  const dir = scratchDir("sniff")
  const pointer = pointerText(YUNET.sha256, YUNET.bytes)
  write(dir, "real.onnx", pointer)
  assert.ok(readLfsPointer(path.join(dir, "real.onnx")))

  // Same text, padded past the bound. Never read a 38 MB model looking for a
  // text header.
  write(dir, "huge.onnx", pointer + "x".repeat(4096))
  assert.equal(readLfsPointer(path.join(dir, "huge.onnx")), null)

  assert.equal(readLfsPointer(path.join(dir, "absent.onnx")), null)
  assert.equal(readLfsPointer(dir), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

// --- Classification ----------------------------------------------------------

/** What an absent entry should be called, given whether it is required. */
const absentStatus = (/** @type {string} */ name) =>
  PINNED_WEIGHTS.find((entry) => entry.name === name)?.optional ? "absent-optional" : "missing"

test("an empty directory reports every entry missing, with the fetch URL and the manual escape hatch", async () => {
  const dir = scratchDir("empty")
  const checks = await verifyWeights(dir)
  assert.equal(checks.length, PINNED_WEIGHTS.length)
  for (const check of checks) {
    assert.equal(check.status, absentStatus(check.name))
    const pinned = PINNED_WEIGHTS.find((entry) => entry.name === check.name)
    assert.ok(pinned)
    assert.ok(check.detail.includes(pinned.url), "an absent entry must carry the URL to fetch from")
    if (!pinned.optional) {
      assert.ok(check.detail.includes("Manual placement"), "missing detail must offer manual placement")
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test("an optional weight's absence is not a failure, but wrong bytes under its name still are", async () => {
  // Availability and integrity are different questions. A machine that ships
  // only the incumbent should not be told it is missing a challenger it
  // deliberately does not carry — but a file claiming to BE the challenger and
  // failing the digest is the exact case this table exists to catch, optional
  // or not.
  const optional = PINNED_WEIGHTS.find((entry) => entry.optional)
  assert.ok(optional, "the table is expected to carry at least one optional entry")

  const empty = scratchDir("optional-absent")
  const absent = await verifyAgainst(empty, [optional])
  assert.equal(find(absent, optional.name).status, "absent-optional")
  assert.ok(find(absent, optional.name).detail.includes("not required"))
  fs.rmSync(empty, { recursive: true, force: true })

  const wrong = scratchDir("optional-wrong")
  write(wrong, optional.name, "not the challenger")
  const checks = await verifyAgainst(wrong, [optional])
  assert.equal(find(checks, optional.name).status, "mismatch")
  fs.rmSync(wrong, { recursive: true, force: true })
})

test("a nonexistent directory is missing, not a crash", async () => {
  const checks = await verifyWeights(path.join(os.tmpdir(), "vision-weights-does-not-exist-9f3c"))
  assert.equal(checks.length, PINNED_WEIGHTS.length)
  for (const check of checks) assert.equal(check.status, absentStatus(check.name))
})

test("right name, wrong bytes is a mismatch carrying both digests", async () => {
  const dir = scratchDir("mismatch")
  const contents = "not a model, but not a pointer either"
  write(dir, YUNET.name, contents)
  const checks = await verifyWeights(dir)
  const check = find(checks, YUNET.name)
  assert.equal(check.status, "mismatch")
  assert.ok(check.detail.includes(YUNET.sha256), "expected digest must appear")
  assert.ok(check.detail.includes(digestOf(contents)), "found digest must appear")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("a pointer under the canonical name is lfs-pointer, not mismatch", async () => {
  const dir = scratchDir("pointer")
  write(dir, YUNET.name, pointerText(YUNET.sha256, YUNET.bytes))
  const checks = await verifyWeights(dir)
  const check = find(checks, YUNET.name)
  assert.equal(check.status, "lfs-pointer")
  assert.ok(check.detail.includes("git-lfs pointer"))
  assert.ok(check.detail.includes("CORROBORATES"), "a matching oid must be reported as corroboration")
  assert.ok(check.detail.includes(YUNET.url), "the media host is the fix; it must be in the message")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("a pointer whose oid disagrees says so instead of claiming corroboration", async () => {
  const dir = scratchDir("pointer-bad-oid")
  const wrongOid = "0".repeat(64)
  write(dir, SFACE.name, pointerText(wrongOid, SFACE.bytes))
  const checks = await verifyWeights(dir)
  const check = find(checks, SFACE.name)
  assert.equal(check.status, "lfs-pointer")
  assert.ok(!check.detail.includes("CORROBORATES"))
  assert.ok(check.detail.includes(wrongOid))
  assert.ok(check.detail.includes("does NOT match"))
  fs.rmSync(dir, { recursive: true, force: true })
})

test("a pointer under a non-canonical name is still found, by its oid", async () => {
  const dir = scratchDir("pointer-alias")
  write(dir, "yunet.onnx", pointerText(YUNET.sha256, YUNET.bytes))
  const checks = await verifyWeights(dir)
  const check = find(checks, YUNET.name)
  assert.equal(check.status, "lfs-pointer")
  assert.ok(check.detail.includes("yunet.onnx"), "the message must name the file that is actually a pointer")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("the check is about bytes, not filenames: a content match under another name is ok", async () => {
  // The real case this covers: tmp/weights/yunet.onnx carries
  // face_detection_yunet_2026may.onnx. Same code path, fixture-sized bytes.
  const dir = scratchDir("alias")
  const contents = "pretend-model-bytes"
  write(dir, "shortened-name.onnx", contents)

  const checks = await verifyAgainst(dir, [fixtureEntry(contents)])
  const check = find(checks, "fixture-model.onnx")
  assert.equal(check.status, "ok")
  assert.ok(check.detail.includes("shortened-name.onnx"), "must name the file that actually carried it")
  assert.ok(check.detail.includes("the filename does not"))
  fs.rmSync(dir, { recursive: true, force: true })
})

test("the canonical name wins over an aliased copy of the same bytes", async () => {
  const dir = scratchDir("alias-precedence")
  const contents = "pretend-model-bytes"
  write(dir, "fixture-model.onnx", contents)
  write(dir, "aaa-earlier-alphabetically.onnx", contents)

  const checks = await verifyAgainst(dir, [fixtureEntry(contents)])
  const check = find(checks, "fixture-model.onnx")
  assert.equal(check.status, "ok")
  assert.ok(!check.detail.includes("aaa-earlier-alphabetically"), "the exact name must be preferred")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("a same-sized decoy under another name is hashed and declined", async () => {
  const dir = scratchDir("decoy")
  const contents = "pretend-model-bytes"
  // Same byte count, different bytes — the size filter admits it, the hash
  // rejects it. This is the step that makes the fallback safe.
  write(dir, "decoy.onnx", "x".repeat(contents.length))

  const checks = await verifyAgainst(dir, [fixtureEntry(contents)])
  const check = find(checks, "fixture-model.onnx")
  assert.equal(check.status, "missing")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("a wrong-sized file is never hashed at all", async () => {
  const dir = scratchDir("size-filter")
  const contents = "pretend-model-bytes"
  write(dir, "much-bigger.onnx", "y".repeat(contents.length + 500))

  const checks = await verifyAgainst(dir, [fixtureEntry(contents)])
  assert.equal(find(checks, "fixture-model.onnx").status, "missing")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("non-onnx files in the directory are ignored entirely", async () => {
  const dir = scratchDir("noise")
  write(dir, "README.md", "notes")
  write(dir, "face_detection_yunet_2026may.onnx.LICENCE.md", "MIT")
  fs.mkdirSync(path.join(dir, "face_recognition_sface_2021dec.onnx"))
  const checks = await verifyWeights(dir)
  for (const check of checks) assert.equal(check.status, absentStatus(check.name))
  fs.rmSync(dir, { recursive: true, force: true })
})

test("every check names a pinned entry, in table order", async () => {
  const dir = scratchDir("order")
  const checks = await verifyWeights(dir)
  assert.deepEqual(
    checks.map((check) => check.name),
    PINNED_WEIGHTS.map((pinned) => pinned.name),
  )
  for (const check of checks) {
    assert.ok(["ok", "missing", "mismatch", "lfs-pointer", "absent-optional"].includes(check.status))
    assert.ok(check.detail.length > 0)
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
