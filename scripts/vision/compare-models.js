#!/usr/bin/env node
/** @file Scores two descriptor models against a predeclared decision rule, over
 *  the same faces, the same labels and the same crops.
 *
 *  This exists because "which recogniser ships" is the kind of question that
 *  answers itself in whoever is reading the output, unless the rule was written
 *  down first. So the rule was: predeclared, owner-approved and committed to a
 *  private repository BEFORE any variant had been run. This file implements it
 *  and decides nothing on its own.
 *
 *  Four properties it is built to have:
 *
 *  1. **It reuses the report's machinery rather than re-deriving it.**
 *     `sweepGrouping` carries a guard against a grouping bug that produces a
 *     plausible-looking garbage curve; `buildPrototypes` and `matchFace` are
 *     the same code the product uses to suggest a name. A second
 *     implementation of either is a second thing to get subtly wrong, and
 *     would be measuring something other than what ships.
 *  2. **Every split is a deterministic function of stable face ids.** Never a
 *     person key — those are re-scrambled on every export of the labelling
 *     (D4), so a key-derived split moves when the labels are merely re-saved.
 *     Never randomness. Re-running reproduces the split exactly.
 *  3. **The two models are treated identically, and where they cannot be, it
 *     says so and declines.** The shipped default cutoff is dropped from the
 *     candidate set because it is tuned for one of the two spaces; a cutoff
 *     derivation that falls back to a second objective for one model and not
 *     the other is reported as no-decision rather than compared.
 *  4. **No decision is the default outcome.** A margin under the bar, metrics
 *     disagreeing, or the branch check firing all land there, and there keeps
 *     the incumbent.
 *
 *  Nothing here writes into this repository. Every figure it produces is a
 *  measurement of photographs of identifiable people (CLAUDE.md rule 3): it
 *  goes to the terminal, and to `--json` under `tmp/` if the caller asks.
 *
 *  Usage:
 *    node scripts/vision/compare-models.js \
 *      --incumbent tmp/ab-sface-nomirror --incumbent tmp/ab-sface-mirror \
 *      --challenger tmp/ab-aura-nomirror --challenger tmp/ab-aura-mirror
 */
/** @import * as Types from './types.js' */
/** @import * as V from '../../public/vision/types.js' */

import fs from "node:fs"

import { buildPrototypes, matchFace } from "../../public/vision/assign.js"
import { distanceMatrix, groupFaces } from "../../public/vision/group.js"
import { groupingQuality, pairDistances } from "../../public/vision/metrics.js"

import {
  bestSweepPoint,
  buildView,
  loadRun,
  personFoldsOf,
  sweepCutoffs,
  sweepGrouping,
} from "./session1-report.js"

const USAGE = `
Usage: node scripts/vision/compare-models.js [options]

  Scores descriptor models against the predeclared Phase 2 decision rule. Every
  --incumbent / --challenger directory is a redescribe-crops.js output over the
  SAME source run, so all of them carry identical faces, boxes and labels and
  differ only in their descriptors.

  --incumbent DIR    A variant of the incumbent model (repeatable).
  --challenger DIR   A variant of the challenger model (repeatable).
  --pool NAME        Which pool to score (default A — the individually judged
                     one; pool B carries the grouping's own opinion).
  --folds N          Person-disjoint folds for the M2 cutoff (default 5).
  --cap N            Query faces per person in M1 (default 4).
  --margin N         Capped query faces the challenger must win by (default 3).
  --json FILE        Also write the full result. Must be under tmp/.
  --help
`

const BOOLEAN_FLAGS = ["help"]
const VALUE_FLAGS = ["incumbent", "challenger", "pool", "folds", "cap", "margin", "json"]
const REPEATABLE = ["incumbent", "challenger"]

/** Exit codes, matching the other vision CLIs. */
const EXIT = { CLEAN: 0, ABORTED: 2 }

/** The rule's defaults. Overridable so the tests can drive small fixtures. */
const DEFAULTS = { pool: /** @type {"A"|"B"} */ ("A"), folds: 5, cap: 4, margin: 3 }

// --- Arguments ---------------------------------------------------------------

