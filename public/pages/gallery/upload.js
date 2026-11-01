/** @file Gallery upload tray: file picker + FAB + drag-drop driving the
 *  UI-agnostic media-uploader engine; renders per-file progress and prepends
 *  finished items into the guest grid. See docs/post-wedding/04-gallery.md §6. */
/** @import * as Types from "./types.js" */
/** @import * as Components from "../../components/types.js" */

import {
  html,
  getCoupleName,
  getElement,
  getInputElement,
  announceCharsRemaining,
} from "../utils.js"
import { requireAccount, session, loadSession } from "../../components/guest-session.js"
import { fireConfetti, champagnePop, miniSparkle } from "../../components/celebrate.js"
import { showNote } from "../../components/notice.js"
import { announcePolite } from "../../components/announce.js"
import { createUploadQueue } from "../../components/media-uploader.js"
import { prependItem } from "./grid.js"

/** Caption length cap — matches the server's sanitizeCaption clamp (LIMITS.MESSAGE_MAX_LENGTH). */
const CAPTION_MAX = 1000
/** Show the caption counter only within this many chars of the cap. */
const CAPTION_COUNT_AT = 100

/** @type {Components.UploadQueue} */
let queue
/** Guard against prepending the same finished item twice. */
const prepended = new Set()
/** Rows whose failure has already been spoken (cleared when they leave failed),
 *  so a screen-reader user hears WHY each file failed once, not on every event. */
const announcedFailures = new Set()

/** @type {Types.initUpload} */
export function initUpload() {
  queue = createUploadQueue({
    onChange: onItemChange,
    onFirstSuccess: onFirstSuccess,
  })

  const input = getInputElement("upload-input")
  input.addEventListener("change", () => {
    if (input.files && input.files.length) queue.add(input.files)
    input.value = "" // allow re-selecting the same file
  })

  getElement("upload-open").addEventListener("click", () =>
    requireAccount(() => input.click()),
  )
  getElement("upload-fab").addEventListener("click", () =>
    requireAccount(() => input.click()),
  )

  // The guest empty-state CTA is rendered dynamically by the grid; delegate.
  getElement("grid-guest").addEventListener("click", (e) => {
    const el = e.target
    if (el instanceof HTMLElement && el.id === "gallery-empty-cta") {
      requireAccount(() => input.click())
    }
  })

  getElement("upload-cancel-all").addEventListener("click", () => {
    // Confirm whenever there's in-flight work, regardless of count (a single
    // active upload is just as easy to cancel by accident as several); with
    // nothing active this only clears the finished tray, so skip the prompt.
    if (queue.activeCount() > 0 && !confirm("Cancel all uploads?")) return
    queue.cancelAll()
    renderTray()
  })

  // Delegated Retry / Remove.
  getElement("upload-tray-list").addEventListener("click", (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest("[data-action]")
    if (!(btn instanceof HTMLElement)) return
    const id = btn.dataset.id
    if (!id) return
    // Retry re-enters the write path, so it re-checks sign-in: a 401 failure
    // (expired session) marks the row retryable, and this gate opens the auth
    // sheet before the retry replays.
    if (btn.dataset.action === "retry") requireAccount(() => queue.retry(id))
    else if (btn.dataset.action === "remove") {
      queue.remove(id)
      renderTray()
    }
  })

  // Delegated caption input → store on the queue item (sent at finalize, or
  // PATCHed if the row already finalized). Kept off the full re-render path so
  // typing isn't interrupted by other items' progress events.
  getElement("upload-tray-list").addEventListener("input", (e) => {
    const input = e.target
    if (!(input instanceof HTMLInputElement)) return
    if (!input.classList.contains("upload-caption")) return
    const id = input.dataset.id
    if (!id) return
    queue.setCaption(id, input.value)
    updateCaptionCount(input)
  })

  wireDragDrop(getElement("grid-guest"))
  wireFab()
  wireUnloadGuard()

  // When connectivity returns, resume uploads that failed on the network — the
  // guest shouldn't have to tap Retry on each row after a dead spot. Only
  // network failures (errorStatus 0) auto-resume; auth (401) and terminal
  // format/size errors are left for the guest to handle.
  window.addEventListener("online", () => {
    for (const item of queue.getItems()) {
      if (item.state === "failed" && item.retryable && item.errorStatus === 0) {
        queue.retry(item.id)
      }
    }
  })
}

