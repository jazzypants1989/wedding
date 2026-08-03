/**
 * Type declarations for the vision lab's Node-side tooling (scripts/vision/).
 * Nothing here is served or reachable from the request path.
 *
 * The pure pipeline modules live in public/vision/ and declare their own types
 * in public/vision/types.d.ts — they may not import node:*, so the split is not
 * organisational tidiness, it is the constraint that keeps one implementation
 * usable in both venues.
 */
import type { DatabaseSync } from "node:sqlite"
import type { FaceAssignmentOp, VisionIngest } from "../../types.js"
import type { ImageBackend, ImportManifest, MediaBackends, RgbImage } from "../lib/types.js"
import type { CreateIngestInput, FaceRouteVerdict } from "../../db/types.js"
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

// --- PNG reader (scripts/vision/png-read.js) ---

/**
 * Decode a PNG written by png-write.js — 8-bit truecolour RGB (colour type
 * 2), no interlace, filter type 0 on every scanline. Every other PNG feature
 * (palette, alpha, 16-bit samples, interlacing, any other filter) is refused
 * rather than silently handled, because a decoder that guessed would produce
 * a plausible-looking wrong buffer with no signal that anything was wrong —
 * exactly the failure mode `redescribe-crops.js` cannot afford to feed into
 * an embedder unnoticed.
 *
 * Every chunk's CRC-32 is checked (a separate table from png-write.js's own —
 * see that file's header) and a mismatch throws rather than decoding anyway.
 */
export function decodePng(buffer: Buffer): RgbImage

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
  /**
   * A model this repository can run but does not require. Absence reports
   * `absent-optional` and does not fail the run; wrong bytes under its name
   * still do.
   *
   * The distinction is availability, never integrity: a machine that ships the
   * incumbent should not be told it is missing a challenger it deliberately
   * does not carry, and pinning only the required files would leave the one
   * artifact nobody can audit by reading it audited by nothing at all.
   */
  optional?: boolean
}

export interface WeightCheck {
  name: string
  status: "ok" | "missing" | "mismatch" | "lfs-pointer" | "absent-optional"
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
  info(): EngineInfo
}

/**
 * The machine-readable half of `info()` — what a later ingest records as the
 * provenance of a descriptor space, and what tells two runs apart when their
 * filenames agree and their bytes do not.
 *
 * Content hashes rather than filenames throughout: a filename says what
 * somebody called an artifact, a digest says which artifact it was.
 *
 * Mirror-averaging is deliberately absent. It is a caller's setting, not an
 * engine's, and the run writer assembles the full provenance from both — see
 * `Session1Timing.provenance` and `config.mirrorTta`.
 */
export interface EngineProvenance {
  /** Inference runtime and version, without the bracketed settings. */
  runtime: string
  detectChannels: "rgb" | "bgr"
  embedChannels: "rgb" | "bgr"
  topKStage: "pre" | "post"
  /**
   * `in-graph` — the network normalises its own input, so it is fed raw 0-255.
   * `arcface` — the network has no such nodes and the engine applies
   * (x − 127.5) / 127.5 before the tensor.
   */
  embedNorm: string
  /** Whether the mode came from the engine's digest table or an override. */
  embedNormSource: string
  detectorSha256: string
  embedderSha256: string
  /** The engine module's own bytes. It is scaffolding, so it has no version. */
  engineSha256: string
}

