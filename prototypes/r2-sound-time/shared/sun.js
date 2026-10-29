/** @file Where the sun was. Pure and deterministic: a wall-clock time at the
 *  venue in, the sun's elevation and azimuth out. Good to a degree or two,
 *  which is far finer than a drop shadow can show.
 *
 *  Uses the textbook approximation: declination from the day of the year,
 *  hour angle from solar time. Solar time is the venue's clock minus daylight
 *  saving and the longitude's offset from its zone meridian. The equation of
 *  time (±16 min) is ignored on purpose.
 */

const RAD = Math.PI / 180

/** Portland, OR — from the fixture's location. Zone UTC−8, PDT in spring. */
export const VENUE = { lat: 45.52, lon: -122.68, zoneHours: -8, dst: true }

/** @param {number} y @param {number} mo 1..12 @param {number} d */
export function dayOfYear(y, mo, d) {
  return Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 86400000)
}

/**
 * @param {{ y: number, mo: number, d: number, minutes: number }} t wall-clock at the venue
 * @param {typeof VENUE} [place]
 * @returns {{ elevation: number, azimuth: number }} degrees; azimuth clockwise from north
 */
export function sunAt(t, place) {
  const p = place || VENUE
  const n = dayOfYear(t.y, t.mo, t.d)
  const decl = -23.44 * Math.cos(((360 / 365) * (n + 10)) * RAD)
  const clock = t.minutes / 60
  const meridian = p.zoneHours * 15
  const solar = clock - (p.dst ? 1 : 0) + (p.lon - meridian) / 15
  const hourAngle = 15 * (solar - 12)
  const lat = p.lat * RAD
  const dr = decl * RAD
  const ha = hourAngle * RAD
  const sinEl = Math.sin(lat) * Math.sin(dr) + Math.cos(lat) * Math.cos(dr) * Math.cos(ha)
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)))
  const cosAz = (Math.sin(dr) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat))
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / RAD
  if (hourAngle > 0) az = 360 - az
  return { elevation: el / RAD, azimuth: az }
}

/**
 * The shadow a card casts, laid flat on the page with north at the top.
 * Sun in the south → shadow falls up the page. Below the horizon → no
 * shadow; the card is lamplit instead.
 * @param {{ elevation: number, azimuth: number }} sun
 * @param {number} [maxLen] px
 * @returns {{ dx: number, dy: number, blur: number, warmth: number, night: boolean }}
 */
export function shadowOf(sun, maxLen) {
  const max = maxLen || 26
  if (sun.elevation <= 0) return { dx: 0, dy: 0, blur: 18, warmth: 1, night: true }
  const len = Math.min(max, 4 + 6 / Math.tan(Math.max(3, sun.elevation) * RAD))
  const away = (sun.azimuth + 180) * RAD
  return {
    dx: Math.round(Math.sin(away) * len * 10) / 10,
    dy: Math.round(-Math.cos(away) * len * 10) / 10,
    blur: Math.round(6 + (len / max) * 10),
    // Low sun is gold; high sun is white.
    warmth: Math.round(Math.max(0, Math.min(1, 1 - sun.elevation / 35)) * 100) / 100,
    night: false,
  }
}

/** The canonical hours, the chapters of a Book of Hours. */
export const HOURS = [
  { id: "matins", name: "Matins", sub: "in the night", from: 0, to: 3 },
  { id: "lauds", name: "Lauds", sub: "before dawn", from: 3, to: 6 },
  { id: "prime", name: "Prime", sub: "at sunrise", from: 6, to: 9 },
  { id: "terce", name: "Terce", sub: "in the morning", from: 9, to: 12 },
  { id: "sext", name: "Sext", sub: "at midday", from: 12, to: 15 },
  { id: "none", name: "None", sub: "in the afternoon", from: 15, to: 18 },
  { id: "vespers", name: "Vespers", sub: "at evening", from: 18, to: 21 },
  { id: "compline", name: "Compline", sub: "before sleep", from: 21, to: 24 },
]

/** @param {number} minutes since midnight */
export function canonicalHour(minutes) {
  const h = Math.floor(minutes / 60) % 24
  return HOURS.find((x) => h >= x.from && h < x.to) || HOURS[0]
}

/** Traditional anniversary gifts. Year 0 is the first year: fresh ink. */
export const ANNIVERSARIES = /** @type {Record<number, { name: string, accent: string }>} */ ({
  0: { name: "fresh ink", accent: "" },
  1: { name: "paper", accent: "#9a7b52" },
  2: { name: "cotton", accent: "#7d8fa6" },
  3: { name: "leather", accent: "#7a4a2a" },
  4: { name: "linen", accent: "#8f8a6a" },
  5: { name: "wood", accent: "#8a5a2b" },
  6: { name: "iron", accent: "#5b5f66" },
  7: { name: "wool", accent: "#8a6f5a" },
  8: { name: "bronze", accent: "#9a6a2e" },
  9: { name: "pottery", accent: "#a2573a" },
  10: { name: "tin", accent: "#7f8a94" },
  15: { name: "crystal", accent: "#5f8fa8" },
  20: { name: "china", accent: "#4a6aa0" },
  25: { name: "silver", accent: "#8a929c" },
  30: { name: "pearl", accent: "#a09a90" },
  40: { name: "ruby", accent: "#a01e3a" },
  50: { name: "gold", accent: "#b8892c" },
  60: { name: "diamond", accent: "#6a8aa8" },
})

/** The gift for a given completed year (falls back to the last named one). @param {number} years */
export function anniversaryOf(years) {
  let best = 0
  for (const k of Object.keys(ANNIVERSARIES)) {
    const n = Number(k)
    if (n <= years && n > best) best = n
  }
  return { year: best, ...ANNIVERSARIES[best] }
}
