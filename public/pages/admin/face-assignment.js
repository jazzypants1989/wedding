/** @file Faces tab — assisted face tagging against the guest roster
 *  (docs/post-wedding/SPEC-vision-lab.md §6.5, SESSION-2-vision.md §4b). A
 *  list, never a wizard: three sections — unnamed Groups (largest first), an
 *  Ask queue ordered by what confirming would unlock, and a minimal Identified
 *  summary. Every confirm is an immediate POST; there is no batch "finish" step
 *  and no keyboard-trapping modal, so the page is abandonable at any point.
 *
 *  CONTRACT NOTE: the API contract this was built against
 *  (GET /api/admin/faces/overview, /queue; POST assign/unassign/not-a-face;
 *  GET /api/admin/media/:id/faces) has no crop endpoint. Faces are shown by
 *  loading the photo's existing `/media/:fileKey/thumb` variant and cropping
 *  to the face's box client-side (see renderFaceChip + positionFaceChipImage).
 *  That requires the ORIGINAL photo's pixel width/height alongside each face's
 *  box — the contract's `media`/queue-item entries only name faceId/mediaId/
 *  box, so this ASSUMES the server rides `fileKey` + `width`/`height` along
 *  with them too (documented on FaceChipEntry in types.d.ts). If that
 *  assumption is wrong, the chip falls back to an uncropped (but still
 *  correctly-loaded) thumbnail — see the early-return in
 *  positionFaceChipImage.
 *
 *  GET /api/admin/media/:id/faces and POST .../unassign are part of the
 *  contract but unused here: nothing in the UI shape this was built to calls
 *  for a per-photo face list or an "undo an assignment" action. Left for a
 *  later pass rather than building UI the spec didn't ask for. */
/** @import * as Types from "./types.js" */

import {
  api,
  showError,
  showSuccess,
  showLoading,
  showLoadError,
} from "./utils.js"
import {
  html,
  getElement,
  getButtonElement,
  getErrorMessage,
} from "../utils.js"

/** CSS-pixel size of a face chip — keep in sync with `.face-chip` in admin.css. */
const CHIP_SIZE = 96

/** @type {Types.FacesOverviewResponse | null} */
let overview = null
/** @type {Types.FacesQueueResponse | null} */
let queueData = null

/** Guest roster cache for the name-input autocomplete (mirrors thank-you.js's
 *  ensureGuestsLoaded — a per-module cache, not shared admin state). */
/** @type {{ id: number, name: string }[]} */
let guestOptions = []
let guestsLoaded = false

/** Faces excluded ("reject from this action") per group, keyed by
 *  `String(group.key)`. Client-only until "Not a face" or a reload. */
const excludedByGroup = /** @type {Map<string, Set<number>>} */ (new Map())

/** Ask-queue faces dismissed via "None of these" this session — a visual-only
 *  dim, since the contract has no "reviewed, no match" endpoint to record it. */
const dismissedAsk = /** @type {Set<number>} */ (new Set())

/** Face ids with a mutation in flight — guards double-submit from a fast
 *  double-click or a held-down keyboard shortcut. */
const pending = /** @type {Set<number>} */ (new Set())

// ---- load + top-level render ----------------------------------------------

/** @type {Types.loadFaceAssignment} */
export async function loadFaceAssignment() {
  const body = getElement("faces-body")
  showLoading(body)
  try {
    const [ov, q] = await Promise.all([
      api("/api/admin/faces/overview"),
      api("/api/admin/faces/queue"),
      ensureGuestsLoaded(),
    ])
    overview = /** @type {Types.FacesOverviewResponse} */ (ov)
    queueData = /** @type {Types.FacesQueueResponse} */ (q)
    renderCounts()
    renderBody()
  } catch (err) {
    console.error("Failed to load face assignment data:", err)
    showLoadError(body, 1, "Couldn't load face data.", () => void loadFaceAssignment())
  }
}

/** Load the guest roster once (for the name-autocomplete datalist), same
 *  fetch as the thank-you tab's picker. Failing to load it is non-fatal —
 *  groups/queue still render, just without suggestions until a retry. */
async function ensureGuestsLoaded() {
  if (guestsLoaded) return
  try {
    const data = /** @type {Types.GuestsApiResponse} */ (
      await api("/api/admin/guests?limit=1000&offset=0")
    )
    guestOptions = data.guests.map((g) => ({ id: g.id, name: g.name }))
    guestsLoaded = true
    renderRosterDatalist()
  } catch (err) {
    console.error("Failed to load guest roster for face autocomplete:", err)
  }
}

