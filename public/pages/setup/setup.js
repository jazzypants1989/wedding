/** @file First-run setup wizard: a client-side multi-step form over a single
 *  token-gated POST /api/setup. Seeds itself from the shipped content defaults,
 *  lets the owner edit the essentials, and submits the whole content object
 *  (the server diffs it against defaults + stores only what changed). No regex. */
/** @import * as Types from "./types.js" */

import {
  getElement,
  getInputElement,
  getTextAreaElement,
  getButtonElement,
  getFormElement,
  getErrorMessage,
  escapeHtml,
} from "../utils.js"

// Known effect theme ids (mirrors public/effects/themes.js EFFECT_THEMES / the
// server THEME_IDS allowlist; a drift test guards those two, and the server
// re-validates the choice, so a stale entry here only mis-labels, never breaks).
/** @type {Types.SetupTheme[]} */
const THEMES = [
  { id: "mermaid-disco", label: "Mermaid Disco" },
  { id: "romantic", label: "Romantic" },
  { id: "elegant", label: "Elegant" },
  { id: "classic", label: "Classic" },
  { id: "celestial", label: "Celestial" },
  { id: "garden", label: "Garden" },
  { id: "winter", label: "Winter" },
  { id: "coastal", label: "Coastal" },
]

const LAST_STEP = 4

/** @type {Types.SetupContent | null} */
let content = null
let step = 0

const alertBox = getElement("setup-alert")
const backBtn = getButtonElement("setup-back")
const nextBtn = getButtonElement("setup-next")
const finishBtn = getButtonElement("setup-finish")

/** @param {string} message @param {boolean} [success] */
function showAlert(message, success = false) {
  alertBox.textContent = message
  alertBox.classList.toggle("is-success", success)
  alertBox.hidden = false
  alertBox.scrollIntoView({ block: "nearest" })
}

function clearAlert() {
  alertBox.hidden = true
  alertBox.textContent = ""
}

/** Fill the form inputs from the seeded content. */
function seedForm() {
  if (!content) return
  getInputElement("f-display").value = content.couple.display
  getInputElement("f-first").value = content.couple.first
  getInputElement("f-monogram").value = content.couple.monogram
  getInputElement("f-fullnames").value = content.couple.fullNames.join(", ")
  getInputElement("f-date").value = content.weddingDate
  getInputElement("f-location").value = content.location
  getInputElement("f-welcomeHeading").value = content.copy.pre.welcomeHeading
  getTextAreaElement("f-welcomeIntro").value = content.copy.pre.welcomeIntro
  getInputElement("f-regTitle").value = content.registry.title
  getInputElement("f-regUrl").value = content.registry.url
  getInputElement("f-regLabel").value = content.registry.label
  getTextAreaElement("f-regBody").value = content.registry.body
}

/** Build the theme radio group, checking the seeded theme. */
function renderThemes() {
  const current = content ? content.theme : THEMES[0].id
  const group = getElement("f-themes")
  let out = ""
  for (const t of THEMES) {
    const checked = t.id === current ? " checked" : ""
    out +=
      '<label class="setup-theme"><input type="radio" name="theme" value="' +
      escapeHtml(t.id) +
      '"' +
      checked +
      "><span>" +
      escapeHtml(t.label) +
      "</span></label>"
  }
  group.innerHTML = out
}

/** The currently-selected theme id (falls back to the seeded value). */
function selectedTheme() {
  const checked = document.querySelector('input[name="theme"]:checked')
  if (checked instanceof HTMLInputElement) return checked.value
  return content ? content.theme : THEMES[0].id
}

/** Read the editable inputs back into the content object (mutates in place so
 *  untouched keys are preserved for submission). */
function collect() {
  if (!content) return
  content.couple.display = getInputElement("f-display").value.trim()
  content.couple.first = getInputElement("f-first").value.trim()
  content.couple.monogram = getInputElement("f-monogram").value.trim()
  content.couple.fullNames = getInputElement("f-fullnames")
    .value.split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
  content.weddingDate = getInputElement("f-date").value.trim()
  content.location = getInputElement("f-location").value.trim()
  content.copy.pre.welcomeHeading = getInputElement("f-welcomeHeading").value.trim()
  content.copy.pre.welcomeIntro = getTextAreaElement("f-welcomeIntro").value.trim()
  content.registry.title = getInputElement("f-regTitle").value.trim()
  content.registry.url = getInputElement("f-regUrl").value.trim()
  content.registry.label = getInputElement("f-regLabel").value.trim()
  content.registry.body = getTextAreaElement("f-regBody").value.trim()
  content.theme = selectedTheme()
}

