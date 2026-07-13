/** @file Gallery lightbox: fullscreen media stage, keyboard/swipe nav, video,
 *  copy-link, report, and deep-link URL sync. See docs/post-wedding/04-gallery.md §5. */
/** @import * as Types from "./types.js" */

import { html, api, getElement, getDialogElement, getErrorMessage } from "../utils.js"
import { formatRelative } from "../../components/relative-time.js"
import { renderReactionBar } from "../../components/reaction-bar.js"
import { renderCommentThread } from "../../components/comment-thread.js"
import { showToast } from "../../components/toast.js"

const SWIPE_COMMIT_FRACTION = 0.25
const SWIPE_COMMIT_VELOCITY = 0.3 // px/ms

/** @type {Types.LightboxSource} */
let source
/** @type {Types.MediaSection} */
let section = "guest"
let index = -1
/** Reply-to address for the "Report this photo" mailto; loaded from /api/config. */
let contactEmail = ""

/** Fetch the couple's contact address once so Report has a real recipient. */
async function loadContactEmail() {
  try {
    const cfg = /** @type {{ contactEmail?: string }} */ (await api("/api/config"))
    if (cfg && typeof cfg.contactEmail === "string") contactEmail = cfg.contactEmail
  } catch {
    // Leave blank; render() hides Report rather than build a recipient-less draft.
  }
  // Config may resolve after the deep-linked lightbox already painted — re-render
  // so Report appears (or stays hidden) with the now-known address.
  if (isLightboxOpen()) render()
}

/** @type {Types.initLightbox} */
export function initLightbox(src) {
  source = src
  void loadContactEmail()
  const dialog = getDialogElement("lightbox")

  getElement("lightbox-close").addEventListener("click", () => close())
  getElement("lightbox-prev").addEventListener("click", () => void navigate(-1))
  getElement("lightbox-next").addEventListener("click", () => void navigate(1))
  getElement("lightbox-copy").addEventListener("click", copyLink)
  getElement("lightbox-delete").addEventListener("click", () => void deleteCurrent())

  // Native <dialog> closes on Esc → keep our state + URL in sync.
  dialog.addEventListener("close", () => {
    pauseVideo()
    if (index !== -1) {
      index = -1
      source.onChange(section, null)
    }
  })

  document.addEventListener("keydown", (e) => {
    if (!isLightboxOpen()) return
    if (e.key === "ArrowLeft") void navigate(-1)
    else if (e.key === "ArrowRight") void navigate(1)
  })

  wireSwipe(getElement("lightbox-stage"))
}

/** @type {Types.openLightbox} */
export function openLightbox(sec, id) {
  const items = source.getItems(sec)
  const i = items.findIndex((item) => item.id === id)
  if (i === -1) return
  section = sec
  index = i
  render()
  source.onChange(section, id)
  const dialog = getDialogElement("lightbox")
  if (!dialog.open) dialog.showModal()
}

/** @type {Types.openLightboxItem} */
export function openLightboxItem(item, sec) {
  // The caller (main.js) has already ensured the item is in the grid's array.
  openLightbox(sec, item.id)
}

/** @type {Types.isLightboxOpen} */
export function isLightboxOpen() {
  return getDialogElement("lightbox").open
}

/** @type {Types.closeLightbox} */
export function closeLightbox() {
  close()
}

function close() {
  const dialog = getDialogElement("lightbox")
  if (dialog.open) dialog.close() // fires the "close" listener above
}

/**
 * Step by delta, lazily loading the next page when we run off the loaded end.
 * @param {number} delta
 */
async function navigate(delta) {
  const items = source.getItems(section)
  let target = index + delta
  if (target >= items.length && source.hasMore(section)) {
    await source.loadMore(section)
  }
  const refreshed = source.getItems(section)
  target = index + delta
  if (target < 0 || target >= refreshed.length) return
  pauseVideo()
  index = target
  render()
  source.onChange(section, refreshed[index].id)
}

