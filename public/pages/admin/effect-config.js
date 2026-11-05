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
 *
 *  Above it, a table of which pages each of the active theme's effects runs on.
 *  The table holds no state of its own: a tick rewrites the `pages` key in the
 *  textarea's JSON and leaves everything else there alone, and the textarea's
 *  contents decide what the table shows. So the two can't disagree, and Save is
 *  the same Save.
 */
/** @import * as Types from './types.js' */
/** @import * as EffectTypes from '../../effects/types.js' */

import { api, showError, showSuccess } from "./utils.js"
import { registerPanel, addGuard, setCrumbs } from "./router.js"
import { openConfirm } from "./confirm.js"
import {
  html,
  getElement,
  getTextAreaElement,
  getButtonElement,
  getFormElement,
  getErrorMessage,
} from "../utils.js"
import { EFFECT_DEFINITIONS, effectRunsOn } from "../../effects/registry.js"
import { PLACEABLE_EFFECT_PAGES, effectPlacedOn } from "../../effects/pages.js"
import { resolveTheme } from "../../effects/themes.js"
import { LABELS } from "../../effects/control-meta.js"
import {
  parseOverrideText,
  placementOf,
  toggledPlacement,
  withPlacement,
} from "./effect-placement.js"

/** Shared contract with the effects read side + studio write side. */
const STUDIO_STORAGE_KEY = "effect-config-override"

/** The column heading for each placeable page.
 *  @type {Partial<Record<EffectTypes.EffectPage, string>>} */
const PAGE_LABELS = { home: "Home", guestbook: "Guestbook", gallery: "Gallery", rsvp: "RSVP" }

/** The textarea as last loaded or saved — the dirty baseline. */
let saved = /** @type {string | null} */ (null)

/** The theme the site is running, as the server has it: this page carries no
 *  data-effect-theme, and the theme can be changed in this same session.
 *  @type {EffectTypes.EffectTheme | null} */
let activeTheme = null

/** @param {EffectTypes.EffectPage} page @returns {string} */
function pageLabel(page) {
  return PAGE_LABELS[page] ?? page
}

/** Draw one row per effect in the active theme. Ticks are filled by syncPlacement,
 *  so typing in the JSON never rebuilds the table and a tick keeps its focus. */
function renderPlacementTable() {
  const theme = activeTheme
  if (!theme) return
  getElement("effect-pages-theme").textContent = theme.label
  const defs = theme.effectIds.flatMap((id) => EFFECT_DEFINITIONS.find((d) => d.id === id) ?? [])

  const rows = defs.map((def) => {
    const name = /** @type {Record<string, string>} */ (LABELS)[def.id] ?? def.id
    const usable = PLACEABLE_EFFECT_PAGES.filter((page) => effectRunsOn(def, page))
    const limited = usable.length < PLACEABLE_EFFECT_PAGES.length
    const flag = limited ? "1" : ""
    return html`<tr>
      <th scope="row">${name}${
        limited
          ? html`<span class="fx-pages-why muted small"
              >Only on ${usable.map(pageLabel).join(", ")}: built for that page's layout</span
            >`
          : ""
      }</th>
      ${PLACEABLE_EFFECT_PAGES.map(
        (page) => html`<td>
          <input type="checkbox" data-effect="${def.id}" data-page="${page}" data-limited="${flag}"
            aria-label="${name} on ${pageLabel(page)}">
        </td>`,
      )}
      <td>
        <input type="checkbox" data-effect="${def.id}" data-page="all" data-limited="${flag}"
          aria-label="${name} on all pages">
      </td>
    </tr>`
  })

  getElement("effect-pages").innerHTML = html`<table class="fx-pages-table">
    <thead>
      <tr>
        <th scope="col">Effect</th>
        ${PLACEABLE_EFFECT_PAGES.map((page) => html`<th scope="col">${pageLabel(page)}</th>`)}
        <th scope="col">All pages</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
  getElement("effect-pages-section").hidden = false
  syncPlacement()
}

/** Make the ticks say what the textarea says. JSON the table can't read leaves them
 *  where they were, disabled, with a note. */
function syncPlacement() {
  const theme = activeTheme
  if (!theme) return
  const override = parseOverrideText(getTextAreaElement("effect-config-json").value)
  getElement("effect-pages-note").hidden = override !== null
  for (const box of getElement("effect-pages").querySelectorAll("input")) {
    box.disabled = override === null || box.dataset.limited === "1"
    if (override === null) continue
    const current = placementOf(override, theme, box.dataset.effect ?? "")
    const onCount = PLACEABLE_EFFECT_PAGES.filter((p) => effectPlacedOn(current, p)).length
    if (box.dataset.page === "all") {
      box.checked = onCount === PLACEABLE_EFFECT_PAGES.length
      box.indeterminate = onCount > 0 && !box.checked
    } else {
      const page = /** @type {EffectTypes.EffectPage} */ (box.dataset.page)
      box.checked = effectPlacedOn(current, page)
    }
  }
}

/** A tick: rewrite that effect's `pages` in the textarea. Save publishes it.
 *  @param {Event} e */
function handlePlacementChange(e) {
  const box = e.target
  if (!(box instanceof HTMLInputElement) || !activeTheme) return
  const override = parseOverrideText(getTextAreaElement("effect-config-json").value)
  if (!override) return
  const id = box.dataset.effect ?? ""
  const page = box.dataset.page
  /** @type {EffectTypes.EffectPlacement} */
  let next
  if (page === "all") {
    next = box.checked ? "all" : []
  } else {
    const current = placementOf(override, activeTheme, id)
    next = toggledPlacement(current, /** @type {EffectTypes.EffectPage} */ (page), box.checked)
  }
  fillTextarea(withPlacement(override, activeTheme, id, next), false)
}

function handleTextareaInput() {
  updateDirtyNote()
  syncPlacement()
}

async function loadActiveTheme() {
  const data = /** @type {Types.SiteContentResponse} */ (await api("/api/admin/site-content"))
  const theme = resolveTheme(data.content.theme)
  if (theme === activeTheme) return
  activeTheme = theme
  renderPlacementTable()
}

/** @param {Record<string, unknown>} override @param {boolean} [isSaved] */
function fillTextarea(override, isSaved = true) {
  const text = JSON.stringify(override, null, 2)
  getTextAreaElement("effect-config-json").value = text
  if (isSaved) saved = text
  updateDirtyNote()
  syncPlacement()
}

/** @returns {boolean} edits since the last load / save */
export function isEffectConfigDirty() {
  return saved !== null && getTextAreaElement("effect-config-json").value !== saved
}

function updateDirtyNote() {
  getElement("effect-config-dirty").hidden = !isEffectConfigDirty()
}

export async function loadEffectConfig() {
  // Without the theme there's no table, but the JSON still works.
  await loadActiveTheme().catch((err) => console.error("Failed to load the active theme:", err))
  try {
    // Never clobber edits still sitting in the textarea (a re-login, a re-visit).
    if (isEffectConfigDirty()) return
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
  getTextAreaElement("effect-config-json").addEventListener("input", handleTextareaInput)
  getElement("effect-pages").addEventListener("change", handlePlacementChange)
  getFormElement("effect-config-form").addEventListener("submit", handleSubmit)
  getButtonElement("effect-config-reset-btn").addEventListener("click", handleReset)
  getButtonElement("effect-config-import-btn").addEventListener("click", handleImport)
}