/**
 * @param {readonly string[]} argv
 * @returns {{ valid: true, value: Types.CompareArgs } | { valid: false, error: string }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {}
  /** @type {Record<string, string[]>} */
  const lists = { incumbent: [], challenger: [] }
  /** @type {Set<string>} */
  const flags = new Set()

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith("--")) return { valid: false, error: `unexpected argument ${raw}` }
    const body = raw.slice(2)
    const eq = body.indexOf("=")
    const name = eq === -1 ? body : body.slice(0, eq)
    let value = eq === -1 ? null : body.slice(eq + 1)

    if (BOOLEAN_FLAGS.includes(name)) {
      if (value !== null) return { valid: false, error: `--${name} takes no value` }
      flags.add(name)
      continue
    }
    if (!VALUE_FLAGS.includes(name)) return { valid: false, error: `unknown option --${name}` }
    if (value === null) {
      value = argv[++i] ?? null
      if (value === null) return { valid: false, error: `--${name} needs a value` }
    }
    if (REPEATABLE.includes(name)) lists[name].push(value)
    else values[name] = value
  }

  if (flags.has("help")) {
    return {
      valid: true,
      value: {
        help: true,
        incumbent: [],
        challenger: [],
        pool: DEFAULTS.pool,
        folds: DEFAULTS.folds,
        cap: DEFAULTS.cap,
        margin: DEFAULTS.margin,
        json: null,
      },
    }
  }

  if (lists.incumbent.length === 0) return { valid: false, error: "at least one --incumbent DIR is required" }
  if (lists.challenger.length === 0) return { valid: false, error: "at least one --challenger DIR is required" }

  /** @param {string} name @param {number} fallback */
  const number = (name, fallback) => {
    if (values[name] === undefined) return fallback
    const n = Number(values[name])
    return Number.isInteger(n) && n > 0 ? n : NaN
  }
  const folds = number("folds", DEFAULTS.folds)
  const cap = number("cap", DEFAULTS.cap)
  const margin = number("margin", DEFAULTS.margin)
  for (const [name, n] of [
    ["folds", folds],
    ["cap", cap],
    ["margin", margin],
  ]) {
    if (Number.isNaN(n)) return { valid: false, error: `--${name} must be a positive whole number` }
  }

  const pool = values.pool ?? DEFAULTS.pool
  if (pool !== "A" && pool !== "B") return { valid: false, error: `--pool must be A or B, not ${pool}` }

  // Rule 3: every figure this produces is a fact about identifiable people, and
  // this repository is public. The destination is checked rather than trusted.
  const json = values.json ?? null
  if (json !== null && !json.startsWith("tmp/") && !json.includes("/tmp/")) {
    return {
      valid: false,
      error:
        `--json ${json} is not under tmp/. Everything this script measures is a fact about ` +
        `photographs of identifiable people, and tmp/ is the gitignored scratch this repo ` +
        `keeps those in (CLAUDE.md rule 3).`,
    }
  }

  return {
    valid: true,
    value: {
      help: false,
      incumbent: lists.incumbent,
      challenger: lists.challenger,
      pool,
      folds,
      cap,
      margin,
      json,
    },
  }
}

// --- Loading -----------------------------------------------------------------

/**
 * One variant: its run, its pool-restricted view, and the label under which it
 * is reported.
 * @param {string} dir
 * @param {"A"|"B"} pool
 * @returns {Types.CompareVariant}
 */
export function loadVariant(dir, pool) {
  const run = loadRun(dir)
  if (!run.labels) throw new Error(`${dir}: no labels.json — there is nothing to score against`)
  const view = buildView(run, { pool, requireLabel: true })
  const timing = run.timing
  return {
    dir,
    run,
    view,
    mirror: timing?.config?.mirrorTta === true,
    embedderSha256: timing?.describeProvenance?.embedderSha256 ?? null,
  }
}

/**
 * Every variant must be the same faces with the same labels, or the comparison
 * is between two different questions. Descriptor width is deliberately NOT
 * checked — a 512-d challenger against a 128-d incumbent is the entire point.
 * @param {readonly Types.CompareVariant[]} variants
 */
