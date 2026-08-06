#!/usr/bin/env node
/** @file CLI: turn a labelling session's own files — `labels.json` and its
 *  `identities.json` sidecar, against the run that produced them — into a
 *  portable `wedding-face-work` artifact, so that the human judgement recorded
 *  on this machine can be applied by `export-face-work.js import` like any
 *  other hand-off.
 *
 *  ## Why a converter and not a writer
 *
 *  The obvious shape for this job is "read labels.json, write `people` rows and
 *  `face_identities` rows". That would be a SECOND set of conflict semantics —
 *  a second answer to "this face is already someone else", "this person already
 *  exists", "what happens on a re-run" — sitting next to the tested set in
 *  `export-face-work.js` and free to drift from it. So this file writes no
 *  database rows at all. It produces the artifact; the import path applies it,
 *  with its own refusals, its own append-only ledger batch and its own
 *  revocation. That also exercises the production hand-off on the machine that
 *  did the labelling, months before it has to work on the machine that serves
 *  the site.
 *
 *  ## The coordinate space, which is the whole trap
 *
 *  `faces.jsonl` boxes are in DECODE space: the batch decodes each photograph
 *  down to `--source-edge` (2000px on the long edge) before detecting.
 *  `media_faces` stores boxes in the photograph's ORIGINAL pixels, because that
 *  is the space the Faces tab crops against. A confirmation key is
 *  `(photo content hash, box)`, so keys built from raw `faces.jsonl` values
 *  match NOTHING and the import silently does nothing — it has no way to tell a
 *  wholly mis-keyed artifact from one whose photographs this machine lacks.
 *
 *  The scaling is therefore not done here. `ingest-faces.js`'s
 *  `scaleFaceGeometry` is the function that did it when the rows were written,
 *  and it is the function called here — one implementation, so the keys are
 *  derived the same way on both sides by construction rather than by two
 *  authors agreeing. `faceWorkBoxKey` and the content digest come from
 *  `export-face-work.js` for the same reason.
 *
 *  And then it is CHECKED: every labelled face's key must be present in the
 *  target database's own face rows for the named ingest, and a single absence
 *  refuses the whole conversion. A converter that emits an artifact it has not
 *  proved joins is a converter that fails silently.
 *
 *  ## Provenance is read from the target, not reconstructed
 *
 *  `payload.ingest` must be provenance-EQUIVALENT to the `vision_ingests` row
 *  the import runs against, field by field, or the import refuses. Rather than
 *  rebuilding that object from `timing.json` and hoping every field lands the
 *  same way `buildIngestInput` landed it, this reads the target's own row —
 *  named by `--ingest`, never guessed — and passes it through `ingestToLogical`,
 *  the same function the export uses. Equivalence then holds by construction.
 *  The run is still tied to that row by `dataset_id`, which is checked against
 *  `labels.json`'s and against a fresh digest of `faces.jsonl` itself.
 *
 *  ## One artifact, one batch, everything confirmed
 *
 *  Every label a human wrote is a human's judgement, so every assignment leaves
 *  here as `provenance: "confirmed"` and `includesPropagated` is false. There is
 *  deliberately no split by labelling pool: the import matches an incoming
 *  person to an existing one by FACE OVERLAP, never by name, so two artifacts
 *  with disjoint face sets would create two people per person and say so only in
 *  an advisory.
 *
 *  ## The not-a-face sentinel is a constant, and an unnamed key is a refusal
 *
 *  `label.html` writes opaque person keys and one sentinel meaning "this is not
 *  a face". That sentinel is `"x"`, guaranteed by the labelling page on both
 *  read paths and preserved verbatim by `rekey-labels.js` — so it is named here
 *  (`NOT_A_FACE`) rather than inferred. Any label value that is neither the
 *  sentinel nor named in `identities.json` is a person nobody named, and it
 *  refuses the conversion: quietly retiring a real person's faces as "not a
 *  face" is the worst outcome available here, and inferring the sentinel by
 *  absence could not tell those two cases apart.
 *
 *  §15 (no photo snooping): nothing here opens a photograph or a crop. The run
 *  directory, the database and the output path are all explicit arguments;
 *  nothing is searched for. Console output is counts and refusal categories —
 *  never a filename, never a path, never a person's name. The artifact itself
 *  carries real names, so its destination goes through the same
 *  `exportDestinationRefusal` the export uses: inside this public repository is
 *  refused unless `.gitignore` already covers it.
 *
 *  Opens the database READ-ONLY. This tool has nothing to write there, and the
 *  one machine it runs on is the one with a server attached to that file.
 */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { sql } from "../../db/sql.js"
