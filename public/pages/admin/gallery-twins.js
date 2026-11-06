/** @file Black-and-white twins in the admin Gallery: a colour photo and its
 *  black-and-white copy are one photo. Two controls, both here so the curated
 *  grid's own module (gallery-admin.js) only has to place one line per tile:
 *
 *  - on a photo: "B&W copy…" pairs it with another photo by hand, and a paired
 *    photo shows its copy with an Unpair button;
 *  - in the header: "Find black-and-white twins" asks the server for photos that
 *    match on capture time, size and section, measures their thumbnails here
 *    (twin-detect.js), and proposes pairs for the couple to accept.
 *
 *  The measuring happens in this browser because it is the one place that can
 *  decode every thumbnail without a dependency. The server re-checks every pair
 *  it is asked to make (api/admin/media-twins.js). */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../../types.js' */

import { api, openModal, closeModal, showSuccess, showError } from "./utils.js"
import { html, getElement, getButtonElement, getDialogElement, getErrorMessage } from "../utils.js"
import { TONE_GRID, measureTone, pairDirection, proposeTwins } from "./twin-detect.js"

/** Called after any pair or unpair so the grid shows the new shape. */
let reloadGrid = /** @type {() => void} */ (() => {})
/** The photo the by-hand picker is pairing, and the photo picked for it. */
let pickFor = /** @type {GlobalTypes.MediaListItem | null} */ (null)
let picked = /** @type {Types.TwinCandidate | null} */ (null)
/** Which of the two the picker will make the colour one. */
let pickDirection = /** @type {{ primaryId: number, twinId: number } | null} */ (null)
/** Thumbnails by id, for drawing a pair the couple is about to confirm. */
const keyById = /** @type {Map<number, string>} */ (new Map())
/** Proposals the scan made that haven't been accepted yet. */
let proposals = /** @type {Types.TwinProposal[]} */ ([])
/** Bumped by every scan, so a slow earlier one can't paint over a later one. */
let scanRun = 0

/** @type {Types.twinControlMarkup} */
export function twinControlMarkup(item) {
  if (item.kind !== "image") return html``
  if (item.twin) {
    keyById.set(item.twin.id, item.twin.file_key)
    return html`<span class="twin-row">
      <span class="twin-chip" title="Its black-and-white copy">
        ${item.twin.needs_display
          ? html`<span class="twin-chip-art twin-chip-missing" aria-hidden="true"></span>`
          : html`<img class="twin-chip-art" src="/media/${item.twin.file_key}/thumb" alt=""
              loading="lazy" />`}
        <span>B&amp;W copy</span>
      </span>
      <button type="button" class="btn btn-sm btn-ghost" data-twin="unpair"
        title="Make the black-and-white copy its own photo again">Unpair</button>
    </span>`
  }
  return html`<span class="twin-row">
    <button type="button" class="btn btn-sm btn-ghost" data-twin="pair"
      title="Pair this photo with its black-and-white copy">B&amp;W copy…</button>
  </span>`
}

/**
 * Draw one thumbnail small and measure it. Null when it won't load or decode —
 * that photo is simply left out of the proposals.
 * @param {string} fileKey @returns {Promise<Types.Tone | null>}
 */
function measureThumb(fileKey) {
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = "async"
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = TONE_GRID
        canvas.height = TONE_GRID
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, TONE_GRID, TONE_GRID)
        resolve(measureTone(ctx.getImageData(0, 0, TONE_GRID, TONE_GRID).data))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = `/media/${fileKey}/thumb`
  })
}

/**
 * Measure many thumbnails a few at a time, so a big scan doesn't open hundreds
 * of requests at once. @param {Types.TwinCandidate[]} items
 * @param {(done: number) => void} onProgress
 * @returns {Promise<Map<number, Types.Tone | null>>}
 */
