/** @file RSVP form - loads guest data, handles submission, pre-fills existing RSVPs */
/** @import * as Types from './types.js' */

import {
  getElement,
  getFormElement,
  getSelectElement,
  getInputElement,
  getTextAreaElement,
} from "../utils.js"
import { apiRequest, getErrorMessage } from "./fetch-helper.js"

/** @type {Types.RsvpFormState} */
const state = { inviteCode: null, guestData: null }

/** @type {Types.fetchRsvpData} */
function fetchRsvpData(code) {
  return apiRequest(`/api/rsvp/${code}`)
}

/** @type {Types.submitRsvp} */
function submitRsvp(code, payload) {
  return apiRequest(`/api/rsvp/${code}`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** @type {Types.showError} */
function showError(message) {
  getElement("rsvp-loading").hidden = true
  getFormElement("rsvp-form").hidden = true
  getElement("rsvp-success").hidden = true
  getElement("rsvp-error").hidden = false
  getElement("rsvp-error-message").textContent = message
}

/** @type {Types.showSuccess} */
function showSuccess(message) {
  getElement("rsvp-loading").hidden = true
  getElement("rsvp-error").hidden = true
  getFormElement("rsvp-form").hidden = true
  getElement("rsvp-success").hidden = false
  getElement("success-message").textContent = message
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
    getElement("attending-details").hidden = false
    getSelectElement("party-size").value = String(rsvp.actual_party_size || 1)
    getTextAreaElement("dietary").value = rsvp.dietary_restrictions || ""
    getInputElement("song").value = rsvp.song_request || ""
  }

  getTextAreaElement("message").value = rsvp.message || ""
}

/** @type {Types.updateRadioStyles} */
function updateRadioStyles() {
  const form = getFormElement("rsvp-form")
  form.querySelectorAll(".radio-label").forEach((label) => {
    const input = label.querySelector('input[type="radio"]')
    if (input instanceof HTMLInputElement) {
      label.classList.toggle("radio-label--checked", input.checked)
    }
  })
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
        attendingDetails.hidden = !isAttending
        partySize.required = isAttending
        updateRadioStyles()
      }
    })
  })

  updateRadioStyles()
  form.addEventListener("submit", handleSubmit)
}

/** @type {Types.handleSubmit} */
async function handleSubmit(e) {
  e.preventDefault()

  const form = getFormElement("rsvp-form")
  const submitBtn = form.querySelector('button[type="submit"]')
  if (!(submitBtn instanceof HTMLButtonElement)) return

  if (submitBtn.disabled) return

  submitBtn.disabled = true
  const originalText = submitBtn.textContent
  submitBtn.textContent = "Submitting..."
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
    song_request: formData.get("song_request")
      ? String(formData.get("song_request"))
      : null,
    message: formData.get("message") ? String(formData.get("message")) : null,
  }

  try {
    const { ok, data } = await submitRsvp(state.inviteCode, payload)

    if (!ok) {
      throw new Error(data.message)
    }

    showSuccess(data.message)
  } catch (err) {
    formError.textContent = getErrorMessage(err)
    formError.hidden = false
    submitBtn.disabled = false
    submitBtn.textContent = originalText
  }
}

/** @type {Types.showForm} */
function showForm(data) {
  getElement("rsvp-loading").hidden = true
  getElement("rsvp-error").hidden = true
  getElement("rsvp-success").hidden = true
  const form = getFormElement("rsvp-form")
  form.hidden = false

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
    const { ok, data } = await fetchRsvpData(state.inviteCode)

    if (!ok) {
      showError(
        "Unable to load your invitation. Please check your link and try again.",
      )
      return
    }

    state.guestData = data
    showForm(data)
  } catch (err) {
    showError(getErrorMessage(err))
  }
}
