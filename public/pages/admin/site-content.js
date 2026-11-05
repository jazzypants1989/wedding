/** @file Site content (/admin/site/content) — edit the runtime SiteContent
 *  override. One long form in a single column (prototypes/admin-workspace
 *  views/misc.js): jump chips at the top, a sticky action bar with Save and an
 *  "Unsaved changes" note, guarded on the way out (main.js's guard, whose
 *  "Save and leave" calls saveSiteContent()). PUTs to /api/admin/site-content
 *  (auto-CSRF via api()); Reset to defaults is a DELETE. Nav links are edited
 *  with a small repeatable row editor.
 */
/** @import * as Types from './types.js' */
/** @import * as Components from '../../components/types.js' */

import { api, showError, showSuccess } from "./utils.js"
import { registerPanel, setCrumbs } from "./router.js"
import { openConfirm } from "./confirm.js"
import { createUploadQueue } from "../../components/media-uploader.js"
import { DRESSCODE_LADDER, buildDressCodeDescriptor } from "./dresscode-descriptor.js"
import {
  html,
  getElement,
  getInputElement,
  getTextAreaElement,
  getButtonElement,
  getFormElement,
  getSelectElement,
  getErrorMessage,
} from "../utils.js"
import { EFFECT_THEMES } from "../../effects/themes.js"

/** @param {string} id @returns {string} trimmed input value */
function val(id) {
  return getInputElement(id).value.trim()
}

/** @param {string} id @param {string} value */
function setVal(id, value) {
  getInputElement(id).value = value
}

/** @param {string} id @returns {string} trimmed textarea value */
function taVal(id) {
  return getTextAreaElement(id).value.trim()
}

/** @param {string} id @param {string} value */
function setTa(id, value) {
  getTextAreaElement(id).value = value
}

/** Fill the theme <select> with an <option> per EFFECT_THEMES entry, so adding a
 *  theme updates the picker without editing the admin HTML. */
function renderThemeOptions() {
  const select = getSelectElement("sc-theme")
  select.innerHTML = ""
  for (const theme of EFFECT_THEMES) {
    const option = document.createElement("option")
    option.value = theme.id
    option.textContent = theme.label
    select.appendChild(option)
  }
}

// ---- Wedding date/time picker --------------------------------------------
// The stored value is an ISO-8601 instant with a fixed UTC offset; it flips the
// site's pre/post mode via Date.parse. A datetime-local + offset select is far
// safer than a hand-typed offset — both compose into the hidden #sc-wedding-date
// that collectForm() reads, so the save path is unchanged.

/** @type {{ value: string, label: string }[]} */
const OFFSET_OPTIONS = [
  { value: "-10:00", label: "UTC−10:00 (Hawaii)" },
  { value: "-09:00", label: "UTC−09:00 (Alaska)" },
  { value: "-08:00", label: "UTC−08:00 (Pacific, winter)" },
  { value: "-07:00", label: "UTC−07:00 (Pacific summer / Mountain)" },
  { value: "-06:00", label: "UTC−06:00 (Central)" },
  { value: "-05:00", label: "UTC−05:00 (Eastern)" },
  { value: "-04:00", label: "UTC−04:00 (Atlantic)" },
  { value: "Z", label: "UTC±00:00" },
  { value: "+01:00", label: "UTC+01:00 (Central Europe)" },
  { value: "+02:00", label: "UTC+02:00 (Eastern Europe)" },
  { value: "+05:30", label: "UTC+05:30 (India)" },
  { value: "+08:00", label: "UTC+08:00 (China / Singapore)" },
  { value: "+09:00", label: "UTC+09:00 (Japan / Korea)" },
  { value: "+10:00", label: "UTC+10:00 (East Australia)" },
  { value: "+12:00", label: "UTC+12:00 (New Zealand)" },
]

/** Populate the offset <select>, guaranteeing `current` is present + selected. */
/** @param {string} current */
function renderOffsetOptions(current) {
  const select = getSelectElement("sc-wedding-offset")
  const options = OFFSET_OPTIONS.slice()
  if (current && !options.some((o) => o.value === current)) {
    options.push({ value: current, label: `UTC${current}` })
  }
  select.innerHTML = ""
  for (const o of options) {
    const opt = document.createElement("option")
    opt.value = o.value
    opt.textContent = o.label
    select.appendChild(opt)
  }
  select.value = current || "-07:00"
}