function render() {
  const items = source.getItems(section)
  const item = items[index]
  if (!item) return

  const stage = getElement("lightbox-stage")
  if (item.kind === "video") {
    stage.innerHTML = html`
      <video class="lightbox-media" src="/media/${item.file_key}/video" controls
        playsinline preload="none" poster="/media/${item.file_key}/poster"></video>`
  } else if (item.needs_display) {
    stage.innerHTML = html`
      <div class="lightbox-missing">This photo couldn't be processed for web viewing.</div>`
  } else {
    const alt = item.caption || `Photo by ${item.author_name}`
    stage.innerHTML = html`
      <img class="lightbox-media" src="/media/${item.file_key}/display" alt="${alt}">`
  }

  // `items.length` is only the loaded page(s), not the section's true total.
  // Rather than silently understate it (and grow as you page), append "+" while
  // more remain unloaded so the denominator reads as a floor, not a total.
  const more = source.hasMore(section)
  getElement("lightbox-counter").textContent = `${index + 1} / ${items.length}${
    more ? "+" : ""
  }`
  getElement("lightbox-author").textContent = item.author_name
  const time = getElement("lightbox-time")
  time.textContent = formatRelative(item.created_at)
  time.setAttribute("datetime", item.created_at)

  const caption = getElement("lightbox-caption")
  caption.textContent = item.caption || ""
  caption.hidden = !item.caption

  // Reaction bar + comment thread for this item. The delegated listeners live on
  // document.body (initialized once in main.js), so re-rendering here is safe.
  getElement("lightbox-social").innerHTML = html`
    ${renderReactionBar("media", item.id, item.reactions)}
    ${renderCommentThread("media", item.id, item.comment_count)}`

  // Report link: only build a mailto when we actually have a recipient — a
  // failed config load must not produce a recipient-less draft. Hide it otherwise.
  const report = /** @type {HTMLAnchorElement} */ (getElement("lightbox-report"))
  const reportWrap = report.closest(".lightbox-report")
  if (contactEmail) {
    const subject = encodeURIComponent(`Please remove a wedding photo (${item.file_key})`)
    report.href = `mailto:${contactEmail}?subject=${subject}`
    if (reportWrap instanceof HTMLElement) reportWrap.hidden = false
  } else {
    report.removeAttribute("href")
    if (reportWrap instanceof HTMLElement) reportWrap.hidden = true
  }

  // Self-delete: only the uploader (is_own) sees it.
  getElement("lightbox-delete").hidden = !item.is_own

  preloadNeighbors()
}

/**
 * Delete the current item (the signed-in uploader's own photo). Confirms, calls
 * DELETE /api/media/:id, drops it from the grid via source.onDelete, then either
 * closes (section now empty) or advances to the neighbour that slid into place.
 */
async function deleteCurrent() {
  const items = source.getItems(section)
  const item = items[index]
  if (!item) return
  if (!window.confirm("Delete your photo? This can't be undone.")) return
  try {
    await api(`/api/media/${item.id}`, {
      method: "DELETE",
      csrf: true,
      csrfCookie: "guest_csrf",
    })
  } catch (err) {
    showToast(getErrorMessage(err), { variant: "error" })
    return
  }
  source.onDelete(section, item.id)
  const refreshed = source.getItems(section)
  if (refreshed.length === 0) {
    close()
    showToast("Photo deleted.")
    return
  }
  if (index >= refreshed.length) index = refreshed.length - 1
  render()
  source.onChange(section, refreshed[index].id)
  showToast("Photo deleted.")
}

/** Preload ±1 display images so arrow/swipe nav is instant. */
function preloadNeighbors() {
  const items = source.getItems(section)
  for (const n of [index - 1, index + 1]) {
    const item = items[n]
    if (item && item.kind === "image" && !item.needs_display) {
      new Image().src = `/media/${item.file_key}/display`
    }
  }
}

function pauseVideo() {
  const video = getElement("lightbox-stage").querySelector("video")
  if (video instanceof HTMLVideoElement) video.pause()
}

async function copyLink() {
  const items = source.getItems(section)
  const item = items[index]
  if (!item) return
  const url = `${location.origin}/gallery?section=${section}&item=${item.id}`
  const btn = getElement("lightbox-copy")
  const prev = btn.textContent
  // Only claim success once the copy actually lands. Clipboard API needs a
  // secure context; fall back to a hidden-textarea execCommand, then to
  // surfacing the URL so the guest can copy it by hand.
  const ok = await copyToClipboard(url)
  btn.textContent = ok ? "Copied!" : "Press ⌘/Ctrl+C"
  if (!ok) window.prompt("Copy this link:", url)
  setTimeout(() => {
    btn.textContent = prev
  }, 1500)
}

/** @param {string} text @returns {Promise<boolean>} */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * Pointer-Events swipe: drag the stage with the finger, commit past 25% width
 * or a fast flick. Mouse drags are ignored (chevrons/keys serve desktop).
 * @param {HTMLElement} stage
 */
function wireSwipe(stage) {
  let startX = 0
  let startT = 0
  let dragging = false

  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return
    dragging = true
    startX = e.clientX
    startT = e.timeStamp
    stage.style.transition = "none"
  })

  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return
    stage.style.transform = `translateX(${e.clientX - startX}px)`
  })

  const end = (/** @type {PointerEvent} */ e) => {
    if (!dragging) return
    dragging = false
    const dx = e.clientX - startX
    const dt = Math.max(1, e.timeStamp - startT)
    const velocity = Math.abs(dx) / dt
    stage.style.transition = ""
    stage.style.transform = ""
    if (
      Math.abs(dx) > stage.clientWidth * SWIPE_COMMIT_FRACTION ||
      velocity > SWIPE_COMMIT_VELOCITY
    ) {
      void navigate(dx < 0 ? 1 : -1)
    }
  }

  stage.addEventListener("pointerup", end)
  stage.addEventListener("pointercancel", end)
}
