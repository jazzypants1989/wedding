/** @file "Text invites by hand" (dialog route /admin/guests/text): copy each
 *  guest's message, send it from your own phone, mark it sent. One at a time
 *  or as a list. The router opens and closes the dialog. */
/** @import * as Types from './types.js' */

import { loadGuests } from "./guests.js"
import { api, closeModal, showError } from "./utils.js"
import {
  html,
  getElement,
  getTextAreaElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"

/** @type {Types.ManualSmsState} */
const moduleState = {
  viewMode: "focus",
  template: "",
  guests: [],
  weddingInfo: null,
  currentIndex: 0,
  sentIds: new Set(),
}

/** @type {Types.renderMessage} */
function renderMessage(template, guest) {
  if (!moduleState.weddingInfo) return template
  const url =
    moduleState.weddingInfo.baseUrl + "/rsvp?code=" + guest.invite_code
  return template
    .replaceAll("{name}", guest.name)
    .replaceAll("{url}", url)
    .replaceAll("{date}", moduleState.weddingInfo.date)
    .replaceAll("{location}", moduleState.weddingInfo.location)
}

/** @type {Types.copyToClipboard} */
async function copyToClipboard(text, button) {
  const originalText = button.textContent || ""
  let success = false

  try {
    await navigator.clipboard.writeText(text)
    success = true
  } catch {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand("copy")
      success = true
    } catch {
      // Could not copy
    }
    document.body.removeChild(textarea)
  }

  button.textContent = success ? "Copied!" : "Failed"
  button.disabled = true
  setTimeout(() => {
    button.textContent = originalText
    button.disabled = false
  }, 1500)
}

/** @type {Types.getTemplate} */
function getTemplate() {
  return (
    getTextAreaElement("msms-template").value.trim() || moduleState.template
  )
}

/** @type {Types.updateProgressCounter} */
function updateProgressCounter() {
  const counter = getElement("msms-progress-counter")
  const sent = moduleState.sentIds.size
  const total = moduleState.guests.length
  counter.textContent =
    moduleState.viewMode === "focus"
      ? `${moduleState.currentIndex + 1} of ${total} · ${sent} sent`
      : `${sent} of ${total} sent`
}

/** @type {Types.renderFocusView} */
function renderFocusView() {
  if (moduleState.guests.length === 0) return

  const guest = moduleState.guests[moduleState.currentIndex]
  const template = getTemplate()
  const message = renderMessage(template, guest)
  const isSent = moduleState.sentIds.has(guest.id)

  getElement("msms-guest-name").textContent = guest.name
  getElement("msms-guest-phone").textContent = guest.phone
  getElement("msms-guest-message").textContent = message

  const markBtn = getButtonElement("msms-mark-sent-btn")
  markBtn.textContent = isSent ? "Sent ✓" : "Mark as sent"
  markBtn.disabled = isSent
  markBtn.classList.toggle("btn-primary", !isSent)

  const copyBtn = getButtonElement("msms-copy-btn")
  copyBtn.textContent = "Copy message"
  copyBtn.disabled = false

  getButtonElement("msms-prev-btn").disabled = moduleState.currentIndex === 0
  getButtonElement("msms-next-btn").disabled =
    moduleState.currentIndex === moduleState.guests.length - 1

  updateProgressCounter()
}

/** @type {Types.renderListView} */
function renderListView() {
  const tbody = getElement("msms-list-tbody")
  const template = getTemplate()

  tbody.innerHTML = html`${moduleState.guests.map((guest) => {
    const isSent = moduleState.sentIds.has(guest.id)
    const message = renderMessage(template, guest)
    const previewText = message.length > 90 ? message.slice(0, 90) + "…" : message
    return html`<li class="msms-row ${isSent ? "is-sent" : ""}">
      <span class="msms-row-main">
        <span class="row-top"><strong>${guest.name}</strong><span class="msms-phone">${guest.phone}</span></span>
        <span class="msms-preview-text muted small">${previewText}</span>
      </span>
      <span class="msms-row-actions">
        <button type="button" class="btn btn-sm msms-list-copy-btn" data-guest-id="${guest.id}">Copy</button>
        ${isSent
          ? html`<span class="pill st-opened">Sent</span>`
          : html`<button type="button" class="btn btn-sm btn-primary msms-list-mark-btn"
              data-guest-id="${guest.id}">Mark sent</button>`}
      </span>
    </li>`
  })}`
  updateProgressCounter()
}

/** @type {Types.renderCurrentView} */
function renderCurrentView() {
  if (moduleState.viewMode === "focus") {
    renderFocusView()
  } else {
    renderListView()
  }
}

/** @type {Types.markGuestSent} */
async function markGuestSent(guestId) {
  const guest = moduleState.guests.find((g) => g.id === guestId)
  if (!guest) return

  const template = getTemplate()
  const message = renderMessage(template, guest)

  try {
    await api("/api/admin/manual-sms/mark-sent", {
      method: "POST",
      body: JSON.stringify({
        guestId: guestId,
        messagePreview: message.slice(0, 100),
      }),
    })
    moduleState.sentIds.add(guestId)
  } catch (err) {
    showError("Failed to mark as sent: " + getErrorMessage(err))
  }
}

/** @type {Types.isManualSmsData} */
function isManualSmsData(data) {
  return (
    typeof data === "object" &&
    data !== null &&
    "guests" in data &&
    Array.isArray(data.guests) &&
    "wedding" in data &&
    "defaultTemplate" in data &&
    typeof data.defaultTemplate === "string"
  )
}

