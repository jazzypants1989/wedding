/** @file Authentication module for admin dashboard */
/** @import * as Types from './types.js' */

import { state } from "./state.js"
import {
  getElement,
  getFormElement,
  getInputElement,
  getButtonElement,
  getErrorMessage,
} from "../utils.js"

const loginSection = getElement("login-section")
const dashboardSection = getElement("dashboard-section")
const loginForm = getFormElement("login-form")
const loginError = getElement("login-error")
const logoutBtn = getElement("logout-btn")

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
    "We couldn't reach the server to check your session — this is usually a temporary connection issue, not a sign-out. Please try logging in again."
  loginError.hidden = false
}

/** @type {Types.handleLoginSubmit} */
async function handleLoginSubmit(e) {
  e.preventDefault()
  loginError.hidden = true

  const password = getInputElement("password").value
  const submitBtn = getButtonElement("login-form-submit")
  submitBtn.disabled = true

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

    if (!res.ok) {
      throw new Error(data.error || "Login failed")
    }

    state.csrfToken = getCookie("csrf")
    showDashboard()
    onLoginSuccess()
  } catch (err) {
    loginError.textContent = getErrorMessage(err)
    loginError.hidden = false
  } finally {
    clearTimeout(timeoutId)
    submitBtn.disabled = false
  }
}

/** @type {Types.initAuth} */
export function initAuth(loginCallback, logoutCallback = () => {}) {
  onLoginSuccess = loginCallback
  onLoggedOut = logoutCallback
  state.onAuthRequired = showLogin
  loginForm.addEventListener("submit", handleLoginSubmit)

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
