#!/usr/bin/env node
/** @file Join the culling scores into the data file cull.html reads.
 *
 *  Walks the photo directory the way the importer does, hashes every file the way
 *  the importer does, joins cull-scores-macos.swift's rows on relative path, and
 *  groups and suggests with cull-logic.js. Then writes three things beside the
 *  thumbnails: the data, the page, and a classic-script copy of the logic.
 *
 *  What lands in `visible` must be what the importer computes, so nothing here
 *  re-implements that: `scanDirectory`, `sniffFile` and `hashFile` are the importer's
 *  own functions, imported. A sha256 made by any other path is a selection file that
 *  silently hides everything.
 *
 *  A file with no scores is listed anyway. The Swift may not have run, may not have
 *  reached it, or may have failed to decode it, and none of those is a verdict on
 *  the photograph.
 *
 *  The photograph rules apply unchanged (CLAUDE.md): the directory is an argument,
 *  nothing searches, and every output is under a `tmp` directory. The labels and
 *  identities files are read only from explicit arguments. Names reach the page's
 *  data file and nowhere else, and this script never prints one.
 *
 *  No regex: string work here is `split`, `slice`, `startsWith` and `lastIndexOf`.
 */
/** @import * as Types from './types.js' */
/** @import * as LibTypes from '../lib/types.js' */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { scanDirectory } from "../import-media.js"
import { hashFile } from "../lib/import-manifest.js"
import { sniffFile } from "../lib/media-variants.js"

import { NOT_A_FACE, normaliseIdentityNames } from "./convert-labels-to-face-work.js"
import * as logic from "./cull-logic.js"
import { computeDatasetId } from "./dataset-id.js"
import { readJsonl } from "./ingest-faces.js"

const D = logic.CULL_DEFAULTS

const USAGE = `
Usage: node scripts/vision/cull-data.js <photo-dir> [options]

  Build the culling page under --out from the scores cull-scores-macos wrote
  there. A photograph with no scores is still listed. Then open cull.html.

  --out DIR              Output directory, under a tmp directory (default tmp/cull).

  People, all optional. Without them the page works and shows no people panel.
  --labels FILE          A labels.json. Enables the person-coverage warning.
  --identities FILE      Its identities.json. Names, on the local page only.
  --run DIR              The run holding faces.jsonl and photos.jsonl
                         (default: the directory containing --labels).
  --min-good N           Fewer good photos than this reads as "few" (default ${D.minGoodPhotos}).

  Grouping, all optional. See CULL_DEFAULTS in cull-logic.js.
  --burst-gap SECONDS        Same burst within this gap (default ${D.burstGapMs / 1000}).
  --burst-distance D         ...unless frames differ by more than this (default ${D.burstDistance}).
  --similar-window SECONDS   How far apart a retake may be (default ${D.similarWindowMs / 1000}).
  --similar-distance D       What counts as a retake (default ${D.similarDistance}).
  --eye-closed R             Eye openness reading as closed (default ${D.eyeClosedBelow}).
  --good-face-quality Q      Face quality reading as good (default ${D.goodFaceQuality}).
  --help
`

/** Exit codes, matching scripts/vision/session1.js. */
const EXIT = { CLEAN: 0, ABORTED: 2 }

/** The sniff results the importer accepts: IMAGE_SNIFFS and VIDEO_SNIFFS in
 *  scripts/lib/media-variants.js. Anything else, it skips. */
const IMAGE_SNIFFS = new Set(["jpeg", "png", "webp", "heic"])
const VIDEO_SNIFFS = new Set(["mp4", "mov"])

const DATA_FILE = "cull-page-data.js"
const LOGIC_FILE = "cull-logic.classic.js"
const PAGE_FILE = "cull.html"

/**
 * @typedef {object} NumericFlag
 * @property {string} flag
 * @property {keyof Types.CullDefaults} key
 * @property {number} scale
 * @property {boolean} integer
 */

/** @type {NumericFlag[]} */
const NUMERIC_FLAGS = [
  { flag: "min-good", key: "minGoodPhotos", scale: 1, integer: true },
  { flag: "burst-gap", key: "burstGapMs", scale: 1000, integer: false },
  { flag: "burst-distance", key: "burstDistance", scale: 1, integer: false },
  { flag: "similar-window", key: "similarWindowMs", scale: 1000, integer: false },
  { flag: "similar-distance", key: "similarDistance", scale: 1, integer: false },
  { flag: "eye-closed", key: "eyeClosedBelow", scale: 1, integer: false },
  { flag: "good-face-quality", key: "goodFaceQuality", scale: 1, integer: false },
]

