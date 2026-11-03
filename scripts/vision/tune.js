#!/usr/bin/env node
/** @file CLI: re-derive the tuning pass's decisions from a labelled run.
 *
 *  `public/vision/defaults.js` records the decisions and the method. This is the
 *  method, runnable. It joins a run's `faces.jsonl` to its `labels.json` and tries
 *  the routing and grouping variants the pass compared.
 *
 *  **stdout only, always.** Everything it prints is a measurement of real
 *  photographs of identifiable people, so none of it may be written to a file in
 *  this repository (CLAUDE.md). It writes no files. It prints counts, opaque ids
 *  and numeric signals: never a name, never a filename.
 *
 *  The run directory is always an explicit argument. Nothing opens a photograph or
 *  a crop.
 */
/** @import * as Types from './types.js' */
/** @import { DescriptorSet, FaceGroup } from '../../public/vision/types.js' */

import fs from "node:fs"
import path from "node:path"

import { buildPrototypes, matchFace } from "../../public/vision/assign.js"
import { getDefaults } from "../../public/vision/defaults.js"
import { centroid, cosineDistance, groupFaces } from "../../public/vision/group.js"
import { routeCutoffs, routeFace } from "../../public/vision/route.js"
import { readJsonl } from "./ingest-faces.js"

const USAGE = `Usage: node scripts/vision/tune.js <command> <run-dir> [overrides-json]

  calibrate     Route every face and cross-tab against the labeller's verdicts.
  sweep         What a pose bar and higher box or sharpness bars would cost.
  groups        All faces seeding groups, against accept seeds with asks attached.
  leftovers     Groups formed from what remains once clear faces are named.
  real-left     Groups among the faces the labelling did not name.
  full-noaside  Grouping the full set with and without set-aside faces.
  margin        Derive assign.suggestMinMargin by held-out simulation.

  [overrides-json] replaces routing cutoffs, for calibrate and groups only.
  Prints to stdout. Never redirect the output to a file inside this repository.`

const NOT_A_FACE = "x"
const DECLINED = "declined"
const MARGIN_ROUNDS = 10

/** @type {Types.loadTuneRun} */
export function loadTuneRun(dir) {
  const labels = /** @type {Types.Session1LabelFile} */ (
    JSON.parse(fs.readFileSync(path.join(dir, "labels.json"), "utf8"))
  )
  const { records, present } = readJsonl(path.join(dir, "faces.jsonl"))
  if (!present) throw new Error("This run directory has no faces.jsonl")
  const faces = /** @type {Types.Session1FaceRecord[]} */ (records)
  return { labels, faces, skipped: new Set((labels.skipped ?? []).map(String)) }
}

/** @type {Types.tuneVerdict} */
export function tuneVerdict(run, faceId) {
  const id = String(faceId)
  if (run.skipped.has(id)) return DECLINED
  return run.labels.labels[id] ?? null
}

/** @param {string | null} verdict */
const isPerson = (verdict) => verdict !== null && verdict !== NOT_A_FACE && verdict !== DECLINED

/** @type {Types.scoreTuneGroups} */
export function scoreTuneGroups(run, groups) {
  const score = {
    groups: 0,
    mixed: 0,
    wrongFaces: 0,
    namedInGroups: 0,
    junkOrDeclinedIn: 0,
    unseenIn: 0,
  }
  for (const group of groups) {
    if (group.length < 2) continue
    score.groups++
    /** @type {Map<string, number>} */
    const counts = new Map()
    for (const face of group) {
      const verdict = tuneVerdict(run, face.id)
      if (verdict === null) score.unseenIn++
      else if (verdict === NOT_A_FACE || verdict === DECLINED) score.junkOrDeclinedIn++
      else counts.set(verdict, (counts.get(verdict) ?? 0) + 1)
    }
    const named = [...counts.values()].reduce((sum, count) => sum + count, 0)
    if (counts.size > 1) score.mixed++
    score.wrongFaces += named - Math.max(0, ...counts.values())
    score.namedInGroups += named
  }
  return score
}

/**
 * @param {Types.Session1FaceRecord[]} faces
 * @returns {Types.Session1FaceRecord[]}
 */
const withDescriptors = (faces) => faces.filter((face) => face.descriptor?.length > 0)

/**
 * @param {readonly Types.Session1FaceRecord[]} faces
 * @returns {DescriptorSet}
 */
