/** @file Invite wizard module */
/** @import * as Types from './types.js' */
/** @import { Guest } from '../../../types.js' */

import { state } from "./state.js"
import { loadGuests, loadStats } from "./guests.js"
import { api, openModal, closeModal, showError } from "./utils.js"
import {
  html,
  getElement,
  getButtonElement,
  getDialogElement,
  getTextAreaElement,
  getErrorMessage,
} from "../utils.js"

/** @type {Types.InviteModuleState} */
const moduleState = {
  step: "config",
  guestIds: [],
  config: null,
  previewData: null,
}

/** @type {Types.updateInviteConfigUI} */
function updateInviteConfigUI() {
  if (!moduleState.config) return

  const emailStatus = getElement("email-status")
  const smsStatus = getElement("sms-status")

  if (moduleState.config.email.configured) {
    emailStatus.textContent = "(configured)"
    emailStatus.classList.remove("text-danger")
    emailStatus.classList.add("text-success")
  } else {
    emailStatus.textContent = "(not configured)"
    emailStatus.classList.remove("text-success")
    emailStatus.classList.add("text-danger")
  }

  if (moduleState.config.sms.configured) {
    smsStatus.textContent = "(configured)"
    smsStatus.classList.remove("text-danger")
    smsStatus.classList.add("text-success")
  } else {
    smsStatus.textContent = "(not configured)"
    smsStatus.classList.remove("text-success")
    smsStatus.classList.add("text-danger")
  }
}

/** @type {Types.renderInvitePreview} */
function renderInvitePreview() {
  if (!moduleState.previewData) return

  getElement("invite-preview-content").innerHTML = html`
    ${moduleState.previewData.skipped.length > 0 &&
    html`
      <div class="alert alert-warning">
        <strong
          >${moduleState.previewData.skipped.length} guest(s) will be
          skipped:</strong
        >
        <ul>
          ${moduleState.previewData.skipped.map(
            (s) => html` <li>${s.name || `ID ${s.id}`}: ${s.reason}</li> `,
          )}
        </ul>
      </div>
    `}
    <h4>
      Will send to ${moduleState.previewData.recipients.length} recipient(s):
    </h4>
    <div class="preview-list">
      ${moduleState.previewData.recipients.slice(0, 5).map(
        (r) => html`
          <div class="preview-item">
            <strong>${r.name}</strong> (${r.contact})
            <div class="preview-message">${r.messagePreview}...</div>
          </div>
        `,
      )}
      ${moduleState.previewData.recipients.length > 5 &&
      html`
        <div class="preview-item text-muted">
          ...and ${moduleState.previewData.recipients.length - 5} more
        </div>
      `}
    </div>
  `
}

/** @type {Types.renderInviteResults} */
function renderInviteResults(result) {
  getElement("invite-results-content").innerHTML = html`
    <div class="import-summary">
      <div class="import-stat success">
        <strong>${result.summary.sent}</strong> sent
      </div>
      <div class="import-stat error">
        <strong>${result.summary.failed}</strong> failed
      </div>
      <div class="import-stat warning">
        <strong>${result.summary.skipped}</strong> skipped
      </div>
    </div>
    ${result.results.failed.length > 0 &&
    html`
      <h4>Failed:</h4>
      <ul class="import-list error-list">
        ${result.results.failed.map(
          (f) => html` <li><strong>${f.name}</strong>: ${f.error}</li> `,
        )}
      </ul>
    `}
    ${result.results.skipped.length > 0 &&
    html`
      <h4>Skipped:</h4>
      <ul class="import-list">
        ${result.results.skipped.map(
          (s) => html`
            <li><strong>${s.name || `ID ${s.id}`}</strong>: ${s.reason}</li>
          `,
        )}
      </ul>
    `}
  `
}

/** @type {Types.openSendInvitesModal} */
async function openSendInvitesModal() {
  /** @param {Guest} g */
  const getInvitableId = (g) =>
    !g.deleted_at && g.status !== "responded" ? [g.id] : []

  moduleState.guestIds = state.currentGuests.flatMap(getInvitableId)

  if (moduleState.guestIds.length === 0) {
    showError(
      "No guests available to invite. All guests have either responded or are archived.",
    )
    return
  }

  try {
    const data = await api("/api/admin/invite/config")
    moduleState.config = /** @type {Types.InviteConfig} */ (data)
    updateInviteConfigUI()
  } catch (err) {
    showError("Failed to load invite configuration: " + getErrorMessage(err))
    return
  }

  moduleState.step = "config"
  getElement("invite-step-config").hidden = false
  getElement("invite-step-preview").hidden = true
  getElement("invite-step-results").hidden = true
  getTextAreaElement("invite-message").value = ""
  getElement("invite-config-error").hidden = true

  const nextBtn = getButtonElement("invite-next-btn")
  const backBtn = getButtonElement("invite-back-btn")
  nextBtn.textContent = "Preview"
  nextBtn.disabled = false
  backBtn.hidden = true

  /**
   * @param {{ pending: number, invited: number }} counts
   * @param {Guest} g
   */
  const countByStatus = (counts, g) => {
    if (!g.deleted_at) {
      if (g.status === "pending") counts.pending++
      else if (g.status === "invited") counts.invited++
    }
    return counts
  }

  const { pending: pendingCount, invited: invitedCount } =
    state.currentGuests.reduce(countByStatus, { pending: 0, invited: 0 })

  getElement("invite-recipients-summary").innerHTML = html`
    <p><strong>${moduleState.guestIds.length}</strong> guests selected</p>
    <small class="text-muted"
      >${pendingCount} pending, ${invitedCount} previously invited (not yet
      responded)</small
    >
  `

  openModal(getDialogElement("invite-modal"))
}

