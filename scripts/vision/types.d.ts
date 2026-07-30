/**
 * Type declarations for the vision lab's Node-side tooling (scripts/vision/).
 * Nothing here is served or reachable from the request path.
 *
 * The pure pipeline modules live in public/vision/ and declare their own types
 * in public/vision/types.d.ts — they may not import node:*, so the split is not
 * organisational tidiness, it is the constraint that keeps one implementation
 * usable in both venues.
 */
import type { ImageBackend, RgbImage } from "../lib/types.js"
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
  version: number
  faces: Array<{
    id: number
    crop: string
    photoId: number
    /** Report A's headline number comes from pool A only. */
    pool: "A" | "B"
    /** Pool B's grouping, at a tight cutoff. Null for pool A and for singletons. */
    group: number | null
  }>
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
