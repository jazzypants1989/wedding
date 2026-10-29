/** @file The coverlet: every note's cloth pieced into one blanket, oldest
 *  first, framed by a border woven from the couple's own names. Slots not yet
 *  woven show bare warp, still on the loom; a fringe hangs below. Used by the
 *  guestbook's background band and the book's cover. */

import { clothSVG } from "./weave.js"
import { seeded, f } from "../shared/seed.js"
import { esc } from "../shared/text.js"

/** @import { Entry, Couple } from "../shared/fixture.js" */

/** Place an <svg> returned by clothSVG at (x, y, s). @param {string} svg @param {number} x @param {number} y @param {number} s */
function at(svg, x, y, s) {
  return svg.replace("<svg ", `<svg x="${f(x)}" y="${f(y)}" width="${f(s)}" height="${f(s)}" `)
}

/**
 * @param {Entry[]} entries newest first, as the feed holds them
 * @param {Couple} couple
 * @param {{cols: number, ends: number, links?: boolean, fringe?: boolean, minSlots?: number, fresh?: number | null}} o
 */
export function coverletSVG(entries, couple, o) {
  const list = entries.slice().reverse()
  const n = list.length
  const slots = Math.max(n, o.minSlots ?? 0)
  const cols = Math.min(o.cols, Math.max(3, slots))
  const rows = Math.ceil(slots / cols)
  const T = 100
  const B = 26 // border band
  const W = cols * T + 2 * B
  const H = rows * T + 2 * B
  const fringe = o.fringe ? 46 : 0
  let tiles = ""
  list.forEach((e, i) => {
    const x = B + (i % cols) * T
    const y = B + Math.floor(i / cols) * T
    const svg = at(clothSVG(e, { ends: o.ends, plain: n > 120 }), x, y, T)
    const cls = "cv-tile" + (e.id === o.fresh ? " wv-weavable is-fresh" : "")
    tiles += o.links
      ? `<a href="#e-${e.id}" class="${cls}" data-id="${e.id}" aria-label="${esc(e.author_name)}'s square">${svg}<rect class="cv-hi" x="${x}" y="${y}" width="${T}" height="${T}"/></a>`
      : `<g class="${cls}">${svg}</g>`
  })
  // Bare warp in the slots still waiting for a guest.
  let bare = ""
  let bareBg = ""
  for (let i = n; i < rows * cols; i++) {
    const x = B + (i % cols) * T
    const y = B + Math.floor(i / cols) * T
    bareBg += `M${x} ${y}h${T}v${T}h${-T}Z`
    for (let k = 0; k < 14; k++) bare += `M${f(x + 4 + k * 7)} ${y}v${T}`
  }
  // Seams between squares: a running stitch.
  let seams = ""
  for (let i = 0; i < n; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    const x = B + c * T
    const y = B + r * T
    if (c < cols - 1) seams += `M${x + T} ${y}v${T}`
    if (r < rows - 1) seams += `M${x} ${y + T}h${T}`
  }
  // The border, woven from the couple: one strip of their cloth all the way round.
  const band = /** @type {Entry} */ ({ id: 0, author_name: couple.display, message: couple.display + " " + couple.date + " " + couple.location, created_at: couple.date, reactions: {}, comment_count: 0, fav: false })
  let border = ""
  const bc = clothSVG(band, { ends: 16, plain: true })
  for (let x = 0; x < W; x += B) {
    border += at(bc, x, 0, B) + at(bc, x, H - B, B)
  }
  for (let y = B; y < H - B; y += B) {
    border += at(bc, 0, y, B) + at(bc, W - B, y, B)
  }
  // Fringe: warp ends knotted into tassels.
  let fr = ""
  if (fringe) {
    for (let x = 6; x < W - 2; x += 6) {
      const s = seeded("fringe" + x)
      const len = fringe - 8 + s.range(-5, 5)
      const sway = s.range(-3, 3)
      fr += `M${x} ${H}q${f(sway)} ${f(len / 2)} ${f(sway * 0.4)} ${f(len)}`
    }
  }
  return `<svg class="cv-svg" viewBox="0 0 ${W} ${H + fringe}" preserveAspectRatio="xMidYMin meet" focusable="false">
    <rect class="cv-back" width="${W}" height="${H}"/>
    <g class="cv-border">${border}</g>
    <path class="cv-bare-bg" d="${bareBg}"/><path class="cv-bare" d="${bare}"/>
    ${tiles}
    <path class="cv-seam" d="${seams}"/>
    <path class="cv-fringe" d="${fr}"/>
  </svg>`
}

/** Column count that keeps the coverlet roughly blanket-shaped at any n.
 *  @param {number} n @param {boolean} narrow */
export function coverletCols(n, narrow) {
  if (narrow) return Math.max(4, Math.min(16, Math.ceil(Math.sqrt(n * 0.9))))
  return Math.max(6, Math.min(30, Math.ceil(Math.sqrt(n * 2.2))))
}
