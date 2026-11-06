/** @file mobile-nav.js - Types for mobile navigation module */

/**
 * Toggle function to open/close the mobile nav.
 * @example
 * toggle(); // Opens if closed, closes if open
 */
export function toggle(): void

/**
 * Close function to explicitly close the mobile nav.
 * @example
 * close(); // Closes if open, no-op if already closed
 */
export function close(): void

/**
 * Initialize mobile navigation with hamburger menu.
 * Sets up event listeners for toggle, close, and accessibility.
 * @example
 * initMobileNav();
 */
export function initMobileNav(): void

/** @file theme-toggle.js - Types for theme toggle module */

/**
 * Initialize theme toggle buttons.
 * Sets up click handlers and initial state.
 */
export function initThemeToggle(): void

/**
 * Toggle between light and dark theme.
 * Updates data-theme attribute, localStorage, and toggle button state.
 */
export function toggleTheme(): void

/** @file celebrate.js - Types for shared celebration + button-state helpers */

/** Toggle a button's disabled state + `.btn-loading` spinner class. */
export function setButtonLoading(btn: HTMLButtonElement, isLoading: boolean): void

/** Burst confetti from the top of the viewport. No-ops under reduced motion.
 *  `accent` (e.g. a card's resolved `--tc-accent`) leads the color palette,
 *  blended with the base tones; omitted → exact default palette/behavior. */
export function fireConfetti(accent?: string): void

/** Small sparkle burst centred on `element`. No-ops under reduced motion. */
export function miniSparkle(element: HTMLElement): void

/** Break a wax seal at `originEl`: two halves rotate + fall apart plus a spray
 *  of small wax shards flung outward with a gravity arc. `accent` (e.g. a card's
 *  `--tc-accent`) colours the wax; omitted → the brand tone. No-ops under
 *  reduced motion. */
export function sealBreak(originEl?: HTMLElement | null, accent?: string): void

/** Send a single emoji `glyph` flying from `originEl` up into `targetEl` (the
 *  card body) — a small, warm confirmation. No-ops under reduced motion or when
 *  any argument is missing. */
export function flyEmoji(glyph: string, originEl: HTMLElement, targetEl: HTMLElement): void

/** Quick cork-pop burst — a streak + radiating gold fizz spray from `originEl`
 *  (or the bottom-centre of the viewport), plus an impact flash at the origin.
 *  No-ops under reduced motion. `accent` leads the fizz spark palette and
 *  tints the flash; omitted → exact default palette/behavior. */
export function champagnePop(originEl?: HTMLElement | null, accent?: string): void

/** Radial burst of small hearts from `originEl` (or the viewport centre),
 *  biased upward with distance-ring stagger. No-ops under reduced motion.
 *  `accent` leads the heart color palette; omitted → exact default
 *  palette/behavior. */
export function heartBurst(originEl?: HTMLElement | null, accent?: string): void

/** @file effect-controls.js - Types for the generic per-parameter controls */

import type { ControlHint } from "../effects/types.js"

/** Injected context for a control: which effect it belongs to, how to resolve
 *  a param's hint, and where to report edits. Keeps builders free of any
 *  module-global state so multiple consumers (studio, card composer) coexist. */
export interface ControlBuildContext {
  effectId: string
  getHint: (effectId: string, param: string) => ControlHint | undefined
  onChange: (key: string, value: unknown) => void
}

/** Build the control for one config entry, dispatching on its value type. */
export function buildControl(
  key: string,
  value: unknown,
  ctx: ControlBuildContext,
): HTMLElement

/** @file monogram.js - Deterministic initial-chip avatar derived from a name */

/** Derived monogram: 1–2 initials (or a fallback/leading glyph) + a stable hue. */
export function monogramData(name: string): { initial: string; hue: number }

/** Render the colored monogram chip (`<span class="monogram">`) as an HTML string. */
export function renderMonogram(name: string): string

/** @file relative-time.js - Types for relative time formatting */

/** Format an ISO timestamp as e.g. "3 days ago" via Intl.RelativeTimeFormat. */
export function formatRelative(iso: string): string

/** Rewrite every <time datetime> under root to its relative text + absolute title. */
export function upgradeTimes(root?: ParentNode): void

/** @file guest-session.js - Types for guest session state + write-gating */

