/** @file Public config endpoint — exposes feature flags to the frontend */
/** @import * as Types from './types.js' */

import { sendJson } from "../core/http.js"
import { FEATURES, SERVER } from "../types.js"
import { getContent, getMode } from "../core/site-content.js"
import { countApprovedGuestMedia } from "../db/media.js"
import { countApprovedGuestbook } from "../db/guestbook-entries.js"

/** @type {Types.getConfig} */
export function get(req, res) {
  sendJson(res, 200, {
    features: {
      enableNameLookup: FEATURES.ENABLE_NAME_LOOKUP,
      enableEmailLookup: FEATURES.ENABLE_EMAIL_LOOKUP,
    },
    // Reply-to / contact address the frontend uses for the gallery "Report this
    // photo" mailto. Always present (SERVER.contactEmail has a default).
    contactEmail: SERVER.contactEmail,
    // Timeline mode + couple name for client-side use. The static HTML is already
    // templated server-side (core/static.js); these expose the client-needed
    // scalars (content.js is the single source).
    mode: getMode(),
    coupleDisplay: getContent().couple.display,
    // Public "moments shared" tally for the landing Memories line: approved,
    // visible guest photos + guestbook notes. Two cheap indexed COUNT(*)s; the
    // landing renders their sum, or nothing if the whole config fetch fails.
    counts: {
      photos: countApprovedGuestMedia(),
      notes: countApprovedGuestbook(),
    },
  })
}
