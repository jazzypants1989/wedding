#!/usr/bin/env node
/** @file CLI: carry a labelling (labels.json + identities.json) from one
 *  detection run onto another, so adopting a better detector does not orphan
 *  the census (plan Phase 1).
 *
 *  Face ids are positions in one run's scan order, so a labels.json is
 *  meaningless against any other run. This tool joins the two runs'
 *  photographs by content hash, matches each photograph's boxes across the
 *  runs, and rewrites every face-keyed record in target numbering. Four
 *  defects shape it:
 *
 *   - **D4 — person keys are scrambled per export.** label.html permutes them
 *     every save, so keys carry nothing across files. Everything emitted here
 *     is written under ONE freshly-allocated remap, and labels.json,
 *     identities.json and exclusions.json are all built from that single map —
 *     rewriting one without the others attaches wrong names to real people,
 *     and the labelling page's import drops mismatches silently.
 *   - **D5 — exclusions are group-keyed, and group ids renumber.** A new run
 *     regroups, so `labels.json.excluded` cannot be copied. Each exclusion is
 *     converted to a per-face record — "this face is not that person" — and
 *     group ids are never written to any output.
 *   - **D6 — the labelling page ignores `pool` on import.** Pool A is the only
 *     individually-judged sample, so membership is carried explicitly as
 *     poolA.json, AND the rewritten labels.json keeps a re-keyed `pool` map —
 *     session1-report.js reads pool membership from labels.json, and without
 *     the map it treats every labelled face as pool A ("poolAssumed").
 *   - **D7 — duplicate content hashes make the join ambiguous.** If either run
 *     holds two photographs with the same sha256 the photograph join cannot be
 *     trusted, and a silent pick would be D7 one layer up. Refused outright.
 *
 *  §15 (no photo snooping): reads only JSONL/JSON records earlier tools wrote —
 *  never a photograph, never a crop. Output is counts only: never a filename,
 *  never a name, never per-person detail. Person keys ("p3") are opaque.
 *
 *  No regex. Only node built-ins.
 */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import path from "node:path"

import { boxIou } from "../../public/vision/detect.js"
import { computeDatasetId } from "./dataset-id.js"

const USAGE = `Usage: node scripts/vision/rekey-labels.js --from <runA> --to <runB> \\
         --labels <labels.json> --identities <identities.json> --out-dir <dir>

  Rewrite a labelling made against run <runA> in run <runB>'s face numbering.
  Photographs are joined by sha256; boxes are matched mutual-best with a
  margin. Writes four files into --out-dir, all under one fresh person-key
  remap: labels.json, identities.json, poolA.json, exclusions.json.

  --from DIR         Source run (photos.jsonl + faces.jsonl) the labels were
                      made against. Required.
  --to DIR           Target run whose numbering the labels are rewritten in.
                      Required.
  --labels FILE      The labels.json to carry. Required.
  --identities FILE  Its identities.json sidecar, from the SAME export.
                      Optional, but without it every carried person is nameless.
  --out-dir DIR      Where the four files are written. Required.
  --force            Overwrite outputs that already exist. Without it, an
                      existing labels.json (human judgement) is never clobbered.
  --help
`

/** Exit codes, matching scripts/vision/labels-backup.js. */
const EXIT = { CLEAN: 0, ABORTED: 2 }

/**
 * Below this IoU two boxes are not the same face. Chosen just under
 * detect.js's `duplicateIou` (0.55): within one run, two detections that
 * overlap MORE than that were already merged as one face, so any surviving
 * pair of distinct faces overlaps at most ~0.55 — a cross-run pair down at
 * that level is at different-face overlap, not same-face-seen-twice. The same
 * face found by two configurations of the same detector at the same
 * resolution lands far above this.
 */
export const MATCH_IOU_FLOOR = 0.5

/**
 * The accepted pair's IoU must beat each side's runner-up by this much. It is
 * what rejects the crowded-row ambiguity: a drifted box that overlaps two
 * neighbours almost equally is a coin flip, and a coin flip attaches a label
 * to somebody else's face. 0.1 is far above box-rounding jitter (boxes are
 * stored at two decimal places) and far below the gap a genuine match shows
 * against a mere neighbour, so it rejects near-ties and nothing else. An
 * exact tie makes the runner-up equal the best, fails this test on both
 * sides identically, and is therefore order-independent by construction.
 */
