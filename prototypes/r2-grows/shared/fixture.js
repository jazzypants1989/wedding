/** @file The shared fictional fixture, plus `?n=` to test the degenerate ends:
 *  `?n=3` keeps the three newest entries; `?n=300` synthesises more by
 *  deterministic recombination of the fixture's own (fictional) authors and
 *  sentences. No real guest appears anywhere. */

import { seeded } from "./seed.js"

/**
 * @typedef {{ id: number, message: string, author_name: string, created_at: string,
 *   reactions: Record<string, {count: number, mine: boolean}>, comment_count: number,
 *   fav: boolean, is_own?: boolean, status?: string }} Entry
 * @typedef {{ display: string, date: string, location: string }} Couple
 */

const SURNAMES = "Abara Bell Castillo Dunmore Esposito Fenwick Garza Halloran Iwu Jansen Kowalski Laurent Mbeki Novak Ortega Pham Quill Reyes Sato Tremblay Ueda Varga Whitcombe Yilmaz Zeller".split(" ")
const FIRSTS = "Ada Bram Cleo Dario Elif Finn Greta Hugo Isla Joon Kit Lena Milo Noor Otto Pia Quinn Rosa Sami Tess Ugo Vera Wes Xan Yara Zev".split(" ")

/** @param {string} msg @returns {string[]} */
function splitSentences(msg) {
  /** @type {string[]} */
  const out = []
  let cur = ""
  for (const ch of msg) {
    cur += ch
    if (ch === "." || ch === "!" || ch === "?") {
      if (cur.trim()) out.push(cur.trim())
      cur = ""
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** @returns {Promise<{couple: Couple, entries: Entry[], favs: Entry[]}>} */
export async function loadFixture() {
  const res = await fetch("/fixtures/entries.json")
  const data = await res.json()
  const n = Number(new URLSearchParams(location.search).get("n") || "0")
  const pinnedIds = new Set(data.pinned.map((/** @type {{id: number}} */ p) => p.id))
  /** @type {Entry[]} */
  let entries = data.entries.map((/** @type {any} */ e) => ({ ...e, fav: pinnedIds.has(e.id) }))

  if (n > 0 && n < entries.length) entries = entries.slice(0, n)
  if (n > entries.length) {
    const base = entries.slice()
    const pool = base.flatMap((e) => splitSentences(e.message))
    const extra = []
    for (let i = 0; extra.length < n - base.length; i++) {
      const s = seeded("synth" + i)
      const parts = s.int(1, 3)
      const msg = Array.from({ length: parts }, () => s.pick(pool)).join(" ")
      const author = s.chance(0.25) ? s.pick(FIRSTS) : s.pick(FIRSTS) + " " + s.pick(SURNAMES)
      const day = 26 + (i % 6)
      const hh = String(s.int(0, 23)).padStart(2, "0")
      const mm = String(s.int(0, 59)).padStart(2, "0")
      extra.push({
        id: 1000 + i,
        message: msg,
        author_name: author,
        created_at: "2026-" + (day > 30 ? "05-0" + (day - 30) : "04-" + day) + " " + hh + ":" + mm + ":00",
        reactions: s.chance(0.3) ? { heart: { count: s.int(1, 9), mine: false } } : {},
        comment_count: s.chance(0.2) ? s.int(1, 4) : 0,
        fav: s.chance(0.03),
      })
    }
    entries = base.concat(extra)
    entries.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))
  }
  return { couple: data.couple, entries, favs: entries.filter((e) => e.fav) }
}
