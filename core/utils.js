/** @file Middleware wrappers for route handlers */
/** @import * as Types from './types.js' */

/** @type {Types.escapeHtml} */
export function escapeHtml(str) {
  if (!str) return ""
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/** @type {Types.escapeAttribute} */
export function escapeAttribute(str) {
  return escapeHtml(str)
}
