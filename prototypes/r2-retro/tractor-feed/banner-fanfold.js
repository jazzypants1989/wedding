/** @file book slot: `banner-fanfold` — the memory book prints the way a
 *  1989 home computer printed: first a Print Shop banner of the couple's names
 *  running sideways across several pages (tear them off still joined, tape
 *  the strip up at the anniversary party), then the whole guestbook as a
 *  green-bar listing on continuous-form paper, sprocket holes and all.
 *
 *  decorate(root, ctx) adds the banner pages, the listing header and the
 *  fixed paper layers (strips + bars repeat on every printed page, because
 *  Chrome repeats position:fixed boxes per page). Everything is SVG or CSS.
 */

import { layout } from "./font57.js"

/** @typedef {{ couple: string, date: string, location: string, total: number, bannerPages: number, bannerText?: string }} FanfoldContext */

/** Content box of one banner page, in inches (letter, inside the strips). */
const PAGE_W = 6.3
const PAGE_H = 10

/**
 * The banner, rotated so it reads down the paper: glyph tops face right, the
 * way Print Shop fed a banner through sideways. Returns one SVG per page, each
 * a window (viewBox) onto the same tall drawing.
 * @param {string} text @param {number} pages
 */
export function bannerPages(text, pages) {
  const { dots, width } = layout(text.toUpperCase())
  const total = width + 4 // a little lead-in and run-out
  const perPage = total / pages // banner units down one page
  const across = perPage * (PAGE_W / PAGE_H) // units across one page
  const left = (across - 7) / 2
  let body = ""
  for (const [x, y] of dots) {
    const cx = 6 - y + 0.5
    const cy = x + 2 + 0.5
    body += `<circle cx="${cx.toFixed(2)}" cy="${cy}" r="0.44"/><circle cx="${(cx + 0.08).toFixed(2)}" cy="${cy + 0.1}" r="0.4"/>`
  }
  /** @type {string[]} */
  const out = []
  for (let k = 0; k < pages; k++) {
    const vb = `${(-left).toFixed(3)} ${(k * perPage).toFixed(3)} ${across.toFixed(3)} ${perPage.toFixed(3)}`
    out.push(
      `<svg class="bf-banner-svg" viewBox="${vb}" preserveAspectRatio="xMidYMin meet" aria-hidden="true" focusable="false"><g>${body}</g></svg>`,
    )
  }
  return out
}

/** @param {string} cls @param {string} [text] */
function el(cls, text) {
  const e = document.createElement("div")
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/**
 * @param {HTMLElement} root the <html> element
 * @param {FanfoldContext} ctx
 */
export function decorate(root, ctx) {
  const doc = root.ownerDocument
  const book = /** @type {HTMLElement} */ (doc.querySelector(".mb-book"))
  const stamp = `${ctx.date.slice(5, 7)}/${ctx.date.slice(8, 10)}/${ctx.date.slice(2, 4)}`

  // Paper layers: on screen they are the stream's background; in print they
  // are position:fixed and repeat on every sheet.
  const paper = el("bf-paper")
  paper.setAttribute("aria-hidden", "true")
  paper.append(el("bf-strip bf-strip-left"), el("bf-strip bf-strip-right"), el("bf-bars"))
  doc.body.prepend(paper)

  // ---- banner ----
  if (ctx.bannerPages > 0) {
    const banner = el("bf-banner")
    banner.setAttribute("aria-hidden", "true")
    for (const svg of bannerPages(ctx.bannerText || ctx.couple, ctx.bannerPages)) {
      const page = el("bf-banner-page")
      page.innerHTML = svg
      banner.appendChild(page)
    }
    const note = el("bf-banner-note", "<- end of banner: tape the pages end to end and hang it up ->")
    banner.lastElementChild?.appendChild(note)
    book.prepend(banner)
  }

  // ---- listing header (the cover's real text stays for assistive tech) ----
  const cover = /** @type {HTMLElement} */ (doc.querySelector(".mb-cover"))
  cover.classList.add("bf-cover")
  const head = el("bf-head")
  head.setAttribute("aria-hidden", "true")
  const rule = "=".repeat(78)
  head.textContent =
    `${rule}\n` +
    `GUESTBK.TXT              ${ctx.couple.toUpperCase()}              ${stamp}\n` +
    `${ctx.location.toUpperCase()}${" ".repeat(Math.max(2, 60 - ctx.location.length))}${String(ctx.total).padStart(4, "0")} RECORDS\n` +
    `${rule}`
  cover.after(head)

  const count = doc.querySelector(".mb-count")
  if (count) count.textContent = `*** END OF FILE *** ${ctx.total} RECORDS *** THANK YOU FOR COMING ***`
}