import { computeDatasetId } from "./dataset-id.js"
import {
  FORMAT,
  FORMAT_VERSION,
  assignPersonRefs,
  batchIdForDigest,
  candidateFaces,
  exportDestinationRefusal,
  faceWorkBoxKey,
  faceWorkDigest,
  groupFacesByKey,
  ingestToLogical,
  useDatabase,
} from "./export-face-work.js"
import { readJsonl, scaleFaceGeometry } from "./ingest-faces.js"

const USAGE = `Usage: node scripts/vision/convert-labels-to-face-work.js <run-dir> [options]

  Convert a labelling session (labels.json + identities.json, against the run
  that produced them) into a wedding-face-work artifact. Writes no database
  rows: apply the artifact with

    node scripts/vision/export-face-work.js import <artifact> --weights DIR --engine PATH

  so that one tested set of conflict semantics does the applying.

  <run-dir>                 Directory holding photos.jsonl, faces.jsonl,
                             labels.json and identities.json. Always an explicit
                             argument; nothing is searched for.

Options:

  --database PATH           SQLite file the work was labelled against, opened
                             READ-ONLY. Default: $DATABASE_PATH, else data/wedding.db.
  --ingest N                vision_ingests row this labelling describes. REQUIRED
                             and never guessed: its logical provenance becomes
                             payload.ingest, which is what makes the import's
                             equivalence check hold by construction.
  --faces-from WHICH        Which face rows belong to that ingest: "ingest" (the
                             ingest_id column, the default) or "model-version".
                             Must match what you pass to the import.
  --out PATH                Where to write the artifact. REQUIRED. Refused inside
                             this repository unless .gitignore covers it — the
                             file carries people's real display names.
  --dry-run                 Report the counts and the batch id; write nothing.
  --help, -h                Show this message.
`

/** Everything an assignment leaves here as. A label is a human's judgement one
 *  face at a time; `propagated` is the model guessing, and nothing in a
 *  labelling session is the model guessing. */
const LABEL_PROVENANCE = "confirmed"

/**
 * No regex, per CLAUDE.md: a manual switch over known flags. Unknown `--flags`
 * are refused rather than silently ignored.
 * @type {Types.parseConvertLabelsArgs}
 */
export function parseConvertLabelsArgs(argv) {
  /** @type {string[]} */
  const positionals = []
  /** @type {Types.ConvertLabelsArgs} */
  const args = {
    runDir: "",
    database: null,
    ingestId: 0,
    facesFrom: "ingest",
    out: "",
    dryRun: false,
  }
  let help = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      help = true
    } else if (arg === "--dry-run") {
      args.dryRun = true
    } else if (arg === "--database") {
      i++
      if (i >= argv.length) return { valid: false, error: "--database needs a value" }
      args.database = argv[i]
    } else if (arg === "--ingest") {
      i++
      if (i >= argv.length) return { valid: false, error: "--ingest needs a value" }
      const parsed = Number(argv[i])
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { valid: false, error: `--ingest needs a positive integer, got "${argv[i]}"` }
      }
      args.ingestId = parsed
    } else if (arg === "--faces-from") {
      i++
      if (i >= argv.length) return { valid: false, error: "--faces-from needs a value" }
      if (argv[i] !== "ingest" && argv[i] !== "model-version") {
        return { valid: false, error: `--faces-from must be "ingest" or "model-version"` }
      }
      args.facesFrom = argv[i] === "ingest" ? "ingest" : "model-version"
    } else if (arg === "--out") {
      i++
      if (i >= argv.length) return { valid: false, error: "--out needs a value" }
      args.out = argv[i]
    } else if (arg.startsWith("--")) {
      return { valid: false, error: `Unknown option: ${arg}` }
    } else {
      positionals.push(arg)
    }
  }

  if (help) return { valid: false, error: USAGE }

  const runDir = positionals[0] ?? null
  if (!runDir) return { valid: false, error: `A run directory is required.\n\n${USAGE}` }
  args.runDir = runDir

  if (args.ingestId === 0) {
    return {
      valid: false,
      error:
        "--ingest N is required. The artifact's provenance block is read from that row, which " +
        "is what makes it equivalent to the ingest the import runs against; picking one by " +
        "guesswork would make that equivalence a coincidence.\n\n" +
        USAGE,
    }
  }
  if (!args.out) return { valid: false, error: `--out PATH is required.\n\n${USAGE}` }

  return { valid: true, value: args }
}

