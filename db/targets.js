/** @file Visibility gate for polymorphic comment/reaction targets.
 *  Resolves a guestbook entry or media item and applies the same rule the feeds
 *  use: an approved item is public; a pending item is visible only to its owner. */
/** @import * as Types from './types.js' */

import { getMediaFeedRowById } from "./media.js"
import { getGuestbookEntryForCaller } from "./guestbook-entries.js"
import { CONTENT_STATUS, TARGET_TYPE } from "../types.js"

/** @type {Types.isTargetVisible} */
export function isTargetVisible(targetType, targetId, callerId = null) {
  const row =
    targetType === TARGET_TYPE.MEDIA
      ? getMediaFeedRowById(targetId, callerId)
      : getGuestbookEntryForCaller(targetId, callerId)
  if (!row) return false
  return (
    row.status === CONTENT_STATUS.APPROVED ||
    (!!row.is_own && row.status === CONTENT_STATUS.PENDING)
  )
}
