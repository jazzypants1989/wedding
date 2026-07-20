/** @file Generic per-parameter effect controls.
 *
 *  Extracted from the dev-gated studio (public/pages/studio/studio.js) so the
 *  same control builders can drive the thank-you card composer's effect editor
 *  in production. `buildControl(key, value, ctx)` dispatches on the value's type
 *  (slider, min/max range pair, color list, enum select, free text, or
 *  checkbox) and reports edits through `ctx.onChange(key, newValue)` — it never
 *  touches any module-global state, so multiple consumers can coexist.
 */
/** @import * as Types from "./types.js" */

import { numericBounds } from "../effects/control-meta.js"

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

/**
 * A labelled slider + number input bound to a numeric config field.
 * @param {string} labelText @param {number} value
 * @param {{min: number, max: number, step: number}} bounds
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
 * @param {string} key @param {number[]} value
 * @param {{min: number, max: number, step: number}} bounds
 * @param {(next: number[]) => void} onChange
 * @returns {HTMLDivElement}
 */
function rangeControl(key, value, bounds, onChange) {
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
      onChange([pair[0], pair[1]])
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
 * @param {(next: string[]) => void} onChange
 * @returns {HTMLDivElement}
 */
function colorListControl(key, value, onChange) {
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
      onChange(colors.slice())
    })
    item.appendChild(swatch)
    item.appendChild(field)
    list.appendChild(item)
  })

  row.appendChild(list)
  return row
}

/**
 * A list of editable text chips for a `string[]` of glyphs/emoji — like
 * colorListControl but with no color swatch (glyphs aren't valid CSS colors,
 * so a swatch would render blank). Reuses the color-list layout classes.
 * @param {string} key @param {string[]} value
 * @param {(next: string[]) => void} onChange
 * @returns {HTMLDivElement}
 */
function glyphListControl(key, value, onChange) {
  const row = document.createElement("div")
  row.className = "control"

  const label = document.createElement("label")
  label.textContent = prettify(key) + " (" + value.length + ")"
  row.appendChild(label)

  const list = document.createElement("div")
  list.className = "color-list"
  const glyphs = value.slice()

  glyphs.forEach((glyph, idx) => {
    const item = document.createElement("div")
    item.className = "color-item"
    const field = document.createElement("input")
    field.type = "text"
    field.value = glyph
    field.className = "color-field"
    field.setAttribute("aria-label", prettify(key) + " " + (idx + 1))
    field.addEventListener("input", () => {
      glyphs[idx] = field.value
      onChange(glyphs.slice())
    })
    item.appendChild(field)
    list.appendChild(item)
  })

  row.appendChild(list)
  return row
}

/**
 * A dropdown bound to a string config field with known options.
 * @param {string} key @param {string} value @param {string[]} options
 * @param {(next: string) => void} onChange
 * @returns {HTMLDivElement}
 */
function selectControl(key, value, options, onChange) {
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
  select.addEventListener("change", () => onChange(select.value))
  row.appendChild(select)
  return row
}

/**
 * A free-text control bound to a string config field.
 * @param {string} key @param {string} value
 * @param {(next: string) => void} onChange
 * @returns {HTMLDivElement}
 */
function textControl(key, value, onChange) {
  const row = document.createElement("div")
  row.className = "control"
  const label = document.createElement("label")
  label.textContent = prettify(key)
  const field = document.createElement("input")
  field.type = "text"
  field.value = value
  field.className = "text-field"
  field.addEventListener("input", () => onChange(field.value))
  row.appendChild(label)
  row.appendChild(field)
  return row
}

/**
 * A checkbox bound to a boolean config field.
 * @param {string} key @param {boolean} value
 * @param {(next: boolean) => void} onChange
 * @returns {HTMLDivElement}
 */
function boolControl(key, value, onChange) {
  const row = document.createElement("div")
  row.className = "control control-inline"
  const label = document.createElement("label")
  label.textContent = prettify(key)
  const field = document.createElement("input")
  field.type = "checkbox"
  field.checked = value
  field.addEventListener("change", () => onChange(field.checked))
  row.appendChild(field)
  row.appendChild(label)
  return row
}

/** @type {Types.buildControl} */
export function buildControl(key, value, ctx) {
  const emit = (/** @type {unknown} */ next) => ctx.onChange(key, next)
  const hint = ctx.getHint(ctx.effectId, key)
  if (isNumberArray(value)) {
    return rangeControl(key, value, numericBounds(value[0], hint), emit)
  }
  if (isStringArray(value)) {
    if (hint && hint.kind === "glyphs") return glyphListControl(key, value, emit)
    return colorListControl(key, value, emit)
  }
  if (typeof value === "number") {
    return numberControl(prettify(key), value, numericBounds(value, hint), emit)
  }
  if (typeof value === "string") {
    if (hint && hint.options) return selectControl(key, value, hint.options, emit)
    return textControl(key, value, emit)
  }
  if (typeof value === "boolean") {
    return boolControl(key, value, emit)
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
