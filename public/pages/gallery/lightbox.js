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
import { announcePolite } from "../../components/announce.js"
import { createTiltDepth } from "../../effects/tilt-depth.js"
import { prefersReducedMotion } from "../../effects/effect-utils.js"

const SWIPE_COMMIT_FRACTION = 0.25
const SWIPE_COMMIT_VELOCITY = 0.3 // px/ms

// Slideshow ("Memories" ambient mode) dwell per item. Videos aren't autoplayed
// (autoplay is unreliable + policy-gated on mobile); the slideshow dwells on the
// poster for a slightly longer beat, then advances — simpler and robust.
const SLIDESHOW_IMAGE_MS = 5000
const SLIDESHOW_VIDEO_MS = 7000

// Pinch-zoom bounds (images only).
const ZOOM_MIN = 1
const ZOOM_MAX = 4
const DOUBLE_TAP_ZOOM = 2.5
const DOUBLE_TAP_MS = 300

/** @type {Types.LightboxSource} */
let source
/** The source key: a section, or "all" for the combined official+guest list. */
/** @type {Types.GalleryView} */
let section = "all"
let index = -1
/** The element focused when the lightbox opened, to restore focus on close. */
let opener = /** @type {HTMLElement | null} */ (null)
/** Reply-to address for the "Report this photo" mailto; loaded from /api/config. */
let contactEmail = ""

/** Slideshow ("Memories" ambient mode) state. */
let playing = false
/** @type {ReturnType<typeof setTimeout> | null} */
let slideshowTimer = null
/** Screen wake-lock sentinel while the slideshow runs (best-effort; optional). */
/** @type {any} */
let wakeLock = null

/** Showing photos' black-and-white copies. Only a photo with a twin offers the
 *  flip (the feed names a twin only when the couple turned it on). The choice
 *  holds while the guest moves through the lightbox, so a run of photos can be
 *  browsed in black and white; a reload starts in colour again. */
let blackAndWhite = false

/** Pinch-zoom state for the current image (reset on every render/navigate). */
let zScale = 1
let zTx = 0
let zTy = 0

/** Gentle pointer/gyroscope tilt on the open photo. Started on open, stopped on
 *  close; the effect re-scans when its target <img> is swapped out on nav.
 *  @type {import("../../effects/types.js").EffectInstance | null} */
let tilt = null

/** Start the lightbox tilt (once). No-op under reduced motion. */
function startTilt() {
  if (tilt || prefersReducedMotion()) return
  tilt = createTiltDepth({ selector: ".lightbox-media", maxTilt: 2, depth: 4 })
  tilt.start()
}

function stopTilt() {
  if (tilt) {
    tilt.stop()
    tilt = null
  }
}

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
  getElement("lightbox-prev").addEventListener("click", () => {
    stopSlideshow()
    void navigate(-1)
  })
  getElement("lightbox-next").addEventListener("click", () => {
    stopSlideshow()
    void navigate(1)
  })
  getElement("lightbox-play").addEventListener("click", () => toggleSlideshow())
  getElement("lightbox-tone").addEventListener("click", () => {
    blackAndWhite = !blackAndWhite
    applyTone()
    announcePolite(blackAndWhite ? "Showing black and white" : "Showing colour")
  })
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
    stopSlideshow()
    stopTilt()
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
    // Don't hijack keys when the guest is typing a comment (the composer lives in
    // the lightbox) or scrubbing a video — navigating would rewrite the social
    // panel's innerHTML and discard an in-progress comment draft.
    const active = document.activeElement
    const typing =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLVideoElement
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (typing) return
      stopSlideshow()
      void navigate(e.key === "ArrowLeft" ? -1 : 1)
      return
    }
    // Spacebar toggles the slideshow — but only when focus isn't on a button
    // (Space activates a focused button natively; the play button's own click
    // handler would then fire alongside this, double-toggling) or a text field.
    if (e.key === " " || e.key === "Spacebar") {
      if (typing || active instanceof HTMLButtonElement) return
      e.preventDefault() // stop the page from scrolling
      toggleSlideshow()
    }
  })

  wireStagePointer(getElement("lightbox-stage"))
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
  startTilt()
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
  // Clear any loading placeholder left from the previous item, and reset zoom —
  // a new item always starts at 1x (the fresh innerHTML has no transform, but
  // the module state vars must be cleared too).
  stage.classList.remove("is-loading")
  stage.classList.remove("stage-zoomed")
  stage.style.backgroundImage = ""
  zScale = 1
  zTx = 0
  zTy = 0
  // Ken Burns + soft fade only for a playing slideshow on an image, and never
  // under reduced motion (celebrate/effect convention). Otherwise a plain cut.
  const slideshowAnim = playing && !prefersReducedMotion()
  if (item.kind === "video") {
    stage.innerHTML = html`
      <video class="lightbox-media" src="/media/${item.file_key}/video" controls
        playsinline preload="none" poster="/media/${item.file_key}/poster"></video>`
  } else if (item.needs_display) {
    stage.innerHTML = html`
      <div class="lightbox-missing">This photo couldn't be processed for web viewing.</div>`
  } else {
    const alt = item.caption || `Photo by ${item.author_name}`
    const animClass = slideshowAnim ? " slideshow-anim" : ""
    stage.innerHTML = html`
      <img class="lightbox-media${animClass}" src="/media/${shownKey(item)}/display" alt="${alt}">`
    seedWhileLoading(stage, shownKey(item))
  }
  renderToneButton(item)

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
 * The file this item shows: its black-and-white twin while that is chosen and
 * it has one it can show, otherwise the photo itself.
 * @param {Types.MediaListItem} item @returns {string}
 */
