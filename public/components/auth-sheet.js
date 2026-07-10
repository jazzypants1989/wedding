/** @file The shared "Who's celebrating?" auth sheet.
 *
 * One <dialog id="auth-sheet"> whose markup is injected by initAuthSheet() so
 * pages don't duplicate the form HTML. Two panels: invite-code claim/re-login,
 * and open (untrusted) registration. Both POST /api/account/register. On success
 * the guest session is set and the pending write action replays.
 */
/** @import * as Types from "./types.js" */

import { html, raw, api, getCoupleName, getDialogElement, getInputElement, getButtonElement, getElement } from "../pages/utils.js"
import { setButtonLoading, miniSparkle } from "./celebrate.js"
import { session, setAccount, replayPendingAction, cancelPendingAction } from "./guest-session.js"
import { showToast } from "./toast.js"

let injected = false
/** @type {HTMLElement | null} */
let triggerEl = null
/** @type {ReturnType<typeof setInterval> | undefined} */
let countdownTimer

const SHEET_MARKUP = html`
  <button type="button" class="modal-close flex-center" data-auth-close aria-label="Close">&times;</button>

  <div id="auth-panel-code" class="auth-panel">
    <h2 id="auth-sheet-title">Who's celebrating?</h2>
    <p class="auth-help">
      Invite codes are per household — enter your own name so we know which of you
      is writing.
    </p>
    <div id="auth-alert-code" class="alert alert-error" role="alert" hidden></div>
    <form id="auth-code-form" novalidate>
      <div class="form-group">
        <label for="auth-code">Invite code</label>
        <input id="auth-code" name="code" type="text" autocapitalize="characters"
          autocomplete="off" autocorrect="off" spellcheck="false" maxlength="8"
          aria-describedby="auth-code-error" />
        <p id="auth-code-error" class="field-error" role="alert" hidden></p>
      </div>
      <div class="form-group">
        <label for="auth-name">Your name</label>
        <input id="auth-name" name="name" type="text" autocomplete="name"
          maxlength="100" required />
      </div>
      <button type="submit" class="btn btn-primary btn-large" id="auth-code-submit">
        Continue
      </button>
    </form>
    <div class="auth-divider"><span>or</span></div>
    <button type="button" class="auth-link" id="auth-no-code">
      I don't have a code
    </button>
    <button type="button" class="auth-link" id="auth-recover-link">
      Lost access? Recover by email
    </button>
  </div>

  <div id="auth-panel-recover" class="auth-panel" hidden>
    <h2>Recover your access</h2>
    <p class="auth-help">
      Enter the email you signed up with and we'll send a one-time sign-in link.
    </p>
    <div id="auth-alert-recover" class="alert alert-error" role="alert" hidden></div>
    <div id="auth-recover-done" class="alert alert-success" role="status" hidden></div>
    <form id="auth-recover-form" novalidate>
      <div class="form-group">
        <label for="auth-recover-email">Email</label>
        <input id="auth-recover-email" name="email" type="email" autocomplete="email"
          maxlength="254" required />
      </div>
      <button type="submit" class="btn btn-primary btn-large" id="auth-recover-submit">
        Send link
      </button>
    </form>
    <button type="button" class="auth-link" id="auth-recover-back">Back</button>
  </div>

  <div id="auth-panel-open" class="auth-panel" hidden>
    <h2>Introduce yourself</h2>
    <div class="alert alert-warning" role="note">
      Since we can't match you to the guest list, your posts will appear after
      <span class="auth-couple-name">the hosts</span> approve them.
    </div>
    <div id="auth-alert-open" class="alert alert-error" role="alert" hidden></div>
    <form id="auth-open-form" novalidate>
      <div class="form-group">
        <label for="auth-open-name">Your name</label>
        <input id="auth-open-name" name="name" type="text" autocomplete="name"
          maxlength="100" required />
      </div>
      <div class="form-group">
        <label for="auth-open-relation">How do you know us? (optional)</label>
        <input id="auth-open-relation" name="relation" type="text" maxlength="200"
          placeholder="College friend, cousin, coworker…" />
      </div>
      <button type="submit" class="btn btn-primary btn-large" id="auth-open-submit">
        Join the celebration
      </button>
    </form>
    <button type="button" class="auth-link" id="auth-back">Back</button>
  </div>

  <div id="auth-welcome" class="auth-welcome" hidden></div>
`

