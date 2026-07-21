/** @file Gallery grid: batched rendering, keyset paging, content-visibility
 *  virtualization. Two persistent grids (official/guest) that hide/show without
 *  re-rendering. See docs/post-wedding/04-gallery.md §4. */
/** @import * as Types from "./types.js" */

import {
  html,
  api,
  getElement,
  getButtonElement,
  getErrorMessage,
  setLoadMoreState,
} from "../utils.js"
import { upgradeTimes } from "../../components/relative-time.js"
import { renderMonogram } from "../../components/monogram.js"

const BATCH_SIZE = 100
const GUEST_LIMIT = 100
const OFFICIAL_LIMIT = 500
const MAX_AUTO_BATCHES = 20
/** Overlapping monogram chips shown in the "Shared by" strip before "+N more". */
const MAX_CONTRIB_CHIPS = 12

/** Whether the contributors strip has content (so section switches can show it
 *  only when the guest section — the only one it belongs to — is active). */
let hasContributors = false

/** @type {Types.GridCallbacks | null} */
let callbacks = null

/**
 * @typedef {Types.GridSectionState & {
 *   container: HTMLElement,
 *   currentBatch: HTMLUListElement | null,
 *   sentinel: HTMLElement,
 * }} Section
 */

/** @type {Record<Types.MediaSection, Section>} */
const sections = /** @type {any} */ ({})

/** @type {Types.MediaSection} */
let active = "guest"

/** @type {IntersectionObserver} */
let observer

/** @type {Types.initGrid} */
export function initGrid(cb) {
  callbacks = cb

  for (const section of /** @type {Types.MediaSection[]} */ (["official", "guest"])) {
    const container = getElement(section === "official" ? "grid-official" : "grid-guest")
    container.dataset.section = section
    const sentinel = document.createElement("div")
    sentinel.className = "grid-sentinel"
    sentinel.dataset.section = section
    container.appendChild(sentinel)
    // One delegated click handler per container → open the lightbox.
    container.addEventListener("click", onCellClick)
    // A 404 / processing gap would otherwise show the raw alt text on a bare
    // box. `error` doesn't bubble, so listen in the capture phase and swap the
    // failed thumb for the same 📷 placeholder used for un-processable media.
    container.addEventListener("error", onThumbError, true)

    sections[section] = {
      section,
      items: [],
      nextCursor: null,
      reachedEnd: false,
      loading: false,
      autoFetches: 0,
      container,
      currentBatch: null,
      sentinel,
    }
  }

  observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue
        const section = /** @type {Types.MediaSection} */ (
          /** @type {HTMLElement} */ (record.target).dataset.section
        )
        const s = sections[section]
        if (section === active && s.autoFetches < MAX_AUTO_BATCHES) {
          void loadMore(section).then((n) => {
            if (n > 0) s.autoFetches += 1
          })
        }
      }
    },
    { rootMargin: "1200px 0px" },
  )
  observer.observe(sections.official.sentinel)
  observer.observe(sections.guest.sentinel)

  getButtonElement("gallery-loadmore").addEventListener("click", () => {
    const s = sections[active]
    s.autoFetches = 0 // a manual click re-arms auto-loading
    void loadMore(active)
  })
}

/** @param {Event} e */
function onThumbError(e) {
  const img = e.target
  if (!(img instanceof HTMLImageElement)) return
  if (!img.classList.contains("media-thumb")) return
  if (img.dataset.errored) return // guard against a re-error loop
  img.dataset.errored = "1"
  const ph = document.createElement("span")
  ph.className = "media-placeholder"
  ph.setAttribute("role", "img")
  ph.setAttribute("aria-label", img.alt || "Photo unavailable")
  img.replaceWith(ph)
}

/** @param {Event} e */
function onCellClick(e) {
  const target = /** @type {HTMLElement} */ (e.target)
  const cell = target.closest("[data-id]")
  if (!(cell instanceof HTMLElement) || !cell.dataset.id) return
  const section = /** @type {Types.MediaSection} */ (
    /** @type {HTMLElement} */ (cell.closest("[data-section]"))?.dataset.section || active
  )
  if (callbacks) callbacks.onOpen(section, Number(cell.dataset.id))
}

/**
 * Render the "Shared by …" contributors strip: overlapping monogram chips for
 * the distinct authors of visible guest uploads, plus a "N photos from M guests"
 * summary. Empty/absent data leaves the strip hidden. @param {Types.MediaContributors} data
 */
