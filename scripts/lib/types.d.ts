/**
 * Type declarations for the bulk media importer's shared modules
 * (scripts/lib/). Implementations annotate against these via
 * `/** @import * as Types from './types.js' *\/`.
 */

// --- Errors (scripts/lib/media-errors.js) ---

/**
 * Discriminates what went wrong so the CLI can decide between "skip this file"
 * and "stop the run", and can group failures in the summary.
 */
export type MediaImportErrorCode =
  /** No usable image tool on PATH. Fatal before any file is touched. */
  | "NO_IMAGE_BACKEND"
  /** A specific binary named via env is absent. */
  | "BACKEND_MISSING"
  /** No ffmpeg, and this file is a video. Per-file. */
  | "NO_VIDEO_BACKEND"
  /** Not a format the site accepts. Per-file. */
  | "UNSUPPORTED_SOURCE"
  /** Over MEDIA_LIMITS for its kind. Per-file, caught before any work. */
  | "SOURCE_TOO_LARGE"
  /** Longer than MEDIA_LIMITS.VIDEO_MAX_DURATION_S. Per-file. */
  | "VIDEO_TOO_LONG"
  /** Neither the header nor the backend could report dimensions. Per-file. */
  | "UNREADABLE_DIMENSIONS"
  /** The backend exited non-zero. Per-file. */
  | "BACKEND_FAILED"
  /** The backend hung and was killed. Per-file. */
  | "BACKEND_TIMEOUT"
  /** Even the lowest rung of the quality ladder exceeded the cap. Per-file. */
  | "VARIANT_TOO_LARGE"
  /** A produced variant sniffed as something the server would 415. Per-file. */
  | "VARIANT_FORMAT_MISMATCH"
  /** stripImageMetadata could not guarantee a clean variant. Per-file. */
  | "STRIP_FAILED"

/**
 * The shape MediaImportError implements. Declared for consumers that catch and
 * inspect it; the class itself is defined in media-errors.js and TypeScript
 * infers its members from that implementation.
 */
export interface MediaImportErrorShape extends Error {
  code: MediaImportErrorCode
  /** Source file the failure belongs to, when it belongs to one. */
  file?: string
  /** Backend argv or stderr tail — shown at --verbose. */
  detail?: string
}

// --- Image backend (scripts/lib/image-backend.js) ---

export type ImageBackendName = "vips" | "magick" | "convert" | "sips"
export type VideoBackendName = "ffmpeg"

/** The static facts about a backend, before we know it is installed. */
export interface ImageBackendSpec {
  name: ImageBackendName
  /** As invoked — resolved through PATH by execFile, never hard-coded. */
  bin: string
  versionArgs: string[]
  canWebp: boolean
  canHeic: boolean
  /** Whether the backend bakes EXIF orientation into its output itself. */
  autoOrients: boolean
}

/** A backend confirmed present, with everything needed to invoke it. */
export interface ImageBackend extends ImageBackendSpec {
  /** First line of the version output — informational. */
  version: string
  /** Sibling binary for dimension reads (vips only); null elsewhere. */
  headerBin: string | null
  /** Environment pinning the tool to one thread. */
  childEnv: Record<string, string>
}

export interface VideoBackendSpec {
  name: VideoBackendName
  bin: string
  versionArgs: string[]
}

export interface VideoBackend extends VideoBackendSpec {
  version: string
  childEnv: Record<string, string>
}

/** Both slots, as resolved once at startup. */
export interface MediaBackends {
  image: ImageBackend | null
  video: VideoBackend | null
}

/** One command to run: an argv array, never a shell string. */
export interface BackendCommand {
  bin: string
  args: string[]
}

/** A doctor-style line for the preflight block. */
export interface BackendNote {
  level: "ok" | "warn" | "error"
  message: string
}

/** Dimensions plus orientation as a backend reported them. */
export interface BackendDimensions {
  width: number
  height: number
  /** EXIF orientation 1-8; 1 when the backend cannot report it. */
  orientation: number
}

export interface ResizeOptions {
  sourcePath: string
  outPath: string
  /** Longest output edge in pixels. */
  maxEdge: number
  /** 0-1, matching the browser's canvas quality values. */
  quality: number
  format: "jpeg" | "webp"
  /** EXIF orientation of the source; drives the sips rotate pass. */
  orientation?: number
  /** Scratch path for the sips two-pass rotate. */
  midPath: string
  /** Source dimensions, so sips can skip -Z rather than upscale. */
  sourceWidth?: number
  sourceHeight?: number
}

