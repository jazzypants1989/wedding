/** @file Relative time formatting + <time datetime> upgrading (no regex) */
/** @import * as Types from "./types.js" */

import { formatDate } from "../pages/utils.js"

/** @type {{ amount: number, unit: Intl.RelativeTimeFormatUnit }[]} */
const DIVISIONS = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
]

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

/**
 * Parse a timestamp that may be a full ISO string (…Z, from now()) OR a SQLite
 * CURRENT_TIMESTAMP value ("YYYY-MM-DD HH:MM:SS", UTC with no zone). Without the
 * zone fix `new Date()` reads the bare form as LOCAL time, which flips a fresh
 * entry to "in 7 hours". No regex — pure string ops.
 * @param {string} value
 * @returns {Date}
 */
function parseTimestamp(value) {
  let s = value
  if (s.includes(" ") && !s.includes("T")) s = s.replace(" ", "T")
  const tIdx = s.indexOf("T")
  const timePart = tIdx === -1 ? "" : s.slice(tIdx)
  const hasZone =
    timePart.endsWith("Z") || timePart.includes("+") || timePart.includes("-")
  if (!hasZone) s = s + "Z"
  return new Date(s)
}

/** @type {Types.formatRelative} */
export function formatRelative(iso) {
  const then = parseTimestamp(iso).getTime()
  if (Number.isNaN(then)) return ""
  // Seconds from now; negative = in the past (the common case for a feed).
  let duration = (then - Date.now()) / 1000
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit)
    }
    duration /= division.amount
  }
  return ""
}

/** @type {Types.upgradeTimes} */
export function upgradeTimes(root = document) {
  root.querySelectorAll("time[datetime]").forEach((el) => {
    if (!(el instanceof HTMLTimeElement)) return
    const iso = el.dateTime
    if (!iso) return
    const date = parseTimestamp(iso)
    if (Number.isNaN(date.getTime())) return
    // Normalize the attribute to a valid ISO instant while we're here.
    el.dateTime = date.toISOString()
    const rel = formatRelative(iso)
    if (rel) el.textContent = rel
    el.title = formatDate(date.toISOString())
  })
}