async function measureAll(items, onProgress) {
  /** @type {Map<number, Types.Tone | null>} */
  const tones = new Map()
  let next = 0
  let done = 0
  async function worker() {
    while (next < items.length) {
      const item = items[next++]
      tones.set(item.id, item.needs_display ? null : await measureThumb(item.file_key))
      onProgress(++done)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return tones
}

/** @param {string} fileKey @param {string} label */
function pairArt(fileKey, label) {
  return html`<figure class="twin-pair-art">
    <img src="/media/${fileKey}/thumb" alt="" loading="lazy" />
    <figcaption>${label}</figcaption>
  </figure>`
}

/** @param {GlobalTypes.MediaSection} section @returns {string} */
function sectionLabel(section) {
  return section === "honeymoon" ? "Honeymoon" : section === "guest" ? "Guest" : "Official"
}

// ---- find black-and-white twins ------------------------------------------

async function startScan() {
  const run = ++scanRun
  proposals = []
  const body = getElement("gallery-twins-body")
  getElement("gallery-twins-bar").hidden = true
  getButtonElement("gallery-twins-pair-all").hidden = true
  body.innerHTML = html`<p class="muted" role="status">Looking for photos taken at the same
    moment…</p>`
  openModal(getDialogElement("gallery-twins-modal"), getElement("gallery-twins-btn"))
  /** @type {Types.TwinScanResponse} */
  let scan
  try {
    scan = /** @type {Types.TwinScanResponse} */ (
      await api("/api/admin/media/twins/scan", { method: "POST", body: "{}" })
    )
  } catch (err) {
    if (run !== scanRun) return
    body.innerHTML = html`<p class="status-note is-error" role="alert">Couldn't look:
      ${getErrorMessage(err)}</p>`
    return
  }
  if (run !== scanRun) return
  const members = scan.groups.flatMap((g) => g.members)
  for (const m of members) keyById.set(m.id, m.file_key)
  const status = (/** @type {number} */ done) => {
    body.innerHTML = html`<p class="muted" role="status">Comparing ${done} of
      ${members.length} photos…</p>`
  }
  if (members.length > 0) status(0)
  const tones = await measureAll(members, status)
  if (run !== scanRun) return
  proposals = proposeTwins(scan.groups, tones)
  renderProposals(scan)
}

/** @param {Types.TwinScanResponse} scan */
function renderProposals(scan) {
  const body = getElement("gallery-twins-body")
  const bar = getElement("gallery-twins-bar")
  const pairAll = getButtonElement("gallery-twins-pair-all")
  const sections = new Map(scan.groups.flatMap((g) => g.members.map((m) => [m.id, m.section])))
  const notes = []
  if (scan.withoutCaptureTime > 0) {
    notes.push(
      html`<p class="muted small">${scan.withoutCaptureTime} photo${scan.withoutCaptureTime === 1
        ? " has"
        : "s have"} no capture time, so they can only be paired by hand, with
        “B&amp;W copy…” on the photo.</p>`,
    )
  }
  if (scan.truncated) {
    notes.push(html`<p class="muted small">There were too many to look at in one go. Pair
      these, then look again.</p>`)
  }
  if (proposals.length === 0) {
    bar.hidden = true
    pairAll.hidden = true
    body.innerHTML = html`<p><strong>No black-and-white twins found.</strong></p>
      <p class="muted">A twin is a black-and-white copy with the same capture time and size as
        a colour photo in the same section.</p>${notes}`
    return
  }
  // The bar with "Pair all" sits above the list, so it is seen before the
  // hundreds of single "Pair" buttons are.
  bar.hidden = false
  pairAll.hidden = proposals.length < 2
  pairAll.textContent = `Pair all ${proposals.length}`
  body.innerHTML = html`<ul class="twin-proposals">
      ${proposals.map(
        (p) => html`<li class="twin-proposal" data-primary="${p.primaryId}" data-twin="${p.twinId}">
          <span class="twin-pair">
            ${pairArt(keyById.get(p.primaryId) ?? "", "Colour")}
            ${pairArt(keyById.get(p.twinId) ?? "", "Black and white")}
          </span>
          <span class="twin-proposal-meta muted small">${sectionLabel(
            sections.get(p.primaryId) ?? "official",
          )}</span>
          <button type="button" class="btn btn-sm btn-primary" data-twin-accept>Pair</button>
        </li>`,
      )}
    </ul>${notes}`
}

/**
 * Pair one proposal, marking its row. @param {HTMLElement} row
 * @returns {Promise<boolean>}
 */
async function acceptProposal(row) {
  const primaryId = Number(row.dataset.primary)
  const twinId = Number(row.dataset.twin)
  const btn = row.querySelector("[data-twin-accept]")
  if (btn instanceof HTMLButtonElement) btn.disabled = true
  try {
    await api(`/api/admin/media/${primaryId}/twin`, {
      method: "POST",
      body: JSON.stringify({ twinId }),
    })
    row.classList.add("is-done")
    if (btn instanceof HTMLButtonElement) btn.textContent = "Paired"
    proposals = proposals.filter((p) => p.twinId !== twinId)
    return true
  } catch (err) {
    if (btn instanceof HTMLButtonElement) btn.disabled = false
    const note = document.createElement("span")
    note.className = "status-note is-error small"
    note.setAttribute("role", "alert")
    note.textContent = getErrorMessage(err)
    row.append(note)
    return false
  }
}

/** @param {MouseEvent} e */
async function handleProposalClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-twin-accept]")
  const row = btn?.closest(".twin-proposal")
  if (!(row instanceof HTMLElement) || row.classList.contains("is-done")) return
  if (await acceptProposal(row)) reloadGrid()
}

