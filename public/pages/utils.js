/** @file Type-safe DOM element utilities */
/** @import * as Types from "./types.js" */

/** @type {Types.assertElement} */
export function assertElement(element, name) {
  if (!element) {
    throw new Error(`Required element not found: ${name}`)
  }
  return element
}

/** @type {Types.getElement} */
export function getElement(id) {
  return assertElement(document.getElementById(id), `#${id}`)
}

/** @type {Types.getInputElement} */
export function getInputElement(id) {
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`Required element not found: #${id}`)
  }
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`Element #${id} is not an input element`)
  }
  return el
}

/** @type {Types.getTextAreaElement} */
export function getTextAreaElement(id) {
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`Required element not found: #${id}`)
  }
  if (!(el instanceof HTMLTextAreaElement)) {
    throw new Error(`Element #${id} is not a textarea element`)
  }
  return el
}

/** @type {Types.getButtonElement} */
export function getButtonElement(id) {
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`Required element not found: #${id}`)
  }
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error(`Element #${id} is not a button element`)
  }
  return el
}

/** @type {Types.getFormElement} */
export function getFormElement(id) {
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`Required element not found: #${id}`)
  }
  if (!(el instanceof HTMLFormElement)) {
    throw new Error(`Element #${id} is not a form element`)
  }
  return el
}

/** @type {Types.getSelectElement} */
export function getSelectElement(id) {
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`Required element not found: #${id}`)
  }
  if (!(el instanceof HTMLSelectElement)) {
    throw new Error(`Element #${id} is not a select element`)
  }
  return el
}

/** @type {Types.getTableElement} */
export function getTableElement(id) {
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`Required element not found: #${id}`)
  }
  if (!(el instanceof HTMLTableElement)) {
    throw new Error(`Element #${id} is not a table element`)
  }
  return el
}

/** @type {Types.getIFrameElement} */
export function getIFrameElement(id) {
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`Required element not found: #${id}`)
  }
  if (!(el instanceof HTMLIFrameElement)) {
    throw new Error(`Element #${id} is not an iframe element`)
  }
  return el
}

/** @type {Types.getDialogElement} */
export function getDialogElement(id) {
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`Required element not found: #${id}`)
  }
  if (!(el instanceof HTMLDialogElement)) {
    throw new Error(`Element #${id} is not a dialog element`)
  }
  return el
}

/** @type {Types.getErrorMessage} */
export function getErrorMessage(err) {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return "An unexpected error occurred"
}

/** @type {Types.escapeHtml} */
export function escapeHtml(str) {
  if (!str) return ""
  const div = document.createElement("div")
  div.textContent = str
  return div.innerHTML
}

/** @type {Types.formatDate} */
export function formatDate(isoString) {
  if (!isoString) return ""
  const date = new Date(isoString)
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** @type {Types.countDigits} */
function countDigits(str) {
  let count = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code >= 48 && code <= 57) count++
  }
  return count
}

/** @type {Types.detectContactType} */
export function detectContactType(contact) {
  if (contact.includes("@")) {
    return "email"
  }
  if (countDigits(contact) >= 7) {
    return "phone"
  }
  return "email"
}
