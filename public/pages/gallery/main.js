/** @file Gallery page entry: nav/theme/session bootstrap, view switcher
 *  (all / official / honeymoon / guest), ?section / ?item deep links, and
 *  lightbox URL sync. The default "all" view stacks the grids — official, then
 *  honeymoon, then guest — and the lightbox navigates them as one list. The
 *  Honeymoon tab is hidden until that section has a photo (grid.js). */
/** @import * as Types from "./types.js" */

import { initMobileNav } from "../../components/mobile-nav.js"
import { initThemeToggle } from "../../components/theme-toggle.js"
import { initAuthSheet } from "../../components/auth-sheet.js"
import { loadSession } from "../../components/guest-session.js"
import { initGuestIdentity } from "../../components/guest-identity.js"
import { initReactionBars } from "../../components/reaction-bar.js"
import { initCommentThreads } from "../../components/comment-thread.js"
import { startRelativeTimeTicker } from "../../components/relative-time.js"
import { initThanksBanner } from "../../components/thanks-banner.js"
import { api, getElement, getButtonElement, stripQueryParam } from "../utils.js"
import { showToast } from "../../components/toast.js"
import {
  initGrid,
  showSection,
  getSectionItems,
  hasMore,
  loadMore,
  ensureItemLoaded,
  removeItem,
} from "./grid.js"
import {
  initLightbox,
  openLightbox,
  isLightboxOpen,
  closeLightbox,
} from "./lightbox.js"
import { initUpload } from "./upload.js"

/** Whether the lightbox's current open state came from a pushed history entry. */
let lightboxPushed = false

/** The active view. "all" is the default: no ?section param. */
/** @type {Types.GalleryView} */
let view = "all"

/** @param {string | null} value @returns {Types.GalleryView} */
function normalizeView(value) {
  return value === "official" || value === "honeymoon" || value === "guest" ? value : "all"
}

/** The grids in "all" order: official, honeymoon, then the guest wall.
 *  @type {readonly Types.MediaSection[]} */
const ALL_ORDER = ["official", "honeymoon", "guest"]

/** The ?section query suffix for a view ("" for the default "all"). Callers
 *  append &item=… so the empty case must carry no stray separator.
 *  @param {Types.GalleryView} v @returns {string} */
function viewQuery(v) {
  return v === "all" ? "" : `section=${v}`
}

// ---- "all"-aware lightbox source ----
// The lightbox treats its key as opaque; these wrappers make "all" mean
// official, honeymoon, then guest as one list, so arrows/slideshow flow across.

/** @param {Types.GalleryView} v @returns {Types.MediaListItem[]} */
function viewItems(v) {
  if (v !== "all") return getSectionItems(v)
  return ALL_ORDER.flatMap((section) => getSectionItems(section))
}

/** @param {Types.GalleryView} v @returns {boolean} */
function viewHasMore(v) {
  if (v !== "all") return hasMore(v)
  return ALL_ORDER.some((section) => hasMore(section))
}

/** @param {Types.GalleryView} v @returns {Promise<number>} */
async function viewLoadMore(v) {
  if (v !== "all") return loadMore(v)
  // The curated sections are single full pages; once they're exhausted the
  // guest keyset feed is the only thing left to extend.
  for (const section of ALL_ORDER) {
    if (section === "guest" || !hasMore(section)) continue
    const n = await loadMore(section)
    if (n > 0) return n
  }
  return loadMore("guest")
}

/** @param {Types.GalleryView} v @param {number} id */
function viewRemoveItem(v, id) {
  if (v !== "all") return removeItem(v, id)
  const section =
    ALL_ORDER.find((s) => getSectionItems(s).some((i) => i.id === id)) ?? "guest"
  removeItem(section, id)
}

async function boot() {
  initMobileNav()
  initThemeToggle()
  initAuthSheet()
  await loadSession()
  // Show "Posting as {name} · Not you?" once we know who's signed in.
  initGuestIdentity()
  // Surface any waiting thank-you card for the signed-in guest.
  void initThanksBanner()

  initGrid({ onOpen: openFromCell })
  initLightbox({
    getItems: viewItems,
    hasMore: viewHasMore,
    loadMore: viewLoadMore,
    onChange: syncUrl,
    onDelete: viewRemoveItem,
  })
  initUpload()
  // One delegated listener each for every reaction bar / comment thread (grid
  // cells have none; the lightbox panel re-renders them per item under body).
  initReactionBars(document.body)
  initCommentThreads(document.body)
  wireSocialWriteback()
  wireSwitcher()
  // Keep the lightbox's "posted N minutes ago" fresh while the gallery sits open.
  startRelativeTimeTicker()

  const params = new URLSearchParams(location.search)
  selectView(normalizeView(params.get("section")), false)

  const item = params.get("item")
  if (item) void openItemById(Number(item))
}

// ---- social write-back ----

