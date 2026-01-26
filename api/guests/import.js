/** @import * as Types from './types.js' */

import { LIMITS } from "../../types.js"
import { withAdmin } from "../../core/auth.js"
import { parseCSV } from "../../core/csv.js"
import { createGuest } from "./data.js"
import { getDb } from "../../db/connection.js"
import { withTransaction } from "../../db/utils.js"
import { sendJson, parseBody } from "../../core/http.js"
import { ValidationError } from "../../core/errors.js"
import { log, AUDIT_ACTIONS } from "../../core/log.js"
import { getClientIp } from "../../core/rate-limit.js"
import {
  validateRequiredString,
  validatePartySize,
  validateEmail,
  validatePhone,
  validateOptionalString,
} from "../../core/validation.js"

/** @type {Types.ImportHandlerFn} */
async function importHandler(req, res, { session }) {
  let body
  try {
    body = await parseBody(req)
  } catch (err) {
    throw new ValidationError("Invalid JSON body")
  }

  const { csv } = body
  if (!csv || typeof csv !== "string") {
    throw new ValidationError("CSV data required")
  }

  const rows = parseCSV(csv)
  /** @type {Types.ImportResult} */
  const result = {
    added: 0,
    skipped: [],
    errors: [],
  }

  if (!rows[0] || !("name" in rows[0])) {
    throw new ValidationError('CSV must have a "name" column')
  }

  /** @type {Types.ValidatedRow[]} */
  const validatedRows = []
  const db = getDb()

  for (const row of rows) {
    const lineNum = row._lineNumber

    const nameResult = validateRequiredString(
      row.name,
      "Name",
      LIMITS.NAME_MAX_LENGTH,
    )
    if (!nameResult.valid) {
      result.errors.push({ line: lineNum, error: nameResult.error })
      continue
    }

    const emailResult = validateEmail(row.email)
    if (!emailResult.valid) {
      result.errors.push({ line: lineNum, error: emailResult.error })
      continue
    }

    const phoneResult = validatePhone(row.phone)
    if (!phoneResult.valid) {
      result.errors.push({ line: lineNum, error: phoneResult.error })
      continue
    }

    const partySizeResult = validatePartySize(row.party_size ?? 1)
    if (!partySizeResult.valid) {
      result.errors.push({ line: lineNum, error: partySizeResult.error })
      continue
    }

    const notesResult = validateOptionalString(
      row.notes,
      LIMITS.NOTES_MAX_LENGTH,
    )

    const name = nameResult.value
    const email = emailResult.value
    const phone = phoneResult.value
    const partySize = partySizeResult.value
    const notes = notesResult.value

    if (email || phone) {
      let checkSql =
        "SELECT email, phone FROM guests WHERE deleted_at IS NULL AND ("
      const conditions = []
      const params = []

      if (email) {
        conditions.push("email = ?")
        params.push(email.toLowerCase().trim())
      }
      if (phone) {
        conditions.push("phone = ?")
        params.push(phone)
      }

      checkSql += conditions.join(" OR ") + ") LIMIT 1"
      const existing = db.prepare(checkSql).get(...params)

      if (existing) {
        const reason =
          email && existing.email === email.toLowerCase().trim()
            ? `Email already exists: ${email}`
            : `Phone already exists: ${phone}`
        result.skipped.push({ line: lineNum, name, reason })
        continue
      }
    }

    validatedRows.push({ lineNum, name, email, phone, partySize, notes })
  }

  if (validatedRows.length > 0) {
    try {
      withTransaction(() => {
        for (const {
          lineNum,
          name,
          email,
          phone,
          partySize,
          notes,
        } of validatedRows) {
          try {
            createGuest({ name, email, phone, party_size: partySize, notes })
            result.added++
          } catch (err) {
            const message = err instanceof Error ? err.message : ""
            if (message.includes("UNIQUE constraint failed")) {
              result.skipped.push({
                line: lineNum,
                name,
                reason: "Duplicate entry",
              })
            } else {
              throw err
            }
          }
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      result.errors.push({
        error: `Import failed: ${message}. All changes rolled back.`,
      })
      result.added = 0
    }
  }

  if (result.added > 0) {
    log({
      action: AUDIT_ACTIONS.GUEST_IMPORT,
      adminId: session?.token,
      ip: getClientIp(req),
      details: {
        added: result.added,
        skipped: result.skipped.length,
        errors: result.errors.length,
      },
    })
  }

  return sendJson(res, 200, result)
}

export const importCSV = withAdmin(importHandler)
