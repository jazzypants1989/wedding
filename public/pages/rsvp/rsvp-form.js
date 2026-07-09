/** @file RSVP form - loads guest data, handles submission, pre-fills existing RSVPs */
/** @import * as Types from './types.js' */

import {
  getElement,
  getFormElement,
  getSelectElement,
  getTextAreaElement,
  getErrorMessage,
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
function showSuccess(message) {
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

  fireConfetti()
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
    getElement("attending-details").classList.add("attending-details-open")
    getSelectElement("party-size").value = String(rsvp.actual_party_size || 1)
    getTextAreaElement("dietary").value = rsvp.dietary_restrictions || ""
  }

  getTextAreaElement("message").value = rsvp.message || ""
}

/** @type {Types.setupFormListeners} */
function setupFormListeners() {
  const form = getFormElement("rsvp-form")
  const attendingDetails = getElement("attending-details")
  const partySize = getSelectElement("party-size")

  form.querySelectorAll('input[name="attending"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target instanceof HTMLInputElement) {
        const isAttending = e.target.value === "yes"
        attendingDetails.classList.toggle("attending-details-open", isAttending)
        partySize.required = isAttending
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

  /** @type {Types.RsvpSubmitPayload} */
  const payload = {
    attending,
    actual_party_size: attending
      ? parseInt(String(formData.get("actual_party_size")), 10)
      : null,
    dietary_restrictions: formData.get("dietary_restrictions")
      ? String(formData.get("dietary_restrictions"))
      : null,
    message: formData.get("message") ? String(formData.get("message")) : null,
  }

  try {
    const data = await submitRsvp(state.inviteCode, payload)
    showSuccess(data.message)
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

  if (data.rsvp) {
    prefillForm(data.rsvp)
  }

  setupFormListeners()
}

/** @type {Types.initRsvpForm} */
export async function initRsvpForm() {
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