function shownKey(item) {
  return blackAndWhite && item.twin && !item.twin.needs_display
    ? item.twin.file_key
    : item.file_key
}

/**
 * Cold-open a large photo shows an empty black stage until the display image
 * arrives (neighbor preload only helps subsequent nav). Seed the stage with the
 * already-tiny thumb (blurred) + a spinner until the full image loads.
 * @param {HTMLElement} stage @param {string} fileKey
 */
function seedWhileLoading(stage, fileKey) {
  const img = stage.querySelector(".lightbox-media")
  if (!(img instanceof HTMLImageElement) || img.complete) return
  stage.style.backgroundImage = `url(/media/${fileKey}/thumb)`
  stage.classList.add("is-loading")
  const done = () => {
    stage.classList.remove("is-loading")
    stage.style.backgroundImage = ""
  }
  img.addEventListener("load", done, { once: true })
  img.addEventListener("error", done, { once: true })
}

/** The colour ⇄ black-and-white button: only on a photo that has a twin.
 *  @param {Types.MediaListItem} item */
function renderToneButton(item) {
  const btn = getElement("lightbox-tone")
  const offered = item.kind === "image" && !item.needs_display && !!item.twin &&
    !item.twin.needs_display
  btn.hidden = !offered
  btn.setAttribute("aria-pressed", offered && blackAndWhite ? "true" : "false")
}

/**
 * Flip the open photo between colour and black and white in place. Only the
 * image changes: re-rendering would rebuild the comment panel and lose a draft.
 */
function applyTone() {
  const item = source.getItems(section)[index]
  if (!item) return
  renderToneButton(item)
  const stage = getElement("lightbox-stage")
  const img = stage.querySelector(".lightbox-media")
  if (!(img instanceof HTMLImageElement)) return
  const key = shownKey(item)
  const src = `/media/${key}/display`
  if (img.getAttribute("src") === src) return
  img.setAttribute("src", src)
  seedWhileLoading(stage, key)
  preloadNeighbors()
}

/**
 * Delete the current item (the signed-in uploader's own photo). Confirms, calls
 * DELETE /api/media/:id, drops it from the grid via source.onDelete, then either
 * closes (section now empty) or advances to the neighbour that slid into place.
 */
