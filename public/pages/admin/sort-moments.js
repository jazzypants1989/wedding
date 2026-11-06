/** @file Gallery → Sort, the decisions with no DOM: when two photos are the same
 *  moment, which moments still need someone to look at them, and how far along
 *  the sorting is. Pure, so it runs in a unit test.
 *
 *  A moment is shots taken close together: a burst, or a retake of the same
 *  pose. The server has no image analysis, so capture time is the only signal.
 *  The rules follow the culling page's (scripts/vision/cull-logic.js), with its
 *  picture-similarity half left out because nothing here has one:
 *
 *    - consecutive shots no further apart than `gapMs` are one moment, which
 *      stops growing once it spans `spanMs` or holds `maxPhotos`;
 *    - a photo with no capture time is a moment of its own, because missing
 *      data never merges anything;
 *    - shots taken at the same instant keep the gallery's order, so the same
 *      section always makes the same moments, in the same order.
 *
 *  That module's code can't be shared: it is also loaded as a classic script
 *  from file://, so it may not import anything, and its grouping needs the
 *  feature prints this server never has.
 *
 *  "Looked at" is `decided_at`: set when a photo is shown or kept hidden in Sort,
 *  cleared by Undo. No regex (CLAUDE.md). */
/** @import * as Types from './types.js' */

import { isCuratedRowOffSite } from "./curated-order.js"

/**
 * The grouping defaults. None of these is a measurement: they are a guess at
 * how a photographer works (a burst is under a second apart, a retake a few
 * seconds), kept loose because the couple compares a moment by eye anyway.
 * @type {Types.SortDefaults}
 */
export const SORT_DEFAULTS = Object.freeze({
  /** The longest pause between two shots of one moment. */
  gapMs: 10000,
  /** A moment stops growing once its first and last shot are this far apart. */
  spanMs: 60000,
  /** The most photos side by side: more than this don't fit on an iPad. */
  maxPhotos: 8,
})

/** True for "0"–"9" only. @param {string} text */
function isDigits(text) {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** @type {Types.captureTimeMs} */
export function captureTimeMs(text) {
  if (typeof text !== "string") return null
  const s = text.trim()
  // "2026-06-20 17:03:12" (what every writer stores: core/capture-time.js and the
  // face ingest), "2026-06-20T17:03:12.345Z" (what a face ingest stored before
  // it matched them) or EXIF's own "2026:06:20 17:03:12".
  let at = s.indexOf("T")
  if (at === -1) at = s.indexOf(" ")
  if (at === -1) return null
  const datePart = s.slice(0, at)
  let timePart = s.slice(at + 1).trim()

  // Only differences between two times are ever used, so a stated zone is
  // honoured and an absent one is read as UTC: either way a daylight-saving jump
  // on this machine can't invent or erase a gap.
  let offsetMin = 0
  if (timePart.endsWith("Z")) {
    timePart = timePart.slice(0, -1)
  } else {
    const plus = timePart.indexOf("+")
    const minus = timePart.indexOf("-")
    const z = plus !== -1 ? plus : minus
    if (z !== -1) {
      const zone = timePart.slice(z + 1)
      const hhmm = zone.includes(":") ? zone.split(":") : [zone.slice(0, 2), zone.slice(2)]
      if (hhmm.length !== 2 || !isDigits(hhmm[0]) || (hhmm[1] !== "" && !isDigits(hhmm[1]))) {
        return null
      }
      const minutes = Number(hhmm[0]) * 60 + (hhmm[1] === "" ? 0 : Number(hhmm[1]))
      offsetMin = plus !== -1 ? minutes : -minutes
      timePart = timePart.slice(0, z)
    }
  }

  const date = datePart.split(datePart.includes("-") ? "-" : ":")
  const time = timePart.split(":")
  if (date.length !== 3 || time.length !== 3) return null
  const dot = time[2].indexOf(".")
  const wholeSeconds = dot === -1 ? time[2] : time[2].slice(0, dot)
  const fraction = dot === -1 ? "" : time[2].slice(dot + 1)
  const fields = [...date, time[0], time[1], wholeSeconds]
  if (!fields.every(isDigits) || (fraction !== "" && !isDigits(fraction))) return null
  const [year, month, day, hour, minute, second] = fields.map(Number)
  // "0000:00:00 00:00:00" is what a camera with no clock writes.
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 60) return null
  const ms = fraction === "" ? 0 : Math.floor(Number("0." + fraction) * 1000)
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMin * 60000
}

