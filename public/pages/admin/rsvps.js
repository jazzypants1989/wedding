/** @file RSVP list display module */
/** @import * as Types from './types.js' */
/** @import { RSVPsResponse } from '../types.js' */

import { api } from "./api.js"
import { escapeHtml, formatDate, getElement } from "../utils.js"

/** @type {Types.renderRsvps} */
function renderRsvps(rsvps) {
  const tbody = getElement("rsvps-tbody")

  if (rsvps.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">No RSVPs yet</td>
      </tr>
    `
    return
  }

  tbody.innerHTML = rsvps
    .map(
      (rsvp) => `
    <tr>
      <td><strong>${escapeHtml(rsvp.name)}</strong></td>
      <td class="${rsvp.attending ? "attending-yes" : "attending-no"}">
        ${rsvp.attending ? "Yes" : "No"}
      </td>
      <td>${rsvp.attending ? rsvp.actual_party_size : "-"}</td>
      <td class="hide-mobile">${
        rsvp.dietary_restrictions ? escapeHtml(rsvp.dietary_restrictions) : "-"
      }</td>
      <td class="hide-mobile">${
        rsvp.song_request ? escapeHtml(rsvp.song_request) : "-"
      }</td>
      <td class="hide-mobile">${formatDate(rsvp.submitted_at)}</td>
    </tr>
  `,
    )
    .join("")
}

/** @type {Types.loadRsvps} */
export async function loadRsvps() {
  try {
    const data = await api("/api/admin/rsvps")
    const response = /** @type {RSVPsResponse} */ (data)
    renderRsvps(response.rsvps)
  } catch (err) {
    console.error("Failed to load RSVPs:", err)
  }
}