/**
 * @param {HTMLElement} el
 * @param {string} message
 */
function showAlert(el, message) {
  el.textContent = message
  el.hidden = false
}

/** @param {HTMLElement} el */
function hideAlert(el) {
  el.hidden = true
  el.textContent = ""
}

/** @param {HTMLInputElement} input */
function shake(input) {
  input.classList.add("form-error-shake")
  input.addEventListener(
    "animationend",
    () => input.classList.remove("form-error-shake"),
    { once: true },
  )
}

/** @param {"code" | "open" | "recover" | "welcome"} which */
function showPanel(which) {
  getElement("auth-panel-code").hidden = which !== "code"
  getElement("auth-panel-open").hidden = which !== "open"
  getElement("auth-panel-recover").hidden = which !== "recover"
  getElement("auth-welcome").hidden = which !== "welcome"
}

function resetSheet() {
  clearInterval(countdownTimer)
  // Prefill the invite code from a prior RSVP visit (rsvp-form.js stashes it) so
  // a household guest lands on the trusted path without re-typing their code.
  let savedCode = ""
  try {
    savedCode = localStorage.getItem("rsvpCode") || ""
  } catch {
    // localStorage unavailable — leave the field blank.
  }
  getInputElement("auth-code").value = savedCode
  getInputElement("auth-name").value = ""
  getInputElement("auth-open-name").value = ""
  getInputElement("auth-open-relation").value = ""
  const codeErr = getElement("auth-code-error")
  codeErr.hidden = true
  getInputElement("auth-code").removeAttribute("aria-invalid")
  hideAlert(getElement("auth-alert-code"))
  hideAlert(getElement("auth-alert-open"))
  hideAlert(getElement("auth-alert-recover"))
  getInputElement("auth-recover-email").value = ""
  getElement("auth-recover-done").hidden = true
  getElement("auth-recover-form").hidden = false
  getButtonElement("auth-recover-submit").disabled = false
  getButtonElement("auth-recover-submit").textContent = "Send link"
  getButtonElement("auth-code-submit").disabled = false
  getButtonElement("auth-code-submit").textContent = "Continue"
  showPanel("code")
}

/**
 * Disable a submit button for `seconds`, ticking a countdown into its label.
 * @param {HTMLButtonElement} btn
 * @param {string} label
 * @param {number} seconds
 */
function startCountdown(btn, label, seconds) {
  clearInterval(countdownTimer)
  let remaining = seconds
  btn.disabled = true
  btn.textContent = `${label} (${remaining}s)`
  countdownTimer = setInterval(() => {
    remaining -= 1
    if (remaining <= 0) {
      clearInterval(countdownTimer)
      btn.disabled = false
      btn.textContent = label
    } else {
      btn.textContent = `${label} (${remaining}s)`
    }
  }, 1000)
}

/**
 * @param {boolean} returning
 * @param {string} name
 */
function finishAuth(returning, name) {
  const dialog = getDialogElement("auth-sheet")
  const done = () => {
    dialog.close()
    if (triggerEl) {
      miniSparkle(triggerEl)
      triggerEl.focus()
    }
    replayPendingAction()
  }
  if (returning) {
    const welcome = getElement("auth-welcome")
    welcome.textContent = `Welcome back, ${name}!`
    showPanel("welcome")
    setTimeout(done, 1200)
  } else {
    done()
  }
}

/**
 * @param {{ code?: string, name: string, relation?: string }} body
 * @param {{ submitBtn: HTMLButtonElement, alertEl: HTMLElement, defaultLabel: string, codeInput?: HTMLInputElement, codeErrorEl?: HTMLElement }} ctx
 */
