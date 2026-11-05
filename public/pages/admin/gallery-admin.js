/** @file Gallery (prototypes/admin-workspace views/misc.js, IA §4): Official
 *  and Honeymoon — the two curated sets, each in order, as a photo grid with
 *  arrows, a typed position and a drag handle to reorder, captions that save on
 *  blur, a move between the two sets, Hide and Unhide, Remove (with the
 *  thank-you-card warning) — and Most loved by guests, guest photos ranked by
 *  reactions, each one promotable into Official.
 *
 *  Drag came late (iss_0018: the owner asked for it on a phone), after the first
 *  build ruled it out as too risky to do accessibly. It is an extra on top of the
 *  arrows, not instead of them: the handle is hidden from the keyboard and from
 *  screen readers, which keep the arrows and the number, and a drop ends in the
 *  same moveTo an arrow makes.
 *
 *  A section can be mostly hidden: a culled import uploads every photo and hides
 *  the rejects. So the grid shows one side at a time, "On the site" (what guests
 *  see, and the order that matters) or "Hidden", and the rows off screen stay in
 *  every reorder, because the server demands the full set. Going through the
 *  hidden ones to decide which guests see is Sort (gallery-sort.js), linked from
 *  beside the switch.
 *
 *  Routes: /admin/gallery · /admin/gallery/honeymoon · /admin/gallery/loved ·
 *  dialog routes /admin/gallery/upload and /admin/gallery/honeymoon/upload,
 *  which drive the shared media-uploader as the admin principal (csrf cookie +
 *  section:'official' | 'honeymoon', reconciliation 7). */
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
import {
  applyShownOrder,
  curatedDropIndex,
  isCuratedRowOffSite,
  isCuratedRowOnSite,
} from "./curated-order.js"
import { icon } from "./icons.js"
import { sortProgress } from "./sort-moments.js"

/** Display names for the curated sections. */
const SECTION_LABEL = /** @type {const} */ ({ official: "Official", honeymoon: "Honeymoon" })

/** The curated section on screen, from the route. */
let section = /** @type {GlobalTypes.CuratedMediaSection} */ ("official")
/** The section `state.currentCurated` holds; null until loaded, or once stale. */
let loadedSection = /** @type {GlobalTypes.CuratedMediaSection | null} */ (null)

/** Every live row of the section in order, whatever its status: what a reorder
 *  has to name. `state.currentCurated` is the part of it the grid is showing. */
let allRows = /** @type {GlobalTypes.CuratedAdminItem[]} */ ([])
/** Which side of the section the grid is showing. */
let showing = /** @type {"site" | "hidden"} */ ("site")
/** The Hidden view renders in pages: there can be thousands, and nobody reorders
 *  them. "On the site" always renders whole, since positions are typed against it. */
const HIDDEN_PAGE = 120
let hiddenLimit = HIDDEN_PAGE

/** One upload queue per curated section. A queue fixes its section when it is
 *  created, so the tray shows the queue for the section on screen while the
 *  other keeps uploading. Created in initUploadModal. */
let queues = /** @type {Record<GlobalTypes.CuratedMediaSection, Components.UploadQueue> | null} */ (
  null
)
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
  const want = section
  try {
    if (loadedSection !== want) {
      getElement("curated-grid").innerHTML = html`<li class="grid-empty">Loading…</li>`
    }
    const data = /** @type {Types.CuratedMediaResponse} */ (
      await api(`/api/admin/media/curated?section=${want}`)
    )
    // The couple switched sections while this was in flight: that view's own
    // load owns the grid now.
    if (want !== section) return
    allRows = data.items
    loadedSection = want
    refreshShown()
    renderGrid()
  } catch (err) {
    if (want !== section) return
    console.error(`Failed to load the ${want} gallery:`, err)
    showLoadError(
      getElement("curated-grid"),
      1,
      `Couldn't load the ${SECTION_LABEL[want]} photos.`,
      () => void loadGalleryAdmin(),
    )
  }
}

/** Point the grid at the side being shown. An emptied Hidden falls back. */
function refreshShown() {
  if (showing === "hidden" && !allRows.some(isCuratedRowOffSite)) showing = "site"
  state.currentCurated = allRows.filter(showing === "hidden" ? isCuratedRowOffSite : isCuratedRowOnSite)
  renderShowingToggle()
}

