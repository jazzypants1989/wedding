/** @file Control panel UI — floating button + toggle panel with categories */

import { getEffects, isEnabled, toggle, enableAll, disableAll } from "./effect-manager.js"
import { EFFECT_CATEGORIES } from "./effect-config.js"

export function initControlPanel() {
  let isOpen = false

  // --- Build the toggle button ---
  const btn = document.createElement("button")
  btn.className = "effects-toggle-btn"
  btn.setAttribute("aria-label", "Toggle effects panel")
  btn.setAttribute("aria-expanded", "false")

  const sparkleIcon = document.createElement("div")
  sparkleIcon.className = "sparkle-icon"

  const diagonal = document.createElement("div")
  diagonal.className = "sparkle-icon-diagonal"
  sparkleIcon.appendChild(diagonal)

  btn.appendChild(sparkleIcon)

  // --- Build the panel ---
  const panel = document.createElement("div")
  panel.className = "effects-panel"
  panel.setAttribute("role", "dialog")
  panel.setAttribute("aria-label", "Visual effects controls")

  // Header
  const header = document.createElement("div")
  header.className = "effects-panel-header"

  const title = document.createElement("h3")
  title.className = "effects-panel-title"
  title.textContent = "Magic & Sparkles"

  const subtitle = document.createElement("p")
  subtitle.className = "effects-panel-subtitle"
  subtitle.textContent = "Toggle fun visual effects"

  header.appendChild(title)
  header.appendChild(subtitle)
  panel.appendChild(header)

  // Effect list — grouped by category
  const list = document.createElement("div")
  list.className = "effects-panel-list"

  const effects = getEffects()
  /** @type {Map<string, HTMLInputElement>} */
  const checkboxes = new Map()

  // Build a lookup from effect id to effect data
  /** @type {Map<string, { id: string, label: string }>} */
  const effectMap = new Map()
  for (const effect of effects) {
    effectMap.set(effect.id, effect)
  }

  // Render effects grouped by category
  const categoryKeys = Object.keys(EFFECT_CATEGORIES)
  for (let c = 0; c < categoryKeys.length; c++) {
    const catKey = categoryKeys[c]
    const category = EFFECT_CATEGORIES[catKey]

    // Category header
    const catHeader = document.createElement("div")
    catHeader.className = "effects-panel-category"
    catHeader.textContent = category.label
    list.appendChild(catHeader)

    // Effects in this category
    for (let i = 0; i < category.effectIds.length; i++) {
      const effectId = category.effectIds[i]
      const effect = effectMap.get(effectId)
      if (!effect) continue

      const item = document.createElement("div")
      item.className = "effects-panel-item"

      const label = document.createElement("span")
      label.className = "effects-panel-label"
      label.textContent = effect.label

      const toggleSwitch = document.createElement("label")
      toggleSwitch.className = "toggle-switch"

      const input = document.createElement("input")
      input.type = "checkbox"
      input.checked = isEnabled(effect.id)
      input.setAttribute("aria-label", effect.label)

      const slider = document.createElement("span")
      slider.className = "toggle-slider"

      const eid = effect.id
      input.addEventListener("change", function () {
        toggle(eid, input.checked)
      })

      checkboxes.set(eid, input)

      toggleSwitch.appendChild(input)
      toggleSwitch.appendChild(slider)

      item.appendChild(label)
      item.appendChild(toggleSwitch)
      list.appendChild(item)
    }
  }

  panel.appendChild(list)

  // Bulk action buttons
  const actions = document.createElement("div")
  actions.className = "effects-panel-actions"

  const allOnBtn = document.createElement("button")
  allOnBtn.className = "effects-panel-btn effects-panel-btn--on"
  allOnBtn.textContent = "All On"
  allOnBtn.addEventListener("click", function () {
    enableAll()
    for (const [, cb] of checkboxes) {
      cb.checked = true
    }
  })

  const allOffBtn = document.createElement("button")
  allOffBtn.className = "effects-panel-btn effects-panel-btn--off"
  allOffBtn.textContent = "All Off"
  allOffBtn.addEventListener("click", function () {
    disableAll()
    for (const [, cb] of checkboxes) {
      cb.checked = false
    }
  })

  actions.appendChild(allOnBtn)
  actions.appendChild(allOffBtn)
  panel.appendChild(actions)

  // Customize Effects link
  const configLink = document.createElement("a")
  configLink.className = "effects-panel-config-link"
  configLink.href = "/effects"
  configLink.textContent = "Customize Effects"
  panel.appendChild(configLink)

  // --- Panel open/close logic ---
  function openPanel() {
    isOpen = true
    panel.classList.add("open")
    btn.setAttribute("aria-expanded", "true")
  }

  function closePanel() {
    isOpen = false
    panel.classList.remove("open")
    btn.setAttribute("aria-expanded", "false")
  }

  function togglePanel() {
    if (isOpen) {
      closePanel()
    } else {
      openPanel()
    }
  }

  btn.addEventListener("click", function (e) {
    e.stopPropagation()
    togglePanel()
  })

  // Close on Escape
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) {
      closePanel()
      btn.focus()
    }
  })

  // Close on click outside
  document.addEventListener("click", function (e) {
    if (!isOpen) return
    if (!(e.target instanceof Node)) return
    if (panel.contains(e.target) || btn.contains(e.target)) return
    closePanel()
  })

  // --- Mount ---
  document.body.appendChild(panel)
  document.body.appendChild(btn)
}
