/** @file "Now", for the time sketches. `?at=YYYY-MM-DDTHH:MM` overrides the
 *  visitor's clock so any moment can be previewed (and screenshotted). */

import { anniversaryOf } from "./sun.js"

/** @typedef {{ y: number, mo: number, d: number, minutes: number }} Wall */

/** @param {number} n */
function pad(n) {
  return n < 10 ? "0" + n : String(n)
}

/** @param {string} s "YYYY-MM-DDTHH:MM" @returns {Wall | null} */
export function parseAt(s) {
  if (!s || !s.includes("T")) return null
  const [date, time] = s.split("T")
  const [y, mo, d] = date.split("-").map(Number)
  const [h, mi] = time.split(":").map(Number)
  if (!y || !mo || !d || Number.isNaN(h)) return null
  return { y, mo, d, minutes: h * 60 + (mi || 0) }
}

/** @returns {Wall} */
export function readNow() {
  const fromUrl = parseAt(new URL(location.href).searchParams.get("at") || "")
  if (fromUrl) return fromUrl
  const n = new Date()
  return { y: n.getFullYear(), mo: n.getMonth() + 1, d: n.getDate(), minutes: n.getHours() * 60 + n.getMinutes() }
}

/** @param {Wall} w */
export function formatAt(w) {
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(Math.floor(w.minutes / 60))}:${pad(w.minutes % 60)}`
}

/** Days from a to b, by calendar. @param {Wall} a @param {Wall} b */
export function daysBetween(a, b) {
  return (Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / 86400000 + (b.minutes - a.minutes) / 1440
}

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"]

/**
 * How long married, in words, plus the anniversary state.
 * @param {Wall} wedding @param {Wall} now
 */
export function marriedFor(wedding, now) {
  let months = (now.y - wedding.y) * 12 + (now.mo - wedding.mo)
  if (now.d < wedding.d) months--
  const years = Math.floor(months / 12)
  const isDay = now.mo === wedding.mo && now.d === wedding.d && now.y > wedding.y
  const gift = anniversaryOf(Math.max(0, years))
  let phrase
  if (months < 0) phrase = "Not married yet"
  else if (isDay) phrase = `${years === 1 ? "One year" : years + " years"} married today`
  else if (years === 0) phrase = months === 0 ? "Just married" : `${WORDS[months] || months} month${months === 1 ? "" : "s"} married`
  else phrase = `${years} year${years === 1 ? "" : "s"}${months % 12 ? `, ${months % 12} month${months % 12 === 1 ? "" : "s"}` : ""} married`
  phrase = phrase.charAt(0).toUpperCase() + phrase.slice(1)
  return { months, years: Math.max(0, years), isDay, gift, phrase }
}

/**
 * Preview presets for a wedding date.
 * @param {Wall} wedding
 * @returns {{ label: string, at: string }[]}
 */
export function presets(wedding) {
  const at = (/** @type {number} */ addY, /** @type {number} */ addMo, /** @type {number} */ minutes) => {
    const d = new Date(Date.UTC(wedding.y + addY, wedding.mo - 1 + addMo, wedding.d))
    return formatAt({ y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), minutes })
  }
  return [
    { label: "Wedding night", at: at(0, 0, 22 * 60 + 30) },
    { label: "Six months · dawn", at: at(0, 6, 5 * 60 + 50) },
    { label: "1st · paper · 10 pm", at: at(1, 0, 22 * 60) },
    { label: "2nd · cotton · noon", at: at(2, 0, 12 * 60 + 30) },
    { label: "5th · wood · golden hour", at: at(5, 0, 19 * 60 + 40) },
    { label: "25th · silver", at: at(25, 0, 16 * 60) },
    { label: "50th · gold", at: at(50, 0, 9 * 60) },
  ]
}