export const MATCH_IOU_MARGIN = 0.1

// ---------------------------------------------------------------------------
// Reading run files
// ---------------------------------------------------------------------------

/**
 * One JSONL file. A malformed line is counted and skipped, never fatal —
 * matching session1-report.js's reader.
 * @template T
 * @param {string} file
 * @returns {{ records: T[], skipped: number, present: boolean }}
 */
function readJsonl(file) {
  if (!fs.existsSync(file)) return { records: [], skipped: 0, present: false }
  const text = fs.readFileSync(file, "utf8")
  /** @type {T[]} */
  const records = []
  let skipped = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      records.push(/** @type {T} */ (JSON.parse(trimmed)))
    } catch {
      skipped++
    }
  }
  return { records, skipped, present: true }
}

/** @type {Types.readRekeyRun} */
export function readRekeyRun(dir) {
  const photos = readJsonl(path.join(dir, "photos.jsonl"))
  const faces = readJsonl(path.join(dir, "faces.jsonl"))
  if (!photos.present || photos.records.length === 0) {
    throw new Error(`${dir}: photos.jsonl is missing or empty — not a run directory?`)
  }
  if (!faces.present || faces.records.length === 0) {
    throw new Error(`${dir}: faces.jsonl is missing or empty — not a run directory?`)
  }
  if (photos.skipped + faces.skipped > 0) {
    console.warn(
      `warning: ${dir}: skipped ${photos.skipped + faces.skipped} unparseable JSONL line(s) — was the batch interrupted?`,
    )
  }
  return {
    photos: /** @type {Types.Session1PhotoRecord[]} */ (photos.records),
    faces: /** @type {Types.Session1FaceRecord[]} */ (faces.records),
  }
}

// ---------------------------------------------------------------------------
// The photograph join (D7)
// ---------------------------------------------------------------------------

/** @type {Types.indexPhotosBySha} */
export function indexPhotosBySha(photos, side) {
  /** @type {Map<string, Types.Session1PhotoRecord>} */
  const bySha = new Map()
  for (const photo of photos) {
    const existing = bySha.get(photo.sha256)
    if (existing !== undefined) {
      // Deliberately an abort, not a pick: two byte-identical photographs mean
      // the sha256 join cannot say which one the target's faces belong to, and
      // a silent "last wins" is exactly D7 one layer up. Photo ids and a hash
      // prefix only — never a path.
      throw new Error(
        `${side}: photos ${existing.id} and ${photo.id} share sha256 ${photo.sha256.slice(0, 8)}… — ` +
          `the photograph join is ambiguous, so nothing can be carried safely. ` +
          `Re-run the batch over a deduplicated directory, or drop one copy.`,
      )
    }
    bySha.set(photo.sha256, photo)
  }
  return bySha
}

// ---------------------------------------------------------------------------
// Box matching: mutual-best plus margin
// ---------------------------------------------------------------------------

/**
 * @param {readonly Types.Session1FaceRecord[]} faces
 * @returns {Map<number, Types.Session1FaceRecord[]>}
 */
function facesByPhoto(faces) {
  /** @type {Map<number, Types.Session1FaceRecord[]>} */
  const map = new Map()
  for (const face of faces) {
    const list = map.get(face.photoId)
    if (list === undefined) map.set(face.photoId, [face])
    else list.push(face)
  }
  // Ascending face id, so every index-based tie-break below is deterministic
  // whatever order the JSONL happened to be written in.
  for (const list of map.values()) list.sort((a, b) => a.id - b.id)
  return map
}

/**
 * Best and runner-up of one row/column of the IoU matrix. `second` is 0 when
 * there is no runner-up: a lone candidate has nobody to be confused with, so
 * the margin test passes trivially — which is the correct reading, not a
 * loophole.
 * @param {readonly number[]} values
 * @returns {{ index: number, best: number, second: number }}
 */
