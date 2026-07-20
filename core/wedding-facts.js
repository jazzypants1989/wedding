/** @file Server-side wedding facts derived from the *effective* site content.
 *
 *  Email/SMS templates and the media default author name need the couple's names,
 *  date, and location. These used to be frozen at import in `types.js` from the
 *  checked-in `content.js` defaults — so an onboarded self-hoster would send
 *  invites signed with the sample couple. This module reads `getContent()` (the
 *  defaults ⊕ runtime override resolved in `core/site-content.js`) at call time,
 *  so every send reflects the admin's edits without a redeploy.
 *
 *  Kept out of `types.js` on purpose: `types.js` is a low-level constants module
 *  imported nearly everywhere, and reading `getContent()` there would pull the DB
 *  (and a circular dep) into it. Zero deps, no regex.
 */
/** @import * as Types from './types.js' */

import { formatWeddingDate, formatWeddingDateShort } from "../content.js"
import { getContent } from "./site-content.js"

/** @type {Types.getWeddingFacts} */
export function getWeddingFacts() {
  const content = getContent()
  return {
    coupleNames: content.couple.display,
    coupleFirstNames: content.couple.first,
    date: formatWeddingDate(content.weddingDate),
    dateShort: formatWeddingDateShort(content.weddingDate),
    location: content.location,
    venue: "", // No dedicated venue field in content today; reserved for parity.
  }
}

/** @type {Types.getEmailSubjects} */
export function getEmailSubjects() {
  const names = getContent().couple.display
  return {
    invite: `You're Invited! ${names}'s Wedding`,
    reminder: `Reminder: RSVP for ${names}'s Wedding`,
    thankYou: `A thank-you from ${names}`,
  }
}
