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
    // Whether /guestbook shows the pinned Favorites strip (the feed already
    // honours it server-side; exposed for any page that wants the flag).
    guestbook: { showFavorites: getContent().guestbook.showFavorites },
    // Whether the gallery lightbox offers the colour ⇄ black-and-white flip. The
    // feed already carries a twin only when this is on; this is for the button.
    gallery: { showBlackAndWhite: getContent().gallery.showBlackAndWhite },
    // Public "moments shared" tally for the landing Memories line: approved,
    // visible guest photos + guestbook notes. Two cheap indexed COUNT(*)s; the
    // landing renders their sum, or nothing if the whole config fetch fails.
    counts: {
      photos: countApprovedGuestMedia(),
      notes: countApprovedGuestbook(),
    },
  })
}
