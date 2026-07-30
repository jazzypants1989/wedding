/**
 * Type declarations for the vision lab's Node-side tooling (scripts/vision/).
 * Nothing here is served or reachable from the request path.
 *
 * The pure pipeline modules live in public/vision/ and declare their own types
 * in public/vision/types.d.ts — they may not import node:*, so the split is not
 * organisational tidiness, it is the constraint that keeps one implementation
 * usable in both venues.
 */
import type { ImageBackend, MediaBackends, RgbImage } from "../lib/types.js"
import type {
  DescriptorSet,
  Detection,
  GateSignals,
  GroupingReport,
  SeparationReport,
} from "../../public/vision/types.js"

// --- Pixel source (scripts/vision/pixels-cli.js) ---

export interface ReadPixelsOptions {
  /** Longest output edge in pixels. Never upscales. */
  maxEdge: number
  /** Where per-file scratch directories are created. Under tmp/. */
  scratchDir: string
  timeoutMs?: number
}

/**
 * Parse a binary (P6) PPM. Throws MediaImportError rather than returning null:
 * a malformed buffer here means the backend misbehaved, which is a per-file
 * failure the importer's error taxonomy already knows how to report.
 *
 * The returned `rgb` is a VIEW into `buf`, not a copy.
 */
export function parsePpm(buf: Buffer, context?: { file?: string }): RgbImage

/** Decode one photograph to RGB at maxEdge, orientation applied. */
export function readPixels(
  backend: ImageBackend,
  sourcePath: string,
  options: ReadPixelsOptions,
): Promise<RgbImage>

/**
 * Area-average downsample, in memory. Returns the ACTUAL scale achieved, which
 * rounding makes slightly different from maxEdge/longest — decoded boxes are
 * mapped back to source pixels with it.
 */
export function boxDownsample(
  image: RgbImage,
  maxEdge: number,
): { image: RgbImage; scale: number }

// --- PNG writer (scripts/vision/png-write.js) ---

/**
 * Encode tightly packed RGB as a PNG. node:zlib and a CRC table, nothing else —
 * the crops have to be viewable in a browser and no other stage of this project
 * needs an encoder, so this is a few dozen lines rather than a dependency or a
 * second subprocess per crop.
 */
export function encodePng(image: RgbImage): Buffer

export function writePng(image: RgbImage, filePath: string): void

// --- Weight verification (scripts/vision/verify-weights.js) ---

export interface PinnedWeight {
  /** Filename as it must appear in the weights directory. */
  name: string
  bytes: number
  sha256: string
  /** Licence identifier, as read from the distributing repo's LICENSE file. */
  licence: string
  /** What it is, for the report line. */
  role: string
  /**
   * The LFS media host, pinned to a commit. `raw.githubusercontent.com` returns
   * a 131-byte pointer file for these, which is why `lfs-pointer` is a status.
   * Recorded here rather than only in the ledger because this table is what
   * tier 2's fetch-weights.js grows out of.
   */
  url: string
}

export interface WeightCheck {
  name: string
  status: "ok" | "missing" | "mismatch" | "lfs-pointer"
  detail: string
}

export function verifyWeights(dir: string): Promise<WeightCheck[]>

// --- The borrowed engine (tmp/rig/engine.mjs) ---

/**
 * What `tmp/rig/engine.mjs` must expose. It is the ONE seam where third-party
 * code enters this pipeline, and the seam is a runtime `import()` of a path
 * given on the command line — deliberately not a static import, so that nothing
 * in the repository depends on it, `npm test` passes with `tmp/` deleted, and
 * the dependency graph says what CLAUDE.md and SPEC §2.1 say it says.
 *
 * Everything on either side of this interface is first-party. Swapping the
 * borrowed runtime for hand-written kernels is implementing this interface
 * again, and nothing else.
 */
export interface VisionEngine {
  /**
   * Faces in the frame of the image passed in — no rescaling, no inverse
   * transform. The caller downsampled and the caller maps back.
   */
  detect(image: RgbImage, options: DetectOptions): Promise<Detection[]>
  /** L2-normalised descriptor for one aligned 112×112 crop. */
  describe(crop: RgbImage): Promise<Float32Array>
  /** Free sessions. Optional — a run that omits it must still exit. */
  close?(): Promise<void>
  /** Runtime and model identification, recorded in timing.json. */
  info(): { runtime: string; detector: string; embedder: string }
}

