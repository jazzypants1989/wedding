/** @file Types for the /memory-book page (a print-first guestbook keepsake).
 *  Mirrors the public guestbook feed shape (api/guestbook.js list) — only the
 *  fields the book renders are declared. */

/** A guestbook entry as the memory book uses it. Superset-compatible with the
 *  public feed's GuestbookFeedEntry (extra feed fields are simply ignored). */
export interface MemoryBookEntry {
  id: number
  message: string
  author_name: string
  created_at: string
  /** Admin-pinned: the flower is gilded whether or not Favorites lead the book. */
  pinned: boolean
}

/** One page of the public guestbook feed (GET /api/guestbook). `pinned` is
 *  present only on the first page (before === null), and empty unless the
 *  couple switched Favorites on. */
export interface MemoryBookFeedResponse {
  entries: MemoryBookEntry[]
  nextCursor: number | null
  pinned?: MemoryBookEntry[]
}
