/** @file Unit tests: where the culling tools may write, and where a backup may not.
 *  Synthetic directories only, made under the OS temp directory and deleted after.
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, describe, test } from "node:test"

import { parseCullArgs, runCullData } from "../../scripts/vision/cull-data.js"
import { CULL_DEFAULTS } from "../../scripts/vision/cull-logic.js"
import {
  REPO_ROOT,
  backupDestinationRefusal,
  enclosingRepository,
  isWithin,
  resolveExisting,
  scratchDirRefusal,
} from "../../scripts/vision/scratch-dir.js"
import { makeJpeg } from "../media-fixtures.js"

describe("scratch-dir: where derived output may go", () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cull-out-")))
  const repo = path.join(scratch, "repo")
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true })
  fs.mkdirSync(path.join(repo, "public"), { recursive: true })
  fs.mkdirSync(path.join(repo, "tmp"), { recursive: true })
  after(() => fs.rmSync(scratch, { recursive: true, force: true }))

  test("inside a repository, only under its top-level tmp/", () => {
    assert.equal(scratchDirRefusal(path.join(repo, "tmp", "cull"), repo), null)
    assert.equal(scratchDirRefusal(path.join(repo, "tmp"), repo), null)
    const served = scratchDirRefusal(path.join(repo, "public", "tmp", "cull"), repo)
    assert.ok(served?.includes("top-level tmp/"))
    assert.ok(scratchDirRefusal(path.join(repo, "docs", "tmp"), repo))
    assert.ok(scratchDirRefusal(repo, repo))
  })

  test("any repository counts, found by its .git, not only this one", () => {
    assert.ok(scratchDirRefusal(path.join(repo, "public", "tmp", "cull")))
    assert.equal(scratchDirRefusal(path.join(repo, "tmp", "cull")), null)
    assert.equal(enclosingRepository(path.join(repo, "public", "not", "yet")), repo)
  })

  test("this repository's public/ is refused, and its tmp/ allowed", () => {
    assert.ok(scratchDirRefusal(path.join(REPO_ROOT, "public", "tmp", "cull")))
    assert.ok(scratchDirRefusal(path.join(REPO_ROOT, "scripts", "vision", "tmp")))
    assert.equal(scratchDirRefusal(path.join(REPO_ROOT, "tmp", "cull")), null)
  })

  test("outside every repository, a directory named tmp", () => {
    assert.equal(scratchDirRefusal(path.join(scratch, "tmp", "cull"), repo), null)
    // Not under the OS temp directory: on Linux that is /tmp itself, which is
    // (correctly) allowed. A path that doesn't exist is judged lexically.
    const nowhere = path.join(path.parse(scratch).root, `cull-test-nowhere-${process.pid}`, "elsewhere")
    assert.ok(scratchDirRefusal(nowhere, repo))
  })

  test("a symlink from tmp/ into public/ is refused like the direct path", () => {
    fs.symlinkSync(path.join(repo, "public"), path.join(repo, "tmp", "link"))
    const resolved = resolveExisting(path.join(repo, "tmp", "link", "cull"))
    assert.equal(resolved, path.join(repo, "public", "cull"))
    assert.ok(scratchDirRefusal(path.join(repo, "tmp", "link", "cull"), repo))
  })

  test("isWithin is about path segments, not string prefixes", () => {
    assert.equal(isWithin("/a/tmp/x", "/a/tmp"), true)
    assert.equal(isWithin("/a/tmp", "/a/tmp"), true)
    assert.equal(isWithin("/a/tmpx", "/a/tmp"), false)
    assert.equal(isWithin("/a/..b", "/a"), true)
    assert.equal(isWithin("/b", "/a"), false)
  })

  test("parseCullArgs refuses public/tmp/cull in the web root", () => {
    const served = path.join(REPO_ROOT, "public", "tmp", "cull")
    const parsed = parseCullArgs(["photos", "--out", served])
    assert.equal(parsed.valid, false)
    if (!parsed.valid) assert.ok(parsed.error.includes("top-level tmp/"))
  })

  test("runCullData refuses, where the writing happens, what --out would refuse", async () => {
    const photos = path.join(scratch, "photos")
    fs.mkdirSync(photos, { recursive: true })
    fs.writeFileSync(path.join(photos, "one.jpg"), makeJpeg(200))
    const outDir = path.join(repo, "public", "tmp", "cull")
    await assert.rejects(
      runCullData({
        dir: photos,
        outDir,
        labels: null,
        identities: null,
        run: null,
        defaults: CULL_DEFAULTS,
      }),
      (err) => err instanceof Error && err.message.includes("top-level tmp/"),
    )
    assert.equal(fs.existsSync(path.join(repo, "public", "tmp")), false)
  })

  test("a backup is refused anywhere inside this repository, tmp/ included", () => {
    assert.ok(backupDestinationRefusal(path.join(REPO_ROOT, "tmp", "backup")))
    assert.ok(backupDestinationRefusal(REPO_ROOT))
    assert.equal(backupDestinationRefusal(path.join(scratch, "backups")), null)
  })
})
