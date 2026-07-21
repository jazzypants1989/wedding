/** @file thanks/*.js — Types for the guest-facing digital thank-you card page.
 *  The showpiece: envelope → choreographed reveal → reply. These types mirror
 *  the public GET /api/thank-you/:token response (api/thank-you.js) plus the
 *  page's own render / reveal / effects / reply / theme modules. */

/** A resolved media item on a public card response — just enough to build
 *  /media/:file_key/:variant URLs. Mirrors ThankYouCardMediaItem in api/. */
export interface ThankYouMediaItem {
  file_key: string
  kind: "image" | "video"
  width: number | null
  height: number | null
  needs_display: boolean
}

/** The recipient's reply, when present. */
export interface ThankYouReplyView {
  emoji: string | null
  message: string | null
  replied_at: string
}

/** One authored ambient effect on a card: a registry id + a partial config. */
export interface CardEffectEntry {
  id: string
  config?: Record<string, unknown>
}

/** The opaque effects_config blob (backend never interprets its shape). */
export interface CardEffectsConfig {
  reveal?: string
  effects?: CardEffectEntry[]
}

/** GET /api/thank-you/:token response — everything the card page renders from. */
export interface PublicCard {
  recipient_name: string
  message: string
  theme: string
  effects_config: CardEffectsConfig | null
  media: ThankYouMediaItem[]
  reply: ThankYouReplyView | null
  viewed_at: string | null
  /** True on a primary (reply-capable) token; false on a read-only share view.
   *  Absent on an older backend → treated as primary (reply + beacon + share). */
  canReply?: boolean
  /** A read-only share token for the card, present only on primary-token views.
   *  Absent → the page falls back to sharing the current (reply-capable) URL. */
  shareToken?: string
}

/** POST /api/thank-you/:token/reply response. */
export interface ReplyResponse {
  success: true
  reply: ThankYouReplyView
}

// ---- card-render.js (pure render module, shared with thanks-preview) ----

export interface CardContent {
  recipientName: string
  message: string
  media: ThankYouMediaItem[]
  /** The couple's sign-off name ("— <coupleName>"). Absent/empty → the sign-off
   *  line is hidden (keeps the composer preview from showing a dangling comma). */
  coupleName?: string
}

export function applyCardContent(rootEl: HTMLElement, content: CardContent): void

/** The recipient's first name (first whitespace-delimited token), or "". */
export function firstNameOf(name: string | null | undefined): string

/** The couple's monogram initials ("J&E") derived from a couple name joined by
 *  "&" or " and ", or null when it can't be derived (single name, default). */
export function coupleInitials(coupleName: string | null | undefined): string | null

/** Render the recipient's first name onto the sealed envelope front (the
 *  `.tc-envelope-name` child); hidden when empty. */
export function setEnvelopeName(envelopeEl: HTMLElement, recipientName: string): void

/** Stamp the couple's monogram into the wax seal, or fall back to the 💌 glyph
 *  when initials can't be derived. */
export function setSealMonogram(sealEl: HTMLElement, coupleName: string | null | undefined): void

// ---- card-themes.js ----

export interface CardTheme {
  paper: string
  ink: string
  accent: string
  envelope: string
}

export const CARD_THEMES: Record<string, CardTheme>
export function resolveCardTheme(id: string): CardTheme
export function applyCardTheme(rootEl: HTMLElement, id: string): void

// ---- card-effects.js ----

export function startCardEffects(list: CardEffectEntry[]): void
export function stopCardEffects(): void

// ---- reveal.js ----

export type RevealStage =
  | "sealed"
  | "opening"
  | "unfolding"
  | "message"
  | "photos"
  | "ambient"
  | "reply"
  | "complete"

export const REVEAL_STAGES: RevealStage[]

export interface RevealOptions {
  /** The envelope button whose tap opens the card. */
  envelopeEl: HTMLElement
  /** The card article whose content is pre-mounted: kept `inert` + aria-hidden
   *  while sealed/opening so assistive tech can't read the message before the
   *  envelope opens. Unsealed at `unfolding` (before onOpened's focus hop). */
  cardEl?: HTMLElement
  /** Whether reduced-motion is in effect (skip choreography + particles). */
  reduced: boolean
  /** Fired exactly once, the moment the guest actually opens the envelope (the
   *  real tap — never on replay). Where the host fires the view beacon + haptic. */
  onOpen?: () => void
  /** Fired once at `opening` with the seal element as the origin — the reveal
   *  one-shot (confetti/hearts/champagne) + a mini sparkle. */
  onReveal?: (originEl: HTMLElement) => void
  /** Fired after `unfolding` — a chance to move focus into the opened card. */
  onOpened?: () => void
  /** Fired at `ambient` (and on skip) — start the card's ambient effects. */
  onAmbient?: () => void
  /** Fired at `reply` (and on skip) — mount the reply UI. */
  onReply?: () => void
}

export interface RevealController {
  /** Cancel the in-flight choreography, jump to `complete`, start effects + reply. */
  skip: () => void
  /** Re-run the reveal from `unfolding` (no envelope tap, no reveal one-shot). */
  replay: () => void
}

export function playReveal(cardEl: HTMLElement, opts: RevealOptions): RevealController

// ---- reply.js ----

export interface ReplyInit {
  token: string
  reply: ThankYouReplyView | null
  /** Called after a reply successfully sends (or updates) so the host can keep
   *  the latest reply for a subsequent replay's Sent state. */
  onSent?: (reply: ThankYouReplyView) => void
}

export function initReply(container: HTMLElement, init: ReplyInit): void

// ---- keepsake.js ----

/** Everything the canvas keepsake renders from. */
export interface KeepsakeData {
  themeId: string
  recipientName: string
  message: string
  /** The couple's sign-off name; absent → no sign-off line drawn. */
  coupleName?: string
  media: ThankYouMediaItem[]
}

/** Render the card to a PNG and offer it via the share sheet or a download.
 *  `button` gives feedback (disabled + "Saving…") while the image is built. */
export function saveKeepsake(button: HTMLButtonElement, data: KeepsakeData): Promise<void>