async function pairAllProposals() {
  const btn = getButtonElement("gallery-twins-pair-all")
  btn.disabled = true
  let paired = 0
  for (const row of getElement("gallery-twins-body").querySelectorAll(".twin-proposal")) {
    if (row instanceof HTMLElement && !row.classList.contains("is-done")) {
      if (await acceptProposal(row)) paired++
    }
  }
  btn.disabled = false
  btn.hidden = true
  if (paired > 0) {
    showSuccess(`Paired ${paired} photo${paired === 1 ? "" : "s"} with a black-and-white copy`)
    reloadGrid()
  }
}

// ---- pair by hand ----------------------------------------------------------

/** @param {GlobalTypes.MediaListItem} item @param {HTMLElement} trigger */
async function openPicker(item, trigger) {
  pickFor = item
  picked = null
  pickDirection = null
  keyById.set(item.id, item.file_key)
  const list = getElement("gallery-twin-pick-list")
  getElement("gallery-twin-pick-confirm").hidden = true
  getElement("gallery-twin-pick-error").hidden = true
  list.innerHTML = html`<li class="muted">Loading…</li>`
  openModal(getDialogElement("gallery-twin-pick-modal"), trigger)
  try {
    const res = /** @type {Types.TwinOptionsResponse} */ (
      await api(`/api/admin/media/${item.id}/twin-options`)
    )
    if (pickFor !== item) return
    for (const o of res.items) keyById.set(o.id, o.file_key)
    list.innerHTML =
      res.items.length === 0
        ? html`<li class="muted">No other photo in this section can be its copy.</li>`
        : html`${res.items.map(
            (o) => html`<li>
              <button type="button" class="twin-option" data-option="${o.id}"
                aria-pressed="false" aria-label="Photo ${o.caption ?? ""}${o.status === "hidden"
                  ? " (hidden)"
                  : ""}">
                <img src="/media/${o.file_key}/thumb" alt="" loading="lazy" />
                ${o.status === "hidden" ? html`<span class="twin-option-tag">Hidden</span>` : ""}
              </button>
            </li>`,
          )}`
    list.dataset.options = JSON.stringify(res.items)
  } catch (err) {
    if (pickFor !== item) return
    list.innerHTML = html`<li class="status-note is-error" role="alert">
      ${getErrorMessage(err)}</li>`
  }
}

/** Show the pair as it will be made, colour first. */
function renderPickConfirm() {
  const confirm = getElement("gallery-twin-pick-confirm")
  if (!pickDirection) {
    confirm.hidden = true
    return
  }
  getElement("gallery-twin-pick-pair").innerHTML = html`${pairArt(
    keyById.get(pickDirection.primaryId) ?? "",
    "Colour — guests see this",
  )}${pairArt(keyById.get(pickDirection.twinId) ?? "", "Black-and-white copy")}`
  confirm.hidden = false
}

