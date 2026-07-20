/** @file Guest management module */
/** @import * as Types from './types.js' */

import { state } from "./state.js"
import { openSendInvitesForGuest } from "./invites.js"
import {
  api,
  showError,
  showSuccess,
  showLoading,
  showLoadError,
  openModal,
  closeModal,
} from "./utils.js"
import {
  html,
  raw,
  join,
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
import { formatRelative } from "../../components/relative-time.js"

/** @type {Types.GuestModuleState} */
const moduleState = { deleteId: null, restoreId: null, searchTimeout: undefined }

/** @type {AbortController | null} */
let searchController = null

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
    showError("Failed to load stats. Please refresh the page.")
  }
}

/** @type {Types.loadGuests} */
export async function loadGuests() {
  if (searchController) searchController.abort()
  searchController = new AbortController()

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

    showLoading(getElement("guests-tbody"), 6)
    const data = await api(`/api/admin/guests?${params}`, {
      signal: searchController.signal,
    })
    const response = /** @type {Types.GuestsApiResponse} */ (data)
    state.currentGuests = response.guests
    renderGuests(response.guests, response.pagination)
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return
    console.error("Failed to load guests:", err)
    showLoadError(getElement("guests-tbody"), 6, "Couldn't load the guest list.", loadGuests)
  }
}

/** @type {Types.renderGuests} */
function renderGuests(guests, pagination) {
  const tbody = getElement("guests-tbody")
  const isViewingArchived =
    getSelectElement("guest-status-filter").value === "archived"

  if (guests.length === 0) {
    const isFiltered =
      !!getInputElement("guest-search").value.trim() ||
      (!isViewingArchived && !!getSelectElement("guest-status-filter").value)
    // Only a truly empty roster (no search/filter) gets the onboarding CTA — a
    // filtered-to-empty view would make "add your first guest" misleading.
    const showAddCta = !isViewingArchived && !isFiltered

    tbody.innerHTML = html`
      <tr>
        <td colspan="6" class="empty-state">
          ${isViewingArchived
            ? "No archived guests yet"
            : isFiltered
              ? "No guests match your search or filter."
              : html`No guests yet — add your first guest or import a list to get started.
                  <div class="empty-state-actions">
                    <button type="button" id="empty-add-guest" class="btn btn-primary btn-sm">Add Guest</button>
                    <button type="button" id="empty-import-csv" class="btn btn-secondary btn-sm">Import CSV</button>
                  </div>`}
        </td>
      </tr>
    `
    if (showAddCta) {
      getButtonElement("empty-add-guest").addEventListener("click", () =>
        getButtonElement("add-guest-btn").click(),
      )
      getButtonElement("empty-import-csv").addEventListener("click", () =>
        getButtonElement("import-csv-btn").click(),
      )
    }
    renderPagination(pagination)
    return
  }

  tbody.innerHTML = html`${guests.map((guest) => {
    const isArchived = !!guest.deleted_at
    const statusDisplay = isArchived ? "archived" : guest.status

    return html`
      <tr data-id="${guest.id}" class="${isArchived ? "archived-row" : ""}">
        <td>
          <strong>${guest.name}</strong>
          <br /><span class="invite-code">${guest.invite_code}</span>
        </td>
        <td>
          ${guest.email || guest.phone
            ? join([guest.email, guest.phone], raw("<br>"))
            : raw(
                '<span style="color: var(--color-text-muted)">No contact</span>',
              )}
        </td>
        <td>
          <span class="status-badge status-${statusDisplay}"
            >${statusDisplay}</span
          >
        </td>
        <td class="hide-mobile">${guest.party_size}</td>
        <td class="hide-mobile">
          ${guest.last_invited_at ? formatDate(guest.last_invited_at) : "-"}
          ${guest.invite_count > 0 &&
          html`<br /><small>(${guest.invite_count}x)</small>`}
        </td>
        <td class="actions-cell">
          ${isArchived
            ? html`<button
                class="btn btn-secondary btn-sm"
                data-action="restore"
              >
                Restore
              </button>`
            : html`<button class="btn btn-secondary btn-sm" data-action="edit">
                  Edit
                </button>
                ${guest.status !== "responded"
                  ? html`<button class="btn btn-secondary btn-sm" data-action="invite">
                      Invite
                    </button>`
                  : ""}
                <button class="btn btn-danger btn-sm" data-action="archive">
                  Archive
                </button>`}
        </td>
      </tr>
    `
  })}`

  renderPagination(pagination)
}

