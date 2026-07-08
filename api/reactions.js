/** @file Public reaction endpoint: toggle one emoji on a target (POST). */
/** @import * as Types from './types.js' */

import { sendJson, parseBody, checkRateLimit } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import { toggleReaction } from "../db/reactions.js"
import { isTargetVisible } from "../db/targets.js"
import {
  validateTargetType,
  validateReactionEmoji,
  validateId,
  ValidationError,
  NotFoundError,
} from "../core/validation.js"
import { TARGET_TYPE } from "../types.js"

/** @type {Types.reactionToggle} */
export async function toggle(req, res, { account }) {
  if (checkRateLimit(res, limiters.reactionToggle, "acct:" + account.account_id)) {
    return
  }

  const body = await parseBody(req)

  const typeResult = validateTargetType(body.target_type)
  if (!typeResult.valid) throw new ValidationError(typeResult.error)

  const emojiResult = validateReactionEmoji(body.emoji)
  if (!emojiResult.valid) throw new ValidationError(emojiResult.error)

  const idResult = validateId(body.target_id, "target ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  // Target must be visible to the caller. This also keeps the BEFORE INSERT
  // existence trigger a backstop rather than a user-facing 500, and turns a
  // toggle against a since-hidden/deleted target into a clean 404.
  if (!isTargetVisible(typeResult.value, idResult.value, account.account_id)) {
    throw new NotFoundError(
      typeResult.value === TARGET_TYPE.MEDIA ? "Media" : "Entry",
    )
  }

  const { active, counts } = toggleReaction({
    accountId: account.account_id,
    targetType: typeResult.value,
    targetId: idResult.value,
    emoji: emojiResult.value,
  })

  // Not audited (too noisy) and not moderated. Fresh counts let the client
  // reconcile against concurrent toggles from other users.
  return sendJson(res, 200, { active, counts })
}
