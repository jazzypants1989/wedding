/** @file Gallery lightbox: fullscreen media stage, keyboard/swipe nav, video,
 *  copy-link, report, and deep-link URL sync. See docs/post-wedding/04-gallery.md §5. */
/** @import * as Types from "./types.js" */

import {
  html,
  api,
  getElement,
  getDialogElement,
  getErrorMessage,
  shareUrl,
} from "../utils.js"
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
/** The element focused when the lightbox opened, to restore focus on close. */
let opener = /** @type {HTMLElement | null} */ (null)
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
  const copyBtn = getElement("lightbox-copy")
  // On phones (the dominant post-wedding device) prefer the native share sheet
  // so a guest can fire a photo straight into a group chat; copy-link is the
  // desktop / no-share fallback.
  if (typeof navigator.share === "function") {
    copyBtn.textContent = "Share"
    copyBtn.setAttribute("aria-label", "Share this photo")
  }
  copyBtn.addEventListener("click", shareOrCopy)
  getElement("lightbox-delete").addEventListener("click", () => void deleteCurrent())

  // Native <dialog> closes on Esc → keep our state + URL in sync.
  dialog.addEventListener("close", () => {
    pauseVideo()
    const openId = index !== -1 ? source.getItems(section)[index]?.id : null
    if (index !== -1) {
      index = -1
      source.onChange(section, null)
    }
    restoreFocus(openId)
  })

  document.addEventListener("keydown", (e) => {
    if (!isLightboxOpen()) return
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    // Don't hijack ←/→ when the guest is typing a comment (the composer lives in
    // the lightbox) or scrubbing a video — navigating would rewrite the social
    // panel's innerHTML and discard an in-progress comment draft.
    const active = document.activeElement
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLVideoElement
    ) {
      return
    }
    if (e.key === "ArrowLeft") void navigate(-1)
    else void navigate(1)
  })

  wireSwipe(getElement("lightbox-stage"))
}

/** @type {Types.openLightbox} */
export function openLightbox(sec, id) {
  const items = source.getItems(sec)
  const i = items.findIndex((item) => item.id === id)
  if (i === -1) return
  // Remember what had focus so we can return to it on close (native <dialog>
  // restores the opener, but a deep-link open has none — see restoreFocus).
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
 * Put focus somewhere sensible after close. When the lightbox was opened from a
 * real element (a grid cell), the native <dialog> already restored focus there.
 * When it was deep-linked (focus was on <body>, or the opener is gone), send
 * focus to that photo's grid cell so keyboard users land back in context.
 * @param {number | null | undefined} openId
 */
function restoreFocus(openId) {
  if (opener && opener.isConnected && opener !== document.body) {
    opener = null
    return // the dialog's native restoration already handled it
  }
  opener = null
  if (openId == null) return
  const cell = document.querySelector(`.media-cell[data-id="${openId}"]`)
  if (cell instanceof HTMLElement) cell.focus()
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
  // Clear any loading placeholder left from the previous item.
  stage.classList.remove("is-loading")
  stage.style.backgroundImage = ""
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
    // Cold-open a large photo shows an empty black stage until the display image
    // arrives (neighbor preload only helps subsequent nav). Seed the stage with
    // the already-tiny thumb (blurred) + a spinner until the full image loads.
    const img = stage.querySelector(".lightbox-media")
    if (img instanceof HTMLImageElement && !img.complete) {
      stage.style.backgroundImage = `url(/media/${item.file_key}/thumb)`
      stage.classList.add("is-loading")
      const done = () => {
        stage.classList.remove("is-loading")
        stage.style.backgroundImage = ""
      }
      img.addEventListener("load", done, { once: true })
      img.addEventListener("error", done, { once: true })
    }
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

  // Own pending upload: same reassurance the grid chip / guestbook / comments
  // give, so the uploader knows it isn't public yet (visible only to them).
  getElement("lightbox-pending").hidden = !(item.is_own && item.status === "pending")

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

async function shareOrCopy() {
  const items = source.getItems(section)
  const item = items[index]
  if (!item) return
  const url = `${location.origin}/gallery?section=${section}&item=${item.id}`
  const btn = getElement("lightbox-copy")
  const prev = btn.textContent
  const result = await shareUrl(url)
  if (result === "shared") return
  // Copy path (no native share): reflect the outcome on the button briefly.
  btn.textContent = result === "copied" ? "Copied!" : "Press ⌘/Ctrl+C"
  setTimeout(() => {
    btn.textContent = prev
  }, 1500)
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
    // A touch that starts on the video (native controls / scrubber) is the
    // player's — swiping here would yank the guest off the video mid-scrub.
    if (e.target instanceof HTMLElement && e.target.closest("video")) return
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