const PATH_FLAGS = ["out", "labels", "identities", "run"]

/**
 * Both `--out DIR` and `--out=DIR` are accepted, matching session1.js.
 * @type {Types.parseCullArgs}
 */
export function parseCullArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {}
  /** @type {string[]} */
  const positional = []
  const numericNames = NUMERIC_FLAGS.map((entry) => entry.flag)

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (raw === "--help") return { valid: false, error: USAGE }
    if (!raw.startsWith("--")) {
      positional.push(raw)
      continue
    }
    const body = raw.slice(2)
    const eq = body.indexOf("=")
    const name = eq === -1 ? body : body.slice(0, eq)
    if (!PATH_FLAGS.includes(name) && !numericNames.includes(name)) {
      return { valid: false, error: `Unknown option --${name}` }
    }
    let value = eq === -1 ? null : body.slice(eq + 1)
    if (value === null) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        return { valid: false, error: `--${name} needs a value` }
      }
      value = next
      i++
    }
    if (value.length === 0) return { valid: false, error: `--${name} needs a value` }
    values[name] = value
  }

  if (positional.length !== 1) {
    return {
      valid: false,
      error: `Expected exactly one photo directory; nothing searches for one.\n${USAGE}`,
    }
  }

  /** @type {Types.CullDefaults} */
  const defaults = { ...logic.CULL_DEFAULTS }
  for (const { flag, key, scale, integer } of NUMERIC_FLAGS) {
    if (values[flag] === undefined) continue
    const n = Number(values[flag])
    if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
      return { valid: false, error: `--${flag} needs a non-negative number, got ${values[flag]}` }
    }
    defaults[key] = n * scale
  }

  const outDir = path.resolve(values.out ?? "tmp/cull")
  if (!outDir.split(path.sep).includes("tmp")) {
    return {
      valid: false,
      error:
        "--out must be under a tmp directory: everything derived from a photograph is scratch.",
    }
  }

  if (values.identities !== undefined && values.labels === undefined) {
    return {
      valid: false,
      error: "--identities needs --labels: names attach to people through that file's keys.",
    }
  }
  if (values.run !== undefined && values.labels === undefined) {
    return { valid: false, error: "--run needs --labels." }
  }

  const labels = values.labels === undefined ? null : path.resolve(values.labels)
  return {
    valid: true,
    value: {
      dir: path.resolve(positional[0]),
      outDir,
      labels,
      identities: values.identities === undefined ? null : path.resolve(values.identities),
      run:
        values.run !== undefined ? path.resolve(values.run) : labels ? path.dirname(labels) : null,
      defaults,
    },
  }
}

// --- Reading the scores -------------------------------------------------------

/**
 * `FileManager` and `readdir` can hand back different Unicode forms of one filename,
 * and two forms of "café" are different JavaScript strings. The join key is therefore
 * always NFC. The paths used for anything else stay exactly as the filesystem gave
 * them.
 * @param {string} relative
 * @returns {string}
 */
function joinKey(relative) {
  return relative.normalize("NFC")
}

/**
 * The print as plain numbers, or null for anything malformed. The file is little
 * endian on every Mac that can run the Swift. A truncated print is dropped rather
 * than read short: a distance over part of a vector is a wrong answer that looks
 * like a right one.
 * @type {Types.decodeFeaturePrint}
 */
export function decodeFeaturePrint(print) {
  if (!print || typeof print.b64 !== "string") return null
  const bytes = Buffer.from(print.b64, "base64")
  const width = print.type === "float64" ? 8 : print.type === "float32" ? 4 : 0
  if (width === 0 || bytes.length !== width * print.count) return null
  /** @type {number[]} */
  const values = new Array(print.count)
  for (let i = 0; i < print.count; i++) {
    values[i] = width === 8 ? bytes.readDoubleLE(i * 8) : bytes.readFloatLE(i * 4)
  }
  return values
}

/**
 * The latest row per file, plus the latest meta row. A resumed run appends, so a
 * file rescored after it changed has two rows and the later one is the true one.
 * @type {Types.readScores}
 */