/** The On the site / Hidden switch, which only exists once something is hidden. */
function renderShowingToggle() {
  const offSite = allRows.filter(isCuratedRowOffSite).length
  getElement("gallery-showing").hidden = offSite === 0
  getElement("gallery-showing-site-n").textContent = String(
    allRows.filter(isCuratedRowOnSite).length,
  )
  getElement("gallery-showing-hidden-n").textContent = String(offSite)
  getButtonElement("gallery-showing-site").setAttribute(
    "aria-pressed",
    showing === "site" ? "true" : "false",
  )
  getButtonElement("gallery-showing-hidden").setAttribute(
    "aria-pressed",
    showing === "hidden" ? "true" : "false",
  )
  getElement("gallery-showing-note").hidden = showing !== "hidden"
  renderSortLink(offSite)
}

/** "Sort hidden photos", into Gallery → Sort for this section, saying how many
 *  nobody has looked at yet. Only once something is hidden.
 *  @param {number} offSite */
function renderSortLink(offSite) {
  const link = getElement("gallery-sort-btn")
  link.hidden = offSite === 0 || lastView === "loved"
  const left = sortProgress(allRows).left
  link.textContent = left > 0 ? `Sort hidden photos · ${left} to look at` : "Sort hidden photos"
  link.setAttribute(
    "href",
    section === "honeymoon" ? "/admin/gallery/honeymoon/sort" : "/admin/gallery/sort",
  )
}

/** @param {"site" | "hidden"} next */
function setShowing(next) {
  if (next === showing) return
  // The grid's order has to be folded in before the grid stops showing it.
  allRows = applyShownOrder(allRows, state.currentCurated)
  showing = next
  hiddenLimit = HIDDEN_PAGE
  refreshShown()
  renderGrid()
}

