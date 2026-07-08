import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import {
  streamToStaging,
  reserveUploadSlot,
  releaseUploadSlot,
  getReservedBytes,
} from "../../../core/upload.js"
import { makeJpeg, makeMp4 } from "../../media-fixtures.js"
import { PayloadTooLargeError, LengthRequiredError, ValidationError, UnsupportedMediaTypeError } from "../../../core/validation.js"

let stagingDir = ""

/**
 * A synthetic IncomingMessage-like readable: emits `body` as one chunk, carries
 * a content-length header, and supports destroy() for the timeout paths.
 * @param {Buffer} body
 * @param {{ contentLength?: number }} [opts]
 * @returns {any}
 */
function makeReq(body, opts = {}) {
  const r = /** @type {any} */ (Readable.from([body]))
  r.headers = {
    "content-length": String(opts.contentLength ?? body.length),
  }
  return r
}

before(() => {
  stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-test-"))
})

after(() => {
  fs.rmSync(stagingDir, { recursive: true, force: true })
})

beforeEach(() => {
  // No .part files should linger between cases.
  for (const f of fs.readdirSync(stagingDir)) {
    fs.rmSync(path.join(stagingDir, f), { force: true })
  }
})

describe("streamToStaging", () => {
  it("writes a valid jpeg and returns bytes/sniff/sha256", async () => {
    const jpeg = makeJpeg(256)
    const res = await streamToStaging(makeReq(jpeg), {
      maxBytes: 1024 * 1024,
      expectedKinds: ["jpeg", "png", "webp", "heic"],
      stagingDir,
    })
    assert.strictEqual(res.bytes, jpeg.length)
    assert.strictEqual(res.sniffed, "jpeg")
    assert.strictEqual(res.sha256.length, 64)
    assert.ok(fs.existsSync(res.stagingPath), "staging file kept on success")
    assert.deepStrictEqual(fs.readFileSync(res.stagingPath), jpeg)
  })

  it("rejects (411) when Content-Length is absent", async () => {
    const req = makeReq(makeJpeg(64))
    delete req.headers["content-length"]
    await assert.rejects(
      streamToStaging(req, { maxBytes: 1024, expectedKinds: ["jpeg"], stagingDir }),
      (err) => err instanceof LengthRequiredError && err.statusCode === 411,
    )
  })

  it("rejects (413) when declared length exceeds the cap up front", async () => {
    await assert.rejects(
      streamToStaging(makeReq(makeJpeg(64), { contentLength: 999999 }), {
        maxBytes: 1000,
        expectedKinds: ["jpeg"],
        stagingDir,
      }),
      (err) => err instanceof PayloadTooLargeError && err.statusCode === 413,
    )
  })

  it("aborts over-cap mid-stream and unlinks the partial file", async () => {
    const big = makeJpeg(4096)
    await assert.rejects(
      streamToStaging(makeReq(big), {
        maxBytes: 1024, // smaller than the body
        expectedKinds: ["jpeg"],
        stagingDir,
      }),
      (err) => err instanceof PayloadTooLargeError,
    )
    assert.strictEqual(fs.readdirSync(stagingDir).length, 0, "no staging file left")
  })

  it("fails sniff mismatch before the full body (415) and unlinks", async () => {
    const mp4 = makeMp4(2048)
    await assert.rejects(
      streamToStaging(makeReq(mp4), {
        maxBytes: 1024 * 1024,
        expectedKinds: ["jpeg", "png", "webp", "heic"], // image variant — video rejected
        stagingDir,
      }),
      (err) => err instanceof UnsupportedMediaTypeError && err.statusCode === 415,
    )
    assert.strictEqual(fs.readdirSync(stagingDir).length, 0)
  })

  it("rejects a body shorter than Content-Length", async () => {
    const jpeg = makeJpeg(64)
    await assert.rejects(
      streamToStaging(makeReq(jpeg, { contentLength: jpeg.length + 100 }), {
        maxBytes: 1024 * 1024,
        expectedKinds: ["jpeg"],
        stagingDir,
      }),
      (err) => err instanceof ValidationError && err.message.includes("shorter than Content-Length"),
    )
    assert.strictEqual(fs.readdirSync(stagingDir).length, 0)
  })
})

describe("upload slot accounting", () => {
  it("caps concurrent guest uploads and releases cleanly", () => {
    const acct = 42
    const start = getReservedBytes()
    assert.ok(reserveUploadSlot(acct, 100))
    assert.ok(reserveUploadSlot(acct, 100))
    assert.ok(reserveUploadSlot(acct, 100))
    assert.ok(!reserveUploadSlot(acct, 100), "4th concurrent upload blocked")
    assert.strictEqual(getReservedBytes(), start + 300)
    releaseUploadSlot(acct, 100)
    assert.ok(reserveUploadSlot(acct, 100), "slot freed after release")
    releaseUploadSlot(acct, 100)
    releaseUploadSlot(acct, 100)
    releaseUploadSlot(acct, 100)
    assert.strictEqual(getReservedBytes(), start)
  })

  it("does not cap admin (null account) concurrency but still reserves bytes", () => {
    const start = getReservedBytes()
    for (let i = 0; i < 10; i++) assert.ok(reserveUploadSlot(null, 50))
    assert.strictEqual(getReservedBytes(), start + 500)
    for (let i = 0; i < 10; i++) releaseUploadSlot(null, 50)
    assert.strictEqual(getReservedBytes(), start)
  })
})