export function readScores(file) {
  /** @type {{ records: Array<Types.CullScoreRow | Types.CullMetaRow>, skipped: number, present: boolean }} */
  const parsed = readJsonl(file)
  /** @type {Map<string, Types.CullScoreRow>} */
  const rows = new Map()
  /** @type {Types.CullMetaRow | null} */
  let meta = null
  for (const row of parsed.records) {
    if (row.kind === "meta") meta = row
    else if (typeof row.rel === "string") rows.set(joinKey(row.rel), row)
  }
  return { rows, meta, skipped: parsed.skipped, present: parsed.present }
}

// --- Assembly ----------------------------------------------------------------

/**
 * @param {number | null} value
 * @returns {number | null}
 */
function round3(value) {
  return value === null ? null : Math.round(value * 1000) / 1000
}

/**
 * The relative directory of a relative path, "" at the top level.
 * @param {string} relative
 * @returns {string}
 */
function folderOf(relative) {
  const slash = relative.lastIndexOf("/")
  return slash === -1 ? "" : relative.slice(0, slash)
}

/** @type {Types.buildPageData} */
export function buildPageData(input) {
  const { files, rows, defaults } = input

  /** @type {Array<Types.CullScoreRow | null>} */
  const rowFor = files.map((file) => {
    // Two copies of one file are one item, but only one of them may have been
    // scored, so the join tries every path that holds these bytes.
    for (const relative of [file.relative, ...file.alsoAt]) {
      const row = rows.get(joinKey(relative))
      if (row) return row
    }
    return null
  })

  /** @type {Types.CullPhotoInput[]} */
  const photos = []
  files.forEach((file, id) => {
    if (file.kind !== "image") return
    const row = rowFor[id]
    photos.push({
      id,
      rel: file.relative,
      folder: folderOf(file.relative),
      t: logic.parseCaptureTime(row?.captured, row?.subsec),
      aesthetics: typeof row?.aesthetics === "number" ? row.aesthetics : null,
      utility: row?.utility === true,
      faces: row?.faces ?? null,
      print: decodeFeaturePrint(row?.featurePrint),
    })
  })
  const { groups, assess } = logic.buildGroups(photos, defaults)
  const photoById = new Map(photos.map((photo) => [photo.id, photo]))
  const liveClips = logic.liveClipPaths(files)

  /** @type {Types.CullPageItem[]} */
  const items = files.map((file, id) => {
    const row = rowFor[id]
    const photo = photoById.get(id)
    const assessed = photo ? assess(id) : null
    return {
      sha: file.sha256,
      kind: file.kind,
      rel: file.relative,
      folder: folderOf(file.relative),
      url: input.toUrl(file.absolute),
      thumb: row?.thumb ?? null,
      preview: row?.preview ?? null,
      w: row?.w ?? null,
      h: row?.h ?? null,
      t: photo ? photo.t : null,
      size: file.size,
      aesthetics: photo ? photo.aesthetics : null,
      score: round3(assessed ? assessed.score : null),
      faces: assessed ? assessed.faces : 0,
      quality: round3(assessed ? assessed.quality : null),
      eyesClosed: assessed ? assessed.eyesClosed : 0,
      flags: assessed ? assessed.flags : [],
      alsoAt: file.alsoAt,
      liveClip: liveClips.has(file.relative),
    }
  })

  /** @type {Map<string, number>} */
  const itemBySha = new Map()
  items.forEach((item, id) => itemBySha.set(item.sha, id))

  return {
    version: 1,
    rootId: input.rootId,
    apis: input.meta?.apis ?? {},
    minGood: defaults.minGoodPhotos,
    items,
    groups,
    videos: items.flatMap((item, id) => (item.kind === "video" ? [id] : [])),
    people: input.people({
      itemForSha: (sha) => itemBySha.get(sha) ?? null,
      scoredFaces: (item) => rowFor[item]?.faces ?? null,
    }),
  }
}

/**
 * The labels, the names and the run they join through. Every path was an explicit
 * argument. Errors name the file and the problem and never its contents.
 * @type {Types.loadPeopleInput}
 */
