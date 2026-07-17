/** @file Invite wizard module */
/** @import * as Types from './types.js' */

import { loadGuests, loadStats } from "./guests.js"
import { api, openModal, closeModal, showError } from "./utils.js"
import {
  html,
  getElement,
  getInputElement,
  getSelectElement,
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

  applyChannelStatus("email-status", moduleState.config.email.configured, "email")
  applyChannelStatus("sms-status", moduleState.config.sms.configured, "sms")
  // Pick the first configured channel so the composer doesn't open on a disabled
  // radio; fall back to email if neither is configured (its Preview still warns).
  const emailRadio = channelRadio("email")
  const smsRadio = channelRadio("sms")
  if (emailRadio && smsRadio && emailRadio.disabled && !smsRadio.disabled) {
    smsRadio.checked = true
  }
  updateDefaultPreview()
}

/**
 * Reflect a channel's configured state in its status label and disable its radio
 * when unconfigured (was: selectable, erroring only at Preview).
 * @param {string} statusId @param {boolean} configured @param {string} channel
 */
function applyChannelStatus(statusId, configured, channel) {
  const status = getElement(statusId)
  status.textContent = configured ? "(configured)" : "(not configured)"
  status.classList.toggle("text-success", configured)
  status.classList.toggle("text-danger", !configured)
  const radio = channelRadio(channel)
  if (radio) radio.disabled = !configured
}

/** @param {string} value @returns {HTMLInputElement | null} */
function channelRadio(value) {
  const el = document.querySelector(`input[name="invite-type"][value="${value}"]`)
  return el instanceof HTMLInputElement ? el : null
}

/** @returns {string} the currently selected invite channel. */
function selectedChannel() {
  const checked = document.querySelector('input[name="invite-type"]:checked')
  return checked instanceof HTMLInputElement ? checked.value : "email"
}

/** Show the default message for the selected channel so the couple sees what
 *  "leave blank" actually sends. */
function updateDefaultPreview() {
  const preview = getElement("invite-default-preview")
  if (!moduleState.config) {
    preview.textContent = ""
    return
  }
  const channel = selectedChannel()
  preview.textContent =
    channel === "sms"
      ? moduleState.config.sms.defaultMessage
      : moduleState.config.email.defaultMessage
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
            <div class="preview-message">${r.messagePreview}</div>
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
  // The recipient set must be the TRUE invitable audience for the current
  // filter/search — every not-yet-responded guest, not just the visible page.
  // Ask the server for the full id set matching the same status + search the
  // guest table is showing.
  const search = getInputElement("guest-search").value.trim()
  const status = getSelectElement("guest-status-filter").value
  const params = new URLSearchParams()
  if (search) params.set("search", search)
  if (status) params.set("status", status)

  /** @type {Types.InvitableIdsResponse} */
  let invitable
  try {
    invitable = /** @type {Types.InvitableIdsResponse} */ (
      await api(`/api/admin/guests/invitable-ids?${params}`)
    )
  } catch (err) {
    showError("Failed to load invitable guests: " + getErrorMessage(err))
    return
  }

  if (invitable.guestIds.length === 0) {
    showError(
      "No guests available to invite. All guests have either responded or are archived.",
    )
    return
  }

  // Spell out the active filter/search so the count is never a mystery.
  const filterNotes = []
  if (status) filterNotes.push(`status "${status}"`)
  if (search) filterNotes.push(`search "${search}"`)
  const filterText = filterNotes.length
    ? ` matching ${filterNotes.join(" and ")}`
    : ""
  const count = invitable.guestIds.length

  const summary = html`
    <p>
      Will invite all <strong>${count}</strong> guest${count !== 1 ? "s" : ""}
      who haven't responded yet${filterText}.
    </p>
    <small class="text-muted"
      >${invitable.pending} pending, ${invitable.invited} previously invited (not
      yet responded)</small
    >
  `

  await prepareInviteModal(invitable.guestIds, summary)
}

/**
 * Invite one specific guest from the roster (no need to pre-filter the search
 * box to a single person). @param {number} id @param {string} name
 */
export async function openSendInvitesForGuest(id, name) {
  await prepareInviteModal(
    [id],
    html`<p>Will invite <strong>${name}</strong>.</p>`,
  )
}

/**
 * Load config, reset the wizard to its config step, and open the modal for a
 * given recipient set + summary. Shared by the bulk and single-guest entry points.
 * @param {number[]} guestIds @param {string} summaryHtml
 */
async function prepareInviteModal(guestIds, summaryHtml) {
  moduleState.guestIds = guestIds

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

  getElement("invite-recipients-summary").innerHTML = summaryHtml

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
        "Email sending isn't set up yet — whoever runs the server needs to add the email service key (RESEND_API_KEY). You can use manual SMS in the meantime."
      errorEl.hidden = false
      return
    }

    if (
      type === "sms" &&
      moduleState.config &&
      !moduleState.config.sms.configured
    ) {
      errorEl.textContent =
        "Text messaging isn't set up yet — whoever runs the server needs to add the Twilio credentials. The Manual SMS tab works without them."
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
  // Keep the default-message preview in sync with the selected channel.
  document.querySelectorAll('input[name="invite-type"]').forEach((radio) => {
    radio.addEventListener("change", updateDefaultPreview)
  })
}
