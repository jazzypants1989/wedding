/** @file The invite dialog (dialog routes /admin/guests/invite,
 *  /admin/guests/g12/invite and /admin/guests/invite/sent). Three steps —
 *  how to send, a preview, the results — and sending REPLACES the URL with
 *  …/sent, so Back can never land on a live Send button (IA §4). The router
 *  opens and closes the dialog; this module fills it. */
/** @import * as Types from './types.js' */

import { loadGuests } from "./guests.js"
import { api, closeModal } from "./utils.js"
import { navigate } from "./router.js"
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

/** The last send's results, for the …/sent step. */
/** @type {Types.InviteSendResult | null} */
let lastResult = null

/** @type {Types.updateInviteConfigUI} */
function updateInviteConfigUI() {
  if (!moduleState.config) return
  applyChannelStatus("email-status", moduleState.config.email.configured, "email")
  applyChannelStatus("sms-status", moduleState.config.sms.configured, "sms")
  // Open on a channel that works; email when neither does (Preview explains).
  const emailRadio = channelRadio("email")
  const smsRadio = channelRadio("sms")
  if (emailRadio && smsRadio) {
    if (emailRadio.disabled && !smsRadio.disabled) smsRadio.checked = true
    else emailRadio.checked = true
  }
  updateDefaultPreview()
}

/** A channel's status beside its radio; an unconfigured one can't be picked.
 *  @param {string} statusId @param {boolean} configured @param {string} channel */
function applyChannelStatus(statusId, configured, channel) {
  getElement(statusId).textContent = configured ? "" : "— not set up on the server"
  const radio = channelRadio(channel)
  if (radio) radio.disabled = !configured
}

/** @param {string} value @returns {HTMLInputElement | null} */
function channelRadio(value) {
  const el = document.querySelector(`input[name="invite-type"][value="${value}"]`)
  return el instanceof HTMLInputElement ? el : null
}

/** @returns {string} the selected channel. */
function selectedChannel() {
  const checked = document.querySelector('input[name="invite-type"]:checked')
  return checked instanceof HTMLInputElement ? checked.value : "email"
}

/** What "leave blank" actually sends, for the selected channel. */
function updateDefaultPreview() {
  const preview = getElement("invite-default-preview")
  const c = moduleState.config
  preview.textContent = !c
    ? ""
    : selectedChannel() === "sms"
      ? c.sms.defaultMessage
      : c.email.defaultMessage
}

/** @param {"config" | "preview" | "results"} step */
function showStep(step) {
  moduleState.step = step
  getElement("invite-step-config").hidden = step !== "config"
  getElement("invite-step-preview").hidden = step !== "preview"
  getElement("invite-step-results").hidden = step !== "results"
  getElement("invite-recipients-summary").hidden = step === "results"
  const next = getButtonElement("invite-next-btn")
  const back = getButtonElement("invite-back-btn")
  const cancel = getButtonElement("invite-cancel-btn")
  back.hidden = step !== "preview"
  cancel.hidden = step === "results"
  next.disabled = false
  if (step === "config") next.textContent = "Preview"
  else if (step === "preview") {
    const n = moduleState.previewData?.totalToSend ?? 0
    next.textContent = `Send ${n} invite${n === 1 ? "" : "s"}`
    next.disabled = n === 0
  } else next.textContent = "Done"
}

/** @type {Types.renderInvitePreview} */
function renderInvitePreview() {
  const p = moduleState.previewData
  if (!p) return
  getElement("invite-preview-content").innerHTML = html`
    ${p.skipped.length > 0
      ? html`<div class="status-note">
          <strong>${p.skipped.length} will be skipped:</strong>
          <ul class="invite-list">
            ${p.skipped.map((s) => html`<li>${s.name || `Guest ${s.id}`} — ${s.reason}</li>`)}
          </ul>
        </div>`
      : ""}
    <p class="invite-label">${p.recipients.length} ${p.recipients.length === 1 ? "message" : "messages"}</p>
    <ul class="invite-previews">
      ${p.recipients.slice(0, 5).map(
        (r) => html`<li>
          <span class="invite-to"><strong>${r.name}</strong> <span class="muted">${r.contact}</span></span>
          <span class="invite-msg">${r.messagePreview}</span>
        </li>`,
      )}
      ${p.recipients.length > 5
        ? html`<li class="muted small">…and ${p.recipients.length - 5} more like these</li>`
        : ""}
    </ul>
  `
}

/** @type {Types.renderInviteResults} */
function renderInviteResults(result) {
  const { sent, failed, skipped } = result.summary
  getElement("invite-results-content").innerHTML = html`
    <div class="done-state invite-done">
      <span class="done-icon"
        ><svg class="icon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 10l4 4 8-8" /></svg
      ></span>
      <h3>${sent} ${sent === 1 ? "invite" : "invites"} sent</h3>
      <p class="muted">
        ${failed ? `${failed} failed` : "None failed"}${skipped ? ` · ${skipped} skipped` : ""}.
      </p>
    </div>
    ${result.results.failed.length > 0
      ? html`<p class="invite-label">Didn't go</p>
          <ul class="invite-list is-error">
            ${result.results.failed.map((f) => html`<li><strong>${f.name}</strong> — ${f.error}</li>`)}
          </ul>`
      : ""}
    ${result.results.skipped.length > 0
      ? html`<p class="invite-label">Skipped</p>
          <ul class="invite-list">
            ${result.results.skipped.map(
              (s) => html`<li><strong>${s.name || `Guest ${s.id}`}</strong> — ${s.reason}</li>`,
            )}
          </ul>`
      : ""}
  `
}

/** The invitable audience for a list filter + search.
 *  @param {Types.GuestFilter} filter @param {string} q */