export interface PosterOptions {
  sourcePath: string
  outPath: string
  atSeconds: number
}

export interface RunBinaryOptions {
  timeoutMs?: number
  env?: Record<string, string>
  /** Source file this invocation belongs to, for error context. */
  file?: string
}

/** Parse a run of decimal digits. Null for empty, non-digit or absurdly long. */
export function parseUint(str: string): number | null

/**
 * Value of a `key: value` line in sips output. Scans from the end, so the
 * echoed path cannot be mistaken for a property line.
 */
export function sipsProp(stdout: string, key: string): string | null

/** ImageMagick's orientation word → EXIF orientation number (1 when unknown). */
export function magickOrientationToExif(word: string): number

/** First line of a version banner, with ImageMagick's "Version: " prefix removed. */
export function firstLine(text: string): string

/** execFile with a timeout, thread pinning and MediaImportError translation. */
export function runBinary(
  bin: string,
  args: string[],
  options?: RunBinaryOptions,
): Promise<{ stdout: string; stderr: string }>

/**
 * First installed image backend in preference order, or null. Honours
 * WEDDING_IMAGE_BACKEND and WEDDING_IMAGE_BIN.
 */
export function probeImageBackend(options?: {
  backendName?: string
  bin?: string
}): Promise<ImageBackend | null>

/** ffmpeg if present, or null. Honours WEDDING_VIDEO_BACKEND / WEDDING_FFMPEG_BIN. */
export function probeVideoBackend(options?: {
  backendName?: string
  bin?: string
}): Promise<VideoBackend | null>

/** Multi-line message naming what to install, per OS. */
export function imageBackendInstallHint(): string
export function videoBackendInstallHint(): string

/** Commands whose combined stdout parseDimensionOutput can read. */
export function buildDimensionCommand(
  backend: ImageBackend,
  sourcePath: string,
): BackendCommand[]

/** Parse the stdout of buildDimensionCommand's commands, in order. */
export function parseDimensionOutput(
  backend: ImageBackend,
  outputs: string[],
): BackendDimensions | null

/**
 * Commands producing one resized variant. More than one for sips, which needs a
 * separate rotate pass.
 */
export function buildResizeCommands(
  backend: ImageBackend,
  options: ResizeOptions,
): BackendCommand[]

/** Command extracting a single still frame as PNG at native size. */
export function buildPosterCommand(
  backend: VideoBackend,
  options: PosterOptions,
): BackendCommand

/** Preflight lines describing what was found and what is missing. */
export function describeBackends(backends: MediaBackends): BackendNote[]

// --- Variant generation (scripts/lib/media-variants.js) ---

import type { MediaKind, MediaSection } from "../../types.js"

/** Container types core/sniff.js recognizes. */
export type SourceSniff = "jpeg" | "png" | "webp" | "heic" | "mp4" | "mov"

/** A source file the importer can handle, with everything read up front. */
export interface MediaPlanOk {
  ok: true
  sourcePath: string
  kind: MediaKind
  sniffed: SourceSniff
  /** From core/sniff.js extForSniff — jpg, png, webp, heic, mp4, mov. */
  originalExt: string
  originalBytes: number
  /** ORIENTED dimensions, matching what the browser reports at finalize. */
  width: number
  height: number
  /** Video only; null when the container declares it unknown. */
  durationSeconds: number | null
  /** EXIF orientation 1-8 of the source. */
  orientation: number
  /** Whether the original carries GPS — reported to the user, not acted on. */
  hasGps: boolean
  /** EXIF DateTimeOriginal as "YYYY-MM-DD HH:MM:SS". Read, reported, not yet ordered on. */
  capturedAt: string | null
  mtimeMs: number
}

/** A source file that will be skipped, with a reason worth printing. */
export interface MediaPlanSkip {
  ok: false
  sourcePath: string
  code: MediaImportErrorCode
  message: string
}

export type MediaPlan = MediaPlanOk | MediaPlanSkip

