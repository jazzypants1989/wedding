/** @file Gallery → Sort: the couple going through a curated section's hidden
 *  photos together, a moment at a time, and deciding each one: Show (on the
 *  site, in its old place in the order) or Keep hidden.
 *
 *  A moment is shots taken close together (sort-moments.js), side by side so a
 *  burst is compared and one frame picked. A frame of it already on the site
 *  shows beside the rest, labelled, with nothing to press: changing what guests
 *  already see stays in the gallery grid, which warns about thank-you cards.
 *
 *  Every decision is saved as it is made (POST /api/admin/media/decide), marking
 *  the photo looked at, so the couple can stop on the iPad and carry on from a
 *  laptop. Undo takes back the last decision, then the one before. Skip leaves a
 *  moment for later: it comes round again at the end.
 *
 *  One function draws a photo (photoMarkup), so a later badge or filter on a
 *  photo has one place to go. A black-and-white copy is never a photo of its own
 *  here (the curated listing leaves copies out); its primary wears a "B&W copy"
 *  badge instead.
 *
 *  Routes: /admin/gallery/sort · /admin/gallery/honeymoon/sort, each with
 *  ?again=1 to go back through the photos already kept hidden. */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../../types.js' */

import { api, showError } from "./utils.js"
import { registerPanel, setCrumbs } from "./router.js"
import { html, getElement } from "../utils.js"
import { icon } from "./icons.js"
import {
  buildSortQueue,
  sortProgress,
  sortState,
  nextOpenMoment,
  momentLabel,
} from "./sort-moments.js"

const SECTION_LABEL = /** @type {const} */ ({ official: "Official", honeymoon: "Honeymoon" })
/** The curated sections, in the gallery's own order. */
const SECTIONS = /** @type {const} */ (["official", "honeymoon"])

/** The section on screen, and whether this is a "look again" pass. */
let section = /** @type {GlobalTypes.CuratedMediaSection} */ ("official")
let again = false
/** Bumped on every load, so a slow answer for a view already left is dropped. */
let loadSeq = 0
let loaded = false

/** Every live row of the section, by id: the server's answer, kept current. */
let rows = /** @type {Map<number, GlobalTypes.CuratedAdminItem>} */ (new Map())
/** The rows in the gallery's order, for the progress counts. */
let ordered = /** @type {GlobalTypes.CuratedAdminItem[]} */ ([])
let moments = /** @type {Types.SortMoment[]} */ ([])
/** The photos this session may decide: the ones the queue was built for. */
let decidable = /** @type {Set<number>} */ (new Set())
/** Of those, the ones still waiting for a decision this session. */
let waiting = /** @type {Set<number>} */ (new Set())
let current = 0
/** Which photo of the moment the keys act on, as an index into its ids. */
let focus = 0
let undoStack = /** @type {Types.SortUndoEntry[]} */ ([])
/** A decision in flight: keys and buttons wait for it rather than racing it. */
let busy = false

/** @param {GlobalTypes.CuratedMediaSection} sec */
function galleryPath(sec) {
  return sec === "honeymoon" ? "/admin/gallery/honeymoon" : "/admin/gallery"
}

/** @param {GlobalTypes.CuratedMediaSection} sec @param {boolean} [lookAgain] */
function sortPath(sec, lookAgain = false) {
  return `${galleryPath(sec)}/sort${lookAgain ? "?again=1" : ""}`
}

function root() {
  return getElement("sort-root")
}

// ---- load -----------------------------------------------------------------

