/**
 * Types for scripts/dev/: developer tooling that is never imported by the server.
 * Implementations annotate against these with `@type {Types.name}`.
 */
import type { Server } from "node:http"
import type { DatabaseSync } from "node:sqlite"
import type { GateSignals } from "../../public/vision/types.js"

// --- placeholder-proxy.js ---

export interface PlaceholderProxyArgs {
  port: number
  upstream: string
  /** Absent means every placeholder is a plain backdrop with no faces drawn. */
  database: string | null
}

export interface PlaceholderProxyOptions {
  upstreamHost: string
  upstreamPort: number
  db: DatabaseSync | null
}

export function parseProxyArgs(argv: readonly string[]): PlaceholderProxyArgs

/** Split "host:port". A bare host means port 80. */
export function parseUpstream(upstream: string): { host: string; port: number }

/**
 * True for a response the proxy must not forward: image and video types, except
 * the formats this app's generated assets use (PNG, SVG, icons).
 */
export function isPhotographicType(contentType: string): boolean

export function createPlaceholderProxy(options: PlaceholderProxyOptions): Server

export interface DrawnFace {
  x: number
  y: number
  w: number
  h: number
  /** Flat [x0,y0,...]: eyes, nose, mouth corners. */
  landmarks: number[] | null
}

export interface FaceEntry {
  /** Original width and height the boxes are measured in. 0 means no scaling. */
  ow: number
  oh: number
  faces: DrawnFace[]
}

/** A fictional image: a soft backdrop with a cartoon face at each box. */
export function drawPlaceholder(
  seedText: string,
  width: number,
  height: number,
  entry: FaceEntry,
): Buffer

// --- leak-check.js ---

export type ByteKind =
  | "PNG"
  | "JPEG"
  | "WEBP"
  | "HEIF"
  | "MP4"
  | "proxy-text"
  | "HTML/text"
  | "empty/short"
  | "other"

/** Classify a response by its leading bytes. Never decodes anything. */
export function classifyBytes(head: Buffer): ByteKind

export interface LeakCheckArgs {
  database: string
  ports: number[]
}

export function parseLeakCheckArgs(argv: readonly string[]): LeakCheckArgs

export interface HopReport {
  port: number
  tally: Map<ByteKind, number>
  /** Distinct "variant (kind, type, HTTP status)" shapes. Never a file key. */
  leaks: string[]
  /** Successful responses. Zero proves nothing, so it fails the check. */
  responses: number
}

export function checkHop(
  port: number,
  fileKeys: readonly string[],
  variants?: readonly string[],
): Promise<HopReport>

/** 0 clean, 1 real bytes seen, 2 a hop answered nothing so nothing was proven. */
export function leakCheckExitCode(reports: readonly HopReport[]): 0 | 1 | 2

// --- cdp.js ---

export interface CdpArgs {
  url: string
  width: number
  height: number
  shot: string | null
  evals: string[]
  waitMs: number
  settleMs: number
  errors: boolean
  printMedia: boolean
  reducedMotion: boolean
  /** A profile to keep between runs. Null means a fresh one, deleted afterward. */
  profile: string | null
  chrome: string | null
}

export function parseCdpArgs(argv: readonly string[]): CdpArgs

/** Binaries to try, in order. An explicit choice is the only candidate. */
export function chromeCandidates(explicit: string | null, env: string | undefined): string[]

// --- preview-fixtures.js ---

export type PreviewOrientation = "landscape" | "portrait" | "square"

export interface PreviewStateInfo {
  title: string
  description: string
}

/** Every state a capture session can switch to, keyed by its URL name. */
export const PREVIEW_STATES: Readonly<Record<string, PreviewStateInfo>>

/** A deep link the switcher should offer, such as a guest's card. */
export interface PreviewLink {
  label: string
  url: string
}

/** A face slot in one fictional image, in original pixels. */
export function previewFaceBox(orientation: PreviewOrientation, slot: number): DrawnFace

/** Signal shapes that route to each state under the current profile. */
export const PREVIEW_SIGNALS: Readonly<Record<"accept" | "ask" | "set_aside", GateSignals>>

/** True only for a database path strictly inside this repo's tmp/states/. */
export function isPreviewDatabasePath(databasePath: string): boolean

// --- preview-states.js ---

export interface PreviewServerOptions {
  /** Directory holding one folder per state. */
  root: string
  backendPort: number
  publicUrl: string
}

/** Who the reviewer is browsing as. */
export type PreviewView = "visitor" | "guest" | "admin"

/** This machine's first non-loopback IPv4 address, or null if it isn't on a network. */
export function lanAddress(
  interfaces: Record<string, readonly { family: string; internal: boolean; address: string }[] | undefined>,
): string | null

/** Real site images that show people, swapped for drawings so screenshots can't carry them. */
export function isSwappedPhoto(urlPath: string): boolean

/**
 * Cookies that sign the browser in as `view` and sign it out of the others. A marker
 * cookie names the state and view, because an issue records cookie names and `/gallery`
 * is the same URL in every state.
 */
export function previewCookies(
  state: string,
  view: PreviewView,
  sessionCookies: readonly string[],
): string[]

/** The switcher page. Escapes everything it interpolates. */
export function renderSwitcher(
  current: string | null,
  linksFor: (state: string) => readonly PreviewLink[],
): string

/** Which control route this path is, or null to forward it to the backend. */
export function parseControlPath(
  urlPath: string,
): { action: "list" } | { action: "go" | "reset"; state: string; to: string; view: PreviewView } | null

export function createPreviewServer(options: PreviewServerOptions): Server
