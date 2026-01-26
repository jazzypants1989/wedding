/** @file Petition management module */
/** @import * as Types from './types.js' */

import { state } from "./state.js"
import { api } from "./api.js"
import { openModal, closeModal } from "./modal.js"
import { loadGuests, loadStats } from "./guests.js"
import { loadBlocklist } from "./blocklist.js"
import {
  escapeHtml,
  formatDate,
  getElement,
  getSelectElement,
  getInputElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"

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

    const data = await api(`/api/admin/petitions?${params}`)
    const response = /** @type {Types.PetitionsWithCountsResponse} */ (data)
    state.currentPetitions = response.petitions
    renderPetitions(response.petitions)
    updatePetitionBadge(response.counts.pending)
  } catch (err) {
    console.error("Failed to load petitions:", err)
  }
}

/** @type {Types.loadPetitionCount} */
export async function loadPetitionCount() {
  try {
    const data = await api("/api/admin/petitions?status=pending")
    const response = /** @type {Types.PetitionsWithCountsResponse} */ (data)
    updatePetitionBadge(response.counts.pending)
  } catch (err) {
    // Ignore - non-critical
  }
}

/** @type {Types.renderPetitions} */
function renderPetitions(petitions) {
  const tbody = getElement("petitions-tbody")

  if (petitions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No petitions found</td></tr>`
    return
  }

  tbody.innerHTML = petitions
    .map(
      (petition) => `
    <tr data-id="${petition.id}">
      <td><strong>${escapeHtml(petition.name)}</strong></td>
      <td>
        ${petition.email ? escapeHtml(petition.email) : ""}
        ${petition.email && petition.phone ? "<br>" : ""}
        ${petition.phone ? escapeHtml(petition.phone) : ""}
      </td>
      <td class="hide-mobile">${
        petition.relationship ? escapeHtml(petition.relationship) : "-"
      }</td>
      <td><span class="status-badge status-${petition.status}">${
        petition.status
      }</span></td>
      <td class="hide-mobile">${formatDate(petition.created_at)}</td>
      <td class="actions-cell">
        <button class="btn btn-secondary btn-sm" data-action="view">View</button>
        ${
          petition.status === "pending"
            ? `
          <button class="btn btn-primary btn-sm" data-action="approve">Approve</button>
          <button class="btn btn-danger btn-sm" data-action="deny">Deny</button>
        `
            : ""
        }
      </td>
    </tr>
  `,
    )
    .join("")
}

/** @type {Types.viewPetition} */
export function viewPetition(id) {
  const petition = state.getPetitionById(id)
  if (!petition) return

  const details = getElement("petition-details")
  details.innerHTML = `
    <div class="detail-row"><strong>Name:</strong> ${escapeHtml(
      petition.name,
    )}</div>
    <div class="detail-row"><strong>Email:</strong> ${escapeHtml(
      petition.email,
    )}</div>
    <div class="detail-row"><strong>Phone:</strong> ${
      petition.phone ? escapeHtml(petition.phone) : "-"
    }</div>
    <div class="detail-row"><strong>Relationship:</strong> ${
      petition.relationship ? escapeHtml(petition.relationship) : "-"
    }</div>
    <div class="detail-row"><strong>Message:</strong> ${
      petition.message ? escapeHtml(petition.message) : "-"
    }</div>
    <div class="detail-row"><strong>Status:</strong> <span class="status-badge status-${
      petition.status
    }">${petition.status}</span></div>
    <div class="detail-row"><strong>Submitted:</strong> ${formatDate(
      petition.created_at,
    )}</div>
    ${
      petition.admin_notes
        ? `<div class="detail-row"><strong>Admin Notes:</strong> ${escapeHtml(
            petition.admin_notes,
          )}</div>`
        : ""
    }
    ${
      petition.reviewed_at
        ? `<div class="detail-row"><strong>Reviewed:</strong> ${formatDate(
            petition.reviewed_at,
          )}</div>`
        : ""
    }
  `

  const approveBtn = getButtonElement("petition-approve-btn")
  const denyBtn = getButtonElement("petition-deny-btn")
  const petitionModal = getDialogElement("petition-modal")

  if (petition.status === "pending") {
    approveBtn.hidden = false
    denyBtn.hidden = false
    approveBtn.onclick = () => {
      closeModal(petitionModal)
      openApprovePetition(id)
    }
    denyBtn.onclick = () => {
      closeModal(petitionModal)
      openDenyPetition(id)
    }
  } else {
    approveBtn.hidden = true
    denyBtn.hidden = true
  }

  openModal(petitionModal)
}

/** @type {Types.openApprovePetition} */
export function openApprovePetition(id) {
  getInputElement("approve-petition-id").value = String(id)
  getInputElement("approve-party-size").value = "2"
  getInputElement("approve-send-invite").checked = true
  getInputElement("approve-notes").value = ""
  getElement("approve-error").hidden = true
  openModal(getDialogElement("petition-approve-modal"))
}

/** @type {Types.openDenyPetition} */
export function openDenyPetition(id) {
  getInputElement("deny-petition-id").value = String(id)
  getInputElement("deny-add-blocklist").checked = false
  getInputElement("deny-notes").value = ""
  getElement("deny-error").hidden = true
  openModal(getDialogElement("petition-deny-modal"))
}

/** @type {Types.handleApproveConfirm} */
async function handleApproveConfirm() {
  const id = getInputElement("approve-petition-id").value
  const partySize = getInputElement("approve-party-size").value
  const sendInvite = getInputElement("approve-send-invite").checked
  const adminNotes = getInputElement("approve-notes").value

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
    loadPetitions()
    loadGuests()
    loadStats()
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
  const adminNotes = getInputElement("deny-notes").value

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
    loadPetitions()
    if (addToBlocklist) loadBlocklist()
  } catch (err) {
    const errorEl = getElement("deny-error")
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
    btn.textContent = "Deny Petition"
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
  getElement("petitions-tbody").addEventListener(
    "click",
    handlePetitionsTableClick,
  )
}
