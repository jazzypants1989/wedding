/** @file Petition form module */
/** @import * as Types from './types.js' */

import {
  getElement,
  getInputElement,
  getButtonElement,
  getFormElement,
  getTextAreaElement,
  detectContactType,
  getErrorMessage,
  api,
} from "../utils.js"
import { hideLookupSection } from "./lookup-form.js"
import { showResult, setButtonLoading } from "./utils.js"

/** @type {Types.submitPetition} */
async function submitPetition(payload) {
  return api("/api/petition", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** @type {Types.showPetitionResult} */
function showPetitionResult(message, isError = false) {
  showResult(
    getElement("petition-result"),
    message,
    isError,
    "alert-error",
    "alert-success",
    "petition-result-shake",
  )
}

/** @type {Types.showPetitionForm} */
export function showPetitionForm(prefillName, prefillContact) {
  const sectionEl = document.getElementById("rsvp-petition")
  if (!sectionEl) return

  hideLookupSection()
  sectionEl.hidden = false
  requestAnimationFrame(() => {
    sectionEl.classList.add("form-state-visible")
  })

  if (prefillName) {
    getInputElement("petition-name").value = prefillName
  }
  if (prefillContact) {
    const contactType = detectContactType(prefillContact)
    if (contactType === "email") {
      getInputElement("petition-email").value = prefillContact
    } else if (contactType === "phone") {
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

  setButtonLoading(submitEl, true)
  getElement("petition-result").hidden = true

  /** @type {Types.PetitionPayload} */
  const payload = { name, email }
  if (phone) payload.phone = phone
  if (relationship) payload.relationship = relationship
  if (message) payload.message = message

  try {
    const data = await submitPetition(payload)
    getFormElement("petition-form").hidden = true
    showPetitionResult(data.message, false)
  } catch (err) {
    console.error("Petition error:", err)
    showPetitionResult(getErrorMessage(err), true)
    setButtonLoading(submitEl, false)
  }
}

/** @type {Types.initPetitionForm} */
export function initPetitionForm() {
  getFormElement("petition-form").addEventListener(
    "submit",
    handlePetitionSubmit,
  )
}
