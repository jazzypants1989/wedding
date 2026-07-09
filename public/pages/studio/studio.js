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
import { LABELS, getHint, numericBounds, serializeConfig } from "./controls.js"

// ---- State -----------------------------------------------------------------

let currentEffectId = "entrance"
/** @type {Record<string, unknown>} */
let config = {}
/** @type {EffectTypes.EffectInstance | null} */
let instance = null
/** @type {ReturnType<typeof setTimeout> | null} */
let replayTimer = null

// ---- Small helpers ---------------------------------------------------------

/** @param {unknown} v @returns {v is number[]} */
function isNumberArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number")
}

/** @param {unknown} v @returns {v is string[]} */
function isStringArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")
}

/** Turn a camelCase key into a spaced Title-case label (no regex). */
/** @param {string} key @returns {string} */
function prettify(key) {
  let out = ""
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i)
    if (code >= 65 && code <= 90) {
      if (i > 0) out += " "
      out += key[i].toLowerCase()
    } else {
      out += key[i]
    }
  }
  return out.charAt(0).toUpperCase() + out.slice(1)
}

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

// ---- Control builders ------------------------------------------------------

/**
 * A labelled slider + number input bound to a numeric config field.
 * @param {string} labelText @param {number} value @param {Types.NumericBounds} bounds
 * @param {(next: number) => void} onChange
 * @returns {HTMLDivElement}
 */
function numberControl(labelText, value, bounds, onChange) {
  const row = document.createElement("div")
  row.className = "control"

  const head = document.createElement("div")
  head.className = "control-head"
  const label = document.createElement("label")
  label.textContent = labelText
  const readout = document.createElement("span")
  readout.className = "readout"
  readout.textContent = String(value)
  head.appendChild(label)
  head.appendChild(readout)

  const inputs = document.createElement("div")
  inputs.className = "control-inputs"

  const slider = document.createElement("input")
  slider.type = "range"
  slider.min = String(bounds.min)
  slider.max = String(bounds.max)
  slider.step = String(bounds.step)
  slider.value = String(value)

  const number = document.createElement("input")
  number.type = "number"
  number.min = String(bounds.min)
  number.max = String(bounds.max)
  number.step = String(bounds.step)
  number.value = String(value)
  number.className = "num-field"

  /** @param {number} next */
  function commit(next) {
    slider.value = String(next)
    number.value = String(next)
    readout.textContent = String(next)
    onChange(next)
    scheduleReplay()
  }

  slider.addEventListener("input", () => commit(slider.valueAsNumber))
  number.addEventListener("input", () => {
    if (number.value !== "") commit(number.valueAsNumber)
  })

  inputs.appendChild(slider)
  inputs.appendChild(number)
  row.appendChild(head)
  row.appendChild(inputs)
  return row
}

/**
 * A min/max pair bound to a `[number, number]` config field.
 * @param {string} key @param {number[]} value @param {Types.NumericBounds} bounds
 * @returns {HTMLDivElement}
 */
function rangeControl(key, value, bounds) {
  const row = document.createElement("div")
  row.className = "control"

  const label = document.createElement("label")
  label.textContent = prettify(key) + " (range)"
  row.appendChild(label)

  const inputs = document.createElement("div")
  inputs.className = "control-inputs range-inputs"

  const pair = [value[0], value[1]]
  /** @param {number} idx @param {string} tag */
  function makeInput(idx, tag) {
    const field = document.createElement("input")
    field.type = "number"
    field.min = String(bounds.min)
    field.max = String(bounds.max)
    field.step = String(bounds.step)
    field.value = String(pair[idx])
    field.className = "num-field"
    field.setAttribute("aria-label", prettify(key) + " " + tag)
    field.addEventListener("input", () => {
      if (field.value === "") return
      pair[idx] = field.valueAsNumber
      config[key] = [pair[0], pair[1]]
      scheduleReplay()
    })
    return field
  }

  const min = document.createElement("span")
  min.className = "range-tag"
  min.textContent = "min"
  const max = document.createElement("span")
  max.className = "range-tag"
  max.textContent = "max"

  inputs.appendChild(min)
  inputs.appendChild(makeInput(0, "min"))
  inputs.appendChild(max)
  inputs.appendChild(makeInput(1, "max"))
  row.appendChild(inputs)
  return row
}

/**
 * A list of editable color strings, each with a live swatch.
 * @param {string} key @param {string[]} value
 * @returns {HTMLDivElement}
 */
