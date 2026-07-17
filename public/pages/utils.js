/** @file Type-safe DOM element utilities */
/** @import * as Types from "./types.js" */

import { announcePolite } from "../components/announce.js"

/** Announce "chars left" only within this many chars of the limit. */
const CHAR_WARN_AT = 20

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
 * The couple's display name, read from the server-templated `.couple-names`
 * heading — the single source (content.js) already present in the DOM, so UI
 * copy stays in sync without a config fetch. Falls back if the heading is absent.
 * @returns {string}
 */
export function getCoupleName() {
  const name = document.querySelector(".couple-names")?.textContent?.trim()
  return name || "the hosts"
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

/**
 * Map an HTTP error into guest-friendly copy (2.7): soften 5xx (which carry
 * terse or no message) and rate limits, but keep the server's specific message
 * for 4xx validation errors ("Invalid invite code" etc.), which reads fine.
 * @param {number} status @param {unknown} serverMessage @param {unknown} [code]
 * @returns {string}
 */
function friendlyMessage(status, serverMessage, code) {
  if (status >= 500) {
    return "Something went wrong on our end — please try again in a moment."
  }
  // A stale double-submit token (long-idle tab). The failing response set a
  // fresh cookie, so a plain retry works — say that instead of the raw
  // "Invalid CSRF token". Keyed on the server's machine code, not its copy.
  if (status === 403 && code === "CSRF") {
    return "Your session refreshed — please try that again."
  }
  if (typeof serverMessage === "string" && serverMessage) return serverMessage
  if (status === 429) {
    return "You're doing that a little too fast — please wait a moment and try again."
  }
  return `That didn't go through (error ${status}) — please refresh the page and try again.`
}

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
        throw new Error(friendlyMessage(res.status, null))
      }
      data = {}
    }

    if (!res.ok) {
      if (res.status === 401 && options.onUnauthorized) {
        options.onUnauthorized()
      }
      throw new Error(friendlyMessage(res.status, data.error, data.code))
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

/**
 * Share a URL the way a phone-first guest expects: the native share sheet when
 * available (fire it straight into a group chat), else copy to the clipboard,
 * else surface a manual-copy prompt. Returns the outcome so the caller can
 * reflect it (e.g. flip a button to "Copied!"). Shared by the gallery lightbox
 * and the guestbook per-entry share.
 * @param {string} url @param {string} [title]
 * @returns {Promise<"shared" | "copied" | "manual">}
 */
export async function shareUrl(url, title = document.title) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url })
      return "shared"
    } catch (err) {
      // User dismissed the sheet → treat as handled. Any other error → fall
      // through to the copy path.
      if (err instanceof DOMException && err.name === "AbortError") return "shared"
    }
  }
  const ok = await copyToClipboard(url)
  if (ok) return "copied"
  window.prompt("Copy this link:", url)
  return "manual"
}

/**
 * Copy text to the clipboard: the async Clipboard API in a secure context, else
 * a hidden-textarea execCommand fallback. Resolves to whether the copy landed.
 * @param {string} text @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** @type {Types.stripQueryParam} */
export function stripQueryParam(basePath, key) {
  const params = new URLSearchParams(location.search)
  params.delete(key)
  // Use toString() truthiness rather than URLSearchParams.size (Chrome 113+ /
  // Safari 17+ only) — on older browsers .size is undefined and every remaining
  // param would be silently dropped.
  const qs = params.toString()
  history.replaceState(null, "", qs ? `${basePath}?${qs}` : basePath)
}

/**
 * Politely announce remaining characters as a field nears its limit, WITHOUT
 * narrating every keystroke: fires once on entering the warning zone and once at
 * the limit, tracked via a data-attr phase on the passed element. The visible
 * counter stays aria-hidden (silent), so this is the only spoken source.
 * @param {number} length current value length
 * @param {number} max the field's maxlength
 * @param {HTMLElement} el element used to remember the last announced phase
 */
export function announceCharsRemaining(length, max, el) {
  const remaining = max - length
  const phase = remaining > CHAR_WARN_AT ? "ok" : remaining <= 0 ? "full" : "warn"
  if (el.dataset.charPhase === phase) return
  el.dataset.charPhase = phase
  if (phase === "warn") announcePolite(`${remaining} characters left`)
  else if (phase === "full") announcePolite("Character limit reached")
}

/** @type {Types.setLoadMoreState} */
export function setLoadMoreState(btn, mode) {
  // The guest feeds' load-more button doubles as the infinite-scroll sentinel.
  // On a load error it becomes a visible "Try again" (its click handler re-arms
  // auto-loading, so a failed first paint isn't a dead end); on success it
  // resets to "Load more" and the caller decides visibility.
  btn.textContent = mode === "retry" ? "Try again" : "Load more"
  if (mode === "retry") btn.hidden = false
}
