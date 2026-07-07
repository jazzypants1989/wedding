/** @file Moderation tab — pending guestbook queue with approve/reject (Phase 2) */
/** @import * as Types from './types.js' */

import { state } from "./state.js"
import { api, openModal, closeModal, showError } from "./utils.js"
import {
  html,
  formatDate,
  getElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"

/** @type {{ id: number, action: "approve" | "reject" }} */
let pending = { id: 0, action: "approve" }

/** @type {Types.updateModerationBadge} */
export function updateModerationBadge(count) {
  const badge = document.getElementById("moderation-badge")
  if (badge) {
    badge.textContent = String(count)
    badge.hidden = count <= 0
  }
}

/** @type {Types.loadModerationCount} */
export async function loadModerationCount() {
  try {
    const data = /** @type {Types.ModerationCountsResponse} */ (
      await api("/api/admin/moderation/counts")
    )
    updateModerationBadge(data.total)
  } catch (err) {
    // Non-critical — the tab still loads on demand.
  }
}

/** @type {Types.loadModeration} */
export async function loadModeration() {
  try {
    const data = /** @type {Types.ModerationQueueResponse} */ (
      await api("/api/admin/moderation/queue?type=guestbook")
    )
    state.currentModeration = data.items
    renderModeration(data.items)
    await loadModerationCount()
  } catch (err) {
    console.error("Failed to load moderation queue:", err)
    showError("Failed to load the moderation queue. Please refresh the page.")
  }
}

/** @param {Types.ModerationItem[]} items */
function renderModeration(items) {
  const tbody = getElement("moderation-tbody")

  if (items.length === 0) {
    tbody.innerHTML = html`<tr>
      <td colspan="4" class="empty-state">Nothing awaiting review 🎉</td>
    </tr>`
    return
  }

  tbody.innerHTML = html`${items.map(
    (item) => html`
      <tr data-id="${item.id}">
        <td><strong>${item.author_name}</strong></td>
        <td class="moderation-preview">${preview(item.message)}</td>
        <td class="hide-mobile">${formatDate(item.created_at)}</td>
        <td class="actions-cell">
          <button class="btn btn-primary btn-sm" data-action="approve">
            Approve
          </button>
          <button class="btn btn-danger btn-sm" data-action="reject">
            Reject
          </button>
        </td>
      </tr>
    `,
  )}`
}

/**
 * Truncate a message to a short single-line preview.
 * @param {string} message
 * @returns {string}
 */
function preview(message) {
  const flat = message.split("\n").join(" ").trim()
  return flat.length > 120 ? flat.slice(0, 117) + "…" : flat
}

/**
 * @param {number} id
 * @param {"approve" | "reject"} action
 */
function openConfirm(id, action) {
  const item = state.getModerationById(id)
  if (!item) return
  pending = { id, action }

  getElement("moderation-modal-desc").textContent =
    action === "approve"
      ? "Approve this message? It will appear publicly in the guestbook."
      : "Reject this message? It won't be published (the author keeps their account)."
  getElement("moderation-modal-message").textContent = item.message
  getElement("moderation-error").hidden = true

  const btn = getButtonElement("moderation-confirm-btn")
  btn.textContent = action === "approve" ? "Approve" : "Reject"
  btn.className = action === "approve" ? "btn btn-primary" : "btn btn-danger"

  openModal(getDialogElement("moderation-modal"))
}

async function handleConfirm() {
  const btn = getButtonElement("moderation-confirm-btn")
  btn.disabled = true
  try {
    await api(`/api/admin/moderation/guestbook/${pending.id}/${pending.action}`, {
      method: "POST",
    })
    closeModal(getDialogElement("moderation-modal"))
    await loadModeration()
  } catch (err) {
    const errorEl = getElement("moderation-error")
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
  }
}

/** @param {MouseEvent} e */
function handleTableClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  const btn = target.closest("button[data-action]")
  if (!btn) return

  const row = btn.closest("tr")
  if (!(row instanceof HTMLTableRowElement)) return

  const id = parseInt(row.dataset.id || "", 10)
  if (Number.isNaN(id)) return

  const action = btn.getAttribute("data-action")
  if (action === "approve") openConfirm(id, "approve")
  else if (action === "reject") openConfirm(id, "reject")
}

/** @type {Types.initModeration} */
export function initModeration() {
  getElement("moderation-tbody").addEventListener("click", handleTableClick)
  getButtonElement("moderation-confirm-btn").addEventListener(
    "click",
    handleConfirm,
  )
}
