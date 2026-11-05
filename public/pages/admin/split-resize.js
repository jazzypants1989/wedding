/** @file The divider between a split's list and its detail can be dragged, or
 *  focused and moved with ← →. Double-click puts the default width back. The
 *  width is kept per split in localStorage, on the split itself as
 *  `--list-w-user`, which admin.css's `.split` reads; CSS still clamps it so
 *  a narrower window never squeezes the detail. A split opts in with a
 *  `.split-handle` child (index.html). No DOM at import, so the clamp runs in
 *  a unit test. */
/** @import * as Types from './types.js' */

const MIN = 280
const MAX = 720
/** The detail pane never gets narrower than this from a drag. */
const DETAIL_MIN = 480
const STEP = 24
const STORE = "admin-list-w:"

/** @type {Types.clampListWidth} */
export function clampListWidth(px, splitWidth) {
  const max = Math.min(MAX, splitWidth - DETAIL_MIN)
  return Math.round(Math.max(MIN, Math.min(px, max)))
}

/** @param {HTMLElement} split @param {number | null} px */
function apply(split, px) {
  if (px === null) split.style.removeProperty("--list-w-user")
  else split.style.setProperty("--list-w-user", `${px}px`)
}

/** @param {HTMLElement} split @param {number | null} px */
function remember(split, px) {
  try {
    if (px === null) localStorage.removeItem(STORE + split.id)
    else localStorage.setItem(STORE + split.id, String(px))
  } catch {
    // Private mode: the width lasts until reload.
  }
}

/** @param {HTMLElement} split */
function listWidth(split) {
  const list = split.querySelector(":scope > .pane-list")
  return list instanceof HTMLElement ? list.getBoundingClientRect().width : 0
}

/** @param {HTMLElement} handle @param {HTMLElement} split */
function syncValue(handle, split) {
  handle.setAttribute("aria-valuenow", String(Math.round(listWidth(split))))
}

/** @param {PointerEvent} e @param {HTMLElement} handle @param {HTMLElement} split */
function startDrag(e, handle, split) {
  if (e.button !== 0) return
  e.preventDefault()
  handle.setPointerCapture(e.pointerId)
  handle.classList.add("is-dragging")
  const box = split.getBoundingClientRect()
  let px = clampListWidth(listWidth(split), box.width)
  /** @param {PointerEvent} ev */
  const move = (ev) => {
    px = clampListWidth(ev.clientX - box.left, box.width)
    apply(split, px)
  }
  const end = () => {
    handle.classList.remove("is-dragging")
    handle.removeEventListener("pointermove", move)
    handle.removeEventListener("pointerup", end)
    handle.removeEventListener("pointercancel", end)
    remember(split, px)
    syncValue(handle, split)
  }
  handle.addEventListener("pointermove", move)
  handle.addEventListener("pointerup", end)
  handle.addEventListener("pointercancel", end)
}

/** @param {KeyboardEvent} e @param {HTMLElement} handle @param {HTMLElement} split */
function nudge(e, handle, split) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
  e.preventDefault()
  e.stopPropagation()
  const delta = e.key === "ArrowLeft" ? -STEP : STEP
  const px = clampListWidth(listWidth(split) + delta, split.getBoundingClientRect().width)
  apply(split, px)
  remember(split, px)
  syncValue(handle, split)
}

/** @type {Types.initSplitResize} */
export function initSplitResize() {
  for (const handle of document.querySelectorAll(".split-handle")) {
    const split = handle.parentElement
    if (!(handle instanceof HTMLElement) || !split || !split.id) continue
    /** @type {string | null} */
    let saved = null
    try {
      saved = localStorage.getItem(STORE + split.id)
    } catch {
      saved = null
    }
    const px = Number(saved)
    if (saved !== null && Number.isFinite(px) && px > 0) apply(split, px)
    handle.setAttribute("aria-valuemin", String(MIN))
    handle.setAttribute("aria-valuemax", String(MAX))
    handle.addEventListener("pointerdown", (e) => startDrag(e, handle, split))
    handle.addEventListener("keydown", (e) => nudge(e, handle, split))
    handle.addEventListener("focus", () => syncValue(handle, split))
    handle.addEventListener("dblclick", () => {
      apply(split, null)
      remember(split, null)
      syncValue(handle, split)
    })
  }
}