export interface DetectOptions {
  scoreThreshold: number
  nmsIou: number
  topK: number
  /** Pad bottom and right to a multiple of this. YuNet requires 32. */
  divisor: number
}

/**
 * What the engine's factory needs to construct itself. The weights are not
 * bundled with the engine — they are fetched and hash-pinned separately (SPEC
 * §3) — so the directory holding them is always passed in, never discovered.
 */
export interface LoadEngineOptions {
  weightsDir: string
  detectorFile?: string
  embedderFile?: string
}

/**
 * Dynamic-import an engine module and check it satisfies the interface before
 * a long run discovers it does not. Throws with the path in the message.
 *
 * The dynamic import IS the seam: nothing in the repository statically
 * references the borrowed runtime, so the dependency graph stays honest and
 * `npm test` passes with `tmp/` deleted (CLAUDE.md; SPEC §2.1).
 */
export function loadEngine(
  specifier: string,
  options?: LoadEngineOptions,
): Promise<VisionEngine>

// --- The batch (scripts/vision/session1.js) ---

/**
 * One line of `tmp/session1/photos.jsonl`.
 *
 * Paths are stored RELATIVE to the scanned root. tmp/ is scratch and gitignored
 * so this is permitted, but there is no reason to write an absolute path into a
 * file when the run does not need one.
 */
export interface Session1PhotoRecord {
  /** Index in scan order. Stable within a run; the join key for faces.jsonl. */
  id: number
  relative: string
  /** Raw file bytes, via hashFile in scripts/lib/import-manifest.js. */
  sha256: string
  /** Level two: averageHash of the decoded buffer. */
  aHash: string
  /** Dimensions of the decoded source buffer, not of the file. */
  width: number
  height: number
  /** EXIF capture time in epoch ms, via planMediaFile. Null when absent. */
  capturedAtMs: number | null
  mtimeMs: number
  /** Detections kept after IoU dedup. */
  faces: number
  /** First photo id with an identical sha256, else null. */
  exactDuplicateOf: number | null
  /** First photo id within `nearDuplicateBits`, else null. Recorded, not dropped. */
  nearDuplicateOf: number | null
  ms: { decode: number; downsample: number; detect: number; align: number; describe: number }
}

/**
 * One line of `tmp/session1/faces.jsonl`. `id` is the row index into the
 * descriptor set every metrics function takes.
 */
export interface Session1FaceRecord {
  id: number
  photoId: number
  /** Relative to the output directory, e.g. "crops/000123.png". */
  crop: string
  score: number
  /** Source-buffer pixels. */
  box: { x: number; y: number; w: number; h: number }
  /** Flat [x0,y0,...], source-buffer pixels. */
  landmarks: number[]
  /**
   * Every signal, unthresholded. The gate SCORES here and DECIDES in the
   * report, because SPEC §6.2 requires cutoffs be derived from the input's own
   * distribution — which a filtering batch cannot know before it runs.
   */
  signals: GateSignals
  /** 128 floats, L2-normalised, rounded for file size. */
  descriptor: number[]
  /** Present only under --mirror-tta: the mirror-averaged descriptor. */
  mirrorDescriptor?: number[]
}

/**
 * One line of `tmp/session1/resolution.jsonl` — the subsample detected at both
 * resolutions, so "detect at 1280" is a checked choice rather than an assumed
 * one. Report E consumes it.
 */
export interface Session1ResolutionRecord {
  photoId: number
  atDetectEdge: number
  atSourceEdge: number
  /** Best IoU found in the source-edge set for each detect-edge box. */
  matchedIou: number[]
}

/**
 * One line of `tmp/session1/failures.jsonl`. A per-file failure is recorded and
 * skipped, never fatal — a run over thousands of photographs must not die on
 * one unreadable file, and the count of what was lost is part of the cost
 * report. `code` is a `MediaImportErrorCode`.
 */
export interface Session1FailureRecord {
  file: string
  code: string
  message: string
}

