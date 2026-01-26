/** @file Guest management module */
/** @import * as Types from './types.js' */

import { state } from "./state.js"
import { api } from "./api.js"
import { openModal, closeModal } from "./modal.js"
import {
  escapeHtml,
  formatDate,
  getElement,
  getFormElement,
  getInputElement,
  getSelectElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
  getTextAreaElement,
} from "../utils.js"

/** @type {Types.GuestModuleState} */
const moduleState = { deleteId: null, searchTimeout: undefined }

/** @type {Types.loadStats} */
export async function loadStats() {
  try {
    const data = await api("/api/admin/stats")
    const response = /** @type {Types.StatsApiResponse} */ (data)
    const stats = response.stats

    getElement("stat-total").textContent = String(stats.total_guests)
    getElement("stat-responded").textContent = String(stats.responded)
    getElement("stat-responded-detail").textContent =
      `${stats.attending_yes} yes, ${stats.attending_no} no`
    getElement("stat-pending").textContent = String(
      stats.pending + stats.invited,
    )
    getElement("stat-headcount").textContent = String(stats.total_headcount)
  } catch (err) {
    console.error("Failed to load stats:", err)
  }
}

/** @type {Types.loadGuests} */
export async function loadGuests() {
  const search = getInputElement("guest-search").value
  const status = getSelectElement("guest-status-filter").value
  const offset = state.currentPage * state.PAGE_SIZE

  try {
    const params = new URLSearchParams({
      limit: String(state.PAGE_SIZE),
      offset: String(offset),
    })
    if (search) params.set("search", search)
    if (status) params.set("status", status)

    const data = await api(`/api/admin/guests?${params}`)
    const response = /** @type {Types.GuestsApiResponse} */ (data)
    state.currentGuests = response.guests
    renderGuests(response.guests, response.pagination)
  } catch (err) {
    console.error("Failed to load guests:", err)
  }
}

/** @type {Types.renderGuests} */
function renderGuests(guests, pagination) {
  const tbody = getElement("guests-tbody")
  const isViewingArchived =
    getSelectElement("guest-status-filter").value === "archived"

  if (guests.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">${
          isViewingArchived ? "No archived guests" : "No guests found"
        }</td>
      </tr>
    `
    renderPagination(pagination)
    return
  }

  tbody.innerHTML = guests
    .map((guest) => {
      const isArchived = !!guest.deleted_at
      const statusDisplay = isArchived ? "archived" : guest.status

      return `
    <tr data-id="${guest.id}" class="${isArchived ? "archived-row" : ""}">
      <td>
        <strong>${escapeHtml(guest.name)}</strong>
        <br><span class="invite-code">${guest.invite_code}</span>
      </td>
      <td>
        ${guest.email ? escapeHtml(guest.email) : ""}
        ${guest.email && guest.phone ? "<br>" : ""}
        ${guest.phone ? escapeHtml(guest.phone) : ""}
        ${
          !guest.email && !guest.phone
            ? '<span style="color: var(--color-text-muted)">No contact</span>'
            : ""
        }
      </td>
      <td>
        <span class="status-badge status-${statusDisplay}">${statusDisplay}</span>
      </td>
      <td class="hide-mobile">${guest.party_size}</td>
      <td class="hide-mobile">
        ${guest.last_invited_at ? formatDate(guest.last_invited_at) : "-"}
        ${
          guest.invite_count > 0
            ? `<br><small>(${guest.invite_count}x)</small>`
            : ""
        }
      </td>
      <td class="actions-cell">
        ${
          isArchived
            ? `<button class="btn btn-secondary btn-sm" data-action="restore">Restore</button>`
            : `<button class="btn btn-secondary btn-sm" data-action="edit">Edit</button>
             <button class="btn btn-danger btn-sm" data-action="archive">Archive</button>`
        }
      </td>
    </tr>
  `
    })
    .join("")

  renderPagination(pagination)
}

/** @type {Types.renderPagination} */
function renderPagination(pagination) {
  const container = getElement("guests-pagination")
  const totalPages = Math.ceil(pagination.total / pagination.limit)

  if (totalPages <= 1) {
    container.innerHTML = `<span class="pagination-info">${
      pagination.total
    } guest${pagination.total !== 1 ? "s" : ""}</span>`
    return
  }

  const currentPageNum = Math.floor(pagination.offset / pagination.limit)

  container.innerHTML = `
    <button class="btn btn-secondary btn-sm" ${
      currentPageNum === 0 ? "disabled" : ""
    } data-action="prev-page">Prev</button>
    <span class="pagination-info">Page ${
      currentPageNum + 1
    } of ${totalPages} (${pagination.total} guests)</span>
    <button class="btn btn-secondary btn-sm" ${
      currentPageNum >= totalPages - 1 ? "disabled" : ""
    } data-action="next-page">Next</button>
  `
}

/** @type {Types.goToPage} */
export function goToPage(page) {
  state.currentPage = page
  loadGuests()
}

/** @type {Types.openAddGuestModal} */
function openAddGuestModal() {
  getElement("guest-modal-title").textContent = "Add Guest"
  getFormElement("guest-form").reset()
  getInputElement("guest-id").value = ""
  getElement("guest-form-error").hidden = true
  openModal(getDialogElement("guest-modal"))
}

/** @type {Types.editGuest} */
export function editGuest(id) {
  const guest = state.getGuestById(id)
  if (!guest) return

  getElement("guest-modal-title").textContent = "Edit Guest"
  getInputElement("guest-id").value = String(guest.id)
  getInputElement("guest-name").value = guest.name
  getInputElement("guest-email").value = guest.email || ""
  getInputElement("guest-phone").value = guest.phone || ""
  getSelectElement("guest-party-size").value = String(guest.party_size)
  getTextAreaElement("guest-notes").value = guest.notes || ""
  getElement("guest-form-error").hidden = true
  openModal(getDialogElement("guest-modal"))
}

/** @type {Types.confirmDeleteGuest} */
export function confirmDeleteGuest(id) {
  const guest = state.getGuestById(id)
  if (!guest) return

  moduleState.deleteId = id
  getElement("delete-message").textContent =
    `Are you sure you want to archive "${guest.name}"?`

  const warning = document.getElementById("delete-rsvp-warning")
  if (warning) {
    warning.textContent =
      "This guest has submitted an RSVP. Their response will be preserved but hidden from stats."
    warning.hidden = guest.status !== "responded"
  }

  openModal(getDialogElement("delete-modal"))
}

/** @type {Types.restoreGuest} */
export async function restoreGuest(id) {
  if (!confirm("Restore this guest from the archive?")) return

  try {
    await api(`/api/admin/guests/${id}/restore`, { method: "POST" })
    loadGuests()
    loadStats()
  } catch (err) {
    alert("Failed to restore guest: " + getErrorMessage(err))
  }
}

/** @type {Types.handleGuestFormSubmit} */
async function handleGuestFormSubmit(e) {
  e.preventDefault()

  const submitBtn = getButtonElement("guest-form-submit")
  if (submitBtn.disabled) return

  submitBtn.disabled = true
  const errorEl = getElement("guest-form-error")
  errorEl.hidden = true

  const id = getInputElement("guest-id").value
  const data = {
    name: getInputElement("guest-name").value,
    email: getInputElement("guest-email").value || null,
    phone: getInputElement("guest-phone").value || null,
    party_size: parseInt(getSelectElement("guest-party-size").value, 10),
    notes: getTextAreaElement("guest-notes").value || null,
  }

  try {
    if (id) {
      await api(`/api/admin/guests/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      })
    } else {
      await api("/api/admin/guests", {
        method: "POST",
        body: JSON.stringify(data),
      })
    }

    closeModal(getDialogElement("guest-modal"))
    loadGuests()
    loadStats()
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    submitBtn.disabled = false
  }
}

