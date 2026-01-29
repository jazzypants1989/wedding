/** @file Manual SMS module for copy-paste texting workflow */
/** @import * as Types from './types.js' */

import { loadGuests, loadStats } from "./guests.js"
import { api, openModal, closeModal, showError } from "./utils.js"
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
  if (moduleState.viewMode === "focus") {
    counter.textContent =
      moduleState.currentIndex + 1 + " of " + total + " (sent: " + sent + ")"
  } else {
    counter.textContent = "Sent: " + sent + " of " + total
  }
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
  if (isSent) {
    markBtn.textContent = "Sent"
    markBtn.disabled = true
    markBtn.classList.remove("btn-primary")
    markBtn.classList.add("btn-secondary")
  } else {
    markBtn.textContent = "Mark as Sent"
    markBtn.disabled = false
    markBtn.classList.remove("btn-secondary")
    markBtn.classList.add("btn-primary")
  }

  const copyBtn = getButtonElement("msms-copy-btn")
  copyBtn.textContent = "Copy Message"
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
    const previewText =
      message.length > 80 ? message.slice(0, 80) + "..." : message

    return html`
      <tr>
        <td>${guest.name}</td>
        <td><span class="msms-phone">${guest.phone}</span></td>
        <td class="hide-mobile">
          <span class="text-muted" style="font-size:0.8rem"
            >${previewText}</span
          >
        </td>
        <td class="msms-list-actions">
          <button
            type="button"
            class="btn btn-secondary btn-sm msms-list-copy-btn"
            data-guest-id="${guest.id}"
          >
            Copy
          </button>
          ${isSent
            ? html`<span class="msms-sent-badge">Sent</span>`
            : html`<button
                type="button"
                class="btn btn-primary btn-sm msms-list-mark-btn"
                data-guest-id="${guest.id}"
              >
                Send
              </button>`}
        </td>
      </tr>
    `
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

/** @type {Types.openManualSmsModal} */
async function openManualSmsModal() {
  try {
    const data = await api("/api/admin/manual-sms/guests")
    if (!isManualSmsData(data)) {
      throw new Error("Invalid data format")
    }
    moduleState.guests = data.guests || []
    moduleState.weddingInfo = data.wedding || null
    moduleState.template = data.defaultTemplate || ""
    moduleState.currentIndex = 0
    moduleState.sentIds = new Set()
  } catch (err) {
    showError("Failed to load guests: " + getErrorMessage(err))
    return
  }

  if (moduleState.guests.length === 0) {
    showError(
      "No eligible guests found. Guests need a phone number and status of pending or invited.",
    )
    return
  }

  getTextAreaElement("msms-template").value = moduleState.template

  // Collapse template section by default
  const details = /** @type {HTMLDetailsElement} */ (
    getElement("msms-template-section")
  )
  details.open = false

  // Default to focus mode
  moduleState.viewMode = "focus"
  getElement("msms-focus-view").hidden = false
  getElement("msms-list-view").hidden = true
  getButtonElement("msms-mode-focus").classList.add("active")
  getButtonElement("msms-mode-list").classList.remove("active")

  renderFocusView()
  openModal(getDialogElement("manual-sms-modal"))
}

/** @type {Types.handleDone} */
async function handleDone() {
  closeModal(getDialogElement("manual-sms-modal"))
  await loadGuests()
  await loadStats()
}

/** @type {Types.switchViewMode} */
function switchViewMode(mode) {
  moduleState.viewMode = mode

  const focusBtn = getButtonElement("msms-mode-focus")
  const listBtn = getButtonElement("msms-mode-list")
  const focusView = getElement("msms-focus-view")
  const listView = getElement("msms-list-view")

  if (mode === "focus") {
    focusBtn.classList.add("active")
    listBtn.classList.remove("active")
    focusView.hidden = false
    listView.hidden = true
    renderFocusView()
  } else {
    focusBtn.classList.remove("active")
    listBtn.classList.add("active")
    focusView.hidden = true
    listView.hidden = false
    renderListView()
  }
}

/** @type {Types.initManualSms} */
export function initManualSms() {
  getElement("manual-sms-btn").addEventListener("click", openManualSmsModal)
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
    btn.textContent = "Saving..."
    await markGuestSent(guest.id)
    renderFocusView()
  })

  // List view delegation
  getElement("msms-list-tbody").addEventListener("click", async (e) => {
    const target = e.target
    if (!(target instanceof HTMLButtonElement)) return

    const guestId = parseInt(target.dataset.guestId || "", 10)
    if (isNaN(guestId)) return

    if (target.classList.contains("msms-list-copy-btn")) {
      const guest = moduleState.guests.find((g) => g.id === guestId)
      if (!guest) return
      const template = getTemplate()
      const message = renderMessage(template, guest)
      await copyToClipboard(message, target)
    } else if (target.classList.contains("msms-list-mark-btn")) {
      target.disabled = true
      target.textContent = "..."
      await markGuestSent(guestId)
      renderListView()
    }
  })
}
