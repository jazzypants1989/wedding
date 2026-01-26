/** @file Admin dashboard main entry point */
/** @import * as Types from './types.js' */

import { initModals } from "./modal.js"
import { initAuth, checkSession } from "./auth.js"
import { initGuests, loadGuests, loadStats } from "./guests.js"
import { loadRsvps } from "./rsvps.js"
import { initInvites } from "./invites.js"
import { initCSVImport } from "./csv-import.js"
import { initPetitions, loadPetitions, loadPetitionCount } from "./petitions.js"
import { initBlocklist, loadBlocklist } from "./blocklist.js"

/** @type {Types.onLoginSuccess} */
function onLoginSuccess() {
  loadStats()
  loadGuests()
  loadPetitionCount()
}

/** @type {Types.switchTab} */
function switchTab(tabId) {
  document.querySelectorAll('[role="tab"]').forEach((tab) => {
    if (!(tab instanceof HTMLElement)) return
    const isSelected = tab.dataset.tab === tabId
    tab.setAttribute("aria-selected", isSelected ? "true" : "false")
    tab.classList.toggle("active", isSelected)
  })

  document.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
    if (!(panel instanceof HTMLElement)) return
    const isActive = panel.id === `tab-${tabId}`
    panel.hidden = !isActive
    panel.classList.toggle("active", isActive)
  })

  if (tabId === "rsvps") {
    loadRsvps()
  } else if (tabId === "petitions") {
    loadPetitions()
  } else if (tabId === "blocklist") {
    loadBlocklist()
  }
}

/** @type {Types.initTabs} */
function initTabs() {
  document.querySelectorAll('[role="tab"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn instanceof HTMLElement) {
        switchTab(btn.dataset.tab || "")
      }
    })
  })
}

/** @type {Types.init} */
function init() {
  initModals()
  initAuth(onLoginSuccess)
  initGuests()
  initTabs()
  initInvites()
  initCSVImport()
  initPetitions()
  initBlocklist()

  checkSession()
}

init()