function descriptorSet(faces) {
  const dim = faces[0]?.descriptor.length ?? 0
  const data = new Float32Array(faces.length * dim)
  faces.forEach((face, i) => data.set(face.descriptor, i * dim))
  return { dim, data }
}

/**
 * @param {readonly Types.Session1FaceRecord[]} faces
 * @param {number} cutoff
 * @returns {FaceGroup[]}
 */
function clusterFaces(faces, cutoff) {
  return groupFaces(descriptorSet(faces), {
    cutoff,
    photoIds: faces.map((face) => face.photoId),
    cannotLinkWithinPhoto: true,
  })
}

const groupCutoff = () => Number(getDefaults("group").cutoff)

/** @param {Types.TuneRun} run @param {Record<string, number>} overrides */
function calibrate(run, overrides) {
  const cutoffs = { ...routeCutoffs(), ...overrides }
  /** @type {Record<string, Record<string, number>>} */
  const table = {}
  const flagged = []
  for (const face of run.faces) {
    const verdict = tuneVerdict(run, face.id)
    const human = verdict === null ? "unseen" : isPerson(verdict) ? "named" : verdict
    const pool = run.labels.pool[String(face.id)] ?? "-"
    const { state } = routeFace(face.signals, cutoffs)
    const row = `pool ${pool} · ${human}`
    table[row] ??= { accept: 0, ask: 0, set_aside: 0 }
    table[row][state]++
    if (state === "accept" && (verdict === DECLINED || verdict === NOT_A_FACE)) {
      flagged.push({
        id: face.id,
        pool,
        human,
        boxPx: Math.round(face.signals.boxPx),
        sharp: Number(face.signals.sharpness.toFixed(4)),
        eyeRatio: Number(face.signals.eyeRatio.toFixed(3)),
      })
    }
  }
  console.table(Object.fromEntries(Object.entries(table).sort()))
  console.log("accepted but declined / not-a-face:", flagged.length)
  if (flagged.length > 0) console.table(flagged)
}

/** @param {Types.TuneRun} run */
function sweep(run) {
  const base = routeCutoffs()
  /**
   * @param {Record<string, number>} overrides
   * @param {number} poseBar
   */
  const accepted = (overrides, poseBar) => {
    const cutoffs = { ...base, ...overrides }
    const out = { namedAccept: 0, declinedAccept: 0, junkAccept: 0, poolADeclinedAccept: 0 }
    for (const face of run.faces) {
      if (routeFace(face.signals, cutoffs).state !== "accept") continue
      if (poseBar > 0 && face.signals.eyeRatio < poseBar) continue
      const verdict = tuneVerdict(run, face.id)
      if (isPerson(verdict)) out.namedAccept++
      if (verdict === NOT_A_FACE) out.junkAccept++
      if (verdict === DECLINED) {
        out.declinedAccept++
        if (run.labels.pool[String(face.id)] === "A") out.poolADeclinedAccept++
      }
    }
    return out
  }
  /** @type {Record<string, ReturnType<typeof accepted>>} */
  const rows = { current: accepted({}, 0) }
  for (const pose of [0.25, 0.28, 0.3, 0.32, 0.35]) rows[`pose ${pose}`] = accepted({}, pose)
  for (const box of [120, 140, 160]) rows[`box ${box}`] = accepted({ acceptMinBoxPx: box }, 0)
  for (const sharp of [0.03, 0.035, 0.04, 0.045, 0.05]) {
    rows[`sharp ${sharp}`] = accepted({ acceptMinSharpness: sharp }, 0)
  }
  rows["pose .3 + sharp .035"] = accepted({ acceptMinSharpness: 0.035 }, 0.3)
  console.table(rows)
}

