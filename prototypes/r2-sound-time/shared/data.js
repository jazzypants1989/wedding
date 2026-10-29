/** @file Fixture loading for the round-2 sound/time/space sketches.
 *
 *  Reads the shared synthetic fixture (fictional guests only). `?n=3` trims it,
 *  `?n=300` grows it with deterministic made-up signers so the sketches can be
 *  checked at both ends. Nothing here is random at runtime: the same `n` gives
 *  the same entries on every load.
 */

/**
 * @typedef {{
 *   id: number,
 *   message: string,
 *   author_name: string,
 *   created_at: string,
 *   reactions: Record<string, { count: number, mine: boolean }>,
 *   comment_count: number,
 *   favourite: boolean
 * }} Entry
 * @typedef {{ display: string, date: string, location: string }} Couple
 */

const FIRST = [
  "Ada", "Bram", "Céline", "Dario", "Esme", "Florian", "Greta", "Hugo", "Isla", "Joaquín",
  "Kofi", "Lena", "Mateo", "Noor", "Otto", "Paloma", "Quinn", "Rosa", "Silas", "Tamsin",
  "Ulla", "Viktor", "Willa", "Xiomara", "Yusuf", "Zelda",
]
const LAST = [
  "Ashby", "Brennan", "Castellanos", "Duarte", "Eklund", "Farrow", "Gallo", "Hollis",
  "Ilves", "Jovanović", "Kerr", "Lindgren", "Moreau", "Nakamura", "Oyelaran", "Pryce",
]

/** Small deterministic PRNG (mulberry32) so a grown fixture is stable. @param {number} seed */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** @param {number} n @returns {string} */
function pad(n) {
  return n < 10 ? "0" + n : String(n)
}

/**
 * @returns {Promise<{ couple: Couple, entries: Entry[] }>} entries newest first
 */
export async function loadEntries() {
  const res = await fetch("/fixtures/entries.json")
  const data = await res.json()
  const pinned = new Set((data.pinned || []).map((/** @type {{ id: number }} */ p) => p.id))
  /** @type {Entry[]} */
  const base = data.entries.map((/** @type {any} */ e) => ({
    id: e.id,
    message: e.message,
    author_name: e.author_name,
    created_at: e.created_at,
    reactions: e.reactions || {},
    comment_count: e.comment_count || 0,
    favourite: pinned.has(e.id),
  }))
  // The pinned favourite's full text lives in `pinned` (the feed copy may be shorter).
  for (const p of data.pinned || []) {
    const hit = base.find((e) => e.id === p.id)
    if (hit) hit.message = p.message
  }

  const want = Number(new URL(location.href).searchParams.get("n")) || base.length
  if (want <= base.length) return { couple: data.couple, entries: base.slice(0, want) }

  const rand = rng(426)
  const extra = []
  const start = Date.UTC(2026, 3, 26, 18, 0)
  for (let i = 0; i < want - base.length; i++) {
    const src = base[Math.floor(rand() * base.length)]
    const name = FIRST[Math.floor(rand() * FIRST.length)] + " " + LAST[Math.floor(rand() * LAST.length)]
    const d = new Date(start + Math.floor(rand() * 14 * 24 * 60) * 60000)
    const hearts = rand() < 0.3 ? Math.ceil(rand() * 9) : 0
    extra.push({
      id: 1000 + i,
      message: src.message,
      author_name: name,
      created_at:
        d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + " " +
        pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":00",
      reactions: hearts ? { heart: { count: hearts, mine: false } } : {},
      comment_count: 0,
      favourite: false,
    })
  }
  const all = base.concat(extra)
  all.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  return { couple: data.couple, entries: all }
}

/**
 * Parse "YYYY-MM-DD HH:MM:SS" as a wall-clock time (no timezone games).
 * @param {string} s
 */
export function wallClock(s) {
  const [date, time] = s.split(" ")
  const [y, mo, d] = date.split("-").map(Number)
  const [h, mi] = (time || "0:0").split(":").map(Number)
  return { y, mo, d, h, mi, minutes: h * 60 + mi }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "Apr 28" @param {string} s */
export function shortDate(s) {
  const w = wallClock(s)
  return MONTHS[w.mo - 1] + " " + w.d
}

/** "3:36 am" @param {number} minutes since midnight */
export function clockLabel(minutes) {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return h12 + ":" + pad(m) + (h < 12 ? " am" : " pm")
}

/** Escape text for innerHTML. Plain replaceAll, no regex. @param {string} s */
export function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
