/** @file The general chart: the couple's island at the centre, every note's
 *  island around it on a phyllotaxis spiral (oldest nearest the couple), ferry
 *  routes between notes that share a word, a portolan compass, a graticule
 *  with grid references (the gazetteer cites them), and a scale in words. */

import { raiseIsland, routeWords } from "./island.js"
import { seeded, f } from "../shared/seed.js"
import { esc } from "../shared/text.js"

/** @import { Entry, Couple } from "../shared/fixture.js" */

/** Words too common at a wedding to make a route mean anything. */
const COMMON = new Set(["wedding", "wed", "day", "years", "year", "wish", "two", "together", "much", "great", "time", "first", "never", "always"])

/**
 * @typedef {{ e: Entry, x: number, y: number, s: number, name: string, R: number, ref: string, summit: string | null, bay: string | null }} Placed
 * @param {Entry[]} entries newest first
 * @param {Couple} couple
 * @param {{ W: number, H: number, routes?: boolean, links?: boolean, labels?: "all" | "big" | "none", rough?: number, fresh?: number | null }} o
 * @returns {{ svg: string, placed: Placed[] }}
 */
export function chartSVG(entries, couple, o) {
  const { W, H } = o
  const list = entries.slice().reverse()
  const n = list.length
  const cx = W / 2
  const cy = H / 2
  const coupleEntry = /** @type {Entry} */ ({ id: 0, author_name: couple.display, message: "Two people said yes. Everyone came. We ate, we danced, we cried, and it was the best day of all our lives together.", created_at: couple.date + " 16:00:00", reactions: {}, comment_count: 0, fav: false })
  const home = raiseIsland(coupleEntry, { rough: o.rough })

  // Scale islands so the archipelago fills the sea at any n.
  const isl = list.map((e) => raiseIsland(e, { rough: o.rough }))
  const area = isl.reduce((a, x) => a + x.R * x.R, 0) + home.R * home.R
  const s = Math.min(1.25, Math.sqrt((W * H * 0.3) / (Math.PI * area)))
  const biggest = Math.max(1, ...isl.map((x) => x.R)) * s
  const homeS = Math.max(s, (biggest * 1.1) / home.R, (Math.min(W, H) * 0.09) / home.R)

  /** @type {Placed[]} */
  const placed = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  const ax = W * 0.44
  const ay = H * 0.42
  list.forEach((e, k) => {
    const t = Math.sqrt((k + 1.5) / (n + 1.5))
    const a = k * golden + 0.7
    placed.push({ e, x: cx + Math.cos(a) * ax * t, y: cy + Math.sin(a) * ay * t, s, name: isl[k].name, R: isl[k].R * s, ref: "", summit: isl[k].summit, bay: isl[k].bay })
  })
  // Relax overlaps (deterministic: fixed iteration count, fixed order).
  const homeR = home.R * homeS
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i]
      for (let j = i + 1; j < placed.length; j++) {
        const q = placed[j]
        const dx = q.x - p.x
        const dy = q.y - p.y
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01
        const min = (p.R + q.R) * 0.86
        if (d < min) {
          const push = (min - d) / 2
          p.x -= (dx / d) * push
          p.y -= (dy / d) * push
          q.x += (dx / d) * push
          q.y += (dy / d) * push
        }
      }
      const dx = p.x - cx
      const dy = p.y - cy
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const min = (p.R + homeR) * 0.95
      if (d < min) {
        p.x = cx + (dx / d) * min
        p.y = cy + (dy / d) * min
      }
      const m = 24
      p.x = Math.min(W - m - p.R * 0.6, Math.max(m + p.R * 0.6, p.x))
      p.y = Math.min(H - m - p.R * 0.6 - 10, Math.max(46 + p.R * 0.6, p.y))
    }
  }

  // Grid references: columns A…, rows 1….
  const cols = Math.max(4, Math.round(W / 125))
  const rows = Math.max(3, Math.round(H / 125))
  const cw = W / cols
  const rh = H / rows
  for (const p of placed) p.ref = String.fromCharCode(65 + Math.min(cols - 1, Math.floor(p.x / cw))) + (1 + Math.min(rows - 1, Math.floor(p.y / rh)))

  let grat = ""
  for (let i = 1; i < cols; i++) grat += `M${f(i * cw)} 0V${H}`
  for (let j = 1; j < rows; j++) grat += `M0 ${f(j * rh)}H${W}`
  let ticks = ""
  for (let i = 0; i < cols; i++) ticks += `<text x="${f((i + 0.5) * cw)}" y="9">${String.fromCharCode(65 + i)}</text><text x="${f((i + 0.5) * cw)}" y="${H - 3}">${String.fromCharCode(65 + i)}</text>`
  for (let j = 0; j < rows; j++) ticks += `<text x="7" y="${f((j + 0.5) * rh + 3)}">${j + 1}</text><text x="${W - 7}" y="${f((j + 0.5) * rh + 3)}">${j + 1}</text>`

  // Portolan compass rose in the emptiest corner-ish spot, with rhumb lines.
  const corners = [
    [W * 0.12, H * 0.84],
    [W * 0.88, H * 0.16],
    [W * 0.88, H * 0.84],
    [W * 0.12, H * 0.16],
  ]
  let best = corners[0]
  let bestD = -1
  for (const c of corners) {
    let dmin = Infinity
    for (const p of placed) dmin = Math.min(dmin, Math.hypot(p.x - c[0], p.y - c[1]) - p.R)
    if (dmin > bestD) {
      bestD = dmin
      best = c
    }
  }
  const rc = Math.max(22, Math.min(46, bestD * 0.8))
  let rhumbs = ""
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2
    rhumbs += `M${f(best[0])} ${f(best[1])}l${f(Math.cos(a) * W * 1.2)} ${f(Math.sin(a) * W * 1.2)}`
  }
  let rose = ""
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 - Math.PI / 2
    const L = k % 4 === 0 ? rc : k % 2 === 0 ? rc * 0.62 : rc * 0.4
    const wv = k % 4 === 0 ? rc * 0.13 : rc * 0.09
    const tip = [Math.cos(a) * L, Math.sin(a) * L]
    const l = [Math.cos(a - Math.PI / 2) * wv, Math.sin(a - Math.PI / 2) * wv]
    rose += `<path class="${k % 2 ? "ar-rose-b" : "ar-rose-a"}" d="M${f(l[0])} ${f(l[1])}L${f(tip[0])} ${f(tip[1])}L${f(-l[0])} ${f(-l[1])}Z"/>`
  }
  const roseSVG = `<g class="ar-rose" transform="translate(${f(best[0])} ${f(best[1])})"><circle r="${f(rc * 0.78)}"/>${rose}<circle class="ar-rose-hub" r="${f(rc * 0.07)}"/><text y="${f(-rc - 4)}">N</text></g>`

  // Ferry routes between notes sharing a particular word (rarer words first).
  let routes = ""
  let routeLabels = ""
  if (o.routes !== false && n > 1) {
    /** @type {Map<string, number[]>} */
    const by = new Map()
    placed.forEach((p, i) => {
      for (const w of routeWords(p.e)) {
        if (COMMON.has(w) || w.length < 4) continue
        const l = by.get(w)
        if (l) l.push(i)
        else by.set(w, [i])
      }
    })
    const shared = Array.from(by.entries()).filter(([, l]) => l.length >= 2 && l.length <= 5)
    shared.sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1))
    const deg = new Array(placed.length).fill(0)
    let count = 0
    const cap = Math.min(40, Math.max(3, Math.round(n * 0.6)))
    for (const [w, l] of shared) {
      for (let k = 0; k + 1 < l.length && count < cap; k++) {
        const i = l[k]
        const j = l[k + 1]
        if (deg[i] >= 2 || deg[j] >= 2) continue
        if (Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y) > Math.max(W, H) * 0.42) continue
        deg[i]++
        deg[j]++
        count++
        const p = placed[i]
        const q = placed[j]
        const mx = (p.x + q.x) / 2
        const my = (p.y + q.y) / 2
        const dx = q.x - p.x
        const dy = q.y - p.y
        const len = Math.hypot(dx, dy) || 1
        const bend = seeded("route" + w).range(0.12, 0.24) * len
        const ux = (-dy / len) * bend
        const uy = (dx / len) * bend
        // Leave and arrive at the shore, not the summit.
        const a0 = [p.x + (dx / len) * p.R * 0.75, p.y + (dy / len) * p.R * 0.75]
        const a1 = [q.x - (dx / len) * q.R * 0.75, q.y - (dy / len) * q.R * 0.75]
        const rtl = a1[0] < a0[0]
        const id = "rt" + i + "-" + j
        const d = rtl
          ? `M${f(a1[0])} ${f(a1[1])}Q${f(mx + ux)} ${f(my + uy)} ${f(a0[0])} ${f(a0[1])}`
          : `M${f(a0[0])} ${f(a0[1])}Q${f(mx + ux)} ${f(my + uy)} ${f(a1[0])} ${f(a1[1])}`
        routes += `<path id="${id}" class="ar-route" d="${d}"/>`
        if (len > 90) routeLabels += `<text class="ar-t-route" dy="-3"><textPath href="#${id}" startOffset="50%">${esc(w)}</textPath></text>`
      }
    }
  }

  // Islands.
  let islands = ""
  let labels = ""
  const labelMode = o.labels ?? "all"
  const homeLab = `<text class="ar-t-home" x="${f(cx)}" y="${f(cy + homeR * 0.62)}">${esc(couple.display.toUpperCase())}</text>`
  islands += `<g class="ar-home" transform="translate(${f(cx)} ${f(cy)}) scale(${f(homeS)})">${home.markup}</g>`
  placed.forEach((p, k) => {
    const cls = "ar-isle" + (p.e.id === o.fresh ? " is-fresh" : "")
    const g = `<g transform="translate(${f(p.x)} ${f(p.y)}) scale(${f(p.s)})">${isl[k].markup}</g>`
    islands += o.links ? `<a href="#e-${p.e.id}" class="${cls}" data-id="${p.e.id}" aria-label="${esc(p.name)}">${g}</a>` : `<g class="${cls}">${g}</g>`
    const show = labelMode === "all" || (labelMode === "big" && (p.R > 22 || p.e.fav))
    if (show) {
      const fs = Math.max(7, Math.min(13, 6 + p.R * 0.1))
      labels += `<text class="ar-t-isle${p.e.fav ? " is-fav" : ""}" x="${f(p.x)}" y="${f(p.y + p.R * 0.9 + fs)}" font-size="${f(fs)}" data-id="${p.e.id}">${esc(p.e.fav ? p.name.toUpperCase() : p.name)}</text>`
    }
  })

  // The sea's own name, across the widest gap.
  const seaName = `<text class="ar-t-sea" x="${f(W * 0.5)}" y="36">The Sea of Good Wishes</text>`
  const scale = `<g class="ar-scale" transform="translate(${f(W - 150)} ${f(H - 26)})"><path d="M0 0h100M0 -4v8M50 -3v6M100 -4v8"/><text x="50" y="-7">ten words</text></g>`

  const svg = `<svg class="ar-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" focusable="false">
    <rect class="ar-sea" width="${W}" height="${H}"/>
    <path class="ar-rhumb" d="${rhumbs}"/>
    <path class="ar-grat" d="${grat}"/>
    ${seaName}
    ${routes}${islands}${routeLabels}${labels}${homeLab}
    ${roseSVG}${scale}
    <rect class="ar-border" x="1" y="1" width="${W - 2}" height="${H - 2}"/><rect class="ar-border-in" x="13" y="13" width="${W - 26}" height="${H - 26}"/>
    <g class="ar-ticks">${ticks}</g>
  </svg>`
  return { svg, placed }
}