/**
 * The names sidecar, reduced to person key → display name.
 *
 * `label.html` writes `{ guestId, name }` per key; older exports wrote the bare
 * name. Both are read; anything else is a refusal rather than a coerced
 * `String(value)`, because a mangled name would travel to production as a real
 * person's label. `guestId` is deliberately dropped — the roster and its ids are
 * the target machine's own business, which is why the artifact format carries no
 * `people.guest_id` either.
 * @type {Types.normaliseIdentityNames}
 */
export function normaliseIdentityNames(identities) {
  /** @type {Map<string, string>} */
  const names = new Map()
  for (const key of Object.keys(identities)) {
    const value = identities[key]
    /** @type {unknown} */
    let name = value
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      name = /** @type {Record<string, unknown>} */ (value).name
    }
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error(
        `identities.json: one entry has no usable name (its value is ` +
          `${name === undefined ? "absent" : typeof name}). A person key with no name cannot ` +
          `become a person, and it must not be mistaken for the not-a-face sentinel.`,
      )
    }
    names.set(key, name.trim())
  }
  return names
}

/**
 * `label.html`'s not-a-face sentinel — a CONSTANT, not something this file
 * works out for itself.
 *
 * Three first-party places already fix the shape of a label value, and they
 * agree: `label.html` validates every one both on import and on reading its own
 * saved record (*"neither `x` nor p<n>"*), and `rekey-labels.js` branches on
 * that same pair, passing `"x"` through its person-key remap untouched. Any
 * labelling this converter can be handed came through at least one of them.
 *
 * It used to be derived by ABSENCE instead: the one label value with no name in
 * `identities.json`. That is correct whenever exactly one value is unnamed, and
 * silently catastrophic in the one case it cannot distinguish — an unnamed
 * value that is a PERSON nobody got round to naming. Their faces would convert
 * to `not_a_face` and retire, which is the worst outcome this tool has
 * available. Two unnamed values were already refused; one was trusted, and one
 * is by far the likelier accident.
 */
export const NOT_A_FACE = "x"

/**
 * Every distinct label value, against the sentinel and the names sidecar.
 *
 * `"x"` is not a face. Everything else must name somebody — a value with no
 * entry in `identities.json` is a person nobody named, and it is refused rather
 * than guessed at, which is the hole `NOT_A_FACE` describes.
 *
 * Person keys are deliberately NOT additionally checked against `p<n>`. This
 * tool needs to know which value means "not a face" and nothing more; what the
 * others are called is the labelling tool's business, and `label.html` already
 * refuses a malformed one at both ends.
 * @type {Types.checkLabelValues}
 */
export function checkLabelValues(labelValues, namedKeys) {
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {string[]} */
  const unnamed = []
  let sentinelUsed = false
  for (const value of labelValues) {
    if (seen.has(value)) continue
    seen.add(value)
    if (value === NOT_A_FACE) {
      sentinelUsed = true
      continue
    }
    if (!namedKeys.has(value)) unnamed.push(value)
  }
  if (unnamed.length > 0) {
    return {
      valid: false,
      error:
        `${unnamed.length} label value(s) are neither the not-a-face sentinel nor named in ` +
        `identities.json. Each one is a person nobody named: converting them would either ` +
        `invent a person with no name or retire a real face. Name them (or remove their ` +
        `labels) and re-run.`,
    }
  }
  return { valid: true, value: sentinelUsed ? NOT_A_FACE : null }
}

