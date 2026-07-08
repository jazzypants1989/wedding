/** @file Feed enrichment: attach reaction summaries + comment counts to a page
 *  of guestbook/media items. Shared by both list handlers so the two surfaces
 *  stay in lockstep. Mutates items in place (adds `reactions` + `comment_count`). */
/** @import * as GlobalTypes from '../types.js' */

import { getReactionSummary } from "../db/reactions.js"
import { getCommentCounts } from "../db/comments.js"

/**
 * Attach `reactions` + `comment_count` to each item. No-op on an empty page —
 * sql.list() throws on `[]`, so the guard is required, not just an optimization.
 * @param {(GlobalTypes.MediaListItem | GlobalTypes.GuestbookFeedEntry)[]} items
 * @param {GlobalTypes.TargetType} targetType
 * @param {number | null} callerId
 */
export function enrichSocial(items, targetType, callerId) {
  if (items.length === 0) return
  const ids = items.map((item) => item.id)
  const reactions = getReactionSummary(targetType, ids, callerId)
  const counts = getCommentCounts(targetType, ids)
  for (const item of items) {
    item.reactions = reactions.get(item.id) ?? {}
    item.comment_count = counts.get(item.id) ?? 0
  }
}