function renderGrid() {
  const grid = getElement("curated-grid")
  const items = state.currentCurated
  // Only the site's order can be dragged; the CSS offers a grab cursor there.
  grid.dataset.showing = showing
  if (showing === "hidden") {
    const page = items.slice(0, hiddenLimit)
    const left = items.length - page.length
    grid.innerHTML = html`${page.map(hiddenItemMarkup)}${left > 0
      ? html`<li class="grid-empty">
          <button type="button" class="btn btn-sm" data-action="more">Show more (${left} left)</button>
        </li>`
      : ""}`
    return
  }
  const hiddenCount = allRows.filter(isCuratedRowOffSite).length
  if (items.length === 0 && hiddenCount > 0) {
    grid.innerHTML = html`<li class="grid-empty">
      <strong>Nothing here is on the site yet.</strong>
      <span class="muted">${hiddenCount} hidden. Unhide the ones guests should see.</span>
    </li>`
    return
  }
  if (items.length === 0) {
    grid.innerHTML =
      section === "honeymoon"
        ? html`<li class="grid-empty">
            <strong>No honeymoon photos yet.</strong>
            <span class="muted">Add them with “+ Add honeymoon photos”, or move one here from
              Official. Guests only see a Honeymoon tab once there's at least one.</span>
          </li>`
        : html`<li class="grid-empty">
            <strong>No official photos yet.</strong>
            <span class="muted">Add your photographer's best with “+ Add official photos”, or
              promote a guest favourite from Most loved.</span>
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
      if (loadedSection === "official") loadedSection = null
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
      ${total > 1
        ? html`<span class="curated-handle" data-drag aria-hidden="true" title="Drag to reorder"
            >${icon("grip")}</span
          >`
        : ""}
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
      <span class="btn-row">
        <button type="button" class="btn btn-sm btn-ghost" data-action="move"
          title="Move to the end of ${SECTION_LABEL[otherSection(section)]}"
          >Move to ${SECTION_LABEL[otherSection(section)]}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="hide"
          title="Take it off the site, and keep it">Hide</button>
      </span>
    </div>
  </li>`
}

/** A tile in the Hidden view: no position, because nobody sees this order.
 *  @param {GlobalTypes.MediaListItem} item @returns {string} */
function hiddenItemMarkup(item) {
  const failed = failedCaptions.has(item.id)
  const captionValue = failed ? failedCaptions.get(item.id) : item.caption || ""
  return html`<li class="curated-item" data-id="${item.id}">
    <div class="photo-card">
      ${frameMarkup(item)}
      <span class="photo-line">
        <input type="text" class="curated-caption ${failed ? "is-error" : ""}" data-id="${item.id}"
          value="${captionValue}" placeholder="Add a caption…" maxlength="500" aria-label="Caption"
          aria-invalid="${failed ? "true" : "false"}" />
      </span>
      ${failed
        ? html`<span class="curated-caption-error" role="alert">Not saved — still here, try again</span>`
        : ""}
      <span class="btn-row">
        <button type="button" class="btn btn-sm" data-action="unhide"
          title="Put it back on the site, in its place in the order">Unhide</button>
        <button type="button" class="btn btn-sm btn-ghost btn-danger-soft photo-remove" data-action="remove"
          >Remove</button>
      </span>
      <span class="btn-row">
        <button type="button" class="btn btn-sm btn-ghost" data-action="move"
          title="Move to the end of ${SECTION_LABEL[otherSection(section)]}, still hidden"
          >Move to ${SECTION_LABEL[otherSection(section)]}</button>
      </span>
    </div>
  </li>`
}

/** The curated section that isn't `s`. @param {GlobalTypes.CuratedMediaSection} s
 *  @returns {GlobalTypes.CuratedMediaSection} */
function otherSection(s) {
  return s === "official" ? "honeymoon" : "official"
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

/** Clamp an index into the curated list. @param {number} i @returns {number} */
function clampIndex(i) {
  return Math.max(0, Math.min(state.currentCurated.length - 1, i))
}

/**
 * Move an item by a button (top/up/down) or to an absolute index (the typed
 * position number — up/down buttons alone made "position 40 → 3" a 37-click
 * job). A move that lands where it started does nothing: re-rendering the grid
 * would wipe uncommitted caption edits in other rows.
 * @param {number} id @param {"top" | "up" | "down" | number} to
 */
function moveTo(id, to) {
  const items = state.currentCurated
  const idx = curatedIndex(id)
  if (idx === -1) return
  const target = to === "top" ? 0 : to === "up" ? idx - 1 : to === "down" ? idx + 1 : to
  const clamped = clampIndex(target)
  if (clamped === idx) return
  const [it] = items.splice(idx, 1)
  items.splice(clamped, 0, it)
  renderGrid()
  scheduleReorder()
}

function scheduleReorder() {
  clearTimeout(reorderTimer)
  reorderTimer = setTimeout(() => {
    reorderTimer = undefined
    void saveOrder()
  }, 600)
}

/** Send a debounced reorder now (before the grid's contents change under it:
 *  a section switch or a move). Resolves once it has been saved or recovered. */
async function flushReorder() {
  if (reorderTimer === undefined) return
  clearTimeout(reorderTimer)
  reorderTimer = undefined
  await saveOrder()
}

async function saveOrder() {
  // Snapshot synchronously: the grid may switch section while this is in flight.
  const sec = loadedSection ?? section
  allRows = applyShownOrder(allRows, state.currentCurated)
  const ids = allRows.map((i) => i.id)
  try {
    await api("/api/admin/media/reorder", {
      method: "POST",
      body: JSON.stringify({ ids, section: sec }),
    })
    showSuccess("Order saved ✓")
  } catch (err) {
    // Most likely the set changed under us (a promote from the moderation tab,
    // a move, a concurrent save). Refresh and RE-APPLY the attempted order to
    // the new set instead of discarding the couple's sequencing.
    try {
      const data = /** @type {Types.CuratedMediaResponse} */ (
        await api(`/api/admin/media/curated?section=${sec}`)
      )
      const rank = new Map(ids.map((id, i) => [id, i]))
      // Unknown (new) items sort to the end, keeping their server order.
      const rankOf = (/** @type {number} */ id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER
      const fresh = data.items.slice().sort((a, b) => rankOf(a.id) - rankOf(b.id))
      await api("/api/admin/media/reorder", {
        method: "POST",
        body: JSON.stringify({ ids: fresh.map((i) => i.id), section: sec }),
      })
      if (loadedSection === sec) {
        allRows = fresh
        refreshShown()
        renderGrid()
      }
      showSuccess("Order saved ✓ (the list had changed — your order was re-applied)")
    } catch {
      showGalleryError("Couldn't save the new order — reloading the current order.")
      loadGalleryAdmin()
    }
  }
}

// ---- drag to reorder ------------------------------------------------------
//
// Pointer events, one handler set for mouse, pen and touch. A touch starts only
// on the handle, which is `touch-action: none`, so the rest of a card still
// scrolls the page; a mouse can also take the photo itself. The dragged card
// follows the pointer and the card under it shows which side it will land on;
// nothing else moves until the drop, which makes the same moveTo the arrows do.
// The page scrolls while a card is held at its top or bottom edge.

/** Pixels a pointer has to travel before a press on the handle becomes a drag. */
const DRAG_SLOP = 4
/** How close to the scroller's top or bottom edge the pointer has to be to scroll it. */
const DRAG_EDGE = 56
/** The most it scrolls in one frame, at the very edge. */
const DRAG_SCROLL_MAX = 14

/** The drag in progress, or null. @type {Types.CuratedDrag | null} */
let drag = null

/** @param {PointerEvent} e */
function handleDragStart(e) {
  if (drag || showing !== "site" || e.button !== 0 || !e.isPrimary) return
  const target = e.target
  if (!(target instanceof Element)) return
  const onHandle = target.closest("[data-drag]") !== null
  // Only a mouse may lift a card by its photo: a finger there is scrolling.
  const onPhoto = e.pointerType === "mouse" && target.closest(".photo-frame") !== null
  if (!onHandle && !onPhoto) return
  const wrap = target.closest(".curated-item")
  if (!(wrap instanceof HTMLElement)) return
  const id = parseInt(wrap.dataset.id || "", 10)
  if (Number.isNaN(id) || curatedIndex(id) === -1 || state.currentCurated.length < 2) return
  // No text selection, no native image drag, and no focus change: the field
  // being typed in is committed by hand instead, before anything moves.
  e.preventDefault()
  const active = document.activeElement
  if (active instanceof HTMLElement && getElement("curated-grid").contains(active)) active.blur()
  // A typed position committing on that blur re-renders the grid.
  if (!wrap.isConnected) return
  // Captured on the card, which stays in the document for the whole drag, so a
  // mouse released outside the window still ends it.
  wrap.setPointerCapture(e.pointerId)
  // The gallery is a .single page: that column scrolls, not #view.
  const scroller = wrap.closest(".single") ?? getElement("view")
  if (!(scroller instanceof HTMLElement)) return
  drag = {
    id,
    pointerId: e.pointerId,
    item: wrap,
    scroller,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    startScroll: scroller.scrollTop,
    active: false,
    over: null,
    after: false,
    frame: 0,
  }
  document.addEventListener("pointermove", handleDragMove)
  document.addEventListener("pointerup", handleDragEnd)
  document.addEventListener("pointercancel", handleDragCancel)
  document.addEventListener("keydown", handleDragKey, true)
}

/** @param {PointerEvent} e */
function handleDragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return
  drag.x = e.clientX
  drag.y = e.clientY
  if (!drag.active) {
    if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < DRAG_SLOP) return
    drag.active = true
    drag.item.classList.add("is-dragging")
    getElement("curated-grid").classList.add("is-sorting")
    drag.frame = requestAnimationFrame(dragTick)
  }
  e.preventDefault()
  placeDrag()
}

/** Follow the pointer, and find the card it is over and which half. */
function placeDrag() {
  if (!drag) return
  const dy = drag.y - drag.startY + (drag.scroller.scrollTop - drag.startScroll)
  drag.item.style.transform = `translate(${drag.x - drag.startX}px, ${dy}px)`
  let over = /** @type {HTMLElement | null} */ (null)
  for (const el of document.elementsFromPoint(drag.x, drag.y)) {
    const card = el.closest(".curated-item")
    if (card instanceof HTMLElement && card !== drag.item) {
      over = card
      break
    }
  }
  const after = over ? dropAfter(over, drag.x) : false
  if (over === drag.over && after === drag.after) return
  drag.over?.classList.remove("drop-before", "drop-after")
  drag.over = over
  drag.after = after
  over?.classList.add(after ? "drop-after" : "drop-before")
}

/** Whether a drop at `x` goes after the card: past its middle, in reading order.
 *  @param {HTMLElement} card @param {number} x @returns {boolean} */
function dropAfter(card, x) {
  const r = card.getBoundingClientRect()
  return x > r.left + r.width / 2
}

/** One frame of edge scrolling, for as long as the drag lasts. */
function dragTick() {
  if (!drag || !drag.active) return
  const view = drag.scroller
  const box = view.getBoundingClientRect()
  const intoTop = box.top + DRAG_EDGE - drag.y
  const intoBottom = drag.y - (box.bottom - DRAG_EDGE)
  const step =
    intoTop > 0
      ? -Math.ceil((Math.min(intoTop, DRAG_EDGE) / DRAG_EDGE) * DRAG_SCROLL_MAX)
      : intoBottom > 0
        ? Math.ceil((Math.min(intoBottom, DRAG_EDGE) / DRAG_EDGE) * DRAG_SCROLL_MAX)
        : 0
  if (step !== 0) {
    const before = view.scrollTop
    view.scrollTop += step
    if (view.scrollTop !== before) placeDrag()
  }
  drag.frame = requestAnimationFrame(dragTick)
}

/** @param {PointerEvent} e */
function handleDragEnd(e) {
  if (!drag || e.pointerId !== drag.pointerId) return
  const { id, over, after, active } = drag
  endDrag()
  if (!active || !over) return
  const overId = parseInt(over.dataset.id || "", 10)
  const from = curatedIndex(id)
  const to = curatedIndex(overId)
  if (from === -1 || to === -1) return
  moveTo(id, curatedDropIndex(from, to, after))
}

/** @param {PointerEvent} e */
function handleDragCancel(e) {
  if (drag && e.pointerId === drag.pointerId) endDrag()
}

/** Escape puts the card back; no other key reaches the page while a card is up.
 *  @param {KeyboardEvent} e */
function handleDragKey(e) {
  if (!drag || (!drag.active && e.key !== "Escape")) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === "Escape") endDrag()
}

