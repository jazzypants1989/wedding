/** @file Admin black-and-white twins: find the photos that could be a colour photo
 *  and its black-and-white copy, pair two by hand, and unpair. All {admin:true}.
 *
 *  Where detection happens, and why. A twin matches its primary on metadata the
 *  server stores (capture time, dimensions, section) and on one fact it can't
 *  read: that one of the two is grayscale. The server has no JPEG or WebP decoder
 *  and gets none (CLAUDE.md: zero dependencies), and the bulk importer's image
 *  tools only see the photos the CLI imports. The admin's browser decodes every
 *  thumbnail for free, whichever way the photo arrived and whenever it arrived. So
 *  `scan` hands the browser groups that match on metadata, the browser measures
 *  the thumbnails and proposes, and a person confirms each pair through `pair`,
 *  which re-checks everything here. Nothing the browser says is trusted beyond
 *  "pair these two"; the worst a wrong proposal can do is what the admin could
 *  do by hand. */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../types.js' */
/** @import * as DbTypes from '../../db/types.js' */

import { sendJson, parseBody } from "../../core/http.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import { validateId, ValidationError, NotFoundError, ConflictError } from "../../core/validation.js"
import { MEDIA_KIND, MEDIA_SECTION, MEDIA_STATUS } from "../../types.js"
import { withTransaction } from "../../db/utils.js"
import { variantDiskPath } from "../../core/media-storage.js"
import { readCapturedAt } from "../../core/capture-time.js"
import { getMediaById } from "../../db/media.js"
import { countCardsReferencingFileKey } from "../../db/thank-you-cards.js"
import {
  countMediaWithoutCaptureTime,
  fillMediaCapturedAt,
  getLiveTwinOf,
  mediaMissingCaptureTime,
  pairTwin,
  twinCandidateRows,
  twinPickOptions,
  unpairTwin,
} from "../../db/media-twins.js"

/** Rows the scan reads at most. Candidates are only rows that share a capture
 *  second with another, so this bounds a pathological library, not a real one. */
const SCAN_ROW_CAP = 3000
/** Photos one capture-second group may offer; a longer burst is cut, not lost —
 *  the rest can still be paired by hand. */
const GROUP_MEMBER_CAP = 12
/** Photos the by-hand picker lists. */
const PICK_OPTION_CAP = 48

/** @param {GlobalTypes.MediaStatus} status @returns {boolean} */
function isPairableStatus(status) {
  return (
    status === MEDIA_STATUS.APPROVED ||
    status === MEDIA_STATUS.HIDDEN ||
    status === MEDIA_STATUS.PENDING
  )
}

/** @param {GlobalTypes.MediaSection} section @returns {boolean} */
function isGallerySection(section) {
  return (
    section === MEDIA_SECTION.OFFICIAL ||
    section === MEDIA_SECTION.HONEYMOON ||
    section === MEDIA_SECTION.GUEST
  )
}

/**
 * A row that may take part in a pair at all, on either side.
 * @param {GlobalTypes.Media | undefined} row
 * @returns {row is GlobalTypes.Media}
 */
function isPairable(row) {
  return (
    !!row &&
    !row.deleted_at &&
    row.kind === MEDIA_KIND.IMAGE &&
    isPairableStatus(row.status) &&
    isGallerySection(row.section)
  )
}

/** @param {DbTypes.TwinCandidateRow} row @returns {Types.TwinCandidate} */
function toCandidate(row) {
  return {
    id: row.id,
    file_key: row.file_key,
    section: row.section,
    status: row.status,
    caption: row.caption,
    width: row.width,
    height: row.height,
    needs_display: !!row.needs_display,
    captured_at: row.captured_at,
  }
}

