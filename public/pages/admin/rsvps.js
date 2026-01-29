/** @file RSVP list display module */
/** @import * as Types from './types.js' */

import { api, showError } from "./utils.js"
import { html, formatDate, getElement } from "../utils.js"

/** @type {Types.renderRsvps} */
function renderRsvps(rsvps) {
  const tbody = getElement("rsvps-tbody")

  if (rsvps.length === 0) {
    tbody.innerHTML = html`<tr>
      <td colspan="5" class="empty-state">No RSVPs yet</td>
    </tr>`
    return
  }

  tbody.innerHTML = html`${rsvps.map(
    (rsvp) =>
      html` <tr>
        <td><strong>${rsvp.name}</strong></td>
        <td class="${rsvp.attending ? "attending-yes" : "attending-no"}">
          ${rsvp.attending ? "Yes" : "No"}
        </td>
        <td>${rsvp.attending ? rsvp.actual_party_size : "-"}</td>
        <td class="hide-mobile">${rsvp.dietary_restrictions || "-"}</td>
        <td class="hide-mobile">${formatDate(rsvp.submitted_at)}</td>
      </tr>`,
  )}`
}

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