function renderContributors(data) {
  const el = getElement("gallery-contributors")
  if (!data.names.length || data.photos === 0) {
    hasContributors = false
    el.hidden = true
    el.innerHTML = ""
    return
  }
  const shown = data.names.slice(0, MAX_CONTRIB_CHIPS)
  const overflow = data.guests - shown.length
  // NOTE: keep this an ARRAY of html`` results — .join("") would coerce the
  // SafeHTML pieces to a plain string, which the outer html`` then re-escapes
  // (rendering the chip markup as literal text). Arrays interpolate unescaped.
  const chips = shown.map(
    (name) =>
      html`<span class="gallery-contrib-chip" title="${name}">${renderMonogram(name)}</span>`,
  )
  const more = overflow > 0 ? html`<span class="gallery-contrib-more">+${overflow}</span>` : ""
  const photoLabel = `${data.photos} photo${data.photos === 1 ? "" : "s"}`
  const guestLabel = `${data.guests} guest${data.guests === 1 ? "" : "s"}`
  el.innerHTML = html`
    <span class="gallery-contrib-chips" aria-hidden="true">${chips}${more}</span>
    <span class="gallery-contrib-text">${photoLabel} shared by ${guestLabel}</span>`
  hasContributors = true
  el.hidden = active !== "guest"
}

/** @type {Types.showSection} */
export function showSection(section) {
  active = section
  sections.official.container.hidden = section !== "official"
  sections.guest.container.hidden = section !== "guest"
  // The contributors strip belongs to the guest section only.
  getElement("gallery-contributors").hidden = !(section === "guest" && hasContributors)
  const s = sections[section]
  if (s.items.length === 0 && !s.reachedEnd && !s.loading) {
    void loadMore(section)
  } else {
    updateLoadMore(section)
  }
}

/** @type {Types.loadMore} */
export async function loadMore(section) {
  const s = sections[section]
  if (s.loading || s.reachedEnd) return 0
  s.loading = true
  hideError()
  // First paint for this section → show shimmer skeleton until data resolves.
  const firstPaint = s.items.length === 0
  if (firstPaint) showSkeleton(s)
  try {
    const isOfficial = section === "official"
    const limit = isOfficial ? OFFICIAL_LIMIT : GUEST_LIMIT
    const beforeParam =
      !isOfficial && s.nextCursor !== null ? `&before=${s.nextCursor}` : ""
    const data = /** @type {Types.GalleryListResponse} */ (
      await api(`/api/media?section=${section}&limit=${limit}${beforeParam}`)
    )
    appendItems(s, data.items)
    // The contributors aggregate rides on the first guest page only.
    if (section === "guest" && data.contributors) {
      renderContributors(data.contributors)
    }
    s.nextCursor = data.nextCursor
    if (data.nextCursor === null) s.reachedEnd = true
    if (s.reachedEnd && s.items.length === 0) showEmpty(s)
    updateCount(section)
    updateLoadMore(section)
    return data.items.length
  } catch (err) {
    showError(getErrorMessage(err))
    setLoadMoreState(getButtonElement("gallery-loadmore"), "retry")
    return 0
  } finally {
    s.loading = false
    if (firstPaint) clearSkeleton(s)
  }
}

/**
 * Inject 12 shimmer skeleton cells while the first page loads. They share the
 * media-grid so they occupy the footprint the real cells will (04 §4).
 * @param {Section} s
 */
function showSkeleton(s) {
  if (s.container.querySelector(".gallery-skeleton")) return
  const ul = document.createElement("ul")
  ul.className = "media-grid gallery-skeleton"
  ul.setAttribute("aria-hidden", "true")
  for (let i = 0; i < 12; i += 1) {
    const li = document.createElement("li")
    li.className = "media-skeleton"
    ul.appendChild(li)
  }
  s.container.insertBefore(ul, s.sentinel)
}

/** @param {Section} s */
function clearSkeleton(s) {
  const el = s.container.querySelector(".gallery-skeleton")
  if (el) el.remove()
}

/** @param {Section} s */
function showEmpty(s) {
  if (s.container.querySelector(".gallery-empty")) return
  const div = document.createElement("div")
  div.className = "empty-state gallery-empty"
  if (s.section === "guest") {
    // Actionable, like the guestbook's "Be the first to sign!" — the CTA is
    // wired in upload.js (delegated) to the existing upload flow.
    div.innerHTML = html`
      No guest photos yet — got some from the big day? 📸
      <button type="button" class="auth-link" id="gallery-empty-cta">Add the first photos</button>`
  } else {
    div.textContent =
      "No official photos yet — the couple's favorites will land here soon. 📷"
  }
  s.container.insertBefore(div, s.sentinel)
}

/** @param {Section} s */
function clearEmpty(s) {
  const el = s.container.querySelector(".gallery-empty")
  if (el) el.remove()
}

/**
 * @param {Section} s
 * @param {Types.MediaListItem[]} items
 */
function appendItems(s, items) {
  if (items.length === 0) return
  for (const item of items) {
    s.items.push(item)
    appendCell(s, item, false)
  }
  // Keep the sentinel last so the observer fires below the newest batch.
  s.container.appendChild(s.sentinel)
  upgradeTimes(s.container)
}

/**
 * Append (or prepend) one cell, opening a fresh 100-item batch when needed.
 * @param {Section} s @param {Types.MediaListItem} item @param {boolean} prepend
 */