/**
 * Split an ISO instant "2026-04-26T11:00:00-07:00" into a datetime-local value
 * ("2026-04-26T11:00") + offset ("-07:00" | "Z"). No regex; the time uses colons
 * so the first +/-/Z after "T" marks the offset. Null if it isn't zoned ISO.
 * @param {string} iso @returns {{ datetime: string, offset: string } | null}
 */
function parseWeddingDate(iso) {
  const tIdx = iso.indexOf("T")
  if (tIdx === -1) return null
  const datePart = iso.slice(0, tIdx)
  const timeRest = iso.slice(tIdx + 1)
  let offIdx = -1
  for (let i = 0; i < timeRest.length; i++) {
    const c = timeRest[i]
    if (c === "+" || c === "-" || c === "Z") {
      offIdx = i
      break
    }
  }
  if (offIdx === -1) return null
  const hhmm = timeRest.slice(0, offIdx).slice(0, 5)
  if (hhmm.length < 5) return null
  return { datetime: `${datePart}T${hhmm}`, offset: timeRest.slice(offIdx) }
}

/** Recompose the hidden ISO value + preview from the picker fields. */
function syncWeddingDate() {
  const dt = getInputElement("sc-wedding-datetime").value // "YYYY-MM-DDTHH:MM" | ""
  const offset = getSelectElement("sc-wedding-offset").value
  const iso = dt ? `${dt}:00${offset}` : ""
  setVal("sc-wedding-date", iso)
  getElement("sc-wedding-iso").textContent = iso || "—"
}

/** Load a stored ISO value into the picker (called from populate). */
/** @param {string} iso */
function setWeddingDate(iso) {
  const parsed = iso ? parseWeddingDate(iso) : null
  if (parsed) {
    getInputElement("sc-wedding-datetime").value = parsed.datetime
    renderOffsetOptions(parsed.offset)
    syncWeddingDate()
  } else {
    // Preserve an unparseable stored value rather than blanking it.
    getInputElement("sc-wedding-datetime").value = ""
    renderOffsetOptions("")
    setVal("sc-wedding-date", iso || "")
    getElement("sc-wedding-iso").textContent = iso || "—"
  }
}

/**
 * Append one nav-link editor row to a container.
 * @param {string} containerId
 * @param {Types.SiteContentNavLink} [link]
 */
function addNavRow(containerId, link) {
  const href = link ? link.href : ""
  const label = link ? link.label : ""
  getElement(containerId).insertAdjacentHTML(
    "beforeend",
    html`<div class="nav-row">
      <input type="text" class="nav-href"
        placeholder="href (e.g. #schedule or /rsvp)" maxlength="200" value="${href}">
      <input type="text" class="nav-label" placeholder="label" maxlength="100" value="${label}">
      <button type="button" class="btn btn-secondary btn-sm nav-up"
        title="Move up" aria-label="Move up">↑</button>
      <button type="button" class="btn btn-secondary btn-sm nav-down"
        title="Move down" aria-label="Move down">↓</button>
      <button type="button" class="btn btn-danger btn-sm nav-remove">Remove</button>
    </div>`,
  )
}

/**
 * @param {string} containerId
 * @param {readonly Types.SiteContentNavLink[]} links
 */
function renderNavRows(containerId, links) {
  getElement(containerId).innerHTML = ""
  for (const link of links) addNavRow(containerId, link)
}

/**
 * Read the nav rows in a container back into a list. Rows where either field is
 * filled are included so the server can flag half-filled links.
 * @param {string} containerId
 * @returns {Types.SiteContentNavLink[]}
 */
function collectNavRows(containerId) {
  /** @type {Types.SiteContentNavLink[]} */
  const links = []
  const rows = getElement(containerId).querySelectorAll(".nav-row")
  rows.forEach((row) => {
    const hrefEl = row.querySelector(".nav-href")
    const labelEl = row.querySelector(".nav-label")
    if (!(hrefEl instanceof HTMLInputElement) || !(labelEl instanceof HTMLInputElement)) return
    const href = hrefEl.value.trim()
    const label = labelEl.value.trim()
    if (href || label) links.push({ href, label })
  })
  return links
}

