/** @file Guest invitation lookup form module */
/** @import * as Types from './types.js' */

import { apiRequest, getErrorMessage } from "./fetch-helper.js"
import {
  getElement,
  getInputElement,
  getButtonElement,
  getFormElement,
  detectContactType,
} from "../utils.js"

/** @type {Types.LookupFormState | null} */
let state = null

/** @type {Types.lookupGuest} */
async function lookupGuest(name, contact) {
  const contactType = detectContactType(contact)
  const payload = { name, [contactType]: contact }
  return apiRequest("/api/lookup", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** @type {Types.showLookupResult} */
function showLookupResult(message, isError = false) {
  if (!state) return
  state.elements.result.textContent = message
  state.elements.result.hidden = false
  state.elements.result.classList.toggle("lookup-result--error", isError)
  state.elements.result.classList.toggle("lookup-result--success", !isError)
}

/** @type {Types.handleLookupSubmit} */
async function handleLookupSubmit(e) {
  e.preventDefault()
  if (!state) return

  const { elements, onShowPetitionForm } = state
  if (elements.submit.disabled) return

  const name = elements.name.value.trim()
  const contact = elements.contact.value.trim()
  if (!name || !contact) return

  elements.submit.disabled = true
  elements.submit.textContent = "Searching..."
  elements.result.hidden = true

  try {
    const { ok, data } = await lookupGuest(name, contact)

    if (!ok) {
      showLookupResult(getErrorMessage(data), true)
      return
    }

    if (data.canPetition && !data.found) {
      showLookupResult(data.message, false)
      if (onShowPetitionForm) {
        onShowPetitionForm(name, contact)
      }
      return
    }

    if (data.found && data.sent) {
      showLookupResult(data.message, false)
      return
    }

    if (data.found && !data.sent) {
      showLookupResult(data.message, true)
      return
    }

    showLookupResult(
      data.message || "Please check your email or phone for your invite link.",
      false,
    )
  } catch (err) {
    console.error("Lookup error:", err)
    showLookupResult(getErrorMessage(err), true)
  } finally {
    if (state) {
      state.elements.submit.disabled = false
      state.elements.submit.textContent = "Find My Invitation"
    }
  }
}

/** @type {Types.hideLookupSection} */
export function hideLookupSection() {
  if (state) {
    state.elements.section.hidden = true
  }
}

/** @type {Types.initLookupForm} */
export function initLookupForm(onShowPetitionForm) {
  state = {
    elements: {
      result: getElement("lookup-result"),
      name: getInputElement("lookup-name"),
      contact: getInputElement("lookup-contact"),
      submit: getButtonElement("lookup-submit"),
      section: getElement("rsvp-lookup"),
    },
    onShowPetitionForm: onShowPetitionForm || null,
  }

  getFormElement("lookup-form").addEventListener("submit", handleLookupSubmit)
}
