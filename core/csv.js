/** @import * as Types from './types.js' */

/** @type {Types.parseCSV} */
export function parseCSV(csvString) {
  const lines = []
  let currentLine = []
  let currentField = ""
  let inQuotes = false

  for (let i = 0; i < csvString.length; i++) {
    const char = csvString[i]
    const nextChar = csvString[i + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        currentField += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ",") {
        currentLine.push(currentField.trim())
        currentField = ""
      } else if (char === "\n" || (char === "\r" && nextChar === "\n")) {
        currentLine.push(currentField.trim())
        if (currentLine.some((f) => f !== "")) {
          lines.push(currentLine)
        }
        currentLine = []
        currentField = ""
        if (char === "\r") i++
      } else if (char !== "\r") {
        currentField += char
      }
    }
  }

  currentLine.push(currentField.trim())
  if (currentLine.some((f) => f !== "")) {
    lines.push(currentLine)
  }

  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row")
  }

  const headers = lines[0].map((h) => h.toLowerCase().trim())
  const rows = lines.slice(1).map((line, lineIndex) => {
    /** @type {Types.CSVRow} */
    const obj = { _lineNumber: lineIndex + 2 }
    headers.forEach((header, i) => {
      obj[header] = line[i] || ""
    })
    return obj
  })

  return rows
}

/** @type {Types.escapeCSVField} */
export function escapeCSVField(value) {
  if (value === null || value === undefined) return ""
  const str = String(value)
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replaceAll('"', '""') + '"'
  }
  return str
}

/** @type {Types.guestsToCSV} */
export function guestsToCSV(guests) {
  const headers = [
    "name",
    "email",
    "phone",
    "party_size",
    "status",
    "invite_code",
    "notes",
    "created_at",
    "last_invited_at",
  ]
  const rows = [headers.join(",")]

  for (const guest of guests) {
    const row = headers.map((h) => escapeCSVField(guest[h]))
    rows.push(row.join(","))
  }

  return rows.join("\n")
}

/** @type {Types.rsvpsToCSV} */
export function rsvpsToCSV(rsvps) {
  const headers = [
    "name",
    "email",
    "phone",
    "attending",
    "party_size",
    "dietary_restrictions",
    "additional_info",
    "message",
    "submitted_at",
  ]
  const rows = [headers.join(",")]

  for (const rsvp of rsvps) {
    const row = [
      escapeCSVField(rsvp.name),
      escapeCSVField(rsvp.email),
      escapeCSVField(rsvp.phone),
      rsvp.attending ? "Yes" : "No",
      escapeCSVField(rsvp.actual_party_size),
      escapeCSVField(rsvp.dietary_restrictions),
      escapeCSVField(rsvp.additional_info),
      escapeCSVField(rsvp.message),
      escapeCSVField(rsvp.submitted_at),
    ]
    rows.push(row.join(","))
  }

  return rows.join("\n")
}