// ---- Dress-code image manager --------------------------------------------
//
// Admins upload dress-code figures through the media pipeline (section:'content',
// admin csrf) and reference them from dressCode.images. Uploads generate a
// responsive width ladder; on finalize we append a SiteContentImage descriptor
// pointing at /media/{fileKey}/{variant}. `dressCodeImages` is the authoritative
// in-memory list that collectForm() submits; cards render from it and their
// alt/caption edits sync back before any reorder/remove/save.

/** @type {Types.SiteContentImage[]} */
let dressCodeImages = []

/** Server-approved cap (api/admin/site-content.js MAX_DC_IMAGES). */
const MAX_DRESSCODE_IMAGES = 12

/** @type {Components.UploadQueue | null} */
let dressCodeQueue = null
/** Upload ids already folded into a descriptor (guards a double-append). */
const foldedUploads = new Set()

/** Read each card's alt/caption back into dressCodeImages before a re-render. */
function syncDressCodeCards() {
  const cards = getElement("sc-dresscode-images").querySelectorAll(".dc-card")
  cards.forEach((card, i) => {
    if (i >= dressCodeImages.length) return
    const altEl = card.querySelector(".dc-alt")
    const capEl = card.querySelector(".dc-caption")
    const alt = altEl instanceof HTMLInputElement ? altEl.value.trim() : dressCodeImages[i].alt
    const caption =
      capEl instanceof HTMLInputElement ? capEl.value.trim() : dressCodeImages[i].caption
    dressCodeImages[i] = { ...dressCodeImages[i], alt, caption: caption || null }
  })
}

/** For a media-backed descriptor (src "/media/{key}/w1600"), swap in the smallest
 *  ladder rung so the 72px card thumb doesn't download the 1600px variant. Static
 *  "/images/…" default srcs are returned unchanged. No regex.
 *  @param {string} src @returns {string} */
function cardThumbSrc(src) {
  const prefix = "/media/"
  if (typeof src !== "string" || !src.startsWith(prefix)) return src
  const cut = src.lastIndexOf("/")
  return cut >= prefix.length - 1 ? src.slice(0, cut) + "/w400" : src
}

/** @param {Types.SiteContentImage} img @param {number} index */
function addDressCodeCard(img, index) {
  const total = dressCodeImages.length
  getElement("sc-dresscode-images").insertAdjacentHTML(
    "beforeend",
    html`<div class="dc-card" data-index="${index}">
      <img class="dc-card-thumb" src="${cardThumbSrc(img.src)}" alt="" loading="lazy">
      <div class="dc-card-fields">
        <input type="text" class="dc-alt"
          placeholder="Alt text (describe the image)" maxlength="500" value="${img.alt}">
        <input type="text" class="dc-caption"
          placeholder="Caption (optional)" maxlength="500" value="${img.caption || ""}">
      </div>
      <div class="dc-card-actions">
        <button type="button" class="btn btn-secondary btn-sm dc-up"
          title="Move up" aria-label="Move up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="btn btn-secondary btn-sm dc-down"
          title="Move down"
          aria-label="Move down" ${index === total - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="btn btn-danger btn-sm dc-remove">Remove</button>
      </div>
    </div>`,
  )
}

function renderDressCodeCards() {
  const container = getElement("sc-dresscode-images")
  container.innerHTML = ""
  dressCodeImages.forEach((img, i) => addDressCodeCard(img, i))
}

/** @param {MouseEvent} e */
function handleDressCodeClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const card = target.closest(".dc-card")
  if (!card) return
  const index = Number(card.getAttribute("data-index"))
  if (!Number.isInteger(index) || index < 0 || index >= dressCodeImages.length) return

  if (target.closest(".dc-remove")) {
    syncDressCodeCards()
    dressCodeImages.splice(index, 1)
    renderDressCodeCards()
  } else if (target.closest(".dc-up") && index > 0) {
    syncDressCodeCards()
    const prev = dressCodeImages[index - 1]
    dressCodeImages[index - 1] = dressCodeImages[index]
    dressCodeImages[index] = prev
    renderDressCodeCards()
  } else if (target.closest(".dc-down") && index < dressCodeImages.length - 1) {
    syncDressCodeCards()
    const next = dressCodeImages[index + 1]
    dressCodeImages[index + 1] = dressCodeImages[index]
    dressCodeImages[index] = next
    renderDressCodeCards()
  }
}