function bestAndSecond(values) {
  let index = 0
  let best = -1
  for (let i = 0; i < values.length; i++) {
    if (values[i] > best) {
      best = values[i]
      index = i
    }
  }
  let second = 0
  for (let i = 0; i < values.length; i++) {
    if (i !== index && values[i] > second) second = values[i]
  }
  return { index, best, second }
}

/** @type {Types.matchRuns} */
export function matchRuns(source, target) {
  const sourceBySha = indexPhotosBySha(source.photos, "--from")
  const targetBySha = indexPhotosBySha(target.photos, "--to")
  const sourceFaces = facesByPhoto(source.faces)
  const targetFaces = facesByPhoto(target.faces)

  /** @type {Map<number, number>} */
  const map = new Map()
  const unmatched = { photoMissing: 0, noCandidate: 0, belowFloor: 0, notMutual: 0, marginTooSmall: 0 }
  let photosJoined = 0
  let photosSourceOnly = 0

  const orderedSourcePhotos = [...sourceBySha.values()].sort((a, b) => a.id - b.id)
  /** Targets already claimed — impossible to claim twice when the margin is
   *  positive (a passing pair is its target's strict best), so this is a
   *  defensive assertion, not logic. */
  const claimed = new Set()

  for (const sourcePhoto of orderedSourcePhotos) {
    const targetPhoto = targetBySha.get(sourcePhoto.sha256)
    const sList = sourceFaces.get(sourcePhoto.id) ?? []
    if (targetPhoto === undefined) {
      photosSourceOnly++
      unmatched.photoMissing += sList.length
      continue
    }
    photosJoined++
    const tList = targetFaces.get(targetPhoto.id) ?? []
    if (sList.length === 0) continue
    if (tList.length === 0) {
      unmatched.noCandidate += sList.length
      continue
    }

    // Full IoU matrix. Photographs hold a handful of faces, so O(n·m) here is
    // nothing, and having the whole matrix makes both directions of the
    // mutual-best test read off the same numbers.
    /** @type {number[][]} */
    const iou = sList.map((s) => tList.map((t) => boxIou(s.box, t.box)))
    /** Per-target best/second across sources: column stats of the matrix. */
    const colStats = tList.map((_t, j) => bestAndSecond(iou.map((row) => row[j])))

    for (let i = 0; i < sList.length; i++) {
      const row = bestAndSecond(iou[i])
      if (row.best < MATCH_IOU_FLOOR) {
        unmatched.belowFloor++
        continue
      }
      const j = row.index
      const col = colStats[j]
      // Mutual best, phrased so it cannot depend on which index argmax picked
      // on a tie: s must achieve the column's maximum, not merely be at it.
      if (iou[i][j] < col.best) {
        unmatched.notMutual++
        continue
      }
      // The margin, on BOTH sides. An exact tie on either side puts the
      // runner-up equal to the best, fails here for every party to the tie
      // identically, and is what makes the outcome order-independent.
      if (row.best - row.second < MATCH_IOU_MARGIN || iou[i][j] - col.second < MATCH_IOU_MARGIN) {
        unmatched.marginTooSmall++
        continue
      }
      const targetId = tList[j].id
      if (claimed.has(targetId)) {
        throw new Error(`internal: target face ${targetId} matched twice — the margin test should make this impossible`)
      }
      claimed.add(targetId)
      map.set(sList[i].id, targetId)
    }
  }

  let photosTargetOnly = 0
  for (const sha of targetBySha.keys()) if (!sourceBySha.has(sha)) photosTargetOnly++

  return { map, unmatched, photosJoined, photosSourceOnly, photosTargetOnly }
}

// ---------------------------------------------------------------------------
// The rewrite, under one remap (D4)
// ---------------------------------------------------------------------------

/**
 * A person key as label.html writes it: "p" then a positive integer.
 * @param {unknown} value
 * @returns {value is string}
 */