/** `tmp/session1/timing.json`. */
export interface Session1Timing {
  photos: number
  faces: number
  /** Wall-clock ms and call count per stage, summed over the run. */
  stages: Record<string, { ms: number; n: number }>
  /** Backend version line, engine info, node version. */
  environment: Record<string, string>
  /**
   * The tunables the run actually used, so a report can be read months later.
   *
   * Open-ended, because the batch writes whatever it was configured with and a
   * closed shape would make adding a knob a two-file change. The three named
   * below are the ones a CONSUMER reads back rather than displays: the report
   * prices a resolution change against the edge the run actually used, and
   * quoting the current default instead would price the wrong trade.
   */
  config: {
    detectEdge?: number
    sourceEdge?: number
    nearDuplicateBits?: number
  } & Record<string, unknown>
}

/**
 * `tmp/session1/label-data.js`, assigned to `window.SESSION1_DATA` — a script
 * tag, not a fetch, because label.html is opened over file:// where fetch is
 * blocked and there is deliberately no server.
 */
export interface Session1LabelData {
  /**
   * 1 as session1.js writes it; 2 once scripts/vision/relabel-data.js has
   * regenerated it. Every field marked "version 2" below is optional for that
   * reason and for that reason only — a v2 file has all of them.
   */
  version: number
  /**
   * Version 2. Sixteen lowercase hex characters: sha256 over every face's id,
   * photo id and box. It identifies the DATA, which the thing it replaced did
   * not — the v1 fingerprint was a function of the face COUNT alone, so two
   * entirely different runs that happened to find the same number of faces were
   * indistinguishable, and a labels.json could be joined to the wrong run with
   * every id landing on somebody else's face and nothing said.
   *
   * Copied verbatim into labels.json so the report can refuse a mismatch.
   */
  datasetId?: string
  faces: Array<{
    id: number
    crop: string
    /**
     * Version 2. A wider crop of the same face — hair, clothing, neighbours —
     * written by scripts/vision/context-crops.js. The tight aligned crop is what
     * the recogniser sees and is often not enough for a human to tell two
     * similar-looking guests apart.
     *
     * The KEY IS OMITTED when there is no such file, rather than set to null:
     * the page offers the wider view by asking whether the key is present, and a
     * null would be an offer of a file that was never written.
     */
    context?: string
    photoId: number
    /** Report A's headline number comes from pool A only. */
    pool: "A" | "B"
    /** Pool B's grouping, at a tight cutoff. Null for pool A and for singletons. */
    group: number | null
  }>
  /**
   * Version 2. Indexed BY photo id — `photos[face.photoId]` is that face's
   * photograph — with one entry for every photograph in the run including the
   * ones with no faces, so the index stays aligned. relabel-data.js asserts the
   * ids really are 0..n-1 rather than assuming it.
   *
   * It exists so the labelling page can say "same shot" and "same evening"
   * without shipping photos.jsonl, which carries hashes and file paths the page
   * has no use for.
   */
  photos?: Array<{
    /** capturedAtMs, or null where EXIF had no usable date. */
    t: number | null
    /**
     * The duplicate-class ROOT photo id, by union-find over the exact and near
     * duplicate pointers — the same transitive closure `frameRoots` computes for
     * the report. Two photographs with the same `frame` are the same shot.
     */
    frame: number
  }>
  /**
   * Version 2, and only when asked for with --roster. Autocomplete for the
   * optional identities file; never written to labels.json, which stays opaque
   * `p<n>` keys because the measurement only needs "same person or not".
   *
   * The key is omitted entirely when the guests table is unavailable or empty —
   * an empty array would read as "there are no guests" rather than "no roster
   * was loaded".
   */
  roster?: Array<{ id: number; name: string }>
  /**
   * Presentation order, fixed and shuffled. Cherry-picking easy frontal crops
   * produces a flattering number and a wrong decision, so the order is not the
   * labeller's to choose.
   */
  order: number[]
}

