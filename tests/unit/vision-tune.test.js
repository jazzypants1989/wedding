/** @file Unit test: the tuning CLI's joins and scoring.
 *
 *  Every face here is synthetic: fictional signals and made-up vectors in a temp
 *  directory. No photograph, crop or real descriptor is involved.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import {
  loadTuneRun,
  scoreTuneGroups,
  simulateSuggestions,
  tuneVerdict,
} from "../../scripts/vision/tune.js"

const SIGNALS = {
  score: 0.95,
  boxPx: 300,
  borderPx: 100,
  eyeRatio: 0.45,
  eyeAngle: 0,
  alignScale: 1,
  residual: 0.5,
  outsideFraction: 0,
  sharpness: 0.2,
}

/** @param {number} id @param {number} photoId @param {number[]} descriptor */
const face = (id, photoId, descriptor) => ({
  id,
  photoId,
  crop: `crops/${id}.png`,
  score: 0.95,
  box: { x: 0, y: 0, w: 10, h: 10 },
  landmarks: [],
  signals: SIGNALS,
  descriptor,
})

/** @param {string} dir @param {object[]} faces @param {object} labels */
function writeRun(dir, faces, labels) {
  fs.writeFileSync(path.join(dir, "faces.jsonl"), faces.map((f) => JSON.stringify(f)).join("\n"))
  fs.writeFileSync(path.join(dir, "labels.json"), JSON.stringify(labels))
}

describe("tune", () => {
  /** @type {string} */
  let dir
  /** @type {import('../../scripts/vision/types.js').TuneRun} */
  let run

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-tune-"))
    writeRun(
      dir,
      [
        face(0, 0, [1, 0]),
        face(1, 1, [1, 0]),
        face(2, 2, [0, 1]),
        face(3, 3, [0, 1]),
        face(4, 4, [1, 1]),
        face(5, 5, [1, 1]),
      ],
      {
        version: 2,
        labels: { 0: "p1", 1: "p1", 2: "p2", 3: "x" },
        pool: { 0: "A" },
        skipped: [4],
      },
    )
    run = loadTuneRun(dir)
  })

  after(() => fs.rmSync(dir, { recursive: true, force: true }))

  it("refuses a directory with no faces.jsonl", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "vision-tune-"))
    fs.writeFileSync(path.join(empty, "labels.json"), "{}")
    assert.throws(() => loadTuneRun(empty), (/** @type {Error} */ err) => {
      return err.message.includes("faces.jsonl")
    })
    fs.rmSync(empty, { recursive: true, force: true })
  })

  it("tells named, not-a-face, declined and never-judged apart", () => {
    assert.equal(tuneVerdict(run, 0), "p1")
    assert.equal(tuneVerdict(run, 3), "x")
    assert.equal(tuneVerdict(run, 4), "declined")
    assert.equal(tuneVerdict(run, 5), null)
  })

  it("scores a pure group as clean", () => {
    const score = scoreTuneGroups(run, [[run.faces[0], run.faces[1]]])
    assert.deepEqual(score, {
      groups: 1,
      mixed: 0,
      wrongFaces: 0,
      namedInGroups: 2,
      junkOrDeclinedIn: 0,
      unseenIn: 0,
    })
  })

  it("counts a mixed group, its minority faces and its junk", () => {
    const [a, b, c, junk, declined, unseen] = run.faces
    const score = scoreTuneGroups(run, [[a, b, c, junk, declined, unseen]])
    assert.deepEqual(score, {
      groups: 1,
      mixed: 1,
      wrongFaces: 1,
      namedInGroups: 3,
      junkOrDeclinedIn: 2,
      unseenIn: 1,
    })
  })

  it("ignores a group of one, which can't be mixed", () => {
    assert.equal(scoreTuneGroups(run, [[run.faces[0]]]).groups, 0)
  })

  it("simulates the same suggestions on every run", () => {
    const manyDir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-tune-"))
    /** @type {object[]} */
    const faces = []
    /** @type {Record<string, string>} */
    const labels = {}
    for (let i = 0; i < 40; i++) {
      const isFirst = i % 2 === 0
      const wobble = (i % 5) * 0.001
      faces.push(face(i, i, isFirst ? [1, wobble, 0] : [0, wobble, 1]))
      labels[i] = isFirst ? "p1" : "p2"
    }
    writeRun(manyDir, faces, { version: 2, labels, pool: {} })
    const many = loadTuneRun(manyDir)
    const first = simulateSuggestions(many, 3)
    assert.equal(first.length > 0, true)
    assert.equal(first.every((sample) => sample.right), true)
    assert.deepEqual(simulateSuggestions(many, 3), first)
    fs.rmSync(manyDir, { recursive: true, force: true })
  })

  it("names nobody and writes nothing in its source", () => {
    const src = fs.readFileSync(new URL("../../scripts/vision/tune.js", import.meta.url), "utf8")
    assert.equal(src.includes("writeFile"), false)
    assert.equal(src.includes("appendFile"), false)
    assert.equal(src.includes("identities.json"), false)
  })
})