/** @param {Components.UploadQueueItem} item */
function onDressCodeUpload(item) {
  // Admin content uploads auto-approve → state "done" with a fileKey. Fold each
  // finished item into a descriptor + card, then drop it from the queue so the
  // tray only shows in-flight work.
  const fileKey = item.fileKey
  if (
    (item.state === "done" || item.state === "pending") &&
    fileKey &&
    !foldedUploads.has(item.id)
  ) {
    foldedUploads.add(item.id)
    syncDressCodeCards()
    dressCodeImages.push(
      buildDressCodeDescriptor({ fileKey, width: item.width, height: item.height }),
    )
    renderDressCodeCards()
    if (dressCodeQueue) dressCodeQueue.remove(item.id)
  }
  renderDressCodeUploadTray()
}

function renderDressCodeUploadTray() {
  const tray = getElement("sc-dresscode-upload")
  const items = dressCodeQueue ? dressCodeQueue.getItems() : []
  if (items.length === 0) {
    tray.hidden = true
    tray.innerHTML = ""
    return
  }
  tray.hidden = false
  tray.innerHTML = html`${items.map(dressCodeUploadRow)}`
}

/** @param {Components.UploadQueueItem} item @returns {string} */
function dressCodeUploadRow(item) {
  const label =
    item.state === "failed"
      ? "⚠ " + (item.error || "Upload failed")
      : item.state === "uploading"
        ? "Uploading… " + Math.round(item.progress * 100) + "%"
        : item.state === "processing"
          ? "Processing…"
          : "Queued"
  return html`<div class="dc-upload-row ${item.state === "failed" ? "is-error" : ""}">
    <span class="dc-upload-name">${item.name}</span>
    <span class="dc-upload-state">${label}</span>
  </div>`
}

/** Enqueue selected files, respecting the image cap. */
function handleDressCodeFiles() {
  const input = getInputElement("sc-dresscode-file")
  const files = input.files
  if (!files || files.length === 0) return
  const room = MAX_DRESSCODE_IMAGES - dressCodeImages.length
  if (room <= 0) {
    showError(`You can add at most ${MAX_DRESSCODE_IMAGES} dress-code images.`)
    input.value = ""
    return
  }
  if (!dressCodeQueue) {
    dressCodeQueue = createUploadQueue(
      { onChange: onDressCodeUpload },
      { csrfCookie: "csrf", section: "content", imageVariants: DRESSCODE_LADDER },
    )
  }
  dressCodeQueue.add(Array.from(files).slice(0, room))
  input.value = "" // allow re-selecting the same file
}

/** @param {Element} card @param {string} sel @returns {string} trimmed input value */
function fieldVal(card, sel) {
  const el = card.querySelector(sel)
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim()
  return ""
}

/**
 * Append one schedule-item editor card. Optional fields are plain inputs;
 * `details` paragraphs are a textarea split on blank lines.
 * @param {Types.SiteContentScheduleItem} [item]
 */
function addScheduleRow(item) {
  const time = item ? item.time : ""
  const title = item ? item.title : ""
  const officiant = item && item.officiant ? item.officiant : ""
  const venue = item && item.venue ? item.venue : ""
  const address = item && item.address ? item.address : ""
  const details = item ? item.details.join("\n\n") : ""
  const note = item && item.note ? item.note : ""
  getElement("sc-schedule-rows").insertAdjacentHTML(
    "beforeend",
    html`<div class="schedule-card">
      <input type="text" class="sched-time"
        placeholder="Time (e.g. 11:15 - 11:30 AM)" maxlength="100" value="${time}">
      <input type="text" class="sched-title" placeholder="Title" maxlength="200" value="${title}">
      <input type="text" class="sched-officiant"
        placeholder="Officiant (optional)" maxlength="300" value="${officiant}">
      <input type="text" class="sched-venue"
        placeholder="Venue (optional)" maxlength="200" value="${venue}">
      <input type="text" class="sched-address"
        placeholder="Address (optional)" maxlength="300" value="${address}">
      <textarea class="sched-details" rows="3"
        placeholder="Details — leave a blank line between paragraphs">${details}</textarea>
      <textarea class="sched-note" rows="2" placeholder="Note (optional)">${note}</textarea>
      <div class="card-reorder-actions">
        <button type="button" class="btn btn-secondary btn-sm sched-up"
          title="Move up" aria-label="Move up">↑</button>
        <button type="button" class="btn btn-secondary btn-sm sched-down"
          title="Move down" aria-label="Move down">↓</button>
        <button type="button" class="btn btn-danger btn-sm sched-remove">Remove item</button>
      </div>
    </div>`,
  )
}