export function assertComparable(variants) {
  const [first, ...rest] = variants
  for (const other of rest) {
    if (other.view.faceIds.length !== first.view.faceIds.length) {
      throw new Error(
        `${other.dir} scores ${other.view.faceIds.length} faces but ${first.dir} scores ` +
          `${first.view.faceIds.length}. These are not the same set and cannot be compared.`,
      )
    }
    for (let i = 0; i < first.view.faceIds.length; i++) {
      if (other.view.faceIds[i] !== first.view.faceIds[i]) {
        throw new Error(`${other.dir}: face ids diverge from ${first.dir} at row ${i}`)
      }
      if (other.view.labels[i] !== first.view.labels[i]) {
        throw new Error(
          `${other.dir}: the label on face ${first.view.faceIds[i]} differs from ${first.dir}. ` +
            `Both directories must carry the same labels.json.`,
        )
      }
    }
  }
}

// --- M1 ----------------------------------------------------------------------

/**
 * One person's faces divided into a prototype side and a query side.
 *
 * The unit of assignment is a FRAME GROUP, never a face: near-duplicate frames
 * of one moment are nearly the same image, so letting them straddle the split
 * would query a prototype built from an almost identical photograph and score
 * the near-duplicate detector rather than the recogniser.
 *
 * Assignment is greedy largest-group-first onto whichever side currently holds
 * fewer faces, ties to prototype — deterministic, balanced, and derived only
 * from face ids.
 * @param {ReadonlyArray<{ row: number, faceId: number, frame: number }>} faces
 * @returns {{ prototype: number[], query: number[] }} rows, not face ids
 */
export function splitPerson(faces) {
  /** @type {Map<number, { rows: number[], lowestFaceId: number }>} */
  const groups = new Map()
  for (const face of faces) {
    const existing = groups.get(face.frame)
    if (existing) {
      existing.rows.push(face.row)
      existing.lowestFaceId = Math.min(existing.lowestFaceId, face.faceId)
    } else {
      groups.set(face.frame, { rows: [face.row], lowestFaceId: face.faceId })
    }
  }

  // Fewer than two frame groups is not splittable: every face is the same
  // moment, so there is no honest query side to build.
  if (groups.size < 2) return { prototype: [], query: [] }

  const ordered = [...groups.values()].sort(
    (a, b) => b.rows.length - a.rows.length || a.lowestFaceId - b.lowestFaceId,
  )
  /** @type {number[]} */
  const prototype = []
  /** @type {number[]} */
  const query = []
  for (const group of ordered) {
    if (query.length < prototype.length) query.push(...group.rows)
    else prototype.push(...group.rows)
  }
  return { prototype, query }
}

/**
 * The scored set for M1, computed ONCE and reused for every variant — the split
 * is a function of face ids and frames, which are identical across variants by
 * construction, so computing it per variant would be the same answer at the
 * risk of a different one.
 * @param {Types.FaceView} view
 * @param {number} cap
 * @returns {Types.M1Set}
 */
export function buildM1Set(view, cap) {
  /** @type {Map<string, Array<{ row: number, faceId: number, frame: number }>>} */
  const byPerson = new Map()
  view.labels.forEach((label, row) => {
    if (label === null) return
    const entry = { row, faceId: view.faceIds[row], frame: view.frames[row] }
    const list = byPerson.get(label)
    if (list) list.push(entry)
    else byPerson.set(label, [entry])
  })

  /** @type {Array<string | null>} */
  const assignments = view.labels.map(() => null)
  /** @type {Array<{ row: number, faceId: number, person: string }>} */
  const queries = []
  let splittable = 0

  // Sorted by the person's lowest face id: a stable order, and not the person
  // key, which is scrambled per export (D4).
  const people = [...byPerson.entries()].sort(
    (a, b) => Math.min(...a[1].map((f) => f.faceId)) - Math.min(...b[1].map((f) => f.faceId)),
  )

  for (const [person, faces] of people) {
    const split = splitPerson(faces)
    if (split.query.length === 0) continue
    splittable++
    for (const row of split.prototype) assignments[row] = person
    const capped = split.query
      .map((row) => ({ row, faceId: view.faceIds[row], person }))
      .sort((a, b) => a.faceId - b.faceId)
      .slice(0, cap)
    queries.push(...capped)
  }

  return { assignments, queries, splittable, people: byPerson.size }
}