/** @param {MouseEvent} e */
async function handlePickClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-option]")
  if (!(btn instanceof HTMLButtonElement) || !pickFor) return
  const list = getElement("gallery-twin-pick-list")
  const options = /** @type {Types.TwinCandidate[]} */ (JSON.parse(list.dataset.options ?? "[]"))
  const option = options.find((o) => o.id === Number(btn.dataset.option))
  if (!option) return
  for (const other of list.querySelectorAll("[data-option]")) {
    other.setAttribute("aria-pressed", other === btn ? "true" : "false")
  }
  const item = pickFor
  picked = option
  // Start from "the photo I clicked is the colour one", and let the pixels
  // overrule only when they plainly disagree.
  pickDirection = { primaryId: item.id, twinId: option.id }
  renderPickConfirm()
  const [mine, theirs] = await Promise.all([
    item.needs_display ? null : measureThumb(item.file_key),
    option.needs_display ? null : measureThumb(option.file_key),
  ])
  if (pickFor !== item || picked !== option) return
  pickDirection = pairDirection({ id: item.id, tone: mine }, { id: option.id, tone: theirs })
  renderPickConfirm()
}

function swapPick() {
  if (!pickDirection) return
  pickDirection = { primaryId: pickDirection.twinId, twinId: pickDirection.primaryId }
  renderPickConfirm()
}

async function savePick() {
  if (!pickDirection) return
  const btn = getButtonElement("gallery-twin-pick-save")
  const error = getElement("gallery-twin-pick-error")
  btn.disabled = true
  error.hidden = true
  try {
    await api(`/api/admin/media/${pickDirection.primaryId}/twin`, {
      method: "POST",
      body: JSON.stringify({ twinId: pickDirection.twinId }),
    })
    closeModal(getDialogElement("gallery-twin-pick-modal"))
    showSuccess("Paired with its black-and-white copy")
    reloadGrid()
  } catch (err) {
    error.textContent = getErrorMessage(err)
    error.hidden = false
  } finally {
    btn.disabled = false
  }
}

/** @param {number} primaryId @param {HTMLButtonElement} btn */
async function unpair(primaryId, btn) {
  btn.disabled = true
  try {
    const res = /** @type {Types.TwinUnpairResponse} */ (
      await api(`/api/admin/media/${primaryId}/twin`, { method: "DELETE" })
    )
    showSuccess(
      res.twin.status === "approved"
        ? "Unpaired — the black-and-white copy is its own photo again, on the site"
        : "Unpaired — the black-and-white copy is its own photo again, hidden",
    )
    reloadGrid()
  } catch (err) {
    showError(getErrorMessage(err))
    btn.disabled = false
  }
}

/** @type {Types.initGalleryTwins} */
export function initGalleryTwins({ reload, getItem }) {
  reloadGrid = reload
  getButtonElement("gallery-twins-btn").addEventListener("click", () => void startScan())
  getElement("gallery-twins-body").addEventListener("click", (e) => void handleProposalClick(e))
  getButtonElement("gallery-twins-pair-all").addEventListener(
    "click",
    () => void pairAllProposals(),
  )
  getElement("gallery-twin-pick-list").addEventListener("click", (e) => void handlePickClick(e))
  getButtonElement("gallery-twin-pick-swap").addEventListener("click", swapPick)
  getButtonElement("gallery-twin-pick-save").addEventListener("click", () => void savePick())
  // The tile buttons: their own attribute, so the grid's data-action handler
  // never sees them.
  getElement("curated-grid").addEventListener("click", (e) => {
    const target = e.target
    if (!(target instanceof Element)) return
    const btn = target.closest("button[data-twin]")
    if (!(btn instanceof HTMLButtonElement) || btn.disabled) return
    const wrap = btn.closest(".curated-item")
    const id = wrap instanceof HTMLElement ? Number(wrap.dataset.id) : NaN
    const item = Number.isInteger(id) ? getItem(id) : undefined
    if (!item) return
    if (btn.dataset.twin === "unpair") void unpair(item.id, btn)
    else if (btn.dataset.twin === "pair") void openPicker(item, btn)
  })
}
