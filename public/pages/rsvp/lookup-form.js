/** @file Guest invitation lookup form module */
/** @import * as Types from './types.js' */

import {
  getElement,
  getInputElement,
  getButtonElement,
  getFormElement,
  detectContactType,
  getErrorMessage,
  api,
} from "../utils.js"
import { showResult, setButtonLoading } from "./utils.js"

/** @type {Types.LookupFormState | null} */
let state = null

/** @type {Types.lookupGuest} */
async function lookupGuest(name, contact) {
  const contactType = detectContactType(contact)
  /** @type {Record<string, string>} */
  const payload = { [contactType]: contact }
  if (name) payload.name = name
  return api("/api/lookup", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** @type {Types.showLookupResult} */
function showLookupResult(message, isError = false) {
  if (!state) return
  showResult(
    state.elements.result,
    message,
    isError,
    "alert-error",
    "alert-success",
    "lookup-result-shake",
  )
}

/** @type {Types.handleLookupSubmit} */
async function handleLookupSubmit(e) {
  e.preventDefault()
  if (!state) return

  const { elements, onShowPetitionForm } = state
  if (elements.submit.disabled) return

  const name = elements.name.value.trim() || null
  const contact = elements.contact.value.trim()
  if (!contact) return
  if (!name && !elements.nameGroup.hidden) return

  const contactType = detectContactType(contact)
  const phoneOnly = elements.contact.type === "tel"
  if (contactType === "unknown" || (phoneOnly && contactType !== "phone")) {
    showLookupResult(
      phoneOnly
        ? "Please enter a valid phone number."
        : "Please enter a valid email address or phone number.",
      true,
    )
    return
  }

  setButtonLoading(elements.submit, true)
  elements.result.hidden = true

  try {
    const data = await lookupGuest(name, contact)

    if (data.canPetition && !data.found) {
      showLookupResult(data.message || "", false)
      if (onShowPetitionForm) {
        onShowPetitionForm(name || "", contact)
      }
      return
    }

    if (data.found && data.redirectCode) {
      window.location.href = "/rsvp?code=" + data.redirectCode
      return
    }

    showLookupResult(
      data.message || "Something went wrong. Please try again.",
      true,
    )
  } catch (err) {
    console.error("Lookup error:", err)
    showLookupResult(getErrorMessage(err), true)
  } finally {
    if (state) {
      setButtonLoading(state.elements.submit, false)
    }
  }
}

/** @type {Types.hideLookupSection} */
export function hideLookupSection() {
  if (state) {
    state.elements.section.hidden = true
  }
}

/** @type {Types.getConfig} */
function getConfig() {
  return api("/api/config")
}

/** @type {Types.fetchConfig} */
async function fetchConfig() {
  try {
    const data = await getConfig()
    if (!data.features) return

    if (!data.features.enableNameLookup && state) {
      state.elements.nameGroup.hidden = true
      state.elements.name.required = false
    }
    if (!data.features.enableEmailLookup && state) {
      state.elements.contactLabel.textContent = "Phone Number"
      state.elements.contact.type = "tel"
      state.elements.contact.placeholder = "(555) 123-4567"
    }
  } catch {
    // Config fetch failure is non-critical; form works with generic defaults
  }
}

/** @type {Types.initLookupForm} */
export function initLookupForm(onShowPetitionForm) {
  state = {
    elements: {
      result: getElement("lookup-result"),
      nameGroup: getElement("lookup-name-group"),
      name: getInputElement("lookup-name"),
      contact: getInputElement("lookup-contact"),
      contactLabel: getElement("lookup-contact-label"),
      submit: getButtonElement("lookup-submit"),
      section: getElement("rsvp-lookup"),
    },
    onShowPetitionForm: onShowPetitionForm || null,
  }

  getFormElement("lookup-form").addEventListener("submit", handleLookupSubmit)
  fetchConfig()
}
