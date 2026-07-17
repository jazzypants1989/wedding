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
import { showResult, setButtonLoading, getConfig } from "./utils.js"
import {
  isPetitionPending,
  setPetitionPending,
  clearPetitionPending,
} from "./petition-flag.js"

/** @type {Types.LookupFormState | null} */
let state = null

/** Resolves when /api/config has been applied (form shape finalized). */
let configReady = /** @type {Promise<void>} */ (Promise.resolve())
let configResolved = false

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

  // Config may still be loading on a slow connection. Show the button working
  // and wait for the form's final shape (name/email reveal) before validating —
  // a dead tap on a silently-disabled button reads as a broken form.
  if (!configResolved) {
    setButtonLoading(elements.submit, true)
    await configReady
    if (!state) return
    setButtonLoading(elements.submit, false)
  }

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
      // Server truth clears a stale "still under review" note for denied/none.
      reconcilePetitionNote(data.petitionStatus)
      const message =
        data.petitionStatus === "denied"
          ? "Your earlier request wasn't approved, but you're welcome to send a new one below."
          : data.message || ""
      showLookupResult(message, false)
      if (onShowPetitionForm) {
        onShowPetitionForm(name || "", contact)
      }
      return
    }

    if (data.found && data.redirectCode) {
      // Brief acknowledgment before the navigation so the redirect doesn't feel
      // like an unexplained page jump. Defer the navigation a beat so the message
      // actually paints (assigning href synchronously navigates before render).
      showLookupResult("Found you! Taking you to your RSVP…", false)
      const code = data.redirectCode
      setTimeout(() => {
        window.location.href = "/rsvp?code=" + code
      }, 500)
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

/** Reveal the name field and make it required (server may require it). */
function revealNameField() {
  if (!state) return
  state.elements.nameGroup.hidden = false
  state.elements.name.required = true
}

/** Widen the contact field to accept an email as well as a phone number. */
function revealEmailContact() {
  if (!state) return
  state.elements.contactLabel.textContent = "Phone or Email"
  state.elements.contact.type = "text"
  state.elements.contact.placeholder = "(555) 123-4567 or you@email.com"
}

/** @type {Types.fetchConfig} */
async function fetchConfig() {
  try {
    const data = await getConfig()
    if (!data.features) return

    // The static HTML ships the default flags-off state (phone-only, no name
    // field) so nothing collapses after first paint; config only ever *adds*.
    if (data.features.enableNameLookup) revealNameField()
    if (data.features.enableEmailLookup) revealEmailContact()
  } catch {
    // Config unreachable: fail OPEN to the widest form, not the narrowest.
    // Hiding a field the server requires (name) would dead-end the guest with an
    // unfixable 400 ("Name is required" for an invisible field); an extra field
    // the server ignores is harmless. Email lookup works server-side regardless
    // of the flag, so widening contact is always safe.
    revealNameField()
    revealEmailContact()
  }
}

/** @type {Types.initLookupForm} */
export async function initLookupForm(onShowPetitionForm) {
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

  // Kick off config but keep the button live: a submit before config resolves
  // waits on `configReady` (with a button spinner) rather than dead-tapping a
  // disabled button. This still guarantees the form's final shape (name/email
  // reveal) is applied before we validate.
  configResolved = false
  configReady = fetchConfig().finally(() => {
    configResolved = true
  })

  // A returning petitioner shouldn't have to re-file to learn their request is
  // still pending. petition-form.js sets the flag; a successful invite load or a
  // lookup that reveals the petition is resolved clears it (reconcilePetitionNote).
  if (isPetitionPending()) {
    getElement("petition-pending-note").hidden = false
  }
}

/**
 * Reconcile the "still under review" note against server truth returned by a
 * lookup: only a genuinely-pending petition keeps it; denied/approved/none clears
 * both the flag and the note so a denied petitioner can re-file cleanly.
 * @param {string | null | undefined} petitionStatus
 */
function reconcilePetitionNote(petitionStatus) {
  const note = getElement("petition-pending-note")
  if (petitionStatus === "pending") {
    setPetitionPending()
    note.hidden = false
  } else {
    clearPetitionPending()
    note.hidden = true
  }
}
