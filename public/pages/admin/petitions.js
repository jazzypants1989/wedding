/** @file Petition management module */
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
import { loadGuests, loadStats } from "./guests.js"
import { loadBlocklist } from "./blocklist.js"
import {
  html,
  raw,
  join,
  formatDate,
  getElement,
  getSelectElement,
  getInputElement,
  getTextAreaElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"

/** The petition currently shown in the detail modal (for the approve/deny buttons). */
let viewingPetitionId = /** @type {number | null} */ (null)

/** @type {Types.updatePetitionBadge} */
export function updatePetitionBadge(count) {
  const badge = document.getElementById("petitions-badge")
  if (badge) {
    badge.textContent = String(count)
    badge.hidden = count <= 0
  }
}

/** @type {Types.loadPetitions} */
export async function loadPetitions() {
  const status = getSelectElement("petition-status-filter").value

  try {
    const params = new URLSearchParams()
    if (status) params.set("status", status)

    showLoading(getElement("petitions-tbody"), 6)
    const data = await api(`/api/admin/petitions?${params}`)
    const response = /** @type {Types.PetitionsWithCountsResponse} */ (data)
    state.currentPetitions = response.petitions
    renderPetitions(response.petitions)
    updatePetitionBadge(response.counts.pending)
  } catch (err) {
    console.error("Failed to load petitions:", err)
    showLoadError(
      getElement("petitions-tbody"),
      6,
      "Couldn't load the invitation requests.",
      loadPetitions,
    )
  }
}

/** @type {Types.loadPetitionCount} */
export async function loadPetitionCount() {
  try {
    // Counts-only endpoint — the badge needs one number, not the full pending list.
    const counts = /** @type {Types.PetitionCounts} */ (
      await api("/api/admin/petitions/counts")
    )
    updatePetitionBadge(counts.pending)
  } catch (err) {
    // Ignore - non-critical
  }
}

/** @type {Types.renderPetitions} */
function renderPetitions(petitions) {
  const tbody = getElement("petitions-tbody")

  if (petitions.length === 0) {
    tbody.innerHTML = html`<tr>
      <td colspan="6" class="empty-state">No invitation requests yet</td>
    </tr>`
    return
  }

  tbody.innerHTML = html`${petitions.map(
    (petition) => html`
      <tr data-id="${petition.id}">
        <td><strong>${petition.name}</strong></td>
        <td>${join([petition.email, petition.phone], raw("<br>"))}</td>
        <td class="hide-mobile">${petition.relationship || "-"}</td>
        <td>
          <span class="status-badge status-${petition.status}"
            >${petition.status}</span
          >
        </td>
        <td class="hide-mobile">${formatDate(petition.created_at)}</td>
        <td class="actions-cell">
          <button class="btn btn-secondary btn-sm" data-action="view">
            View
          </button>
          ${petition.status === "pending" &&
          html`
            <button class="btn btn-primary btn-sm" data-action="approve">
              Approve
            </button>
            <button class="btn btn-danger btn-sm" data-action="deny">
              Deny
            </button>
          `}
        </td>
      </tr>
    `,
  )}`
}

/** @type {Types.viewPetition} */
export function viewPetition(id) {
  const petition = state.getPetitionById(id)
  if (!petition) return

  const details = getElement("petition-details")
  details.innerHTML = html`
    <div class="detail-row"><strong>Name:</strong> ${petition.name}</div>
    <div class="detail-row"><strong>Email:</strong> ${petition.email}</div>
    <div class="detail-row">
      <strong>Phone:</strong> ${petition.phone || "-"}
    </div>
    <div class="detail-row">
      <strong>Relationship:</strong> ${petition.relationship || "-"}
    </div>
    <div class="detail-row">
      <strong>Message:</strong> ${petition.message || "-"}
    </div>
    <div class="detail-row">
      <strong>Status:</strong>
      <span class="status-badge status-${petition.status}"
        >${petition.status}</span
      >
    </div>
    <div class="detail-row">
      <strong>Submitted:</strong> ${formatDate(petition.created_at)}
    </div>
    ${petition.admin_notes &&
    html`<div class="detail-row">
      <strong>Admin Notes:</strong> ${petition.admin_notes}
    </div>`}
    ${petition.reviewed_at &&
    html`<div class="detail-row">
      <strong>Reviewed:</strong> ${formatDate(petition.reviewed_at)}
    </div>`}
  `

  viewingPetitionId = id
  const approveBtn = getButtonElement("petition-approve-btn")
  const denyBtn = getButtonElement("petition-deny-btn")
  const isPending = petition.status === "pending"
  approveBtn.hidden = !isPending
  denyBtn.hidden = !isPending

  openModal(getDialogElement("petition-modal"))
}

/** From the detail modal, close it and open the approve/deny confirm modal. */
function handleViewApprove() {
  if (viewingPetitionId === null) return
  closeModal(getDialogElement("petition-modal"))
  openApprovePetition(viewingPetitionId)
}

function handleViewDeny() {
  if (viewingPetitionId === null) return
  closeModal(getDialogElement("petition-modal"))
  openDenyPetition(viewingPetitionId)
}

/** @type {Types.openApprovePetition} */
export function openApprovePetition(id) {
  getInputElement("approve-petition-id").value = String(id)
  getSelectElement("approve-party-size").value = "2"
  getInputElement("approve-send-invite").checked = true
  getTextAreaElement("approve-notes").value = ""
  getElement("approve-error").hidden = true
  openModal(getDialogElement("petition-approve-modal"))
}

/** @type {Types.openDenyPetition} */
export function openDenyPetition(id) {
  getInputElement("deny-petition-id").value = String(id)
  getInputElement("deny-add-blocklist").checked = false
  getTextAreaElement("deny-notes").value = ""
  getElement("deny-error").hidden = true
  openModal(getDialogElement("petition-deny-modal"))
}

/** @type {Types.handleApproveConfirm} */
async function handleApproveConfirm() {
  const id = getInputElement("approve-petition-id").value
  const partySize = getSelectElement("approve-party-size").value
  const sendInvite = getInputElement("approve-send-invite").checked
  const adminNotes = getTextAreaElement("approve-notes").value

  const btn = getButtonElement("confirm-approve-btn")
  btn.disabled = true
  btn.textContent = "Approving..."

  try {
    await api(`/api/admin/petitions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        party_size: parseInt(partySize, 10),
        send_invite: sendInvite,
        admin_notes: adminNotes || null,
      }),
    })

    closeModal(getDialogElement("petition-approve-modal"))
    await loadPetitions()
    await loadGuests()
    await loadStats()
    showSuccess("Request approved")
  } catch (err) {
    const errorEl = getElement("approve-error")
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
    btn.textContent = "Approve & Create Guest"
  }
}

/** @type {Types.handleDenyConfirm} */
async function handleDenyConfirm() {
  const id = getInputElement("deny-petition-id").value
  const addToBlocklist = getInputElement("deny-add-blocklist").checked
  const adminNotes = getTextAreaElement("deny-notes").value

  const btn = getButtonElement("confirm-deny-btn")
  btn.disabled = true
  btn.textContent = "Denying..."

  try {
    await api(`/api/admin/petitions/${id}/deny`, {
      method: "POST",
      body: JSON.stringify({
        add_to_blocklist: addToBlocklist,
        admin_notes: adminNotes || null,
      }),
    })

    closeModal(getDialogElement("petition-deny-modal"))
    await loadPetitions()
    if (addToBlocklist) await loadBlocklist()
    showSuccess("Request denied")
  } catch (err) {
    const errorEl = getElement("deny-error")
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
    btn.textContent = "Deny Request"
  }
}

/** @type {Types.handlePetitionsTableClick} */
function handlePetitionsTableClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  const btn = target.closest("button[data-action]")
  if (!btn) return

  const row = btn.closest("tr")
  if (!row || !(row instanceof HTMLTableRowElement)) return

  const id = parseInt(row.dataset.id || "", 10)
  if (isNaN(id)) return

  const action = btn.getAttribute("data-action")
  if (action === "view") viewPetition(id)
  else if (action === "approve") openApprovePetition(id)
  else if (action === "deny") openDenyPetition(id)
}

/** @type {Types.initPetitions} */
export function initPetitions() {
  getSelectElement("petition-status-filter").addEventListener(
    "change",
    loadPetitions,
  )
  getButtonElement("confirm-approve-btn").addEventListener(
    "click",
    handleApproveConfirm,
  )
  getButtonElement("confirm-deny-btn").addEventListener(
    "click",
    handleDenyConfirm,
  )
  getButtonElement("petition-approve-btn").addEventListener(
    "click",
    handleViewApprove,
  )
  getButtonElement("petition-deny-btn").addEventListener("click", handleViewDeny)
  getElement("petitions-tbody").addEventListener(
    "click",
    handlePetitionsTableClick,
  )
}
