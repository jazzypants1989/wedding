/** @file Gallery tab (Phase 6) — the curated "Official" section manager: a grid
 *  of official items with position numbers, button-based reorder (no drag —
 *  binding decision), inline caption editing, remove, and an "Add official
 *  photos" modal that drives the shared media-uploader as the admin principal
 *  (csrf cookie + section:'official', reconciliation 7). */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../../types.js' */
/** @import * as Components from '../../components/types.js' */

import { state } from "./state.js"
import {
  api,
  openModal,
  closeModal,
  showSuccess,
  showError,
  showLoading,
  showLoadError,
} from "./utils.js"
import {
  html,
  getElement,
  getInputElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"
import { createUploadQueue, sniffKind } from "../../components/media-uploader.js"

/** @type {Components.UploadQueue} */
let queue
/** Debounce handle for the batched reorder POST. */
let reorderTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)
/** Debounce handle coalescing the post-upload grid reload across a batch. */
let uploadReloadTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)
/** Upload ids already folded into the grid (guards double-refresh). */
const foldedIn = new Set()
/** Captions whose save FAILED → the unsaved text, keyed by media id. A later
 *  renderGrid() (a reorder, an upload folding in, a reload) rebuilds the grid
 *  from `state`, which still holds the OLD caption — this map lets itemMarkup
 *  re-render the couple's unsaved text (with an error marker) so the edit is
 *  never silently reverted. Cleared on a successful save. */
const failedCaptions = /** @type {Map<number, string>} */ (new Map())

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

// ---- "Most loved" guest curation (A3) -------------------------------------

/** Official ⇆ Most-loved sub-view within the Gallery tab. */
let gallerySubView = /** @type {"official" | "loved"} */ ("official")

/** @param {"official" | "loved"} view */
function showGallerySubView(view) {
  gallerySubView = view
  getElement("gallery-official-view").hidden = view !== "official"
  getElement("gallery-loved-view").hidden = view !== "loved"
  for (const [id, name] of /** @type {[string, "official" | "loved"][]} */ ([
    ["gallery-sub-official", "official"],
    ["gallery-sub-loved", "loved"],
  ])) {
    const btn = getButtonElement(id)
    const active = name === view
    btn.classList.toggle("active", active)
    btn.setAttribute("aria-selected", active ? "true" : "false")
  }
  if (view === "loved") void loadLoved()
}

/** Load approved guest media ranked by total reaction count (server-side sort,
 *  so "Most loved" is globally correct, not just over a loaded window). */
async function loadLoved() {
  const grid = getElement("loved-grid")
  showLoading(grid)
  try {
    const data = /** @type {Types.LovedMediaResponse} */ (
      await api("/api/admin/media/guest-loved?limit=60")
    )
    renderLoved(data.items)
  } catch (err) {
    showLoadError(grid, 1, "Couldn't load the most-loved photos.", () => void loadLoved())
  }
}

/** @param {Types.LovedMediaItem[]} items */
function renderLoved(items) {
  const grid = getElement("loved-grid")
  if (items.length === 0) {
    grid.innerHTML = html`<p class="curated-empty">
      No guest photos have reactions yet. Once guests start reacting, the most-loved rise to the top here.
    </p>`
    return
  }
  grid.innerHTML = html`${items.map(lovedItemMarkup)}`
}

/** @param {Types.LovedMediaItem} item @returns {string} */
function lovedItemMarkup(item) {
  const isVideo = item.kind === "video"
  const thumb =
    item.needs_display && !isVideo
      ? html`<div class="curated-thumb mod-thumb-empty">HEIC</div>`
      : html`<img class="curated-thumb"
          src="/media/${item.file_key}/${isVideo ? "poster" : "thumb"}"
          alt="" loading="lazy" />`
  return html`
    <div class="curated-item loved-item" data-id="${item.id}">
      <div class="curated-thumb-wrap">${thumb}</div>
      <div class="loved-meta">
        <span class="loved-reactions" title="Total reactions">❤ ${item.reaction_count}</span>
        <span class="loved-author text-muted">${item.author_name || "A guest"}</span>
      </div>
      <div class="curated-actions">
        <button type="button" class="btn btn-primary btn-sm" data-loved-action="promote">
          Move to official
        </button>
      </div>
    </div>
  `
}

/** @param {MouseEvent} e */
async function handleLovedGridClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-loved-action]")
  if (!(btn instanceof HTMLElement)) return
  const wrap = btn.closest(".loved-item")
  if (!(wrap instanceof HTMLElement)) return
  const id = parseInt(wrap.dataset.id || "", 10)
  if (Number.isNaN(id)) return
  if (btn.dataset.lovedAction !== "promote") return
  if (
    !window.confirm(
      "Move this photo into the Official gallery? It leaves the guest feed — this is a move, not a copy.",
    )
  ) {
    return
  }
  try {
    await api(`/api/admin/media/${id}/promote`, { method: "POST" })
    showSuccess("Moved to official ✓")
    await loadLoved()
  } catch (err) {
    showError("Couldn't move that photo: " + getErrorMessage(err))
  }
}