/** Put the dragged card back where it was and stop listening. */
function endDrag() {
  if (!drag) return
  cancelAnimationFrame(drag.frame)
  drag.item.classList.remove("is-dragging")
  drag.item.style.transform = ""
  drag.over?.classList.remove("drop-before", "drop-after")
  getElement("curated-grid").classList.remove("is-sorting")
  drag = null
  document.removeEventListener("pointermove", handleDragMove)
  document.removeEventListener("pointerup", handleDragEnd)
  document.removeEventListener("pointercancel", handleDragCancel)
  document.removeEventListener("keydown", handleDragKey, true)
}

// ---- move between Official and Honeymoon ----------------------------------

/** MOVE a photo to the other curated section (appended at its end). Not a
 *  confirm: it's one click to move it back. @param {number} id */
async function moveToOtherSection(id) {
  const from = section
  const to = otherSection(from)
  // A pending reorder names this photo; send it first so it isn't refused.
  await flushReorder()
  try {
    await api(`/api/admin/media/${id}/section`, {
      method: "POST",
      body: JSON.stringify({ section: to }),
    })
  } catch (err) {
    showGalleryError(`Couldn't move that photo: ${getErrorMessage(err)}`)
    return
  }
  if (loadedSection === from) {
    forgetRow(id)
    renderGrid()
  }
  showSuccess(`Moved to ${SECTION_LABEL[to]} — it's at the end of that order`)
}

