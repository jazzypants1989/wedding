/** @file Gallery (prototypes/admin-workspace views/misc.js, IA §4): Official
 *  — the curated set, in order, as a photo grid with arrows and a typed
 *  position to reorder (no drag — binding decision), captions that save on
 *  blur, Remove (with the thank-you-card warning) — and Most loved by guests,
 *  guest photos ranked by reactions, each one promotable into Official.
 *
 *  Routes: /admin/gallery · /admin/gallery/loved · dialog route
 *  /admin/gallery/upload, which drives the shared media-uploader as the admin
 *  principal (csrf cookie + section:'official', reconciliation 7). */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../../types.js' */
/** @import * as Components from '../../components/types.js' */

import { state } from "./state.js"
import { api, openModal, closeModal, showSuccess, showError, showLoadError } from "./utils.js"
import { openConfirm } from "./confirm.js"
import { registerPanel, setCrumbs } from "./router.js"
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
    if (!officialLoaded) {
      getElement("curated-grid").innerHTML = html`<li class="grid-empty">Loading…</li>`
    }
    const data = /** @type {GlobalTypes.MediaListResponse} */ (
      await api("/api/media?section=official&limit=500")
    )
    state.currentCurated = data.items
    officialLoaded = true
    renderGrid()
  } catch (err) {
    console.error("Failed to load official gallery:", err)
    showLoadError(getElement("curated-grid"), 1, "Couldn't load the official gallery.", () =>
      void loadGalleryAdmin(),
    )
  }
}

let officialLoaded = false

function renderGrid() {
  const grid = getElement("curated-grid")
  const items = state.currentCurated
  if (items.length === 0) {
    grid.innerHTML = html`<li class="grid-empty">
      <strong>No official photos yet.</strong>
      <span class="muted">Add your photographer's best with “+ Add official photos”, or promote a guest
        favourite from Most loved.</span>
    </li>`
    return
  }
  grid.innerHTML = html`${items.map(itemMarkup)}`
  // The typed position is as wide as the longest number (CSSOM: CSP-safe).
  const width = `${String(items.length).length + 0.8}ch`
  for (const input of grid.querySelectorAll(".curated-pos")) {
    if (input instanceof HTMLElement) input.style.width = width
  }
}

/** A photo's frame: the thumb (a poster for video), or a stand-in for an
 *  iPhone HEIC still being converted.
 *  @param {{ kind: string, needs_display: boolean, file_key: string }} item */
function frameMarkup(item) {
  const isVideo = item.kind === "video"
  const img =
    item.needs_display && !isVideo
      ? html`<span class="photo-stand-in">HEIC</span>`
      : html`<img class="art" src="/media/${item.file_key}/${isVideo ? "poster" : "thumb"}" alt=""
          loading="lazy" />`
  return html`<span class="photo-frame">${img}${isVideo
      ? html`<span class="photo-play" aria-label="Video">▶</span>`
      : ""}</span>`
}

// ---- "Most loved" guest curation (A3) -------------------------------------

/** Load approved guest media ranked by total reaction count (server-side sort,
 *  so "Most loved" is globally correct, not just over a loaded window). */
async function loadLoved() {
  const grid = getElement("loved-grid")
  if (!grid.childElementCount) grid.innerHTML = html`<li class="grid-empty">Loading…</li>`
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
    grid.innerHTML = html`<li class="grid-empty">
      <strong>No reactions yet.</strong>
      <span class="muted">Once guests start reacting to each other's photos, the most loved rise to the
        top here.</span>
    </li>`
    return
  }
  grid.innerHTML = html`${items.map(lovedItemMarkup)}`
}

/** @param {Types.LovedMediaItem} item @returns {string} */
function lovedItemMarkup(item) {
  return html`<li class="loved-item" data-id="${item.id}">
    <div class="photo-card">
      ${frameMarkup(item)}
      <span class="small loved-meta"
        ><span class="loved-heart" aria-label="Reactions">♥</span> ${item.reaction_count} · by
        ${item.author_name || "a guest"}</span
      >
      <span class="btn-row">
        <button type="button" class="btn btn-sm" data-loved-action="promote">Add to Official</button>
      </span>
    </div>
  </li>`
}

/** @param {MouseEvent} e */
function handleLovedGridClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-loved-action]")
  if (!(btn instanceof HTMLElement) || btn.dataset.lovedAction !== "promote") return
  const wrap = btn.closest(".loved-item")
  if (!(wrap instanceof HTMLElement)) return
  const id = parseInt(wrap.dataset.id || "", 10)
  if (Number.isNaN(id)) return
  openConfirm({
    title: "Add to Official?",
    desc:
      "It moves into the Official gallery, at the end of the order, and leaves the guest " +
      "section — a move, not a copy. Its reactions and comments come with it.",
    confirmLabel: "Add to Official",
    danger: false,
    run: async () => {
      await api(`/api/admin/media/${id}/promote`, { method: "POST" })
      wrap.remove()
      showSuccess("Added to Official")
      officialLoaded = false
      void loadLoved()
    },
  })
}