function isPersonKey(value) {
  if (typeof value !== "string" || value.length < 2) return false
  if (value.charAt(0) !== "p" || value.charAt(1) === "0") return false
  for (let i = 1; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** @type {Types.rekeyLabels} */
export function rekeyLabels(source, target, labelFile, identitiesFile) {
  if (!labelFile || typeof labelFile !== "object" || !labelFile.labels || typeof labelFile.labels !== "object") {
    throw new Error("labels file: no `labels` map in it — not a labels.json?")
  }
  const poolMap = labelFile.pool
  if (!poolMap || typeof poolMap !== "object" || Object.keys(poolMap).length === 0) {
    // D6: pool A is the only individually-judged sample and the whole reason
    // poolA.json exists. A labels file without the map predates two-pool
    // sampling and cannot be carried honestly.
    throw new Error(
      "labels file carries no `pool` map, so pool-A membership cannot be carried (D6). " +
        "Re-export from the labelling page against the source run first.",
    )
  }

  // The labels must actually belong to the source run. Same refusal as
  // session1-report.js's loadRun: a mismatched join attaches labels to the
  // wrong faces with nothing said.
  const sourceDatasetId = computeDatasetId(source.faces)
  if (typeof labelFile.datasetId === "string" && labelFile.datasetId.length > 0 && labelFile.datasetId !== sourceDatasetId) {
    throw new Error(
      `labels file was made from a different run: its datasetId is ${labelFile.datasetId}, ` +
        `but --from's faces.jsonl hashes to ${sourceDatasetId}. Point --from at the run the ` +
        `labelling was actually made against.`,
    )
  }
  if (typeof labelFile.datasetId !== "string") {
    console.warn(
      "warning: labels file carries no datasetId, so nothing verified it belongs to --from's run. " +
        "If --from is the wrong run, every carried label lands on somebody else's face.",
    )
  }

  const labelMap = labelFile.labels
  /** Every person key the labels use — the reference set the sidecar must
   *  stay inside. */
  const labelPersonKeys = new Set()
  for (const id in labelMap) {
    const value = labelMap[id]
    if (isPersonKey(value)) labelPersonKeys.add(value)
  }

  if (identitiesFile !== null) {
    if (!identitiesFile || typeof identitiesFile !== "object" || typeof identitiesFile.identities !== "object" || identitiesFile.identities === null) {
      throw new Error("identities file: no `identities` map in it — not an identities.json?")
    }
    if (
      typeof identitiesFile.datasetId === "string" &&
      typeof labelFile.datasetId === "string" &&
      identitiesFile.datasetId !== labelFile.datasetId
    ) {
      throw new Error(
        "identities file and labels file carry different datasetIds — they are not from the same run.",
      )
    }
    // D4's sharpest edge: person keys are re-scrambled on EVERY export, so an
    // identities.json from a different export than the labels.json would join
    // its names to the wrong people — and datasetId cannot catch it, because
    // both exports are of the same run. What can: buildExport only writes
    // identity entries for keys the labels use, so a foreign key here proves
    // the pair is mismatched. label.html drops these silently; this refuses.
    for (const key in identitiesFile.identities) {
      if (!labelPersonKeys.has(key)) {
        throw new Error(
          `identities file names person key ${key}, which the labels file never uses. Person keys are ` +
            `re-scrambled on every export (D4), so these two files are from different exports and their ` +
            `names would attach to the wrong people. Re-export both files together from the labelling page.`,
        )
      }
    }
  }

  const match = matchRuns(source, target)
  const targetDatasetId = computeDatasetId(target.faces)

  // One fresh remap for every output (D4). Allocation order is ascending
  // source face id — deterministic, and deliberately unrelated to the input's
  // numbering, which was scrambled and carries nothing.
  const orderedSourceFaces = [...source.faces].sort((a, b) => a.id - b.id)
  /** @type {Map<string, string>} */
  const remap = new Map()
  for (const face of orderedSourceFaces) {
    if (!match.map.has(face.id)) continue
    const value = labelMap[String(face.id)]
    if (!isPersonKey(value)) continue
    if (!remap.has(value)) remap.set(value, `p${remap.size + 1}`)
  }
  let personsLost = 0
  for (const key of labelPersonKeys) if (!remap.has(key)) personsLost++

  // labels + pool, both in target numbering. `group` and `excluded` are
  // deliberately ABSENT from the output labels.json: group ids are the source
  // run's and a new run regroups (D5), so carrying either would attach the
  // records to unrelated clusters. Exclusions land face-keyed in
  // exclusions.json instead.
  /** @type {Record<string, string>} */
  const outLabels = {}
  /** @type {Record<string, "A" | "B">} */
  const outPool = {}
  /** @type {number[]} */
  const poolAIds = []
  let labelsCarried = 0
  let labelsLost = 0
  let poolACarried = 0
  let poolALost = 0
  for (const face of orderedSourceFaces) {
    const sid = String(face.id)
    const targetId = match.map.get(face.id)
    const label = labelMap[sid]
    if (label === "x" || isPersonKey(label)) {
      if (targetId === undefined) labelsLost++
      else {
        outLabels[String(targetId)] = label === "x" ? "x" : /** @type {string} */ (remap.get(label))
        labelsCarried++
      }
    }
    const pool = poolMap[sid]
    if (pool === "A" || pool === "B") {
      if (targetId === undefined) {
        if (pool === "A") poolALost++
      } else {
        outPool[String(targetId)] = pool
        if (pool === "A") {
          poolAIds.push(targetId)
          poolACarried++
        }
      }
    }
  }
  poolAIds.sort((a, b) => a - b)

  // Skips are the labeller's own record ("I looked and could not tell").
  /** @type {Set<number>} */
  const skippedOut = new Set()
  let skippedLost = 0
  const skippedIn = Array.isArray(labelFile.skipped) ? labelFile.skipped : []
  for (const id of skippedIn) {
    if (typeof id !== "number") continue
    const targetId = match.map.get(id)
    if (targetId === undefined) skippedLost++
    else skippedOut.add(targetId)
  }

  // Exclusions: group-keyed → face-keyed (D5). The person a group's exclusions
  // reject is read off the group's own surviving labels: the faces the model
  // put in group g, minus the excluded ones, labelled with exactly one person
  // key. Zero person keys (never labelled) or more than one (the group was
  // split by hand) leaves nothing safe to attach the exclusion to.
  const groupMap = labelFile.group && typeof labelFile.group === "object" ? labelFile.group : {}
  const excludedMap = labelFile.excluded && typeof labelFile.excluded === "object" ? labelFile.excluded : {}
  /** @type {Types.ExclusionRecord[]} */
  const exclusions = []
  /** @type {Set<string>} */
  const exclusionSeen = new Set()
  let exclusionsConverted = 0
  let exclusionsDroppedUnmatched = 0
  let exclusionsDroppedNoPerson = 0
  const groupKeys = Object.keys(excludedMap).sort((a, b) => Number(a) - Number(b))
  for (const groupKey of groupKeys) {
    const excludedIds = excludedMap[groupKey]
    if (!Array.isArray(excludedIds) || excludedIds.length === 0) continue
    const groupId = Number(groupKey)
    /** @type {Set<number>} */
    const excludedSet = new Set()
    for (const id of excludedIds) if (typeof id === "number") excludedSet.add(id)

    /** @type {Set<string>} */
    const personsInGroup = new Set()
    for (const faceKey in groupMap) {
      if (groupMap[faceKey] !== groupId) continue
      const faceId = Number(faceKey)
      if (excludedSet.has(faceId)) continue
      const label = labelMap[faceKey]
      if (isPersonKey(label)) personsInGroup.add(label)
    }
    const oldKey = personsInGroup.size === 1 ? [...personsInGroup][0] : null
    const freshKey = oldKey === null ? undefined : remap.get(oldKey)
    if (freshKey === undefined) {
      exclusionsDroppedNoPerson += excludedSet.size
      continue
    }
    for (const id of [...excludedSet].sort((a, b) => a - b)) {
      const targetId = match.map.get(id)
      if (targetId === undefined) {
        exclusionsDroppedUnmatched++
        continue
      }
      const dedupeKey = `${targetId}:${freshKey}`
      if (exclusionSeen.has(dedupeKey)) continue
      exclusionSeen.add(dedupeKey)
      exclusions.push({ faceId: targetId, notPerson: freshKey })
      exclusionsConverted++
    }
  }
  exclusions.sort((a, b) => a.faceId - b.faceId || (a.notPerson < b.notPerson ? -1 : a.notPerson > b.notPerson ? 1 : 0))

  // The names sidecar, under the SAME remap — the whole point of D4.
  /** @type {Types.Session1IdentitiesFile | null} */
  let identitiesOut = null
  let namesCarried = 0
  let namesDropped = 0
  if (identitiesFile !== null) {
    /** @type {Record<string, { guestId: number | null, name: string }>} */
    const outIdentities = {}
    const inputKeys = Object.keys(identitiesFile.identities)
    // Fresh-key order, so the output reads p1, p2… whatever order the
    // scrambled input happened to be in.
    inputKeys.sort((a, b) => {
      const fa = remap.get(a)
      const fb = remap.get(b)
      const na = fa === undefined ? Number.MAX_SAFE_INTEGER : Number(fa.slice(1))
      const nb = fb === undefined ? Number.MAX_SAFE_INTEGER : Number(fb.slice(1))
      return na - nb
    })
    for (const key of inputKeys) {
      const entry = identitiesFile.identities[key]
      const freshKey = remap.get(key)
      if (freshKey === undefined || !entry || typeof entry.name !== "string" || entry.name.length === 0) {
        namesDropped++
        continue
      }
      outIdentities[freshKey] = {
        guestId: typeof entry.guestId === "number" ? entry.guestId : null,
        name: entry.name,
      }
      namesCarried++
    }
    identitiesOut = { version: 1, datasetId: targetDatasetId, identities: outIdentities }
  }

  // Field order mirrors label.html's buildExport so the two files diff sanely.
  /** @type {Types.Session1LabelFile} */
  const labelsOut = {
    version: 2,
    datasetId: targetDatasetId,
    labels: outLabels,
    pool: outPool,
    skipped: [...skippedOut].sort((a, b) => a - b),
  }

  return {
    labels: labelsOut,
    identities: identitiesOut,
    poolA: { version: 1, datasetId: targetDatasetId, faceIds: poolAIds },
    exclusions: { version: 1, datasetId: targetDatasetId, exclusions },
    counts: {
      photosJoined: match.photosJoined,
      photosSourceOnly: match.photosSourceOnly,
      photosTargetOnly: match.photosTargetOnly,
      sourceFaces: source.faces.length,
      facesMatched: match.map.size,
      unmatched: match.unmatched,
      labelsCarried,
      labelsLost,
      personsCarried: remap.size,
      personsLost,
      namesCarried,
      namesDropped,
      poolACarried,
      poolALost,
      skippedCarried: skippedOut.size,
      skippedLost,
      exclusionsConverted,
      exclusionsDroppedUnmatched,
      exclusionsDroppedNoPerson,
    },
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * No regex, per CLAUDE.md: a manual switch over known flags. Unknown `--flags`
 * are refused rather than silently ignored.
 * @param {readonly string[]} argv
 * @returns {{ valid: true, from: string, to: string, labels: string, identities: string | null, outDir: string, force: boolean }
 *   | { valid: false, error: string }}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let from = null
  /** @type {string | null} */
  let to = null
  /** @type {string | null} */
  let labels = null
  /** @type {string | null} */
  let identities = null
  /** @type {string | null} */
  let outDir = null
  let force = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") return { valid: false, error: USAGE }
    if (arg === "--force") {
      force = true
      continue
    }
    if (arg === "--from" || arg === "--to" || arg === "--labels" || arg === "--identities" || arg === "--out-dir") {
      i++
      const value = argv[i]
      if (value === undefined || value.startsWith("--")) return { valid: false, error: `${arg} needs a value` }
      if (arg === "--from") from = value
      else if (arg === "--to") to = value
      else if (arg === "--labels") labels = value
      else if (arg === "--identities") identities = value
      else outDir = value
      continue
    }
    return { valid: false, error: `Unknown option: ${arg}\n\n${USAGE}` }
  }

  if (from === null || to === null || labels === null || outDir === null) {
    /** @type {string[]} */
    const missing = []
    if (from === null) missing.push("--from")
    if (to === null) missing.push("--to")
    if (labels === null) missing.push("--labels")
    if (outDir === null) missing.push("--out-dir")
    return { valid: false, error: `Missing required option(s): ${missing.join(", ")}\n\n${USAGE}` }
  }
  return {
    valid: true,
    from: path.resolve(from),
    to: path.resolve(to),
    labels: path.resolve(labels),
    identities: identities === null ? null : path.resolve(identities),
    outDir: path.resolve(outDir),
    force,
  }
}

/**
 * @param {string} file
 * @returns {unknown}
 */
function readJsonFile(file) {
  if (!fs.existsSync(file)) throw new Error(`${file}: no such file`)
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    throw new Error(`${file}: not parseable as JSON`)
  }
}

/** @type {Types.runRekey} */
export function runRekey(args, log) {
  const source = readRekeyRun(args.from)
  const target = readRekeyRun(args.to)
  const labelFile = /** @type {Types.Session1LabelFile} */ (readJsonFile(args.labels))
  const identitiesFile =
    args.identities === null ? null : /** @type {Types.Session1IdentitiesFile} */ (readJsonFile(args.identities))
  if (identitiesFile === null) {
    log("note: no --identities given — every carried person will be nameless until one is loaded.")
  }

  const result = rekeyLabels(source, target, labelFile, identitiesFile)

  /** @type {Array<{ name: string, body: unknown }>} */
  const outputs = [
    { name: "labels.json", body: result.labels },
    { name: "poolA.json", body: result.poolA },
    { name: "exclusions.json", body: result.exclusions },
  ]
  if (result.identities !== null) outputs.push({ name: "identities.json", body: result.identities })

  if (!args.force) {
    for (const output of outputs) {
      const file = path.join(args.outDir, output.name)
      if (fs.existsSync(file)) {
        // labels.json is human judgement and does not regenerate; the others
        // travel with it. Never clobbered without being told to.
        log(`Refusing: ${file} already exists. Pass --force to overwrite.`)
        return EXIT.ABORTED
      }
    }
  }

  fs.mkdirSync(args.outDir, { recursive: true })
  for (const output of outputs) {
    fs.writeFileSync(path.join(args.outDir, output.name), JSON.stringify(output.body, null, 2) + "\n")
  }

  const c = result.counts
  const u = c.unmatched
  log(`photographs: ${c.photosJoined} joined, ${c.photosSourceOnly} source-only, ${c.photosTargetOnly} target-only`)
  log(`faces: ${c.facesMatched} of ${c.sourceFaces} matched`)
  log(
    `  unmatched: photograph missing ${u.photoMissing}, no candidate box ${u.noCandidate}, ` +
      `below IoU floor ${u.belowFloor}, not mutual best ${u.notMutual}, margin too small ${u.marginTooSmall}`,
  )
  log(`labels: ${c.labelsCarried} carried, ${c.labelsLost} lost with their faces`)
  log(`persons: ${c.personsCarried} carried, ${c.personsLost} lost every face`)
  if (result.identities !== null) log(`names: ${c.namesCarried} carried, ${c.namesDropped} dropped`)
  log(`pool A: ${c.poolACarried} carried, ${c.poolALost} lost`)
  log(`skipped: ${c.skippedCarried} carried, ${c.skippedLost} lost`)
  log(
    `exclusions: ${c.exclusionsConverted} converted to per-face records, ` +
      `${c.exclusionsDroppedUnmatched} dropped (face unmatched), ` +
      `${c.exclusionsDroppedNoPerson} dropped (no unambiguous person)`,
  )
  log(`datasetId: ${result.labels.datasetId}`)
  log(`wrote ${outputs.length} file(s) to ${args.outDir}`)
  return EXIT.CLEAN
}

// `node scripts/vision/rekey-labels.js ...` runs; `import` from a test does
// not. Same guard as scripts/vision/ingest-faces.js.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.valid) {
    console.error(parsed.error)
    process.exit(EXIT.ABORTED)
  }
  try {
    process.exit(runRekey(parsed, console.log))
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(EXIT.ABORTED)
  }
}