/** Drop a row that left this section, keeping any order not yet folded in.
 *  @param {number} id */
function forgetRow(id) {
  allRows = applyShownOrder(allRows, state.currentCurated).filter((i) => i.id !== id)
  refreshShown()
}

// ---- hide + unhide --------------------------------------------------------

/**
 * Put a photo on either side, through the same moderation transitions the Review
 * tab uses. Its sort_order doesn't move, so an unhidden photo returns to its
 * place in the sequence.
 * @param {number} id @param {"hide" | "approve"} action
 */
async function setOnSite(id, action) {
  try {
    await api(`/api/admin/moderation/media/${id}/${action}`, { method: "POST" })
  } catch (err) {
    showGalleryError(`Couldn't change that photo: ${getErrorMessage(err)}`)
    return
  }
  // Fold in any order not yet saved, while the grid still holds this row.
  allRows = applyShownOrder(allRows, state.currentCurated)
  const row = allRows.find((i) => i.id === id)
  if (row) row.status = action === "hide" ? "hidden" : "approved"
  const stillHidden = showing === "hidden" && allRows.some(isCuratedRowOffSite)
  refreshShown()
  if (stillHidden) {
    // Just the one tile, so captions being typed in the others survive.
    getElement("curated-grid").querySelector(`.curated-item[data-id="${id}"]`)?.remove()
  } else {
    renderGrid()
  }
  showSuccess(action === "hide" ? "Hidden from guests" : "Back on the site, in its place")
}