async function load() {
  const seq = ++loadSeq
  const want = section
  loaded = false
  root().innerHTML = html`${headMarkup()}<p class="muted sort-loading">Loading…</p>`
  try {
    const data = /** @type {Types.CuratedMediaResponse} */ (
      await api(`/api/admin/media/curated?section=${want}`)
    )
    if (seq !== loadSeq) return
    ordered = data.items
    rows = new Map(ordered.map((row) => [row.id, row]))
    const queue = buildSortQueue(ordered, { again })
    moments = queue.moments
    decidable = new Set(queue.ids)
    waiting = new Set(queue.ids)
    undoStack = []
    current = Math.max(0, nextOpenMoment(moments, isWaiting, 0))
    focus = firstWaitingIndex()
    loaded = true
    render({})
  } catch (err) {
    if (seq !== loadSeq) return
    console.error(`Failed to load the ${want} photos to sort:`, err)
    root().innerHTML = html`${headMarkup()}
      <div class="done-state">
        <p>Couldn't load the ${SECTION_LABEL[want]} photos.</p>
        <button type="button" class="btn" data-sort="retry">Try again</button>
      </div>`
  }
}

/** @param {number} id */
function isWaiting(id) {
  return waiting.has(id)
}

// ---- render ---------------------------------------------------------------

/** The page's head: where you are, the other section, and how far along. */
function headMarkup() {
  const p = sortProgress(ordered)
  return html`<header class="single-head sort-head">
    <a class="sort-back" href="${galleryPath(section)}">${icon("back")}<span
        >${SECTION_LABEL[section]} gallery</span
      ></a>
    <div class="sort-title">
      <h1>${again ? "Look again at the kept-hidden photos" : "Sort hidden photos"}</h1>
      <nav class="seg" aria-label="Which photos">
        ${SECTIONS.map(
          (sec) => html`<a href="${sortPath(sec)}" data-replace
            aria-current="${sec === section ? "page" : "false"}">${SECTION_LABEL[sec]}</a>`,
        )}
      </nav>
    </div>
    ${loaded && p.total > 0
      ? html`<div class="sort-progress">
          <progress class="bar" max="${Math.max(1, p.total)}" value="${p.decided}"
            aria-label="Photos looked at"></progress>
          <p class="sort-counts" id="sort-counts">
            <span><strong>${p.left}</strong> left to look at</span>
            <span><strong>${p.shown}</strong> shown</span>
            <span><strong>${p.keptHidden}</strong> kept hidden</span>
          </p>
        </div>`
      : ""}
  </header>`
}

/**
 * One photo, wherever Sort shows it. The one place a photo is drawn, so a later
 * badge or filter (a black-and-white twin, say) has one place to go.
 * @param {GlobalTypes.CuratedAdminItem} row
 * @param {{ index: number, count: number, focused: boolean }} at
 * @returns {string}
 */
function photoMarkup(row, at) {
  const state = sortState(row)
  const canDecide = decidable.has(row.id)
  const many = at.count > 1
  const shown = state === "shown" || state === "on-site"
  const label = many ? `Photo ${at.index + 1} of ${at.count}` : "Photo"
  const isVideo = row.kind === "video"
  const media =
    row.needs_display && !isVideo
      ? html`<span class="sort-stand-in">HEIC — still being converted</span>`
      : isVideo
        ? html`<video class="sort-art" src="/media/${row.file_key}/video" controls playsinline
            preload="none" poster="/media/${row.file_key}/poster"></video>`
        : html`<img class="sort-art" src="/media/${row.file_key}/display" alt="" />`
  const status = !canDecide
    ? "Already on the site"
    : state === "shown"
      ? "On the site"
      : state === "kept-hidden"
        ? waiting.has(row.id)
          ? "Kept hidden before"
          : "Kept hidden"
        : ""
  const classes = [
    "sort-photo",
    `is-${canDecide ? state : "context"}`,
    waiting.has(row.id) ? "is-waiting" : "",
    at.focused && many ? "is-focused" : "",
  ]
  return html`<li class="${classes.join(" ").trim()}" data-id="${row.id}" data-index="${at.index}"
    aria-label="${label}">
    <div class="sort-frame" data-sort="focus">
      ${media}
      ${many ? html`<span class="sort-num" aria-hidden="true">${at.index + 1}</span>` : ""}
      ${status ? html`<span class="sort-status">${status}</span>` : ""}
      ${row.twin
        ? html`<span class="sort-twin" title="Its black-and-white copy goes wherever it goes"
            >B&amp;W copy</span>`
        : ""}
    </div>
    ${canDecide
      ? html`<div class="sort-actions" role="group" aria-label="${label}">
          <button type="button" class="btn btn-lg sort-show" data-sort="show"
            aria-pressed="${shown ? "true" : "false"}">${icon("check")}<span>Show</span>${many
              ? ""
              : html`<kbd>s</kbd>`}</button>
          <button type="button" class="btn btn-lg sort-hide" data-sort="hide"
            aria-pressed="${state === "kept-hidden" && !waiting.has(row.id)
              ? "true"
              : "false"}">Keep hidden${many ? "" : html`<kbd>h</kbd>`}</button>
        </div>`
      : ""}
  </li>`
}

