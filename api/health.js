/** @file Health check endpoint */
/** @import * as Types from './types.js' */

import { sendJson } from "../core/http.js"

/** @type {Types.getHealth} */
export function get(req, res) {
  sendJson(res, 200, {
    status: "ok",
    timestamp: new Date().toISOString(),
  })
}
