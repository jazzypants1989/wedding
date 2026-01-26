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
import { fireConfetti } from "./confetti.js"

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
  const errorEl = getElement("rsvp-error")
  errorEl.hidden = false
  getElement("rsvp-error-message").textContent = message
  requestAnimationFrame(() => {
    errorEl.classList.add("form-state--visible")
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
    successEl.classList.add("form-state--visible")
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
    getElement("attending-details").classList.add("attending-details--open")
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
        attendingDetails.classList.toggle("attending-details--open", isAttending)
        partySize.required = isAttending
        updateRadioStyles()
        if (isAttending) {
          miniSparkle(e.target)
        }
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
  submitBtn.classList.add("btn--loading")
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
    formError.classList.add("form-error--shake")
    formError.addEventListener(
      "animationend",
      () => formError.classList.remove("form-error--shake"),
      { once: true },
    )
    submitBtn.disabled = false
    submitBtn.classList.remove("btn--loading")
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
    form.classList.add("form-state--visible")
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

/** Burst small sparkle dots around a radio button on "Yes" selection */
function miniSparkle(element) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  const label = element.closest(".radio-label")
  if (!label) return
  const rect = label.getBoundingClientRect()
  const count = 6

  for (let i = 0; i < count; i++) {
    const dot = document.createElement("div")
    dot.className = "mini-sparkle"

    const angle = (i / count) * 360
    const rad = (angle * Math.PI) / 180
    const dist = 20 + Math.random() * 30

    dot.style.left = rect.left + rect.width / 2 + "px"
    dot.style.top = rect.top + rect.height / 2 + "px"
    dot.style.setProperty("--sparkle-tx", Math.cos(rad) * dist + "px")
    dot.style.setProperty("--sparkle-ty", Math.sin(rad) * dist + "px")

    dot.addEventListener("animationend", () => dot.remove())
    document.body.appendChild(dot)
  }
}
