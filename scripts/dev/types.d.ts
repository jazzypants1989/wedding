/**
 * Types for scripts/dev/: developer tooling that is never imported by the server.
 * Implementations annotate against these with `@type {Types.name}`.
 */
import type { Server } from "node:http"
import type { DatabaseSync } from "node:sqlite"

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
  printMedia: boolean
  reducedMotion: boolean
  /** A profile to keep between runs. Null means a fresh one, deleted afterward. */
  profile: string | null
  chrome: string | null
}

export function parseCdpArgs(argv: readonly string[]): CdpArgs

/** Binaries to try, in order. An explicit choice is the only candidate. */
export function chromeCandidates(explicit: string | null, env: string | undefined): string[]
