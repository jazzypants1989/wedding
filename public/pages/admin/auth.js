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
    }
  } catch (err) {
    // Not logged in or timed out, show login
  } finally {
    clearTimeout(timeoutId)
  }
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
export function initAuth(loginCallback) {
  onLoginSuccess = loginCallback
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