/**
 * Reveal a caption's character counter only as it nears the cap (a full counter
 * on every row would clutter the tray), and announce "chars left" to SR users.
 * @param {HTMLInputElement} input
 */
function updateCaptionCount(input) {
  const row = input.closest(".upload-row")
  const count = row && row.querySelector(".upload-caption-count")
  if (!(count instanceof HTMLElement)) return
  const len = input.value.length
  if (CAPTION_MAX - len <= CAPTION_COUNT_AT) {
    count.hidden = false
    count.textContent = `${len}/${CAPTION_MAX}`
  } else {
    count.hidden = true
  }
  announceCharsRemaining(len, CAPTION_MAX, count)
}

// Batch celebration state: sparkles are capped per batch so a 30-photo dump
// doesn't strobe, and the champagne pop fires once per completed multi-item
// batch (from the newest grid cell). All celebrate helpers self-gate under
// prefers-reduced-motion.
const BATCH_SPARKLE_CAP = 5
let batchSparkles = 0
let batchActive = false
/** @type {number | null} */
let newestCellId = null

/** @param {Components.UploadQueueItem} item */
function onItemChange(item) {
  if ((item.state === "done" || item.state === "pending") && !prepended.has(item.id)) {
    prepended.add(item.id)
    prependItem(toListItem(item))
    if (item.state === "pending") showPendingNote()
    // Sparkle the freshly-landed thumbnail (capped per batch).
    if (typeof item.serverId === "number") {
      newestCellId = item.serverId
      if (batchSparkles < BATCH_SPARKLE_CAP) {
        batchSparkles += 1
        const cell = document.querySelector(`.media-cell[data-id="${item.serverId}"]`)
        if (cell instanceof HTMLElement) miniSparkle(cell)
      }
    }
  }
  // A 401 means the session died server-side while local state still says
  // signed-in. Re-sync so the identity UI tells the truth and the row's Retry
  // (gated by requireAccount) opens the auth sheet instead of failing again.
  if (item.state === "failed" && item.errorStatus === 401 && session.account) {
    void loadSession()
  }
  // Speak the specific reason once per failure — the tray summary only says
  // "N failed", and the per-row reason ("Not a supported format", "too large")
  // lives outside any live region, so a screen-reader user never hears it.
  if (item.state === "failed") {
    if (!announcedFailures.has(item.id)) {
      announcedFailures.add(item.id)
      announcePolite(`${item.name}: ${item.error || "upload failed"}`)
    }
  } else {
    announcedFailures.delete(item.id)
  }
  renderTray()
}

/**
 * Build a public gallery item from a finished upload (author is the signed-in
 * guest; the row is their own, so pending items render with the author-only chip).
 * @param {Components.UploadQueueItem} item @returns {Types.MediaListItem}
 */
function toListItem(item) {
  return {
    id: /** @type {number} */ (item.serverId),
    file_key: /** @type {string} */ (item.fileKey),
    kind: item.kind === "video" ? "video" : "image",
    section: "guest",
    status: /** @type {any} */ (item.status),
    caption: item.caption ? item.caption.trim() : null,
    width: item.width,
    height: item.height,
    duration_seconds: item.durationS,
    needs_display: item.displayMissing,
    author_name: session.account ? session.account.name : "You",
    is_own: true,
    created_at: new Date().toISOString(),
  }
}

