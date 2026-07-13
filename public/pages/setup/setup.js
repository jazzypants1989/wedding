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

/** Drop any lingering aria-invalid marks before re-validating / changing step. */
function clearInvalid() {
  document
    .querySelectorAll('[aria-invalid="true"]')
    .forEach((el) => el.removeAttribute("aria-invalid"))
}

/** Surface a step error: alert text, plus mark + focus the offending field.
 *  @param {{ error: string, field?: string }} result */
function showError(result) {
  showAlert(result.error)
  const el = result.field ? document.getElementById(result.field) : null
  if (el instanceof HTMLElement) {
    el.setAttribute("aria-invalid", "true")
    el.focus()
  }
}

/** Mirror of core/password-policy.js `validatePasswordStrength` for fast, local
 *  feedback. Can't import that module — it pulls in node:crypto (via hashPassword)
 *  and won't load in the browser. Keep the two rules in sync.
 *  @param {string} pw @returns {string | null} */
function passwordError(pw) {
  if (pw.length < 12) return "Password must be at least 12 characters."
  let hasUpper = false
  let hasLower = false
  let hasDigit = false
  for (let i = 0; i < pw.length; i++) {
    const code = pw.charCodeAt(i)
    if (code >= 65 && code <= 90) hasUpper = true
    else if (code >= 97 && code <= 122) hasLower = true
    else if (code >= 48 && code <= 57) hasDigit = true
  }
  if (!hasUpper) return "Password must contain an uppercase letter."
  if (!hasLower) return "Password must contain a lowercase letter."
  if (!hasDigit) return "Password must contain a digit."
  return null
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

/** Light client-side validation for a step. Returns `{ error, field }` or null.
 *  The server re-validates everything (buildOverride requires the registry +
 *  welcome copy non-empty, and enforces the full password policy); this mirrors
 *  those rules so failures surface on the right step, not as a late 400 on Review.
 *  @param {number} n
 *  @returns {{ error: string, field?: string } | null} */
function validateStep(n) {
  if (n === 0) {
    if (!getInputElement("f-token").value.trim()) {
      return { error: "Paste the setup token from your server logs.", field: "f-token" }
    }
    const pw = getInputElement("f-password").value
    const pwErr = passwordError(pw)
    if (pwErr) return { error: pwErr, field: "f-password" }
    if (pw !== getInputElement("f-password2").value) {
      return { error: "Passwords do not match.", field: "f-password2" }
    }
  }
  if (n === 1) {
    if (!getInputElement("f-display").value.trim()) return { error: "Display names are required.", field: "f-display" }
    if (!getInputElement("f-first").value.trim()) return { error: "First names are required.", field: "f-first" }
    if (!getInputElement("f-monogram").value.trim()) return { error: "A monogram is required.", field: "f-monogram" }
    const date = getInputElement("f-date").value.trim()
    if (!date) return { error: "A wedding date is required.", field: "f-date" }
    if (Number.isNaN(Date.parse(date))) {
      return { error: "That wedding date can't be parsed — try an ISO date.", field: "f-date" }
    }
    if (!getInputElement("f-location").value.trim()) return { error: "A location is required.", field: "f-location" }
  }
  if (n === 3) {
    // The server requires all of these non-empty (buildOverride). Registry is
    // mandatory today; making it optional is deferred (see DEFERRED.md).
    if (!getInputElement("f-welcomeHeading").value.trim()) {
      return { error: "A welcome heading is required.", field: "f-welcomeHeading" }
    }
    if (!getTextAreaElement("f-welcomeIntro").value.trim()) {
      return { error: "A welcome message is required.", field: "f-welcomeIntro" }
    }
    if (!getInputElement("f-regTitle").value.trim()) {
      return { error: "A registry title is required.", field: "f-regTitle" }
    }
    const url = getInputElement("f-regUrl").value.trim()
    if (!url) return { error: "A registry URL is required.", field: "f-regUrl" }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { error: "Registry URL must start with http:// or https://.", field: "f-regUrl" }
    }
    if (!getInputElement("f-regLabel").value.trim()) {
      return { error: "Registry link text is required.", field: "f-regLabel" }
    }
    if (!getTextAreaElement("f-regBody").value.trim()) {
      return { error: "A registry description is required.", field: "f-regBody" }
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

/** Show step `n`: toggle panels, stepper chips, and nav buttons. When `focus`,
 *  move focus to the newly revealed panel so keyboard/SR users track the change.
 *  @param {number} n @param {boolean} [focus] */
function showStep(n, focus = false) {
  step = n
  clearAlert()
  clearInvalid()
  const panels = document.querySelectorAll(".setup-panel")
  panels.forEach((panel) => {
    const idx = Number(panel.getAttribute("data-panel"))
    const active = idx === n
    panel.classList.toggle("is-active", active)
    if (panel instanceof HTMLElement) panel.hidden = !active
  })
  document.querySelectorAll(".setup-step").forEach((chip) => {
    const idx = Number(chip.getAttribute("data-step"))
    const active = idx === n
    chip.classList.toggle("is-active", active)
    chip.classList.toggle("is-done", idx < n)
    if (active) chip.setAttribute("aria-current", "step")
    else chip.removeAttribute("aria-current")
  })
  backBtn.hidden = n === 0
  nextBtn.hidden = n === LAST_STEP
  finishBtn.hidden = n !== LAST_STEP
  if (n === LAST_STEP) buildReview()
  if (focus) {
    const panel = document.querySelector('.setup-panel[data-panel="' + n + '"]')
    if (panel instanceof HTMLElement) panel.focus()
  }
}

function onNext() {
  clearInvalid()
  const err = validateStep(step)
  if (err) {
    showError(err)
    return
  }
  collect()
  showStep(Math.min(step + 1, LAST_STEP), true)
}

function onBack() {
  showStep(Math.max(step - 1, 0), true)
}

/** Enter advances to the next step rather than submitting the whole wizard from
 *  wherever the cursor happens to be. Textareas keep their newline; the Review
 *  step (no more Next) falls through to a real submit.
 *  @param {KeyboardEvent} e */
function onFormKeydown(e) {
  if (e.key !== "Enter") return
  if (e.target instanceof HTMLTextAreaElement) return
  if (step === LAST_STEP) return
  e.preventDefault()
  onNext()
}

/** @param {SubmitEvent} e */
async function onSubmit(e) {
  e.preventDefault()
  // Re-validate every gated step so a jumped-to Finish can't skip a check.
  for (let i = 0; i <= LAST_STEP; i++) {
    const err = validateStep(i)
    if (err) {
      showStep(i, true)
      showError(err)
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

const form = getFormElement("setup-form")
form.addEventListener("submit", onSubmit)
form.addEventListener("keydown", onFormKeydown)
nextBtn.addEventListener("click", onNext)
backBtn.addEventListener("click", onBack)

init()
