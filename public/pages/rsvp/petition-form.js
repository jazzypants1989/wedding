/** @file Petition form module */
/** @import * as Types from './types.js' */

import { hideLookupSection } from "./lookup-form.js"
import { apiRequest, getErrorMessage } from "./fetch-helper.js"
import {
  getElement,
  getInputElement,
  getButtonElement,
  getFormElement,
  getTextAreaElement,
  detectContactType,
} from "../utils.js"

/** @type {Types.submitPetition} */
async function submitPetition(payload) {
  return apiRequest("/api/petition", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** @type {Types.showPetitionResult} */
function showPetitionResult(message, isError = false) {
  const resultEl = getElement("petition-result")
  resultEl.textContent = message
  resultEl.hidden = false
  resultEl.classList.toggle("petition-result--error", isError)
  resultEl.classList.toggle("petition-result--success", !isError)
}

/** @type {Types.showPetitionForm} */
export function showPetitionForm(prefillName, prefillContact) {
  const sectionEl = document.getElementById("rsvp-petition")
  if (!sectionEl) return

  hideLookupSection()
  sectionEl.hidden = false

  if (prefillName) {
    getInputElement("petition-name").value = prefillName
  }
  if (prefillContact) {
    const contactType = detectContactType(prefillContact)
    if (contactType === "email") {
      getInputElement("petition-email").value = prefillContact
    } else {
      getInputElement("petition-phone").value = prefillContact
    }
  }
}

/** @type {Types.handlePetitionSubmit} */
async function handlePetitionSubmit(e) {
  e.preventDefault()

  const submitEl = getButtonElement("petition-submit")
  if (submitEl.disabled) return

  const name = getInputElement("petition-name").value.trim()
  const email = getInputElement("petition-email").value.trim()
  const phone = getInputElement("petition-phone").value.trim()
  const relationship = getInputElement("petition-relationship").value.trim()
  const message = getTextAreaElement("petition-message").value.trim()

  if (!name || !email) {
    showPetitionResult("Name and email are required.", true)
    return
  }

  submitEl.disabled = true
  submitEl.textContent = "Submitting..."
  getElement("petition-result").hidden = true

  /** @type {Types.PetitionPayload} */
  const payload = { name, email }
  if (phone) payload.phone = phone
  if (relationship) payload.relationship = relationship
  if (message) payload.message = message

  try {
    const { ok, data } = await submitPetition(payload)

    if (!ok) {
      showPetitionResult(getErrorMessage(data), true)
      submitEl.disabled = false
      submitEl.textContent = "Submit Request"
      return
    }

    getFormElement("petition-form").hidden = true
    showPetitionResult(data.message, false)
  } catch (err) {
    console.error("Petition error:", err)
    showPetitionResult(getErrorMessage(err), true)
    submitEl.disabled = false
    submitEl.textContent = "Submit Request"
  }
}

/** @type {Types.initPetitionForm} */
export function initPetitionForm() {
  getFormElement("petition-form").addEventListener(
    "submit",
    handlePetitionSubmit,
  )
}