/**
 * `tmp/session1/contact-data.js`, assigned to `window.SESSION1_CONTACT`. Feeds
 * the contact sheet — the eyeball pass SESSION-1 §2 puts BEFORE labelling.
 *
 * It exists to catch one bug cheaply: a mirrored or rotated crop looks entirely
 * plausible on its own and quietly degrades every match afterwards. Sorting by
 * `residual` descending puts the most likely mirrors first, so the check is a
 * glance at the top of a sorted list rather than a scroll through everything.
 */
export interface Session1ContactData {
  version: number
  faces: Array<{
    id: number
    crop: string
    photoId: number
    score: number
    /** The mirror detector. Reflection is excluded from the transform family. */
    residual: number
    eyeRatio: number
    eyeAngle: number
    sharpness: number
    boxPx: number
    /**
     * Distance from the box to the nearest image edge; negative when it runs
     * off. Carried so the sheet can evaluate ALL of the gate's checks — without
     * it, a face rejected only for clipping the frame renders as a keep, which
     * is the one failure a check-the-rejects pass cannot afford.
     */
    borderPx: number
    alignScale: number
    outsideFraction: number
  }>
  /** The gate cutoffs in force, so the sheet can show what WOULD be rejected. */
  cutoffs: Record<string, number>
}

/** `tmp/session1/labels.json`, written by label.html, read by the report. */
export interface Session1LabelFile {
  version: number
  /**
   * Face id (as a string key) → opaque person key, "p1", "p2"… or "x" for
   * not-a-face. Skipped faces are absent. Opaque, not guest names: the
   * measurement only needs "same person or not", so no roster is queried and no
   * real name is written to tmp/.
   */
  labels: Record<string, string>
  /** Face id → the pool it was sampled into. Mirrors Session1LabelData. */
  pool: Record<string, "A" | "B">
  /**
   * Version 2. Copied from Session1LabelData so a labels.json can be refused
   * against the run it was not made from. Optional because a version-1 file
   * predates it and must keep loading unchanged.
   */
  datasetId?: string
  /**
   * Version 2. Face id → the model's group id, or null. Copied from
   * Session1LabelData rather than recomputed, so it is what the labeller was
   * actually shown. Unlocks the over-split rate (how many merge clicks one
   * person cost) and what the shipped cutoff welded together.
   */
  group?: Record<string, number | null>
  /**
   * Version 2. Face ids the labeller explicitly refused, ascending. The
   * distinction it records — "I looked and could not tell" versus "never
   * reached" — is the only way to detect the failure the spec worries about,
   * where a session's number is flattering because only the easy crops were
   * labelled.
   */
  skipped?: number[]
  /**
   * Version 2. Group id → face ids the labeller carved OUT of that group. A
   * purity judgement made during labelling and, before this, thrown away.
   * Groups with no exclusions are omitted.
   */
  excluded?: Record<string, number[]>
}

export interface Session1Args {
  dir: string
  outDir: string
  enginePath: string
  weightsDir: string
  detectEdge: number
  sourceEdge: number
  recursive: boolean
  mirrorTta: boolean
  /** Photographs to also detect at sourceEdge for the resolution comparison. */
  resolutionSample: number
  limit: number | null
  poolASize: number
}

// --- Context crops (scripts/vision/context-crops.js) ---

/** An integer pixel rectangle inside a decoded buffer. */
export interface PixelRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Parsed argv. `dir` is the photograph directory and is always typed on the
 * command line (CLAUDE.md; SPEC §15 r1) — nothing here searches for images.
 * `runDir` is an existing session-1 run, whose faces.jsonl supplies the ids and
 * boxes. The detector is never called, because re-detecting would renumber the
 * faces and face ids are the join key for every label already collected.
 */
export interface ContextCropArgs {
  dir: string
  runDir: string
  /** Box expansion factor about its centre. 1 would be the tight crop again. */
  margin: number
  /** Output long edge. Never upsampled — a small face stays its own size. */
  size: number
  /** Photographs to stop after, counting only those with faces. Null for all. */
  limit: number | null
}

export interface ContextCropResult {
  exitCode: number
  photos: number
  written: number
  /**
   * Photographs whose decode came back a pixel or two off the size the run
   * recorded, and whose boxes were scaled to match. See `resolveScale`.
   */
  rescaled: number
  failures: Session1FailureRecord[]
}