function renderRosterDatalist() {
  const dl = document.getElementById("faces-guest-roster")
  if (!dl) return
  dl.innerHTML = html`${guestOptions.map((g) => html`<option value="${g.name}"></option>`)}`
}

function renderCounts() {
  const el = getElement("faces-counts")
  if (!overview) {
    el.innerHTML = ""
    return
  }
  const c = overview.counts
  el.innerHTML = html`
    <span class="faces-count"><strong>${c.faces}</strong> faces</span>
    <span class="faces-count"><strong>${c.identified}</strong> identified</span>
    <span class="faces-count"><strong>${c.unidentified}</strong> unidentified</span>
    <span class="faces-count"><strong>${c.notAFace}</strong> not a face</span>
  `
}

function renderBody() {
  const body = getElement("faces-body")
  if (!overview || !queueData) return

  if (overview.counts.faces === 0) {
    body.innerHTML = emptyIngestMarkup()
    return
  }

  body.innerHTML = html`
    <section class="faces-section" aria-labelledby="faces-groups-heading">
      <h3 id="faces-groups-heading">Groups</h3>
      ${groupsMarkup()}
    </section>
    <section class="faces-section" aria-labelledby="faces-queue-heading">
      <h3 id="faces-queue-heading">Ask queue</h3>
      ${queueMarkup()}
    </section>
    <section class="faces-section" aria-labelledby="faces-identified-heading">
      <h3 id="faces-identified-heading">Identified</h3>
      ${identifiedMarkup()}
    </section>
  `
  wireFaceChipImages(body)
}

function emptyIngestMarkup() {
  return html`
    <div class="faces-empty-state">
      <p>No faces have been ingested yet.</p>
      <p class="text-muted">
        Run the face pipeline against a folder of photos from the command line:
      </p>
      <pre class="faces-cli-hint">node scripts/vision/ingest-faces.js &lt;run-dir&gt;</pre>
    </div>
  `
}

// ---- Groups -----------------------------------------------------------

function groupsMarkup() {
  if (!overview) return ""
  const groups = overview.groups
  if (groups.length === 0) {
    return html`<p class="faces-empty text-muted">No unnamed groups right now.</p>`
  }
  return html`<div class="faces-groups-grid">${groups.map(groupCardMarkup)}</div>`
}

/** @param {Types.FaceGroup} group */
function groupCardMarkup(group) {
  const groupKey = String(group.key)
  const excluded = excludedByGroup.get(groupKey) || new Set()
  const suggestion = group.suggestion
  return html`
    <div class="face-group-card" data-group-key="${groupKey}">
      <div class="face-group-chips">
        ${group.media.map((m) =>
          renderFaceChip(m, { dimmed: excluded.has(m.faceId), toggleable: true }),
        )}
      </div>
      <div class="face-group-controls">
        <input type="text" class="face-group-name-input" list="faces-guest-roster"
          placeholder="Who is this?" value="${suggestion ? suggestion.guestName : ""}"
          aria-label="Guest name for this group" data-group-key="${groupKey}" maxlength="200" />
        <button type="button" class="btn btn-secondary btn-sm face-group-notaface"
          data-group-key="${groupKey}" ${excluded.size === 0 ? "disabled" : ""}>
          Not a face${excluded.size > 0 ? ` (${excluded.size})` : ""}
        </button>
        ${suggestion
          ? html`<span class="face-group-suggestion text-muted"
              >suggested: ${suggestion.guestName} · margin ${suggestion.margin.toFixed(2)}</span
            >`
          : ""}
        <span class="face-group-input-error" role="alert" hidden></span>
      </div>
    </div>
  `
}

/**
 * Resolve a typed name to exactly one guest by case-insensitive exact match
 * against the roster (no regex — plain lower-casing + equality).
 * @param {string} name
 * @returns {{ status: "ok", id: number } | { status: "ambiguous" } | { status: "none" }}
 */
function resolveGuestByName(name) {
  const lower = name.toLowerCase()
  const matches = guestOptions.filter((g) => g.name.toLowerCase() === lower)
  if (matches.length === 1) return { status: "ok", id: matches[0].id }
  if (matches.length > 1) return { status: "ambiguous" }
  return { status: "none" }
}

/** @param {HTMLInputElement} input @param {string} msg */
function showGroupInputError(input, msg) {
  const err = input.parentElement?.querySelector(".face-group-input-error")
  if (err instanceof HTMLElement) {
    err.textContent = msg
    err.hidden = false
  }
}