export function loadPeopleInput(args) {
  if (args.labels === null || args.run === null) return null

  /** @type {Types.Session1LabelFile} */
  const labels = readJsonFile(args.labels)
  if (labels === null || typeof labels !== "object" || typeof labels.labels !== "object") {
    throw new Error(`${args.labels}: not a labels file.`)
  }

  const facesFile = path.join(args.run, "faces.jsonl")
  const photosFile = path.join(args.run, "photos.jsonl")
  const faces = /** @type {{ records: Types.Session1FaceRecord[], present: boolean }} */ (
    readJsonl(facesFile)
  )
  const photos = /** @type {{ records: Types.Session1PhotoRecord[], present: boolean }} */ (
    readJsonl(photosFile)
  )
  if (!faces.present) throw new Error(`${facesFile}: not found. Pass the run with --run.`)
  if (!photos.present) throw new Error(`${photosFile}: not found. Pass the run with --run.`)

  // Face ids are positions in one run's scan. Against another run they join to
  // somebody else's face without any error, so a mismatch is a refusal.
  if (typeof labels.datasetId === "string" && labels.datasetId.length > 0) {
    const actual = computeDatasetId(faces.records)
    if (labels.datasetId !== actual) {
      throw new Error(
        `${args.labels} was made from a different run: its datasetId is ${labels.datasetId}, but ` +
          `${facesFile} hashes to ${actual}.`,
      )
    }
  }

  /** @type {ReadonlyMap<string, string> | null} */
  let names = null
  if (args.identities !== null) {
    /** @type {Types.Session1IdentitiesFile} */
    const identities = readJsonFile(args.identities)
    if (identities === null || typeof identities.identities !== "object") {
      throw new Error(`${args.identities}: not an identities file.`)
    }
    // Person keys are scrambled per export, so an identities file only means anything
    // against the labels.json written alongside it.
    if (
      typeof identities.datasetId === "string" &&
      typeof labels.datasetId === "string" &&
      identities.datasetId !== labels.datasetId
    ) {
      throw new Error(`${args.identities} does not belong to ${args.labels}: datasetIds differ.`)
    }
    names = normaliseIdentityNames(identities.identities)
  }

  return {
    labels: labels.labels,
    notAFace: NOT_A_FACE,
    names,
    faces: faces.records,
    photos: photos.records,
  }
}

/**
 * Parsed, or a thrown error that names the file. JSON.parse's own message is not
 * passed along, because it can quote the text around the failure.
 * @param {string} file
 * @returns {any}
 */