/** The moment on screen, or the done / empty state. */
function bodyMarkup() {
  if (moments.length === 0 || current === -1 || waiting.size === 0) return doneMarkup()
  const moment = moments[current]
  const count = moment.ids.length
  const open = moment.ids.filter(isWaiting).length
  const position = `Moment ${current + 1} of ${moments.length}`
  return html`<section class="sort-moment" aria-labelledby="sort-moment-title">
    <h2 id="sort-moment-title" tabindex="-1">
      ${position} <span class="muted">· ${momentLabel(count, moment.spanMs)}</span>
    </h2>
    ${count > 1
      ? html`<p class="muted sort-hint">Taken close together. Show the ones guests should see${open > 1
            ? ", then keep the rest hidden"
            : ""}.<span class="kbd-hint">
            Keys act on the outlined photo: <kbd>s</kbd> show · <kbd>h</kbd> keep hidden ·
            <kbd>←</kbd> <kbd>→</kbd> or <kbd>1</kbd>–<kbd>${Math.min(count, 9)}</kbd> another
            photo</span
          ></p>`
      : ""}
    <ul class="sort-photos" data-count="${count}">
      ${moment.ids.map((id, index) => {
        const row = rows.get(id)
        return row ? photoMarkup(row, { index, count, focused: index === focus }) : ""
      })}
    </ul>
  </section>`
}

function doneMarkup() {
  const p = sortProgress(ordered)
  const gallery = html`<a class="btn btn-primary" href="${galleryPath(section)}"
    >Back to the ${SECTION_LABEL[section]} gallery</a
  >`
  const lookAgain =
    p.keptHidden > 0
      ? html`<a class="btn" href="${sortPath(section, true)}" data-replace
          >Look again at the ${p.keptHidden} kept hidden</a
        >`
      : ""
  if (p.total === 0) {
    return html`<div class="done-state">
      <span class="done-icon">${icon("check")}</span>
      <h2>Nothing hidden in ${SECTION_LABEL[section]}</h2>
      <p class="muted">${ordered.length > 0
          ? "Every photo here is on the site. "
          : ""}Photos you hide, or that arrive hidden from an import, wait here to be sorted.</p>
      ${gallery}
    </div>`
  }
  return html`<div class="done-state">
    <span class="done-icon">${icon("check")}</span>
    <h2>${again ? "That's all of them" : "All sorted"}</h2>
    <p class="muted">${p.shown} shown, ${p.keptHidden} kept hidden. Shown photos are on the site in
      their place in the order.</p>
    <div class="btn-row">${gallery}${lookAgain}</div>
  </div>`
}

