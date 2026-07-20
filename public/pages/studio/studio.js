/** @file Effect studio — live parameter tuning for the visual effects.
 *
 *  Generic across every effect in the registry: it reads each effect's
 *  `defaults` from config.js and renders a control per parameter (slider,
 *  range pair, color list, enum select, or checkbox), replaying the effect
 *  live as values change.
 */
/** @import * as Types from "./types.js" */
/** @import * as EffectTypes from "../../effects/types.js" */

import { EFFECT_DEFINITIONS } from "../../effects/main.js"
import { getDefaultConfig } from "../../effects/config.js"
import {
  getElement,
  getButtonElement,
} from "../utils.js"
import { LABELS, getHint } from "../../effects/control-meta.js"
import { buildControl } from "../../components/effect-controls.js"
import { serializeConfig } from "./controls.js"
import {
  readOverride,
  saveOverride,
  clearOverride,
  clearAll,
  seedFromOverride,
} from "./override-store.js"

// ---- State -----------------------------------------------------------------

let currentEffectId = "entrance"
/** @type {Record<string, unknown>} */
let config = {}
/** @type {EffectTypes.EffectInstance | null} */
let instance = null
/** @type {ReturnType<typeof setTimeout> | null} */
let replayTimer = null

// ---- Small helpers ---------------------------------------------------------

/** @param {string} message @param {"ok" | "err"} kind */
function flash(message, kind) {
  const el = getElement("flash")
  el.textContent = message
  el.className = "flash flash-" + kind
}

// ---- Replay lifecycle ------------------------------------------------------

function stopInstance() {
  if (instance) {
    try {
      instance.stop()
    } catch {
      // ignore teardown failures
    }
    instance = null
  }
}

/** @returns {Types.EffectFactory | null} */
function currentCreate() {
  for (const def of EFFECT_DEFINITIONS) {
    if (def.id === currentEffectId) return def.create
  }
  return null
}

function replay() {
  stopInstance()
  const create = currentCreate()
  if (!create) return
  const label = LABELS[/** @type {keyof typeof LABELS} */ (currentEffectId)] || currentEffectId
  try {
    const inst = create(structuredClone(config))
    inst.start()
    instance = inst
    flash("Replaying " + label, "ok")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    flash(label + " threw: " + msg, "err")
  }
}

function scheduleReplay() {
  if (replayTimer !== null) clearTimeout(replayTimer)
  replayTimer = setTimeout(function () {
    replayTimer = null
    replay()
  }, 160)
}

// ---- Rendering -------------------------------------------------------------

function renderControls() {
  const container = getElement("controls")
  container.textContent = ""
  // Reproduce the studio's original behaviour: an edit writes the config field
  // and schedules a live replay. The generic builders live in the shared
  // production module now (components/effect-controls.js).
  /** @type {import("../../components/types.js").ControlBuildContext} */
  const ctx = {
    effectId: currentEffectId,
    getHint,
    onChange: (key, value) => {
      config[key] = value
      scheduleReplay()
    },
  }
  for (const [key, value] of Object.entries(config)) {
    container.appendChild(buildControl(key, value, ctx))
  }
}

function renderEffectList() {
  const list = getElement("effect-list")
  list.textContent = ""
  for (const def of EFFECT_DEFINITIONS) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "effect-btn"
    btn.textContent = LABELS[/** @type {keyof typeof LABELS} */ (def.id)] || def.id
    btn.dataset.id = def.id
    if (def.id === currentEffectId) btn.classList.add("active")
    btn.addEventListener("click", () => selectEffect(def.id))
    list.appendChild(btn)
  }
}

/** @param {string} id */
function loadConfigFor(id) {
  // Seed from defaults ⊕ this browser's saved override so the studio matches
  // what the real pages render (and Reset visibly returns to defaults).
  config = seedFromOverride(getDefaultConfig(id) || {}, readOverride(id))
}

/** @param {string} id */
function selectEffect(id) {
  currentEffectId = id
  loadConfigFor(id)
  const list = getElement("effect-list")
  for (const child of Array.from(list.children)) {
    child.classList.toggle(
      "active",
      child instanceof HTMLElement && child.dataset.id === id,
    )
  }
  renderControls()
  replay()
}

// ---- Wiring ----------------------------------------------------------------

function copyValues() {
  const text = serializeConfig(config)
  navigator.clipboard.writeText(text).then(
    () => flash("Copied config to clipboard", "ok"),
    () => flash("Clipboard blocked — see console", "err"),
  )
  console.log(text)
}

/** Persist the current effect's tuned config (as a sparse diff) to this browser. */
function saveToBrowser() {
  saveOverride(currentEffectId, config, getDefaultConfig(currentEffectId) || {})
  flash("Saved to this browser — reload a page to see it", "ok")
}

function init() {
  renderEffectList()

  getButtonElement("replay-btn").addEventListener("click", replay)
  getButtonElement("stop-btn").addEventListener("click", stopInstance)
  getButtonElement("copy-btn").addEventListener("click", copyValues)
  getButtonElement("save-btn").addEventListener("click", saveToBrowser)
  getButtonElement("reset-btn").addEventListener("click", () => {
    // Reset = drop this effect's saved override and reload its defaults.
    clearOverride(currentEffectId)
    loadConfigFor(currentEffectId)
    renderControls()
    replay()
    flash("Reset to defaults", "ok")
  })
  getButtonElement("clear-all-btn").addEventListener("click", () => {
    clearAll()
    loadConfigFor(currentEffectId)
    renderControls()
    replay()
    flash("Cleared all overrides", "ok")
  })

  loadConfigFor(currentEffectId)
  renderControls()
  replay()
}

init()