/**
 * The context crop's path relative to the run directory, with the SAME
 * six-digit zero-padded id `cropName` uses in session1.js. One definition, which
 * relabel-data.js imports: a producer and a consumer that disagree about this
 * filename yield a labelling page pointing at images nobody wrote.
 */
export function contextName(id: number): string

/**
 * The detected box expanded about its own centre and clamped to the image.
 * Clamped rather than shifted — a face at the edge of the frame stays at the
 * edge of its context crop, because moving it inwards would show the labeller a
 * composition the photograph does not have.
 */
export function expandBox(
  box: { x: number; y: number; w: number; h: number },
  margin: number,
  width: number,
  height: number,
): PixelRect

/** Copy a rectangle out of an RGB buffer. Throws if it is not inside the image. */
export function cropRegion(image: RgbImage, rect: PixelRect): RgbImage

/**
 * How to map a box recorded in faces.jsonl onto the buffer just decoded.
 *
 * Boxes are in the pixels of the buffer the RUN decoded, so a backend that
 * rounds its resize differently puts them a pixel or two out — harmless, and
 * rescaled. A LARGE difference is not rounding: it means a different decode, and
 * the likeliest is an orientation disagreement between backends (media-variants
 * records one HEIC where vips and magick report 1600x2400 and sips 2400x1600).
 * Rescaling through that produces a confident crop of the wrong region, so it
 * refuses instead — a context crop of the wrong person is worse than a missing
 * one, because the labeller cannot tell.
 */
export function resolveScale(
  decoded: { width: number; height: number },
  recorded: { width: number; height: number },
): { ok: true; sx: number; sy: number } | { ok: false; reason: string }

/**
 * The `--source-edge` the run actually used, from timing.json. Not a default and
 * not a flag: every box in faces.jsonl is expressed in the pixels of a buffer
 * decoded at this value, so guessing it produces crops that are wrong by the
 * ratio of two constants and look entirely plausible. Throws when absent.
 */
export function readSourceEdge(runDir: string): number

export function runContextCrops(
  args: ContextCropArgs,
  deps?: {
    backends?: MediaBackends
    readPixels?: typeof readPixels
    writePng?: typeof writePng
    log?: (line: string) => void
  },
): Promise<ContextCropResult>

// --- Regenerating label-data.js (scripts/vision/relabel-data.js) ---

/**
 * Parsed argv. `dir` is an existing run directory; nothing is re-detected and no
 * photograph is read, so no photograph directory is needed or accepted.
 */
export interface RelabelArgs {
  dir: string
  /** Read guest names for the labelling page's autocomplete. Off by default. */
  roster: boolean
  /** Only consulted with `roster`. Opened READ-ONLY. */
  databasePath: string
  /** Reference context crops where they exist. `--no-context` turns it off. */
  context: boolean
}

/**
 * Pool, group and presentation order for every face.
 *
 * These are CARRIED OVER from the previous label-data.js, never re-shuffled.
 * Pool A is a uniform sample and the only pool report A's headline number may be
 * computed from; re-drawing it would move faces between the pools, invalidating
 * labels already collected and the honesty of the number they support.
 */
export interface PoolAssignments {
  pools: Map<number, { pool: "A" | "B"; group: number | null }>
  order: number[]
}

/**
 * Names are never written to labels.json — the measurement only needs "same
 * person or not". They feed autocomplete for the separate, opt-in identities
 * file. `ok: false` carries a reason to print, and the roster key is then
 * omitted from label-data.js entirely rather than written empty.
 */
export type RosterResult =
  | { ok: true; roster: Array<{ id: number; name: string }> }
  | { ok: false; reason: string }

export interface BuildLabelDataInput {
  faces: readonly Session1FaceRecord[]
  photos: readonly Session1PhotoRecord[]
  assignments: PoolAssignments
  /** True when a context crop for this face id exists on disk. */
  hasContext: (id: number) => boolean
  roster: Array<{ id: number; name: string }> | null
}

export interface RelabelResult {
  exitCode: number
  data: Session1LabelData
  poolA: number
  poolB: number
  /** False when there was no previous file and the pools were re-derived. */
  carried: boolean
  contextCrops: number
  /** Null when no roster was included. */
  rosterSize: number | null
}

