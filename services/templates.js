/** @file Message template utilities */
/** @import * as Types from './types.js' */

export const PLACEHOLDERS = Object.freeze({
  NAME: "{name}",
  URL: "{url}",
})

/** @type {Types.formatTemplate} */
export function formatTemplate(template, { name, url }) {
  if (!template) return template
  return template
    .replaceAll(PLACEHOLDERS.NAME, name || "")
    .replaceAll(PLACEHOLDERS.URL, url || "")
}

/** @type {Types.getTemplateExample} */
export function getTemplateExample() {
  return `Hi {name}! You're invited to our wedding. RSVP here: {url}`
}