/** @param {GlobalTypes.MediaListItem} item @param {number} index @returns {string} */
function itemMarkup(item, index) {
  const total = state.currentCurated.length
  const isVideo = item.kind === "video"
  const failed = failedCaptions.has(item.id)
  const captionValue = failed ? failedCaptions.get(item.id) : item.caption || ""
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
      <input type="text" class="curated-caption ${failed ? "is-error" : ""}" data-id="${item.id}"
        value="${captionValue}" placeholder="Add a caption…" maxlength="500"
        aria-label="Caption" ${failed ? 'aria-invalid="true"' : ""} />
      ${failed ? html`<span class="curated-caption-error" role="alert">Not saved — still here, try again</span>` : ""}
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

/** The `.curated-caption` input for a media id, or null. @param {number} id */
function captionInput(id) {
  const el = getElement("curated-grid").querySelector(
    `.curated-caption[data-id="${id}"]`,
  )
  return el instanceof HTMLInputElement ? el : null
}

/** @param {HTMLInputElement} input @param {boolean} failed */
function markCaptionErrorDom(input, failed) {
  input.classList.toggle("is-error", failed)
  if (failed) input.setAttribute("aria-invalid", "true")
  else input.removeAttribute("aria-invalid")
  const row = input.closest(".curated-item")
  if (!row) return
  const existing = row.querySelector(".curated-caption-error")
  if (failed && !existing) {
    const err = document.createElement("span")
    err.className = "curated-caption-error"
    err.setAttribute("role", "alert")
    err.textContent = "Not saved — still here, try again"
    input.insertAdjacentElement("afterend", err)
  } else if (!failed && existing) {
    existing.remove()
  }
}

/** @param {number} id @param {string} value */
async function saveCaption(id, value) {
  const input = captionInput(id)
  try {
    await api(`/api/admin/media/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ caption: value }),
    })
    const item = state.getCuratedById(id)
    if (item) item.caption = value.trim() || null
    failedCaptions.delete(id)
    if (input) {
      markCaptionErrorDom(input, false)
      // Quiet per-row confirmation instead of the shared banner — editing many
      // captions would otherwise flood it with "Caption saved ✓" toasts.
      input.classList.remove("is-saved")
      void input.offsetWidth // restart the flash animation
      input.classList.add("is-saved")
      input.addEventListener(
        "animationend",
        () => input.classList.remove("is-saved"),
        { once: true },
      )
    }
  } catch (err) {
    // Keep the couple's text: stash it so a later renderGrid re-renders it,
    // mark the row with a PERSISTENT inline error (not just the 6s toast), and
    // put the cursor back so they can retry without hunting for the field.
    failedCaptions.set(id, value)
    if (input) {
      markCaptionErrorDom(input, true)
      input.focus()
    }
    showGalleryError("Couldn't save that caption — it's still here, try again.")
  }
}

/** The curated item id awaiting the remove-confirm dialog. */
let pendingRemoveId = /** @type {number | null} */ (null)

/** @param {number} id */
function removeItem(id) {
  pendingRemoveId = id
  getElement("gallery-remove-error").hidden = true
  const warnEl = getElement("gallery-remove-card-warning")
  warnEl.hidden = true
  warnEl.textContent = ""
  openModal(getDialogElement("gallery-remove-modal"))
  // Removing a photo silently strips it from any thank-you card that embeds it
  // (the card degrades gracefully). Warn if it rides in already-delivered cards.
  // Best-effort + async so the modal opens instantly; a guard skips the update if
  // the couple moved on to remove a different photo before the lookup returned.
  void (async () => {
    let warning = ""
    try {
      const res = /** @type {Types.MediaReferencesResponse} */ (
        await api(`/api/admin/media/${id}/references`)
      )
      warning = cardRefWarning(res.deliveredCardRefs)
    } catch {
      return // never block the remove on a failed lookup
    }
    if (!warning || pendingRemoveId !== id) return
    warnEl.textContent = warning
    warnEl.hidden = false
  })()
}

/**
 * Warning clause for a photo embedded in N delivered thank-you cards, or "" when
 * none. Mirrors the moderation confirm's copy.
 * @param {number} n @returns {string}
 */
function cardRefWarning(n) {
  if (n <= 0) return ""
  return (
    `Heads up: this photo appears in ${n} sent thank-you card${n === 1 ? "" : "s"} — ` +
    `${n === 1 ? "it'll" : "they'll"} show without it.`
  )
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

  // Folder pick. Needs its own input because webkitdirectory makes an input
  // folder-only, and its contents need filtering: a folder hands over
  // .DS_Store, .AAE sidecars and stray text files, each of which the queue
  // would otherwise render as a red "Not a supported format" row.
  const folderInput = getInputElement("gallery-upload-folder-input")
  folderInput.addEventListener("change", () => {
    const picked = folderInput.files
    folderInput.value = ""
    if (picked && picked.length) void addFiltered(picked)
  })
  getButtonElement("gallery-upload-pick-folder").addEventListener("click", () =>
    folderInput.click(),
  )

  wireModalDragDrop(getElement("gallery-upload-drop"))
  getButtonElement("gallery-upload-cancel-all").addEventListener("click", () => {
    queue.cancelAll()
    renderUploadTray()
  })
  getElement("gallery-upload-list").addEventListener("click", handleUploadListClick)
}

/**
 * Enqueue only the entries that sniff as media, and say how many were passed
 * over. Silence would be worse: "I selected 214 files and 203 appeared" needs an
 * explanation, and a folder of 11 sidecars is the normal case, not an error.
 * @param {FileList} files
 */
async function addFiltered(files) {
  /** @type {File[]} */
  const media = []
  let dropped = 0
  for (const file of files) {
    if ((await sniffKind(file)) === "unknown") dropped++
    else media.push(file)
  }
  if (media.length) queue.add(media)
  const note = getElement("gallery-upload-drop")
  if (dropped > 0) {
    note.textContent =
      `Added ${media.length} photo${media.length === 1 ? "" : "s"} — skipped ${dropped} ` +
      `non-media file${dropped === 1 ? "" : "s"} (things like .DS_Store).`
  } else if (media.length === 0) {
    note.textContent = "Nothing in there was a photo or video."
  }
}

/**
 * Drop zone on the modal body. Mirrors wireDragDrop() in
 * public/pages/gallery/upload.js, minus its requireAccount wrapper, which is a
 * guest-only concern — an admin is already authenticated to be here.
 * @param {HTMLElement} dropZone
 */
function wireModalDragDrop(dropZone) {
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
    // dataTransfer.files is EMPTY for a dropped directory without walking
    // webkitGetAsEntry — which is why the folder button exists and the helper
    // text says so. This handles a dropped file selection.
    const files = /** @type {DragEvent} */ (e).dataTransfer?.files
    if (files && files.length) void addFiltered(files)
  })
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
  const succeeded = items.filter(
    (i) => i.state === "done" || i.state === "pending",
  ).length
  getElement("gallery-upload-summary").textContent =
    items.length === 0
      ? ""
      : active > 0
        ? `Uploading ${items.length - active + 1} of ${items.length}…`
        : failed > 0
          ? succeeded > 0
            ? `${succeeded} added · ${failed} failed`
            : `${failed} upload${failed === 1 ? "" : "s"} failed`
          : "Uploads complete"
  const list = getElement("gallery-upload-list")
  list.innerHTML = html`${items.map(uploadRow)}`
  // Bar widths are CSSOM writes after render: a `style=` attribute in the
  // template is blocked by the CSP and the fill would sit at full width (T18).
  for (const fill of list.querySelectorAll(".upload-bar-fill")) {
    if (fill instanceof HTMLElement) fill.style.width = `${fill.dataset.progress}%`
  }
}

/** @param {Components.UploadQueueItem} item @returns {string} */
function uploadRow(item) {
  const preview = item.previewUrl
    ? html`<img class="upload-thumb" src="${item.previewUrl}" alt="" />`
    : html`<span class="upload-thumb" aria-hidden="true"></span>`
  const bar =
    item.state === "uploading"
      ? html`<div class="upload-bar">
          <div class="upload-bar-fill" data-progress="${Math.round(item.progress * 100)}"></div>
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
  // Official ⇆ Most-loved sub-view (A3).
  getButtonElement("gallery-sub-official").addEventListener("click", () =>
    showGallerySubView("official"),
  )
  getButtonElement("gallery-sub-loved").addEventListener("click", () =>
    showGallerySubView("loved"),
  )
  getElement("loved-grid").addEventListener("click", handleLovedGridClick)
  initUploadModal()

  // Resume network-failed curated uploads when connectivity returns (a 401 is
  // handled via onAuthRequired, terminal errors aren't retryable).
  window.addEventListener("online", () => {
    if (!queue) return
    for (const item of queue.getItems()) {
      if (item.state === "failed" && item.retryable && item.errorStatus === 0) {
        queue.retry(item.id)
      }
    }
  })
}
