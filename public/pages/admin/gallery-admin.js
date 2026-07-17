/** @file Gallery tab (Phase 6) — the curated "Official" section manager: a grid
 *  of official items with position numbers, button-based reorder (no drag —
 *  binding decision), inline caption editing, remove, and an "Add official
 *  photos" modal that drives the shared media-uploader as the admin principal
 *  (csrf cookie + section:'official', reconciliation 7). */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../../types.js' */
/** @import * as Components from '../../components/types.js' */

import { state } from "./state.js"
import { api, openModal, closeModal, showSuccess, showLoading, showLoadError } from "./utils.js"
import {
  html,
  getElement,
  getInputElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"
import { createUploadQueue } from "../../components/media-uploader.js"

/** @type {Components.UploadQueue} */
let queue
/** Debounce handle for the batched reorder POST. */
let reorderTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)
/** Debounce handle coalescing the post-upload grid reload across a batch. */
let uploadReloadTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)
/** Upload ids already folded into the grid (guards double-refresh). */
const foldedIn = new Set()

// ---- load + render --------------------------------------------------------

/** @type {Types.loadGalleryAdmin} */
export async function loadGalleryAdmin() {
  try {
    if (!foldedIn.size) showLoading(getElement("curated-grid"))
    const data = /** @type {GlobalTypes.MediaListResponse} */ (
      await api("/api/media?section=official&limit=500")
    )
    state.currentCurated = data.items
    renderGrid()
  } catch (err) {
    console.error("Failed to load official gallery:", err)
    showLoadError(
      getElement("curated-grid"),
      1,
      "Couldn't load the official gallery.",
      loadGalleryAdmin,
    )
  }
}

function renderGrid() {
  const grid = getElement("curated-grid")
  const items = state.currentCurated
  if (items.length === 0) {
    grid.innerHTML = html`<p class="curated-empty">
      No official photos yet. Use "Add official photos" to upload, or promote a guest
      photo from the moderation queue.
    </p>`
    return
  }
  grid.innerHTML = html`${items.map(itemMarkup)}`
}

/** @param {GlobalTypes.MediaListItem} item @param {number} index @returns {string} */
function itemMarkup(item, index) {
  const total = state.currentCurated.length
  const isVideo = item.kind === "video"
  const thumb =
    item.needs_display && !isVideo
      ? html`<div class="curated-thumb mod-thumb-empty">HEIC</div>`
      : html`<img class="curated-thumb"
          src="/media/${item.file_key}/${isVideo ? "poster" : "thumb"}"
          alt="" loading="lazy" />`
  return html`
    <div class="curated-item" data-id="${item.id}">
      <div class="curated-thumb-wrap">
        <input type="number" class="curated-pos" data-id="${item.id}"
          value="${index + 1}" min="1" max="${total}" inputmode="numeric"
          aria-label="Position — type a number to move this photo there" />
        ${thumb}
      </div>
      <input type="text" class="curated-caption" data-id="${item.id}"
        value="${item.caption || ""}" placeholder="Add a caption…" maxlength="500"
        aria-label="Caption" />
      <div class="curated-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-action="top"
          title="Move to top" aria-label="Move to top" ${index === 0 ? "disabled" : ""}>⤒</button>
        <button type="button" class="btn btn-secondary btn-sm" data-action="up"
          title="Move up" aria-label="Move up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="btn btn-secondary btn-sm" data-action="down"
          title="Move down" aria-label="Move down" ${index === total - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="remove"
          title="Remove" aria-label="Remove">✕</button>
      </div>
    </div>
  `
}

/** @param {string} msg */
function showGalleryError(msg) {
  const el = getElement("gallery-error")
  el.textContent = msg
  el.hidden = false
  setTimeout(() => {
    el.hidden = true
  }, 6000)
}

// ---- reorder --------------------------------------------------------------

/** Current index of a curated item, or -1. @param {number} id @returns {number} */
function curatedIndex(id) {
  return state.currentCurated.findIndex((i) => i.id === id)
}

/** @param {number} id @param {"top" | "up" | "down"} dir */
function move(id, dir) {
  const idx = curatedIndex(id)
  if (idx === -1) return
  moveTo(id, dir === "top" ? 0 : dir === "up" ? idx - 1 : idx + 1)
}

/**
 * Move an item to an absolute index (the typed position number — up/down
 * buttons alone made "position 40 → 3" a 37-click job).
 * @param {number} id @param {number} target
 */
function moveTo(id, target) {
  const items = state.currentCurated
  const idx = curatedIndex(id)
  if (idx === -1) return
  const clamped = Math.max(0, Math.min(items.length - 1, target))
  if (clamped === idx) {
    renderGrid() // reset a no-op / out-of-range entry back to the real number
    return
  }
  const [it] = items.splice(idx, 1)
  items.splice(clamped, 0, it)
  renderGrid()
  scheduleReorder()
}

