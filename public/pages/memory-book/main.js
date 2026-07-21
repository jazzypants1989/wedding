/** @file /memory-book — a print-first keepsake that gathers EVERY approved
 *  guestbook entry (paging the public feed until exhausted) into an elegant
 *  book layout. Admin-pinned Favorites lead, then the rest chronologically.
 *  Public-read only (same data as /guestbook); no auth, no mutations. The
 *  "Print / Save as PDF" button just calls window.print(); print styling lives
 *  in memory-book.css (@page + page-break rules). No regex (CLAUDE.md). */
/** @import * as Types from "./types.js" */

import { api, html, getElement, getButtonElement, formatDate, getErrorMessage } from "../utils.js"
import { renderMonogram } from "../../components/monogram.js"

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

/** Render one entry as a book page. `favorite` adds a small ✨ flourish.
 *  Message text keeps its line breaks via CSS `white-space: pre-wrap` on
 *  `.mb-entry-message`, so it renders verbatim (still auto-escaped by html``).
 *  @param {Types.MemoryBookEntry} entry @param {boolean} favorite @returns {string} */
function entryMarkup(entry, favorite) {
  const name = entry.author_name || "A guest"
  return html`
    <article class="mb-entry ${favorite ? "is-favorite" : ""}">
      <div class="mb-entry-head">
        ${renderMonogram(name)}
        <span class="mb-entry-author">${name}</span>
        ${favorite ? html`<span class="mb-entry-fav" aria-label="Favorite">✨</span>` : ""}
        <span class="mb-entry-date">${formatDate(entry.created_at)}</span>
      </div>
      <p class="mb-entry-message">${entry.message}</p>
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

function init() {
  getButtonElement("mb-print").addEventListener("click", () => window.print())
  void load()
}

init()
