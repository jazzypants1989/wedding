/** @file Stroke icons on a 20px grid, the Workspace set (prototypes/admin-workspace/
 *  art.js). One path string per name; `icon()` returns trusted markup for the
 *  `html` helper. Decorative: always aria-hidden, the label is beside it.
 *  No regex (CLAUDE.md). */
/** @import * as Types from './types.js' */

import { html } from "../utils.js"

const PATHS = /** @type {Record<string, string>} */ ({
  home: "M3 9.5 10 4l7 5.5V17H3z M8 17v-5h4v5",
  review: "M3 4h14v10H8l-4 3v-3H3z M6 8h8 M6 11h5",
  faces: "M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M4 17c0-3 3-5 6-5s6 2 6 5",
  gallery: "M3 4h14v12H3z M3 13l4-4 3 3 3-3 4 4",
  gifts: "M3 8h14v3H3z M4 11h12v6H4z M10 8v9 M10 8C8 4 5 5 6.5 7 M10 8c2-4 5-3 3.5-1",
  cards: "M3 5h14v10H3z M3 5l7 6 7-6",
  replies: "M10 16s-6-3.5-6-8a3.2 3.2 0 0 1 6-1.6A3.2 3.2 0 0 1 16 8c0 4.5-6 8-6 8z",
  guests:
    "M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M2 16c0-2.5 2.2-4 5-4s5 1.5 5 4 " +
    "M13.5 9a2 2 0 1 0 0-4 M14 12c2.2 0 4 1.3 4 4",
  accounts: "M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M4 17c0-3 3-5 6-5s6 2 6 5 M15 3l1 1 2-2",
  rsvps: "M4 4h12v13H4z M7 9l2 2 4-4 M7 14h6",
  requests: "M4 4h12v9H9l-3 3v-3H4z M10 7v3 M10 12h.01",
  blocklist: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M5 5l10 10",
  content: "M4 3h9l3 3v11H4z M7 8h6 M7 11h6 M7 14h4",
  effects:
    "M10 2l1.8 4.6L16 8l-4.2 1.4L10 14l-1.8-4.6L4 8l4.2-1.4z " +
    "M15 13l.7 1.8 1.8.7-1.8.7L15 18l-.7-1.8-1.8-.7 1.8-.7z",
  more: "M4 10h.01 M10 10h.01 M16 10h.01",
  back: "M12 4l-6 6 6 6",
  next: "M8 4l6 6-6 6",
  sun:
    "M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M10 2v2 M10 16v2 M2 10h2 M16 10h2 " +
    "M4.3 4.3l1.4 1.4 M14.3 14.3l1.4 1.4 M4.3 15.7l1.4-1.4 M14.3 5.7l1.4-1.4",
  moon: "M15 12.5A6 6 0 0 1 7.5 5a6 6 0 1 0 7.5 7.5z",
  check: "M4 10l4 4 8-8",
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M13.5 13.5 17 17",
  key: "M7 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6z M10 10h7 M14 10v3 M16 10v2",
  external: "M11 3h6v6 M17 3l-8 8 M15 12v5H3V5h5",
  signout: "M8 17H4V3h4 M13 14l4-4-4-4 M17 10H8",
  close: "M5 5l10 10 M15 5 5 15",
  download: "M10 3v10 M6 9l4 4 4-4 M4 16h12",
  link: "M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1 M11.5 8.5a3 3 0 0 0-4.2 0L4.7 11.1a3 3 0 0 0 4.2 4.2l1-1",
  alert: "M10 3 2.5 16.5h15z M10 8v4 M10 14.5h.01",
})

/** @type {Types.icon} */
export function icon(name) {
  const d = PATHS[name] ?? PATHS.more
  return html`<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" fill="none"
    stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="${d}" />
  </svg>`
}