function scheduleReorder() {
  clearTimeout(reorderTimer)
  reorderTimer = setTimeout(saveOrder, 600)
}

async function saveOrder() {
  const ids = state.currentCurated.map((i) => i.id)
  try {
    await api("/api/admin/media/reorder", {
      method: "POST",
      body: JSON.stringify({ ids }),
    })
    showSuccess("Order saved ✓")
  } catch (err) {
    // Most likely the official set changed under us (a promote from the
    // moderation tab, a concurrent save). Refresh and RE-APPLY the attempted
    // order to the new set instead of discarding the couple's sequencing.
    try {
      const data = /** @type {GlobalTypes.MediaListResponse} */ (
        await api("/api/media?section=official&limit=500")
      )
      const rank = new Map(ids.map((id, i) => [id, i]))
      // Unknown (new) items sort to the end, keeping their server order.
      const rankOf = (/** @type {number} */ id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER
      const fresh = data.items.slice().sort((a, b) => rankOf(a.id) - rankOf(b.id))
      await api("/api/admin/media/reorder", {
        method: "POST",
        body: JSON.stringify({ ids: fresh.map((i) => i.id) }),
      })
      state.currentCurated = fresh
      renderGrid()
      showSuccess("Order saved ✓ (the list had changed — your order was re-applied)")
    } catch {
      showGalleryError("Couldn't save the new order — reloading the current order.")
      loadGalleryAdmin()
    }
  }
}

// ---- caption + remove -----------------------------------------------------

/** @param {number} id @param {string} value */
async function saveCaption(id, value) {
  try {
    await api(`/api/admin/media/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ caption: value }),
    })
    const item = state.getCuratedById(id)
    if (item) item.caption = value.trim() || null
    showSuccess("Caption saved ✓")
  } catch (err) {
    showGalleryError("Couldn't save that caption.")
  }
}

/** The curated item id awaiting the remove-confirm dialog. */
let pendingRemoveId = /** @type {number | null} */ (null)

/** @param {number} id */
function removeItem(id) {
  pendingRemoveId = id
  getElement("gallery-remove-error").hidden = true
  openModal(getDialogElement("gallery-remove-modal"))
}

async function confirmRemove() {
  const id = pendingRemoveId
  if (id === null) return
  const btn = getButtonElement("gallery-remove-btn")
  btn.disabled = true
  try {
    await api(`/api/admin/media/${id}`, { method: "DELETE" })
    state.currentCurated = state.currentCurated.filter((i) => i.id !== id)
    pendingRemoveId = null
    closeModal(getDialogElement("gallery-remove-modal"))
    renderGrid()
    showSuccess("Photo removed")
  } catch (err) {
    const el = getElement("gallery-remove-error")
    el.textContent = getErrorMessage(err)
    el.hidden = false
  } finally {
    btn.disabled = false
  }
}

// ---- grid interaction -----------------------------------------------------

/** @param {MouseEvent} e */
function handleGridClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("button[data-action]")
  if (!(btn instanceof HTMLButtonElement) || btn.disabled) return
  const wrap = btn.closest(".curated-item")
  if (!(wrap instanceof HTMLElement)) return
  const id = parseInt(wrap.dataset.id || "", 10)
  if (Number.isNaN(id)) return

  const action = btn.getAttribute("data-action")
  if (action === "top") move(id, "top")
  else if (action === "up") move(id, "up")
  else if (action === "down") move(id, "down")
  else if (action === "remove") removeItem(id)
}

/** @param {FocusEvent} e */
function handleGridBlur(e) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const id = parseInt(target.dataset.id || "", 10)
  if (Number.isNaN(id)) return
  if (target.classList.contains("curated-pos")) {
    const n = parseInt(target.value, 10)
    if (Number.isNaN(n)) {
      renderGrid() // restore the real number over a cleared/garbage entry
      return
    }
    const idx = curatedIndex(id)
    if (idx === -1) return
    if (n - 1 === idx) {
      // Position unchanged — don't call moveTo (its renderGrid would rebuild
      // the whole grid and wipe uncommitted caption edits in sibling rows).
      // Just normalize this one input (e.g. "03" → "3").
      target.value = String(idx + 1)
      return
    }
    moveTo(id, n - 1)
    return
  }
  if (!target.classList.contains("curated-caption")) return
  const item = state.getCuratedById(id)
  const current = item ? item.caption || "" : ""
  if (target.value.trim() === current.trim()) return
  saveCaption(id, target.value)
}

/** @param {KeyboardEvent} e */
function handleGridKeydown(e) {
  if (e.key !== "Enter") return
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  if (
    !target.classList.contains("curated-caption") &&
    !target.classList.contains("curated-pos")
  ) {
    return
  }
  e.preventDefault()
  target.blur() // commit via the focusout handler
}

// ---- upload modal (admin curated uploads) ---------------------------------

function initUploadModal() {
  queue = createUploadQueue(
    { onChange: onUploadChange },
    { csrfCookie: "csrf", section: "official" },
  )

  const input = getInputElement("gallery-upload-input")
  input.addEventListener("change", () => {
    if (input.files && input.files.length) queue.add(input.files)
    input.value = "" // allow re-selecting the same file
  })
  getButtonElement("gallery-upload-pick").addEventListener("click", () =>
    input.click(),
  )
  getButtonElement("gallery-upload-cancel-all").addEventListener("click", () => {
    queue.cancelAll()
    renderUploadTray()
  })
  getElement("gallery-upload-list").addEventListener("click", handleUploadListClick)
}

/** @param {Components.UploadQueueItem} item */
function onUploadChange(item) {
  // Official uploads auto-approve (admin principal); fold each finished item into
  // the grid once it lands. A batch of N files would otherwise fire N sequential
  // full-grid reloads, so coalesce them into one reload after the burst settles.
  if (
    (item.state === "done" || item.state === "pending") &&
    !foldedIn.has(item.id)
  ) {
    foldedIn.add(item.id)
    clearTimeout(uploadReloadTimer)
    uploadReloadTimer = setTimeout(() => loadGalleryAdmin(), 400)
  }
  renderUploadTray()
}

function renderUploadTray() {
  const items = queue.getItems()
  const active = queue.activeCount()
  const failed = items.filter((i) => i.state === "failed").length
  getElement("gallery-upload-summary").textContent =
    items.length === 0
      ? ""
      : active > 0
        ? `Uploading ${items.length - active + 1} of ${items.length}…`
        : failed > 0
          ? `${failed} upload${failed === 1 ? "" : "s"} failed`
          : "Uploads complete"
  getElement("gallery-upload-list").innerHTML = html`${items.map(uploadRow)}`
}

/** @param {Components.UploadQueueItem} item @returns {string} */
function uploadRow(item) {
  const preview = item.previewUrl
    ? html`<img class="upload-thumb" src="${item.previewUrl}" alt="" />`
    : html`<span class="upload-thumb" aria-hidden="true"></span>`
  const bar =
    item.state === "uploading"
      ? html`<div class="upload-bar">
          <div class="upload-bar-fill" style="width:${Math.round(item.progress * 100)}%"></div>
        </div>`
      : ""
  let actions = html`<button type="button" class="upload-action" data-action="remove"
    data-id="${item.id}">Remove</button>`
  if (item.state === "failed" && item.retryable) {
    actions = html`<button type="button" class="upload-action" data-action="retry"
        data-id="${item.id}">Retry</button
      >${actions}`
  }
  return html`
    <li class="upload-row" data-id="${item.id}">
      ${preview}
      <div class="upload-row-main">
        <span class="upload-name">${item.name}</span>
        <span class="upload-row-state ${item.state === "failed" ? "is-error" : ""}"
          >${uploadStateLabel(item)}</span
        >
        ${bar}
      </div>
      <div class="upload-row-actions">${actions}</div>
    </li>
  `
}

/** @param {Components.UploadQueueItem} item @returns {string} */
function uploadStateLabel(item) {
  switch (item.state) {
    case "queued":
      return "Queued"
    case "processing":
      return "Processing…"
    case "uploading":
      return `Uploading… ${Math.round(item.progress * 100)}%`
    case "done":
    case "pending":
      return "Added ✓"
    case "failed":
      return `⚠ ${item.error || "Upload failed"}`
    default:
      return ""
  }
}

/** @param {MouseEvent} e */
function handleUploadListClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-action]")
  if (!(btn instanceof HTMLElement) || !btn.dataset.id) return
  if (btn.dataset.action === "retry") {
    const item = queue.getItems().find((i) => String(i.id) === btn.dataset.id)
    if (item && item.errorStatus === 401) {
      // The admin session expired mid-upload. Replaying the XHR with the dead
      // cookie just 401s forever — the admin has no in-page auth sheet, so send
      // them through the full re-login instead of a doomed retry.
      state.onAuthRequired()
      return
    }
    queue.retry(btn.dataset.id)
  } else if (btn.dataset.action === "remove") {
    queue.remove(btn.dataset.id)
    renderUploadTray()
  }
}

// ---- init -----------------------------------------------------------------

/** @type {Types.initGalleryAdmin} */
export function initGalleryAdmin() {
  const grid = getElement("curated-grid")
  grid.addEventListener("click", handleGridClick)
  grid.addEventListener("focusout", handleGridBlur)
  grid.addEventListener("keydown", handleGridKeydown)
  getButtonElement("gallery-add-btn").addEventListener("click", () =>
    openModal(getDialogElement("gallery-upload-modal")),
  )
  getButtonElement("gallery-remove-btn").addEventListener("click", confirmRemove)
  initUploadModal()
}
