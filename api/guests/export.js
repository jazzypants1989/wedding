/** @file Guest CSV export */
/** @import { ExportHandlerFn } from './types.js' */

import { guestsToCSV } from "../../core/csv.js"
import { getAllGuests } from "./data.js"
import { sendCsv } from "../../core/http.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"

/** @type {ExportHandlerFn} */
export function exportCSV(req, res) {
  const guests = getAllGuests({ limit: 1000000, offset: 0 })
  const csv = guestsToCSV(guests)
  const filename = `guests-${new Date().toISOString().slice(0, 10)}.csv`

  log({
    action: AUDIT_ACTIONS.GUEST_EXPORT,
    ip: getClientIp(req),
    details: { guestCount: guests.length, filename },
  })

  return sendCsv(res, filename, csv)
}
