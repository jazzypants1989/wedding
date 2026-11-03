/** @file Unit test: the privacy tooling in scripts/dev/.
 *
 *  Every server here is local and fictional, and every "photograph" is a few magic
 *  bytes written by this test. The property that matters: nothing photographic
 *  gets through the proxy, and the checker fails when it can't prove that.
 */
import assert from "node:assert/strict"
import http from "node:http"
import { after, before, describe, it } from "node:test"

import { chromeCandidates, parseCdpArgs } from "../../scripts/dev/cdp.js"
import {
  checkHop,
  classifyBytes,
  leakCheckExitCode,
  parseLeakCheckArgs,
} from "../../scripts/dev/leak-check.js"
import {
  createPlaceholderProxy,
  isPhotographicType,
  parseProxyArgs,
  parseUpstream,
} from "../../scripts/dev/placeholder-proxy.js"

/** @param {string} text */
const mentions = (text) => (/** @type {Error} */ err) => err.message.includes(text)

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)])
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

/**
 * @param {http.Server} server
 * @returns {Promise<number>}
 */
function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve(typeof address === "object" && address ? address.port : 0)
    })
  })
}

/**
 * @param {number} port
 * @param {string} urlPath
 * @param {string} [method]
 * @returns {Promise<{ status: number, type: string, body: Buffer }>}
 */
function request(port, urlPath, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method }, (res) => {
      /** @type {Buffer[]} */
      const chunks = []
      res.on("data", (/** @type {Buffer} */ chunk) => chunks.push(chunk))
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          type: String(res.headers["content-type"] ?? ""),
          body: Buffer.concat(chunks),
        })
      })
    })
    req.on("error", reject)
    req.end()
  })
}

describe("classifyBytes", () => {
  it("names real photograph formats, so none can pass as a placeholder", () => {
    assert.equal(classifyBytes(JPEG), "JPEG")
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])
    assert.equal(classifyBytes(webp), "WEBP")
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(4)])
    assert.equal(classifyBytes(heic), "HEIF")
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(4)])
    assert.equal(classifyBytes(mp4), "MP4")
  })

  it("recognises a placeholder and the proxy's own error text", () => {
    assert.equal(classifyBytes(Buffer.concat([Buffer.from(PNG_MAGIC), Buffer.alloc(12)])), "PNG")
    assert.equal(classifyBytes(Buffer.from("placeholder-proxy: upstream said 404")), "proxy-text")
  })

  it("treats a short body as unknown", () => {
    assert.equal(classifyBytes(Buffer.from([0xff, 0xd8])), "empty/short")
  })
})

describe("leakCheckExitCode", () => {
  const clean = { port: 1, tally: new Map(), leaks: [], responses: 3 }

  it("passes only when something answered and nothing leaked", () => {
    assert.equal(leakCheckExitCode([clean]), 0)
  })

  it("fails on real bytes", () => {
    assert.equal(leakCheckExitCode([clean, { ...clean, leaks: ["thumb (JPEG)"] }]), 1)
  })

  it("fails when a hop answered nothing, because that proves nothing", () => {
    assert.equal(leakCheckExitCode([clean, { ...clean, responses: 0 }]), 2)
  })
})

describe("isPhotographicType", () => {
  it("blocks photo and video types, whatever the casing or parameters", () => {
    for (const type of ["image/jpeg", "IMAGE/JPEG; q=1", "image/webp", "image/heic", "video/mp4"]) {
      assert.equal(isPhotographicType(type), true, type)
    }
  })

  it("passes generated assets and everything that isn't an image", () => {
    for (const type of ["image/png", "image/svg+xml", "image/x-icon", "text/html", ""]) {
      assert.equal(isPhotographicType(type), false, type)
    }
  })
})