export interface EngineInfo {
  /** Human line, printed by the batch and by the report. */
  runtime: string
  detector: string
  embedder: string
  /**
   * Optional, because an engine satisfying this interface need not offer it and
   * `loadEngine` checks for methods, not fields — a run whose engine omits it
   * simply has no structured provenance to record.
   */
  engine?: EngineProvenance
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
  /**
   * The CANONICAL descriptor — L2-normalised, rounded for file size, and
   * mirror-averaged when the run used --mirror-tta. Every consumer (grouping,
   * the report's headline, ingest) reads this field without needing to know
   * the mirror setting; timing.json's `config.mirrorTta` records which it was.
   */
  descriptor: number[]
  /**
   * Present only under --mirror-tta: the single-pass (un-averaged) vector,
   * kept solely so session1-report.js's mirror A/B can price what averaging
   * bought. Never canonical; nothing ingests it.
   */
  descriptorUnmirrored?: number[]
  /**
   * LEGACY, never written by current code. Pre-canonicalization runs held the
   * single-pass vector in `descriptor` and the mirror-averaged one here.
   * Readers keep a fallback on this field only so old run files on disk keep
   * their original meaning; re-describing via redescribe-crops.js migrates a
   * run to the canonical shape and drops this field.
   */
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
  /**
   * Backend version line, engine info, node version — display strings, printed
   * as `k=v` by the report. The structured facts live in `provenance`; keeping
   * this block flat is what lets a run made before that existed still print.
   */
  environment: Record<string, string>
  /**
   * Engine provenance for a machine to read: which artifacts, by digest, in
   * which configuration. Optional — runs written before this existed have none,
   * and a consumer must treat its absence as "unknown", never as a default.
   *
   * Written by the batch ALONE, and it means the strong thing: one engine both
   * detected and described this directory. `redescribe-crops.js` deletes it
   * rather than updating it, because after a re-describe it is no longer true —
   * see the two fields below. A consumer that reads this one on a re-describe
   * output therefore gets `undefined` and fails closed, rather than reading a
   * digest that describes a different pass.
   */
  provenance?: EngineProvenance
  /**
   * The engine that produced THIS directory's descriptors, written by
   * `redescribe-crops.js`. Its detector fields describe how that engine was
   * configured, not the detection that produced these boxes — the boxes came
   * from the source run and `sourceProvenance` is the authority on them.
   */
  describeProvenance?: EngineProvenance
  /**
   * The source run's `provenance`, copied verbatim by `redescribe-crops.js`.
   * Absent when the source run recorded none — which is "unknown", and must not
   * be filled in from the re-describing engine, however plausible that would be:
   * the two are only the same file if nobody changed `--weights`.
   */
  sourceProvenance?: EngineProvenance
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
    /**
     * Whether the descriptors in THIS run directory are mirror-averaged —
     * i.e. whether `descriptor` is the average of the crop and its mirror.
     * session1.js records its flag; redescribe-crops.js overwrites it with
     * its own, because its output's descriptors are its own doing.
     */
    mirrorTta?: boolean
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
  /**
   * Passed to loadEngine as LoadEngineOptions.embedderFile. Null uses
   * tmp/rig/engine.mjs's own default (SFace). The A/B rig
   * (scripts/vision/redescribe-crops.js) reuses this same flag name and the
   * same LoadEngineOptions field, so a candidate model is one flag on either
   * script rather than two different ones to keep in sync.
   */
  embedderFile: string | null
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

// --- Re-describing crops under a different embedder (scripts/vision/redescribe-crops.js) ---

/**
 * Parsed argv. `runDir` is an existing session-1 run whose detections, boxes,
 * gate signals and labels are reused unchanged — only descriptors are
 * recomputed. `outDir` is where the new run (same faces, new descriptors) is
 * written, and is always given (CLAUDE.md; SPEC §15 r1) — nothing here
 * invents an output path.
 */
export interface RedescribeArgs {
  runDir: string
  outDir: string
  enginePath: string
  weightsDir: string
  /** Passed to loadEngine as LoadEngineOptions.embedderFile. Null uses the engine's own default. */
  embedderFile: string | null
  /** Matches session1.js's flag of the same name. Set it only if the run being compared against did. */
  mirrorTta: boolean
}

export interface RedescribeResult {
  exitCode: number
  /**
   * Crops re-described. Deliberately the only number this script reports about
   * its own output — see the file header on never printing a descriptor
   * statistic.
   */
  faces: number
}

/**
 * Decode every crop `faces.jsonl` names, describe it under the engine at
 * `args.enginePath`/`args.embedderFile`, and write a new run directory whose
 * `faces.jsonl` is identical to the source except the descriptors: `descriptor`
 * is replaced (canonical — mirror-averaged under `--mirror-tta`, with the
 * single-pass vector kept as `descriptorUnmirrored`), and any legacy
 * `mirrorDescriptor` is dropped, which makes this the migration tool for
 * pre-canonicalization runs. The output's timing.json records this run's
 * `mirrorTta`.
 *
 * Refuses to run at all if any crop file `faces.jsonl` references is missing,
 * and writes nothing if interrupted partway — a partial re-describe would
 * silently bias every comparison made against the run it produced.
 */
export function runRedescribe(
  args: RedescribeArgs,
  deps?: {
    engine?: VisionEngine
    log?: (line: string) => void
  },
): Promise<RedescribeResult>

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
  /**
   * `--pool-a N`. Null means "unspecified": with a previous label-data.js,
   * that is the ordinary carry-over path; with none, derivedAssignments' own
   * fallback (timing.json's recorded size, or FALLBACK_POOL_A) applies.
   */
  poolA: number | null
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
  /**
   * Which of the three paths produced `data.faces`' pool/group assignments:
   * carried over unchanged, re-derived (no previous file), or grown (previous
   * file plus `--pool-a` larger than its existing pool A).
   */
  mode: "carried" | "derived" | "grown"
  /** Face count promoted from pool B to pool A. Zero outside "grown". */
  promoted: number
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
 *
 * `poolASizeOverride` is `--pool-a` when the caller gave one; it takes
 * precedence over timing.json's recorded size, which is otherwise the fallback
 * ahead of FALLBACK_POOL_A.
 */
export function derivedAssignments(
  faces: readonly Session1FaceRecord[],
  timing: Session1Timing | null,
  poolASizeOverride?: number | null,
): PoolAssignments

/**
 * Pools and order for the `--pool-a` GROW path: a previous label-data.js
 * exists and a strictly larger pool A was asked for.
 *
 * `promoted` is every face id that moved from pool B to pool A this run,
 * ascending. It exists so the caller can warn about a face that already
 * carries a pool-B label in labels.json — this function never reads that
 * file, so it cannot count that itself.
 */
export interface GrowAssignmentsResult extends PoolAssignments {
  promoted: number[]
}

/**
 * Grow pool A from a previous label-data.js by re-deriving pools at a larger
 * size and checking the OLD pool A survives as a subset of the new one.
 *
 * assignPools does a full Fisher-Yates shuffle of face positions keyed only by
 * seed and face order, then takes the first `poolASize` of it — so the same
 * seed over the same faces makes a larger pool A a strict superset of a
 * smaller one, a longer prefix of the same shuffled sequence. That is what
 * makes growth safe where a fresh draw is not (SESSION-2-vision.md §7 P0), and
 * this function does not trust the argument — it verifies the prefix on every
 * call and throws if it does not hold, which only happens when the recorded
 * seed does not reproduce the file's existing pools (a different run).
 *
 * Pool B's group ids are never re-derived here: groupPoolB renumbers them
 * whenever pool-B membership changes, and labels.json's `excluded` map is
 * keyed by group id, so a renumbering would silently attach an exclusion
 * recorded against one cluster to a different one. Every face left in pool B
 * keeps the OLD group id it already had.
 *
 * Throws if `poolASize` is smaller than the existing pool A (shrinking would
 * orphan labels already collected) or larger than the face count.
 */
export function growAssignments(
  faces: readonly Session1FaceRecord[],
  previous: Session1LabelData,
  timing: Session1Timing | null,
  poolASize: number,
): GrowAssignmentsResult

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
    /**
     * The nose ridge's extremum point closest to the mouth, in image pixels.
     * Optional because it postdates the two eye centroids above — an oracle
     * file written before oracle-macos.swift emitted it simply lacks the key.
     */
    noseTip?: [number, number]
    /**
     * The two `outerLips` extreme points, in image pixels, named by GEOMETRY
     * (smaller/larger pixel x) rather than by either source's vocabulary —
     * see the mouth-corner comment in oracle-macos.swift and SESSION-2-vision.md
     * §3 for why. Optional for the same reason `noseTip` is.
     */
    mouthImgLeft?: [number, number]
    mouthImgRight?: [number, number]
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

/**
 * Which of a face's stored vectors a view reads. Absent means the canonical
 * `descriptor`. The named variants exist for the mirror A/B alone: "single"
 * is the un-averaged pass (`descriptorUnmirrored`, or `descriptor` in
 * pre-canonicalization files), "averaged" the mirror-averaged one
 * (`descriptor`, or the legacy `mirrorDescriptor` in pre-canonicalization
 * files).
 */
export type DescriptorVariant = "single" | "averaged"

/** Which faces `buildView` packs, and which descriptor it takes from each. */
export interface ViewOptions {
  /**
   * Report A's headline is pool A only: pool B was labelled with the model's own
   * grouping as an assist, so its coverage is conditioned on what the model
   * already found. Fine for volume in reports B and C, disqualifying in A.
   */
  pool?: "A" | "B" | null
  /** Absent = the canonical `descriptor`. See DescriptorVariant. */
  variant?: DescriptorVariant
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
  /** The same pooled pairs, person-tagged, for the verdict's cluster bootstrap. */
  sameTagged: import("../../public/vision/types.js").TaggedSamePair[]
  diffTagged: import("../../public/vision/types.js").TaggedDiffPair[]
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
  /**
   * True when writing this value re-numbers every face id and therefore
   * ORPHANS every existing label (SESSION-4 §3). Anything upstream of
   * `faces.jsonl` — detector input, resolution, thresholds — is in this class;
   * gate, grouping and assignment cutoffs are not. The report prints these in
   * a separate block, because the two kinds used to appear in one list and the
   * only expensive mistake was indistinguishable from the eight safe ones.
   */
  orphansLabels?: boolean
  /**
   * Set when the cutoff is measurably good but is a proxy for something other
   * than face quality (SESSION-2 §9 r6): distance-from-frame-edge measures
   * whether someone was the SUBJECT of the photograph, and an alignment-scale
   * cap is a minimum face size in disguise. Both improve every metric by
   * discarding the people the feature is meant to find.
   */
  caution?: string
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

// --- ONNX activation exposure (scripts/vision/inspect-onnx.js additive
// export; scripts/vision/expose-activations.js) ---

/**
 * One GraphProto node, reduced to what a tensor-name lookup needs: which op
 * produced it, its own (often blank) name, and the tensor names it consumes
 * and produces. Exposed by inspect-onnx.js's `nodeOutputs()` so
 * expose-activations.js can resolve a requested tensor name back to its
 * producing op — this is the same walk `inspect()` already does for the
 * operator histogram, just returned instead of only printed.
 */
export interface OnnxNode {
  opType: string
  name: string
  inputs: string[]
  outputs: string[]
}

/**
 * Byte range of ModelProto's GraphProto field (field 7): `tagStart` is where
 * the field's own tag varint begins, `contentStart`/`contentEnd` bound the
 * GraphProto bytes. Rewriting the model means replacing `[tagStart,
 * contentEnd)` with a fresh tag + length varint + (possibly grown) content —
 * there is exactly one such span, since `graph` is a direct, non-repeated
 * field of ModelProto.
 */
export interface GraphFieldLocation {
  tagStart: number
  contentStart: number
  contentEnd: number
}

/**
 * Every name a GraphProto declares as a graph input, a graph output, or an
 * initializer (a weight) — the three reasons a requested tensor name gets
 * refused — plus whatever element types its `value_info` entries (field 13)
 * record, the cheap way to learn an intermediate tensor's dtype without
 * re-deriving it from the producing op's attributes.
 */
export interface GraphNames {
  inputs: Set<string>
  outputs: Set<string>
  initializers: Set<string>
  /** name -> TensorProto.DataType, from GraphProto.value_info entries. */
  valueInfoTypes: Map<string, number>
}

/**
 * The result of splicing new graph outputs into a model: the patched bytes,
 * and the tensor names actually appended, in the order they were appended
 * (requested order, after de-duplication).
 */
export interface ExposeResult {
  buffer: Buffer
  appended: string[]
}

export function locateGraphField(buf: Buffer): GraphFieldLocation

export function parseGraphNames(buf: Buffer, graph: { start: number; end: number }): GraphNames

/**
 * A minimal ValueInfoProto: name + TypeProto{tensor_type{elem_type}}, no
 * shape — ORT tolerates loose output type info for an already-computed
 * tensor. Returned unwrapped, with no outer field tag; the caller wraps it as
 * a GraphProto.output (field 12), or reuses it to build fixture
 * ValueInfoProtos for graph inputs/outputs in tests.
 */
export function buildValueInfo(name: string, elemType: number): Buffer

/** Protobuf varint encoding: 7 bits per byte, continuation bit set on every
 *  byte but the last. `n` must be a non-negative integer. */
export function writeVarint(n: number): Buffer

/** A protobuf field tag: `(fieldNum << 3) | wireType`, varint-encoded. */
export function tag(fieldNum: number, wireType: number): Buffer

/** A length-delimited protobuf field: tag + varint length + `bytes`. */
export function lengthDelimited(fieldNum: number, bytes: Buffer): Buffer

/**
 * Appends one graph output per requested tensor name, refusing any name that
 * is not produced by a node, or that already names a graph output, a graph
 * input, or an initializer. Append-only: every byte outside the GraphProto
 * field's span is untouched, and inside it only the output list grows —
 * nothing already in the file is renumbered or moved.
 */
export function exposeActivations(buf: Buffer, tensorNames: readonly string[]): ExposeResult

// --- ingest-faces.js ---

/** Parsed CLI arguments. `runDir` may be null only when `backfillManifest` is set. */
export interface IngestArgs {
  runDir: string | null
  database: string | null
  modelVersion: string | null
  backfillManifest: string | null
  replace: boolean
  dryRun: boolean
}

export type IngestArgsResult =
  | { valid: true; value: IngestArgs }
  | { valid: false; error: string }

/** No regex: a manual switch over known `--flags`. Unknown flags are refused. */
export function parseArgs(argv: string[]): IngestArgsResult

/** One JSONL file. A malformed line is counted and skipped, never fatal. */
export function readJsonl<T>(file: string): { records: T[]; skipped: number; present: boolean }

/**
 * Open (creating if needed) a SQLite file with the server's own schema, and
 * bind db/sql.js's `sql` template to THIS connection — not db/connection.js's
 * process-wide singleton, so callers (the CLI, or a unit test) can point this
 * exact logic at any file without an import-order dance.
 */
export function openDatabase(dbPath: string): DatabaseSync

/** sha256 -> media.id, for every non-deleted media row that has one. */
export function loadMediaShaMap(): Map<string, number>

/**
 * Pure join: no DB access. `mediaBySha` is supplied already queried, so this
 * is unit-testable with a plain Map.
 */
export function joinPhotosToMedia(
  photos: readonly Session1PhotoRecord[],
  mediaBySha: ReadonlyMap<string, number>,
): {
  matched: Array<{ photo: Session1PhotoRecord; mediaId: number }>
  unmatchedCount: number
}

export interface IngestRunOptions {
  db: DatabaseSync
  runDir: string
  modelVersion: string
  replace: boolean
  dryRun: boolean
}

export interface IngestRunResult {
  photosInRun: number
  matched: number
  /** No sha256 match against any imported media row — likely not imported yet. */
  unmatched: number
  facesInserted: number
  /** Faces given a `route_state`. Lower than `facesInserted` only when a record
   *  is missing one of the nine gate signals, which leaves it ungraded rather
   *  than graded against an absent number. */
  facesGraded: number
  /** `media` rows given a `frame_root_sha256`. Zero on a dry run. */
  framesWritten: number
  /** `media` rows given a `captured_at`. Photos with no EXIF time are skipped. */
  capturedAtWritten: number
  /** The `vision_ingests` row every inserted face points at. Null on a dry run,
   *  where nothing was written to point at. */
  ingestId: number | null
}

/** What `buildIngestInput` reads: the run's timing block, its faces (for the
 *  content-addressed dataset id) and the model version the operator named. */
export interface BuildIngestInputOptions {
  timing: Session1Timing
  faces: readonly Session1FaceRecord[]
  modelVersion: string
}

/**
 * Assemble the `vision_ingests` row for one run from its own timing.json.
 *
 * Pure: no database, no filesystem, so every refusal is testable against a
 * hand-built timing object. THROWS rather than defaulting when the provenance
 * block is missing, when the mirror setting is absent, or when any string bound
 * for `config_json` looks like a path or an environment reference.
 */
export function buildIngestInput(options: BuildIngestInputOptions): CreateIngestInput

/** `<run-dir>/timing.json`. THROWS when it is missing: the batch always writes
 *  one, so its absence means this is not a run directory this script
 *  understands, and there is nothing to fall back on that would not be a guess
 *  about which model produced the descriptors. */
export function readTiming(runDir: string): Session1Timing

/** Route one face record for the admin queue, or `null` to leave it ungraded.
 *  A record missing any of the nine gate signals is left ungraded on purpose —
 *  `null` means "not yet graded" downstream and is shown, where grading against
 *  an absent signal would route the face `set_aside`. */
export function gradeFace(
  face: Session1FaceRecord,
  cutoffs: Record<string, number>,
): FaceRouteVerdict | null

/**
 * Per-photo frame identity and capture time for the `media` columns. Pure — no
 * DB access — so the union-find resolution is testable against plain records.
 *
 * Keyed by run-local photo id; the VALUE's frame root is content-addressed (the
 * sha256 of the lowest-id photo in the duplicate equivalence class), so it
 * survives a re-run that numbered the photos differently.
 */
export function frameMetadataForPhotos(
  photos: readonly Session1PhotoRecord[],
): Map<number, { frameRootSha256: string; capturedAt: string | null }>

/**
 * The main pass: join the run's JSONL to media by sha256, refuse (or
 * `--replace`) a (media_id, model_version) re-run, and insert one
 * `media_faces` row per face of every matched photo — one transaction.
 */
export function ingestRun(options: IngestRunOptions): IngestRunResult

export interface BackfillManifestOptions {
  db: DatabaseSync
  manifest: ImportManifest
  dryRun: boolean
}

export interface BackfillManifestResult {
  total: number
  updated: number
}

/** Populate media.source_sha256 from an import-media manifest, for rows that
 *  don't have it yet. Counts only — never a filename. */
export function backfillFromManifest(options: BackfillManifestOptions): BackfillManifestResult

/** Throws unless given a non-empty model version tag; returns it unchanged
 *  otherwise. The main pass's refusal to ever guess a descriptor model. */
export function requireModelVersion(modelVersion: string | null): string

// --- rekey-labels.js ---

/**
 * The opt-in names sidecar `identities.json`, exactly as label.html's
 * buildExport writes it: person key → name (and the roster guest id, when the
 * autocomplete supplied one). Person keys are scrambled per export (the same
 * permutation as the labels.json written alongside it), so the keys only mean
 * anything against that one labels.json.
 */
export interface Session1IdentitiesFile {
  version: number
  datasetId?: string
  identities: Record<string, { guestId: number | null; name: string }>
}

/** The two JSONL files a run is joined by — photos for the sha256 join,
 *  faces for the per-photograph box match. */
export interface RekeyRun {
  photos: readonly Session1PhotoRecord[]
  faces: readonly Session1FaceRecord[]
}

/** Reads `<dir>/photos.jsonl` + `faces.jsonl`; throws when either is missing
 *  or empty. Malformed lines are counted and skipped, never fatal. */
export function readRekeyRun(dir: string): { photos: Session1PhotoRecord[]; faces: Session1FaceRecord[] }

/**
 * sha256 → photo, refusing (throwing) when two photographs share a hash: the
 * join would be ambiguous, and a silent "last wins" is D7 one layer up.
 * `side` names the offending run in the error ("--from" / "--to").
 */
export function indexPhotosBySha(
  photos: readonly Session1PhotoRecord[],
  side: string,
): Map<string, Session1PhotoRecord>

/** Why each unmatched SOURCE face failed, as counts — never a path, never a
 *  name. The five reasons are checked in this order per face. */
export interface RekeyMatchCounts {
  /** The photograph's sha256 is absent from the target run. */
  photoMissing: number
  /** The target photograph exists but has no face rows at all. */
  noCandidate: number
  /** Best overlap under MATCH_IOU_FLOOR. */
  belowFloor: number
  /** Some other source face overlaps the chosen target more. */
  notMutual: number
  /** Mutual best, but the runner-up on either side is within MATCH_IOU_MARGIN. */
  marginTooSmall: number
}

export interface RekeyMatchResult {
  /** source face id → target face id, accepted pairs only. */
  map: Map<number, number>
  unmatched: RekeyMatchCounts
  photosJoined: number
  photosSourceOnly: number
  photosTargetOnly: number
}

/**
 * Join photographs by sha256, then match each photograph's boxes across the
 * runs: a pair is accepted only when each box is the other's highest-IoU
 * candidate AND that IoU beats each side's runner-up by MATCH_IOU_MARGIN
 * (with MATCH_IOU_FLOOR under everything). Both conditions are symmetric, so
 * the outcome is independent of input order. Throws on a duplicate sha256 in
 * either run (D7).
 */
export function matchRuns(source: RekeyRun, target: RekeyRun): RekeyMatchResult

/** `poolA.json`: the target face ids whose SOURCE face was in pool A —
 *  explicit carry, because the labelling page ignores `pool` on import (D6)
 *  and pool A is the only individually-judged sample. Ascending. */
export interface PoolCarryFile {
  version: number
  datasetId: string
  faceIds: number[]
}

/** One converted exclusion: "this target face is not that person", person key
 *  under the SAME fresh remap as the rewritten labels.json/identities.json. */
export interface ExclusionRecord {
  faceId: number
  notPerson: string
}

/** `exclusions.json`: labels.json's group-keyed `excluded` map converted to
 *  per-face records (D5 — group ids renumber and are never copied). Sorted by
 *  faceId, then key. */
export interface ExclusionsCarryFile {
  version: number
  datasetId: string
  exclusions: ExclusionRecord[]
}

export interface RekeyCounts {
  photosJoined: number
  photosSourceOnly: number
  photosTargetOnly: number
  sourceFaces: number
  facesMatched: number
  unmatched: RekeyMatchCounts
  labelsCarried: number
  /** Labelled source faces whose face did not match anything in the target. */
  labelsLost: number
  personsCarried: number
  /** Person keys whose every labelled face was lost. */
  personsLost: number
  namesCarried: number
  namesDropped: number
  poolACarried: number
  poolALost: number
  skippedCarried: number
  skippedLost: number
  exclusionsConverted: number
  exclusionsDroppedUnmatched: number
  /** The group's surviving labels named zero or several persons, or the one
   *  person lost every face — nothing safe to attach the exclusion to. */
  exclusionsDroppedNoPerson: number
}

export interface RekeyResult {
  /** Target numbering, fresh person keys, target datasetId, re-keyed `pool`
   *  map, re-keyed `skipped`. `group` and `excluded` deliberately absent (D5). */
  labels: Session1LabelFile
  /** Null when no identities file was given. Same remap as `labels` (D4). */
  identities: Session1IdentitiesFile | null
  poolA: PoolCarryFile
  exclusions: ExclusionsCarryFile
  counts: RekeyCounts
}

/**
 * The whole rewrite, pure: match the runs, allocate ONE fresh person-key remap
 * (D4), and emit all four outputs under it. Throws on: a duplicate sha256 in
 * either run (D7); a labels file whose datasetId does not hash from the source
 * faces; a labels file with no `pool` map (D6); an identities file whose
 * datasetId disagrees or whose person keys the labels never use (a mismatched
 * export pair — D4).
 */
export function rekeyLabels(
  source: RekeyRun,
  target: RekeyRun,
  labelFile: Session1LabelFile,
  identitiesFile: Session1IdentitiesFile | null,
): RekeyResult

/** Parsed CLI arguments; paths resolved. */
export interface RekeyArgs {
  from: string
  to: string
  labels: string
  identities: string | null
  outDir: string
  force: boolean
}

/** Read the runs and files, rekey, write the outputs into `outDir`, print
 *  counts (only counts) through `log`. Returns the process exit code. */
export function runRekey(args: RekeyArgs, log: (line: string) => void): number

// --- Model comparison (scripts/vision/compare-models.js) ---------------------

/**
 * Parsed CLI arguments. `incumbent` and `challenger` are repeatable, one entry
 * per variant — the rule scores four runs, both models with mirror-averaging on
 * and off, and picks each model's best before comparing the two.
 */
export interface CompareArgs {
  help: boolean
  incumbent: string[]
  challenger: string[]
  /** Which pool is scored. Pool A is the individually judged one. */
  pool: "A" | "B"
  folds: number
  /** Query faces one person may contribute to M1. */
  cap: number
  /** Capped query faces the challenger must win by. */
  margin: number
  /** Where to write the full result, or null. Must be under tmp/. */
  json: string | null
}

/** One re-described run, loaded and restricted to the scored pool. */
export interface CompareVariant {
  dir: string
  run: LoadedRun
  view: FaceView
  /** Whether THIS directory's descriptors are mirror-averaged. */
  mirror: boolean
  /** From the run's describeProvenance; null for a run that recorded none. */
  embedderSha256: string | null
}

/**
 * The M1 scored set: which faces build prototypes, which are queried, and how
 * many people were splittable at all. Computed once and shared by every
 * variant, because it depends only on face ids and frames.
 */
export interface M1Set {
  /** Person key per view row for prototype-side faces, null elsewhere. */
  assignments: Array<string | null>
  queries: Array<{ row: number; faceId: number; person: string }>
  splittable: number
  people: number
}

export interface M1Score {
  correct: number
  total: number
  /** Per person, for the spread condition. Keyed by opaque person key. */
  perPerson: Map<string, { correct: number; total: number }>
}

/**
 * One model's operating cutoff for one fold. The two weld fields are diagnostic
 * only: the comparison derives its cutoff by a single objective (best pair-F1
 * over the cannot-link points) precisely so that welding cannot branch it.
 */
export interface DerivedCutoff {
  cutoff: number
  /** Groups the chosen point welds. Reported; never a gate. */
  weldedGroups: number
  /** Whether ANY swept point welded nobody. The T7 finding, per fold. */
  weldFreeAvailable: boolean
}

export interface M2Fold extends DerivedCutoff {
  /** Index into the fold list. Identity, not position — folds can be skipped. */
  fold: number
  faces: number
}

export interface M2Score {
  /** Pooled across folds, not averaged. NaN when nothing was scored. */
  purity: number
  labelledFaces: number
  perFold: M2Fold[]
}

export interface VariantResult {
  variant: CompareVariant
  m1: M1Score
  m2: M2Score
}

export interface Verdict {
  adopt: boolean
  outcome: "adopt-challenger" | "no-decision-keep-incumbent"
  m1Delta: number
  m1Spread: { ahead: number; behind: number; level: number }
  /** False when the two models scored different folds, so M2's two pooled
   * purities are over different faces and cannot gate anything. */
  foldsAlign: boolean
  /** Every condition that failed, in the order they were checked. */
  reasons: string[]
}

export interface CompareReport {
  incumbents: VariantResult[]
  challengers: VariantResult[]
  bestIncumbent: VariantResult
  bestChallenger: VariantResult
  verdict: Verdict
  m1Set: M1Set
  folds: number
}

// --- Portable face-work hand-off (scripts/vision/export-face-work.js) ---
//
// The artifact that carries face-tagging work from the machine that did the
// naming to the machine that serves the site. It carries NO descriptors, NO
// filesystem paths and NO source-machine row ids — see the file header for the
// full argument. Everything below is the shape of that file plus the two halves
// that write and read it.

/** A box in SOURCE pixels, the frame `media_faces.bbox_*` is stored in. */
export interface FaceWorkBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The LOGICAL ingest provenance, as it travels. Deliberately not a
 * `VisionIngest`: no `id` (a source-machine primary key the target must never
 * trust) and no `created_at` (a fact about when a machine ran, not about what
 * it produced). `config` is the parsed, allowlisted `config_json`.
 */
export interface FaceWorkIngest {
  datasetId: string
  modelVersion: string
  detectorSha256: string
  embedderSha256: string
  engineSha256: string
  /** 0 | 1, matching the column. */
  mirrorApplied: number
  normalisation: string
  routeProfile: string
  config: Record<string, unknown>
}

/**
 * Enough of the assignment ledger to be honest about where a confirmation came
 * from, and no more. `events: 0` alongside a confirmation means a PRE-LEDGER
 * row — the projection carries a value that no event explains, which is a true
 * and important thing to be able to see. The actor is never carried: it is the
 * first eight characters of a live admin session token.
 */
export interface FaceWorkLedgerSummary {
  events: number
  op: FaceAssignmentOp
  /** `face_assignment_batches.kind`, or null for a batch-less event. */
  kind: string | null
  decidedAt: string
}

/** One decision about one `(photo content hash, box)`. */
export interface FaceWorkConfirmation {
  /** `<sha256>:<x>,<y>,<w>,<h>` at two decimal places. Content, not a row id. */
  key: string
  op: "assign" | "not_a_face"
  /** `p1..pN` into `FaceWorkPayload.people`; null for `not_a_face`. */
  personRef: string | null
  /** `face_identities.provenance` on the source; null for `not_a_face`. */
  provenance: string | null
  ledger: FaceWorkLedgerSummary | null
}

/** A named person. No `guest_id`, no `notes`, no `people.id`. */
export interface FaceWorkPerson {
  ref: string
  displayName: string
}

/** Everything the content digest is taken over. Never the export timestamp. */
export interface FaceWorkPayload {
  formatVersion: number
  ingest: FaceWorkIngest
  /** Whether unreviewed ('propagated') identities were carried. */
  includesPropagated: boolean
  people: FaceWorkPerson[]
  confirmations: FaceWorkConfirmation[]
}

export interface FaceWorkArtifact {
  format: string
  exportedAt: string
  /** sha256 over `canonicalJson(payload)`. */
  contentSha256: string
  /** `face-work-<32 hex of contentSha256>` — what makes replay a no-op. */
  batchId: string
  payload: FaceWorkPayload
}

/** Which faces belong to an ingest: its `ingest_id` column, or (for rows that
 *  predate that column) `model_version` + `source='cli'`. */
export type FaceWorkFacesFrom = "ingest" | "model-version"

/** One `media_faces` row as both halves read it. Never carries a descriptor. */
export interface FaceWorkFaceRow {
  id: number
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  face_identity_id: number | null
  deleted_at: string | null
  /** `media.source_sha256` — the photograph's content hash. */
  sha256: string
}

/** Why an incoming key found no target face. */
export type FaceWorkMatchFailure = "photo" | "box" | "ambiguous" | "malformed"

/** One event the import would append. Never a direct column write. */
export interface FaceWorkAction {
  faceId: number
  op: "assign" | "not_a_face"
  personRef: string | null
  identityId: number | null
}

export interface FaceWorkConflict {
  kind: "person-split" | "person-collapse" | "confirmation"
  detail: string
}

/** Everything the import would do, and every reason it should not. */
export interface FaceWorkPlan {
  batchId: string
  /** This artifact is already on this machine: a no-op, not a refusal. */
  alreadyApplied: boolean
  /** Non-empty means nothing is written. */
  refusals: string[]
  advisories: string[]
  actions: FaceWorkAction[]
  unmatched: Record<FaceWorkMatchFailure, number>
  /** Refs with no content match — a new person on the target. */
  peopleToCreate: string[]
  peopleMatched: number
  /** Confirmations the target already agrees with. No event is appended. */
  satisfied: number
  conflicts: FaceWorkConflict[]
  personIdByRef?: Map<string, number>
  nameByRef?: Map<string, string>
}

export interface FaceWorkArgs {
  command: "export" | "import" | "preflight" | null
  artifact: string | null
  database: string | null
  ingestId: number | null
  facesFrom: FaceWorkFacesFrom
  includePropagated: boolean
  weights: string | null
  engine: string | null
  expectEngine: string | null
  matchOverlap: boolean
  force: boolean
  actor: string
  note: string | null
  dryRun: boolean
}

export type FaceWorkArgsResult =
  | { valid: true; value: FaceWorkArgs }
  | { valid: false; error: string }

/** `<sha256>:<x>,<y>,<w>,<h>`, boxes at two decimal places. */
export function faceWorkBoxKey(sha256: string, box: FaceWorkBox): string

/**
 * Deterministic JSON: keys sorted by code unit, no whitespace, no locale.
 *
 * `unknown` in, deliberately: it is fed a `config_json` this process did not
 * write, so a shape assertion at the boundary would be a claim rather than a
 * check. Anything with no JSON form serialises as `null`, matching what
 * `JSON.stringify` puts in an array slot for one.
 */
export function canonicalJson(value: unknown): string

/** The artifact's content address, over the payload only. */
export function faceWorkDigest(payload: FaceWorkPayload): string

/** What differs between the ingest an artifact came from and a local one.
 *  `blocking` is what moves a box; `advisory` is what an operator should read. */
export function faceWorkProvenanceDiff(
  exported: FaceWorkIngest,
  targetRow: VisionIngest,
): { equivalent: boolean; blocking: string[]; advisory: string[] }

/** Read the projected current state plus a ledger annotation, and build the
 *  artifact. Throws when one content key carries rows that disagree. */
export function buildFaceWorkExport(options: {
  db: DatabaseSync
  ingestId: number | null
  facesFrom: FaceWorkFacesFrom
  includePropagated: boolean
}): {
  artifact: FaceWorkArtifact
  stats: {
    candidateFaces: number
    contentKeys: number
    people: number
    assigned: number
    notAFace: number
    skippedPropagated: number
  }
}

/** Parse, structurally validate, and check the declared content digest. */
export function parseFaceWorkArtifact(
  text: string,
): { valid: true; value: FaceWorkArtifact } | { valid: false; error: string }

/** Resolve incoming keys onto target face rows. Exact by default; mutual-best
 *  IoU with a margin under `overlap`, which is a reviewed exception. */
export function matchFaceWorkKeys(
  keys: string[],
  targetRows: FaceWorkFaceRow[],
  options: { overlap: boolean },
): {
  matched: Map<string, FaceWorkFaceRow[]>
  unmatched: Map<string, FaceWorkMatchFailure>
}

export function planFaceWorkImport(options: {
  db: DatabaseSync
  artifact: FaceWorkArtifact
  ingestId: number | null
  facesFrom: FaceWorkFacesFrom
  matchOverlap: boolean
  force: boolean
}): FaceWorkPlan

/** One transaction, one batch, `recordAssignment` for every event. */
export function applyFaceWorkImport(options: {
  db: DatabaseSync
  plan: FaceWorkPlan
  actor: string
  note: string | null
}): {
  batchId: string
  applied: boolean
  events: number
  peopleCreated: number
  identitiesCreated: number
}

/** Weights and engine against pinned digests, before the database is opened. */
export function faceWorkPreflight(options: {
  weightsDir: string | null
  enginePath: string | null
  expectedEngineSha256: string | null
}): Promise<{
  ok: boolean
  failures: string[]
  checks: WeightCheck[]
  engineSha256: string | null
}>

/** No regex: a manual switch over known `--flags`. Unknown flags are refused. */
export function parseFaceWorkArgs(argv: string[]): FaceWorkArgsResult