/** Load the eligible guests and open on the first one not yet sent.
 *  @type {Types.mountManualSms} */
export async function mountManualSms() {
  const focus = getElement("msms-focus-view")
  const list = getElement("msms-list-view")
  moduleState.guests = []
  focus.hidden = true
  list.hidden = true
  getElement("msms-progress-counter").textContent = "Loading…"
  try {
    const data = await api("/api/admin/manual-sms/guests")
    if (!isManualSmsData(data)) throw new Error("Invalid data format")
    moduleState.guests = data.guests || []
    moduleState.weddingInfo = data.wedding || null
    moduleState.template = data.defaultTemplate || ""
    // Seed "Sent" from persisted state (markSent flips status → invited), so
    // reopening keeps the ticks and the couple's place instead of starting over.
    moduleState.sentIds = new Set(
      moduleState.guests.filter((g) => g.status === "invited").map((g) => g.id),
    )
    const firstUnsent = moduleState.guests.findIndex((g) => !moduleState.sentIds.has(g.id))
    moduleState.currentIndex = firstUnsent === -1 ? 0 : firstUnsent
  } catch (err) {
    getElement("msms-progress-counter").textContent = ""
    showError("Couldn't load the guests to text: " + getErrorMessage(err))
    return
  }

  getTextAreaElement("msms-template").value = moduleState.template
  const details = /** @type {HTMLDetailsElement} */ (getElement("msms-template-section"))
  details.open = false

  if (moduleState.guests.length === 0) {
    getElement("msms-progress-counter").textContent =
      "Nobody to text: guests need a phone number and no reply yet."
    return
  }
  switchViewMode("focus")
}

/** @type {Types.handleDone} */
function handleDone() {
  closeModal(getDialogElement("manual-sms-modal"))
  void loadGuests()
}

/** @type {Types.switchViewMode} */
function switchViewMode(mode) {
  moduleState.viewMode = mode

  getButtonElement("msms-mode-focus").setAttribute("aria-pressed", String(mode === "focus"))
  getButtonElement("msms-mode-list").setAttribute("aria-pressed", String(mode === "list"))
  getElement("msms-focus-view").hidden = mode !== "focus"
  getElement("msms-list-view").hidden = mode !== "list"
  if (mode === "focus") renderFocusView()
  else renderListView()
}

/** @type {Types.initManualSms} */
export function initManualSms() {
  getButtonElement("msms-done-btn").addEventListener("click", handleDone)

  // Re-render when template changes
  getTextAreaElement("msms-template").addEventListener("input", () => {
    renderCurrentView()
  })

  // Placeholder tag insertion
  document.querySelectorAll(".msms-placeholder-tag").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!(btn instanceof HTMLElement)) return
      const placeholder = btn.dataset.placeholder || ""
      const textarea = getTextAreaElement("msms-template")
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const text = textarea.value
      textarea.value = text.slice(0, start) + placeholder + text.slice(end)
      textarea.selectionStart = start + placeholder.length
      textarea.selectionEnd = start + placeholder.length
      textarea.focus()
      renderCurrentView()
    })
  })

  // View mode toggles
  getButtonElement("msms-mode-focus").addEventListener("click", () =>
    switchViewMode("focus"),
  )
  getButtonElement("msms-mode-list").addEventListener("click", () =>
    switchViewMode("list"),
  )

  // Focus mode navigation
  getButtonElement("msms-prev-btn").addEventListener("click", () => {
    if (moduleState.currentIndex > 0) {
      moduleState.currentIndex--
      renderFocusView()
    }
  })

  getButtonElement("msms-next-btn").addEventListener("click", () => {
    if (moduleState.currentIndex < moduleState.guests.length - 1) {
      moduleState.currentIndex++
      renderFocusView()
    }
  })

  // Focus mode copy
  getButtonElement("msms-copy-btn").addEventListener("click", () => {
    const guest = moduleState.guests[moduleState.currentIndex]
    if (!guest) return
    const template = getTemplate()
    const message = renderMessage(template, guest)
    copyToClipboard(message, getButtonElement("msms-copy-btn"))
  })

  // Focus mode mark sent
  getButtonElement("msms-mark-sent-btn").addEventListener("click", async () => {
    const guest = moduleState.guests[moduleState.currentIndex]
    if (!guest) return
    const btn = getButtonElement("msms-mark-sent-btn")
    btn.disabled = true
    btn.textContent = "Saving…"
    await markGuestSent(guest.id)
    renderFocusView()
  })

  // List view delegation
  getElement("msms-list-tbody").addEventListener("click", async (e) => {
    const target = e.target
    const btn = target instanceof Element ? target.closest("button") : null
    if (!(btn instanceof HTMLButtonElement)) return

    const guestId = parseInt(btn.dataset.guestId || "", 10)
    if (isNaN(guestId)) return

    if (btn.classList.contains("msms-list-copy-btn")) {
      const guest = moduleState.guests.find((g) => g.id === guestId)
      if (!guest) return
      const template = getTemplate()
      const message = renderMessage(template, guest)
      await copyToClipboard(message, btn)
    } else if (btn.classList.contains("msms-list-mark-btn")) {
      btn.disabled = true
      btn.textContent = "…"
      await markGuestSent(guestId)
      renderListView()
    }
  })
}