async function submitRegister(body, ctx) {
  const { submitBtn, alertEl, defaultLabel, codeInput, codeErrorEl } = ctx
  hideAlert(alertEl)
  if (codeErrorEl) codeErrorEl.hidden = true
  if (codeInput) codeInput.removeAttribute("aria-invalid")
  setButtonLoading(submitBtn, true)

  try {
    const res = await fetch("/api/account/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    /** @type {Record<string, unknown>} */
    let data = {}
    try {
      data = /** @type {Record<string, unknown>} */ (await res.json())
    } catch {
      // non-JSON body; fall through to status handling
    }

    if (res.ok) {
      const account = /** @type {Types.GuestAccount} */ (data.account)
      setAccount(account)
      finishAuth(data.returning === true, account.name)
      return
    }

    if (res.status === 404 && codeInput && codeErrorEl) {
      codeErrorEl.textContent =
        "We couldn't find that code — check your invitation text or email."
      codeErrorEl.hidden = false
      codeInput.setAttribute("aria-invalid", "true")
      shake(codeInput)
      return
    }

    if (res.status === 429) {
      const retryAfter =
        typeof data.retryAfter === "number" && data.retryAfter > 0
          ? Math.min(data.retryAfter, 120)
          : 60
      showAlert(alertEl, "Too many attempts. Please wait a moment and try again.")
      startCountdown(submitBtn, defaultLabel, retryAfter)
      return
    }

    showAlert(
      alertEl,
      typeof data.error === "string" ? data.error : "Something went wrong. Please try again.",
    )
  } catch {
    showAlert(alertEl, "Network error — please check your connection and try again.")
  } finally {
    // Leave a running countdown in charge of the button's disabled state.
    if (!submitBtn.disabled || !countdownTimer) setButtonLoading(submitBtn, false)
  }
}

async function handleCodeSubmit(/** @type {Event} */ e) {
  e.preventDefault()
  const codeInput = getInputElement("auth-code")
  const nameInput = getInputElement("auth-name")
  const name = nameInput.value.trim()
  if (!name) {
    nameInput.focus()
    return
  }
  const code = codeInput.value.trim()
  // An empty code on THIS panel would register an untrusted (moderated) account
  // without the guest realizing it — they came here to use their household code.
  // Require it; the "I don't have a code" button is the explicit untrusted path.
  const codeErrorEl = getElement("auth-code-error")
  if (!code) {
    codeErrorEl.textContent =
      "Enter your invite code, or tap “I don’t have a code” below."
    codeErrorEl.hidden = false
    codeInput.setAttribute("aria-invalid", "true")
    shake(codeInput)
    codeInput.focus()
    return
  }
  await submitRegister(
    { name, code },
    {
      submitBtn: getButtonElement("auth-code-submit"),
      alertEl: getElement("auth-alert-code"),
      defaultLabel: "Continue",
      codeInput,
      codeErrorEl,
    },
  )
}

async function handleOpenSubmit(/** @type {Event} */ e) {
  e.preventDefault()
  const nameInput = getInputElement("auth-open-name")
  const name = nameInput.value.trim()
  if (!name) {
    nameInput.focus()
    return
  }
  const relation = getInputElement("auth-open-relation").value.trim()
  /** @type {{ name: string, relation?: string }} */
  const body = { name }
  if (relation) body.relation = relation
  await submitRegister(body, {
    submitBtn: getButtonElement("auth-open-submit"),
    alertEl: getElement("auth-alert-open"),
    defaultLabel: "Join the celebration",
  })
}

async function handleRecoverSubmit(/** @type {Event} */ e) {
  e.preventDefault()
  const emailInput = getInputElement("auth-recover-email")
  const email = emailInput.value.trim()
  if (!email) {
    emailInput.focus()
    return
  }
  const submitBtn = getButtonElement("auth-recover-submit")
  const alertEl = getElement("auth-alert-recover")
  hideAlert(alertEl)
  setButtonLoading(submitBtn, true)

  try {
    // Always-200 non-oracle: the server responds identically whether or not the
    // address maps to an account, so we just show its confirmation copy.
    const data = /** @type {{ message?: string }} */ (
      await api("/api/account/recover", {
        method: "POST",
        body: JSON.stringify({ email }),
      })
    )
    const done = getElement("auth-recover-done")
    done.textContent =
      typeof data.message === "string"
        ? data.message
        : "If that email is on file, a sign-in link is on its way."
    done.hidden = false
    getElement("auth-recover-form").hidden = true
  } catch {
    showAlert(alertEl, "Network error — please check your connection and try again.")
  } finally {
    setButtonLoading(submitBtn, false)
  }
}

/** @type {Types.initAuthSheet} */
export function initAuthSheet() {
  if (injected) return
  injected = true

  const dialog = document.createElement("dialog")
  dialog.id = "auth-sheet"
  dialog.className = "auth-sheet"
  dialog.setAttribute("aria-labelledby", "auth-sheet-title")
  dialog.innerHTML = SHEET_MARKUP
  // Fill the couple name from the single source (the templated .couple-names
  // heading) now that we're in the DOM — SHEET_MARKUP is built at module load,
  // before document exists.
  const coupleNameEl = dialog.querySelector(".auth-couple-name")
  if (coupleNameEl) coupleNameEl.textContent = getCoupleName()
  document.body.appendChild(dialog)

  dialog
    .querySelector("[data-auth-close]")
    ?.addEventListener("click", () => dialog.close())

  getElement("auth-no-code").addEventListener("click", () => {
    hideAlert(getElement("auth-alert-open"))
    showPanel("open")
    getInputElement("auth-open-name").focus()
  })
  getElement("auth-back").addEventListener("click", () => {
    showPanel("code")
    getInputElement("auth-code").focus()
  })

  getElement("auth-recover-link").addEventListener("click", () => {
    hideAlert(getElement("auth-alert-recover"))
    getElement("auth-recover-done").hidden = true
    getElement("auth-recover-form").hidden = false
    showPanel("recover")
    getInputElement("auth-recover-email").focus()
  })
  getElement("auth-recover-back").addEventListener("click", () => {
    showPanel("code")
    getInputElement("auth-code").focus()
  })

  getElement("auth-code-form").addEventListener("submit", handleCodeSubmit)
  getElement("auth-open-form").addEventListener("submit", handleOpenSubmit)
  getElement("auth-recover-form").addEventListener("submit", handleRecoverSubmit)

  // Dismissed before signing in (X / backdrop / Escape)? A successful auth sets
  // the account and clears the stash before this fires, so a still-null account
  // with a waiting action means the guest closed mid-write. Discard the stashed
  // action (else it would replay on a later, unrelated sign-in) and tell them
  // their tap didn't go through — otherwise it evaporates silently.
  dialog.addEventListener("close", () => {
    clearInterval(countdownTimer)
    if (!session.account && cancelPendingAction()) {
      showToast("You'll need to sign in to do that.")
    }
  })

  // Backdrop click closes (native dialog handles Escape).
  dialog.addEventListener("click", (e) => {
    const rect = dialog.getBoundingClientRect()
    const inside =
      rect.top <= e.clientY &&
      e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX &&
      e.clientX <= rect.left + rect.width
    if (!inside) dialog.close()
  })
}

/** @type {Types.openAuthSheet} */
export function openAuthSheet(trigger) {
  initAuthSheet()
  // Capture the return-focus target BEFORE showModal() moves focus into the
  // dialog. The write-gate path (requireAccount) opens the sheet with no explicit
  // trigger, so fall back to whatever the guest just activated (the composer
  // submit, a reaction pill, a comment button) so focus returns there on close.
  triggerEl =
    trigger instanceof HTMLElement
      ? trigger
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
  resetSheet()
  const dialog = getDialogElement("auth-sheet")
  dialog.showModal()
  getInputElement("auth-code").focus()
}
