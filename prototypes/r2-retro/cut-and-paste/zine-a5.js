/** @file book slot: `zine-a5` — the memory book is a real zine. Half-letter
 *  (or A5) pages, paginated by measuring, padded to a multiple of four, then
 *  IMPOSED for saddle-stitch: print double-sided (flip on short edge), fold the
 *  stack in half, staple the spine, and the pages come out in order.
 *
 *  decorate(root, ctx) is the book slot's JS hook. It moves the real
 *  .mb-entry elements into page boxes for the reading view (screen, and
 *  "single pages" print), and builds an aria-hidden imposed copy for the
 *  booklet print. Pure DOM + CSS; nothing here is canvas, so it prints.
 *
 *  Imposition for N pages (N % 4 == 0), printed side s = 0 … N/2 − 1:
 *    even s (a sheet's front): [N − s, s + 1]     odd s (its back): [s + 1, N − s]
 *  N = 8 → [8,1] [2,7] [6,3] [4,5].
 */

import { ransom } from "./ransom.js"

/** @typedef {{ couple: string, date: string, location: string, total: number,
 *   paper: "letter" | "a4", mode: "booklet" | "pages" }} ZineContext */

/** @param {string} cls @param {string} [text] */
function el(cls, text) {
  const e = document.createElement("div")
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** A blank page: inner frame, an optional head, a flowing body, a folio. */
function makePage(/** @type {string} */ kind) {
  const page = el(`zp zp-${kind}`)
  const inner = el("zp-inner")
  const body = el("zp-body")
  inner.appendChild(body)
  page.appendChild(inner)
  return { page, inner, body }
}

/** @param {HTMLElement} body */
function overflows(body) {
  return body.scrollHeight > body.clientHeight + 2
}

/**
 * @param {HTMLElement} root the <html> element
 * @param {ZineContext} ctx
 */
export function decorate(root, ctx) {
  const doc = root.ownerDocument
  root.dataset.zinePaper = ctx.paper
  root.dataset.zineMode = ctx.mode
  const book = /** @type {HTMLElement} */ (doc.querySelector(".mb-book"))
  const reading = el("zine-reading")
  reading.setAttribute("aria-label", "The zine, in reading order")
  book.appendChild(reading)

  const [y, m, d] = ctx.date.split("-")
  const when = new Date(Number(y), Number(m) - 1, Number(d))
  const dateText = when.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })

  /** @type {HTMLElement[]} */
  const pages = []
  /** @type {Array<{ label: string, page: number }>} */
  const contents = []

  // ---- 1. cover ----
  {
    const { page, body } = makePage("cover")
    body.append(el("zc-issue", `issue #1 · ${dateText.toLowerCase()} · free`))
    const title = el("zc-title")
    ransom(title, "our guest book", "zine-cover")
    body.append(title)
    const heart = el("zc-heart")
    heart.setAttribute("aria-hidden", "true")
    body.append(heart)
    body.append(el("zc-names", ctx.couple))
    body.append(el("zc-where", ctx.location.toLowerCase()))
    body.append(el("zc-count", `${ctx.total} letters from everyone who came`))
    body.append(el("zc-tag", "cut ✂ paste ✂ love"))
    reading.appendChild(page)
    pages.push(page)
  }

  // ---- 2. hello + contents (filled in once we know page numbers) ----
  const hello = makePage("hello")
  {
    const h = el("zp-head")
    ransom(h, "hello!", "zine-hello")
    hello.inner.prepend(h)
    const note = el("zh-note")
    note.textContent =
      `Dear reader,\n\nOn ${dateText} a room full of people in ${ctx.location} got very dressed up ` +
      `and very emotional. Then they wrote these. We cut them out, glued them down and ` +
      `photocopied the lot. We didn't change a word.\n\nThank you for coming. Thank you for writing.`
    hello.body.append(note)
    hello.body.append(el("zh-sign", `love, ${ctx.couple}`))
    reading.appendChild(hello.page)
    pages.push(hello.page)
  }

  // ---- 3. flow every section's entries into pages ----
  for (const section of doc.querySelectorAll(".mb-entries .mb-section")) {
    const fav = section.classList.contains("mb-section-favorites")
    const label = fav ? "the good stuff" : "letters"
    const entries = /** @type {HTMLElement[]} */ (Array.from(section.querySelectorAll(".mb-entry")))
    let current = makePage(fav ? "fav" : "letters")
    const head = el("zp-head")
    ransom(head, label, "zine-" + label)
    current.inner.prepend(head)
    const sub = el("zp-sub", fav ? "the couple's favourites, pinned to the fridge" : "every one, in the order they came in")
    current.inner.insertBefore(sub, current.body)
    reading.appendChild(current.page)
    pages.push(current.page)
    contents.push({ label, page: pages.length })
    for (const entry of entries) {
      const length = (entry.querySelector(".mb-entry-message")?.textContent || "").length
      if (length > 150) entry.classList.add("zp-wide")
      if (length <= 12) entry.classList.add("zp-tiny")
      current.body.appendChild(entry)
      if (overflows(current.body) && current.body.children.length > 1) {
        entry.remove()
        current = makePage(fav ? "fav" : "letters")
        reading.appendChild(current.page)
        pages.push(current.page)
        current.body.appendChild(entry)
      }
    }
  }

  // ---- 4. pad to a multiple of four with notes pages, then the back cover ----
  let notesAt = 0
  while ((pages.length + 1) % 4 !== 0) {
    const { page, inner, body } = makePage("notes")
    const h = el("zp-head")
    ransom(h, "notes", "zine-notes-" + pages.length)
    inner.prepend(h)
    body.append(el("zn-prompt", "doodles, pressed flowers, ticket stubs, more feelings →"))
    reading.appendChild(page)
    pages.push(page)
    if (!notesAt) notesAt = pages.length
  }
  if (notesAt) contents.push({ label: "notes", page: notesAt })
  {
    const { page, body } = makePage("back")
    const end = el("zb-end")
    ransom(end, "the end", "zine-end")
    body.append(end)
    body.append(el("zb-sub", "(the beginning, really)"))
    body.append(
      el(
        "zb-colophon",
        `made by ${ctx.total} guests and two very lucky people, with scissors, a glue stick ` +
          `and a borrowed photocopier. no rights reserved. copy it, share it, stick it on the fridge.`,
      ),
    )
    body.append(el("zb-staple", "staple here ↓"))
    reading.appendChild(page)
    pages.push(page)
  }

  // ---- 5. contents list + folios ----
  const toc = el("zh-toc")
  toc.append(el("zh-toc-title", "inside:"))
  for (const c of contents) {
    const row = el("zh-toc-row")
    row.append(el("zh-toc-label", c.label), el("zh-toc-dots"), el("zh-toc-page", "p." + c.page))
    toc.append(row)
  }
  hello.body.append(toc)
  pages.forEach((p, i) => {
    if (i === 0 || i === pages.length - 1) return
    const folio = el(`zp-folio ${(i + 1) % 2 === 0 ? "zp-folio-even" : "zp-folio-odd"}`, String(i + 1))
    folio.setAttribute("aria-hidden", "true")
    p.appendChild(folio)
    p.classList.add((i + 1) % 2 === 0 ? "zp-even" : "zp-odd")
  })

  // ---- 6. impose: an aria-hidden copy, one printed side per two pages ----
  const n = pages.length
  const sheets = el("zine-sheets")
  sheets.setAttribute("aria-hidden", "true")
  for (let s = 0; s < n / 2; s++) {
    const pair = s % 2 === 0 ? [n - s, s + 1] : [s + 1, n - s]
    const side = el(`zs-side ${s % 2 === 0 ? "zs-front" : "zs-back"}`)
    if (s === 0) side.classList.add("zs-outer")
    for (const num of pair) side.appendChild(pages[num - 1].cloneNode(true))
    side.append(el("zs-fold"), el("zs-tick zs-tick-top"), el("zs-tick zs-tick-bottom"))
    if (s === 0) side.append(el("zs-staple zs-staple-1"), el("zs-staple zs-staple-2"))
    sheets.appendChild(side)
  }
  book.appendChild(sheets)

  // Hide what the pages replaced; keep the cover heading for assistive tech.
  doc.querySelector(".mb-entries")?.setAttribute("hidden", "")
  doc.querySelector(".mb-cover")?.classList.add("zine-sr-cover")
  return { pages: n, sheets: n / 4 }
}

