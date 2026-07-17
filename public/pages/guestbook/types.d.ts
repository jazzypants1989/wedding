/** @file Types for the guestbook page (feed + composer) */

import type { ReactionSummary } from "../../../types.js"

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
  reactions?: ReactionSummary
  comment_count?: number
}

export interface GuestbookFeedResponse {
  entries: GuestbookFeedEntry[]
  nextCursor: number | null
}

export interface GuestbookPostResponse {
  entry: GuestbookFeedEntry
  status: ContentStatus
}

/** Wire up the composer + feed, load the first page. */
export function initFeed(): Promise<void>

/** Scroll to and highlight a deep-linked entry (?entry=N), fetching it if unloaded. */
export function openEntry(id: number): Promise<void>
