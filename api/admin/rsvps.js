/** @file Admin RSVP endpoints */
/** @import * as Types from './types.js' */

import { rsvpsToCSV } from "../../core/csv.js"
import { getAllRsvps } from "../rsvp.js"
import { sendJson, sendCsv } from "../../core/http.js"

/** @type {Types.RSVPListHandler} */
export function list(req, res) {
  const rsvps = getAllRsvps()
  return sendJson(res, 200, { rsvps })
}

/** @type {Types.RSVPExportHandler} */
export function exportCSV(req, res) {
  const rsvps = getAllRsvps()
  const csv = rsvpsToCSV(rsvps)
  const filename = `rsvps-${new Date().toISOString().slice(0, 10)}.csv`
  return sendCsv(res, filename, csv)
}