function appendCell(s, item, prepend) {
  const wrapper = document.createElement("div")
  wrapper.innerHTML = cellMarkup(item)
  const li = wrapper.firstElementChild
  if (!li) return

  if (prepend) {
    let batch = /** @type {HTMLUListElement | null} */ (
      s.container.querySelector(".media-page")
    )
    if (!batch || batch.children.length >= BATCH_SIZE) {
      batch = newBatch(s, true)
    }
    batch.insertBefore(li, batch.firstChild)
    setBatchEstimate(s, batch)
    return
  }

  if (!s.currentBatch || s.currentBatch.children.length >= BATCH_SIZE) {
    s.currentBatch = newBatch(s, false)
  }
  s.currentBatch.appendChild(li)
  setBatchEstimate(s, s.currentBatch)
}

/**
 * @param {Section} s @param {boolean} atTop
 * @returns {HTMLUListElement}
 */
function newBatch(s, atTop) {
  const ul = document.createElement("ul")
  ul.className = "media-grid media-page"
  if (atTop) s.container.insertBefore(ul, s.container.firstChild)
  else s.container.insertBefore(ul, s.sentinel)
  return ul
}

/**
 * Set contain-intrinsic-size per batch from measured columns × row height, so
 * offscreen batches reserve roughly the right space (a hardcoded 900px default
 * is ~4× off on a phone → jumpy scrollbar). See 04 §4.
 * @param {Section} s @param {HTMLUListElement} batch
 */
function setBatchEstimate(s, batch) {
  const width = s.container.clientWidth || 375
  const colMin = window.matchMedia("(min-width: 768px)").matches ? 150 : 110
  const gap = 2
  const columns = Math.max(1, Math.floor((width + gap) / (colMin + gap)))
  const cellW = (width - gap * (columns - 1)) / columns
  const rows = Math.ceil(batch.children.length / columns)
  batch.style.setProperty("--batch-est", Math.round(rows * (cellW + gap)) + "px")
}

/**
 * @param {Types.MediaListItem} item
 * @returns {string}
 */
function cellMarkup(item) {
  const alt = item.caption || `Photo by ${item.author_name}`
  const pendingChip =
    item.is_own && item.status === "pending"
      ? html`<span class="media-chip status-pending">Pending</span>`
      : ""

  let inner
  if (item.kind === "video") {
    inner = html`
      <img class="media-thumb" src="/media/${item.file_key}/poster" alt="${alt}"
        loading="lazy" decoding="async">
      <span class="media-chip media-duration">${formatDuration(item.duration_seconds)}</span>
      <span class="media-play" aria-hidden="true"></span>`
  } else if (item.needs_display) {
    inner = html`<span class="media-placeholder" aria-label="${alt}" role="img"></span>`
  } else {
    inner = html`
      <img class="media-thumb" src="/media/${item.file_key}/thumb" alt="${alt}"
        loading="lazy" decoding="async">`
  }

  return html`
    <li>
      <button type="button" class="media-cell" data-id="${item.id}">
        ${inner}${pendingChip}
      </button>
    </li>`
}

/** @param {number | null} seconds @returns {string} */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return ""
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return `${m}:${sec < 10 ? "0" : ""}${sec}`
}

/** @type {Types.prependItem} */
export function prependItem(item) {
  const s = sections.guest
  clearEmpty(s)
  s.items.unshift(item)
  appendCell(s, item, true)
  upgradeTimes(s.container)
  updateCount("guest")
}

/** @type {Types.ensureItemLoaded} */
export function ensureItemLoaded(item) {
  const s = sections[item.section]
  if (s.items.some((i) => i.id === item.id)) return
  s.items.unshift(item)
  appendCell(s, item, true)
  upgradeTimes(s.container)
}

/** @type {Types.removeItem} */
export function removeItem(section, id) {
  const s = sections[section]
  const idx = s.items.findIndex((i) => i.id === id)
  if (idx === -1) return
  s.items.splice(idx, 1)
  const cell = s.container.querySelector(`[data-id="${id}"]`)
  const li = cell ? cell.closest("li") : null
  if (li) li.remove()
  updateCount(section)
  // A section emptied entirely by deletes should show its warm empty state.
  if (s.items.length === 0 && s.reachedEnd) showEmpty(s)
}

/** @type {Types.getSectionItems} */
export function getSectionItems(section) {
  return sections[section].items
}

/** @type {Types.hasMore} */
export function hasMore(section) {
  return !sections[section].reachedEnd
}

/** @type {Types.getSectionCount} */
export function getSectionCount(section) {
  return sections[section].items.length
}

/** @param {Types.MediaSection} section */
function updateCount(section) {
  if (section !== "guest") return
  const el = getElement("count-guest")
  const n = sections.guest.items.length
  el.textContent = n > 0 ? `(${n})` : ""
}

/** @param {Types.MediaSection} section */
function updateLoadMore(section) {
  const s = sections[section]
  const btn = getButtonElement("gallery-loadmore")
  setLoadMoreState(btn, "reset")
  // Offer the manual button once auto-loading has paused and there's more.
  btn.hidden = s.reachedEnd || s.autoFetches < MAX_AUTO_BATCHES
}

/** @param {string} message */
function showError(message) {
  const el = getElement("gallery-error")
  el.textContent = message
  el.hidden = false
}

function hideError() {
  getElement("gallery-error").hidden = true
}