/**
 * Move a card/row up or down among its siblings. Schedule + nav are collected by
 * DOM order, and their inputs live in the moved node, so this needs no sync.
 * @param {Element} el @param {number} dir -1 = up, +1 = down
 */
function moveSibling(el, dir) {
  const parent = el.parentNode
  if (!parent) return
  if (dir < 0) {
    const prev = el.previousElementSibling
    if (prev) parent.insertBefore(el, prev)
  } else {
    const next = el.nextElementSibling
    if (next) parent.insertBefore(next, el)
  }
}

/** @param {readonly Types.SiteContentScheduleItem[]} items */
function renderScheduleRows(items) {
  getElement("sc-schedule-rows").innerHTML = ""
  for (const item of items) addScheduleRow(item)
}

/**
 * Read schedule cards back into items. Fully-empty cards are dropped; the
 * server validates the rest. `details` splits on blank lines (no regex).
 * @returns {Types.SiteContentScheduleItem[]}
 */
function collectScheduleRows() {
  /** @type {Types.SiteContentScheduleItem[]} */
  const items = []
  const cards = getElement("sc-schedule-rows").querySelectorAll(".schedule-card")
  cards.forEach((card) => {
    const time = fieldVal(card, ".sched-time")
    const title = fieldVal(card, ".sched-title")
    const officiant = fieldVal(card, ".sched-officiant")
    const venue = fieldVal(card, ".sched-venue")
    const address = fieldVal(card, ".sched-address")
    const details = fieldVal(card, ".sched-details")
      .split("\n\n")
      .map((s) => s.trim())
      .filter(Boolean)
    const note = fieldVal(card, ".sched-note")
    if (!time && !title && !officiant && !venue && !address && details.length === 0 && !note) return
    items.push({
      time,
      title,
      officiant: officiant || null,
      venue: venue || null,
      address: address || null,
      details,
      note: note || null,
    })
  })
  return items
}

/** @param {MouseEvent} e */
function handleScheduleClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const card = target.closest(".schedule-card")
  if (!card) return
  if (target.closest(".sched-remove")) card.remove()
  else if (target.closest(".sched-up")) moveSibling(card, -1)
  else if (target.closest(".sched-down")) moveSibling(card, 1)
}

/** @param {Types.SiteContent} c */
function populate(c) {
  setVal("sc-couple-display", c.couple.display)
  setVal("sc-couple-first", c.couple.first)
  setVal("sc-couple-monogram", c.couple.monogram)
  setVal("sc-couple-fullnames", c.couple.fullNames.join(", "))
  setWeddingDate(c.weddingDate)
  setVal("sc-location", c.location)
  getSelectElement("sc-theme").value = c.theme
  setVal("sc-contact-email", c.contactEmail || "")
  setVal("sc-schedule-title", c.schedule.title)
  renderScheduleRows(c.schedule.items)
  setVal("sc-dresscode-title", c.dressCode.title)
  setTa("sc-dresscode-body", c.dressCode.body)
  dressCodeImages = c.dressCode.images.map((img) => ({ ...img }))
  renderDressCodeCards()
  setVal("sc-registry-title", c.registry.title)
  setTa("sc-registry-body", c.registry.body)
  setTa("sc-registry-framenote", c.registry.frameNote)
  setVal("sc-registry-url", c.registry.url)
  setVal("sc-registry-label", c.registry.label)
  getInputElement("sc-registry-after").checked = c.registry.showAfterWedding
  setVal("sc-memories-title", c.memories.title)
  setTa("sc-memories-body", c.memories.body)
  getInputElement("sc-guestbook-favorites").checked = c.guestbook.showFavorites
  getInputElement("sc-gallery-bw").checked = c.gallery.showBlackAndWhite
  setVal("sc-footer-event-heading", c.footer.eventHeading)
  setVal("sc-footer-github", c.footer.githubUrl || "")
  setVal("sc-copy-pre-heading", c.copy.pre.welcomeHeading)
  setTa("sc-copy-pre-intro", c.copy.pre.welcomeIntro)
  setVal("sc-copy-post-heading", c.copy.post.welcomeHeading)
  setTa("sc-copy-post-intro", c.copy.post.welcomeIntro)
  renderNavRows("sc-nav-pre-rows", c.nav.pre)
  renderNavRows("sc-nav-post-rows", c.nav.post)
  // Baseline for the unsaved-changes guard: the form now matches saved state.
  loaded = true
  savedSnapshot = snapshotForm()
  updateDirtyNote()
}

