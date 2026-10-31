/** @file /memory-book — a print-first keepsake that gathers EVERY approved
 *  guestbook entry (paging the public feed until exhausted) into an elegant
 *  book layout. When the couple has Favorites switched on (site content), the
 *  admin-pinned notes lead; then the rest, newest first. A pinned note's flower
 *  is gilded either way.
 *  Public-read only (same data as /guestbook); no auth, no mutations. The
 *  "Print / Save as PDF" button just calls window.print(); print styling lives
 *  in memory-book.css (@page + page-break rules). No regex (CLAUDE.md). */
/** @import * as Types from "./types.js" */

import { api, html, raw, getElement, getButtonElement, formatDate, getErrorMessage } from "../utils.js"
import { flowerSVG } from "../../components/note-flower.js"

/** One page's worth of entries. The public feed caps a page at 50. */
const PAGE_SIZE = 50
/** Hard ceiling on pages fetched, so a runaway cursor can't loop forever. */
const MAX_PAGES = 500

/** Fetch the full approved guestbook, oldest-kept ordering preserved from the
 *  feed (newest first), plus the pinned Favorites (first page only).
 *  @returns {Promise<{ entries: Types.MemoryBookEntry[], pinned: Types.MemoryBookEntry[] }>} */
async function fetchAllEntries() {
  /** @type {Types.MemoryBookEntry[]} */
  const entries = []
  /** @type {Types.MemoryBookEntry[]} */
  let pinned = []
  /** @type {number | null} */
  let before = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const query =
      before === null ? `?limit=${PAGE_SIZE}` : `?before=${before}&limit=${PAGE_SIZE}`
    const data = /** @type {Types.MemoryBookFeedResponse} */ (await api(`/api/guestbook${query}`))
    // Favorites ride only on the first page (before === null).
    if (before === null && Array.isArray(data.pinned)) pinned = data.pinned
    for (const entry of data.entries) entries.push(entry)
    if (data.nextCursor === null || data.entries.length === 0) break
    before = data.nextCursor
  }
  return { entries, pinned }
}

/** Render one entry as a book page: the note, then its signature, with the
 *  note's flower standing beside both. `favorite` sets it in the Favorites
 *  section. Message text keeps its line breaks via CSS `white-space: pre-wrap`
 *  on `.mb-entry-message`, so it renders verbatim (still auto-escaped by html``).
 *  @param {Types.MemoryBookEntry} entry @param {boolean} favorite @returns {string} */
function entryMarkup(entry, favorite) {
  const name = entry.author_name || "A guest"
  return html`
    <article class="mb-entry ${favorite ? "is-favorite" : ""}">
      <p class="mb-entry-message">${entry.message}</p>
      <p class="mb-entry-sign">
        <span class="mb-entry-author">${name}</span>
        <span class="mb-entry-date">${formatDate(entry.created_at)}</span>
      </p>
      <span class="mb-entry-flower" aria-hidden="true"
        >${raw(flowerSVG(entry, { scale: 0.7, maxW: 120, maxH: 140, gold: entry.pinned }))}</span
      >
    </article>
  `
}

/** Paint the gathered entries: Favorites first (de-duplicated from the main
 *  run), then the remaining entries in feed order. @param {Types.MemoryBookEntry[]} entries
 *  @param {Types.MemoryBookEntry[]} pinned */
function render(entries, pinned) {
  const status = getElement("mb-status")
  const container = getElement("mb-entries")
  if (entries.length === 0 && pinned.length === 0) {
    status.textContent = "No guestbook messages yet — check back after guests have signed."
    container.innerHTML = ""
    return
  }
  status.hidden = true

  const pinnedIds = new Set(pinned.map((p) => p.id))
  const rest = entries.filter((e) => !pinnedIds.has(e.id))
  const total = pinned.length + rest.length

  const favSection =
    pinned.length > 0
      ? html`<section class="mb-section">
          <h2 class="mb-section-title">Favorites</h2>
          ${pinned.map((e) => entryMarkup(e, true))}
        </section>`
      : ""
  const restSection =
    rest.length > 0
      ? html`<section class="mb-section">
          ${pinned.length > 0 ? html`<h2 class="mb-section-title">Every message</h2>` : ""}
          ${rest.map((e) => entryMarkup(e, false))}
        </section>`
      : ""

  container.innerHTML = html`${favSection}${restSection}
    <p class="mb-count">${total} message${total === 1 ? "" : "s"} in all.</p>`
}

async function load() {
  const status = getElement("mb-status")
  const errorEl = getElement("mb-error")
  errorEl.hidden = true
  try {
    const { entries, pinned } = await fetchAllEntries()
    render(entries, pinned)
  } catch (err) {
    status.hidden = true
    errorEl.textContent = "Couldn't gather the guestbook: " + getErrorMessage(err)
    errorEl.hidden = false
  }
}

/** The cover's flower: the couple's own, grown from their names like any note. */
function drawCoverFlower() {
  const names = document.querySelector(".mb-cover-names")?.textContent?.trim() ?? ""
  getElement("mb-cover-flower").innerHTML = flowerSVG(
    { author_name: names, message: names + "." },
    { scale: 0.8, maxW: 96, maxH: 120 },
  )
}

function init() {
  getButtonElement("mb-print").addEventListener("click", () => window.print())
  drawCoverFlower()
  void load()
}

init()
