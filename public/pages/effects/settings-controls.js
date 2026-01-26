/** @file Settings control builders — slider, color palette, select, reset */

/**
 * Create a range slider control.
 * @param {object} options
 * @param {string} options.id - Unique identifier
 * @param {string} options.label - Display label
 * @param {number} options.min
 * @param {number} options.max
 * @param {number} options.step
 * @param {number} options.value - Current value
 * @param {function} options.onChange - Called with new value
 * @returns {HTMLElement}
 */
export function createSlider(options) {
  const wrapper = document.createElement("div")
  wrapper.className = "settings-control settings-slider"

  const labelRow = document.createElement("div")
  labelRow.className = "settings-slider-header"

  const label = document.createElement("label")
  label.className = "settings-label"
  label.textContent = options.label
  label.setAttribute("for", "slider-" + options.id)

  const valueDisplay = document.createElement("span")
  valueDisplay.className = "settings-slider-value"
  valueDisplay.textContent = formatValue(options.value, options.step)

  labelRow.appendChild(label)
  labelRow.appendChild(valueDisplay)

  const input = document.createElement("input")
  input.type = "range"
  input.className = "settings-range"
  input.id = "slider-" + options.id
  input.min = String(options.min)
  input.max = String(options.max)
  input.step = String(options.step)
  input.value = String(options.value)

  input.addEventListener("input", function () {
    var val = parseFloat(input.value)
    valueDisplay.textContent = formatValue(val, options.step)
    options.onChange(val)
  })

  wrapper.appendChild(labelRow)
  wrapper.appendChild(input)

  return wrapper
}

/**
 * Format a slider value for display.
 * @param {number} value
 * @param {number} step
 * @returns {string}
 */
function formatValue(value, step) {
  if (step >= 1) return String(Math.round(value))
  if (step >= 0.1) return value.toFixed(1)
  return value.toFixed(2)
}

/**
 * Create a color palette picker.
 * @param {object} options
 * @param {string} options.id - Unique identifier
 * @param {string} options.label - Display label
 * @param {string[]} options.presets - Available color presets
 * @param {string[]} options.selected - Currently selected colors
 * @param {function} options.onChange - Called with new color array
 * @returns {HTMLElement}
 */
export function createColorPalettePicker(options) {
  const wrapper = document.createElement("div")
  wrapper.className = "settings-control settings-palette"

  const label = document.createElement("div")
  label.className = "settings-label"
  label.textContent = options.label

  const grid = document.createElement("div")
  grid.className = "settings-palette-grid"

  var selected = options.selected ? options.selected.slice() : options.presets.slice()

  for (var i = 0; i < options.presets.length; i++) {
    var color = options.presets[i]
    var swatch = document.createElement("button")
    swatch.type = "button"
    swatch.className = "settings-swatch"
    swatch.style.backgroundColor = color
    swatch.setAttribute("aria-label", "Color " + color)
    swatch.setAttribute("data-color", color)

    if (isColorSelected(color, selected)) {
      swatch.classList.add("settings-swatch--selected")
    }

    swatch.addEventListener("click", createSwatchHandler(swatch, color, selected, grid, options))

    grid.appendChild(swatch)
  }

  wrapper.appendChild(label)
  wrapper.appendChild(grid)

  return wrapper
}

/**
 * Check if a color is in the selected array.
 * @param {string} color
 * @param {string[]} selected
 * @returns {boolean}
 */
function isColorSelected(color, selected) {
  for (var i = 0; i < selected.length; i++) {
    if (selected[i] === color) return true
  }
  return false
}

/**
 * Create a click handler for a color swatch.
 * @param {HTMLElement} swatch
 * @param {string} color
 * @param {string[]} selected
 * @param {HTMLElement} grid
 * @param {object} options
 * @returns {function}
 */
function createSwatchHandler(swatch, color, selected, grid, options) {
  return function () {
    var idx = -1
    for (var i = 0; i < selected.length; i++) {
      if (selected[i] === color) {
        idx = i
        break
      }
    }

    if (idx >= 0) {
      // Don't allow deselecting all colors — keep at least 1
      if (selected.length <= 1) return
      selected.splice(idx, 1)
      swatch.classList.remove("settings-swatch--selected")
    } else {
      selected.push(color)
      swatch.classList.add("settings-swatch--selected")
    }

    options.onChange(selected.slice())
  }
}

/**
 * Create a select dropdown control.
 * @param {object} options
 * @param {string} options.id - Unique identifier
 * @param {string} options.label - Display label
 * @param {Array<{value: string, label: string}>} options.choices
 * @param {string} options.selected - Currently selected value
 * @param {function} options.onChange - Called with new value
 * @returns {HTMLElement}
 */
export function createSelect(options) {
  const wrapper = document.createElement("div")
  wrapper.className = "settings-control settings-select"

  const label = document.createElement("label")
  label.className = "settings-label"
  label.textContent = options.label
  label.setAttribute("for", "select-" + options.id)

  const select = document.createElement("select")
  select.className = "settings-dropdown"
  select.id = "select-" + options.id

  for (var i = 0; i < options.choices.length; i++) {
    var choice = options.choices[i]
    var opt = document.createElement("option")
    opt.value = choice.value
    opt.textContent = choice.label
    if (choice.value === options.selected) {
      opt.selected = true
    }
    select.appendChild(opt)
  }

  select.addEventListener("change", function () {
    options.onChange(select.value)
  })

  wrapper.appendChild(label)
  wrapper.appendChild(select)

  return wrapper
}

/**
 * Create a reset button.
 * @param {object} options
 * @param {function} options.onClick - Called when clicked
 * @returns {HTMLElement}
 */
export function createResetButton(options) {
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = "settings-reset-btn"
  btn.textContent = "Reset to Defaults"

  btn.addEventListener("click", function () {
    options.onClick()
  })

  return btn
}