/** The action bar's "Unsaved changes" note follows the form. */
function updateDirtyNote() {
  getElement("site-content-dirty").hidden = !isSiteContentDirty()
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let dirtyTimer
/** Re-check after typing settles (serialising the form on every key is waste). */
function scheduleDirtyNote() {
  clearTimeout(dirtyTimer)
  dirtyTimer = setTimeout(updateDirtyNote, 150)
}

// Unsaved-changes guard. `savedSnapshot` is the serialized form as of the last
// populate() (initial load / save / reset); `loaded` stays false until the tab
// is first opened so an untouched, never-loaded form never reads as dirty.
let loaded = false
let savedSnapshot = ""

/** @returns {string} the current form serialized for dirty comparison */
function snapshotForm() {
  return JSON.stringify(collectForm())
}

/** The leave guard's Discard: forget the edits. The form reads as clean, so
 *  the next visit's mount reloads the saved content over it. */
export function discardSiteContent() {
  loaded = false
  updateDirtyNote()
}

/** @returns {boolean} whether the form has unsaved edits since the last load/save */
export function isSiteContentDirty() {
  return loaded && snapshotForm() !== savedSnapshot
}

/** Build the request body from the form fields. */
function collectForm() {
  // Capture any pending alt/caption edits before reading the images list.
  syncDressCodeCards()
  return {
    couple: {
      display: val("sc-couple-display"),
      first: val("sc-couple-first"),
      monogram: val("sc-couple-monogram"),
      fullNames: val("sc-couple-fullnames")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    weddingDate: val("sc-wedding-date"),
    location: val("sc-location"),
    theme: getSelectElement("sc-theme").value,
    contactEmail: val("sc-contact-email") || null,
    schedule: {
      title: val("sc-schedule-title"),
      items: collectScheduleRows(),
    },
    dressCode: {
      title: val("sc-dresscode-title"),
      body: taVal("sc-dresscode-body"),
      images: dressCodeImages,
    },
    registry: {
      title: val("sc-registry-title"),
      body: taVal("sc-registry-body"),
      frameNote: taVal("sc-registry-framenote"),
      url: val("sc-registry-url"),
      label: val("sc-registry-label"),
      showAfterWedding: getInputElement("sc-registry-after").checked,
    },
    memories: {
      title: val("sc-memories-title"),
      body: taVal("sc-memories-body"),
    },
    guestbook: {
      showFavorites: getInputElement("sc-guestbook-favorites").checked,
    },
    gallery: {
      showBlackAndWhite: getInputElement("sc-gallery-bw").checked,
    },
    footer: {
      githubUrl: val("sc-footer-github") || null,
      eventHeading: val("sc-footer-event-heading"),
    },
    copy: {
      pre: {
        welcomeHeading: val("sc-copy-pre-heading"),
        welcomeIntro: taVal("sc-copy-pre-intro"),
      },
      post: {
        welcomeHeading: val("sc-copy-post-heading"),
        welcomeIntro: taVal("sc-copy-post-intro"),
      },
    },
    nav: {
      pre: collectNavRows("sc-nav-pre-rows"),
      post: collectNavRows("sc-nav-post-rows"),
    },
  }
}

export async function loadSiteContent() {
  // Never clobber unsaved edits still sitting in the form. This is what makes
  // a session-expiry mid-edit survivable: the 401 → login swap leaves the form
  // DOM intact, and re-entering this tab after re-login would otherwise
  // repopulate from the server and silently discard everything.
  if (isSiteContentDirty()) return
  try {
    const data = await api("/api/admin/site-content")
    const response = /** @type {Types.SiteContentResponse} */ (data)
    populate(response.content)
  } catch (err) {
    console.error("Failed to load site content:", err)
    showError("Failed to load site content. Please refresh the page.")
  }
}

/** @param {SubmitEvent} e */
function handleSubmit(e) {
  e.preventDefault()
  void saveSiteContent()
}

/** Save the form; true when it saved. The leave guard's "Save and leave"
 *  (router.js) calls this too. @returns {Promise<boolean>} */
export async function saveSiteContent() {
  const errorEl = getElement("site-content-form-error")
  errorEl.hidden = true

  const saveBtn = getButtonElement("site-content-save-btn")
  saveBtn.disabled = true
  try {
    const data = await api("/api/admin/site-content", {
      method: "PUT",
      body: JSON.stringify(collectForm()),
    })
    const response = /** @type {Types.SiteContentResponse} */ (data)
    populate(response.content)
    showSuccess("Site content updated")
    return true
  } catch (err) {
    // The server throws one ValidationError at a time; surface it in the sticky
    // save bar (always in view) and move focus to it for screen readers.
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
    errorEl.scrollIntoView({ block: "nearest" })
    errorEl.focus()
    return false
  } finally {
    saveBtn.disabled = false
  }
}

function handleReset() {
  openConfirm({
    title: "Reset site content?",
    desc:
      "This replaces every field with the shipped defaults and removes the " +
      "dress-code images you've uploaded. This can't be undone.",
    confirmLabel: "Reset to defaults",
    danger: true,
    run: async () => {
      const data = await api("/api/admin/site-content", { method: "DELETE" })
      const response = /** @type {Types.SiteContentResponse} */ (data)
      populate(response.content)
      showSuccess("Site content reset to defaults")
    },
  })
}

/** @param {MouseEvent} e */
function handleNavClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const row = target.closest(".nav-row")
  if (!row) return
  if (target.closest(".nav-remove")) row.remove()
  else if (target.closest(".nav-up")) moveSibling(row, -1)
  else if (target.closest(".nav-down")) moveSibling(row, 1)
}

/** A jump chip scrolls its section to the top of the page. @param {MouseEvent} e */
function handleJump(e) {
  const t = e.target
  if (!(t instanceof Element)) return
  const chip = t.closest("[data-jump]")
  if (!(chip instanceof HTMLElement)) return
  const section = document.getElementById(chip.dataset.jump ?? "")
  if (!section) return
  section.scrollIntoView({ block: "start", behavior: "smooth" })
  const first = section.querySelector("input, textarea, select")
  if (first instanceof HTMLElement) first.focus({ preventScroll: true })
}

export function initSiteContent() {
  renderThemeOptions()
  registerPanel("site-content", {
    mount() {
      setCrumbs([])
      void loadSiteContent()
    },
  })
  const form = getFormElement("site-content-form")
  form.addEventListener("input", scheduleDirtyNote)
  form.addEventListener("change", scheduleDirtyNote)
  // Row add/remove/reorder buttons change the form without an input event.
  form.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("button")) scheduleDirtyNote()
  })
  getElement("site-content-page").addEventListener("click", handleJump)
  getFormElement("site-content-form").addEventListener("submit", handleSubmit)
  // Warn before a full page unload (refresh / close / session-expiry redirect)
  // drops unsaved edits. Tab-switches within the dashboard are guarded in main.js.
  window.addEventListener("beforeunload", (e) => {
    if (!isSiteContentDirty()) return
    e.preventDefault()
    e.returnValue = ""
  })
  getButtonElement("site-content-reset-btn").addEventListener("click", handleReset)
  getInputElement("sc-wedding-datetime").addEventListener("input", syncWeddingDate)
  getSelectElement("sc-wedding-offset").addEventListener("change", syncWeddingDate)
  getButtonElement("sc-nav-pre-add").addEventListener("click", () => addNavRow("sc-nav-pre-rows"))
  getButtonElement("sc-nav-post-add").addEventListener("click", () => addNavRow("sc-nav-post-rows"))
  getElement("sc-nav-pre-rows").addEventListener("click", handleNavClick)
  getElement("sc-nav-post-rows").addEventListener("click", handleNavClick)
  getButtonElement("sc-schedule-add").addEventListener("click", () => addScheduleRow())
  getElement("sc-schedule-rows").addEventListener("click", handleScheduleClick)
  getButtonElement("sc-dresscode-add").addEventListener("click", () =>
    getInputElement("sc-dresscode-file").click(),
  )
  getInputElement("sc-dresscode-file").addEventListener("change", handleDressCodeFiles)
  getElement("sc-dresscode-images").addEventListener("click", handleDressCodeClick)
}