/**
 * Top-1 suggestion accuracy: how many capped query faces have their true person
 * as the nearest prototype. Prototypes come from EVERY person's prototype side,
 * so a query is ranked against the whole cast rather than against itself.
 * @param {Types.FaceView} view
 * @param {Types.M1Set} m1
 * @returns {Types.M1Score}
 */
export function scoreM1(view, m1) {
  const prototypes = buildPrototypes(view.set, m1.assignments)
  const { dim, data } = view.set

  /** @type {Map<string, { correct: number, total: number }>} */
  const perPerson = new Map()
  let correct = 0

  for (const query of m1.queries) {
    const descriptor = data.subarray(query.row * dim, (query.row + 1) * dim)
    const match = matchFace(descriptor, prototypes)
    const hit = match.best !== null && match.best.label === query.person
    if (hit) correct++
    const tally = perPerson.get(query.person) ?? { correct: 0, total: 0 }
    tally.total++
    if (hit) tally.correct++
    perPerson.set(query.person, tally)
  }

  return { correct, total: m1.queries.length, perPerson }
}

// --- M2 ----------------------------------------------------------------------

/**
 * A model's operating cutoff, derived on people it will not be scored on.
 *
 * The candidate set comes from the tuning faces' OWN distance tails and does
 * not include the shipped default: that constant was tuned for one of the two
 * descriptor spaces, and offering it to only one candidate is a home-field
 * advantage inside the procedure written to be identical for both.
 * @param {Types.FaceView} tuning
 * @returns {{ cutoff: number, weldFree: boolean } | null}
 */
export function deriveCutoff(tuning) {
  const { same, diff } = pairDistances(tuning.set, { labels: tuning.labels })
  const cutoffs = sweepCutoffs(same, diff, { includeShippedDefault: false })
  if (cutoffs.length === 0) return null
  const points = sweepGrouping(tuning.set, {
    cutoffs,
    labels: tuning.labels,
    photoIds: tuning.photoIds,
    cannotLink: [true],
  })
  const best = bestSweepPoint(points)
  return best === null ? null : { cutoff: best.point.cutoff, weldFree: best.weldFree }
}

/**
 * Group purity at the model's own derived cutoff, pooled over person-disjoint
 * folds.
 *
 * Pooled, not averaged: a mean of per-fold rates is a different and much
 * noisier quantity when the folds are thin, which is the same argument
 * `heldOutGate` makes for the same reason.
 * @param {Types.CompareVariant} variant
 * @param {ReadonlyArray<Set<number>>} folds
 * @param {"A"|"B"} pool
 * @returns {Types.M2Score}
 */
export function scoreM2(variant, folds, pool) {
  let purityHits = 0
  let labelled = 0
  /** @type {Array<{ cutoff: number, weldFree: boolean, faces: number }>} */
  const perFold = []

  for (const heldOut of folds) {
    const tuning = buildView(variant.run, {
      pool,
      requireLabel: true,
      include: (face) => !heldOut.has(face.id),
    })
    const derived = deriveCutoff(tuning)
    if (derived === null) continue

    const scored = buildView(variant.run, {
      pool,
      requireLabel: true,
      include: (face) => heldOut.has(face.id),
    })
    if (scored.faceIds.length === 0) continue

    const groups = groupFaces(scored.set, {
      cutoff: derived.cutoff,
      photoIds: scored.photoIds,
      cannotLinkWithinPhoto: true,
      matrix: distanceMatrix(scored.set),
    })
    const quality = groupingQuality(groups, scored.labels)
    purityHits += quality.purity * quality.labelledFaces
    labelled += quality.labelledFaces
    perFold.push({ cutoff: derived.cutoff, weldFree: derived.weldFree, faces: quality.labelledFaces })
  }

  return { purity: labelled > 0 ? purityHits / labelled : NaN, labelledFaces: labelled, perFold }
}

// --- The verdict -------------------------------------------------------------

/**
 * The better of one model's variants, by M1. Ties go to mirror-off, per the
 * rule — the cheaper setting wins a tie rather than the reader's preference.
 * @param {readonly Types.VariantResult[]} results
 * @returns {Types.VariantResult}
 */