/** @type {Types.groupMoments} */
export function groupMoments(photos, defaults = SORT_DEFAULTS) {
  // Each photo's place in the input (the gallery's order) breaks ties and orders
  // the moments, so they come up in the order the couple already knows.
  const indexed = photos.map((photo, index) => ({ id: photo.id, t: photo.t, index }))
  const timed = indexed
    .filter((p) => p.t !== null)
    .sort((a, b) => (a.t === b.t ? a.index - b.index : Number(a.t) - Number(b.t)))

  /** @type {Array<{ ids: number[], first: number, start: number, last: number }>} */
  const moments = []
  /** @type {(typeof moments)[number] | null} */
  let open = null
  for (const p of timed) {
    const t = Number(p.t)
    const joins =
      open !== null &&
      t - open.last <= defaults.gapMs &&
      t - open.start <= defaults.spanMs &&
      open.ids.length < defaults.maxPhotos
    if (open !== null && joins) {
      open.ids.push(p.id)
      open.last = t
      open.first = Math.min(open.first, p.index)
    } else {
      open = { ids: [p.id], first: p.index, start: t, last: t }
      moments.push(open)
    }
  }
  for (const p of indexed) {
    if (p.t === null) moments.push({ ids: [p.id], first: p.index, start: 0, last: 0 })
  }
  moments.sort((a, b) => a.first - b.first)
  return moments.map((m) => ({ ids: m.ids, spanMs: m.ids.length > 1 ? m.last - m.start : null }))
}

/** @type {Types.isSortable} */
export function isSortable(row) {
  // Rejected or still uploading: nothing to look at, and nothing Sort may change.
  return row.status === "approved" || row.status === "hidden" || row.status === "pending"
}

/** @type {Types.sortState} */
export function sortState(row) {
  if (row.decided_at === null) return isCuratedRowOffSite(row) ? "undecided" : "on-site"
  return isCuratedRowOffSite(row) ? "kept-hidden" : "shown"
}

/** @type {Types.buildSortQueue} */
export function buildSortQueue(rows, options = {}) {
  const sortable = rows.filter(isSortable)
  // What this session is for: hidden photos nobody has decided. "Look again"
  // also brings back the ones that were kept hidden.
  const ids = sortable
    .filter((row) => {
      const state = sortState(row)
      return state === "undecided" || (options.again === true && state === "kept-hidden")
    })
    .map((row) => row.id)
  if (ids.length === 0) return { moments: [], ids }
  const wanted = new Set(ids)
  // Every sortable photo takes part in the grouping, so a burst whose best frame
  // is already on the site shows that frame beside the rest of it.
  const moments = groupMoments(
    sortable.map((row) => ({ id: row.id, t: captureTimeMs(row.captured_at) })),
    options.defaults ?? SORT_DEFAULTS,
  )
  return { moments: moments.filter((m) => m.ids.some((id) => wanted.has(id))), ids }
}

/** @type {Types.sortProgress} */
export function sortProgress(rows) {
  let left = 0
  let shown = 0
  let keptHidden = 0
  for (const row of rows) {
    if (!isSortable(row)) continue
    const state = sortState(row)
    if (state === "undecided") left++
    else if (state === "shown") shown++
    else if (state === "kept-hidden") keptHidden++
  }
  const decided = shown + keptHidden
  return { left, shown, keptHidden, decided, total: left + decided }
}

/** @type {Types.nextOpenMoment} */
export function nextOpenMoment(moments, isOpen, from) {
  // The first moment from `from` on that still holds a photo waiting for a
  // decision, wrapping round once, so a skipped moment comes back at the end.
  const n = moments.length
  for (let step = 0; step < n; step++) {
    const i = (((from + step) % n) + n) % n
    if (moments[i].ids.some(isOpen)) return i
  }
  return -1
}

/** @type {Types.momentLabel} */
export function momentLabel(count, spanMs) {
  if (count <= 1) return "1 photo"
  if (spanMs === null) return `${count} photos`
  const seconds = Math.round(spanMs / 1000)
  if (seconds < 1) return `${count} shots in under a second`
  if (seconds < 60) return `${count} shots in ${seconds} second${seconds === 1 ? "" : "s"}`
  const minutes = Math.round(seconds / 60)
  return `${count} shots in ${minutes} minute${minutes === 1 ? "" : "s"}`
}
