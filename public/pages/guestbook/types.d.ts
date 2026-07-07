/** @file Types for the guestbook page (feed + composer) */

export type ContentStatus = "pending" | "approved" | "hidden" | "rejected"

/** One entry as returned by GET /api/guestbook / POST /api/guestbook. */
export interface GuestbookFeedEntry {
  id: number
  message: string
  author_name: string
  author_trusted: boolean
  status: ContentStatus
  created_at: string
  is_own: boolean
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
export function initFeed(): void
