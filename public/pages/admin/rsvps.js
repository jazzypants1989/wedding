/** @file RSVP list display module */
/** @import * as Types from './types.js' */

import { api, showError } from "./utils.js"
import { html, formatDate, getElement } from "../utils.js"

/** @type {WeakMap<Element, AbortController>} */
const pendingTransitions = new WeakMap()

/** @type {Types.renderRsvps} */
function renderRsvps(rsvps) {
  const tbody = getElement("rsvps-tbody")

  if (rsvps.length === 0) {
    tbody.innerHTML = html`<tr>
      <td colspan="6" class="empty-state">No RSVPs yet</td>
    </tr>`
    return
  }

  tbody.innerHTML = html`${rsvps.map(
    (rsvp) =>
      html` <tr class="rsvp-data-row">
        <td>
          <button class="rsvp-toggle" aria-expanded="false">
            <strong>${rsvp.name}</strong>
          </button>
        </td>
        <td class="${rsvp.attending ? "attending-yes" : "attending-no"}">
          ${rsvp.attending ? "Yes" : "No"}
        </td>
        <td>${rsvp.attending ? rsvp.actual_party_size : "-"}</td>
        <td class="hide-mobile">
          ${rsvp.dietary_restrictions || "None"}
        </td>
        <td class="hide-mobile">
          ${rsvp.message || "None"}
        </td>
        <td class="hide-mobile">
          ${formatDate(rsvp.submitted_at)}
        </td>
      </tr>
      <tr class="rsvp-detail-row" aria-hidden="true">
        <td colspan="6">
          <div class="rsvp-detail-content">
            <div class="rsvp-detail-inner">
              <div><strong>Food:</strong> ${rsvp.dietary_restrictions || "None"}</div>
              <div><strong>Message:</strong> ${rsvp.message || "None"}</div>
              <div><strong>Submitted:</strong> ${formatDate(rsvp.submitted_at)}</div>
            </div>
          </div>
        </td>
      </tr>`,
  )}`
}

/**
 * Toggle RSVP detail row with smooth height animation.
 * Uses scrollHeight for accurate 0-to-auto transitions.
 * @param {HTMLElement} btn
 */
function toggleRsvpDetail(btn) {
  const row = btn.closest("tr")
  if (!row) return
  const detailRow = row.nextElementSibling
  if (!detailRow) return
  const content = /** @type {HTMLElement | null} */ (
    detailRow.querySelector(".rsvp-detail-content")
  )
  if (!content) return

  const pending = pendingTransitions.get(content)
  if (pending) {
    pending.abort()
    pendingTransitions.delete(content)
  }

  const isExpanded = btn.getAttribute("aria-expanded") === "true"

  if (isExpanded) {
    content.style.height = content.scrollHeight + "px"
    void content.offsetHeight
    content.style.height = "0"
    btn.setAttribute("aria-expanded", "false")
    detailRow.setAttribute("aria-hidden", "true")
  } else {
    content.style.height = "0"
    void content.offsetHeight
    content.style.height = content.scrollHeight + "px"
    btn.setAttribute("aria-expanded", "true")
    detailRow.setAttribute("aria-hidden", "false")
    const ac = new AbortController()
    pendingTransitions.set(content, ac)
    content.addEventListener(
      "transitionend",
      () => {
        content.style.height = "auto"
        pendingTransitions.delete(content)
      },
      { once: true, signal: ac.signal },
    )
  }
}

document.addEventListener("click", (e) => {
  const target = /** @type {Element} */ (e.target)
  const btn = target.closest(".rsvp-toggle")
  if (btn) {
    toggleRsvpDetail(/** @type {HTMLElement} */ (btn))
    return
  }
  const row = target.closest(".rsvp-data-row")
  if (!row) return
  const toggle = /** @type {HTMLElement | null} */ (
    row.querySelector(".rsvp-toggle")
  )
  if (toggle) toggleRsvpDetail(toggle)
})

/** @type {Types.loadRsvps} */
export async function loadRsvps() {
  try {
    const data = await api("/api/admin/rsvps")
    const response = /** @type {Types.RSVPsResponse} */ (data)
    renderRsvps(response.rsvps)
  } catch (err) {
    console.error("Failed to load RSVPs:", err)
    showError("Failed to load RSVPs. Please refresh the page.")
  }
}
