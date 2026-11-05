/** @file Admin dashboard main entry point: wires every module, registers the
 *  panels that follow the module contract (WORKSPACE.md) and the leave
 *  guards, and runs the badge poll. */
/** @import * as Types from './types.js' */

import { initModals, api } from "./utils.js"
import { initAuth, checkSession } from "./auth.js"
import { initGuests, loadGuests, loadStats } from "./guests.js"
import { initInvites } from "./invites.js"
import { initCSVImport } from "./csv-import.js"
import { initPetitions, loadPetitions, loadPetitionCount } from "./petitions.js"
import { initBlocklist, loadBlocklist } from "./blocklist.js"
import { initManualSms } from "./manual-sms.js"
import { initModeration, loadModeration, loadModerationCount } from "./moderation.js"
import { loadHome, refreshHomeBadges } from "./inbox.js"
import { initGalleryAdmin, loadGalleryAdmin } from "./gallery-admin.js"
import { initGallerySort } from "./gallery-sort.js"
import { initGalleryTwins } from "./gallery-twins.js"
import { state } from "./state.js"
import { initFaceAssignment, loadFaceAssignment } from "./face-assignment.js"
import { initThankYous, loadThankYous, loadThankYouCount } from "./thank-you.js"
import {
  initSiteContent,
  loadSiteContent,
  isSiteContentDirty,
  saveSiteContent,
  discardSiteContent,
} from "./site-content.js"
import { initEffectConfig, loadEffectConfig } from "./effect-config.js"
import { initConfirmDialog } from "./confirm.js"
import { initSplitResize } from "./split-resize.js"
import { initThemeToggle } from "../../components/theme-toggle.js"
import { initRouter, startRouter, renderMore, registerPanel, addGuard } from "./router.js"

/** Badge-refresh cadence — fresh enough to notice new guest posts while the
 * dashboard sits open, cheap enough to leave running. It also keeps a visible
 * tab's session alive (IA §13.4: no separate heartbeat). */
const BADGE_POLL_MS = 3 * 60 * 1000
/** @type {ReturnType<typeof setInterval> | undefined} */
let badgePollTimer

/** The brand mark is the couple's monogram, from Site content. */
async function loadMonogram() {
  try {
    const data = /** @type {Types.SiteContentResponse} */ (await api("/api/admin/site-content"))
    const mark = data.content.couple.monogram.trim()
    if (mark) document.getElementById("brand-mark")?.replaceChildren(mark)
  } catch {
    // The mark stays as it is.
  }
}

/** @type {Types.onLoginSuccess} */
function onLoginSuccess() {
  loadStats()
  loadGuests()
  loadPetitionCount()
  loadThankYouCount()
  void loadModerationCount()
  void refreshHomeBadges()
  void loadMonogram()
  // Badges used to load once per login and go stale while the tab sat open —
  // incoming photos/comments never bumped them until a manual reload.
  clearInterval(badgePollTimer)
  badgePollTimer = setInterval(() => {
    if (document.hidden) return
    loadModerationCount()
    loadPetitionCount()
    loadThankYouCount()
    refreshHomeBadges()
  }, BADGE_POLL_MS)

  // The path names the place (/admin/review, /admin/thank-yous/replies…);
  // bare /admin is Home, and old /admin#tab links are redirected.
  startRouter()
}

/** Stop the badge poll — armed on login, torn down on logout/expiry so it can't
 * keep 401ing (and wiping the password field) after the session ends. */
function stopBadgePolling() {
  clearInterval(badgePollTimer)
  badgePollTimer = undefined
}

/** A panel that has not adopted the module contract yet: load it when it is
 *  first shown, exactly as before. The router decides which (from the path)
 *  and owns history and the leave guard.
 *  @type {Types.showPanel} */
function loadLegacyPanel(tabId) {
  if (tabId === "petitions") {
    loadPetitions()
  } else if (tabId === "blocklist") {
    loadBlocklist()
  } else if (tabId === "moderation") {
    loadModeration()
  } else if (tabId === "gallery") {
    loadGalleryAdmin()
  } else if (tabId === "faces") {
    loadFaceAssignment()
  } else if (tabId === "thankyous") {
    loadThankYous()
  } else if (tabId === "site-content") {
    loadSiteContent()
  } else if (tabId === "effects") {
    loadEffectConfig()
  }
}

/** Panels on the module contract (WORKSPACE.md). */
function registerPanels() {
  registerPanel("inbox", { mount: () => loadHome() })
  registerPanel("more", { mount: () => renderMore() })
}

/** Work a navigation would throw away (IA §6, §13.3). */
function registerGuards() {
  addGuard({
    tab: "site-content",
    dirty: isSiteContentDirty,
    what: "your site content",
    save: saveSiteContent,
    discard: discardSiteContent,
  })
  // The card composer registers its own guard, with "Save and leave" (thank-you.js).
}

/** @type {Types.init} */
function init() {
  initModals()
  initAuth(onLoginSuccess, stopBadgePolling)
  initRouter(loadLegacyPanel)
  registerPanels()
  registerGuards()
  initGuests()
  initInvites()
  initCSVImport()
  initPetitions()
  initBlocklist()
  initManualSms()
  initModeration()
  initGalleryAdmin()
  initGallerySort()
  initGalleryTwins({
    reload: () => void loadGalleryAdmin(),
    getItem: (id) => state.getCuratedById(id),
  })
  initFaceAssignment()
  initThankYous()
  initSiteContent()
  initEffectConfig()
  initConfirmDialog()
  initSplitResize()
  initThemeToggle()

  checkSession()
}

init()