/** The bar along the bottom: back, undo, the rest hidden, skip. */
function barMarkup() {
  const inMoment = moments.length > 0 && current !== -1 && waiting.size > 0
  const moment = inMoment ? moments[current] : null
  const open = moment ? moment.ids.filter(isWaiting).length : 0
  const last = undoStack.length > 0
  // Nothing to decide and nothing to take back: no bar at all.
  if (!inMoment && !last) return ""
  return html`<div class="actionbar sort-bar">
    <button type="button" class="btn btn-lg" data-sort="undo" ${last ? "" : "disabled"}>Undo<kbd
        >z</kbd
      ></button>
    ${moment && moment.ids.length > 1 && open > 0
      ? html`<button type="button" class="btn btn-lg sort-rest" data-sort="rest"
          ><span class="sort-long"
            >${open === moment.ids.length ? "Keep all hidden" : "Keep the rest hidden"}</span
          ><span class="sort-short">${open === moment.ids.length ? "Hide all" : "Hide the rest"}</span
          ><kbd>r</kbd></button
        >`
      : ""}
    ${inMoment
      ? html`<span class="sort-bar-nav">
          <button type="button" class="btn btn-lg" data-sort="prev" aria-label="Previous moment"
            ${moments.length > 1 ? "" : "disabled"}>‹<kbd>k</kbd></button>
          <button type="button" class="btn btn-lg" data-sort="next"
            ${moments.length > 1 ? "" : "disabled"}>Skip<kbd>j</kbd></button>
        </span>`
      : ""}
  </div>`
}

/** Redraw the page. `moved`: a different moment is showing, so start at its top.
 *  @param {{ moved?: boolean }} opts */
function render(opts) {
  const el = root()
  el.innerHTML = html`${headMarkup()}${bodyMarkup()}${loaded ? barMarkup() : ""}`
  // A thumb that won't load leaves an empty frame (error doesn't bubble).
  for (const img of el.querySelectorAll(".sort-art")) {
    img.addEventListener("error", () => img.closest(".sort-frame")?.classList.add("is-missing"), {
      once: true,
    })
  }
  if (opts.moved) {
    el.scrollTop = 0
    const title = document.getElementById("sort-moment-title")
    if (title) title.focus({ preventScroll: true })
  }
  preloadNext()
}

/** Tell a screen reader what just happened. The live region sits outside the
 *  redrawn part, so it is never replaced while it speaks. @param {string} text */
function announce(text) {
  getElement("sort-live").textContent = text
}

/** Warm the next moment's photos, so moving on doesn't wait on the network. */
function preloadNext() {
  if (current === -1 || moments.length < 2) return
  const next = nextOpenMoment(moments, isWaiting, current + 1)
  if (next === -1 || next === current) return
  for (const id of moments[next].ids) {
    const row = rows.get(id)
    if (!row || row.kind === "video" || row.needs_display) continue
    new Image().src = `/media/${row.file_key}/display`
  }
}

// ---- moving around --------------------------------------------------------

/** The first photo of the moment still waiting, or the first decidable one. */
function firstWaitingIndex() {
  if (current === -1 || !moments[current]) return 0
  const ids = moments[current].ids
  const open = ids.findIndex(isWaiting)
  if (open !== -1) return open
  const any = ids.findIndex((id) => decidable.has(id))
  return any === -1 ? 0 : any
}

/** @param {number} index */
function goTo(index) {
  if (moments.length === 0) return
  current = ((index % moments.length) + moments.length) % moments.length
  focus = firstWaitingIndex()
  render({ moved: true })
}

/** After a decision: the next waiting photo in this moment, else the next
 *  moment with one, else done. */
function moveOn() {
  const ids = moments[current]?.ids ?? []
  for (let step = 1; step <= ids.length; step++) {
    const i = (focus + step) % ids.length
    if (waiting.has(ids[i])) {
      focus = i
      render({})
      revealFocused()
      return
    }
  }
  const next = nextOpenMoment(moments, isWaiting, current + 1)
  if (next === -1) {
    current = -1
    render({ moved: true })
    announce("All sorted.")
    return
  }
  current = next
  focus = firstWaitingIndex()
  render({ moved: true })
}