/** @type {Types.handleInviteNext} */
async function handleInviteNext() {
  const errorEl = getElement("invite-config-error")
  const nextBtn = getButtonElement("invite-next-btn")
  const backBtn = getButtonElement("invite-back-btn")
  errorEl.hidden = true

  if (moduleState.step === "config") {
    const typeInput = document.querySelector(
      'input[name="invite-type"]:checked',
    )
    if (!(typeInput instanceof HTMLInputElement)) return
    const type = typeInput.value
    const customMessage =
      getTextAreaElement("invite-message").value.trim() || null

    if (
      type === "email" &&
      moduleState.config &&
      !moduleState.config.email.configured
    ) {
      errorEl.textContent =
        "Email is not configured. Set RESEND_API_KEY in .env"
      errorEl.hidden = false
      return
    }

    if (
      type === "sms" &&
      moduleState.config &&
      !moduleState.config.sms.configured
    ) {
      errorEl.textContent =
        "SMS is not configured. Set Twilio credentials in .env"
      errorEl.hidden = false
      return
    }

    nextBtn.disabled = true
    nextBtn.textContent = "Loading..."

    try {
      const data = await api("/api/admin/invite/preview", {
        method: "POST",
        body: JSON.stringify({
          guestIds: moduleState.guestIds,
          type,
          customMessage,
        }),
      })
      moduleState.previewData = /** @type {Types.InvitePreviewData} */ (data)

      renderInvitePreview()
      moduleState.step = "preview"
      getElement("invite-step-config").hidden = true
      getElement("invite-step-preview").hidden = false
      nextBtn.textContent = `Send ${
        moduleState.previewData.totalToSend
      } Invite${moduleState.previewData.totalToSend !== 1 ? "s" : ""}`
      backBtn.hidden = false
    } catch (err) {
      errorEl.textContent = getErrorMessage(err)
      errorEl.hidden = false
    } finally {
      nextBtn.disabled = false
    }
  } else if (moduleState.step === "preview") {
    const typeInput = document.querySelector(
      'input[name="invite-type"]:checked',
    )
    if (!(typeInput instanceof HTMLInputElement)) return
    const type = typeInput.value
    const customMessage =
      getTextAreaElement("invite-message").value.trim() || null

    nextBtn.disabled = true
    nextBtn.textContent = "Sending..."
    backBtn.disabled = true

    try {
      const data = await api("/api/admin/invite/send", {
        method: "POST",
        body: JSON.stringify({
          guestIds: moduleState.guestIds,
          type,
          customMessage,
        }),
      })
      const result = /** @type {Types.InviteSendResult} */ (data)

      renderInviteResults(result)
      moduleState.step = "results"
      getElement("invite-step-preview").hidden = true
      getElement("invite-step-results").hidden = false
      nextBtn.textContent = "Done"
      backBtn.hidden = true

      await loadGuests()
      await loadStats()
    } catch (err) {
      showError("Failed to send invites: " + getErrorMessage(err))
      nextBtn.disabled = false
      if (moduleState.previewData) {
        nextBtn.textContent = `Send ${moduleState.previewData.totalToSend} Invites`
      }
    } finally {
      backBtn.disabled = false
    }
  } else if (moduleState.step === "results") {
    closeModal(getDialogElement("invite-modal"))
  }
}

/** @type {Types.handleInviteBack} */
function handleInviteBack() {
  if (moduleState.step === "preview") {
    moduleState.step = "config"
    getElement("invite-step-preview").hidden = true
    getElement("invite-step-config").hidden = false
    getButtonElement("invite-next-btn").textContent = "Preview"
    getButtonElement("invite-back-btn").hidden = true
  }
}

/** @type {Types.initInvites} */
export function initInvites() {
  getElement("send-invites-btn").addEventListener("click", openSendInvitesModal)
  getButtonElement("invite-next-btn").addEventListener(
    "click",
    handleInviteNext,
  )
  getButtonElement("invite-back-btn").addEventListener(
    "click",
    handleInviteBack,
  )
}