function renderTray() {
  const items = queue.getItems()
  const tray = getElement("upload-tray")
  if (items.length === 0) {
    tray.hidden = true
    return
  }
  tray.hidden = false

  const active = queue.activeCount()
  const failed = items.filter((i) => i.state === "failed").length
  const succeeded = items.filter(
    (i) => i.state === "done" || i.state === "pending",
  ).length
  // The summary is the tray's only live region, so it must carry failures too —
  // otherwise a queue that ends entirely in errors still announces "complete".
  // On a mixed batch, acknowledge what DID work rather than only the failures.
  const summary =
    active > 0
      ? `Uploading ${items.length - active + 1} of ${items.length}…`
      : failed > 0
        ? succeeded > 0
          ? `${succeeded} added · ${failed} failed`
          : `${failed} upload${failed === 1 ? "" : "s"} failed`
        : "Uploads complete"
  const summaryEl = getElement("upload-tray-summary")
  // The summary is the tray's only live region; skip identical reassignment,
  // which replaces the text node and can re-announce it.
  if (summaryEl.textContent !== summary) summaryEl.textContent = summary

  // Batch-completion beat: on the active→idle edge of a multi-item batch, pop
  // champagne from the newest landed cell (viewport confetti if it scrolled
  // away). Single uploads keep the quieter first-success confetti only.
  if (active > 0) {
    batchActive = true
  } else if (batchActive) {
    batchActive = false
    batchSparkles = 0
    if (succeeded >= 2) {
      const cell =
        newestCellId !== null
          ? document.querySelector(`.media-cell[data-id="${newestCellId}"]`)
          : null
      if (cell instanceof HTMLElement) champagnePop(cell)
      else fireConfetti()
    }
  }

  // With nothing active the button only clears finished rows — say so.
  getElement("upload-cancel-all").textContent = active > 0 ? "Cancel all" : "Clear"

  // Reconcile rows in place (create/update/remove) rather than replacing the
  // list wholesale, so a caption input being typed into survives other items'
  // progress events.
  const list = getElement("upload-tray-list")
  const seen = new Set()
  for (const item of items) {
    seen.add(item.id)
    let row = /** @type {HTMLElement | null} */ (
      list.querySelector(`.upload-row[data-id="${item.id}"]`)
    )
    if (!(row instanceof HTMLElement)) {
      const wrapper = document.createElement("template")
      wrapper.innerHTML = rowMarkup(item)
      row = /** @type {HTMLElement} */ (wrapper.content.firstElementChild)
      list.appendChild(row)
    }
    updateRow(row, item)
  }
  for (const row of Array.from(list.querySelectorAll(".upload-row"))) {
    if (row instanceof HTMLElement && !seen.has(row.dataset.id)) row.remove()
  }
}

/** Whether an item is far enough along to caption (past queued; not failed). */
/** @param {Components.UploadQueueItem} item @returns {boolean} */
function canCaption(item) {
  return (
    item.state === "processing" ||
    item.state === "uploading" ||
    item.state === "done" ||
    item.state === "pending"
  )
}

/** @param {Components.UploadQueueItem} item @returns {string} */
function rowMarkup(item) {
  const preview = item.previewUrl
    ? html`<img class="upload-thumb" src="${item.previewUrl}" alt="">`
    : html`<span class="upload-thumb upload-thumb-empty" aria-hidden="true"></span>`

  return html`
    <li class="upload-row" data-id="${item.id}">
      ${preview}
      <div class="upload-row-main">
        <span class="upload-name">${item.name}</span>
        <span class="upload-row-state">${stateLabel(item)}</span>
        <div class="upload-bar-slot"></div>
        <input type="text" class="upload-caption" data-id="${item.id}"
          maxlength="${CAPTION_MAX}" placeholder="Add a caption (optional)"
          aria-label="Caption for ${item.name}" hidden>
        <span class="upload-caption-count char-counter" aria-hidden="true" hidden></span>
        <span class="upload-caption-error" role="alert" hidden>Caption didn't save — try typing it again.</span>
      </div>
      <div class="upload-row-actions"></div>
    </li>`
}

/**
 * Update the mutable parts of an existing row in place (label, progress bar,
 * actions, caption visibility) without touching the caption input's value.
 * @param {HTMLElement} row @param {Components.UploadQueueItem} item
 */
