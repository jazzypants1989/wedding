/** @file Public config endpoint — exposes feature flags to the frontend */
/** @import * as Types from './types.js' */

import { sendJson } from "../core/http.js"
import { FEATURES, SERVER } from "../types.js"

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
  })
}