/** Public account projection returned by /api/account/me and register. */
export interface GuestAccount {
  id: number
  name: string
  relation: string | null
  trusted: 0 | 1
}

export interface GuestSessionState {
  account: GuestAccount | null
}

export interface MeResponse {
  account: GuestAccount | null
}

export const session: GuestSessionState

/** Fetch /api/account/me and cache the account in `session`. */
export function loadSession(): Promise<GuestAccount | null>

/** Run `action` if signed in; else stash it and open the auth sheet (replays on success). */
export function requireAccount(action: () => void): void

/** Replay and clear the stashed action after a successful sign-in. */
export function replayPendingAction(): void

/** Discard the stashed action (auth sheet dismissed without signing in).
 *  Returns true if an action was actually waiting. */
export function cancelPendingAction(): boolean

/** Set the current account (called by the auth sheet after register). */
export function setAccount(account: GuestAccount | null): void

/** Sign out: clear the server session + local account, notifying subscribers. */
export function logout(): Promise<void>

/** Subscribe to `session.account` changes; returns an unsubscribe function. */
export function onSessionChange(listener: () => void): () => void

/** Wire the "Posting as {name} · Not you?" bar into `#{containerId}` (default "guest-identity"). */
export function initGuestIdentity(containerId?: string): void

/** @file auth-sheet.js - Types for the shared auth sheet */

/** POST /api/account/register: signed in, or (an open signup whose email
 *  already has an account) no session and a sign-in link emailed instead. */
export type RegisterResponse =
  | { success: true; account: GuestAccount; returning: boolean; emailed?: undefined }
  | { success: true; emailed: true; message: string; account?: undefined }

/** Inject the auth-sheet dialog + wire its listeners (idempotent). */
export function initAuthSheet(): void

/** Open the auth sheet, remembering `trigger` for focus return + success sparkle. */
export function openAuthSheet(trigger?: HTMLElement | null): void

/** Open the auth sheet directly on the email-recovery panel (e.g. after
 * following an expired magic link), optionally with an explanatory alert. */
export function openAuthRecovery(message?: string): void

/** @file media-processing.js - Client media processing contract (Phase 3 §5) */

/** One requested image size: a variant name, a long-edge cap, and encode quality. */
export interface ImageVariantSpec {
  name: string
  maxEdge: number
  quality: number
}

/** One produced image variant: its name and the encoded blob. */
export interface ProcessedVariant {
  name: string
  blob: Blob
}

/** Upload-ready output of processMediaFile(). */
export interface ProcessedMedia {
  kind: "image" | "video"
  /** Derived image variant blobs (image only; absent/empty when displayMissing). */
  variants?: ProcessedVariant[]
  /** Smallest derived image variant, for the tray preview (image only). */
  previewBlob?: Blob
  /** Extracted poster frame (video only). */
  posterBlob?: Blob
  width: number
  height: number
  /** Video duration in seconds (video only). */
  durationS?: number
  /** True when a HEIC couldn't be decoded → original-only (no derived variants). */
  displayMissing?: true
}

/** Process one image or video File into derived variants for upload. `imageVariants`
 *  overrides the image sizes produced (defaults to display+thumb). */
export function processMediaFile(
  file: File,
  imageVariants?: ImageVariantSpec[],
): Promise<ProcessedMedia>

/** @file media-uploader.js - UI-agnostic upload queue engine (Phase 4 §6) */

export type UploadState =
  | "queued"
  | "processing"
  | "uploading"
  | "done"
  | "pending"
  | "failed"
  | "canceled"

/** One file's lifecycle through the upload queue; the tray renders from this. */
export interface UploadQueueItem {
  /** Local id (not the server media id). */
  id: string
  name: string
  kind: "image" | "video" | "unknown"
  state: UploadState
  /** 0..1 byte-weighted progress across a file's variant PUTs. */
  progress: number
  /** User-facing message when state === "failed". */
  error: string | null
  /** Failed for a retryable reason (network) vs terminal (bad format / too big). */
  retryable: boolean
  /** HTTP status behind the failure (0 = network), for status-specific recovery. */
  errorStatus: number | null
  /** Object URL for the tray preview (revoked on removal). */
  previewUrl: string | null
  /** Server media id, set after POST /api/media. */
  serverId: number | null
  fileKey: string | null
  width: number
  height: number
  durationS: number | null
  displayMissing: boolean
  /** Final content status from finalize ("approved" | "pending"). */
  status: string | null
  /** Optional guest-entered caption; sent at finalize (or PATCHed post-finalize). */
  caption: string
  /** True when a post-finalize caption PATCH failed to persist; the row shows a
   *  quiet "caption didn't save" note so the guest knows to re-enter it. */
  captionError: boolean
}

