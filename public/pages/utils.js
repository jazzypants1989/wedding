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

/**
 * @template {typeof HTMLElement} T
 * @param {string} id
 * @param {T} ElementClass
 * @returns {InstanceType<T>}
 */
export function getTypedElement(id, ElementClass) {
  const el = document.getElementById(id)
  if (!el) throw new Error("Required element not found: #" + id)
  if (!(el instanceof ElementClass))
    throw new Error("Element #" + id + " is not a " + ElementClass.name)
  return /** @type {InstanceType<T>} */ (el)
}

/** @type {Types.getInputElement} */
export function getInputElement(id) {
  return getTypedElement(id, HTMLInputElement)
}

/** @type {Types.getTextAreaElement} */
export function getTextAreaElement(id) {
  return getTypedElement(id, HTMLTextAreaElement)
}

/** @type {Types.getButtonElement} */
export function getButtonElement(id) {
  return getTypedElement(id, HTMLButtonElement)
}

/** @type {Types.getFormElement} */
export function getFormElement(id) {
  return getTypedElement(id, HTMLFormElement)
}

/** @type {Types.getSelectElement} */
export function getSelectElement(id) {
  return getTypedElement(id, HTMLSelectElement)
}

/** @type {Types.getTableElement} */
export function getTableElement(id) {
  return getTypedElement(id, HTMLTableElement)
}

/** @type {Types.getIFrameElement} */
export function getIFrameElement(id) {
  return getTypedElement(id, HTMLIFrameElement)
}

/** @type {Types.getDialogElement} */
export function getDialogElement(id) {
  return getTypedElement(id, HTMLDialogElement)
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
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/**
 * Wrapper for pre-escaped HTML content.
 * Use html`` tagged template to create, or raw() for trusted strings.
 */
export class SafeHTML {
  /** @param {string} value */
  constructor(value) {
    this.value = value
  }
  toString() {
    return this.value
  }
}

/**
 * Resolve a template value to a safe HTML string.
 * Nullish and boolean values render as empty (like React/Lit).
 * @param {unknown} val
 * @returns {string}
 */
function resolveValue(val) {
  if (val == null || typeof val === "boolean") return ""
  if (val instanceof SafeHTML) return val.value
  if (Array.isArray(val)) return val.map(resolveValue).join("")
  if (typeof val === "number") return String(val)
  return escapeHtml(String(val))
}

/**
 * Auto-escaping HTML tagged template.
 * All interpolated values are escaped unless wrapped in SafeHTML (via raw()).
 * Arrays of SafeHTML are joined automatically.
 *
 * @type {Types.html}
 */
export function html(strings, ...values) {
  let result = strings[0]
  for (let i = 0; i < values.length; i++) {
    result += resolveValue(values[i])
    result += strings[i + 1]
  }
  return /** @type {string} */ (/** @type {unknown} */ (new SafeHTML(result)))
}

/**
 * Mark a string as trusted HTML (no escaping).
 * Only use with HTML you control — never with user input.
 * @type {Types.raw}
 */
export function raw(trustedString) {
  return new SafeHTML(trustedString || "")
}

/** @type {Types.join} */
export function join(items, separator) {
  const sep =
    separator instanceof SafeHTML
      ? separator.value
      : escapeHtml(String(separator ?? ","))
  let first = true
  let result = ""
  for (const item of items) {
    if (item == null || typeof item === "boolean" || item === "") continue
    if (!first) result += sep
    first = false
    result += resolveValue(item)
  }
  return /** @type {string} */ (/** @type {unknown} */ (new SafeHTML(result)))
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
  return "unknown"
}

const DEFAULT_API_TIMEOUT = 30000

/** @type {Types.api} */
export async function api(endpoint, options = {}) {
  /** @type {Record<string, string>} */
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  }

  if (options.csrf && options.method && options.method !== "GET") {
    // Admin pages read the "csrf" cookie; guest pages pass csrfCookie:"guest_csrf"
    // so the correct double-submit token goes out for the guest session.
    const csrfCookieName = options.csrfCookie || "csrf"
    const cookiePairs = document.cookie.split("; ")
    for (const pair of cookiePairs) {
      const eqIdx = pair.indexOf("=")
      if (eqIdx !== -1 && pair.slice(0, eqIdx) === csrfCookieName) {
        headers["X-CSRF-Token"] = pair.slice(eqIdx + 1)
        break
      }
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeout || DEFAULT_API_TIMEOUT,
  )

  // If caller provided a signal, abort our controller when it aborts
  // (AbortSignal.any is too new for older Safari)
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    })
  }

  const signal = controller.signal

  try {
    const res = await fetch(endpoint, {
      ...options,
      headers,
      signal,
    })

    let data
    try {
      data = await res.json()
    } catch (parseError) {
      if (!res.ok) {
        throw new Error("Request failed with status " + res.status)
      }
      data = {}
    }

    if (!res.ok) {
      if (res.status === 401 && options.onUnauthorized) {
        options.onUnauthorized()
      }
      throw new Error(data.error || "Request failed with status " + res.status)
    }

    return data
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.")
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
