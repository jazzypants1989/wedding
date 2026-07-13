/** @file RSVP form - loads guest data, handles submission, pre-fills existing RSVPs */
/** @import * as Types from './types.js' */

import {
  getElement,
  getFormElement,
  getInputElement,
  getSelectElement,
  getTextAreaElement,
  getErrorMessage,
  formatDate,
  api,
} from "../utils.js"
import { fireConfetti, setButtonLoading } from "./utils.js"
import { miniSparkle } from "../../components/celebrate.js"

/** @type {Types.RsvpFormState} */
const state = { inviteCode: null, guestData: null }

/** @type {Types.fetchRsvpData} */
function fetchRsvpData(code) {
  return api(`/api/rsvp/${code}`)
}

/** @type {Types.submitRsvp} */
function submitRsvp(code, payload) {
  return api(`/api/rsvp/${code}`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** @type {Types.showError} */
function showError(message) {
  getElement("rsvp-loading").hidden = true
  getFormElement("rsvp-form").hidden = true
  getElement("rsvp-success").hidden = true
  const errorEl = getElement("rsvp-error")
  errorEl.hidden = false
  getElement("rsvp-error-message").textContent = message
  requestAnimationFrame(() => {
    errorEl.classList.add("form-state-visible")
  })
}

/** @type {Types.showSuccess} */
function showSuccess(message, attending) {
  getElement("rsvp-loading").hidden = true
  getElement("rsvp-error").hidden = true
  getFormElement("rsvp-form").hidden = true
  const successEl = getElement("rsvp-success")
  successEl.hidden = false
  getElement("success-message").textContent = message
  requestAnimationFrame(() => {
    successEl.classList.add("form-state-visible")
    const rect = getElement("main-content").getBoundingClientRect()
    const scrollTarget = window.scrollY + rect.top - 40
    window.scrollTo({ top: Math.max(0, scrollTarget), behavior: "smooth" })
  })

  // Celebrate only a "yes" — a decline gets the same warm thank-you screen but no
  // confetti, which would read as tone-deaf when someone just said they can't come.
  if (attending) fireConfetti()
}

/** @type {Types.prefillForm} */
function prefillForm(rsvp) {
  const form = getFormElement("rsvp-form")
  const attendingValue = rsvp.attending ? "yes" : "no"
  const attendingRadio = form.querySelector(
    `input[name="attending"][value="${attendingValue}"]`,
  )
  if (attendingRadio instanceof HTMLInputElement) {
    attendingRadio.checked = true
  }

  if (rsvp.attending) {
    setAttendingDetailsOpen(true)
    getSelectElement("party-size").value = String(rsvp.actual_party_size || 1)
    getTextAreaElement("dietary").value = rsvp.dietary_restrictions || ""
    getInputElement("anything-else").value = rsvp.additional_info || ""
  }

  getTextAreaElement("message").value = rsvp.message || ""
}

/**
 * Reassure a returning guest that their RSVP is already on file, dated from the
 * last change (updated_at, falling back to submitted_at). Calm, not alarming.
 * @param {Types.ExistingRsvp} rsvp
 */
function showReturnBanner(rsvp) {
  const banner = getElement("rsvp-return-banner")
  const when = formatDate(rsvp.updated_at || rsvp.submitted_at || "")
  banner.textContent = when
    ? `You're all set — last responded ${when}. Need to change anything?`
    : "You're all set — need to change anything?"
  banner.hidden = false
}

/**
 * Wire a live "N/max" counter that mirrors a field's maxlength (matches the
 * guestbook composer + comment thread). Visual aid only (aria-hidden); the
 * maxlength attribute does the real enforcing.
 * @param {HTMLInputElement | HTMLTextAreaElement} field
 * @param {HTMLElement} counter
 * @param {number} max
 */
function wireCounter(field, counter, max) {
  const update = () => {
    counter.textContent = `${field.value.length}/${max}`
  }
  field.addEventListener("input", update)
  update()
}

/**
 * Open/close the attending-details group. `inert` (not `hidden`, which would
 * kill the collapse animation) keeps keyboard + screen-reader users out of the
 * visually-collapsed fields. @param {boolean} isOpen
 */
function setAttendingDetailsOpen(isOpen) {
  const attendingDetails = getElement("attending-details")
  attendingDetails.classList.toggle("attending-details-open", isOpen)
  attendingDetails.inert = !isOpen
  getSelectElement("party-size").required = isOpen
}

/** @type {Types.setupFormListeners} */
function setupFormListeners() {
  const form = getFormElement("rsvp-form")

  // Collapsed by default until the guest picks "yes" (or a prefill opened it).
  if (!getElement("attending-details").classList.contains("attending-details-open")) {
    setAttendingDetailsOpen(false)
  }

  form.querySelectorAll('input[name="attending"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target instanceof HTMLInputElement) {
        const isAttending = e.target.value === "yes"
        setAttendingDetailsOpen(isAttending)
        if (isAttending) {
          // Centre the sparkle burst on the radio card, matching prior behaviour.
          const card = e.target.closest(".radio-card")
          miniSparkle(card instanceof HTMLElement ? card : e.target)
        }
      }
    })
  })

  form.addEventListener("submit", handleSubmit)
}