/** @param {HTMLInputElement} input */
function hideGroupInputError(input) {
  const err = input.parentElement?.querySelector(".face-group-input-error")
  if (err instanceof HTMLElement) err.hidden = true
}

/** Enter in a group's name input: assign every non-excluded face in the group
 *  to the resolved guest. @param {HTMLInputElement} input */
async function handleGroupNameEnter(input) {
  const groupKey = input.dataset.groupKey || ""
  const group = overview?.groups.find((g) => String(g.key) === groupKey)
  if (!group) return
  const name = input.value.trim()
  if (!name) return

  const resolved = resolveGuestByName(name)
  if (resolved.status !== "ok") {
    showGroupInputError(
      input,
      resolved.status === "ambiguous"
        ? "Multiple guests share that name — type more of it to narrow it down."
        : "No matching guest — pick a name from the list.",
    )
    return
  }

  const excluded = excludedByGroup.get(groupKey) || new Set()
  const faceIds = group.faceIds.filter((id) => !excluded.has(id))
  if (faceIds.length === 0) {
    showGroupInputError(input, "Every face here is excluded — nothing left to assign.")
    return
  }

  input.disabled = true
  try {
    const res = /** @type {Types.FaceAssignResponse} */ (
      await api("/api/admin/faces/assign", {
        method: "POST",
        body: JSON.stringify({ faceIds, guestId: resolved.id }),
      })
    )
    const n = res.identified ?? faceIds.length
    showSuccess(`Assigned ${n} face${n === 1 ? "" : "s"} to ${name}`)
    excludedByGroup.delete(groupKey)
    await loadFaceAssignment()
  } catch (err) {
    input.disabled = false
    showGroupInputError(input, getErrorMessage(err))
  }
}

/** @param {string} groupKey @param {number} faceId */
function toggleGroupExclude(groupKey, faceId) {
  let set = excludedByGroup.get(groupKey)
  if (!set) {
    set = new Set()
    excludedByGroup.set(groupKey, set)
  }
  if (set.has(faceId)) set.delete(faceId)
  else set.add(faceId)
  rerenderGroupChips(groupKey)
}

/** Re-render only a group's chip grid + "Not a face" button — never the whole
 *  card, so an in-progress name the admin is typing is never clobbered.
 *  @param {string} groupKey */
function rerenderGroupChips(groupKey) {
  const group = overview?.groups.find((g) => String(g.key) === groupKey)
  const card = findGroupCard(groupKey)
  if (!group || !card) return
  const excluded = excludedByGroup.get(groupKey) || new Set()

  const chips = card.querySelector(".face-group-chips")
  if (chips instanceof HTMLElement) {
    chips.innerHTML = html`${group.media.map((m) =>
      renderFaceChip(m, { dimmed: excluded.has(m.faceId), toggleable: true }),
    )}`
    wireFaceChipImages(chips)
  }

  const btn = card.querySelector(".face-group-notaface")
  if (btn instanceof HTMLButtonElement) {
    btn.disabled = excluded.size === 0
    btn.textContent = excluded.size > 0 ? `Not a face (${excluded.size})` : "Not a face"
  }
}

/** @param {string} groupKey @returns {HTMLElement | null} */
function findGroupCard(groupKey) {
  const cards = document.querySelectorAll(".face-group-card")
  for (const card of cards) {
    if (card instanceof HTMLElement && card.dataset.groupKey === groupKey) return card
  }
  return null
}

/** @param {Element} chip */
function toggleChipFromEl(chip) {
  const card = chip.closest(".face-group-card")
  const groupKey = card instanceof HTMLElement ? card.dataset.groupKey : undefined
  const faceId = parseInt(chip.getAttribute("data-face-id") || "", 10)
  if (groupKey !== undefined && !Number.isNaN(faceId)) toggleGroupExclude(groupKey, faceId)
}

/**
 * @param {string} groupKey
 * @param {HTMLButtonElement} btn
 */
async function handleGroupNotAFace(groupKey, btn) {
  const excluded = excludedByGroup.get(groupKey)
  if (!excluded || excluded.size === 0) return
  const faceIds = [...excluded]
  btn.disabled = true
  try {
    await api("/api/admin/faces/not-a-face", {
      method: "POST",
      body: JSON.stringify({ faceIds }),
    })
    showSuccess(`Marked ${faceIds.length} face${faceIds.length === 1 ? "" : "s"} as not a face`)
    excludedByGroup.delete(groupKey)
    await loadFaceAssignment()
  } catch (err) {
    btn.disabled = false
    showError(getErrorMessage(err))
  }
}

