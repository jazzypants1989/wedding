/** @file Effects (/admin/site/effects) — promote the studio's tuned effect
 *  values to a site-wide runtime override. A single column under Site, like
 *  Site content: the JSON, a sticky action bar, and a leave guard while it
 *  holds unsaved edits.
 *
 *  Loads the stored `effect_config` override into a JSON textarea, PUTs edits to
 *  /api/admin/effect-config (auto-CSRF via api()), offers a reset-to-defaults
 *  (DELETE), and an "Import from this browser" that pulls the effect studio's
 *  per-browser override (localStorage) into the textarea so the admin can save
 *  it for every visitor. The textarea is the source of truth on save.
 */
/** @import * as Types from './types.js' */

import { api, showError, showSuccess } from "./utils.js"
import { registerPanel, addGuard, setCrumbs } from "./router.js"
import { openConfirm } from "./confirm.js"
import {
  getElement,
  getTextAreaElement,
  getButtonElement,
  getFormElement,
  getErrorMessage,
} from "../utils.js"

/** Shared contract with the effects read side + studio write side. */
const STUDIO_STORAGE_KEY = "effect-config-override"

/** The textarea as last loaded or saved — the dirty baseline. */
let saved = /** @type {string | null} */ (null)

/** @param {Record<string, unknown>} override @param {boolean} [isSaved] */
function fillTextarea(override, isSaved = true) {
  const text = JSON.stringify(override, null, 2)
  getTextAreaElement("effect-config-json").value = text
  if (isSaved) saved = text
  updateDirtyNote()
}

/** @returns {boolean} edits since the last load / save */
export function isEffectConfigDirty() {
  return saved !== null && getTextAreaElement("effect-config-json").value !== saved
}

function updateDirtyNote() {
  getElement("effect-config-dirty").hidden = !isEffectConfigDirty()
}

export async function loadEffectConfig() {
  // Never clobber edits still sitting in the textarea (a re-login, a re-visit).
  if (isEffectConfigDirty()) return
  try {
    const data = /** @type {Types.EffectConfigResponse} */ (await api("/api/admin/effect-config"))
    fillTextarea(data.override || {})
  } catch (err) {
    console.error("Failed to load effect config:", err)
    showError("Failed to load effect config. Please refresh the page.")
  }
}

/** @param {SubmitEvent} e */
function handleSubmit(e) {
  e.preventDefault()
  void saveEffectConfig()
}

/** Save the textarea; true when it saved (the guard's "Save and leave" too).
 *  @returns {Promise<boolean>} */
export async function saveEffectConfig() {
  const errorEl = getElement("effect-config-form-error")
  errorEl.hidden = true

  let override
  try {
    const text = getTextAreaElement("effect-config-json").value.trim()
    override = text ? JSON.parse(text) : {}
  } catch {
    errorEl.textContent = "That isn't valid JSON — check for a trailing comma or a missing quote."
    errorEl.hidden = false
    return false
  }

  const saveBtn = getButtonElement("effect-config-save-btn")
  saveBtn.disabled = true
  try {
    const data = /** @type {Types.EffectConfigResponse} */ (
      await api("/api/admin/effect-config", {
        method: "PUT",
        body: JSON.stringify({ override }),
      })
    )
    fillTextarea(data.override || {})
    showSuccess("Effects saved — live on the next page load")
    return true
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
    return false
  } finally {
    saveBtn.disabled = false
  }
}

function handleReset() {
  openConfirm({
    title: "Reset effect config?",
    desc:
      "This discards the site-wide effect override and returns every visitor " +
      "to the theme's shipped defaults. This can't be undone.",
    confirmLabel: "Reset to defaults",
    danger: true,
    run: async () => {
      const data = /** @type {Types.EffectConfigResponse} */ (
        await api("/api/admin/effect-config", { method: "DELETE" })
      )
      fillTextarea(data.override || {})
      showSuccess("Effect config reset to defaults")
    },
  })
}

/** Pull the effect studio's per-browser override (this browser's localStorage)
 *  into the textarea. It doesn't save — the admin reviews then clicks Save. */
function handleImport() {
  const errorEl = getElement("effect-config-form-error")
  errorEl.hidden = true
  let stored
  try {
    stored = localStorage.getItem(STUDIO_STORAGE_KEY)
  } catch {
    stored = null
  }
  if (!stored) {
    errorEl.textContent =
      "No studio override found in this browser. " +
      "Tune an effect in /studio and 'Save to browser' first."
    errorEl.hidden = false
    return
  }
  try {
    fillTextarea(JSON.parse(stored), false)
    showSuccess("Imported this browser's studio values — review them, then Save.")
  } catch {
    errorEl.textContent = "This browser's studio override is corrupt and couldn't be read."
    errorEl.hidden = false
  }
}

export function initEffectConfig() {
  registerPanel("effects", {
    mount() {
      setCrumbs([])
      void loadEffectConfig()
    },
  })
  addGuard({
    tab: "effects",
    dirty: isEffectConfigDirty,
    what: "your effect settings",
    save: saveEffectConfig,
    // Discard means discard: the next visit reloads the saved override.
    discard: () => {
      saved = null
      updateDirtyNote()
    },
  })
  window.addEventListener("beforeunload", (e) => {
    if (!isEffectConfigDirty()) return
    e.preventDefault()
    e.returnValue = ""
  })
  getTextAreaElement("effect-config-json").addEventListener("input", updateDirtyNote)
  getFormElement("effect-config-form").addEventListener("submit", handleSubmit)
  getButtonElement("effect-config-reset-btn").addEventListener("click", handleReset)
  getButtonElement("effect-config-import-btn").addEventListener("click", handleImport)
}
