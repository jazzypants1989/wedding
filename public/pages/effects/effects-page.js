/** @file Effects Studio page — entry point */

import { EFFECT_CATEGORIES, EFFECT_CONFIGS } from "./effect-config.js"
import {
  getEffects,
  isEnabled,
  toggle,
  getConfig,
  setConfig,
  resetConfig,
  enableAll,
  disableAll,
  initEffectManager,
} from "./effect-manager.js"
import { createEffectCard } from "./effect-cards.js"
import { prefersReducedMotion } from "./effect-helpers.js"

/** @type {Array<{ preview: { start: () => void, stop: () => void }, element: HTMLElement, updateToggle: (v: boolean) => void }>} */
var cards = []

/** @type {IntersectionObserver|null} */
var previewObserver = null

function init() {
  // Initialize the effect manager (loads localStorage state/config)
  initEffectManager()

  var container = document.getElementById("effects-card-container")
  if (!container) return

  // Build effect lookup
  var effects = getEffects()
  var effectMap = {}
  for (var i = 0; i < effects.length; i++) {
    effectMap[effects[i].id] = effects[i]
  }

  // Set up preview visibility observer
  var reducedMotion = prefersReducedMotion()
  if (!reducedMotion) {
    previewObserver = new IntersectionObserver(handlePreviewVisibility, { threshold: 0.1 })
  }

  // Build cards by category
  var categoryKeys = Object.keys(EFFECT_CATEGORIES)
  for (var c = 0; c < categoryKeys.length; c++) {
    var catKey = categoryKeys[c]
    var category = EFFECT_CATEGORIES[catKey]

    // Category header
    var catHeader = document.createElement("div")
    catHeader.className = "effects-category-header"
    catHeader.textContent = category.label
    container.appendChild(catHeader)

    // Cards for this category
    for (var e = 0; e < category.effectIds.length; e++) {
      var effectId = category.effectIds[e]
      var effect = effectMap[effectId]
      if (!effect) continue

      var config = getConfig(effectId)
      var card = createEffectCard({
        effectId: effectId,
        label: effect.label,
        config: config,
        enabled: isEnabled(effectId),
        onToggle: handleToggle,
        onConfigChange: handleConfigChange,
        onReset: handleReset,
      })

      container.appendChild(card.element)
      cards.push(card)

      // Observe preview for visibility-based start/stop
      if (previewObserver) {
        var previewEl = card.element.querySelector(".effect-card-preview")
        if (previewEl) {
          previewEl._cardIndex = cards.length - 1
          previewObserver.observe(previewEl)
        }
      }
    }
  }

  // Bulk action buttons
  var allOnBtn = document.getElementById("effects-all-on")
  var allOffBtn = document.getElementById("effects-all-off")
  var resetAllBtn = document.getElementById("effects-reset-all")

  if (allOnBtn) {
    allOnBtn.addEventListener("click", function () {
      enableAll()
      for (var i = 0; i < cards.length; i++) {
        cards[i].updateToggle(true)
      }
    })
  }

  if (allOffBtn) {
    allOffBtn.addEventListener("click", function () {
      disableAll()
      for (var i = 0; i < cards.length; i++) {
        cards[i].updateToggle(false)
      }
    })
  }

  if (resetAllBtn) {
    resetAllBtn.addEventListener("click", function () {
      var effects = getEffects()
      for (var i = 0; i < effects.length; i++) {
        resetConfig(effects[i].id)
      }
      // Rebuild all cards
      rebuildCards(container)
    })
  }

  var randomizeBtn = document.getElementById("effects-randomize")
  if (randomizeBtn) {
    randomizeBtn.addEventListener("click", function () {
      // Turn all off first
      disableAll()

      // Pick 3-5 random effects to enable
      var allEffects = getEffects()
      var shuffled = allEffects.slice()
      for (var si = shuffled.length - 1; si > 0; si--) {
        var sj = Math.floor(Math.random() * (si + 1))
        var temp = shuffled[si]
        shuffled[si] = shuffled[sj]
        shuffled[sj] = temp
      }
      var pickCount = 3 + Math.floor(Math.random() * 3)
      for (var p = 0; p < pickCount && p < shuffled.length; p++) {
        toggle(shuffled[p].id, true)
      }

      // Update all card toggles
      for (var ci = 0; ci < cards.length; ci++) {
        var cardEl = cards[ci].element
        var eid = cardEl.getAttribute("data-effect-id")
        cards[ci].updateToggle(isEnabled(eid))
      }
    })
  }
}