/** Light client-side validation for a step. Returns an error message or null.
 *  The server re-validates everything; this is just fast feedback.
 *  @param {number} n
 *  @returns {string | null} */
function validateStep(n) {
  if (n === 0) {
    if (!getInputElement("f-token").value.trim()) return "Paste the setup token from your server logs."
    const pw = getInputElement("f-password").value
    const pw2 = getInputElement("f-password2").value
    if (pw.length < 12) return "Password must be at least 12 characters."
    if (pw !== pw2) return "Passwords do not match."
  }
  if (n === 1) {
    if (!getInputElement("f-display").value.trim()) return "Display names are required."
    if (!getInputElement("f-first").value.trim()) return "First names are required."
    if (!getInputElement("f-monogram").value.trim()) return "A monogram is required."
    const date = getInputElement("f-date").value.trim()
    if (!date) return "A wedding date is required."
    if (Number.isNaN(Date.parse(date))) return "That wedding date can't be parsed — try an ISO date."
    if (!getInputElement("f-location").value.trim()) return "A location is required."
  }
  if (n === 3) {
    const url = getInputElement("f-regUrl").value.trim()
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      return "Registry URL must start with http:// or https://."
    }
  }
  return null
}

/** @param {string} term @param {string} desc */
function reviewRow(term, desc) {
  return "<dt>" + escapeHtml(term) + "</dt><dd>" + escapeHtml(desc || "—") + "</dd>"
}

function buildReview() {
  if (!content) return
  const themeLabel = THEMES.find((t) => t.id === content?.theme)?.label || content.theme
  const review = getElement("f-review")
  review.innerHTML =
    reviewRow("Couple", content.couple.display) +
    reviewRow("Date", content.weddingDate) +
    reviewRow("Location", content.location) +
    reviewRow("Theme", themeLabel) +
    reviewRow("Registry", content.registry.url)
}

/** Show step `n`: toggle panels, stepper chips, and nav buttons.
 *  @param {number} n */
function showStep(n) {
  step = n
  clearAlert()
  const panels = document.querySelectorAll(".setup-panel")
  panels.forEach((panel) => {
    const idx = Number(panel.getAttribute("data-panel"))
    const active = idx === n
    panel.classList.toggle("is-active", active)
    if (panel instanceof HTMLElement) panel.hidden = !active
  })
  document.querySelectorAll(".setup-step").forEach((chip) => {
    const idx = Number(chip.getAttribute("data-step"))
    chip.classList.toggle("is-active", idx === n)
    chip.classList.toggle("is-done", idx < n)
  })
  backBtn.hidden = n === 0
  nextBtn.hidden = n === LAST_STEP
  finishBtn.hidden = n !== LAST_STEP
  if (n === LAST_STEP) buildReview()
}

function onNext() {
  const err = validateStep(step)
  if (err) {
    showAlert(err)
    return
  }
  collect()
  showStep(Math.min(step + 1, LAST_STEP))
}

function onBack() {
  showStep(Math.max(step - 1, 0))
}

/** @param {SubmitEvent} e */
async function onSubmit(e) {
  e.preventDefault()
  // Re-validate every gated step so a jumped-to Finish can't skip a check.
  for (let i = 0; i <= LAST_STEP; i++) {
    const err = validateStep(i)
    if (err) {
      showAlert(err)
      showStep(i)
      return
    }
  }
  collect()

  finishBtn.disabled = true
  finishBtn.textContent = "Setting up…"
  try {
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: getInputElement("f-token").value.trim(),
        password: getInputElement("f-password").value,
        content,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || "Setup failed (" + res.status + ")")
    }
    showAlert("All set! Taking you to the admin dashboard…", true)
    setTimeout(() => location.replace("/admin"), 800)
  } catch (err) {
    showAlert(getErrorMessage(err))
    finishBtn.disabled = false
    finishBtn.textContent = "Finish setup"
  }
}

async function init() {
  try {
    const res = await fetch("/api/setup", { headers: { Accept: "application/json" } })
    /** @type {Types.SetupStatusResponse} */
    const data = await res.json()
    if (data.complete || !data.content) {
      location.replace("/admin")
      return
    }
    content = data.content
    seedForm()
    renderThemes()
    showStep(0)
  } catch (err) {
    showAlert("Couldn't load setup: " + getErrorMessage(err))
  }
}

getFormElement("setup-form").addEventListener("submit", onSubmit)
nextBtn.addEventListener("click", onNext)
backBtn.addEventListener("click", onBack)

init()
