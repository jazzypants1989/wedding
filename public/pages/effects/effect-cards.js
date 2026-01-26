/** @file Effect card builder — creates config cards with preview, toggle, controls */

import { getSchema } from "./effect-config.js"
import { createSlider, createColorPalettePicker, createSelect, createResetButton } from "./settings-controls.js"
import { createPreview, EFFECT_DESCRIPTIONS } from "./effect-preview.js"

/**
 * Build a card element for one effect.
 * @param {object} options
 * @param {string} options.effectId
 * @param {string} options.label
 * @param {Record<string, *>} options.config - Current config values
 * @param {boolean} options.enabled - Current on/off state
 * @param {function} options.onToggle - Called with (effectId, boolean)
 * @param {function} options.onConfigChange - Called with (effectId, key, value)
 * @param {function} options.onReset - Called with (effectId)
 * @returns {{ element: HTMLElement, updateToggle: (boolean) => void, preview: { start: () => void, stop: () => void } }}
 */
export function createEffectCard(options) {
  var card = document.createElement("div")
  card.className = "effect-card"
  card.setAttribute("data-effect-id", options.effectId)

  // Preview area
  var previewBox = document.createElement("div")
  previewBox.className = "effect-card-preview"
  card.appendChild(previewBox)

  // Title row with toggle
  var titleRow = document.createElement("div")
  titleRow.className = "effect-card-title-row"

  var titleText = document.createElement("h3")
  titleText.className = "effect-card-title"
  titleText.textContent = options.label

  var toggleSwitch = document.createElement("label")
  toggleSwitch.className = "toggle-switch"

  var toggleInput = document.createElement("input")
  toggleInput.type = "checkbox"
  toggleInput.checked = options.enabled
  toggleInput.setAttribute("aria-label", "Enable " + options.label)

  var toggleSlider = document.createElement("span")
  toggleSlider.className = "toggle-slider"

  toggleSwitch.appendChild(toggleInput)
  toggleSwitch.appendChild(toggleSlider)

  titleRow.appendChild(titleText)
  titleRow.appendChild(toggleSwitch)
  card.appendChild(titleRow)

  // Description
  var desc = EFFECT_DESCRIPTIONS[options.effectId]
  if (desc) {
    var descEl = document.createElement("p")
    descEl.className = "effect-card-desc"
    descEl.textContent = desc
    card.appendChild(descEl)
  }

  // Controls section
  var controlsSection = document.createElement("div")
  controlsSection.className = "effect-card-controls"

  var schema = getSchema(options.effectId)
  if (schema) {
    var schemaKeys = Object.keys(schema)
    for (var i = 0; i < schemaKeys.length; i++) {
      var key = schemaKeys[i]
      var schemaDef = schema[key]
      var currentVal = options.config[key]
      var control = buildControl(options.effectId, key, schemaDef, currentVal, options.onConfigChange)
      if (control) {
        controlsSection.appendChild(control)
      }
    }
  }

  card.appendChild(controlsSection)

  // Reset button
  var resetBtn = createResetButton({
    onClick: function () {
      options.onReset(options.effectId)
    },
  })
  card.appendChild(resetBtn)

  // Toggle handler
  var eid = options.effectId
  toggleInput.addEventListener("change", function () {
    options.onToggle(eid, toggleInput.checked)
  })

  // Create the preview
  var preview = createPreview(options.effectId, previewBox)

  return {
    element: card,
    updateToggle: function (val) {
      toggleInput.checked = val
    },
    preview: preview,
  }
}

/**
 * Build a single control from schema definition.
 * @param {string} effectId
 * @param {string} key
 * @param {object} schemaDef
 * @param {*} currentVal
 * @param {function} onConfigChange
 * @returns {HTMLElement|null}
 */
function buildControl(effectId, key, schemaDef, currentVal, onConfigChange) {
  var controlId = effectId + "-" + key

  if (schemaDef.type === "slider") {
    return createSlider({
      id: controlId,
      label: schemaDef.label,
      min: schemaDef.min,
      max: schemaDef.max,
      step: schemaDef.step,
      value: currentVal !== undefined ? currentVal : schemaDef.min,
      onChange: function (val) {
        onConfigChange(effectId, key, val)
      },
    })
  }

  if (schemaDef.type === "colorPalette") {
    return createColorPalettePicker({
      id: controlId,
      label: schemaDef.label,
      presets: schemaDef.presets,
      selected: Array.isArray(currentVal) ? currentVal : schemaDef.presets,
      onChange: function (val) {
        onConfigChange(effectId, key, val)
      },
    })
  }

  if (schemaDef.type === "select") {
    return createSelect({
      id: controlId,
      label: schemaDef.label,
      choices: schemaDef.choices,
      selected: currentVal !== undefined ? String(currentVal) : schemaDef.choices[0].value,
      onChange: function (val) {
        onConfigChange(effectId, key, val)
      },
    })
  }

  return null
}
