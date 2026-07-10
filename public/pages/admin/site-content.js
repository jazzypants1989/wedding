/** @file Admin "Site content" tab — edit the runtime SiteContent override.
 *
 *  Loads the effective content into a form, PUTs edits to /api/admin/site-content
 *  (auto-CSRF via api()), and offers a reset-to-defaults (DELETE). Nav links are
 *  edited with a small repeatable row editor.
 */
/** @import * as Types from './types.js' */

import { api, showError, showSuccess } from "./utils.js"
import {
  html,
  getElement,
  getInputElement,
  getTextAreaElement,
  getButtonElement,
  getFormElement,
  getErrorMessage,
} from "../utils.js"

/** @param {string} id @returns {string} trimmed input value */
function val(id) {
  return getInputElement(id).value.trim()
}

/** @param {string} id @param {string} value */
function setVal(id, value) {
  getInputElement(id).value = value
}

/** @param {string} id @returns {string} trimmed textarea value */
function taVal(id) {
  return getTextAreaElement(id).value.trim()
}

/** @param {string} id @param {string} value */
function setTa(id, value) {
  getTextAreaElement(id).value = value
}

/**
 * Append one nav-link editor row to a container.
 * @param {string} containerId
 * @param {Types.SiteContentNavLink} [link]
 */
function addNavRow(containerId, link) {
  const href = link ? link.href : ""
  const label = link ? link.label : ""
  getElement(containerId).insertAdjacentHTML(
    "beforeend",
    html`<div class="nav-row">
      <input type="text" class="nav-href" placeholder="href (e.g. #schedule or /rsvp)" maxlength="200" value="${href}">
      <input type="text" class="nav-label" placeholder="label" maxlength="100" value="${label}">
      <button type="button" class="btn btn-danger btn-sm nav-remove">Remove</button>
    </div>`,
  )
}

/**
 * @param {string} containerId
 * @param {readonly Types.SiteContentNavLink[]} links
 */
function renderNavRows(containerId, links) {
  getElement(containerId).innerHTML = ""
  for (const link of links) addNavRow(containerId, link)
}

/**
 * Read the nav rows in a container back into a list. Rows where either field is
 * filled are included so the server can flag half-filled links.
 * @param {string} containerId
 * @returns {Types.SiteContentNavLink[]}
 */
function collectNavRows(containerId) {
  /** @type {Types.SiteContentNavLink[]} */
  const links = []
  const rows = getElement(containerId).querySelectorAll(".nav-row")
  rows.forEach((row) => {
    const hrefEl = row.querySelector(".nav-href")
    const labelEl = row.querySelector(".nav-label")
    if (!(hrefEl instanceof HTMLInputElement) || !(labelEl instanceof HTMLInputElement)) return
    const href = hrefEl.value.trim()
    const label = labelEl.value.trim()
    if (href || label) links.push({ href, label })
  })
  return links
}

/** @param {Types.SiteContent} c */
function populate(c) {
  setVal("sc-couple-display", c.couple.display)
  setVal("sc-couple-first", c.couple.first)
  setVal("sc-couple-monogram", c.couple.monogram)
  setVal("sc-couple-fullnames", c.couple.fullNames.join(", "))
  setVal("sc-wedding-date", c.weddingDate)
  setVal("sc-location", c.location)
  setVal("sc-contact-email", c.contactEmail || "")
  setVal("sc-registry-url", c.registry.url)
  setVal("sc-registry-label", c.registry.label)
  setVal("sc-footer-github", c.footer.githubUrl || "")
  setVal("sc-copy-pre-heading", c.copy.pre.welcomeHeading)
  setTa("sc-copy-pre-intro", c.copy.pre.welcomeIntro)
  setVal("sc-copy-post-heading", c.copy.post.welcomeHeading)
  setTa("sc-copy-post-intro", c.copy.post.welcomeIntro)
  renderNavRows("sc-nav-pre-rows", c.nav.pre)
  renderNavRows("sc-nav-post-rows", c.nav.post)
}

/** Build the request body from the form fields. */
function collectForm() {
  return {
    couple: {
      display: val("sc-couple-display"),
      first: val("sc-couple-first"),
      monogram: val("sc-couple-monogram"),
      fullNames: val("sc-couple-fullnames")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    weddingDate: val("sc-wedding-date"),
    location: val("sc-location"),
    contactEmail: val("sc-contact-email") || null,
    registry: {
      url: val("sc-registry-url"),
      label: val("sc-registry-label"),
    },
    footer: { githubUrl: val("sc-footer-github") || null },
    copy: {
      pre: {
        welcomeHeading: val("sc-copy-pre-heading"),
        welcomeIntro: taVal("sc-copy-pre-intro"),
      },
      post: {
        welcomeHeading: val("sc-copy-post-heading"),
        welcomeIntro: taVal("sc-copy-post-intro"),
      },
    },
    nav: {
      pre: collectNavRows("sc-nav-pre-rows"),
      post: collectNavRows("sc-nav-post-rows"),
    },
  }
}

export async function loadSiteContent() {
  try {
    const data = await api("/api/admin/site-content")
    const response = /** @type {Types.SiteContentResponse} */ (data)
    populate(response.content)
  } catch (err) {
    console.error("Failed to load site content:", err)
    showError("Failed to load site content. Please refresh the page.")
  }
}

/** @param {SubmitEvent} e */
async function handleSubmit(e) {
  e.preventDefault()
  const errorEl = getElement("site-content-form-error")
  errorEl.hidden = true

  const saveBtn = getButtonElement("site-content-save-btn")
  saveBtn.disabled = true
  try {
    const data = await api("/api/admin/site-content", {
      method: "PUT",
      body: JSON.stringify(collectForm()),
    })
    const response = /** @type {Types.SiteContentResponse} */ (data)
    populate(response.content)
    showSuccess("Site content updated")
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    saveBtn.disabled = false
  }
}

async function handleReset() {
  if (!confirm("Reset all site content to the shipped defaults?")) return
  const resetBtn = getButtonElement("site-content-reset-btn")
  resetBtn.disabled = true
  try {
    const data = await api("/api/admin/site-content", { method: "DELETE" })
    const response = /** @type {Types.SiteContentResponse} */ (data)
    populate(response.content)
    showSuccess("Site content reset to defaults")
  } catch (err) {
    showError(getErrorMessage(err))
  } finally {
    resetBtn.disabled = false
  }
}

/** @param {MouseEvent} e */
function handleNavRemove(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest(".nav-remove")
  if (!btn) return
  const row = btn.closest(".nav-row")
  if (row) row.remove()
}

export function initSiteContent() {
  getFormElement("site-content-form").addEventListener("submit", handleSubmit)
  getButtonElement("site-content-reset-btn").addEventListener("click", handleReset)
  getButtonElement("sc-nav-pre-add").addEventListener("click", () => addNavRow("sc-nav-pre-rows"))
  getButtonElement("sc-nav-post-add").addEventListener("click", () => addNavRow("sc-nav-post-rows"))
  getElement("sc-nav-pre-rows").addEventListener("click", handleNavRemove)
  getElement("sc-nav-post-rows").addEventListener("click", handleNavRemove)
}
