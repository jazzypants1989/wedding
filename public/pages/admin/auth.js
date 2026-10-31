/** @file Authentication module for admin dashboard */
/** @import * as Types from './types.js' */

import { state } from "./state.js"
import {
  getElement,
  getFormElement,
  getInputElement,
  getButtonElement,
  getTypedElement,
  getErrorMessage,
} from "../utils.js"
import { showSuccess } from "./utils.js"

const loginSection = getElement("login-section")
const dashboardSection = getElement("dashboard-section")
const loginForm = getFormElement("login-form")
const loginError = getElement("login-error")
const logoutBtn = getElement("logout-btn")
const reauthModal = getTypedElement("reauth-modal", HTMLDialogElement)
const reauthForm = getFormElement("reauth-form")
const reauthError = getElement("reauth-error")

/** @type {Types.VoidCallback} */
let onLoginSuccess = () => {}

/** Runs whenever we drop to the login screen (logout, expiry, 401) — lets the
 * dashboard tear down anything armed for a logged-in session (e.g. badge polling). */
/** @type {Types.VoidCallback} */
let onLoggedOut = () => {}

/** @type {Types.getCookie} */
function getCookie(name) {
  const cookies = document.cookie
  if (!cookies) return null
  const pairs = cookies.split("; ")
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=")
    if (eqIndex !== -1 && pair.slice(0, eqIndex) === name) {
      return pair.slice(eqIndex + 1)
    }
  }
  return null
}

/** @type {Types.showLogin} */
export function showLogin() {
  // Every path to the login screen funnels through here — tear down any
  // logged-in-session timers first so they stop firing 401s (a live badge poll
  // would otherwise keep wiping the password field the admin is retyping).
  onLoggedOut()
  // Close any modal left open by the session that just ended. Hiding the
  // dashboard alone leaves the <dialog open>, so it would pop back up in its
  // stale state over the fresh login — a confusing ghost. Reopening after
  // re-login rebuilds each modal from scratch.
  for (const dialog of document.querySelectorAll("dialog[open]")) {
    if (dialog instanceof HTMLDialogElement) dialog.close()
  }
  loginSection.hidden = false
  dashboardSection.classList.remove("active")
  getInputElement("password").value = ""
}

/**
 * A 401 arrived. Mid-session — the dashboard is up — sign back in over it, so
 * nothing the admin was doing is lost: not the tab, not a half-typed name, not
 * the open dialog or the group under review. Only a cold start (dashboard never
 * shown) drops to the full login screen.
 * @type {Types.VoidCallback}
 */
function handleAuthRequired() {
  if (!dashboardSection.classList.contains("active")) {
    showLogin()
    return
  }
  if (reauthModal.open) return
  reauthError.hidden = true
  getInputElement("reauth-password").value = ""
  const path = location.pathname
  const where = path.startsWith("/admin/") ? path.slice("/admin".length) : ""
  getElement("reauth-where").textContent = where || "Home"
  // showModal stacks it above any dialog already open, which stays open behind.
  reauthModal.showModal()
}

/**
 * POST the password; resolves on success, throws a readable error otherwise.
 * Shared by the login screen and the sign-back-in dialog.
 * @param {string} password
 */
async function postLogin(password) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      signal: controller.signal,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Login failed")
    state.csrfToken = getCookie("csrf")
  } finally {
    clearTimeout(timeoutId)
  }
}

/** @param {SubmitEvent} e */
async function handleReauthSubmit(e) {
  e.preventDefault()
  reauthError.hidden = true
  const submitBtn = getButtonElement("reauth-submit")
  submitBtn.disabled = true
  try {
    await postLogin(getInputElement("reauth-password").value)
    reauthModal.close()
    // Deliberately NOT onLoginSuccess: that reloads every tab and lands on the
    // Inbox, which is exactly the lost place this dialog exists to prevent.
    // Whatever request hit the 401 did not happen, so say so.
    showSuccess("Signed back in, right where you were. If something didn't save, try it once more.")
  } catch (err) {
    reauthError.textContent = getErrorMessage(err)
    reauthError.hidden = false
  } finally {
    submitBtn.disabled = false
  }
}

/** @type {Types.showDashboard} */
function showDashboard() {
  loginSection.hidden = true
  dashboardSection.classList.add("active")
}

/** @type {Types.checkSession} */
export async function checkSession() {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch("/api/admin/stats", {
      signal: controller.signal,
    })
    if (res.ok) {
      state.csrfToken = getCookie("csrf")
      showDashboard()
      onLoginSuccess()
      return
    }
    // 401/403 is the normal "not logged in / session expired" path — show the
    // login form silently. Any other status is a server-side blip, not a
    // sign-out, so say so instead of implying the session ended.
    showLogin()
    if (res.status !== 401 && res.status !== 403) {
      showTransientSessionNotice()
    }
  } catch (err) {
    // Network failure or timeout — transient, not an expired session.
    showLogin()
    showTransientSessionNotice()
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Distinguish a connection blip from an expired session on the login screen. */
function showTransientSessionNotice() {
  loginError.textContent =
    "We couldn't reach the server to check your session — this is usually a temporary " +
    "connection issue, not a sign-out. Please try logging in again."
  loginError.hidden = false
}

/** @type {Types.handleLoginSubmit} */
async function handleLoginSubmit(e) {
  e.preventDefault()
  loginError.hidden = true

  const password = getInputElement("password").value
  const submitBtn = getButtonElement("login-form-submit")
  submitBtn.disabled = true

  try {
    await postLogin(password)
    showDashboard()
    onLoginSuccess()
  } catch (err) {
    loginError.textContent = getErrorMessage(err)
    loginError.hidden = false
  } finally {
    submitBtn.disabled = false
  }
}

/** @type {Types.initAuth} */
export function initAuth(loginCallback, logoutCallback = () => {}) {
  onLoginSuccess = loginCallback
  onLoggedOut = logoutCallback
  state.onAuthRequired = handleAuthRequired
  loginForm.addEventListener("submit", handleLoginSubmit)
  reauthForm.addEventListener("submit", (e) => void handleReauthSubmit(e))
  getButtonElement("reauth-signout").addEventListener("click", () => {
    reauthModal.close()
    state.csrfToken = null
    showLogin()
  })

  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" })
    } catch (err) {
      console.error("Logout failed:", err)
    }
    state.csrfToken = null
    showLogin()
  })
}