/** @type {Types.renderPagination} */
function renderPagination(pagination) {
  const container = getElement("guests-pagination")
  const totalPages = Math.ceil(pagination.total / pagination.limit)

  if (totalPages <= 1) {
    container.innerHTML = html`<span class="pagination-info"
      >${pagination.total} guest${pagination.total !== 1 ? "s" : ""}</span
    >`
    return
  }

  const currentPageNum = Math.floor(pagination.offset / pagination.limit)

  container.innerHTML = html`
    <button
      class="btn btn-secondary btn-sm"
      ${currentPageNum === 0 ? "disabled" : ""}
      data-action="prev-page"
    >
      Prev
    </button>
    <span class="pagination-info"
      >Page ${currentPageNum + 1} of ${totalPages} (${pagination.total}
      guests)</span
    >
    <button
      class="btn btn-secondary btn-sm"
      ${currentPageNum >= totalPages - 1 ? "disabled" : ""}
      data-action="next-page"
    >
      Next
    </button>
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
  getElement("guest-thankyou-summary").hidden = true
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
  void loadGuestThankYouSummary(guest.id)
}

/** Fetch the guest's gift/card story and render a compact thank-you line in the
 *  edit modal, with a jump to the Thank-yous tab. Silent on 404/error (task 8).
 *  @param {number} guestId */
async function loadGuestThankYouSummary(guestId) {
  const el = getElement("guest-thankyou-summary")
  el.hidden = true
  el.innerHTML = ""
  try {
    const story = /** @type {Types.GuestStory} */ (
      await api(`/api/admin/guests/${guestId}/story`)
    )
    // Guard the async race — the admin may have closed/reopened another guest.
    if (getInputElement("guest-id").value !== String(guestId)) return
    renderGuestThankYouSummary(story)
  } catch {
    // No story / endpoint absent → leave it hidden.
  }
}

/** @param {Types.GuestStory} story */
function renderGuestThankYouSummary(story) {
  const el = getElement("guest-thankyou-summary")
  const gift = story.gifts && story.gifts[0]
  const card = story.cards && story.cards[0]
  if (!gift && !card) {
    el.hidden = true
    return
  }
  /** @type {string[]} */
  const parts = []
  if (gift) parts.push(`Gift: ${gift.description || "(logged)"}`)
  if (card) {
    let s = "Card: "
    if (card.status === "draft") {
      s += "draft"
    } else {
      const bits = []
      if (card.sentAt) bits.push(`sent ${formatRelative(card.sentAt)}`)
      if (card.viewedAt) bits.push("viewed")
      if (card.repliedAt) bits.push("replied 💗")
      s += bits.length ? bits.join(" · ") : card.status
    }
    parts.push(s)
  }
  el.innerHTML = html`
    <span class="guest-thankyou-label">Thank-you</span>
    <span class="guest-thankyou-text">${parts.join(" · ")}</span>
    <button type="button" id="guest-open-thankyous" class="btn btn-secondary btn-sm">
      Open in Thank-yous
    </button>
  `
  el.hidden = false
  getButtonElement("guest-open-thankyous").addEventListener("click", () => {
    closeModal(getDialogElement("guest-modal"))
    const tab = document.getElementById("tab-btn-thankyous")
    if (tab instanceof HTMLElement) tab.click()
  })
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
export function restoreGuest(id) {
  const guest = state.getGuestById(id)
  if (!guest) return

  moduleState.restoreId = id
  getElement("restore-message").textContent =
    `Are you sure you want to restore "${guest.name}" from the archive?`
  getElement("restore-error").hidden = true
  openModal(getDialogElement("restore-modal"))
}

/** @type {Types.handleRestoreConfirm} */
async function handleRestoreConfirm() {
  const btn = getButtonElement("confirm-restore-btn")
  if (btn.disabled || !moduleState.restoreId) return

  btn.disabled = true
  const errorEl = getElement("restore-error")
  errorEl.hidden = true

  try {
    await api(`/api/admin/guests/${moduleState.restoreId}/restore`, {
      method: "POST",
    })
    closeModal(getDialogElement("restore-modal"))
    await loadGuests()
    await loadStats()
    showSuccess("Guest restored")
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
    moduleState.restoreId = null
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
    await loadGuests()
    await loadStats()
    showSuccess(id ? "Guest updated" : "Guest added")
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

  const errorEl = getElement("delete-error")
  errorEl.hidden = true

  try {
    await api(`/api/admin/guests/${moduleState.deleteId}`, { method: "DELETE" })
    closeModal(getDialogElement("delete-modal"))
    await loadGuests()
    await loadStats()
    showSuccess("Guest archived")
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
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
  else if (action === "invite") {
    const guest = state.getGuestById(id)
    if (guest) void openSendInvitesForGuest(id, guest.name)
  }
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
  getButtonElement("confirm-restore-btn").addEventListener(
    "click",
    handleRestoreConfirm,
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
