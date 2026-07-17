/** @file Admin dashboard main entry point */
/** @import * as Types from './types.js' */

import { initModals, showSuccess } from "./utils.js"
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
import { initSiteContent, loadSiteContent, isSiteContentDirty } from "./site-content.js"
import { initEffectConfig, loadEffectConfig } from "./effect-config.js"
import { initConfirmDialog } from "./confirm.js"
import { initThemeToggle } from "../../components/theme-toggle.js"

/** Badge-refresh cadence — fresh enough to notice new guest posts while the
 * dashboard sits open, cheap enough to leave running. */
const BADGE_POLL_MS = 3 * 60 * 1000
/** @type {ReturnType<typeof setInterval> | undefined} */
let badgePollTimer

/** @type {Types.onLoginSuccess} */
function onLoginSuccess() {
  loadStats()
  loadGuests()
  loadPetitionCount()
  // Landing on the dashboard says whether work is waiting — the badge alone is
  // easy to miss, and login lands on the Guests tab.
  void loadModerationCount().then((total) => {
    if (total > 0) {
      showSuccess(
        `${total} item${total === 1 ? "" : "s"} waiting for review in the Moderation tab.`,
      )
    }
  })
  // Badges used to load once per login and go stale while the tab sat open —
  // incoming photos/comments never bumped them until a manual reload.
  clearInterval(badgePollTimer)
  badgePollTimer = setInterval(() => {
    if (document.hidden) return
    loadModerationCount()
    loadPetitionCount()
  }, BADGE_POLL_MS)
}

/** Stop the badge poll — armed on login, torn down on logout/expiry so it can't
 * keep 401ing (and wiping the password field) after the session ends. */
function stopBadgePolling() {
  clearInterval(badgePollTimer)
  badgePollTimer = undefined
}

/** @type {Types.switchTab} */
function switchTab(tabId) {
  // Guard against silently discarding unsaved Site-content edits when leaving
  // that tab. beforeunload covers full-page unloads; this covers in-app switches.
  const scPanel = document.getElementById("tab-site-content")
  if (tabId !== "site-content" && scPanel && !scPanel.hidden && isSiteContentDirty()) {
    if (
      !window.confirm(
        "You have unsaved changes to your site content. Leave without saving?",
      )
    ) {
      return
    }
  }

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
  initAuth(onLoginSuccess, stopBadgePolling)
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
  initConfirmDialog()
  initThemeToggle()

  checkSession()
}

init()