/** @type {Types.handleDeleteConfirm} */
async function handleDeleteConfirm() {
  const btn = getButtonElement("confirm-delete-btn")
  if (btn.disabled || !moduleState.deleteId) return

  btn.disabled = true

  try {
    await api(`/api/admin/guests/${moduleState.deleteId}`, { method: "DELETE" })
    closeModal(getDialogElement("delete-modal"))
    loadGuests()
    loadStats()
  } catch (err) {
    alert("Failed to archive guest: " + getErrorMessage(err))
  } finally {
    btn.disabled = false
    moduleState.deleteId = null
  }
}

/** @type {Types.handleSearchInput} */
function handleSearchInput() {
  clearTimeout(moduleState.searchTimeout)
  moduleState.searchTimeout = setTimeout(() => {
    state.currentPage = 0
    loadGuests()
  }, 300)
}

/** @type {Types.handleGuestsTableClick} */
function handleGuestsTableClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  const btn = target.closest("button[data-action]")
  if (!btn) return

  const row = btn.closest("tr")
  if (!row || !(row instanceof HTMLTableRowElement)) return

  const id = parseInt(row.dataset.id || "", 10)
  if (isNaN(id)) return

  const action = btn.getAttribute("data-action")
  if (action === "edit") editGuest(id)
  else if (action === "archive") confirmDeleteGuest(id)
  else if (action === "restore") restoreGuest(id)
}

/** @type {Types.handlePaginationClick} */
function handlePaginationClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  const btn = target.closest("button[data-action]")
  if (!btn || btn.hasAttribute("disabled")) return

  const action = btn.getAttribute("data-action")
  if (action === "prev-page") goToPage(state.currentPage - 1)
  else if (action === "next-page") goToPage(state.currentPage + 1)
}

/** @type {Types.initGuests} */
export function initGuests() {
  getElement("add-guest-btn").addEventListener("click", openAddGuestModal)
  getFormElement("guest-form").addEventListener("submit", handleGuestFormSubmit)
  getButtonElement("confirm-delete-btn").addEventListener(
    "click",
    handleDeleteConfirm,
  )
  getInputElement("guest-search").addEventListener("input", handleSearchInput)
  getSelectElement("guest-status-filter").addEventListener("change", () => {
    state.currentPage = 0
    loadGuests()
  })
  getElement("guests-tbody").addEventListener("click", handleGuestsTableClick)
  getElement("guests-pagination").addEventListener(
    "click",
    handlePaginationClick,
  )
}