/** The screen-only "how to make it" strip: print mode, paper, fold steps.
 *  Mode and paper re-paginate, so they are links that reload with a query.
 *  @param {ZineContext} ctx @param {{ pages: number, sheets: number }} result */
export function howTo(ctx, result) {
  const doc = document
  const box = el("zine-howto")
  /** @param {string} key @param {string} value @param {string} label */
  const opt = (key, value, label) => {
    const url = new URL(location.href)
    url.searchParams.set(key, value)
    const a = doc.createElement("a")
    a.href = url.pathname + url.search
    a.textContent = label
    const on = key === "print" ? ctx.mode === value : ctx.paper === value
    if (on) a.setAttribute("aria-current", "true")
    return a
  }
  const modes = el("zh-row")
  modes.append(el("zh-k", "print as"), opt("print", "booklet", "fold & staple booklet"), opt("print", "pages", "single pages"))
  const papers = el("zh-row")
  papers.append(el("zh-k", "paper"), opt("paper", "letter", "US letter"), opt("paper", "a4", "A4"))
  const steps = doc.createElement("ol")
  steps.className = "zh-steps"
  const list =
    ctx.mode === "booklet"
      ? [
          `Print all ${result.sheets * 2} sides double-sided, landscape, “flip on short edge”, at 100%.`,
          "Keep the stack in order and fold it in half along the dashed line.",
          "Staple twice on the fold (the ticks on the cover show where). That's a zine.",
        ]
      : [`Prints ${result.pages} half-size pages in reading order, for a binder or a copy shop.`]
  for (const s of list) {
    const li = doc.createElement("li")
    li.textContent = s
    steps.appendChild(li)
  }
  box.append(modes, papers, steps)
  doc.querySelector(".mb-toolbar")?.after(box)
}