/** @param {GlobalTypes.MediaListItem} item @param {number} index @returns {string} */
function itemMarkup(item, index) {
  const total = state.currentCurated.length
  const failed = failedCaptions.has(item.id)
  const captionValue = failed ? failedCaptions.get(item.id) : item.caption || ""
  return html`<li class="curated-item" data-id="${item.id}">
    <div class="photo-card">
      ${frameMarkup(item)}
      <span class="photo-line">
        <label class="photo-pos"
          ><span aria-hidden="true">#</span
          ><input type="number" class="curated-pos" data-id="${item.id}" value="${index + 1}" min="1"
            max="${total}" inputmode="numeric"
            aria-label="Position — type a number to move this photo there"
        /></label>
        <input type="text" class="curated-caption ${failed ? "is-error" : ""}" data-id="${item.id}"
          value="${captionValue}" placeholder="Add a caption…" maxlength="500" aria-label="Caption"
          aria-invalid="${failed ? "true" : "false"}" />
      </span>
      ${failed
        ? html`<span class="curated-caption-error" role="alert">Not saved — still here, try again</span>`
        : ""}
      <span class="btn-row">
        <button type="button" class="btn btn-sm" data-action="up" aria-label="Move earlier"
          title="Move earlier" ${index === 0 ? "disabled" : ""}>←</button>
        <button type="button" class="btn btn-sm" data-action="down" aria-label="Move later"
          title="Move later" ${index === total - 1 ? "disabled" : ""}>→</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="top" aria-label="Move to first"
          title="Move to first" ${index === 0 ? "disabled" : ""}>⇤</button>
        <button type="button" class="btn btn-sm btn-ghost btn-danger-soft photo-remove" data-action="remove"
          >Remove</button>
      </span>
    </div>
  </li>`
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
  input.setAttribute("aria-invalid", failed ? "true" : "false")
  const row = input.closest(".curated-item")
  const line = input.closest(".photo-line")
  if (!row || !line) return
  const existing = row.querySelector(".curated-caption-error")
  if (failed && !existing) {
    const err = document.createElement("span")
    err.className = "curated-caption-error"
    err.setAttribute("role", "alert")
    err.textContent = "Not saved — still here, try again"
    line.insertAdjacentElement("afterend", err)
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
  const note = getElement("gallery-upload-note")
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
  getButtonElement("gallery-upload-cancel-all").hidden = active === 0
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

/** Official or Most loved, from the route. @param {Types.RouteContext} ctx */
function mount(ctx) {
  const loved = ctx.route.path === "gallery/loved"
  getElement("gallery-seg-official").setAttribute("aria-current", loved ? "false" : "page")
  getElement("gallery-seg-loved").setAttribute("aria-current", loved ? "page" : "false")
  getElement("gallery-lede").textContent = loved
    ? "Guest photos ranked by reactions. Promote the best into Official."
    : "The curated set, in order — what guests see first. " +
      "Use the arrows (or type a number) to reorder; captions save as you go."
  getElement("gallery-add-btn").hidden = loved
  getElement("curated-grid").hidden = loved
  getElement("loved-grid").hidden = !loved
  setCrumbs([])
  // Fresh on every arrival at a view; a dialog opening over it is not one.
  const arrived = !ctx.samePanel || lastView !== (loved ? "loved" : "official")
  lastView = loved ? "loved" : "official"
  if (loved) {
    if (arrived) void loadLoved()
  } else if (!officialLoaded || arrived) {
    void loadGalleryAdmin()
  }
}

let lastView = ""

/** @type {Types.initGalleryAdmin} */
export function initGalleryAdmin() {
  const grid = getElement("curated-grid")
  grid.addEventListener("click", handleGridClick)
  grid.addEventListener("focusout", handleGridBlur)
  grid.addEventListener("keydown", handleGridKeydown)
  getButtonElement("gallery-remove-btn").addEventListener("click", confirmRemove)
  getElement("loved-grid").addEventListener("click", handleLovedGridClick)
  // A thumb that won't load leaves an empty frame (error doesn't bubble: capture).
  for (const id of ["curated-grid", "loved-grid"]) {
    getElement(id).addEventListener(
      "error",
      (e) => {
        const frame = e.target instanceof HTMLImageElement ? e.target.closest(".photo-frame") : null
        if (frame) frame.classList.add("is-missing")
      },
      true,
    )
  }
  registerPanel("gallery", {
    mount: (_params, _query, ctx) => mount(ctx),
    help: {
      title: "Gallery",
      keys: [["Enter", "Save a caption or a typed position"]],
    },
  })
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