// ---- Ask queue --------------------------------------------------------

function queueMarkup() {
  if (!queueData || !overview) return ""
  const items = queueData.items
  if (items.length === 0) {
    const msg =
      overview.counts.identified === 0
        ? "The ask queue fills in once a group above has been named — matching needs at least one confirmed face per person to compare against."
        : "Nothing waiting on you right now."
    return html`<p class="faces-empty text-muted">${msg}</p>`
  }
  return html`
    <ul class="faces-ask-list">
      ${items.map(askRowMarkup)}
    </ul>
    ${queueData.truncated
      ? html`<p class="faces-queue-truncated">
          Showing the highest-impact faces first — more will appear as you go.
        </p>`
      : ""}
  `
}

/** @param {Types.FaceQueueItem} item */
function askRowMarkup(item) {
  const dismissed = dismissedAsk.has(item.faceId)
  return html`
    <li class="face-ask-row ${dismissed ? "is-dismissed" : ""}" data-face-id="${item.faceId}"
      tabindex="0">
      ${renderFaceChip(item, { dimmed: false, toggleable: false })}
      <div class="face-ask-main">
        <div class="face-ask-candidates">
          ${item.candidates.map(
            (c, i) => html`
              <button type="button" class="btn btn-secondary btn-sm face-ask-candidate"
                data-index="${i}">
                <kbd>${i + 1}</kbd> ${c.guestName} · margin ${c.margin.toFixed(2)}
              </button>
            `,
          )}
          ${item.candidates.length === 0
            ? html`<span class="text-muted">No candidates yet</span>`
            : ""}
        </div>
        <div class="face-ask-actions">
          <span class="face-ask-unlocks text-muted"
            title="Confirming this would identify this many photo appearances"
            >unlocks ${item.unlocks}</span
          >
          <button type="button" class="btn btn-secondary btn-sm face-ask-skip">
            <kbd>s</kbd> Skip
          </button>
          <button type="button" class="btn btn-secondary btn-sm face-ask-none">
            None of these
          </button>
          <button type="button" class="btn btn-danger btn-sm face-ask-notaface">
            <kbd>x</kbd> Not a face
          </button>
        </div>
      </div>
    </li>
  `
}

/** The faceId of the row after `faceId` in the CURRENT (pre-reload) queue
 *  order — captured before a mutation so focus can return to roughly the same
 *  spot once the list is refetched and re-rendered. @param {number} faceId */
function nextAskFaceId(faceId) {
  if (!queueData) return null
  const idx = queueData.items.findIndex((i) => i.faceId === faceId)
  if (idx === -1) return null
  const next = queueData.items[idx + 1]
  return next ? next.faceId : null
}

/** @param {number | null} faceId */
function focusAskRow(faceId) {
  if (faceId === null) return
  const rows = document.querySelectorAll(".face-ask-row")
  for (const row of rows) {
    if (row instanceof HTMLElement && row.dataset.faceId === String(faceId)) {
      row.focus()
      return
    }
  }
}

/** @param {number} faceId @param {number} delta */
function focusAdjacentAskRow(faceId, delta) {
  const rows = Array.from(document.querySelectorAll(".face-ask-row"))
  const idx = rows.findIndex(
    (r) => r instanceof HTMLElement && r.dataset.faceId === String(faceId),
  )
  if (idx === -1) return
  const next = rows[idx + delta]
  if (next instanceof HTMLElement) next.focus()
}

/** @param {number} faceId @param {number} candidateIndex */
async function confirmAskCandidate(faceId, candidateIndex) {
  const item = queueData?.items.find((i) => i.faceId === faceId)
  if (!item) return
  const candidate = item.candidates[candidateIndex]
  if (!candidate) return
  if (pending.has(faceId)) return
  pending.add(faceId)
  const nextFocusId = nextAskFaceId(faceId)
  try {
    await api("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [faceId], guestId: candidate.guestId }),
    })
    showSuccess(`Assigned to ${candidate.guestName}`)
    await loadFaceAssignment()
    focusAskRow(nextFocusId)
  } catch (err) {
    showError(getErrorMessage(err))
  } finally {
    pending.delete(faceId)
  }
}

