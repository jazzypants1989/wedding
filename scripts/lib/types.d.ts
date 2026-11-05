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
   * The destination is out of room (507, or the local cap). Run-fatal: every
   * remaining file would fail the same way, and 200 identical errors bury the
   * one line that matters.
   */
  | "DESTINATION_FULL"
  /** The admin session died mid-run (401, repeated CSRF rejection). Run-fatal. */
  | "AUTH_LOST"
  /**
   * A row asked to finish hidden came back with another status, so the server
   * does not honour the request. The row is discarded and the run stops: every
   * further reject would be published the same way.
   */
  | "HIDDEN_NOT_HONOURED"

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
  /**
   * Whether the backend can emit decoded pixels (as PPM) for the face
   * pipeline. False for sips, which only writes named formats to files.
   */
  canRawPixels: boolean
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

export interface RunBinaryRawOptions extends RunBinaryOptions {
  /** Byte ceiling on stdout. Defaults to the module's raw-path cap. */
  maxBytes?: number
}

/** How to collect a pixel command's output. */
export interface PixelCommandPlan {
  commands: BackendCommand[]
  /**
   * "stdout" — the last command streams PPM to stdout (ImageMagick).
   * "file"   — it wrote ppmPath instead, and the caller reads that (vips).
   */
  readFrom: "stdout" | "file"
}

export interface PixelCommandOptions {
  sourcePath: string
  /** Longest output edge in pixels. Never upscales. */
  maxEdge: number
  /** Scratch PPM path, used only by backends that cannot write to stdout. */
  ppmPath: string
}

/** Decoded, orientation-applied, tightly packed RGB. The pixel-source contract. */
export interface RgbImage {
  width: number
  height: number
  rgb: Uint8Array
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
 * As runBinary, but collects stdout as a Buffer. Separate because runBinary
 * decodes stdout as text and caps it at a size no decoded frame fits under.
 */
export function runBinaryRaw(
  bin: string,
  args: string[],
  options?: RunBinaryRawOptions,
): Promise<{ stdout: Buffer; stderr: string }>

/**
 * Argv for decoding one image to 8-bit binary PPM at maxEdge, orientation
 * applied. Null when the backend has no pixel path (sips).
 */
export function buildPixelCommand(
  backend: ImageBackend,
  options: PixelCommandOptions,
): PixelCommandPlan | null

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

import type { MediaKind, MediaSection, CuratedMediaSection } from "../../types.js"
import type { MediaCapacity } from "../../core/types.js"

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
  /**
   * Also remove EXIF/XMP/IPTC from the stored original. Lossless, and only for
   * JPEG/PNG/WebP — a HEIC original is left alone with a warning. Off by
   * default: byte-for-byte is exactly what the browser uploader stores.
   */
  stripOriginal?: boolean
  /**
   * HEIC originals: `keep` stores the .heic untouched (default — the server
   * accepts it, it is admin-only, and re-encoding inflates it); `jpeg` stores a
   * native-size, metadata-free JPEG instead.
   */
  heicOriginal?: "keep" | "jpeg"
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

// --- Import sinks (scripts/lib/sink-local.js, sink-http.js) ---

/** Read-only capacity check, run once before any file is touched. */
export interface SinkPreflight {
  ok: boolean
  /** Free bytes on the data volume; null when the sink can't see it. */
  freeBytes: number | null
  /** Bytes of originals already stored; null when unknown. */
  storedBytes: number | null
  /** Why `ok` is false, or a caveat worth printing when it is true. */
  message?: string
}

/** What the destination can still take. Read-only; never written to any file. */
export type SinkCapacity =
  | (MediaCapacity & { ok: true })
  | {
      ok: false
      /** `unsupported`: the server predates the endpoint, and with it `hidden`
       *  at finalize. `unavailable`: no password, or the request failed. */
      reason: "unsupported" | "unavailable"
      message: string
    }

/** A capacity check's verdict, with the lines to print. */
export interface CapacityAssessment {
  level: "ok" | "tight" | "over" | "unknown"
  lines: string[]
}

export interface SinkSession {
  id: number
  fileKey: string
}

/**
 * The one interface the CLI writes against, so scanning, hashing, variant
 * generation, the manifest and reporting are all written once. `local` writes
 * rows and files directly; `http` drives the real upload API as an admin.
 */
export interface ImportSink {
  name: "local" | "http"
  /** Capacity check. Never writes, so --dry-run can call it. */
  preflight(): Promise<SinkPreflight>
  /** Remaining storage in the server's own terms. Never writes. Never throws:
   *  a check that can't be done says so, and the CLI decides what that means.
   *  The http sink logs in for this, because the endpoint is admin-only. */
  capacity(): Promise<SinkCapacity>
  createSession(input: {
    kind: MediaKind
    originalBytes: number
    section: MediaSection
  }): Promise<SinkSession>
  putVariant(
    id: number,
    variant: string,
    file: { path: string; bytes: number; contentType: string },
  ): Promise<{ bytes: number }>
  finalize(
    id: number,
    input: {
      width: number
      height: number
      durationS: number | null
      caption: string | null
      /** Content hash of the ORIGIN file (what was hashed for the manifest).
       *  The local sink stamps it on the row; the http sink has no API field
       *  for it and ignores it (--backfill-manifest covers those rows). */
      sourceSha256: string | null
      /** Finish `hidden` rather than approved: never publicly listed. */
      hidden?: boolean
    },
  ): Promise<{ id: number; status: string }>
  /** Throw away a created-but-unfinalized session (SIGINT, mid-file failure). */
  discard(id: number): Promise<void>
  /** Set sort_order across one curated section (default official): the
   *  section's other photos keep their order, the imported ones follow. */
  applyOrder(
    orderedIds: number[],
    section?: CuratedMediaSection,
  ): Promise<{ ok: boolean; message?: string }>
  close(): Promise<void>
}

/** Build the local sink. `readOnly` keeps --dry-run off every write path. */
export function createLocalSink(options?: {
  readOnly?: boolean
  databasePath?: string
}): ImportSink

/**
 * Build the API-driven sink. Logs in lazily on the first mutation or capacity
 * read. `preflight()` is unauthenticated and never asks for a password;
 * --dry-run does ask, once, to read the admin-only capacity endpoint.
 */
export function createHttpSink(options: {
  /** Origin, no trailing slash. */
  url: string
  verbose?: boolean
  stderr?: { write(chunk: string): unknown }
}): ImportSink

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
  /** The row's status when last seen: at finalize, or as read back from the
   *  destination by a later run. Absent in a manifest written before statuses
   *  were recorded — that run asks the destination instead. */
  status?: string
  /** Other rows holding the same content: an earlier import --force replaced in
   *  this entry, or a row found by content hash. Kept so a selection still
   *  reaches them. */
  earlier?: ManifestEarlierRow[]
}