function readJsonFile(file) {
  /** @type {string} */
  let text
  try {
    text = fs.readFileSync(file, "utf8")
  } catch {
    throw new Error(`${file}: could not be read.`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${file}: not valid JSON.`)
  }
}

/**
 * cull-logic.js as a classic script. cull.html is opened over file://, where every
 * browser refuses to load an ES module, and writing the logic twice would mean the
 * page runs code the tests never saw. So the page loads this same source with the
 * `export` keywords removed, exposed as `window.CullLogic`.
 *
 * Anything this transform cannot handle is an error here, not a page that fails to
 * load on the one evening it is needed.
 * @type {Types.classicScript}
 */
export function classicScript(source, names) {
  const lines = source.split("\n").map((line) => {
    if (line.startsWith("export function ")) return line.slice("export ".length)
    if (line.startsWith("export const ")) return line.slice("export ".length)
    if (line.startsWith("export ") || line.startsWith("import ")) {
      throw new Error(`cull-logic.js: cannot make a classic script from: ${line}`)
    }
    return line
  })
  return (
    "(function () {\n" +
    lines.join("\n") +
    `\nwindow.CullLogic = { ${names.join(", ")} }\n})()\n`
  )
}

/**
 * @param {string} file
 * @param {string} text
 */
function writeAtomic(file, text) {
  // Temp file then rename: a half-written data file is a page that will not load.
  const temp = file + ".tmp"
  fs.writeFileSync(temp, text)
  fs.renameSync(temp, file)
}

/**
 * @param {LibTypes.ScannedFile[]} scanned
 * @returns {{ media: Array<LibTypes.ScannedFile & { kind: "image" | "video" }>, skipped: number }}
 */
function classify(scanned) {
  /** @type {Array<LibTypes.ScannedFile & { kind: "image" | "video" }>} */
  const media = []
  let skipped = 0
  for (const file of scanned) {
    /** @type {string} */
    let sniffed = ""
    try {
      sniffed = sniffFile(file.absolute)
    } catch {
      // Unreadable: the importer could not take it either.
    }
    if (IMAGE_SNIFFS.has(sniffed)) media.push({ ...file, kind: "image" })
    else if (VIDEO_SNIFFS.has(sniffed)) media.push({ ...file, kind: "video" })
    else skipped++
  }
  return { media, skipped }
}

/** @type {Types.runCullData} */
export async function runCullData(args, deps = {}) {
  const log = deps.log ?? ((line) => process.stdout.write(line + "\n"))
  const hash = deps.hashFile ?? hashFile

  if (!fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
    throw new Error(`Not a directory: ${args.dir}`)
  }
  fs.mkdirSync(args.outDir, { recursive: true })
  const root = fs.realpathSync(args.dir)

  // Recursive, so that a folder of originals is covered whichever way the importer
  // is run. A hash in `visible` that the importer never sees costs nothing.
  const { media, skipped } = classify(scanDirectory(args.dir, { recursive: true }))
  if (media.length === 0) throw new Error(`No photographs or videos under ${args.dir}.`)

  /** @type {Types.CullHashedFile[]} */
  const hashed = new Array(media.length)
  let next = 0
  await Promise.all(
    new Array(Math.min(4, media.length)).fill(null).map(async () => {
      while (next < media.length) {
        const index = next++
        const file = media[index]
        hashed[index] = {
          absolute: file.absolute,
          relative: file.relative,
          kind: file.kind,
          size: fs.statSync(file.absolute).size,
          sha256: await hash(file.absolute),
        }
      }
    }),
  )

  const scores = readScores(path.join(args.outDir, "scores.jsonl"))
  if (!scores.present) {
    log("! No scores.jsonl yet: every photograph will be listed unscored, with no suggestions")
    log("  based on scores. Run cull-scores-macos first if that is not what you meant.")
  }
  if (scores.skipped > 0) {
    log(`! Skipped ${scores.skipped} unparseable line(s) in scores.jsonl: was the run interrupted?`)
  }
  if (scores.meta && scores.meta.root.normalize("NFC") !== root.normalize("NFC")) {
    log("! scores.jsonl was written for a different directory, so only matching paths will join.")
  }
  for (const [name, api] of Object.entries(scores.meta?.apis ?? {})) {
    if (!api.available) {
      log(`! ${name} was unavailable when scoring: ${api.note ?? "no reason given"}`)
    }
  }

  const peopleInput = loadPeopleInput(args)
  const data = buildPageData({
    files: logic.dedupeByHash(hashed),
    rows: scores.rows,
    meta: scores.meta,
    rootId: crypto
      .createHash("sha256")
      .update(root.normalize("NFC"), "utf8")
      .digest("hex")
      .slice(0, 16),
    defaults: args.defaults,
    toUrl: (absolute) => pathToFileURL(absolute).href,
    people: (context) =>
      peopleInput ? logic.buildPeople({ ...peopleInput, ...context }, args.defaults) : null,
  })

  const target = path.join(args.outDir, PAGE_FILE)
  // A script tag, not a fetch: the page is opened over file://, where fetch is refused.
  writeAtomic(
    path.join(args.outDir, DATA_FILE),
    "window.CULL_DATA = " + JSON.stringify(data) + "\n",
  )
  writeAtomic(
    path.join(args.outDir, LOGIC_FILE),
    classicScript(
      fs.readFileSync(path.join(import.meta.dirname, "cull-logic.js"), "utf8"),
      Object.keys(logic),
    ),
  )
  fs.copyFileSync(path.join(import.meta.dirname, PAGE_FILE), target)

  // Counts only, and never a name: this is the one part of the tool that prints.
  log("")
  log(`${data.items.length - data.videos.length} photograph(s), ${data.videos.length} video(s).`)
  log(`${data.groups.length} group(s) to review. ${skipped} other file(s) ignored.`)
  log(data.people ? "Labels joined: the page will warn about person coverage." : "No labels given.")
  log(`Open ${pathToFileURL(target).href}`)
  log("Everything under that directory is derived from photographs. Delete it when done.")

  return { data, skipped, target }
}

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const parsed = parseCullArgs(argv)
  if (!parsed.valid) {
    process.stderr.write(parsed.error + "\n")
    return EXIT.ABORTED
  }
  try {
    await runCullData(parsed.value)
    return EXIT.CLEAN
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n")
    return EXIT.ABORTED
  }
}

// `node scripts/vision/cull-data.js ...` runs; `import` from a test does not.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2))
}
