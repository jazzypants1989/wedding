/** @file The guestbook's meadow: one band of the newest notes' flowers,
 *  oldest at the back, so the garden visibly fills in. Laid out once per
 *  change; each plant is its own small layer that sways from its root, so the
 *  breeze is a compositor-only transform — no repaint, no main-thread work.
 *  Tapping a flower opens its note. Decorative (aria-hidden): the cards below
 *  carry every word, and the same flower. */
/** @import * as Types from "./types.js" */

import { growFlower } from "../../components/note-flower.js"

/** The band never holds more than this many flowers. */
export const MEADOW_MAX = 40

const NARROW = "(max-width: 700px)"

/** Seeded jitter so a flower keeps its plot between draws. @param {number} id */
function jitter(id) {
  let h = (id * 2654435761) >>> 0
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
}

/** @param {number} n */
const f = (n) => String(Math.round(n * 100) / 100)

/** @type {Types.renderMeadow} */
export function renderMeadow(host, entries) {
  const narrow = window.matchMedia(NARROW).matches
  const W = narrow ? 700 : 1100
  const H = narrow ? 330 : 280
  const list = entries.slice(0, MEADOW_MAX)
  const n = list.length
  const rows =
    n <= (narrow ? 6 : 10) ? 1 : n <= (narrow ? 20 : 30) ? 2 : Math.ceil(Math.sqrt(n / (narrow ? 2.5 : 4)))
  const perRow = Math.max(1, Math.ceil(n / rows))
  // Plots fill the middle 92%, so a jittered flower never runs off the edge.
  const slot = (W * 0.92) / Math.max(perRow, narrow ? 4 : 7)
  const base = Math.min(1.45, slot / 50)
  const front = H - 22
  const gap = rows > 1 ? Math.min(62, (H - 170) / (rows - 1)) : 0
  const oldestFirst = list.slice().reverse()

  /** @type {{ id: number, depth: number, x: number, y: number, w: number, h: number,
   *    ox: number, oy: number, view: string, markup: string, sway: number, lag: number }[]} */
  const plants = []
  // The band is cropped to its tallest flower, so a sparse garden isn't a void.
  let top = front - 30
  for (let r = 0; r < rows; r++) {
    const depth = rows === 1 ? 1 : 0.5 + (0.5 * r) / (rows - 1)
    const y = front - (rows - 1 - r) * gap
    const inRow = oldestFirst.slice(r * perRow, (r + 1) * perRow)
    const x0 = (W - inRow.length * slot) / 2 + (r % 2 ? slot * 0.25 : 0)
    inRow.forEach((e, i) => {
      const rand = jitter(e.id)
      const x = x0 + (i + 0.5) * slot + (rand() - 0.5) * 0.56 * slot
      const sc = base * depth * (0.88 + rand() * 0.2)
      const p = growFlower(e, { gold: e.pinned })
      const bw = p.box.x1 - p.box.x0
      const bh = p.box.y1 - p.box.y0
      top = Math.min(top, y + p.box.y0 * sc)
      plants.push({
        id: e.id,
        depth: Math.round(depth * 4),
        x: x + p.box.x0 * sc,
        y: y + p.box.y0 * sc,
        w: bw * sc,
        h: bh * sc,
        // The root (0,0) as a fraction of the box: the hinge it sways on.
        ox: -p.box.x0 / bw,
        oy: -p.box.y0 / bh,
        view: `${f(p.box.x0)} ${f(p.box.y0)} ${f(bw)} ${f(bh)}`,
        markup: p.markup,
        sway: Math.floor(rand() * 3),
        // The gust crosses from the left: a plant further right is further
        // behind in the same cycle. A little jitter keeps it from marching.
        lag: (x / W) * 2.6 + rand() * 0.6,
      })
    })
  }
  // "Room to grow": a near-empty garden shows seeds waiting in the soil (the
  // same seed the composer shows before the first word), not a void.
  let mounds = ""
  let seeds = ""
  const empty = Math.max(0, 8 - n)
  for (let i = 0; i < empty; i++) {
    const rand = jitter(i + 1)
    const x = (W * (i + 0.5)) / empty + (rand() - 0.5) * 40
    const y = front + 2
    mounds += `M${f(x - 28)} ${y}Q${f(x)} ${y - 16} ${f(x + 28)} ${y}Z`
    seeds += `M${f(x - 7)} ${y - 8}a7 5 0 1 0 14 0a7 5 0 1 0 -14 0`
  }
  const plots = empty
    ? `<path class="gb-meadow-mound" d="${mounds}"/><path class="gb-meadow-seed" d="${seeds}"/>`
    : ""
  // The ground fades out at both ends, so the bed has no hard edges.
  const ground =
    `<linearGradient id="gb-meadow-soil"><stop offset="0" class="gb-soil-end"/><stop offset="0.14" class="gb-soil"/>` +
    `<stop offset="0.86" class="gb-soil"/><stop offset="1" class="gb-soil-end"/></linearGradient>` +
    `<path class="gb-meadow-ground" fill="url(#gb-meadow-soil)" d="M0 ${front - 4}C${W * 0.25} ${front - 14} ${W * 0.6} ${front + 6} ${W} ${front - 8}L${W} ${H}L0 ${H}Z"/>`
  const y0 = Math.max(0, Math.floor(top - 8))
  const VH = H - y0
  const beds = plants
    .map(
      (p) =>
        `<div class="gb-meadow-plant gb-depth${p.depth} gb-sway${p.sway}" data-id="${p.id}">` +
        `<svg class="gb-meadow-svg" viewBox="${p.view}" preserveAspectRatio="none" focusable="false">${p.markup}</svg></div>`,
    )
    .join("")
  host.innerHTML =
    `<div class="gb-meadow-stage"><svg class="gb-meadow-bed" viewBox="0 ${y0} ${W} ${VH}" preserveAspectRatio="none" focusable="false">${ground}${plots}</svg>${beds}</div>`
  // Geometry goes through the CSSOM (the page's CSP refuses style attributes).
  const stage = /** @type {HTMLElement} */ (host.firstElementChild)
  stage.style.aspectRatio = `${W} / ${VH}`
  stage.style.setProperty("--meadow-ratio", f(W / VH))
  const pct = (/** @type {number} */ v) => `${f(v * 100)}%`
  stage.querySelectorAll(".gb-meadow-plant").forEach((el, i) => {
    const p = plants[i]
    const s = /** @type {HTMLElement} */ (el).style
    s.left = pct(p.x / W)
    s.top = pct((p.y - y0) / VH)
    s.width = pct(p.w / W)
    s.height = pct(p.h / VH)
    s.transformOrigin = `${pct(p.ox)} ${pct(p.oy)}`
    s.animationDelay = `${f(-p.lag)}s`
  })
}

/** @type {Types.initMeadow} */
export function initMeadow(host, getEntries, onPick) {
  const draw = () => renderMeadow(host, getEntries())
  host.addEventListener("click", (e) => {
    const t = e.target
    if (!(t instanceof Element)) return
    const plant = t.closest(".gb-meadow-plant")
    if (plant instanceof HTMLElement && plant.dataset.id) onPick(Number(plant.dataset.id))
  })
  // Re-lay only when the layout actually changes, never on every resize.
  window.matchMedia(NARROW).addEventListener("change", draw)
  // The breeze stops while the meadow is scrolled out of view, so its layers
  // cost nothing down the feed.
  const still = new IntersectionObserver(([e]) => {
    host.classList.toggle("gb-meadow-still", !e.isIntersecting)
  })
  still.observe(host)
  return draw
}