/** @param {Types.TuneRun} run @param {Record<string, number>} overrides */
function groups(run, overrides) {
  const faces = withDescriptors(run.faces)
  const cutoffs = { ...routeCutoffs(), ...overrides }
  const state = new Map(faces.map((face) => [face.id, routeFace(face.signals, cutoffs).state]))
  const cutoff = groupCutoff()
  /** @type {Record<string, ReturnType<typeof scoreTuneGroups>>} */
  const rows = {}

  rows["all faces seed"] = scoreTuneGroups(
    run,
    clusterFaces(faces, cutoff).map((group) =>
      group.members.map((i) => faces[i]).filter((face) => state.get(face.id) !== "set_aside"),
    ),
  )

  const seeds = faces.filter((face) => state.get(face.id) === "accept")
  const seedSet = descriptorSet(seeds)
  const seeded = clusterFaces(seeds, cutoff)
  const centres = seeded.map((group) => centroid(seedSet, group.members))
  for (const attachWithin of [0.4, 0.45, 0.5, 0.55]) {
    const built = seeded.map((group) => group.members.map((i) => seeds[i]))
    const photos = built.map((group) => new Set(group.map((face) => face.photoId)))
    for (const face of faces) {
      if (state.get(face.id) !== "ask") continue
      const descriptor = Float32Array.from(face.descriptor)
      let best = -1
      let bestDistance = Infinity
      for (let g = 0; g < built.length; g++) {
        if (photos[g].has(face.photoId)) continue
        const distance = cosineDistance(descriptor, centres[g])
        if (distance < bestDistance) {
          bestDistance = distance
          best = g
        }
      }
      if (best >= 0 && bestDistance <= attachWithin) {
        built[best].push(face)
        photos[best].add(face.photoId)
      }
    }
    rows[`accept seeds + ask attach ≤${attachWithin}`] = scoreTuneGroups(run, built)
  }
  console.log("group cutoff", cutoff)
  console.table(rows)
}

/**
 * @param {Types.TuneRun} run
 * @param {readonly Types.Session1FaceRecord[]} population
 * @param {Map<number, string>} state
 * @param {number} cutoff
 */
function scorePopulation(run, population, state, cutoff) {
  return scoreTuneGroups(
    run,
    clusterFaces(population, cutoff).map((group) =>
      group.members.map((i) => population[i]).filter((face) => state.get(face.id) !== "set_aside"),
    ),
  )
}

/** @param {Types.TuneRun} run */
function leftovers(run) {
  const faces = withDescriptors(run.faces)
  const cutoffs = routeCutoffs()
  const state = new Map(faces.map((face) => [face.id, routeFace(face.signals, cutoffs).state]))
  const left = faces.filter(
    (face) => !(state.get(face.id) === "accept" && isPerson(tuneVerdict(run, face.id))),
  )
  const shownOnly = left.filter((face) => state.get(face.id) !== "set_aside")
  /** @type {Record<string, ReturnType<typeof scoreTuneGroups>>} */
  const rows = {}
  for (const cutoff of [0.45, 0.5, 0.55]) {
    rows[`all leftovers, cutoff ${cutoff}`] = scorePopulation(run, left, state, cutoff)
    rows[`no set-aside input, cutoff ${cutoff}`] = scorePopulation(run, shownOnly, state, cutoff)
  }
  console.table(rows)
}

/** @param {Types.TuneRun} run */
function realLeft(run) {
  const faces = withDescriptors(run.faces)
  const cutoffs = routeCutoffs()
  const left = faces.filter((face) => {
    const verdict = tuneVerdict(run, face.id)
    return verdict === null || verdict === DECLINED
  })
  const verdicts = new Map(left.map((face) => [face.id, routeFace(face.signals, cutoffs)]))
  const stateOf = (/** @type {Types.Session1FaceRecord} */ face) => verdicts.get(face.id)?.state

  const rows = []
  for (const group of clusterFaces(left, groupCutoff())) {
    const members = group.members.map((i) => left[i])
    const shown = members.filter((face) => stateOf(face) !== "set_aside")
    if (shown.length < 2) continue
    rows.push({
      shown: shown.length,
      setAsideMembers: members.length - shown.length,
      accept: shown.filter((face) => stateOf(face) === "accept").length,
      turnedHeads: shown.filter((face) => verdicts.get(face.id)?.reason === "eyeRatioLow").length,
    })
  }
  rows.sort((a, b) => b.shown - a.shown)
  const noSeed = rows.filter((row) => row.accept === 0)
  console.log(
    `leftover faces ${left.length} · groups ${rows.length} · groups with no accept-quality face ` +
      `${noSeed.length} · faces in those ${noSeed.reduce((sum, row) => sum + row.shown, 0)}`,
  )
  console.table(rows.slice(0, 12))

  const population = left.filter((face) => stateOf(face) !== "set_aside")
  for (const cutoff of [0.55, 0.5]) {
    const multi = clusterFaces(population, cutoff).filter((group) => group.members.length >= 2)
    const sizes = multi.map((group) => group.members.length).sort((a, b) => b - a)
    const seedless = multi.filter(
      (group) => !group.members.some((i) => stateOf(population[i]) === "accept"),
    )
    console.log(
      `no set-aside input @${cutoff}: groups ${sizes.length}, largest ` +
        `${sizes.slice(0, 6).join(",")}, no-seed groups ${seedless.length}`,
    )
  }
}