/** Move the keys to another photo of the moment that can be decided.
 *  @param {number} delta */
function moveFocus(delta) {
  const ids = moments[current]?.ids ?? []
  for (let step = 1; step <= ids.length; step++) {
    const i = (((focus + delta * step) % ids.length) + ids.length) % ids.length
    if (decidable.has(ids[i])) {
      focus = i
      render({})
      revealFocused()
      return
    }
  }
}

/** On a phone a moment is taller than the screen: bring the photo the keys
 *  are on into view, and its buttons with it. */
function revealFocused() {
  const card = root().querySelector(`.sort-photo[data-index="${focus}"]`)
  if (!(card instanceof HTMLElement)) return
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  card.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" })
}

// ---- deciding -------------------------------------------------------------

/**
 * Save one decision for some photos, then update the page from the answer.
 * @param {number[]} ids @param {"approved" | "hidden"} status @param {boolean} decided
 * @returns {Promise<string | null | undefined>} the stored decided_at, or undefined on failure
 */
async function send(ids, status, decided) {
  try {
    const res = /** @type {Types.MediaDecideResponse} */ (
      await api("/api/admin/media/decide", {
        method: "POST",
        body: JSON.stringify({ ids, status, decided }),
      })
    )
    for (const id of ids) {
      const row = rows.get(id)
      if (!row) continue
      row.status = status
      row.decided_at = res.decided_at
    }
    return res.decided_at
  } catch (err) {
    console.error("Sort decision failed:", err)
    showError("That didn't save — check the connection and try again.")
    return undefined
  }
}

/** @param {number[]} ids @param {"approved" | "hidden"} status */
async function decide(ids, status) {
  const todo = ids.filter((id) => decidable.has(id) && rows.has(id))
  if (busy || todo.length === 0) return
  busy = true
  /** @type {Types.SortUndoEntry} */
  const entry = {
    moment: current,
    before: todo.map((id) => {
      const row = /** @type {GlobalTypes.CuratedAdminItem} */ (rows.get(id))
      return {
        id,
        status: row.status === "approved" ? "approved" : "hidden",
        decided_at: row.decided_at,
        waiting: waiting.has(id),
      }
    }),
  }
  const saved = await send(todo, status, true)
  busy = false
  if (saved === undefined) {
    render({})
    return
  }
  undoStack.push(entry)
  for (const id of todo) waiting.delete(id)
  const what = status === "approved" ? "Shown" : "Kept hidden"
  announce(todo.length === 1 ? `${what}.` : `${what}: ${todo.length} photos.`)
  moveOn()
}

async function undo() {
  const entry = undoStack[undoStack.length - 1]
  if (busy || !entry) return
  busy = true
  // Put each photo back exactly as it was: its status, and looked-at or not.
  /** @type {Map<string, number[]>} */
  const groups = new Map()
  for (const b of entry.before) {
    const key = `${b.status}|${b.decided_at === null ? "open" : "decided"}`
    groups.set(key, [...(groups.get(key) ?? []), b.id])
  }
  let ok = true
  for (const [key, ids] of groups) {
    const [status, kind] = key.split("|")
    const saved = await send(ids, status === "approved" ? "approved" : "hidden", kind === "decided")
    if (saved === undefined) ok = false
  }
  busy = false
  if (!ok) {
    render({})
    return
  }
  undoStack.pop()
  for (const b of entry.before) {
    const row = rows.get(b.id)
    // The server re-stamps a decided photo; the time it was first decided is what it was.
    if (row && b.decided_at !== null) row.decided_at = b.decided_at
    if (b.waiting) waiting.add(b.id)
  }
  current = Math.min(entry.moment, moments.length - 1)
  const ids = moments[current]?.ids ?? []
  const back = ids.indexOf(entry.before[0].id)
  focus = back === -1 ? firstWaitingIndex() : back
  render({ moved: true })
  announce("Undone.")
}