/**
 * Handle IntersectionObserver visibility for previews.
 * Start preview when visible, stop when not.
 */
function handlePreviewVisibility(entries) {
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i]
    var cardIdx = entry.target._cardIndex
    if (cardIdx === undefined) continue
    var card = cards[cardIdx]
    if (!card) continue

    if (entry.isIntersecting) {
      card.preview.start()
    } else {
      card.preview.stop()
    }
  }
}

/**
 * Handle toggling an effect on/off from a card.
 */
function handleToggle(effectId, enabled) {
  toggle(effectId, enabled)
}

/**
 * Handle config change from a control.
 * Uses a debounce to avoid restarting effects on every slider tick.
 */
var configDebounceTimers = {}

function handleConfigChange(effectId, key, value) {
  if (configDebounceTimers[effectId]) {
    clearTimeout(configDebounceTimers[effectId])
  }
  configDebounceTimers[effectId] = setTimeout(function () {
    var partial = {}
    partial[key] = value
    setConfig(effectId, partial)
  }, 300)
}

/**
 * Handle resetting an effect's config to defaults.
 */
function handleReset(effectId) {
  resetConfig(effectId)

  // Find the card and rebuild it
  var container = document.getElementById("effects-card-container")
  if (!container) return

  for (var i = 0; i < cards.length; i++) {
    var card = cards[i]
    var el = card.element
    if (el.getAttribute("data-effect-id") !== effectId) continue

    // Stop preview
    card.preview.stop()

    // Get fresh config and rebuild
    var effects = getEffects()
    var effect = null
    for (var j = 0; j < effects.length; j++) {
      if (effects[j].id === effectId) {
        effect = effects[j]
        break
      }
    }
    if (!effect) break

    var newCard = createEffectCard({
      effectId: effectId,
      label: effect.label,
      config: getConfig(effectId),
      enabled: isEnabled(effectId),
      onToggle: handleToggle,
      onConfigChange: handleConfigChange,
      onReset: handleReset,
    })

    el.replaceWith(newCard.element)
    cards[i] = newCard

    // Re-observe preview
    if (previewObserver) {
      var previewEl = newCard.element.querySelector(".effect-card-preview")
      if (previewEl) {
        previewEl._cardIndex = i
        previewObserver.observe(previewEl)
      }
    }

    break
  }
}

/**
 * Rebuild all cards from scratch (used after "Reset All").
 */
function rebuildCards(container) {
  // Stop all previews
  for (var i = 0; i < cards.length; i++) {
    cards[i].preview.stop()
  }
  cards = []

  // Disconnect observer
  if (previewObserver) {
    previewObserver.disconnect()
  }

  // Clear container except category headers (we rebuild those too)
  container.textContent = ""

  // Re-init
  var effects = getEffects()
  var effectMap = {}
  for (var i = 0; i < effects.length; i++) {
    effectMap[effects[i].id] = effects[i]
  }

  var categoryKeys = Object.keys(EFFECT_CATEGORIES)
  for (var c = 0; c < categoryKeys.length; c++) {
    var catKey = categoryKeys[c]
    var category = EFFECT_CATEGORIES[catKey]

    var catHeader = document.createElement("div")
    catHeader.className = "effects-category-header"
    catHeader.textContent = category.label
    container.appendChild(catHeader)

    for (var e = 0; e < category.effectIds.length; e++) {
      var effectId = category.effectIds[e]
      var effect = effectMap[effectId]
      if (!effect) continue

      var config = getConfig(effectId)
      var card = createEffectCard({
        effectId: effectId,
        label: effect.label,
        config: config,
        enabled: isEnabled(effectId),
        onToggle: handleToggle,
        onConfigChange: handleConfigChange,
        onReset: handleReset,
      })

      container.appendChild(card.element)
      cards.push(card)

      if (previewObserver) {
        var previewEl = card.element.querySelector(".effect-card-preview")
        if (previewEl) {
          previewEl._cardIndex = cards.length - 1
          previewObserver.observe(previewEl)
        }
      }
    }
  }
}

// Boot
init()