function colorListControl(key, value) {
  const row = document.createElement("div")
  row.className = "control"

  const label = document.createElement("label")
  label.textContent = prettify(key) + " (" + value.length + ")"
  row.appendChild(label)

  const list = document.createElement("div")
  list.className = "color-list"
  const colors = value.slice()

  colors.forEach((color, idx) => {
    const item = document.createElement("div")
    item.className = "color-item"
    const swatch = document.createElement("span")
    swatch.className = "swatch"
    swatch.style.background = color
    const field = document.createElement("input")
    field.type = "text"
    field.value = color
    field.className = "color-field"
    field.setAttribute("aria-label", prettify(key) + " " + (idx + 1))
    field.addEventListener("input", () => {
      colors[idx] = field.value
      swatch.style.background = field.value
      config[key] = colors.slice()
      scheduleReplay()
    })
    item.appendChild(swatch)
    item.appendChild(field)
    list.appendChild(item)
  })

  row.appendChild(list)
  return row
}

/**
 * A dropdown bound to a string config field with known options.
 * @param {string} key @param {string} value @param {string[]} options
 * @returns {HTMLDivElement}
 */
function selectControl(key, value, options) {
  const row = document.createElement("div")
  row.className = "control"

  const label = document.createElement("label")
  label.textContent = prettify(key)
  row.appendChild(label)

  const select = document.createElement("select")
  select.className = "select-field"
  for (const opt of options) {
    const o = document.createElement("option")
    o.value = opt
    o.textContent = opt
    if (opt === value) o.selected = true
    select.appendChild(o)
  }
  select.addEventListener("change", () => {
    config[key] = select.value
    scheduleReplay()
  })
  row.appendChild(select)
  return row
}

/**
 * A free-text control bound to a string config field.
 * @param {string} key @param {string} value
 * @returns {HTMLDivElement}
 */
function textControl(key, value) {
  const row = document.createElement("div")
  row.className = "control"
  const label = document.createElement("label")
  label.textContent = prettify(key)
  const field = document.createElement("input")
  field.type = "text"
  field.value = value
  field.className = "text-field"
  field.addEventListener("input", () => {
    config[key] = field.value
    scheduleReplay()
  })
  row.appendChild(label)
  row.appendChild(field)
  return row
}

/**
 * A checkbox bound to a boolean config field.
 * @param {string} key @param {boolean} value
 * @returns {HTMLDivElement}
 */
function boolControl(key, value) {
  const row = document.createElement("div")
  row.className = "control control-inline"
  const label = document.createElement("label")
  label.textContent = prettify(key)
  const field = document.createElement("input")
  field.type = "checkbox"
  field.checked = value
  field.addEventListener("change", () => {
    config[key] = field.checked
    scheduleReplay()
  })
  row.appendChild(field)
  row.appendChild(label)
  return row
}

/** Build the control for one config entry, dispatching on its value type. */
/** @param {string} key @param {unknown} value @returns {HTMLElement} */
function buildControl(key, value) {
  const hint = getHint(currentEffectId, key)
  if (isNumberArray(value)) {
    return rangeControl(key, value, numericBounds(value[0], hint))
  }
  if (isStringArray(value)) {
    return colorListControl(key, value)
  }
  if (typeof value === "number") {
    return numberControl(prettify(key), value, numericBounds(value, hint), (next) => {
      config[key] = next
    })
  }
  if (typeof value === "string") {
    if (hint && hint.options) return selectControl(key, value, hint.options)
    return textControl(key, value)
  }
  if (typeof value === "boolean") {
    return boolControl(key, value)
  }
  // Unknown shape — show it read-only so nothing silently vanishes.
  const row = document.createElement("div")
  row.className = "control"
  const label = document.createElement("label")
  label.textContent = prettify(key) + " (unsupported)"
  const pre = document.createElement("code")
  pre.textContent = JSON.stringify(value)
  row.appendChild(label)
  row.appendChild(pre)
  return row
}

// ---- Rendering -------------------------------------------------------------

function renderControls() {
  const container = getElement("controls")
  container.textContent = ""
  for (const [key, value] of Object.entries(config)) {
    container.appendChild(buildControl(key, value))
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
  config = structuredClone(getDefaultConfig(id) || {})
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

function init() {
  renderEffectList()

  getButtonElement("replay-btn").addEventListener("click", replay)
  getButtonElement("stop-btn").addEventListener("click", stopInstance)
  getButtonElement("copy-btn").addEventListener("click", copyValues)
  getButtonElement("reset-btn").addEventListener("click", () => {
    loadConfigFor(currentEffectId)
    renderControls()
    replay()
  })

  loadConfigFor(currentEffectId)
  renderControls()
  replay()
}

init()