/** @param {number} faceId */
async function handleAskNotAFace(faceId) {
  if (pending.has(faceId)) return
  pending.add(faceId)
  const nextFocusId = nextAskFaceId(faceId)
  try {
    await api("/api/admin/faces/not-a-face", {
      method: "POST",
      body: JSON.stringify({ faceIds: [faceId] }),
    })
    showSuccess("Marked as not a face")
    await loadFaceAssignment()
    focusAskRow(nextFocusId)
  } catch (err) {
    showError(getErrorMessage(err))
  } finally {
    pending.delete(faceId)
  }
}

/** @param {HTMLElement} row @param {Element} target */
function handleAskRowClick(row, target) {
  const faceId = parseInt(row.dataset.faceId || "", 10)
  if (Number.isNaN(faceId)) return

  const candidateBtn = target.closest(".face-ask-candidate")
  if (candidateBtn instanceof HTMLElement) {
    const idx = parseInt(candidateBtn.dataset.index || "", 10)
    if (!Number.isNaN(idx)) void confirmAskCandidate(faceId, idx)
    return
  }
  if (target.closest(".face-ask-skip")) {
    focusAdjacentAskRow(faceId, 1)
    return
  }
  if (target.closest(".face-ask-none")) {
    dismissedAsk.add(faceId)
    row.classList.add("is-dismissed")
    focusAdjacentAskRow(faceId, 1)
    return
  }
  if (target.closest(".face-ask-notaface")) {
    void handleAskNotAFace(faceId)
  }
}

// ---- Identified (minimal — see file header re: no per-person breakdown) ---

function identifiedMarkup() {
  if (!overview) return ""
  const n = overview.counts.identified
  if (n === 0) return html`<p class="faces-empty text-muted">No faces identified yet.</p>`
  // The contract has no per-guest breakdown (only an aggregate face count), so
  // this stays a single collapsed line rather than a per-person list — the
  // "expandable later" the spec asks for needs an endpoint that doesn't exist
  // yet.
  return html`<p class="faces-identified-summary">
    ${n} face${n === 1 ? "" : "s"} identified so far.
  </p>`
}

// ---- face chip (shared render path for Groups + Ask queue) ----------------

/**
 * One face, cropped down from the media's `thumb` variant to just the face's
 * box. The box is in the ORIGINAL photo's pixel coordinates, so the crop is
 * computed client-side once the thumb image has loaded and its natural size
 * is known (see positionFaceChipImage) — there is no dedicated crop endpoint.
 * @param {Types.FaceChipEntry} entry
 * @param {{ dimmed: boolean, toggleable: boolean }} opts
 */
function renderFaceChip(entry, opts) {
  const box = entry.box
  const img = html`<img class="face-chip-img" src="/media/${entry.fileKey}/thumb" alt=""
    data-orig-w="${entry.width ?? ""}" data-orig-h="${entry.height ?? ""}"
    data-box-x="${box.x}" data-box-y="${box.y}" data-box-w="${box.w}" data-box-h="${box.h}"
    loading="lazy" />`
  if (opts.toggleable) {
    return html`
      <div class="face-chip is-toggleable ${opts.dimmed ? "is-dimmed" : ""}"
        data-face-id="${entry.faceId}" role="button" tabindex="0"
        aria-pressed="${opts.dimmed ? "true" : "false"}"
        aria-label="Exclude this face from the name below">
        ${img}
      </div>
    `
  }
  return html`<div class="face-chip" data-face-id="${entry.faceId}">${img}</div>`
}

/** Wire every `.face-chip-img` under `container` to position itself once its
 *  natural size is known (immediately, if already cached/loaded).
 *  @param {ParentNode} container */
function wireFaceChipImages(container) {
  const imgs = container.querySelectorAll(".face-chip-img")
  imgs.forEach((img) => {
    if (!(img instanceof HTMLImageElement)) return
    if (img.complete && img.naturalWidth) positionFaceChipImage(img)
    else img.addEventListener("load", () => positionFaceChipImage(img), { once: true })
  })
}

/**
 * Position + scale the chip's image so the face's box fills the fixed-size
 * chip. `data-orig-w/h` are the ORIGINAL photo's pixel dimensions (per the
 * contract assumption in the file header); the loaded thumb variant is
 * smaller but proportional, so `naturalWidth / origWidth` is the one uniform
 * scale factor between the box's coordinate space and the thumb's. If the
 * original dimensions are missing, this bails and the chip just shows the
 * plain thumb (via `.face-chip-img`'s CSS `object-fit: cover` default) —
 * degraded, not broken.
 * @param {HTMLImageElement} img
 */