/**
 * sha256 over the newline-joined `<id>:<photoId>:<x>,<y>,<w>,<h>` of every face,
 * boxes at two decimal places, truncated to 16 hex characters. See
 * `Session1LabelData.datasetId` for what it replaced and why.
 */
export function computeDatasetId(faces: readonly Session1FaceRecord[]): string

/**
 * The positional photo index — capture time and duplicate-frame root, one entry
 * per photograph. Asserts that photo ids are exactly 0..n-1 rather than assuming
 * it: an interrupted or `--limit`ed run is where that could stop being true, and
 * a misaligned index shows the labeller one photograph's time beside another
 * photograph's face, which is a wrong answer that looks like a right one.
 */
export function buildPhotoIndex(
  photos: readonly Session1PhotoRecord[],
): Array<{ t: number | null; frame: number }>

/**
 * The existing label-data.js, parsed back out of its `window.SESSION1_DATA = `
 * assignment, or null when there is none.
 */
export function readPreviousLabelData(dir: string): Session1LabelData | null

/**
 * Pools and order lifted from a previous label-data.js and checked against the
 * faces the run recorded. Every check is a refusal to guess: a face with no
 * previous assignment cannot be given one, because dropping it would shrink the
 * labelling set and inventing a pool for it would put a face into pool A that
 * the uniform sample never drew.
 */
export function carryAssignments(
  faces: readonly Session1FaceRecord[],
  previous: Session1LabelData,
): PoolAssignments

/**
 * The fallback for a run with no label-data.js at all: the same seeded sampling
 * the batch did, from the seed and pool size timing.json recorded. Correct only
 * if the run's configuration is what timing.json says it is, which is why the
 * caller says so out loud. Carrying is always preferred.
 */
export function derivedAssignments(
  faces: readonly Session1FaceRecord[],
  timing: Session1Timing | null,
): PoolAssignments

/**
 * Live guests, READ-ONLY, and deliberately not through db/connection.js — that
 * module creates tables and runs migrations on connect, which is not something a
 * scratch tool pointed at a production database may do.
 */
export function readRoster(databasePath: string): RosterResult

export function buildLabelData(input: BuildLabelDataInput): Session1LabelData

/**
 * Temp file then rename, because rename is atomic within a directory. A
 * half-written label-data.js is a labelling page that will not load, and the
 * person holding it is the least equipped to work out why.
 */
export function writeLabelData(file: string, data: Session1LabelData): void

export function runRelabel(
  args: RelabelArgs,
  deps?: {
    log?: (line: string) => void
    readRoster?: (databasePath: string) => RosterResult
  },
): Promise<RelabelResult>

// --- The report (scripts/vision/session1-report.js) ---

/** One face as the report holds it: the two jsonl files joined. */
export interface LoadedRun {
  photos: Session1PhotoRecord[]
  faces: Session1FaceRecord[]
  labels: Session1LabelFile | null
  timing: Session1Timing | null
  resolution: Session1ResolutionRecord[]
}

/** A line of the oracle's JSONL, as scripts/vision/oracle-macos.swift emits it. */
export interface OracleRecord {
  path: string
  w: number
  h: number
  ms: number
  faces: Array<{
    x: number
    y: number
    w: number
    h: number
    roll?: number
    yaw?: number
    pitch?: number
    quality?: number
    points?: number
    leftEye?: [number, number]
    rightEye?: [number, number]
  }>
  error?: string
}

export function loadRun(dir: string): LoadedRun

/**
 * A subset of the run's faces, packed into the shape every metrics function
 * takes, with the per-face context the strata need beside it.
 *
 * It exists because `pairDistances` deliberately knows nothing about
 * photographs, duplicate frames or clocks — it takes descriptors and a
 * `keep(i, j)` predicate, and that predicate needs somewhere to look up what
 * row `i` was. Every array below is parallel and indexed BY ROW, which is the
 * index the predicate receives; face ids are data, not positions.
 */