/** Hide, warning first if the photo rides in a delivered thank-you card.
 *  @param {number} id */
async function hideItem(id) {
  /** @type {string} */
  let warning = ""
  try {
    const refs = /** @type {Types.MediaReferencesResponse} */ (
      await api(`/api/admin/media/${id}/references`)
    )
    warning = cardRefWarning(refs.deliveredCardRefs)
  } catch {
    // Never block a hide on a failed lookup.
  }
  if (!warning) {
    await setOnSite(id, "hide")
    return
  }
  openConfirm({
    title: "Hide this photo?",
    desc: warning,
    confirmLabel: "Hide",
    danger: false,
    run: () => setOnSite(id, "hide"),
  })
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
    forgetRow(id)
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
  if (btn.getAttribute("data-action") === "more") {
    hiddenLimit += HIDDEN_PAGE
    renderGrid()
    return
  }
  const wrap = btn.closest(".curated-item")
  if (!(wrap instanceof HTMLElement)) return
  const id = parseInt(wrap.dataset.id || "", 10)
  if (Number.isNaN(id)) return

  const action = btn.getAttribute("data-action")
  if (action === "top" || action === "up" || action === "down") moveTo(id, action)
  else if (action === "remove") removeItem(id)
  else if (action === "hide" || action === "unhide") {
    btn.disabled = true
    const done = action === "hide" ? hideItem(id) : setOnSite(id, "approve")
    void done.finally(() => {
      btn.disabled = false
    })
  } else if (action === "move") {
    btn.disabled = true
    void moveToOtherSection(id).finally(() => {
      btn.disabled = false
    })
  }
}