/** One file produced for upload. `original` is the untouched source. */
export interface VariantArtifact {
  name: string
  /** Absolute path; inside the work dir except for `original`. */
  path: string
  /** Exactly the file size — used verbatim as Content-Length. */
  bytes: number
  contentType: string
  width: number | null
  height: number | null
  /** The quality that finally fit under the cap; null for `original`. */
  quality: number | null
  steppedDown: boolean
  warnings: string[]
}

/** Everything needed to create, upload and finalize one media row. */
export interface BuiltMedia {
  plan: MediaPlanOk
  kind: MediaKind
  /** Oriented, cross-checked against the largest derived variant. */
  width: number
  height: number
  durationSeconds: number | null
  /** Always false — this importer never produces an original-only row. */
  needsDisplay: false
  /** Derived variants first, `original` last. */
  artifacts: VariantArtifact[]
  warnings: string[]
  workDir: string
  /** Remove the work dir. Safe to call more than once. */
  dispose(): Promise<void>
}

export interface BuildVariantsOptions {
  /** Parent for the per-file work dir. Defaults to os.tmpdir(). */
  tmpRoot?: string
  /** Force JPEG output even on a WebP-capable backend. */
  format?: "auto" | "jpeg"
  /** Which variant set to produce. Defaults to the guest/official pair. */
  section?: MediaSection
}

/** Resolve both backends once, honouring the env overrides. */
export function probeBackends(options?: {
  image?: { backendName?: string; bin?: string }
  video?: { backendName?: string; bin?: string }
  skipVideo?: boolean
}): Promise<MediaBackends>

/** Magic-byte type of a file, using the same sniffer as the server. */
export function sniffFile(filePath: string): string

/**
 * Everything knowable about a source file before any pixels are touched. Runs
 * no subprocess for JPEG/PNG/WebP — only HEIC needs the backend for dimensions.
 */
export function planMediaFile(
  sourcePath: string,
  backends: MediaBackends,
): Promise<MediaPlan>

/** Derived variant names for a kind and section (excludes `original`). */
export function variantNamesFor(kind: MediaKind, section: MediaSection): string[]

/**
 * Generate every derived variant, strip its metadata, and verify it against the
 * caps and sniff rules the server enforces. Throws MediaImportError on failure,
 * having already cleaned up its work dir.
 */
export function buildMediaVariants(
  plan: MediaPlanOk,
  backends: MediaBackends,
  options?: BuildVariantsOptions,
): Promise<BuiltMedia>

/** Short random token for scratch filenames. */
export function randomWorkName(): string

// --- Idempotency manifest (scripts/lib/import-manifest.js) ---

/** What was recorded about one successfully imported file. */
export interface ManifestEntry {
  /** The media row's id, so the manifest doubles as a provenance record. */
  id: number
  fileKey: string
  section: string
  /** Basename at import time; informational, never matched on. */
  name: string
  bytes: number
  /** ISO timestamp of the import. */
  at: string
}

/** origin → sha256 → entry. Content-keyed, so renames do not re-import. */
export interface ImportManifest {
  version: number
  origins: Record<string, Record<string, ManifestEntry>>
}

/**
 * Read the manifest. Returns an empty one for a missing, corrupt or
 * wrong-version file rather than throwing — refusing to run would be worse than
 * re-importing, which is visible and fixable.
 */
export function loadManifest(manifestPath: string): ImportManifest

/** Whether this content hash was already imported to this origin. */
export function manifestHas(
  manifest: ImportManifest,
  origin: string,
  sha256: string,
): boolean

/** The recorded entry, or null. */
export function manifestGet(
  manifest: ImportManifest,
  origin: string,
  sha256: string,
): ManifestEntry | null

/** Record an import. Mutates and returns the manifest. */
export function manifestRecord(
  manifest: ImportManifest,
  origin: string,
  sha256: string,
  entry: ManifestEntry,
): ImportManifest

/** How many files this origin has recorded. */
export function manifestCount(manifest: ImportManifest, origin: string): number

/** Write atomically (tmp + rename), creating the parent directory. */
export function saveManifest(manifestPath: string, manifest: ImportManifest): void

/** Streamed sha256 of a file's contents, as lowercase hex. */
export function hashFile(filePath: string): Promise<string>

/** Canonical origin key — trailing slashes must not create a second bucket. */
export function normalizeOrigin(origin: string): string
