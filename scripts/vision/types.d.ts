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
import type { Detection, GateSignals } from "../../public/vision/types.js"

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
  /** The tunables the run actually used, so a report can be read months later. */
  config: Record<string, unknown>
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
