/** @file Health check endpoint */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import { sendJson } from "../core/http.js"
import { UPLOADS_DIR } from "../core/media-storage.js"

/** @type {Types.getHealth} */
export function get(req, res) {
  // Free bytes on the uploads volume — surfaces disk pressure before uploads
  // start returning 507 (Phase 3 ops item).
  let freeBytes = null
  try {
    const s = fs.statfsSync(UPLOADS_DIR)
    freeBytes = s.bavail * s.bsize
  } catch {
    // statfs unsupported / dir missing — omit rather than fail the health check.
  }

  sendJson(res, 200, {
    status: "ok",
    timestamp: new Date().toISOString(),
    uploadsFreeBytes: freeBytes,
  })
}
