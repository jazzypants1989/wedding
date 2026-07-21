/** @file Public comment endpoints: thread (GET), post (POST), self-delete (DELETE).
 *  Comments are polymorphic — the guestbook and media routes share these handlers
 *  via thin per-target wrappers; the target type is bound at registration. */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../types.js' */

import { sendJson, parseBody, checkRateLimit } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import { getOptionalAccount } from "../core/auth.js"
import {
  createComment,
  getCommentsForTarget,
  softDeleteComment,
} from "../db/comments.js"
import { isTargetVisible } from "../db/targets.js"
import {
  validateRequiredString,
  validateId,
  ValidationError,
  NotFoundError,
} from "../core/validation.js"
import { LIMITS, CONTENT_STATUS, TARGET_TYPE } from "../types.js"
import { log, AUDIT_ACTIONS } from "../core/utils.js"
import { getWeddingFacts } from "../core/wedding-facts.js"

/** @param {GlobalTypes.TargetType} targetType @returns {string} */
function targetLabel(targetType) {
  return targetType === TARGET_TYPE.MEDIA ? "Media" : "Entry"
}

/**
 * Map a raw comment row (SQLite 0|1 flags) to the public shape (booleans). A
 * host/couple reply (account_id NULL → is_host) has no accounts row, so its
 * author name is resolved to the couple's display name.
 * @param {GlobalTypes.CommentFeedRow} row
 * @param {string} hostName
 * @returns {GlobalTypes.CommentListItem}
 */
function toCommentItem(row, hostName) {
  const isHost = !!row.is_host
  return {
    id: row.id,
    message: row.message,
    author_name: isHost ? hostName : row.author_name ?? "",
    status: row.status,
    created_at: row.created_at,
    is_own: !!row.is_own,
    is_host: isHost,
  }
}

/**
 * GET a target's thread: approved comments plus the caller's own pending ones,
 * oldest-first. 404 if the parent isn't visible to the caller.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ params: Record<string, string> }} routeInfo
 * @param {GlobalTypes.TargetType} targetType
 */
async function list(req, res, { params }, targetType) {
  if (checkRateLimit(res, limiters.publicRead, getClientIp(req))) return

  const idResult = validateId(params.id, "target ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const account = getOptionalAccount(req)
  const callerId = account ? account.account_id : null

  if (!isTargetVisible(targetType, idResult.value, callerId)) {
    throw new NotFoundError(targetLabel(targetType))
  }

  const rows = getCommentsForTarget({
    targetType,
    targetId: idResult.value,
    callerId,
  })
  const hostName = getWeddingFacts().coupleNames
  return sendJson(res, 200, {
    comments: rows.map((row) => toCommentItem(row, hostName)),
  })
}

/**
 * POST a comment. A guest posts under hybrid moderation (trusted → approved,
 * untrusted → pending). An admin (couple) posts a HOST reply: account_id NULL,
 * always approved, author name = the couple's display name. 404 if the parent
 * isn't visible to the caller.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('../core/types.js').AccountOrAdminRouteInfo} routeInfo
 * @param {GlobalTypes.TargetType} targetType
 */
async function create(req, res, { params, principal }, targetType) {
  const isHost = principal.isAdmin
  // A guest is rate-limited per account; the couple posting host replies isn't.
  const rateKey = isHost ? "admin:comment" : "acct:" + principal.accountId
  if (checkRateLimit(res, limiters.commentPost, rateKey)) {
    return
  }

  const idResult = validateId(params.id, "target ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const body = await parseBody(req)
  const messageResult = validateRequiredString(
    body.message,
    "Comment",
    LIMITS.COMMENT_MAX_LENGTH,
  )
  if (!messageResult.valid) throw new ValidationError(messageResult.error)

  // Parent visibility pre-check → the BEFORE INSERT existence trigger stays a
  // backstop (a raw RAISE(ABORT) would surface as a generic 500 otherwise).
  // An admin sees everything approved; guests gate on their own account.
  if (!isTargetVisible(targetType, idResult.value, principal.accountId)) {
    throw new NotFoundError(targetLabel(targetType))
  }

  // Host replies are auto-approved; guest content follows hybrid moderation.
  const status =
    isHost || principal.trusted
      ? CONTENT_STATUS.APPROVED
      : CONTENT_STATUS.PENDING

  const accountId = isHost ? null : principal.accountId
  const authorName = isHost
    ? getWeddingFacts().coupleNames
    : /** @type {GlobalTypes.AccountSession} */ (principal.session).name

  const comment = createComment({
    accountId,
    targetType,
    targetId: idResult.value,
    message: messageResult.value,
    status,
  })

  log({
    action: AUDIT_ACTIONS.COMMENT_CREATE,
    adminId: isHost ? principal.session.token : undefined,
    ip: getClientIp(req),
    resourceType: "comment",
    resourceId: comment.id,
    details: { targetType, targetId: idResult.value, status, host: isHost },
  })

  // No notification call — the digest service discovers pending items on its own
  // schedule (owner decision 2026-07-06: digest-only).
  return sendJson(res, 201, {
    comment: {
      id: comment.id,
      message: comment.message,
      author_name: authorName,
      status: comment.status,
      created_at: comment.created_at,
      is_own: true,
      is_host: isHost,
    },
    status,
  })
}

/** @type {Types.commentListGuestbook} */
export async function listGuestbook(req, res, routeInfo) {
  return list(req, res, routeInfo, TARGET_TYPE.GUESTBOOK)
}

/** @type {Types.commentListMedia} */
export async function listMedia(req, res, routeInfo) {
  return list(req, res, routeInfo, TARGET_TYPE.MEDIA)
}

/** @type {Types.commentCreateGuestbook} */
export async function createGuestbook(req, res, routeInfo) {
  return create(req, res, routeInfo, TARGET_TYPE.GUESTBOOK)
}

/** @type {Types.commentCreateMedia} */
export async function createMedia(req, res, routeInfo) {
  return create(req, res, routeInfo, TARGET_TYPE.MEDIA)
}

/** @type {Types.commentRemove} */
export async function remove(req, res, { params, account }) {
  if (checkRateLimit(res, limiters.contentDelete, "acct:" + account.account_id)) {
    return
  }

  const idResult = validateId(params.id, "comment ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  // Own comments only. A miss (wrong owner OR nonexistent) is a generic 404.
  const deleted = softDeleteComment(idResult.value, account.account_id)
  if (!deleted) throw new NotFoundError("Comment")

  log({
    action: AUDIT_ACTIONS.COMMENT_DELETE,
    ip: getClientIp(req),
    resourceType: "comment",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true })
}
