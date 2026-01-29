/** @import * as Types from './types.js' */

import { LIMITS } from "../../types.js"
import { parseCSV } from "../../core/csv.js"
import { createGuest } from "./data.js"
import { sql } from "../../db/sql.js"
import {
  withTransaction,
  normalizeEmail,
  normalizePhone,
} from "../../db/utils.js"
import { sendJson, parseBody } from "../../core/http.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import {
  ValidationError,
  validateRequiredString,
  validatePartySize,
  validateEmail,
  validatePhone,
  validateOptionalString,
} from "../../core/validation.js"

/** @type {Types.ImportHandlerFn} */
export async function importCSV(req, res, { session }) {
  const body = await parseBody(req)

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
      const conditions = []
      if (email) conditions.push(sql`email = ${normalizeEmail(email)}`)
      if (phone) conditions.push(sql`phone = ${normalizePhone(phone)}`)
      const orClause = sql.join(conditions, " OR ")
      const existing =
        sql`SELECT email, phone FROM guests WHERE deleted_at IS NULL AND (${orClause}) LIMIT 1`.get()

      if (existing) {
        const reason =
          email && existing.email === normalizeEmail(email)
            ? `Email already exists: ${email}`
            : `Phone already exists: ${phone}`
        result.skipped.push({ line: lineNum, name, reason })
        continue
      }
    }

    validatedRows.push({ lineNum, name, email, phone, partySize, notes })
  }

  // Intra-file deduplication: check for duplicate emails/phones within the CSV
  /** @type {Set<string>} */
  const seenEmails = new Set()
  /** @type {Set<string>} */
  const seenPhones = new Set()
  /** @type {Types.ValidatedRow[]} */
  const dedupedRows = []

  for (const row of validatedRows) {
    const normEmail = row.email ? normalizeEmail(row.email) : null
    const normPhone = row.phone ? normalizePhone(row.phone) : null
    let isDuplicate = false

    if (normEmail && seenEmails.has(normEmail)) {
      result.skipped.push({
        line: row.lineNum,
        name: row.name,
        reason: `Duplicate email within CSV: ${row.email}`,
      })
      isDuplicate = true
    }
    if (!isDuplicate && normPhone && seenPhones.has(normPhone)) {
      result.skipped.push({
        line: row.lineNum,
        name: row.name,
        reason: `Duplicate phone within CSV: ${row.phone}`,
      })
      isDuplicate = true
    }

    if (!isDuplicate) {
      if (normEmail) seenEmails.add(normEmail)
      if (normPhone) seenPhones.add(normPhone)
      dedupedRows.push(row)
    }
  }

  if (dedupedRows.length > 0) {
    try {
      withTransaction(() => {
        for (const {
          lineNum,
          name,
          email,
          phone,
          partySize,
          notes,
        } of dedupedRows) {
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