export interface FaceView {
  set: DescriptorSet
  /** Opaque person key, or null for unlabelled and for not-a-face. */
  labels: Array<string | null>
  faceIds: number[]
  photoIds: number[]
  /** EXIF capture time, epoch ms. Null drops the row out of every time stratum. */
  times: Array<number | null>
  /** Duplicate-frame equivalence class id, by union-find over the photo links. */
  frames: number[]
  records: Session1FaceRecord[]
  /** True when labels.json carried no pool map and everything was read as pool A. */
  poolAssumed: boolean
}

/** Which faces `buildView` packs, and which descriptor it takes from each. */
export interface ViewOptions {
  /**
   * Report A's headline is pool A only: pool B was labelled with the model's own
   * grouping as an assist, so its coverage is conditioned on what the model
   * already found. Fine for volume in reports B and C, disqualifying in A.
   */
  pool?: "A" | "B" | null
  /** Prefer `mirrorDescriptor` where the run recorded one. */
  mirror?: boolean
  requireLabel?: boolean
  include?: (face: Session1FaceRecord) => boolean
}

/**
 * One stratum of report A, as a `keep(i, j)` predicate over FaceView rows.
 *
 * Everything that makes report A honest lives in these predicates. Two frames
 * from one burst produce two near-identical descriptors, so a same-person pair
 * drawn from them measures the shutter rather than the recogniser — which is
 * where every flattering number this project could accidentally produce comes
 * from. `honest` marks the one stratum that may be quoted.
 */
export interface StratumSpec {
  key: string
  title: string
  note: string
  honest: boolean
  /** Null means "every pair", which is the unfiltered row shown for contrast. */
  keep: ((i: number, j: number) => boolean) | null
}

/** A StratumSpec with its separation measured. */
export interface StratumReport {
  key: string
  title: string
  note: string
  honest: boolean
  report: SeparationReport
}

/**
 * One point of report B's cutoff sweep.
 *
 * ⚠ Each point must be computed on its OWN copy of the distance matrix.
 * `groupFaces` runs Lance-Williams in place on `options.matrix`, so a sweep that
 * reuses one matrix computes every point after the first on data the previous
 * point rewrote. It runs, it terminates, and the curve is plausible garbage.
 */
export interface SweepPoint {
  cutoff: number
  cannotLink: boolean
  quality: GroupingReport
}

/**
 * One point of report D's per-axis sweep: what a single gate cutoff keeps, and
 * what the two headline numbers do at it.
 *
 * Both numbers are carried because either alone can be gamed by a gate — one
 * that lifts AUC while destroying rank-1 has thrown away the people the feature
 * is for. `value` is NaN on the rows that are whole configurations rather than
 * points on one axis (no gate, the default gate, the joint result).
 */
export interface GateSweepPoint {
  value: number
  kept: number
  /** Labelled faces, always. Mixing denominators makes a ratio that means nothing. */
  total: number
  auc: number
  rank1: number
}

/**
 * One gate cutoff, swept with every OTHER check held wide open.
 *
 * Wide open is the only way to measure one cutoff's own contribution — sweeping
 * it inside the full default gate measures the interaction instead. The cost of
 * that choice is that each axis is a measurement of a different configuration,
 * which is what `JointGate` exists to answer for.
 */
export interface GateSweepKey {
  key: string
  /** The recorded signal this cutoff thresholds. */
  signal: string
  direction: "min" | "max"
  defaultValue: number
  /** `points[0]` is always the wide-open end, and the baseline for the deltas. */
  points: GateSweepPoint[]
}

/**
 * One line of report D's summary: what a check bought ON ITS OWN, which is all
 * an isolated sweep can tell you. `candidate` is null when nothing on the axis
 * beat leaving it wide open; it can also equal `defaultValue`, which means the
 * sweep's winner is the shipped value and there is no change to recommend.
 */
export interface GateAxisVerdict {
  key: string
  defaultValue: number
  candidate: number | null
  /** The best point's cutoff, worth adopting or not. */
  bestValue: number
  /** Against the wide-open end of this axis, not against the default gate. */
  deltaAuc: number
  deltaRank1: number
  kept: number
  total: number
  /** AUC + rank-1 improvement over wide open; the greedy pass's ordering. */
  gain: number
  verdict: "worth it" | "no measurable benefit"
}

