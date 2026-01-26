/** @file Guest CSV export */
/** @import { ExportHandlerFn } from './types.js' */

import { withAdmin } from "../../core/auth.js"
import { guestsToCSV } from "../../core/csv.js"
import { getAllGuests } from "./data.js"
import { sendCsv } from "../../core/http.js"

/** @type {ExportHandlerFn} */
function exportHandler(req, res) {
  const guests = getAllGuests({ limit: 10000, offset: 0 })
  const csv = guestsToCSV(guests)
  const filename = `guests-${new Date().toISOString().slice(0, 10)}.csv`
  return sendCsv(res, filename, csv)
}

export const exportCSV = withAdmin(exportHandler)
