/** @file Admin "Effects" tab — promote the studio's tuned effect values to a
 *  site-wide runtime override.
 *
 *  Loads the stored `effect_config` override into a JSON textarea, PUTs edits to
 *  /api/admin/effect-config (auto-CSRF via api()), offers a reset-to-defaults
 *  (DELETE), and an "Import from this browser" that pulls the effect studio's
 *  per-browser override (localStorage) into the textarea so the admin can save
 *  it for every visitor. The textarea is the source of truth on save.
 */
/** @import * as Types from './types.js' */

import { api, showError, showSuccess } from "./utils.js"
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

/** @param {Record<string, unknown>} override */
function fillTextarea(override) {
  getTextAreaElement("effect-config-json").value = JSON.stringify(override, null, 2)
}

export async function loadEffectConfig() {
  try {
    const data = /** @type {Types.EffectConfigResponse} */ (await api("/api/admin/effect-config"))
    fillTextarea(data.override || {})
  } catch (err) {
    console.error("Failed to load effect config:", err)
    showError("Failed to load effect config. Please refresh the page.")
  }
}

/** @param {SubmitEvent} e */
async function handleSubmit(e) {
  e.preventDefault()
  const errorEl = getElement("effect-config-form-error")
  errorEl.hidden = true

  let override
  try {
    const text = getTextAreaElement("effect-config-json").value.trim()
    override = text ? JSON.parse(text) : {}
  } catch {
    errorEl.textContent = "That isn't valid JSON — check for a trailing comma or missing quote."
    errorEl.hidden = false
    return
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
    showSuccess("Effect config updated")
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
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
      "No studio override found in this browser. Tune an effect in /studio and 'Save to browser' first."
    errorEl.hidden = false
    return
  }
  try {
    fillTextarea(JSON.parse(stored))
    showSuccess("Imported this browser's studio values — review, then Save.")
  } catch {
    errorEl.textContent = "This browser's studio override is corrupt and couldn't be read."
    errorEl.hidden = false
  }
}

export function initEffectConfig() {
  getFormElement("effect-config-form").addEventListener("submit", handleSubmit)
  getButtonElement("effect-config-reset-btn").addEventListener("click", handleReset)
  getButtonElement("effect-config-import-btn").addEventListener("click", handleImport)
}