describe("the proxy against a fake upstream", () => {
  /** @type {http.Server} */
  let upstream
  /** @type {http.Server} */
  let proxy
  let proxyPort = 0
  let upstreamPort = 0

  before(async () => {
    upstream = http.createServer((req, res) => {
      const url = req.url ?? ""
      if (url === "/media/gone/thumb") {
        res.writeHead(404, { "content-type": "text/plain" })
        res.end("not found")
      } else if (url.startsWith("/media/") || url === "/images/couple.jpg") {
        res.writeHead(200, { "content-type": "image/jpeg" })
        res.end(JPEG)
      } else if (url === "/logo.png") {
        res.writeHead(200, { "content-type": "image/png" })
        res.end("generated-asset-bytes")
      } else {
        res.writeHead(200, { "content-type": "text/html", "x-upstream": "yes" })
        res.end("<!doctype html>page")
      }
    })
    upstreamPort = await listen(upstream)
    proxy = createPlaceholderProxy({ upstreamHost: "127.0.0.1", upstreamPort, db: null })
    proxyPort = await listen(proxy)
  })

  after(() => {
    proxy.close()
    upstream.close()
  })

  it("never returns upstream bytes for a media request", async () => {
    const res = await request(proxyPort, "/media/abc/display")
    assert.equal(res.status, 200)
    assert.equal(res.type, "image/png")
    assert.deepEqual([...res.body.subarray(0, 4)], PNG_MAGIC)
    assert.equal(res.body.includes(JPEG), false)
  })

  it("replaces a JPEG served from any other path", async () => {
    const res = await request(proxyPort, "/images/couple.jpg")
    assert.equal(res.type, "image/png")
    assert.deepEqual([...res.body.subarray(0, 4)], PNG_MAGIC)
  })

  it("keeps a 404 a 404, without upstream's body", async () => {
    const res = await request(proxyPort, "/media/gone/thumb")
    assert.equal(res.status, 404)
    assert.equal(res.body.toString().startsWith("placeholder-proxy"), true)
  })

  it("passes pages and generated assets through unchanged", async () => {
    assert.equal((await request(proxyPort, "/")).body.toString(), "<!doctype html>page")
    assert.equal((await request(proxyPort, "/logo.png")).body.toString(), "generated-asset-bytes")
  })

  it("sends no body on HEAD", async () => {
    const res = await request(proxyPort, "/media/abc/thumb", "HEAD")
    assert.equal(res.type, "image/png")
    assert.equal(res.body.length, 0)
  })

  it("passes the leak check end to end, which the bare upstream fails", async () => {
    const throughProxy = await checkHop(proxyPort, ["abc"], ["thumb", "display"])
    assert.equal(throughProxy.responses, 2)
    assert.equal(leakCheckExitCode([throughProxy]), 0)

    const direct = await checkHop(upstreamPort, ["abc"], ["thumb"])
    assert.equal(leakCheckExitCode([direct]), 1)
    assert.deepEqual(direct.leaks, ["thumb (JPEG, image/jpeg, HTTP 200)"])
  })

  it("reports no file key in a leak shape", async () => {
    const report = await checkHop(upstreamPort, ["secret-file-key"], ["thumb"])
    assert.equal(report.leaks.join("").includes("secret-file-key"), false)
  })

  it("answers nothing for a dead hop, so the check fails rather than passing", async () => {
    const dead = http.createServer()
    const deadPort = await listen(dead)
    await new Promise((resolve) => dead.close(resolve))
    const report = await checkHop(deadPort, ["abc"], ["thumb"])
    assert.equal(leakCheckExitCode([report]), 2)
  })
})

describe("argument parsing", () => {
  it("requires an upstream for the proxy", () => {
    assert.throws(() => parseProxyArgs([]), mentions("--upstream"))
    assert.deepEqual(parseProxyArgs(["--upstream", "127.0.0.1:3010", "--port", "3005"]), {
      port: 3005,
      upstream: "127.0.0.1:3010",
      database: null,
    })
  })

  it("splits an upstream into host and port", () => {
    assert.deepEqual(parseUpstream("127.0.0.1:3010"), { host: "127.0.0.1", port: 3010 })
    assert.deepEqual(parseUpstream("example.test"), { host: "example.test", port: 80 })
  })

  it("requires a database and a port for the leak check", () => {
    assert.throws(() => parseLeakCheckArgs(["--port", "1"]), mentions("--database"))
    assert.throws(() => parseLeakCheckArgs(["--database", "a.db"]), mentions("--port"))
    assert.deepEqual(parseLeakCheckArgs(["--database", "a.db", "--port", "1", "--port", "2"]), {
      database: "a.db",
      ports: [1, 2],
    })
  })

  it("defaults cdp to a fresh profile", () => {
    const args = parseCdpArgs(["http://x", "1280x800", "--eval=a.js", "--eval=b.js"])
    assert.equal(args.profile, null)
    assert.deepEqual(args.evals, ["a.js", "b.js"])
    assert.equal(args.width, 1280)
  })

  it("rejects a bad cdp size or flag", () => {
    assert.throws(() => parseCdpArgs(["http://x", "wide"]), mentions("Size"))
    assert.throws(() => parseCdpArgs(["http://x", "1x1", "--nope"]), mentions("Unknown"))
  })

  it("tries an explicit Chrome only, and otherwise a list", () => {
    assert.deepEqual(chromeCandidates("/opt/c", "/env/c"), ["/opt/c"])
    assert.deepEqual(chromeCandidates(null, "/env/c"), ["/env/c"])
    assert.equal(chromeCandidates(null, undefined).length > 1, true)
  })
})