export interface UploadQueueCallbacks {
  /** Fired on any state/progress change for an item. */
  onChange?: (item: UploadQueueItem) => void
  /** Fired once, the first time any item in this queue reaches done/pending.
   *  Receives the finalize status ("approved" | "pending") so the caller can
   *  celebrate honestly — a held-for-moderation upload isn't "up" yet. */
  onFirstSuccess?: (status: string) => void
}

/** Transport overrides for non-guest callers (admin curated uploads). */
export interface UploadQueueOptions {
  /**
   * CSRF cookie name whose token is sent on the XHR requests. Defaults to
   * "guest_csrf"; admin uploads pass "csrf" so withAccountOrAdmin resolves as
   * admin (reconciliation 5 + 7).
   */
  csrfCookie?: string
  /** Section passed at session create — admin passes "official" or "content". */
  section?: string
  /** Overrides the image variant sizes produced (content uploads pass the ladder). */
  imageVariants?: ImageVariantSpec[]
}

export interface UploadQueue {
  /** Enqueue files; processing is serialized, uploads run up to 2 in parallel. */
  add(files: FileList | File[]): void
  /** Re-run a failed item from the start (blobs re-derived from the File). */
  retry(id: string): void
  /** Set an item's caption; sent at finalize or PATCHed if already finalized. */
  setCaption(id: string, value: string): void
  /** Abort (if active) and drop an item; revokes its preview URL. */
  remove(id: string): void
  /** Abort + drop every item. */
  cancelAll(): void
  getItems(): UploadQueueItem[]
  /** Count of items still queued/processing/uploading. */
  activeCount(): number
}

/** Create an upload queue engine. Reused by the gallery tray and Phase 6 admin. */
export function createUploadQueue(
  callbacks?: UploadQueueCallbacks,
  options?: UploadQueueOptions,
): UploadQueue

/**
 * Magic-byte classification of a file, matching core/sniff.js. The queue applies
 * this itself; callers use it to filter a folder pick before enqueueing, so
 * .DS_Store and sidecar files are dropped rather than shown as failed rows.
 */
export function sniffKind(file: File): Promise<"image" | "video" | "unknown">


/** notice.js — one-time dismissible note (pending reassurances + cross nudges). */
export interface NoteOptions {
  /** Body text (escaped). */
  message: string
  /** localStorage key; when set and already present, the note is suppressed. */
  once?: string
  /** Optional trailing link href. */
  linkHref?: string
  /** Link label (defaults to "Open"). */
  linkLabel?: string
  /** Style as a friendly brand-accent nudge rather than a warning. */
  nudge?: boolean
}

/** Render a dismissible note into `el` (no-op if its `once` key was seen). */
export function showNote(el: HTMLElement, opts: NoteOptions): void

/** @file reaction-bar.js - Types for the shared emoji reaction bar (Phase 5) */

// Import for local use in the signatures below, and re-export so page/component
// modules can also reach these shared types as Types.* through this barrel.
import type {
  ReactionSummary,
  ReactionToggleResponse,
  CommentListItem,
  TargetType,
} from "../../types.js"
export type {
  ReactionSummary,
  ReactionToggleResponse,
  CommentListItem,
  TargetType,
}

export type ReactionEmojiKey =
  | "heart"
  | "clap"
  | "laugh"
  | "heart_eyes"
  | "cheers"
  | "fire"

/** Stable reaction key → display glyph. */
export const REACTION_GLYPHS: Readonly<Record<ReactionEmojiKey, string>>

/** Render a target's reaction bar as an HTML string (pills for all six emojis). */
export function renderReactionBar(
  targetType: TargetType,
  targetId: number,
  reactions?: ReactionSummary,
): string

/** Wire ONE delegated click listener for every reaction bar under root. */
export function initReactionBars(root?: HTMLElement | Document): void

/** @file comment-thread.js - Types for the shared comment thread (Phase 5) */