/** A row the manifest still tracks after a newer import of the same content. */
export interface ManifestEarlierRow {
  id: number
  section: string
  status?: string
  at: string
}

/** The record that a --selection run imported into an origin. */
export interface ManifestSelectionMark {
  /** The selection file that run used, as given. Shown in the refusal. */
  path: string
  /** ISO timestamp of the latest selection run. */
  at: string
}

/** origin → sha256 → entry. Content-keyed, so renames do not re-import. */
export interface ImportManifest {
  version: number
  origins: Record<string, Record<string, ManifestEntry>>
  /** origin → the selection run that imported into it. Once present, a run to
   *  that origin needs --selection or an explicit --no-selection. */
  selections?: Record<string, ManifestSelectionMark>
}

/** One recorded row, flattened for comparing against a selection. */
export interface RecordedRow {
  sha256: string
  /** The file's name at import time. */
  name: string
  id: number
  section: string
  /** Last recorded status; null when the manifest predates recording it. */
  status: string | null
  /** False for a row kept in `earlier`, i.e. a previous copy. */
  current: boolean
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

/**
 * Record an import. Mutates and returns the manifest. A different row already
 * recorded for this content moves into `earlier` rather than being forgotten.
 */
export function manifestRecord(
  manifest: ImportManifest,
  origin: string,
  sha256: string,
  entry: ManifestEntry,
): ImportManifest

/** How many files this origin has recorded. */
export function manifestCount(manifest: ImportManifest, origin: string): number

/** Every row recorded for an origin, earlier copies included. */
export function manifestRows(manifest: ImportManifest, origin: string): RecordedRow[]

/** Update a recorded row's status wherever it appears. Returns whether it did. */
export function manifestSetStatus(
  manifest: ImportManifest,
  origin: string,
  id: number,
  status: string,
): boolean

/** The selection run recorded for an origin, or null. */
export function manifestSelection(
  manifest: ImportManifest,
  origin: string,
): ManifestSelectionMark | null

/** Record that a selection run imported into an origin. Mutates and returns it. */
export function manifestMarkSelection(
  manifest: ImportManifest,
  origin: string,
  mark: ManifestSelectionMark,
): ImportManifest

/** Write atomically (tmp + rename), creating the parent directory. */
export function saveManifest(manifestPath: string, manifest: ImportManifest): void

/** Streamed sha256 of a file's contents, as lowercase hex. */
export function hashFile(filePath: string): Promise<string>

/** Canonical origin key — trailing slashes must not create a second bucket. */
export function normalizeOrigin(origin: string): string

// --- The selection file (scripts/lib/import-selection.js) ---

/** Exactly 64 lowercase hex characters. */
export function isSha256Hex(value: unknown): value is string

/** Parse a selection file's text into the set of hashes that stay visible. */
export function parseSelection(
  raw: string,
): { valid: true; value: Set<string> } | { valid: false; error: string }

/** Read and parse a selection file. An unreadable file is an invalid one. */
export function loadSelection(
  selectionPath: string,
): { valid: true; value: Set<string> } | { valid: false; error: string }

// --- The CLI (scripts/import-media.js) ---

/** Everything the run needs, after parsing and defaulting. */
export interface ImportArgs {
  /** Absolute; always a positional argument, never guessed. */
  dir: string
  section: "official" | "honeymoon" | "guest"
  dryRun: boolean
  /** Normalized origin (no trailing slash), or null for the local sink. */
  url: string | null
  recursive: boolean
  order: "name" | "mtime"
  captions: "none" | "sidecar"
  concurrency: number
  manifestPath: string
  reportPath: string | null
  /** --selection: files not listed there finish hidden. Null: all finish visible. */
  selectionPath: string | null
  force: boolean
  skipReorder: boolean
  stripOriginal: boolean
  heicOriginal: "keep" | "jpeg"
  videos: "skip" | "require"
  verbose: boolean
}

/** One file the scan found, with the relative path ordering is done on. */
export interface ScannedFile {
  absolute: string
  /** Path relative to the scan root, with "/" separators. Used for sorting. */
  relative: string
  name: string
}

/** A file that will be imported. */
export interface PlannedItem {
  skipped: false
  file: ScannedFile
  plan: MediaPlanOk
  sha256: string
  caption: string | null
  /** Not in the --selection file, so it finishes hidden. */
  hidden: boolean
}

/** Why the CLI passed over a file. Adds the one reason the media layer can't know. */
export type ImportSkipCode = MediaImportErrorCode | "ALREADY_IMPORTED"

export interface SkippedItem {
  skipped: true
  file: ScannedFile
  code: ImportSkipCode
  message: string
  /** Known when the file was hashed before being skipped (ALREADY_IMPORTED). */
  sha256?: string
}

/** The machine-readable run summary, also written by --report. */
export interface ImportReport {
  startedAt: string
  finishedAt: string | null
  dir: string
  section: string
  sink: "local" | "http"
  dryRun: boolean
  imported: {
    file: string
    id: number
    fileKey: string
    sha256: string
    bytes: number
    width: number
    height: number
    /** What the row finished as: approved, or hidden under --selection. */
    status: string
  }[]
  skipped: { file: string; code: string; message: string }[]
  failed: { file: string; code: string; message: string; detail: string | null }[]
  /** Files the run never reached, because it was interrupted. */
  unattempted: string[]
  warnings: string[]
  /** 0 clean, 1 some files failed, 2 aborted. */
  exitCode: number
}

/**
 * Injection points, so the integration test can drive the whole pipeline with a
 * stub variant builder. The repo's media fixtures are synthetic magic-byte stubs
 * (binary files are deliberately not checked in), so no real backend can decode
 * them — but everything downstream of generation is the real code path.
 */
export interface ImportDeps {
  probeBackends?: typeof probeBackends
  planMediaFile?: typeof planMediaFile
  buildMediaVariants?: typeof buildMediaVariants
  hashFile?: typeof hashFile
  createSink?: (args: ImportArgs) => ImportSink
  stdout?: { write(chunk: string): unknown }
  stderr?: { write(chunk: string): unknown }
  now?: () => string
}

/** Parse argv (without node and the script path). */
export function parseImportArgs(
  argv: string[],
): { valid: true; value: ImportArgs } | { valid: false; error: string }

/** Every file under `dir`, sorted by relative path in code-unit order. */
export function scanDirectory(
  dir: string,
  options?: { recursive?: boolean },
): ScannedFile[]

/** Read and hash every file, splitting them into "will import" and "skipped". */
export function buildImportPlan(
  input: {
    files: ScannedFile[]
    backends: MediaBackends
    manifest: ImportManifest
    origin: string
    force: boolean
    captions: "none" | "sidecar"
    order: "name" | "mtime"
    concurrency: number
    /** The hashes that stay visible; null means every file does. */
    selection?: Set<string> | null
  },
  deps?: ImportDeps,
): Promise<{ items: PlannedItem[]; skipped: SkippedItem[] }>

/** The preflight + plan block, as lines. */
export function formatPlanReport(
  args: ImportArgs,
  backends: MediaBackends,
  preflight: SinkPreflight,
  plan: { items: PlannedItem[]; skipped: SkippedItem[] },
): string[]

/** What --selection will do, as lines. Counts only; goes to stdout, never to a file. */
export function formatSelectionReport(
  args: ImportArgs,
  selection: Set<string>,
  plan: { items: PlannedItem[]; skipped: SkippedItem[] },
): string[]

/** Compare the bytes a run plans to send with what the destination has left. */
export function assessCapacity(plannedBytes: number, capacity: SinkCapacity): CapacityAssessment

/** Do the import. Never throws for a per-file problem; the report says what happened. */
export function runImport(args: ImportArgs, deps?: ImportDeps): Promise<ImportReport>