/** @param {FocusEvent} e */
function handleGridBlur(e) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const id = parseInt(target.dataset.id || "", 10)
  if (Number.isNaN(id)) return
  if (target.classList.contains("curated-pos")) {
    const idx = curatedIndex(id)
    if (idx === -1) return
    const n = parseInt(target.value, 10)
    const want = Number.isNaN(n) ? idx : clampIndex(n - 1)
    if (want === idx) {
      // Unchanged, cleared, garbage, or clamped back to where it is: fix this
      // one input ("03" → "3", "999" on the last row → its number). Never
      // renderGrid here — it would wipe uncommitted caption edits in sibling rows.
      target.value = String(idx + 1)
      return
    }
    moveTo(id, want)
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

/** The upload queue for the section on screen. @returns {Components.UploadQueue} */
function currentQueue() {
  if (!queues) throw new Error("gallery upload queues not initialised")
  return queues[section]
}

/** @param {GlobalTypes.CuratedMediaSection} sec @returns {Components.UploadQueue} */
function makeQueue(sec) {
  return createUploadQueue(
    { onChange: (item) => onUploadChange(sec, item) },
    { csrfCookie: "csrf", section: sec },
  )
}

function initUploadModal() {
  queues = { official: makeQueue("official"), honeymoon: makeQueue("honeymoon") }

  const input = getInputElement("gallery-upload-input")
  input.addEventListener("change", () => {
    if (input.files && input.files.length) currentQueue().add(input.files)
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
    currentQueue().cancelAll()
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
  // The section the files were picked for, even if the view changes mid-sniff.
  const queue = currentQueue()
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

/** @param {GlobalTypes.CuratedMediaSection} sec @param {Components.UploadQueueItem} item */
function onUploadChange(sec, item) {
  // Curated uploads auto-approve (admin principal); fold each finished item into
  // the grid once it lands. A batch of N files would otherwise fire N sequential
  // full-grid reloads, so coalesce them into one reload after the burst settles.
  // An upload into the section NOT on screen just marks it stale: the next
  // arrival there loads it fresh.
  const key = `${sec}:${item.id}`
  if ((item.state === "done" || item.state === "pending") && !foldedIn.has(key)) {
    foldedIn.add(key)
    if (sec === section) {
      clearTimeout(uploadReloadTimer)
      uploadReloadTimer = setTimeout(() => {
        if (sec === section) void loadGalleryAdmin()
      }, 400)
    } else if (loadedSection === sec) {
      loadedSection = null
    }
  }
  if (sec === section) renderUploadTray()
}

function renderUploadTray() {
  const queue = currentQueue()
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
  const queue = currentQueue()
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

/** Official, Honeymoon or Most loved, from the route (an upload dialog route
 *  belongs to the section it sits over). @param {Types.RouteContext} ctx */
function mount(ctx) {
  const path = ctx.route.path
  const loved = path === "gallery/loved"
  const view = loved ? "loved" : path.startsWith("gallery/honeymoon") ? "honeymoon" : "official"
  if (view !== "loved" && view !== section) {
    // Send a debounced reorder for the section being left before its grid goes.
    void flushReorder()
    section = view
    showing = "site"
    hiddenLimit = HIDDEN_PAGE
  }
  // The switch belongs to a curated grid; refreshShown re-shows it on load.
  if (loved) {
    getElement("gallery-showing").hidden = true
    getElement("gallery-sort-btn").hidden = true
  } else {
    renderShowingToggle()
  }
  getElement("gallery-seg-official").setAttribute(
    "aria-current",
    view === "official" ? "page" : "false",
  )
  getElement("gallery-seg-honeymoon").setAttribute(
    "aria-current",
    view === "honeymoon" ? "page" : "false",
  )
  getElement("gallery-seg-loved").setAttribute("aria-current", loved ? "page" : "false")
  getElement("gallery-lede").textContent = loved
    ? "Guest photos ranked by reactions. Promote the best into Official."
    : view === "honeymoon"
      ? "Your honeymoon photos, in order — guests get a Honeymoon tab once there's one. " +
        "Drag a photo by its handle, use the arrows, or type a number to reorder; " +
        "captions save as you go."
      : "The curated set, in order — what guests see first. " +
        "Drag a photo by its handle, use the arrows, or type a number to reorder; " +
        "captions save as you go."
  const label = section === "honeymoon" ? "honeymoon" : "official"
  const addBtn = getElement("gallery-add-btn")
  addBtn.hidden = loved
  addBtn.textContent = `+ Add ${label} photos`
  addBtn.setAttribute(
    "href",
    section === "honeymoon" ? "/admin/gallery/honeymoon/upload" : "/admin/gallery/upload",
  )
  getElement("gallery-upload-title").textContent = `Add ${label} photos`
  getElement("gallery-upload-lede").textContent =
    `They publish to ${SECTION_LABEL[section]} straight away, at the end of the order. ` +
    "Big uploads keep going if you close this."
  if (queues) renderUploadTray()
  getElement("curated-grid").hidden = loved
  getElement("loved-grid").hidden = !loved
  setCrumbs([])
  // Fresh on every arrival at a view; a dialog opening over it is not one.
  const arrived = !ctx.samePanel || lastView !== view
  lastView = view
  if (loved) {
    if (arrived) void loadLoved()
  } else if (loadedSection !== section || arrived) {
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
  grid.addEventListener("pointerdown", handleDragStart)
  // The browser's own image drag would carry the thumb's URL off somewhere.
  grid.addEventListener("dragstart", (e) => {
    if (e.target instanceof Element && e.target.closest(".photo-frame, [data-drag]")) {
      e.preventDefault()
    }
  })
  getButtonElement("gallery-remove-btn").addEventListener("click", confirmRemove)
  getButtonElement("gallery-showing-site").addEventListener("click", () => setShowing("site"))
  getButtonElement("gallery-showing-hidden").addEventListener("click", () => setShowing("hidden"))
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
    if (!queues) return
    for (const queue of [queues.official, queues.honeymoon]) {
      for (const item of queue.getItems()) {
        if (item.state === "failed" && item.retryable && item.errorStatus === 0) {
          queue.retry(item.id)
        }
      }
    }
  })
}
