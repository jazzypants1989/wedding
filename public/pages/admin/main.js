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
import {
  initThankYous,
  loadThankYous,
  loadThankYouCount,
  isThankYousDirty,
} from "./thank-you.js"
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
  loadThankYouCount()
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
    loadThankYouCount()
  }, BADGE_POLL_MS)

  // Deep-link support: /admin#thankyous (the digest email link) or any hash
  // matching a tab id opens that tab on load. (C8)
  const hashTab = tabIdFromHash()
  if (hashTab) switchTab(hashTab)
}

/** The tab id named by the current location.hash, if it matches a real tab.
 *  No regex — strip the leading "#" and match against each tab's data-tab.
 *  @returns {string | null} */
function tabIdFromHash() {
  const hash = location.hash
  const raw = hash.startsWith("#") ? hash.slice(1) : hash
  if (!raw) return null
  const tabs = document.querySelectorAll('[role="tab"]')
  for (const tab of tabs) {
    if (tab instanceof HTMLElement && tab.dataset.tab === raw) return raw
  }
  return null
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

  // Same guard for an open, edited thank-you card composer.
  const tyPanel = document.getElementById("tab-thankyous")
  if (tabId !== "thankyous" && tyPanel && !tyPanel.hidden && isThankYousDirty()) {
    if (
      !window.confirm(
        "You have unsaved changes to this thank-you card. Leave without saving?",
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

  // Keep the URL hash in sync so the tab is deep-linkable / refresh-stable,
  // without spamming history entries. (C8)
  if (tabId && location.hash.slice(1) !== tabId) {
    history.replaceState(null, "", "#" + tabId)
  }

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
  } else if (tabId === "thankyous") {
    loadThankYous()
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
  initThankYous()
  initSiteContent()
  initEffectConfig()
  initConfirmDialog()
  initThemeToggle()

  checkSession()
}

init()
