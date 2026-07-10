/** @file Admin dashboard main entry point */
/** @import * as Types from './types.js' */

import { initModals } from "./utils.js"
import { initAuth, checkSession } from "./auth.js"
import { initGuests, loadGuests, loadStats } from "./guests.js"
import { loadRsvps } from "./rsvps.js"
import { initInvites } from "./invites.js"
import { initCSVImport } from "./csv-import.js"
import { initPetitions, loadPetitions, loadPetitionCount } from "./petitions.js"
import { initBlocklist, loadBlocklist } from "./blocklist.js"
import { initManualSms } from "./manual-sms.js"
import { initModeration, loadModeration, loadModerationCount } from "./moderation.js"
import { initGalleryAdmin, loadGalleryAdmin } from "./gallery-admin.js"
import { initSiteContent, loadSiteContent } from "./site-content.js"
import { initEffectConfig, loadEffectConfig } from "./effect-config.js"
import { initThemeToggle } from "../../components/theme-toggle.js"

/** @type {Types.onLoginSuccess} */
function onLoginSuccess() {
  loadStats()
  loadGuests()
  loadPetitionCount()
  loadModerationCount()
}

/** @type {Types.switchTab} */
function switchTab(tabId) {
  document.querySelectorAll('[role="tab"]').forEach((tab) => {
    if (!(tab instanceof HTMLElement)) return
    const isSelected = tab.dataset.tab === tabId
    tab.setAttribute("aria-selected", isSelected ? "true" : "false")
    tab.setAttribute("tabindex", isSelected ? "0" : "-1")
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
  } else if (tabId === "moderation") {
    loadModeration()
  } else if (tabId === "gallery") {
    loadGalleryAdmin()
  } else if (tabId === "site-content") {
    loadSiteContent()
  } else if (tabId === "effects") {
    loadEffectConfig()
  }
}

/** @type {Types.initTabs} */
function initTabs() {
  const tabButtons = /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('[role="tab"]')
  )

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab || "")
    })
  })

  // WAI-ARIA: Arrow key navigation between tabs
  const tabList = document.querySelector('[role="tablist"]')
  if (tabList) {
    tabList.addEventListener("keydown", (e) => {
      if (!(e instanceof KeyboardEvent)) return
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return

      const tabs = /** @type {HTMLElement[]} */ (
        Array.from(tabList.querySelectorAll('[role="tab"]'))
      )
      const current = tabs.indexOf(
        /** @type {HTMLElement} */ (document.activeElement),
      )
      if (current === -1) return

      e.preventDefault()
      const next =
        e.key === "ArrowRight"
          ? (current + 1) % tabs.length
          : (current - 1 + tabs.length) % tabs.length

      tabs[next].focus()
      switchTab(tabs[next].dataset.tab || "")
    })
  }
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
  initManualSms()
  initModeration()
  initGalleryAdmin()
  initSiteContent()
  initEffectConfig()
  initThemeToggle()

  checkSession()
}

init()