export interface CommentListResponse {
  comments: CommentListItem[]
}

export interface CommentPostResponse {
  comment: CommentListItem
  status: "approved" | "pending"
}

/** Render a collapsed comment thread ("N comments" toggle) as an HTML string. */
export function renderCommentThread(
  targetType: TargetType,
  targetId: number,
  count?: number,
): string

/** Wire ONE delegated click + submit listener for every thread under root. */
export function initCommentThreads(root?: HTMLElement | Document): void

/** Visible label for the post accelerator, e.g. "⌘ + ↵ to post". */
export function postShortcutLabel(): string

/** The same shortcut as an `aria-keyshortcuts` value ("Meta+Enter"). */
export function postShortcutAria(): string

/** @file toast.js - Types for the transient cross-surface toast */

export interface ToastOptions {
  /** Auto-dismiss delay in ms (default 3200). */
  duration?: number
  /** "error" tints the toast for failures; omit for neutral info. */
  variant?: "error" | "info"
}

/** Show a transient, auto-dismissing message (paints above the modal lightbox). */
export function showToast(message: string, opts?: ToastOptions): void

/** Announce a message on the page's shared SR-only polite live region. */
export function announcePolite(message: string): void

/** @file thanks-banner.js - Types for the signed-in "card waiting" banner */

/** One card in the GET /api/thank-you/mine response. */
export interface MyThankYouCard {
  token: string
  sent_at: string | null
  viewed_at: string | null
  theme: string
  has_photos: boolean
  replied: boolean
}

/**
 * After loadSession(), surface a dismissible banner if the signed-in guest has
 * an un-viewed thank-you card that isn't locally dismissed. No-op when signed
 * out, when there's nothing waiting, or when #main-content is absent.
 */
export function initThanksBanner(): Promise<void>

/** Exactly one emoji: one grapheme, made only of emoji parts, with at least one
 *  pictograph (public/components/emoji.js). */
export function isSingleEmoji(value: unknown): value is string

/** A stored reply emoji as a glyph: legacy keys (`heart`) map to their glyph;
 *  anything else is already a glyph. Empty string for null/empty. */
export function replyGlyph(value: string | null | undefined): string

/** The last single emoji in free text (what the reply form's "any emoji" box
 *  keeps when a keyboard inserts more than one character), or null. */
export function lastEmojiIn(text: string): string | null

/** @file note-flower.js - Types for the per-note flower drawn beside guestbook entries */

/** A note's grammar, the thing the flower grows from. `end` is the sentence's
 *  closing mark (`…` reads as `.` with `marks` 3); `commas` are word indices. */
export interface NoteSentence {
  words: string[]
  end: "" | "." | "!" | "?"
  marks: number
  commas: number[]
  emoji: string[]
}

export type FlowerLeafShape = "lance" | "ovate" | "coin" | "blade"
export type FlowerPetalShape = "round" | "point" | "notch" | "strap"

/** What a flower grew, counted — for tests and for nothing else. */
export interface FlowerParts {
  branches: number
  leaves: number
  blooms: number
  tulips: number
  buds: number
  berries: number
  tendrils: number
  emoji: number
}

/** The two fields a flower is seeded from. The row id is deliberately not one. */
export interface FlowerNote {
  author_name: string
  message: string
}

export interface FlowerOptions {
  /** A Favorite (pinned): gold at the heart of every flower, a slightly taller stem. */
  gold?: boolean
}

export interface FlowerSVGOptions extends FlowerOptions {
  /** CSS px per plant unit before the caps apply (default 0.5). */
  scale?: number
  maxW?: number
  maxH?: number
}

/** A plant as a `<g>` rooted at (0,0), with its bounding box in plant units. */
export interface GrownFlower {
  markup: string
  box: { x0: number; y0: number; x1: number; y1: number }
  parts: FlowerParts
}

/** Split a note into sentences, words, closing marks, commas and emoji (no regex). */
export function noteSentences(message: string): NoteSentence[]

/** Grow a note's plant: pure, deterministic per author + message. */
export function growFlower(note: FlowerNote, opts?: FlowerOptions): GrownFlower

/** The plant in its own fitted, aria-hidden `<svg>`, sized from the plant itself. */
export function flowerSVG(note: FlowerNote, opts?: FlowerSVGOptions): string