/**
 * The lightbox re-renders its reaction bar + comment thread from the grid's
 * in-memory item on every navigate(). Reaction/comment writes only touch the
 * DOM + server, so without this the guest's action reverts when they page away
 * and back. Mirror each broadcast state onto the matching cached item.
 */
function wireSocialWriteback() {
  window.addEventListener("reaction:changed", (e) => {
    const detail = /** @type {CustomEvent} */ (e).detail
    if (!detail || detail.targetType !== "media") return
    const item = findLoadedItem(detail.targetId)
    if (item) item.reactions = detail.reactions
  })
  window.addEventListener("comment:changed", (e) => {
    const detail = /** @type {CustomEvent} */ (e).detail
    if (!detail || detail.targetType !== "media") return
    const item = findLoadedItem(detail.targetId)
    if (item) item.comment_count = detail.count
  })
}

/** @param {number} id @returns {Types.MediaListItem | undefined} */
function findLoadedItem(id) {
  for (const sec of ALL_ORDER) {
    const found = getSectionItems(sec).find((i) => i.id === id)
    if (found) return found
  }
  return undefined
}

// ---- view switcher (tablist) ----

/** @type {Types.GalleryView[]} */
const VIEWS = ["all", "official", "honeymoon", "guest"]

function wireSwitcher() {
  const tabs = VIEWS.map((v) => getButtonElement(`tab-${v}`))
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => {
      selectView(VIEWS[i], true)
    })
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      e.preventDefault()
      // Step over a hidden tab (Honeymoon, while it has no photos).
      const step = e.key === "ArrowRight" ? 1 : -1
      let next = i
      do {
        next = (next + step + VIEWS.length) % VIEWS.length
      } while (tabs[next].hidden && next !== i)
      tabs[next].focus()
      selectView(VIEWS[next], true)
    })
  })
}

/**
 * @param {Types.GalleryView} next @param {boolean} updateUrl
 */
function selectView(next, updateUrl) {
  view = next
  for (const v of VIEWS) {
    const tab = getButtonElement(`tab-${v}`)
    tab.setAttribute("aria-selected", String(v === view))
    // Roving tabindex: only the active tab is in the tab order; arrows (wired
    // in wireSwitcher) move between them, and Tab exits the tablist (2.5).
    tab.tabIndex = v === view ? 0 : -1
  }
  // Upload CTA belongs with the guest grid (present in "all" too) — never on a
  // curated section's own view, which guests can't add to.
  getElement("guest-cta").hidden = view === "official" || view === "honeymoon"
  showSection(view)
  window.dispatchEvent(new CustomEvent("gallery:sectionchange"))
  if (updateUrl && !isLightboxOpen()) {
    const query = viewQuery(view)
    history.replaceState(null, "", query ? `/gallery?${query}` : "/gallery")
  }
}

// ---- lightbox open + URL sync ----

/** @param {Types.MediaSection} section @param {number} id */
function openFromCell(section, id) {
  // In the "all" view the lightbox runs the combined list, so arrows flow
  // from the official set straight into the guest wall.
  openLightbox(view === "all" ? "all" : section, id)
}

/**
 * Open a deep-linked item: prefer an already-loaded row, else fetch it (its
 * visibility gate returns 404 for anything the caller may not see).
 * @param {number} id
 */
async function openItemById(id) {
  for (const sec of ALL_ORDER) {
    if (getSectionItems(sec).some((i) => i.id === id)) {
      openLightbox(view === "all" ? "all" : sec, id)
      return
    }
  }
  try {
    const item = /** @type {Types.MediaListItem} */ (await api(`/api/media/${id}`))
    ensureItemLoaded(item)
    openLightbox(view === "all" ? "all" : item.section, item.id)
  } catch {
    // 404 / not visible — the grid stays, but a shared link deserves a word
    // (and the dead ?item param shouldn't survive into copied URLs).
    showToast("That photo isn't available anymore.")
    stripQueryParam("/gallery", "item")
  }
}

/**
 * URL sync driven by the lightbox: push on first open (so Back closes it),
 * replace while navigating, and drop ?item on close. The default "all" view
 * carries no ?section param.
 * @param {Types.GalleryView} v @param {number | null} id
 */
function syncUrl(v, id) {
  const query = viewQuery(v)
  if (id !== null) {
    const url = `/gallery?${query ? `${query}&` : ""}item=${id}`
    if (!lightboxPushed) {
      history.pushState(null, "", url)
      lightboxPushed = true
    } else {
      history.replaceState(null, "", url)
    }
  } else {
    history.replaceState(null, "", query ? `/gallery?${query}` : "/gallery")
    lightboxPushed = false
  }
}

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search)
  selectView(normalizeView(params.get("section")), false)
  const item = params.get("item")
  if (item) {
    lightboxPushed = true // we're restoring a pushed entry — don't re-push
    void openItemById(Number(item))
  } else if (isLightboxOpen()) {
    closeLightbox()
  }
})

boot()