async function deleteCurrent() {
  stopSlideshow()
  const items = source.getItems(section)
  const item = items[index]
  if (!item) return
  if (!window.confirm("Remove your photo from the gallery?")) return
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
      new Image().src = `/media/${shownKey(item)}/display`
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
  // Shared links from the "all" view carry no ?section — the default view.
  const sectionParam = section === "all" ? "" : `section=${section}&`
  const url = `${location.origin}/gallery?${sectionParam}item=${item.id}`
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

// ---- Slideshow ("Memories" ambient mode) ---------------------------------

function toggleSlideshow() {
  if (playing) stopSlideshow()
  else startSlideshow()
}

function startSlideshow() {
  if (playing || !isLightboxOpen()) return
  playing = true
  updatePlayButton()
  announcePolite("Slideshow playing")
  void requestWakeLock()
  // Re-render the current item so an image picks up the Ken Burns/fade class.
  render()
  scheduleNext()
}

function stopSlideshow() {
  if (!playing) return
  playing = false
  if (slideshowTimer) {
    clearTimeout(slideshowTimer)
    slideshowTimer = null
  }
  releaseWakeLock()
  updatePlayButton()
  announcePolite("Slideshow paused")
  // Drop the Ken Burns/fade animation from the current image.
  const img = getStageImage()
  if (img) img.classList.remove("slideshow-anim")
}

function updatePlayButton() {
  const btn = getElement("lightbox-play")
  btn.setAttribute("aria-pressed", String(playing))
  btn.setAttribute("aria-label", playing ? "Pause slideshow" : "Play slideshow")
  btn.classList.toggle("is-playing", playing)
}

/** Schedule the next auto-advance, timed by the current item's kind. */
function scheduleNext() {
  if (slideshowTimer) clearTimeout(slideshowTimer)
  const item = source.getItems(section)[index]
  const dwell = item && item.kind === "video" ? SLIDESHOW_VIDEO_MS : SLIDESHOW_IMAGE_MS
  slideshowTimer = setTimeout(() => void slideshowAdvance(), dwell)
}

/** Advance the slideshow, wrapping to the start at the true end so the ambient
 *  loop never stalls. Distinct from manual navigate() (which stops at the ends). */
async function slideshowAdvance() {
  if (!playing) return
  const items = source.getItems(section)
  if (items.length <= 1) {
    stopSlideshow()
    return
  }
  const atEnd = index + 1 >= items.length && !source.hasMore(section)
  if (atEnd) {
    pauseVideo()
    index = 0
    render()
    source.onChange(section, items[0].id)
  } else {
    await navigate(1)
  }
  if (playing) scheduleNext()
}

/** Best-effort screen wake lock so an unattended slideshow doesn't dim. Fully
 *  optional — any failure (unsupported, denied) is swallowed. */
async function requestWakeLock() {
  try {
    const nav = /** @type {any} */ (navigator)
    if (nav.wakeLock && typeof nav.wakeLock.request === "function") {
      wakeLock = await nav.wakeLock.request("screen")
    }
  } catch {
    wakeLock = null
  }
}

function releaseWakeLock() {
  try {
    if (wakeLock && typeof wakeLock.release === "function") wakeLock.release()
  } catch {
    // ignore
  }
  wakeLock = null
}

// ---- Stage pointer: swipe-nav + pinch/pan zoom (images) -------------------

/** The current stage <img>, or null when the stage shows a video/placeholder. */
function getStageImage() {
  const el = getElement("lightbox-stage").querySelector(".lightbox-media")
  return el instanceof HTMLImageElement ? el : null
}

/** Apply the current zoom transform to the stage image (cleared at 1x/no pan). */
function applyZoom() {
  const img = getStageImage()
  if (!img) return
  img.style.transform =
    zScale === 1 && zTx === 0 && zTy === 0
      ? ""
      : `translate(${zTx}px, ${zTy}px) scale(${zScale})`
}

/** Clamp pan so the zoomed image edges can't be dragged inside the viewport. */
function clampPan() {
  const img = getStageImage()
  if (!img) return
  const maxX = (img.clientWidth * (zScale - 1)) / 2
  const maxY = (img.clientHeight * (zScale - 1)) / 2
  zTx = Math.max(-maxX, Math.min(maxX, zTx))
  zTy = Math.max(-maxY, Math.min(maxY, zTy))
}

/**
 * Combined Pointer-Events handler: single-finger swipe-nav at 1x, two-finger
 * pinch to zoom (1–4x, images only), single-finger pan while zoomed, and
 * double-tap to toggle 1x/2.5x. Any zoom >1 suppresses swipe-nav until it's
 * back at 1x. Mouse drags are ignored (chevrons/keys serve desktop).
 * @param {HTMLElement} stage
 */
function wireStagePointer(stage) {
  /** @type {Map<number, { x: number, y: number }>} */
  const pointers = new Map()
  let startDist = 0
  let startScale = 1
  let panStartX = 0
  let panStartY = 0
  let panBaseTx = 0
  let panBaseTy = 0
  let swipeStartX = 0
  let swipeStartT = 0
  let swiping = false
  let moved = false
  let lastTapT = 0

  stage.addEventListener("pointerdown", (e) => {
    // A touch that starts on the video (native controls / scrubber) is the
    // player's — swiping here would yank the guest off the video mid-scrub.
    if (e.target instanceof HTMLElement && e.target.closest("video")) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved = false
    const img = getStageImage()
    if (img) img.style.transition = ""

    if (pointers.size === 2) {
      // Begin pinch (cancels any in-progress swipe). A zoom gesture is manual
      // interaction, so it also stops the slideshow (and clears its Ken Burns
      // transform, which would otherwise fight the inline zoom transform).
      stopSlideshow()
      swiping = false
      stage.style.transition = ""
      stage.style.transform = ""
      const pts = [...pointers.values()]
      startDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      startScale = zScale
    } else if (pointers.size === 1) {
      if (zScale > 1) {
        panStartX = e.clientX
        panStartY = e.clientY
        panBaseTx = zTx
        panBaseTy = zTy
      } else if (e.pointerType !== "mouse") {
        swiping = true
        swipeStartX = e.clientX
        swipeStartT = e.timeStamp
        stage.style.transition = "none"
      }
    }
  })

  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved = true

    if (pointers.size >= 2) {
      const pts = [...pointers.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      if (startDist > 0 && getStageImage()) {
        zScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, startScale * (dist / startDist)))
        clampPan()
        applyZoom()
        stage.classList.toggle("stage-zoomed", zScale > 1)
      }
    } else if (pointers.size === 1) {
      if (zScale > 1) {
        zTx = panBaseTx + (e.clientX - panStartX)
        zTy = panBaseTy + (e.clientY - panStartY)
        clampPan()
        applyZoom()
      } else if (swiping) {
        stage.style.transform = `translateX(${e.clientX - swipeStartX}px)`
      }
    }
  })

  const end = (/** @type {PointerEvent} */ e) => {
    const wasTwo = pointers.size >= 2
    pointers.delete(e.pointerId)

    // Finish a single-finger swipe (only when not zoomed and all fingers up).
    if (swiping && zScale <= 1 && pointers.size === 0) {
      swiping = false
      const dx = e.clientX - swipeStartX
      const dt = Math.max(1, e.timeStamp - swipeStartT)
      const velocity = Math.abs(dx) / dt
      stage.style.transition = ""
      stage.style.transform = ""
      if (
        Math.abs(dx) > stage.clientWidth * SWIPE_COMMIT_FRACTION ||
        velocity > SWIPE_COMMIT_VELOCITY
      ) {
        stopSlideshow()
        void navigate(dx < 0 ? 1 : -1)
      }
    }

    // Double-tap toggles zoom (touch, on an image, a stationary single tap).
    if (e.pointerType !== "mouse" && !moved && !wasTwo && getStageImage()) {
      const nowT = e.timeStamp
      if (nowT - lastTapT < DOUBLE_TAP_MS) {
        toggleDoubleTapZoom(e.clientX, e.clientY)
        lastTapT = 0
      } else {
        lastTapT = nowT
      }
    }

    // Settle: snap fully back to 1x state once no fingers remain zoomed.
    if (zScale <= 1) {
      zScale = 1
      zTx = 0
      zTy = 0
      stage.classList.remove("stage-zoomed")
      applyZoom()
    }
    if (pointers.size < 2) startDist = 0
  }

  stage.addEventListener("pointerup", end)
  stage.addEventListener("pointercancel", end)

  /** @param {number} clientX @param {number} clientY */
  function toggleDoubleTapZoom(clientX, clientY) {
    const img = getStageImage()
    if (!img) return
    stopSlideshow() // manual zoom interaction ends ambient mode
    if (!prefersReducedMotion()) img.style.transition = "transform 0.25s ease"
    if (zScale > 1) {
      zScale = 1
      zTx = 0
      zTy = 0
      stage.classList.remove("stage-zoomed")
    } else {
      zScale = DOUBLE_TAP_ZOOM
      const rect = img.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      // Shift the tapped point toward the centre so the zoom focuses on it.
      zTx = (cx - clientX) * (zScale - 1)
      zTy = (cy - clientY) * (zScale - 1)
      clampPan()
      stage.classList.add("stage-zoomed")
    }
    applyZoom()
  }
}
