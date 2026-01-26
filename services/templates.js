/** @file Message template utilities */
/** @import * as Types from './types.js' */

export const PLACEHOLDERS = Object.freeze({
  NAME: "{name}",
  URL: "{url}",
  DATE: "{date}",
  LOCATION: "{location}",
})

/** @type {Types.formatTemplate} */
export function formatTemplate(template, { name, url, date, location }) {
  if (!template) return template
  return template
    .replaceAll(PLACEHOLDERS.NAME, name || "")
    .replaceAll(PLACEHOLDERS.URL, url || "")
    .replaceAll(PLACEHOLDERS.DATE, date || "")
    .replaceAll(PLACEHOLDERS.LOCATION, location || "")
}

/** @type {Types.getTemplateExample} */
export function getTemplateExample() {
  return `Hi {name}! You're invited to our wedding. RSVP here: {url}`
}