/** @param {Types.TuneRun} run */
function fullNoAside(run) {
  const faces = withDescriptors(run.faces)
  const cutoffs = routeCutoffs()
  const state = new Map(faces.map((face) => [face.id, routeFace(face.signals, cutoffs).state]))
  const shownOnly = faces.filter((face) => state.get(face.id) !== "set_aside")
  const cutoff = groupCutoff()
  console.table({
    "all input": scorePopulation(run, faces, state, cutoff),
    "no set-aside input": scorePopulation(run, shownOnly, state, cutoff),
  })
}

/** @type {Types.simulateSuggestions} */
export function simulateSuggestions(run, rounds = MARGIN_ROUNDS) {
  const cutoffs = routeCutoffs()
  const named = withDescriptors(run.faces).filter(
    (face) =>
      isPerson(tuneVerdict(run, face.id)) &&
      routeFace(face.signals, cutoffs).state !== "set_aside",
  )
  const person = (/** @type {Types.Session1FaceRecord} */ face) =>
    String(tuneVerdict(run, face.id))
  // A fixed generator, so the same run always prints the same table.
  let state = 12345
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  /** @type {Types.SuggestionSample[]} */
  const samples = []
  for (let round = 0; round < rounds; round++) {
    /** @type {Types.Session1FaceRecord[]} */
    const train = []
    /** @type {Types.Session1FaceRecord[]} */
    const test = []
    for (const face of named) (random() < 0.5 ? train : test).push(face)
    const prototypes = buildPrototypes(descriptorSet(train), train.map(person))
    const testSet = descriptorSet(test)
    for (const group of clusterFaces(test, groupCutoff())) {
      if (group.members.length < 2) continue
      /** @type {Map<string, number>} */
      const counts = new Map()
      for (const i of group.members) {
        const name = person(test[i])
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
      const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const match = matchFace(centroid(testSet, group.members), prototypes)
      if (!match.best) continue
      samples.push({
        margin: match.margin,
        distance: match.best.distance,
        right: match.best.label === majority,
      })
    }
  }
  return samples
}

/** @param {Types.TuneRun} run */
function margin(run) {
  const samples = simulateSuggestions(run)
  const maxDistance = Number(getDefaults("assign").suggestMaxDistance)
  const within = samples.filter((sample) => sample.distance <= maxDistance)
  console.log(
    `group suggestions simulated ${samples.length} · within maxDistance ${within.length} · ` +
      `wrong among those ${within.filter((sample) => !sample.right).length}`,
  )
  /** @type {Record<string, Record<string, number>>} */
  const rows = {}
  for (const bar of [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15]) {
    const made = within.filter((sample) => sample.margin >= bar)
    const wrong = made.filter((sample) => !sample.right).length
    rows[`margin ≥ ${bar}`] = {
      suggested: made.length,
      wrong,
      wrongRate: Number((wrong / Math.max(1, made.length)).toFixed(3)),
      rightAbstained: within.filter((sample) => sample.right && sample.margin < bar).length,
    }
  }
  console.table(rows)
  const wrongMargins = within
    .filter((sample) => !sample.right)
    .map((sample) => Number(sample.margin.toFixed(3)))
    .sort((a, b) => a - b)
  console.log("margins of wrong suggestions:", wrongMargins.join(" "))
}

function main() {
  const [command, dir, overridesJson] = process.argv.slice(2)
  if (!command || !dir) throw new Error("A command and a run directory are required")
  const overrides = overridesJson ? JSON.parse(overridesJson) : {}
  const run = loadTuneRun(dir)
  if (command === "calibrate") calibrate(run, overrides)
  else if (command === "sweep") sweep(run)
  else if (command === "groups") groups(run, overrides)
  else if (command === "leftovers") leftovers(run)
  else if (command === "real-left") realLeft(run)
  else if (command === "full-noaside") fullNoAside(run)
  else if (command === "margin") margin(run)
  else throw new Error(`Unknown command: ${command}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(USAGE)
    process.exitCode = 1
  }
}
