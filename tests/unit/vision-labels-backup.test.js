/** @file Unit test: the backup of artifacts that don't regenerate. Synthetic files only. */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"

import { backup, parseArgs } from "../../scripts/vision/labels-backup.js"

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
})