function updateRow(row, item) {
  const stateEl = row.querySelector(".upload-row-state")
  if (stateEl instanceof HTMLElement) {
    stateEl.textContent = stateLabel(item)
    stateEl.classList.toggle("is-error", item.state === "failed")
  }

  const barSlot = row.querySelector(".upload-bar-slot")
  if (barSlot instanceof HTMLElement) {
    if (item.state !== "uploading") {
      barSlot.innerHTML = ""
    } else {
      // Kept across updates so the width transition animates. The width is a
      // CSSOM write: a `style=` attribute is blocked by the CSP and the fill
      // would sit at full width (T18).
      if (!barSlot.firstElementChild) {
        barSlot.innerHTML = html`<div class="upload-bar"><div class="upload-bar-fill"></div></div>`
      }
      const fill = barSlot.querySelector(".upload-bar-fill")
      if (fill instanceof HTMLElement) fill.style.width = `${Math.round(item.progress * 100)}%`
    }
  }

  const caption = row.querySelector(".upload-caption")
  if (caption instanceof HTMLInputElement) caption.hidden = !canCaption(item)

  const captionErr = row.querySelector(".upload-caption-error")
  if (captionErr instanceof HTMLElement) captionErr.hidden = !item.captionError

  const actionsEl = row.querySelector(".upload-row-actions")
  if (actionsEl instanceof HTMLElement) {
    let actions = html`<button type="button" class="upload-action" data-action="remove"
      data-id="${item.id}">Remove</button>`
    if (item.state === "failed" && item.retryable) {
      actions = html`
        <button type="button" class="upload-action" data-action="retry" data-id="${item.id}">Retry</button>
        ${actions}`
    }
    actionsEl.innerHTML = actions
  }
}

/** @param {Components.UploadQueueItem} item @returns {string} */
function stateLabel(item) {
  switch (item.state) {
    case "queued":
      return "Queued"
    case "processing":
      return "Processing…"
    case "uploading":
      return `Uploading… ${Math.round(item.progress * 100)}%`
    case "done":
      return "Done ✓"
    case "pending":
      return "Awaiting approval ⏳"
    case "failed":
      return `⚠ ${item.error || "Upload failed"}`
    default:
      return ""
  }
}

function showPendingNote() {
  // Same dismissible, once-persisted treatment as the guestbook pending note,
  // in a persistent spot (the tray auto-hides when the queue clears).
  showNote(getElement("gallery-pending-note"), {
    message: `Thanks! ${getCoupleName()} approve photos from new folks — yours will appear for everyone soon.`,
    once: "galleryPendingNoteSeen",
  })
}

/**
 * First finished upload this visit → confetti, then a one-time nudge toward the
 * guestbook so the two post-wedding features cross-pollinate. The copy adapts to
 * whether the upload went live or is held for the couple's approval, so the
 * celebration doesn't claim "Photos are up" while the row still says "pending".
 * @param {string} status finalize status ("approved" | "pending")
 */
function onFirstSuccess(status) {
  fireConfetti()
  const message =
    status === "approved"
      ? "Photos are up 🎉 — leave them a note in the guestbook too?"
      : "Thanks — your photos are on their way! 🎉 Leave a note in the guestbook too?"
  showNote(getElement("gallery-nudge"), {
    message,
    once: "galleryToGuestbookNudge",
    linkHref: "/guestbook",
    linkLabel: "Sign the guestbook",
    nudge: true,
  })
}

/** @param {HTMLElement} dropZone */
function wireDragDrop(dropZone) {
  const stop = (/** @type {Event} */ e) => {
    e.preventDefault()
    e.stopPropagation()
  }
  dropZone.addEventListener("dragover", (e) => {
    stop(e)
    dropZone.classList.add("drag-over")
  })
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"))
  dropZone.addEventListener("drop", (e) => {
    stop(e)
    dropZone.classList.remove("drag-over")
    const files = /** @type {DragEvent} */ (e).dataTransfer?.files
    if (files && files.length) {
      // Capture files now; requireAccount replays this after sign-in.
      requireAccount(() => queue.add(files))
    }
  })
}

function wireFab() {
  const fab = getElement("upload-fab")
  const onScroll = () => {
    // Uploads land in the guest grid, which is on screen everywhere except
    // a curated section's own view (official, honeymoon).
    const curatedOnly =
      getElement("tab-official").getAttribute("aria-selected") === "true" ||
      getElement("tab-honeymoon").getAttribute("aria-selected") === "true"
    fab.hidden = !(!curatedOnly && window.scrollY > 400)
  }
  window.addEventListener("scroll", onScroll, { passive: true })
  // Re-evaluate when the section switches (custom event from main.js).
  window.addEventListener("gallery:sectionchange", onScroll)
  onScroll()
}

function wireUnloadGuard() {
  window.addEventListener("beforeunload", (e) => {
    if (queue && queue.activeCount() > 0) {
      e.preventDefault()
      e.returnValue = ""
    }
  })
}