/** @type {Types.handleSubmit} */
async function handleSubmit(e) {
  e.preventDefault()

  const form = getFormElement("rsvp-form")
  const submitBtn = form.querySelector('button[type="submit"]')
  if (!(submitBtn instanceof HTMLButtonElement)) return

  if (submitBtn.disabled) return

  setButtonLoading(submitBtn, true)
  const formError = getElement("form-error")
  formError.hidden = true

  const formData = new FormData(form)
  const attending = formData.get("attending") === "yes"

  if (!state.inviteCode) return

  // Attending-only details: a guest who filled these then switched to "can't
  // make it" must not send dietary/accommodation notes attached to a decline
  // (the fields only visually collapse; their values stay in the DOM).
  /** @type {Types.RsvpSubmitPayload} */
  const payload = {
    attending,
    actual_party_size: attending
      ? parseInt(String(formData.get("actual_party_size")), 10)
      : null,
    dietary_restrictions:
      attending && formData.get("dietary_restrictions")
        ? String(formData.get("dietary_restrictions"))
        : null,
    additional_info:
      attending && formData.get("additional_info")
        ? String(formData.get("additional_info"))
        : null,
    message: formData.get("message") ? String(formData.get("message")) : null,
  }

  try {
    const data = await submitRsvp(state.inviteCode, payload)
    showSuccess(data.message, attending)
  } catch (err) {
    formError.textContent = getErrorMessage(err)
    formError.hidden = false
    formError.classList.add("form-error-shake")
    formError.addEventListener(
      "animationend",
      () => formError.classList.remove("form-error-shake"),
      { once: true },
    )
    setButtonLoading(submitBtn, false)
  }
}

/** @type {Types.showForm} */
function showForm(data) {
  getElement("rsvp-loading").hidden = true
  getElement("rsvp-error").hidden = true
  getElement("rsvp-success").hidden = true
  const form = getFormElement("rsvp-form")
  form.hidden = false
  requestAnimationFrame(() => {
    form.classList.add("form-state-visible")
  })

  getElement("guest-name").textContent = data.guest.name

  const partySize = getSelectElement("party-size")
  partySize.innerHTML = ""
  for (let i = 1; i <= data.guest.party_size; i++) {
    const option = document.createElement("option")
    option.value = String(i)
    option.textContent = i === 1 ? "1 (just me)" : `${i} guests`
    partySize.appendChild(option)
  }
  // A solo guest gets a no-op single-option dropdown; hide its group (the select
  // keeps value "1" so actual_party_size still submits correctly).
  const partyGroup = partySize.closest(".form-group")
  if (partyGroup instanceof HTMLElement) {
    partyGroup.hidden = data.guest.party_size === 1
  }

  if (data.rsvp) {
    prefillForm(data.rsvp)
    showReturnBanner(data.rsvp)
  }

  // Live character counters — wired after any prefill so they reflect the
  // pre-filled text on load, and mirror the maxlength set in the markup.
  wireCounter(getTextAreaElement("dietary"), getElement("dietary-counter"), 500)
  wireCounter(getInputElement("anything-else"), getElement("anything-else-counter"), 500)
  wireCounter(getTextAreaElement("message"), getElement("message-counter"), 1000)

  setupFormListeners()
}

/** Show the post-wedding "RSVPs are closed" panel instead of the live form. */
function showClosed() {
  getElement("rsvp-loading").hidden = true
  getElement("rsvp-error").hidden = true
  getFormElement("rsvp-form").hidden = true
  const el = getElement("rsvp-closed")
  el.hidden = false
  requestAnimationFrame(() => el.classList.add("form-state-visible"))
}

/** @type {Types.initRsvpForm} */
export async function initRsvpForm() {
  // Post-wedding: RSVPs are closed. Show a warm closed state (with links to the
  // gallery/guestbook) rather than a live, confetti-firing form on stale links.
  try {
    const cfg = /** @type {{ mode?: string }} */ (await api("/api/config"))
    if (cfg && cfg.mode === "post") {
      showClosed()
      return
    }
  } catch {
    // Config unavailable — fall through to the normal form (fail open).
  }

  const params = new URLSearchParams(window.location.search)
  state.inviteCode = params.get("code")

  if (!state.inviteCode) {
    showError(
      "No invite code provided. Please use the link from your invitation.",
    )
    return
  }

  try {
    const data = await fetchRsvpData(state.inviteCode)
    state.guestData = data
    // Remember a valid invite code so the guest auth sheet on /guestbook and
    // /gallery can prefill it — a household code means a trusted account is one
    // tap away instead of a re-typed string.
    try {
      localStorage.setItem("rsvpCode", state.inviteCode)
    } catch {
      // localStorage unavailable (private mode / disabled) — prefill is a nicety.
    }
    showForm(data)
  } catch (err) {
    showError(getErrorMessage(err))
  }
}
