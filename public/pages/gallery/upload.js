/** @file Gallery upload tray: file picker + FAB + drag-drop driving the
 *  UI-agnostic media-uploader engine; renders per-file progress and prepends
 *  finished items into the guest grid. See docs/post-wedding/04-gallery.md §6. */
/** @import * as Types from "./types.js" */
/** @import * as Components from "../../components/types.js" */

import { html, getCoupleName, getElement, getInputElement } from "../utils.js"
import { requireAccount, session } from "../../components/guest-session.js"
import { fireConfetti } from "../../components/celebrate.js"
import { showNote } from "../../components/notice.js"
import { createUploadQueue } from "../../components/media-uploader.js"
import { prependItem } from "./grid.js"

/** @type {Components.UploadQueue} */
let queue
/** Guard against prepending the same finished item twice. */
const prepended = new Set()

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
    if (btn.dataset.action === "retry") queue.retry(id)
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
    if (id) queue.setCaption(id, input.value)
  })

  wireDragDrop(getElement("grid-guest"))
  wireFab()
  wireUnloadGuard()
}

/** @param {Components.UploadQueueItem} item */
function onItemChange(item) {
  if ((item.state === "done" || item.state === "pending") && !prepended.has(item.id)) {
    prepended.add(item.id)
    prependItem(toListItem(item))
    if (item.state === "pending") showPendingNote()
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
  const summary =
    active > 0
      ? `Uploading ${items.length - active + 1} of ${items.length}…`
      : "Uploads complete"
  getElement("upload-tray-summary").textContent = summary

  // Reconcile rows in place (create/update/remove) rather than replacing the
  // list wholesale, so a caption input being typed into survives other items'
  // progress events.
  const list = getElement("upload-tray-list")
  const seen = new Set()
  for (const item of items) {
    seen.add(item.id)
    let row = list.querySelector(`.upload-row[data-id="${item.id}"]`)
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
          maxlength="200" placeholder="Add a caption (optional)"
          aria-label="Caption for ${item.name}" hidden>
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
    barSlot.innerHTML =
      item.state === "uploading"
        ? html`<div class="upload-bar"><div class="upload-bar-fill"
            style="width:${Math.round(item.progress * 100)}%"></div></div>`
        : ""
  }

  const caption = row.querySelector(".upload-caption")
  if (caption instanceof HTMLInputElement) caption.hidden = !canCaption(item)

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
 * guestbook so the two post-wedding features cross-pollinate.
 */
function onFirstSuccess() {
  fireConfetti()
  showNote(getElement("gallery-nudge"), {
    message: "Photos are up 🎉 — leave them a note in the guestbook too?",
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
    const guestActive =
      getElement("tab-guest").getAttribute("aria-selected") === "true"
    fab.hidden = !(guestActive && window.scrollY > 400)
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