/** @type {Types.mediaTwinScanHandler} */
export async function scan(req, res) {
  // Fill capture times first, from originals that still carry EXIF — browser
  // uploads from before capture times were recorded. A CLI import stripped its
  // originals, so those rows only have one if the importer or the face ingest
  // wrote it; they are counted, so the page can say what it couldn't match.
  let backfilled = 0
  for (const gap of mediaMissingCaptureTime()) {
    if (!gap.original_ext) continue
    const capturedAt = readCapturedAt(
      variantDiskPath(gap.file_key, "original", gap.original_ext),
      gap.original_ext,
    )
    if (capturedAt !== null && fillMediaCapturedAt(gap.id, capturedAt)) backfilled++
  }

  /** @type {Types.TwinCandidateGroup[]} */
  const groups = []
  let truncated = false
  /** @type {Types.TwinCandidateGroup | null} */
  let current = null
  const rows = twinCandidateRows(SCAN_ROW_CAP + 1)
  if (rows.length > SCAN_ROW_CAP) {
    truncated = true
    rows.length = SCAN_ROW_CAP
  }
  for (const row of rows) {
    const same =
      current !== null &&
      current.section === row.section &&
      current.capturedAt === row.captured_at &&
      current.width === row.width &&
      current.height === row.height
    if (!same || current === null) {
      current = {
        section: row.section,
        capturedAt: /** @type {string} */ (row.captured_at),
        width: /** @type {number} */ (row.width),
        height: /** @type {number} */ (row.height),
        members: [],
      }
      groups.push(current)
    }
    if (current.members.length < GROUP_MEMBER_CAP) current.members.push(toCandidate(row))
  }

  return sendJson(res, 200, {
    // A group cut short by the row cap may hold one photo; it can't be a pair.
    groups: groups.filter((g) => g.members.length > 1),
    backfilled,
    withoutCaptureTime: countMediaWithoutCaptureTime(),
    truncated,
  })
}

/** @type {Types.mediaTwinOptionsHandler} */
export async function options(req, res, { params }) {
  const idResult = validateId(params.id, "media ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)
  const primary = getMediaById(idResult.value)
  if (!isPairable(primary) || primary.twin_of !== null) throw new NotFoundError("Photo")
  return sendJson(res, 200, {
    items: twinPickOptions(primary, PICK_OPTION_CAP).map(toCandidate),
  })
}

/** @type {Types.mediaTwinPairHandler} */
export async function pair(req, res, { params, session }) {
  const idResult = validateId(params.id, "media ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)
  const body = await parseBody(req)
  const twinResult = validateId(body.twinId, "twinId")
  if (!twinResult.valid) throw new ValidationError(twinResult.error)
  const primaryId = idResult.value
  const twinId = twinResult.value
  if (primaryId === twinId) throw new ValidationError("A photo can't be its own copy")

  const primary = getMediaById(primaryId)
  const twin = getMediaById(twinId)
  if (!isPairable(primary) || !isPairable(twin)) throw new NotFoundError("Photo")
  if (primary.twin_of !== null) {
    throw new ConflictError("That photo is itself a black-and-white copy")
  }
  if (getLiveTwinOf(primary.id)) {
    throw new ConflictError("That photo already has a black-and-white copy. Unpair it first")
  }
  if (twin.twin_of !== null || getLiveTwinOf(twin.id)) {
    throw new ConflictError("The copy is already part of another pair")
  }
  if (primary.section !== twin.section) {
    throw new ConflictError("Both photos must be in the same section")
  }
  // A thank-you card shows the photo it names. Pairing would take the copy off
  // every card that uses it, without the couple seeing that happen, so refuse.
  if (countCardsReferencingFileKey(twin.file_key).total > 0) {
    throw new ConflictError(
      "The copy is used on a thank-you card. Take it off the card first, " +
        "or pair the other way round",
    )
  }

  const paired = withTransaction(() => pairTwin(primary.id, twin.id))
  if (!paired) throw new ConflictError("Those two photos can't be paired any more")

  log({
    action: AUDIT_ACTIONS.MEDIA_UPDATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media",
    resourceId: primary.id,
    details: { twinPaired: twin.id },
  })

  return sendJson(res, 200, {
    success: true,
    twin: { id: twin.id, file_key: twin.file_key, needs_display: !!twin.needs_display },
  })
}

/** @type {Types.mediaTwinUnpairHandler} */
export async function unpair(req, res, { params, session }) {
  const idResult = validateId(params.id, "media ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)
  const twin = getLiveTwinOf(idResult.value)
  if (!twin) throw new NotFoundError("Black-and-white copy")
  unpairTwin(idResult.value)

  log({
    action: AUDIT_ACTIONS.MEDIA_UPDATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media",
    resourceId: idResult.value,
    details: { twinUnpaired: twin.id },
  })

  // The copy goes back to the status it had: say which, so the page can tell
  // the couple whether it is now on the site.
  return sendJson(res, 200, {
    success: true,
    twin: { id: twin.id, status: twin.status },
  })
}