/**
 * The artifact, or every reason there is not one. Pure: no filesystem, no
 * database — `mediaBySha` and `targetKeyCounts` arrive already queried, so the
 * scaling, the sentinel derivation and every refusal are unit-testable against
 * plain objects.
 * @type {Types.buildFaceWorkFromLabels}
 */
export function buildFaceWorkFromLabels({
  photos,
  faces,
  labels,
  identityNames,
  ingestRow,
  mediaBySha,
  targetKeyCounts,
}) {
  /** @type {string[]} */
  const refusals = []
  /** @type {string[]} */
  const advisories = []
  /** @type {Types.ConvertLabelsStats} */
  const stats = {
    facesInRun: faces.length,
    labelled: 0,
    skippedByLabeller: 0,
    unlabelled: 0,
    assign: 0,
    notAFace: 0,
    people: 0,
    unscaled: 0,
    unjoinable: { photoRecordMissing: 0, photoMissing: 0, aspectMismatch: 0, boxMissing: 0 },
    duplicateKeys: 0,
    multiRowKeys: 0,
  }

  // --- the three identity checks, before anything is built ---------------
  //
  // `labels.json` is keyed by RUN-LOCAL face id, so it means nothing at all
  // against a different faces.jsonl. The digest is what ties the two together,
  // and the ingest's own copy is what ties both to the rows being keyed.
  const runDatasetId = computeDatasetId(faces)
  if (typeof labels.datasetId !== "string" || labels.datasetId.length === 0) {
    refusals.push(
      "labels.json carries no datasetId (a version-1 file). Its face ids cannot be shown to " +
        "belong to this run's faces.jsonl, and a labelling read against the wrong run joins " +
        "every id to somebody else's face without a single warning.",
    )
  } else if (labels.datasetId !== runDatasetId) {
    refusals.push(
      `labels.json's datasetId does not match a fresh digest of this run's faces.jsonl. The ` +
        `labelling was made against a different detection set.`,
    )
  } else if (labels.datasetId !== ingestRow.dataset_id) {
    refusals.push(
      `labels.json's datasetId does not match vision_ingests ${ingestRow.id}'s. The labelling ` +
        `and the face rows being keyed come from different detection runs.`,
    )
  }

  const sentinel = checkLabelValues(Object.values(labels.labels), new Set(identityNames.keys()))
  if (!sentinel.valid) refusals.push(sentinel.error)

  // --- run-local lookups --------------------------------------------------
  /** @type {Map<number, Types.Session1PhotoRecord>} */
  const photoById = new Map()
  for (const photo of photos) photoById.set(photo.id, photo)

  /** @type {Set<string>} */
  const skipped = new Set()
  for (const id of labels.skipped ?? []) skipped.add(String(id))

  // --- one pass over the faces the labeller decided about -----------------
  /** @type {Map<string, { op: "assign" | "not_a_face", personKey: string | null }>} */
  const decisionByKey = new Map()
  /** @type {Map<string, string[]>} person key -> content keys */
  const keysByPerson = new Map()

  for (const face of faces) {
    const faceId = String(face.id)
    if (skipped.has(faceId)) {
      stats.skippedByLabeller++
      continue
    }
    const label = Object.prototype.hasOwnProperty.call(labels.labels, faceId)
      ? labels.labels[faceId]
      : null
    if (label === null) {
      stats.unlabelled++
      continue
    }
    stats.labelled++

    const photo = photoById.get(face.photoId)
    if (!photo) {
      stats.unjoinable.photoRecordMissing++
      continue
    }
    const media = mediaBySha.get(photo.sha256)
    if (!media) {
      stats.unjoinable.photoMissing++
      continue
    }
    const geometry = scaleFaceGeometry(face, photo, media)
    if (geometry.kind === "mismatch") {
      stats.unjoinable.aspectMismatch++
      continue
    }
    if (geometry.kind === "unscaled") stats.unscaled++

    const key = faceWorkBoxKey(photo.sha256, geometry.box)
    const rowsUnderKey = targetKeyCounts.get(key) ?? 0
    if (rowsUnderKey === 0) {
      stats.unjoinable.boxMissing++
      continue
    }
    if (rowsUnderKey > 1) stats.multiRowKeys++

    if (decisionByKey.has(key)) {
      // Two labelled faces of one run resolving to one content key. Whether the
      // two verdicts agree or not, the artifact carries one decision per key, so
      // there is no honest way to write both — and if they disagree, picking one
      // is picking somebody's answer for them.
      stats.duplicateKeys++
      continue
    }

    // The constant, not a derived value: correct even when the check above
    // refused, so a refused conversion still reports honest counts.
    if (label === NOT_A_FACE) {
      decisionByKey.set(key, { op: "not_a_face", personKey: null })
      stats.notAFace++
      continue
    }
    decisionByKey.set(key, { op: "assign", personKey: label })
    stats.assign++
    const found = keysByPerson.get(label)
    if (found) found.push(key)
    else keysByPerson.set(label, [key])
  }

  // --- fail closed on every category, with counts and no identifiers ------
  const missed =
    stats.unjoinable.photoRecordMissing +
    stats.unjoinable.photoMissing +
    stats.unjoinable.aspectMismatch +
    stats.unjoinable.boxMissing
  if (missed > 0) {
    refusals.push(
      `${missed} of ${stats.labelled} labelled face(s) could not be keyed to a face row on this ` +
        `database: ${stats.unjoinable.photoRecordMissing} whose photo record is missing from ` +
        `photos.jsonl, ${stats.unjoinable.photoMissing} whose photograph this database does not ` +
        `have, ${stats.unjoinable.aspectMismatch} whose media dimensions contradict the run's ` +
        `(the content-hash join is suspect), and ${stats.unjoinable.boxMissing} whose box is not ` +
        `among ingest ${ingestRow.id}'s rows. Under the ingest that wrote these faces every one ` +
        `should key exactly — a partial artifact would apply what it could and report the rest ` +
        `as merely absent photographs, so it is refused here instead.`,
    )
  }
  if (stats.duplicateKeys > 0) {
    refusals.push(
      `${stats.duplicateKeys} labelled face(s) resolve to a content key another labelled face ` +
        `already claimed. One box carries one decision, and choosing between two is not this ` +
        `tool's call.`,
    )
  }
  if (stats.multiRowKeys > 0) {
    advisories.push(
      `${stats.multiRowKeys} content key(s) name more than one face row here (the same ` +
        `photograph imported twice, or a superseded re-ingest). The import applies the ` +
        `decision to each of them, which is the intended reading.`,
    )
  }
  if (stats.unscaled > 0) {
    advisories.push(
      `${stats.unscaled} face(s) were keyed in decode-space coordinates because their media row ` +
        `records no dimensions — the same fallback the ingest took, so the keys still agree.`,
    )
  }

  // --- people, ordered by their own content -------------------------------
  /** @type {Array<{ personKey: string, displayName: string, keys: string[] }>} */
  const namedPeople = []
  for (const [personKey, keys] of keysByPerson) {
    const displayName = identityNames.get(personKey)
    if (displayName === undefined) {
      // Unreachable while `deriveNotAFaceKey` holds: every unnamed value is
      // either the one sentinel or a refusal above. Kept because the mapping
      // from label value to a real name is the one thing here that must never
      // fall through to a placeholder.
      refusals.push("a labelled person key has no name in identities.json")
      continue
    }
    namedPeople.push({ personKey, displayName, keys })
  }
  const people = assignPersonRefs(
    namedPeople.map((person) => ({ displayName: person.displayName, keys: person.keys })),
  )
  stats.people = people.length

  /** @type {Map<string, string>} content key -> person ref */
  const refByKey = new Map()
  for (const person of people) for (const key of person.keys) refByKey.set(key, person.ref)

  if (refusals.length > 0) return { artifact: null, refusals, advisories, stats }

  /** @type {Types.FaceWorkConfirmation[]} */
  const confirmations = []
  for (const [key, decision] of decisionByKey) {
    if (decision.op === "not_a_face") {
      confirmations.push({ key, op: "not_a_face", personRef: null, provenance: null, ledger: null })
      continue
    }
    confirmations.push({
      key,
      op: "assign",
      personRef: /** @type {string} */ (refByKey.get(key)),
      provenance: LABEL_PROVENANCE,
      // No ledger annotation: these decisions were made in a browser page, not
      // in this database's assignment ledger, so there are no surviving events
      // to summarise and inventing a summary would describe a history nobody
      // can reproduce.
      ledger: null,
    })
  }
  confirmations.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  /** @type {Types.FaceWorkPayload} */
  const payload = {
    formatVersion: FORMAT_VERSION,
    // Read from the target row, not rebuilt from timing.json: equivalence with
    // the ingest the import checks against then holds by construction.
    ingest: ingestToLogical(ingestRow),
    includesPropagated: false,
    people: people.map((person) => ({ ref: person.ref, displayName: person.displayName })),
    confirmations,
  }

  const digest = faceWorkDigest(payload)
  /** @type {Types.FaceWorkArtifact} */
  const artifact = {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    contentSha256: digest,
    // Excluded from the digest, so re-running this converter over unchanged
    // inputs produces the same batch id and the import is a no-op.
    batchId: batchIdForDigest(digest),
    payload,
  }

  return { artifact, refusals, advisories, stats }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * @param {string} file
 * @returns {unknown}
 */
function readJsonFile(file) {
  if (!fs.existsSync(file)) throw new Error(`${file}: not found`)
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

/**
 * @param {string | null} databaseArg
 * @returns {string}
 */
function resolveDbPath(databaseArg) {
  if (databaseArg) return path.resolve(databaseArg)
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH
  return path.join(import.meta.dirname, "..", "..", "data", "wedding.db")
}

/**
 * sha256 → the media row's ORIGINAL dimensions, for every live row that has a
 * content hash. Two live rows sharing a hash and disagreeing about their
 * dimensions would scale one run box two ways, so that is a refusal rather than
 * a last-one-wins.
 * @returns {Map<string, { width: number | null, height: number | null }>}
 */
function loadMediaDimsBySha() {
  /** @type {Array<{ sha256: string, width: number | null, height: number | null }>} */
  const rows = sql`SELECT source_sha256 AS sha256, width, height FROM media
    WHERE deleted_at IS NULL AND source_sha256 IS NOT NULL ORDER BY id`.all()
  /** @type {Map<string, { width: number | null, height: number | null }>} */
  const map = new Map()
  let conflicts = 0
  for (const row of rows) {
    const found = map.get(row.sha256)
    if (found) {
      if (found.width !== row.width || found.height !== row.height) conflicts++
      continue
    }
    map.set(row.sha256, { width: row.width, height: row.height })
  }
  if (conflicts > 0) {
    throw new Error(
      `${conflicts} content hash(es) name more than one media row and those rows disagree about ` +
        `the photograph's dimensions. One run box would scale two ways; resolve the duplicates ` +
        `before converting.`,
    )
  }
  return map
}

/**
 * @param {Types.ConvertLabelsArgs} args
 * @returns {number}
 */
function run(args) {
  // Before the database is opened and before a run file is read: a refused
  // destination should cost nothing, and the file carries people's names.
  const destination = exportDestinationRefusal(args.out)
  if (destination) {
    console.error(`refused: ${destination}`)
    return 1
  }

  const photosRead = readJsonl(path.join(args.runDir, "photos.jsonl"))
  const facesRead = readJsonl(path.join(args.runDir, "faces.jsonl"))
  if (!photosRead.present) throw new Error(`${args.runDir}/photos.jsonl: not found`)
  if (!facesRead.present) throw new Error(`${args.runDir}/faces.jsonl: not found`)
  if (photosRead.skipped > 0 || facesRead.skipped > 0) {
    throw new Error(
      `${photosRead.skipped + facesRead.skipped} unparseable JSONL line(s). labels.json is keyed ` +
        `by run-local face id, so a dropped line shifts nothing but proves the run is ` +
        `incomplete — re-run the batch rather than converting a partial one.`,
    )
  }
  const photos = /** @type {Types.Session1PhotoRecord[]} */ (photosRead.records)
  const faces = /** @type {Types.Session1FaceRecord[]} */ (facesRead.records)

  const labels = /** @type {Types.Session1LabelFile} */ (
    readJsonFile(path.join(args.runDir, "labels.json"))
  )
  if (!labels || typeof labels.labels !== "object") {
    throw new Error("labels.json: no `labels` map in it — not a labels.json?")
  }
  const identitiesFile = /** @type {Types.Session1IdentitiesFile} */ (
    readJsonFile(path.join(args.runDir, "identities.json"))
  )
  if (!identitiesFile || typeof identitiesFile.identities !== "object") {
    throw new Error("identities.json: no `identities` map in it — not an identities.json?")
  }
  if (
    typeof identitiesFile.datasetId === "string" &&
    typeof labels.datasetId === "string" &&
    identitiesFile.datasetId !== labels.datasetId
  ) {
    throw new Error(
      "identities.json and labels.json carry different datasetIds. Person keys are scrambled " +
        "per export, so a sidecar from another export names the wrong people.",
    )
  }
  const identityNames = normaliseIdentityNames(identitiesFile.identities)

  const db = new DatabaseSync(resolveDbPath(args.database), { readOnly: true })
  try {
    useDatabase(db)
    /** @type {import('../../types.js').VisionIngest | undefined} */
    const ingestRow = sql`SELECT * FROM vision_ingests WHERE id = ${args.ingestId}`.get()
    if (!ingestRow) throw new Error(`no vision_ingests row with id ${args.ingestId}`)

    const mediaBySha = loadMediaDimsBySha()
    // The target's own faces, read exactly as the import will read them — same
    // function, same `--faces-from` meaning — so "this key joins" here is the
    // same claim as "this key matches" there.
    const grouped = groupFacesByKey(candidateFaces(ingestRow, args.facesFrom))
    /** @type {Map<string, number>} */
    const targetKeyCounts = new Map()
    for (const [key, rows] of grouped) targetKeyCounts.set(key, rows.length)

    const result = buildFaceWorkFromLabels({
      photos,
      faces,
      labels,
      identityNames,
      ingestRow,
      mediaBySha,
      targetKeyCounts,
    })

    const stats = result.stats
    console.log(`faces in run:           ${stats.facesInRun}`)
    console.log(`labelled:               ${stats.labelled}`)
    console.log(`skipped by labeller:    ${stats.skippedByLabeller}`)
    console.log(`never labelled:         ${stats.unlabelled}`)
    console.log(`target face rows:       ${targetKeyCounts.size} content key(s)`)
    console.log(`assignments:            ${stats.assign}`)
    console.log(`not-a-face verdicts:    ${stats.notAFace}`)
    console.log(`people:                 ${stats.people}`)
    for (const advisory of result.advisories) console.log(`  · ${advisory}`)

    if (!result.artifact) {
      for (const refusal of result.refusals) console.error(`\nrefused: ${refusal}`)
      return 1
    }
    const artifact = result.artifact
    console.log(`content digest:         ${artifact.contentSha256}`)
    console.log(`batch id on import:     ${artifact.batchId}`)

    if (args.dryRun) {
      console.log(`\ndry run — nothing written to ${args.out}`)
      return 0
    }
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
    fs.writeFileSync(args.out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
    console.log(`\nwrote ${args.out}`)
    console.log(
      "This file carries people's names. It is never committed; apply it with " +
        "`export-face-work.js import`, and delete it when the import is done.",
    )
    return 0
  } finally {
    db.close()
  }
}

function main() {
  const parsed = parseConvertLabelsArgs(process.argv.slice(2))
  if (!parsed.valid) {
    process.stderr.write(`${parsed.error}\n`)
    process.exitCode = 1
    return
  }
  process.exitCode = run(parsed.value)
}

// `node scripts/vision/convert-labels-to-face-work.js ...` runs; an `import`
// from a test does not. Same guard as its neighbours.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