export function pickBest(results) {
  return results.reduce((best, r) => {
    if (r.m1.correct !== best.m1.correct) return r.m1.correct > best.m1.correct ? r : best
    if (r.variant.mirror !== best.variant.mirror) return best.variant.mirror ? r : best
    return best
  })
}

/**
 * Per person, which model got more of that person's query faces right.
 * @param {Types.M1Score} incumbent
 * @param {Types.M1Score} challenger
 * @returns {{ ahead: number, behind: number, level: number }}
 */
export function spread(incumbent, challenger) {
  let ahead = 0
  let behind = 0
  let level = 0
  for (const [person, theirs] of challenger.perPerson) {
    const ours = incumbent.perPerson.get(person)?.correct ?? 0
    if (theirs.correct > ours) ahead++
    else if (theirs.correct < ours) behind++
    else level++
  }
  return { ahead, behind, level }
}

/**
 * The win condition, and every way of failing it.
 *
 * No decision is the DEFAULT branch, not the exception: a challenger replaces a
 * working incumbent only on a margin the rule named in advance, and everything
 * else — a smaller margin, the metrics disagreeing, the two cutoffs coming from
 * different objectives — keeps what already works.
 * @param {Types.VariantResult} incumbent
 * @param {Types.VariantResult} challenger
 * @param {number} margin
 * @returns {Types.Verdict}
 */
export function decide(incumbent, challenger, margin) {
  /** @type {string[]} */
  const reasons = []

  const m1Delta = challenger.m1.correct - incumbent.m1.correct
  const m1Pass = m1Delta >= margin
  if (!m1Pass) reasons.push(`M1 margin ${m1Delta} is under the predeclared ${margin}`)

  const m1Spread = spread(incumbent.m1, challenger.m1)
  const spreadPass = m1Spread.ahead > m1Spread.behind
  if (!spreadPass) {
    reasons.push(`M1-spread: ahead on ${m1Spread.ahead} people, behind on ${m1Spread.behind}`)
  }

  // The branch check. bestSweepPoint falls back to a second objective when no
  // swept point is weld-free; if that fires for one model and not the other,
  // the two cutoffs were chosen by different rules and M2 is not a like-for-
  // like gate. Both falling back on the same fold is identical treatment.
  const folds = Math.min(incumbent.m2.perFold.length, challenger.m2.perFold.length)
  let branchesAgree = incumbent.m2.perFold.length === challenger.m2.perFold.length
  for (let i = 0; i < folds; i++) {
    if (incumbent.m2.perFold[i].weldFree !== challenger.m2.perFold[i].weldFree) branchesAgree = false
  }
  if (!branchesAgree) {
    reasons.push(
      "M2 no decision: the two cutoff derivations did not take the same branch — one model had " +
        "weld-free points where the other did not, so the cutoffs came from different objectives",
    )
  }

  const m2Pass = branchesAgree && challenger.m2.purity >= incumbent.m2.purity
  if (branchesAgree && !m2Pass) reasons.push("M2: challenger group purity is worse than the incumbent's")

  const adopt = m1Pass && spreadPass && m2Pass
  return {
    adopt,
    outcome: adopt ? "adopt-challenger" : "no-decision-keep-incumbent",
    m1Delta,
    m1Spread,
    branchesAgree,
    reasons,
  }
}

// --- The run -----------------------------------------------------------------

/**
 * @param {Types.CompareArgs} args
 * @param {{ log?: (line: string) => void }} [deps]
 * @returns {Types.CompareReport}
 */
