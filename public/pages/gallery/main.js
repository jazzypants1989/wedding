/** @file Gallery page entry: nav/theme/session bootstrap, section switcher,
 *  ?section / ?item deep links, and lightbox URL sync. */
/** @import * as Types from "./types.js" */

import { initMobileNav } from "../../components/mobile-nav.js"
import { initThemeToggle } from "../../components/theme-toggle.js"
import { initAuthSheet } from "../../components/auth-sheet.js"
import { loadSession } from "../../components/guest-session.js"
import { initGuestIdentity } from "../../components/guest-identity.js"
import { initReactionBars } from "../../components/reaction-bar.js"
import { initCommentThreads } from "../../components/comment-thread.js"
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

/** @param {string | null} value @returns {Types.MediaSection} */
function normalizeSection(value) {
  return value === "official" ? "official" : "guest"
}

async function boot() {
  initMobileNav()
  initThemeToggle()
  initAuthSheet()
  await loadSession()
  // Show "Posting as {name} · Not you?" once we know who's signed in.
  initGuestIdentity()

  initGrid({ onOpen: openFromCell })
  initLightbox({
    getItems: getSectionItems,
    hasMore,
    loadMore,
    onChange: syncUrl,
    onDelete: removeItem,
  })
  initUpload()
  // One delegated listener each for every reaction bar / comment thread (grid
  // cells have none; the lightbox panel re-renders them per item under body).
  initReactionBars(document.body)
  initCommentThreads(document.body)
  wireSocialWriteback()
  wireSwitcher()

  const params = new URLSearchParams(location.search)
  const section = normalizeSection(params.get("section"))
  selectSection(section, false)

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
  for (const sec of /** @type {Types.MediaSection[]} */ (["guest", "official"])) {
    const found = getSectionItems(sec).find((i) => i.id === id)
    if (found) return found
  }
  return undefined
}

// ---- section switcher (tablist) ----

function wireSwitcher() {
  const tabs = [getButtonElement("tab-official"), getButtonElement("tab-guest")]
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => {
      selectSection(i === 0 ? "official" : "guest", true)
    })
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      e.preventDefault()
      const next = tabs[i === 0 ? 1 : 0]
      next.focus()
      selectSection(next.id === "tab-official" ? "official" : "guest", true)
    })
  })
}

/**
 * @param {Types.MediaSection} section @param {boolean} updateUrl
 */
function selectSection(section, updateUrl) {
  const isOfficial = section === "official"
  const officialTab = getButtonElement("tab-official")
  const guestTab = getButtonElement("tab-guest")
  officialTab.setAttribute("aria-selected", String(isOfficial))
  guestTab.setAttribute("aria-selected", String(!isOfficial))
  // Roving tabindex: only the active tab is in the tab order; arrows (wired in
  // wireSwitcher) move between them, and Tab exits the tablist (2.5).
  officialTab.tabIndex = isOfficial ? 0 : -1
  guestTab.tabIndex = isOfficial ? -1 : 0
  // Upload CTA belongs to the guest section only.
  getElement("guest-cta").hidden = isOfficial
  showSection(section)
  window.dispatchEvent(new CustomEvent("gallery:sectionchange"))
  if (updateUrl && !isLightboxOpen()) {
    history.replaceState(null, "", `/gallery?section=${section}`)
  }
}

// ---- lightbox open + URL sync ----

/** @param {Types.MediaSection} section @param {number} id */
function openFromCell(section, id) {
  openLightbox(section, id)
}

/**
 * Open a deep-linked item: prefer an already-loaded row, else fetch it (its
 * visibility gate returns 404 for anything the caller may not see).
 * @param {number} id
 */
async function openItemById(id) {
  for (const sec of /** @type {Types.MediaSection[]} */ (["guest", "official"])) {
    if (getSectionItems(sec).some((i) => i.id === id)) {
      openLightbox(sec, id)
      return
    }
  }
  try {
    const item = /** @type {Types.MediaListItem} */ (await api(`/api/media/${id}`))
    ensureItemLoaded(item)
    openLightbox(item.section, item.id)
  } catch {
    // 404 / not visible — the grid stays, but a shared link deserves a word
    // (and the dead ?item param shouldn't survive into copied URLs).
    showToast("That photo isn't available anymore.")
    stripQueryParam("/gallery", "item")
  }
}

/**
 * URL sync driven by the lightbox: push on first open (so Back closes it),
 * replace while navigating, and drop ?item on close.
 * @param {Types.MediaSection} section @param {number | null} id
 */
function syncUrl(section, id) {
  if (id !== null) {
    const url = `/gallery?section=${section}&item=${id}`
    if (!lightboxPushed) {
      history.pushState(null, "", url)
      lightboxPushed = true
    } else {
      history.replaceState(null, "", url)
    }
  } else {
    history.replaceState(null, "", `/gallery?section=${section}`)
    lightboxPushed = false
  }
}

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search)
  const section = normalizeSection(params.get("section"))
  selectSection(section, false)
  const item = params.get("item")
  if (item) {
    lightboxPushed = true // we're restoring a pushed entry — don't re-push
    void openItemById(Number(item))
  } else if (isLightboxOpen()) {
    closeLightbox()
  }
})

boot()