/** The photo the keys act on, if it can be decided. */
function focusedId() {
  const id = moments[current]?.ids[focus]
  return id !== undefined && decidable.has(id) ? id : null
}

/** @param {"approved" | "hidden"} status */
function decideFocused(status) {
  const id = focusedId()
  if (id !== null) void decide([id], status)
}

function keepRestHidden() {
  const ids = moments[current]?.ids ?? []
  void decide(ids.filter(isWaiting), "hidden")
}

// ---- events ---------------------------------------------------------------

/** @param {MouseEvent} e */
function onClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-sort]")
  if (!(btn instanceof HTMLElement)) return
  if (btn instanceof HTMLButtonElement && btn.disabled) return
  const action = btn.dataset.sort
  if (action === "retry") {
    void load()
    return
  }
  if (action === "undo") return void undo()
  if (action === "rest") return keepRestHidden()
  if (action === "prev") return goTo(current - 1)
  if (action === "next") return goTo(current + 1)
  const card = btn.closest(".sort-photo")
  if (!(card instanceof HTMLElement)) return
  const id = Number(card.dataset.id)
  const index = Number(card.dataset.index)
  if (action === "focus") {
    // A tap on a photo points the keys at it; nothing is decided by a tap.
    if (decidable.has(id) && index !== focus) {
      focus = index
      render({})
    }
    return
  }
  if (action === "show" || action === "hide") {
    focus = index
    const status = action === "show" ? "approved" : "hidden"
    const row = rows.get(id)
    // Pressing the choice already made, on a photo already decided, changes nothing.
    if (row && !waiting.has(id) && row.decided_at !== null && row.status === status) return
    void decide([id], status)
  }
}

/** The panel's keys (registerPanel). True when one was used.
 *  @param {KeyboardEvent} e @returns {boolean} */
function keys(e) {
  if (!loaded) return false
  if (e.key === "z") {
    void undo()
    return true
  }
  if (current === -1 || moments.length === 0 || waiting.size === 0) return false
  // A video's own controls keep their keys.
  if (e.target instanceof HTMLVideoElement) return false
  switch (e.key) {
    case "s":
      decideFocused("approved")
      return true
    case "h":
      decideFocused("hidden")
      return true
    case "r":
      keepRestHidden()
      return true
    case "j":
      goTo(current + 1)
      return true
    case "k":
      goTo(current - 1)
      return true
    case "ArrowRight":
      moveFocus(1)
      return true
    case "ArrowLeft":
      moveFocus(-1)
      return true
    default: {
      const n = Number(e.key)
      const ids = moments[current].ids
      if (Number.isInteger(n) && n >= 1 && n <= ids.length && decidable.has(ids[n - 1])) {
        focus = n - 1
        render({})
        return true
      }
      return false
    }
  }
}

/** @param {Types.RouteContext} ctx */
function mount(ctx) {
  const next = ctx.route.path.startsWith("gallery/honeymoon") ? "honeymoon" : "official"
  const lookAgain = ctx.query.get("again") === "1"
  setCrumbs([])
  // Every arrival loads fresh: the other device may have sorted since.
  section = next
  again = lookAgain
  void load()
}

/** @type {Types.initGallerySort} */
export function initGallerySort() {
  root().addEventListener("click", onClick)
  registerPanel("gallery-sort", {
    mount: (_params, _query, ctx) => mount(ctx),
    unmount: () => {
      loadSeq++
    },
    keys,
    help: {
      title: "Sort hidden photos",
      keys: [
        ["s", "Show — put it on the site"],
        ["h", "Keep it hidden"],
        ["r", "Keep the rest of this moment hidden"],
        ["← →", "Another photo of this moment"],
        ["1 2 3", "Photo 1, 2, 3… of this moment"],
        ["j k", "Skip to the next / previous moment"],
        ["z", "Undo the last decision"],
      ],
    },
  })
}

