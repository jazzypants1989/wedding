/** @file Types for the guestbook page (feed + composer) */

import type { ReactionSummary } from "../../../types.js"
import type { FlowerNote } from "../../components/types.js"

export type { FlowerNote }

export type ContentStatus = "pending" | "approved" | "hidden" | "rejected"

/** One entry as returned by GET /api/guestbook / POST /api/guestbook.
 *  `reactions`/`comment_count` are attached by Phase 5 feed enrichment. */
export interface GuestbookFeedEntry {
  id: number
  message: string
  author_name: string
  author_trusted: boolean
  status: ContentStatus
  created_at: string
  is_own: boolean
  /** Admin-pinned: its flower is gilded (gold eyes). */
  pinned: boolean
  reactions?: ReactionSummary
  comment_count?: number
}

export interface GuestbookFeedResponse {
  entries: GuestbookFeedEntry[]
  nextCursor: number | null
  /** Admin-pinned "Favorites" (newest-pinned-first, cap 6); present on the first
   *  page only, and empty unless the couple switched the strip on. Pinned entries
   *  also remain in `entries`, flagged `pinned` (intentional duplication). */
  pinned?: GuestbookFeedEntry[]
}

export interface GuestbookPostResponse {
  entry: GuestbookFeedEntry
  status: ContentStatus
}

/** Wire up the composer + feed, load the first page. */
export function initFeed(): Promise<void>

/** Scroll to and highlight a deep-linked entry (?entry=N), fetching it if unloaded. */
export function openEntry(id: number): Promise<void>

/** Draw the meadow band: the newest entries' flowers (at most MEADOW_MAX), each
 *  on its own swaying layer. */
export function renderMeadow(host: HTMLElement, entries: GuestbookFeedEntry[]): void

/** Wire the meadow (click → onPick(id), redraw on a layout change) and return
 *  its redraw function. `getEntries` is read on every draw. */
export function initMeadow(
  host: HTMLElement,
  getEntries: () => GuestbookFeedEntry[],
  onPick: (id: number) => void,
): () => void

/** Add the two still corner sprays behind the page (wide screens only, by CSS). */
export function initBackdrop(): void
