/** @file Unit test: the backup of artifacts that don't regenerate. Synthetic files only. */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"

import { backup, parseArgs } from "../../scripts/vision/labels-backup.js"
import { REPO_ROOT } from "../../scripts/vision/scratch-dir.js"

describe("labels-backup --selection", () => {
  /** @type {string} */
  let root
  /** @type {string} */
  let run
  /** @type {string} */
  let to
  const when = new Date("2026-01-02T03:04:05Z")
  const backupDir = () => path.join(to, "labels-backup-2026-01-02T03-04-05Z")

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "labels-backup-"))
    run = path.join(root, "run")
    to = path.join(root, "dest")
    fs.mkdirSync(run)
    fs.writeFileSync(path.join(run, "labels.json"), '{"datasetId":"x"}')
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it("needs a value, and stays optional", () => {
    assert.equal(parseArgs(["run", "--to", "d", "--selection"]).valid, false)
    const without = parseArgs(["run", "--to", "d"])
    assert.equal(without.valid && without.selection, null)
    const given = parseArgs(["run", "--to=d", "--selection=s.json"])
    assert.equal(given.valid && given.selection, path.resolve("s.json"))
  })

  it("copies the named file as selection.json, byte for byte", () => {
    const selection = path.join(root, "picked.json")
    fs.writeFileSync(selection, '{"version":1,"visible":[]}')
    assert.equal(backup(run, to, when, () => {}, selection), 0)
    assert.deepEqual(
      fs.readFileSync(path.join(backupDir(), "selection.json")),
      fs.readFileSync(selection),
    )
  })

  it("creates nothing when a named selection file is missing", () => {
    assert.equal(backup(run, to, when, () => {}, path.join(root, "gone.json")), 2)
    assert.equal(fs.existsSync(to), false)
  })

  it("backs up as before without one", () => {
    assert.equal(backup(run, to, when, () => {}), 0)
    assert.equal(fs.existsSync(path.join(backupDir(), "labels.json")), true)
    assert.equal(fs.existsSync(path.join(backupDir(), "selection.json")), false)
  })

  it("parses a selection with no run directory, and still requires --to", () => {
    const alone = parseArgs(["--selection", "s.json", "--to", "d"])
    assert.ok(alone.valid)
    assert.equal(alone.dir, null)
    assert.equal(alone.selection, path.resolve("s.json"))
    assert.equal(parseArgs(["--selection", "s.json"]).valid, false, "--to is never guessed")
    assert.equal(parseArgs(["--to", "d"]).valid, false, "nothing named to back up")
    assert.equal(parseArgs(["a", "b", "--to", "d"]).valid, false)
  })

  it("backs up a selection alone, byte for byte, when there is no face run at all", () => {
    const selection = path.join(root, "picked.json")
    fs.writeFileSync(selection, '{"version":1,"visible":[]}\n')
    /** @type {string[]} */
    const lines = []
    assert.equal(backup(null, to, when, (line) => void lines.push(line), selection), 0)
    const dest = path.join(to, "selection-backup-2026-01-02T03-04-05Z")
    assert.deepEqual(fs.readdirSync(dest), ["selection.json"])
    assert.deepEqual(fs.readFileSync(path.join(dest, "selection.json")), fs.readFileSync(selection))
    assert.ok(lines.some((line) => line.includes("verified")))
  })

  it("a selection alone that is missing creates nothing", () => {
    assert.equal(backup(null, to, when, () => {}, path.join(root, "gone.json")), 2)
    assert.equal(fs.existsSync(to), false)
  })

  it("refuses a destination inside this repository, before creating anything", () => {
    const selection = path.join(root, "picked.json")
    fs.writeFileSync(selection, '{"version":1,"visible":[]}\n')
    const inside = path.join(REPO_ROOT, "tmp", `labels-backup-test-${process.pid}`)
    /** @type {string[]} */
    const lines = []
    assert.equal(backup(null, inside, when, (line) => void lines.push(line), selection), 2)
    assert.equal(backup(run, inside, when, () => {}), 2)
    assert.equal(fs.existsSync(inside), false)
    assert.ok(lines.join("\n").includes("inside this repository"))
  })
})