export function runCompare(args, deps = {}) {
  const log = deps.log ?? ((line) => process.stdout.write(line + "\n"))

  const incumbents = args.incumbent.map((dir) => loadVariant(dir, args.pool))
  const challengers = args.challenger.map((dir) => loadVariant(dir, args.pool))
  const all = [...incumbents, ...challengers]
  assertComparable(all)

  // Computed once from the first view and reused: the split depends only on
  // face ids and frames, which assertComparable has just proved identical.
  const m1Set = buildM1Set(all[0].view, args.cap)
  const folds = personFoldsOf(all[0].view, args.folds)

  log(`Scored set: pool ${args.pool}, ${all[0].view.faceIds.length} labelled face(s), ${m1Set.people} people.`)
  log(`M1: ${m1Set.queries.length} capped query face(s) across ${m1Set.splittable} splittable people.`)
  log(`M2: ${folds.length} person-disjoint fold(s).`)
  log("")

  /** @param {Types.CompareVariant} variant @returns {Types.VariantResult} */
  const score = (variant) => ({
    variant,
    m1: scoreM1(variant.view, m1Set),
    m2: scoreM2(variant, folds, args.pool),
  })

  const incumbentResults = incumbents.map(score)
  const challengerResults = challengers.map(score)

  for (const result of [...incumbentResults, ...challengerResults]) {
    log(
      `  ${result.variant.dir}  mirror=${result.variant.mirror ? "on " : "off"}  ` +
        `M1 ${result.m1.correct}/${result.m1.total}  ` +
        `M2 purity ${result.m2.purity.toFixed(4)} over ${result.m2.labelledFaces} face(s)  ` +
        `weld-free ${result.m2.perFold.filter((f) => f.weldFree).length}/${result.m2.perFold.length} fold(s)`,
    )
  }

  const bestIncumbent = pickBest(incumbentResults)
  const bestChallenger = pickBest(challengerResults)
  const verdict = decide(bestIncumbent, bestChallenger, args.margin)

  log("")
  log(`Best incumbent:  ${bestIncumbent.variant.dir} (mirror ${bestIncumbent.variant.mirror ? "on" : "off"})`)
  log(`Best challenger: ${bestChallenger.variant.dir} (mirror ${bestChallenger.variant.mirror ? "on" : "off"})`)
  log(
    `M1 ${bestChallenger.m1.correct} vs ${bestIncumbent.m1.correct} (delta ${verdict.m1Delta}, ` +
      `need +${args.margin}); spread ahead ${verdict.m1Spread.ahead} / behind ${verdict.m1Spread.behind} / ` +
      `level ${verdict.m1Spread.level}`,
  )
  log(`M2 purity ${bestChallenger.m2.purity.toFixed(4)} vs ${bestIncumbent.m2.purity.toFixed(4)}`)
  log("")
  log(verdict.adopt ? "VERDICT: adopt the challenger." : "VERDICT: no decision — keep the incumbent.")
  for (const reason of verdict.reasons) log(`  - ${reason}`)

  return { incumbents: incumbentResults, challengers: challengerResults, bestIncumbent, bestChallenger, verdict, m1Set, folds: folds.length }
}

// --- CLI ---------------------------------------------------------------------

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  const parsed = parseArgs(argv)
  if (!parsed.valid) {
    process.stderr.write(`${parsed.error}\n${USAGE}`)
    return EXIT.ABORTED
  }
  if (parsed.value.help) {
    process.stdout.write(USAGE)
    return EXIT.CLEAN
  }

  const report = runCompare(parsed.value)

  if (parsed.value.json !== null) {
    // perPerson is a Map of person key to counts. Person keys are meaningless
    // across exports (D4) and are names' shadows, so the serialised form keeps
    // the counts and drops the keys.
    /** @param {Types.VariantResult} r */
    const plain = (r) => ({
      dir: r.variant.dir,
      mirror: r.variant.mirror,
      embedderSha256: r.variant.embedderSha256,
      m1: { correct: r.m1.correct, total: r.m1.total },
      m2: { purity: r.m2.purity, labelledFaces: r.m2.labelledFaces, perFold: r.m2.perFold },
    })
    fs.writeFileSync(
      parsed.value.json,
      JSON.stringify(
        {
          incumbents: report.incumbents.map(plain),
          challengers: report.challengers.map(plain),
          bestIncumbent: plain(report.bestIncumbent),
          bestChallenger: plain(report.bestChallenger),
          verdict: report.verdict,
          scoredSet: {
            pool: parsed.value.pool,
            queries: report.m1Set.queries.length,
            splittablePeople: report.m1Set.splittable,
            people: report.m1Set.people,
            folds: report.folds,
          },
        },
        null,
        2,
      ) + "\n",
    )
  }

  return EXIT.CLEAN
}

if (process.argv[1] && process.argv[1].endsWith("compare-models.js")) {
  process.exit(main(process.argv.slice(2)))
}