async function invitableFor(filter, q) {
  // Coming / Can't come / Archived hold nobody who can be invited.
  if (filter === "yes" || filter === "no" || filter === "archived") {
    return { guestIds: [], pending: 0, invited: 0 }
  }
  const params = new URLSearchParams()
  if (q) params.set("search", q)
  return /** @type {Types.InvitableIdsResponse} */ (
    await api(`/api/admin/guests/invitable-ids?${params}`)
  )
}

/** Fill the dialog for this arrival. @type {Types.mountInvite} */
export async function mountInvite(opts) {
  getElement("invite-config-error").hidden = true
  if (opts.kind === "sent") {
    getElement("invite-modal-title").textContent = "Invites sent"
    if (lastResult) renderInviteResults(lastResult)
    else {
      getElement("invite-results-content").innerHTML = html`<div class="done-state invite-done">
        <h3>That batch has gone out</h3>
        <p class="muted">Each guest's page shows when they were last invited.</p>
      </div>`
    }
    showStep("results")
    return
  }

  lastResult = null
  getTextAreaElement("invite-message").value = ""
  showStep("config")
  const summary = getElement("invite-recipients-summary")
  summary.innerHTML = html`<p class="muted">Finding who to invite…</p>`
  getButtonElement("invite-next-btn").disabled = true

  try {
    const [config, audience] = await Promise.all([
      /** @type {Promise<Types.InviteConfig>} */ (api("/api/admin/invite/config")),
      opts.kind === "one"
        ? Promise.resolve({ guestIds: [opts.id], pending: 0, invited: 0 })
        : invitableFor(opts.filter, opts.q),
    ])
    moduleState.config = config
    moduleState.guestIds = audience.guestIds
    updateInviteConfigUI()
    if (opts.kind === "one") {
      getElement("invite-modal-title").textContent = `Invite ${opts.name}`
      summary.innerHTML = html`<p>Sends <strong>${opts.name}</strong> their invitation and RSVP link.</p>`
    } else {
      const n = audience.guestIds.length
      getElement("invite-modal-title").textContent = "Send invites"
      summary.innerHTML =
        n === 0
          ? html`<p class="status-note">
              Nobody in this list can be invited — everyone has replied or is archived.
            </p>`
          : html`<p>
                Invites <strong>${n} ${n === 1 ? "guest" : "guests"}</strong> who haven't
                replied${opts.q ? html` and match “${opts.q}”` : ""}.
              </p>
              <p class="muted small">
                ${audience.pending} not invited yet · ${audience.invited} invited before, no reply
              </p>`
    }
    getButtonElement("invite-next-btn").disabled = moduleState.guestIds.length === 0
  } catch (err) {
    summary.innerHTML = ""
    const el = getElement("invite-config-error")
    el.textContent = "Couldn't get ready to send: " + getErrorMessage(err)
    el.hidden = false
  }
}

/** @type {Types.handleInviteNext} */
async function handleInviteNext() {
  const errorEl = getElement("invite-config-error")
  const nextBtn = getButtonElement("invite-next-btn")
  const backBtn = getButtonElement("invite-back-btn")
  errorEl.hidden = true
  const type = selectedChannel()
  const customMessage = getTextAreaElement("invite-message").value.trim() || null

  if (moduleState.step === "config") {
    const c = moduleState.config
    if (type === "email" && c && !c.email.configured) {
      errorEl.textContent =
        "Email isn't set up yet — whoever runs the server needs to add the email key " +
        "(RESEND_API_KEY). “Text invites by hand” works without it."
      errorEl.hidden = false
      return
    }
    if (type === "sms" && c && !c.sms.configured) {
      errorEl.textContent =
        "Texting isn't set up yet — whoever runs the server needs to add the Twilio keys. " +
        "“Text invites by hand” works without them."
      errorEl.hidden = false
      return
    }
    nextBtn.disabled = true
    nextBtn.textContent = "Loading…"
    try {
      moduleState.previewData = /** @type {Types.InvitePreviewData} */ (
        await api("/api/admin/invite/preview", {
          method: "POST",
          body: JSON.stringify({ guestIds: moduleState.guestIds, type, customMessage }),
        })
      )
      renderInvitePreview()
      showStep("preview")
    } catch (err) {
      errorEl.textContent = getErrorMessage(err)
      errorEl.hidden = false
      showStep("config")
    }
  } else if (moduleState.step === "preview") {
    nextBtn.disabled = true
    nextBtn.textContent = "Sending…"
    backBtn.disabled = true
    try {
      lastResult = /** @type {Types.InviteSendResult} */ (
        await api("/api/admin/invite/send", {
          method: "POST",
          body: JSON.stringify({ guestIds: moduleState.guestIds, type, customMessage }),
        })
      )
      void loadGuests()
      // The results replace the send step in history.
      void navigate("/admin/guests/invite/sent", { replace: true })
    } catch (err) {
      const el = getElement("invite-preview-content")
      el.insertAdjacentHTML(
        "afterbegin",
        html`<p class="status-note is-error" role="alert">
          Couldn't send: ${getErrorMessage(err)}
        </p>`,
      )
      showStep("preview")
    } finally {
      backBtn.disabled = false
    }
  } else {
    closeModal(getDialogElement("invite-modal"))
  }
}

/** @type {Types.handleInviteBack} */
function handleInviteBack() {
  if (moduleState.step === "preview") showStep("config")
}

/** @type {Types.initInvites} */
export function initInvites() {
  getButtonElement("invite-next-btn").addEventListener("click", handleInviteNext)
  getButtonElement("invite-back-btn").addEventListener("click", handleInviteBack)
  document.querySelectorAll('input[name="invite-type"]').forEach((radio) => {
    radio.addEventListener("change", updateDefaultPreview)
  })
}
