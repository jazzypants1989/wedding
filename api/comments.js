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

/** @param {GlobalTypes.TargetType} targetType @returns {string} */
function targetLabel(targetType) {
  return targetType === TARGET_TYPE.MEDIA ? "Media" : "Entry"
}

/**
 * Map a raw comment row (SQLite 0|1 flags) to the public shape (booleans).
 * @param {GlobalTypes.CommentFeedRow} row
 * @returns {GlobalTypes.CommentListItem}
 */
function toCommentItem(row) {
  return {
    id: row.id,
    message: row.message,
    author_name: row.author_name,
    status: row.status,
    created_at: row.created_at,
    is_own: !!row.is_own,
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
  return sendJson(res, 200, { comments: rows.map(toCommentItem) })
}

/**
 * POST a comment. Hybrid moderation mirrors the guestbook: trusted → approved
 * instantly, untrusted → pending. 404 if the parent isn't visible to the caller.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('../core/types.js').AccountRouteInfo} routeInfo
 * @param {GlobalTypes.TargetType} targetType
 */
async function create(req, res, { params, account }, targetType) {
  if (checkRateLimit(res, limiters.commentPost, "acct:" + account.account_id)) {
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
  if (!isTargetVisible(targetType, idResult.value, account.account_id)) {
    throw new NotFoundError(targetLabel(targetType))
  }

  const status = account.trusted
    ? CONTENT_STATUS.APPROVED
    : CONTENT_STATUS.PENDING

  const comment = createComment({
    accountId: account.account_id,
    targetType,
    targetId: idResult.value,
    message: messageResult.value,
    status,
  })

  log({
    action: AUDIT_ACTIONS.COMMENT_CREATE,
    ip: getClientIp(req),
    resourceType: "comment",
    resourceId: comment.id,
    details: { targetType, targetId: idResult.value, status },
  })

  // No notification call — the digest service discovers pending items on its own
  // schedule (owner decision 2026-07-06: digest-only).
  return sendJson(res, 201, {
    comment: {
      id: comment.id,
      message: comment.message,
      author_name: account.name,
      status: comment.status,
      created_at: comment.created_at,
      is_own: true,
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
