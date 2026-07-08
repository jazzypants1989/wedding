/** @file Gallery upload tray: file picker + FAB + drag-drop driving the
 *  UI-agnostic media-uploader engine; renders per-file progress and prepends
 *  finished items into the guest grid. See docs/post-wedding/04-gallery.md §6. */
/** @import * as Types from "./types.js" */
/** @import * as Components from "../../components/types.js" */

import { html, getElement, getInputElement } from "../utils.js"
import { requireAccount, session } from "../../components/guest-session.js"
import { fireConfetti } from "../../components/celebrate.js"
import { createUploadQueue } from "../../components/media-uploader.js"
import { prependItem } from "./grid.js"

/** @type {Components.UploadQueue} */
let queue
/** Guard against prepending the same finished item twice. */
const prepended = new Set()
let pendingNoteShown = false

/** @type {Types.initUpload} */
export function initUpload() {
  queue = createUploadQueue({
    onChange: onItemChange,
    onFirstSuccess: fireConfetti,
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

  getElement("upload-cancel-all").addEventListener("click", () => {
    if (queue.activeCount() > 1 && !confirm("Cancel all uploads?")) return
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
    caption: null,
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

  getElement("upload-tray-list").innerHTML = html`${items.map(rowMarkup)}`
}

/** @param {Components.UploadQueueItem} item @returns {string} */
function rowMarkup(item) {
  const preview = item.previewUrl
    ? html`<img class="upload-thumb" src="${item.previewUrl}" alt="">`
    : html`<span class="upload-thumb upload-thumb-empty" aria-hidden="true"></span>`

  const bar =
    item.state === "uploading"
      ? html`<div class="upload-bar"><div class="upload-bar-fill"
          style="width:${Math.round(item.progress * 100)}%"></div></div>`
      : ""

  let actions = html`<button type="button" class="upload-action" data-action="remove"
    data-id="${item.id}">Remove</button>`
  if (item.state === "failed" && item.retryable) {
    actions = html`
      <button type="button" class="upload-action" data-action="retry" data-id="${item.id}">Retry</button>
      ${actions}`
  }

  return html`
    <li class="upload-row" data-id="${item.id}">
      ${preview}
      <div class="upload-row-main">
        <span class="upload-name">${item.name}</span>
        <span class="upload-row-state ${item.state === "failed" ? "is-error" : ""}">${stateLabel(item)}</span>
        ${bar}
      </div>
      <div class="upload-row-actions">${actions}</div>
    </li>`
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
  if (pendingNoteShown) return
  pendingNoteShown = true
  const summary = getElement("upload-tray-summary")
  summary.insertAdjacentText(
    "afterend",
    " Jordana & Jesse approve photos from new folks — yours will appear for everyone soon.",
  )
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