/**
 * The recommendation, MEASURED.
 *
 * ⚠ This type exists because of a bug that is very easy to have. Nine cutoffs
 * swept one at a time are nine measurements of nine DIFFERENT configurations,
 * and printing the winner of each as a block to paste into the defaults table
 * recommends a tenth that nobody ran — whose intersection can keep a small
 * fraction of what any one of them keeps alone, and can be strictly worse than
 * changing nothing.
 *
 * So `naive` is that set actually applied, and `result` is what a greedy pass
 * starting FROM THE SHIPPED DEFAULTS settled on. Starting there is what makes
 * "never worse than doing nothing" a property of the algorithm rather than a
 * check bolted on afterwards: the fallback is reached by adopting nothing.
 */
export interface JointGate {
  /** What is recommended. Every gate.* value in the report comes from here. */
  cutoffs: Record<string, number>
  /** What `cutoffs` keeps and scores, applied as one gate. */
  result: GateSweepPoint
  /** Every isolated winner taken together — the set that was never evaluated. */
  naiveCutoffs: Record<string, number>
  /** What THAT set keeps and scores. Reported so the trap is visible, not hidden. */
  naive: GateSweepPoint
  adopted: string[]
  /** Helped alone and earned nothing on top of the rest. A finding, not silence. */
  rejected: string[]
  /** Fewest labelled faces a candidate may keep and still be a measurement. */
  floor: number
  verdicts: GateAxisVerdict[]
}

/**
 * One fold of the held-out gate estimate: cutoffs chosen with this fold's people
 * hidden, scored on those people alone.
 *
 * `samePairs`/`diffPairs` are carried so a fold too thin to mean anything can be
 * dropped by the same `MIN_STRATUM_PAIRS` rule report A uses on its own headline,
 * rather than being averaged in and quietly widening the error bars.
 */
export interface HeldOutFold {
  fold: number
  cutoffs: Record<string, number>
  adopted: string[]
  auc: number
  fprAt95Tpr: number
  rank1: number
  /** Held-out faces actually queried for rank-1. */
  evaluated: number
  samePairs: number
  diffPairs: number
}

/**
 * What the gate-selection PROCEDURE is worth on people it has not seen.
 *
 * ⚠ This is the number to quote, not `JointGate.result`. That one is the score
 * of a winner chosen by searching ~60 candidates against the very set it is then
 * reported on, so it is biased upward by however much of its margin was luck.
 * The two are printed together on purpose: their difference is the optimism, and
 * a reader who sees only the larger one has been misled by omission.
 *
 * `auc`/`rank1` are NaN when no fold was thick enough to score, which is a
 * legitimate outcome on a small labelled set and must be said rather than
 * papered over with a zero.
 */
export interface HeldOutGate {
  /** Per fold, for inspection. The headline numbers below are POOLED, not averaged. */
  folds: HeldOutFold[]
  requestedFolds: number
  /** Folds that contributed at least one held-out pair. */
  contributingFolds: number
  /** Pooled across every fold — the denominator the AUC actually rests on. */
  samePairs: number
  diffPairs: number
  /** Pooled held-out faces queried for rank-1. */
  evaluated: number
  auc: number
  fprAt95Tpr: number
  rank1: number
}

/**
 * One line of the paste block at the end of the report.
 *
 * `note` is a comment for the reader of the terminal, NOT for the file: a tuned
 * constant may live in public/vision/defaults.js, and no note of what was
 * measured to arrive at it may live anywhere in this repository. Copy the
 * number, leave the note.
 */
export interface Recommendation {
  /** Dotted path into public/vision/defaults.js. */
  path: string
  value: string
  note: string
}

/**
 * Parsed argv. The path is always an argument (SPEC §15 r1) — `dir` is null
 * when none was given and nothing goes looking for one.
 */
export interface ReportArgs {
  dir: string | null
  oracle: string | null
  html: boolean
  out: string | null
  /**
   * Restore the full per-cutoff sweeps under reports B and D. Off by default
   * because sixty rows of sweep is not a finding; the verdict tables above them
   * are. The HTML carries both regardless — it has a disclosure and a page to
   * hide them in, and a terminal has neither.
   */
  verbose: boolean
}

export function parseArgs(argv: readonly string[]): ReportArgs
