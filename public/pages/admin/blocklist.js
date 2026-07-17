/** @file Blocklist management module */
/** @import * as Types from './types.js' */

import { state } from "./state.js"
import {
  api,
  openModal,
  closeModal,
  showSuccess,
  showLoading,
  showLoadError,
} from "./utils.js"
import {
  html,
  getElement,
  getFormElement,
  getInputElement,
  getTextAreaElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"

/** @type {Types.BlocklistState} */
const moduleState = { deleteId: null }

/** @type {Types.loadBlocklist} */
export async function loadBlocklist() {
  try {
    showLoading(getElement("blocklist-tbody"), 5)
    const data = await api("/api/admin/blocklist")
    const response = /** @type {Types.BlocklistResponse} */ (data)
    state.currentBlocklist = response.blocklist
    renderBlocklist(response.blocklist)
  } catch (err) {
    console.error("Failed to load blocklist:", err)
    showLoadError(
      getElement("blocklist-tbody"),
      5,
      "Couldn't load the blocklist.",
      loadBlocklist,
    )
  }
}

/** @type {Types.renderBlocklist} */
function renderBlocklist(entries) {
  const tbody = getElement("blocklist-tbody")

  if (entries.length === 0) {
    tbody.innerHTML = html`<tr>
      <td colspan="5" class="empty-state">No blocklist entries yet</td>
    </tr>`
    return
  }

  tbody.innerHTML = html`${entries.map(
    (entry) =>
      html` <tr data-id="${entry.id}">
        <td>${entry.name || "-"}</td>
        <td>${entry.email || "-"}</td>
        <td>${entry.phone || "-"}</td>
        <td class="hide-mobile">${entry.reason || "-"}</td>
        <td class="actions-cell">
          <button class="btn btn-danger btn-sm" data-action="remove">
            Remove
          </button>
        </td>
      </tr>`,
  )}`
}

/** @type {Types.openAddBlocklistModal} */
function openAddBlocklistModal() {
  getFormElement("blocklist-form").reset()
  getElement("blocklist-form-error").hidden = true
  openModal(getDialogElement("blocklist-modal"))
}

/** @type {Types.handleBlocklistFormSubmit} */
async function handleBlocklistFormSubmit(e) {
  e.preventDefault()
  const errorEl = getElement("blocklist-form-error")
  errorEl.hidden = true

  const name = getInputElement("blocklist-name").value.trim() || null
  const email = getInputElement("blocklist-email").value.trim() || null
  const phone = getInputElement("blocklist-phone").value.trim() || null
  const reason = getTextAreaElement("blocklist-reason").value.trim() || null

  if (!name && !email && !phone) {
    errorEl.textContent = "At least one of name, email, or phone is required"
    errorEl.hidden = false
    return
  }

  const submitBtn = getButtonElement("blocklist-form-submit")
  submitBtn.disabled = true

  try {
    await api("/api/admin/blocklist", {
      method: "POST",
      body: JSON.stringify({ name, email, phone, reason }),
    })

    closeModal(getDialogElement("blocklist-modal"))
    await loadBlocklist()
    showSuccess("Added to blocklist")
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    submitBtn.disabled = false
  }
}

/** @type {Types.confirmRemoveBlocklist} */
export function confirmRemoveBlocklist(id) {
  const entry = state.getBlockedEntryById(id)
  if (!entry) return

  moduleState.deleteId = id
  const identifier = entry.name || entry.email || entry.phone || "this entry"
  getElement("blocklist-delete-message").textContent =
    `Are you sure you want to remove "${identifier}" from the blocklist?`

  openModal(getDialogElement("blocklist-delete-modal"))
}

/** @type {Types.handleBlocklistDeleteConfirm} */
async function handleBlocklistDeleteConfirm() {
  if (!moduleState.deleteId) return

  const btn = getButtonElement("confirm-blocklist-delete-btn")
  btn.disabled = true
  const errorEl = getElement("blocklist-delete-error")
  errorEl.hidden = true

  try {
    await api(`/api/admin/blocklist/${moduleState.deleteId}`, {
      method: "DELETE",
    })
    closeModal(getDialogElement("blocklist-delete-modal"))
    await loadBlocklist()
    showSuccess("Removed from blocklist")
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
    moduleState.deleteId = null
  }
}

/** @type {Types.handleBlocklistTableClick} */
function handleBlocklistTableClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  const btn = target.closest("button[data-action]")
  if (!btn) return

  const row = btn.closest("tr")
  if (!row || !(row instanceof HTMLTableRowElement)) return

  const id = parseInt(row.dataset.id || "", 10)
  if (isNaN(id)) return

  if (btn.getAttribute("data-action") === "remove") {
    confirmRemoveBlocklist(id)
  }
}

/** @type {Types.initBlocklist} */
export function initBlocklist() {
  getElement("add-blocklist-btn").addEventListener(
    "click",
    openAddBlocklistModal,
  )
  getFormElement("blocklist-form").addEventListener(
    "submit",
    handleBlocklistFormSubmit,
  )
  getButtonElement("confirm-blocklist-delete-btn").addEventListener(
    "click",
    handleBlocklistDeleteConfirm,
  )
  getElement("blocklist-tbody").addEventListener(
    "click",
    handleBlocklistTableClick,
  )
}
