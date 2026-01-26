/** @file Admin RSVP endpoints */
/** @import * as Types from './types.js' */

import { withAdmin } from "../../core/auth.js"
import { rsvpsToCSV } from "../../core/csv.js"
import { getAllRsvps } from "../rsvp.js"
import { sendJson, sendCsv } from "../../core/http.js"

/** @type {Types.RSVPListHandler} */
function RSVPListHandler(req, res) {
  const rsvps = getAllRsvps()
  return sendJson(res, 200, { rsvps })
}

/** @type {Types.RSVPExportHandler} */
function RSVPExportHandler(req, res) {
  const rsvps = getAllRsvps()
  const csv = rsvpsToCSV(rsvps)
  const filename = `rsvps-${new Date().toISOString().slice(0, 10)}.csv`
  return sendCsv(res, filename, csv)
}

export const list = withAdmin(RSVPListHandler)
export const exportCSV = withAdmin(RSVPExportHandler)