function positionFaceChipImage(img) {
  const origW = Number(img.dataset.origW)
  const origH = Number(img.dataset.origH)
  const boxX = Number(img.dataset.boxX)
  const boxY = Number(img.dataset.boxY)
  const boxW = Number(img.dataset.boxW)
  const boxH = Number(img.dataset.boxH)
  if (!origW || !origH || !boxW || !boxH || !img.naturalWidth || !img.naturalHeight) return

  const toNatural = img.naturalWidth / origW
  const natBoxX = boxX * toNatural
  const natBoxY = boxY * toNatural
  const natBoxW = boxW * toNatural
  const natBoxH = boxH * toNatural

  // Scale so the box's LARGER dimension fills the chip (like object-fit:
  // cover, but keyed to the box rather than the whole image), then center the
  // box within the chip on the other axis.
  const scale = Math.max(CHIP_SIZE / natBoxW, CHIP_SIZE / natBoxH)
  const dispW = img.naturalWidth * scale
  const dispH = img.naturalHeight * scale
  const offsetX = -(natBoxX * scale) + (CHIP_SIZE - natBoxW * scale) / 2
  const offsetY = -(natBoxY * scale) + (CHIP_SIZE - natBoxH * scale) / 2

  img.style.width = `${dispW}px`
  img.style.height = `${dispH}px`
  img.style.left = `${offsetX}px`
  img.style.top = `${offsetY}px`
}

// ---- event delegation -------------------------------------------------

/** @param {MouseEvent} e */
function handleFacesBodyClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  const askRow = target.closest(".face-ask-row")
  if (askRow instanceof HTMLElement) {
    handleAskRowClick(askRow, target)
    return
  }
  const chip = target.closest(".face-chip.is-toggleable")
  if (chip) {
    toggleChipFromEl(chip)
    return
  }
  const notAFaceBtn = target.closest(".face-group-notaface")
  if (notAFaceBtn instanceof HTMLButtonElement) {
    const card = notAFaceBtn.closest(".face-group-card")
    const groupKey = card instanceof HTMLElement ? card.dataset.groupKey : undefined
    if (groupKey !== undefined) void handleGroupNotAFace(groupKey, notAFaceBtn)
  }
}

/** Keyboard: Enter in a group's name input assigns; Enter/Space activates a
 *  focused chip's exclude toggle; within an ask-queue row — arrows navigate,
 *  1/2/3 pick a candidate, s skips, x marks not-a-face. Mirrors moderation.js's
 *  keydown pattern, just scoped to the tab body instead of a `<dialog>`.
 *  @param {KeyboardEvent} e */
function handleFacesBodyKeydown(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  if (target instanceof HTMLInputElement && target.classList.contains("face-group-name-input")) {
    if (e.key === "Enter") {
      e.preventDefault()
      void handleGroupNameEnter(target)
    }
    return
  }

  if (target.classList.contains("face-chip") && target.classList.contains("is-toggleable")) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      toggleChipFromEl(target)
    }
    return
  }

  const askRow = target.closest(".face-ask-row")
  if (askRow instanceof HTMLElement) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const faceId = parseInt(askRow.dataset.faceId || "", 10)
    if (Number.isNaN(faceId)) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      focusAdjacentAskRow(faceId, 1)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      focusAdjacentAskRow(faceId, -1)
    } else if (e.key === "1" || e.key === "2" || e.key === "3") {
      void confirmAskCandidate(faceId, Number(e.key) - 1)
    } else if (e.key === "s" || e.key === "S") {
      focusAdjacentAskRow(faceId, 1)
    } else if (e.key === "x" || e.key === "X") {
      void handleAskNotAFace(faceId)
    }
  }
}

/** @param {Event} e */
function handleFacesBodyInput(e) {
  const target = e.target
  if (target instanceof HTMLInputElement && target.classList.contains("face-group-name-input")) {
    hideGroupInputError(target)
  }
}

// ---- init -----------------------------------------------------------------

/** @type {Types.initFaceAssignment} */
export function initFaceAssignment() {
  getButtonElement("faces-refresh-btn").addEventListener("click", () =>
    void loadFaceAssignment(),
  )
  const body = getElement("faces-body")
  body.addEventListener("click", handleFacesBodyClick)
  body.addEventListener("keydown", handleFacesBodyKeydown)
  body.addEventListener("input", handleFacesBodyInput)
}
