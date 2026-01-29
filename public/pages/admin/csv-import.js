/** @file CSV Import module */
/** @import * as Types from './types.js' */

import { api, openModal } from "./utils.js"
import { loadGuests, loadStats } from "./guests.js"
import {
  html,
  getElement,
  getInputElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"

/** @type {Types.CsvImportState} */
const moduleState = { csvData: null }

const MAX_FILE_SIZE = 5 * 1024 * 1024

/** @type {Types.parseRow} */
function parseRow(row) {
  /** @type {Types.CsvRow} */
  const result = []
  let current = ""
  let inQuotes = false
  let i = 0

  while (i < row.length) {
    const char = row[i]

    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"'
        i += 2
        continue
      }
      inQuotes = !inQuotes
    } else if (char === "," && !inQuotes) {
      result.push(current.trim())
      current = ""
    } else {
      current += char
    }
    i++
  }
  result.push(current.trim())
  return result
}

/** @type {Types.showCSVPreview} */
function showCSVPreview(csvText) {
  const lines = csvText
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .filter((line) => line.trim())
  if (lines.length < 2) {
    getElement("csv-preview").hidden = true
    return
  }

  const headers = parseRow(lines[0])
  const previewRows = lines.slice(1, 6).map(parseRow)

  getElement("csv-preview-table").innerHTML = html`
    <table class="preview-table">
      <thead>
        <tr>
          ${headers.map((h) => html`<th>${h}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${previewRows.map(
          (row) => html`
            <tr>
              ${headers.map((_, i) => html`<td>${row[i] || ""}</td>`)}
            </tr>
          `,
        )}
        ${lines.length > 6 &&
        html`
          <tr>
            <td colspan="${headers.length}" class="text-muted">
              ...and ${lines.length - 6} more rows
            </td>
          </tr>
        `}
      </tbody>
    </table>
  `
  getElement("csv-preview").hidden = false
}

/** @type {Types.openImportModal} */
function openImportModal() {
  getInputElement("csv-file").value = ""
  getElement("file-name").textContent = "Choose CSV file..."
  getElement("csv-preview").hidden = true
  getElement("import-results").hidden = true
  getElement("import-instructions").hidden = false
  getElement("import-form-error").hidden = true
  const submitBtn = getButtonElement("import-submit-btn")
  submitBtn.disabled = true
  submitBtn.textContent = "Import Guests"
  moduleState.csvData = null
  openModal(getDialogElement("import-modal"))
}

/** @type {Types.handleFileSelect} */
async function handleFileSelect(e) {
  const target = e.target
  if (!(target instanceof HTMLInputElement) || !target.files) return

  const file = target.files[0]
  if (!file) return

  const errorEl = getElement("import-form-error")
  const submitBtn = getButtonElement("import-submit-btn")

  if (file.size > MAX_FILE_SIZE) {
    errorEl.textContent = "File too large. Maximum size is 5MB."
    errorEl.hidden = false
    getInputElement("csv-file").value = ""
    getElement("file-name").textContent = "Choose CSV file..."
    submitBtn.disabled = true
    return
  }

  getElement("file-name").textContent = file.name
  errorEl.hidden = true

  try {
    moduleState.csvData = await file.text()
    showCSVPreview(moduleState.csvData)
    submitBtn.disabled = false
  } catch (err) {
    errorEl.textContent = "Failed to read file"
    errorEl.hidden = false
    submitBtn.disabled = true
  }
}

/** @type {Types.handleImportSubmit} */
async function handleImportSubmit() {
  if (!moduleState.csvData) return

  const submitBtn = getButtonElement("import-submit-btn")
  const errorEl = getElement("import-form-error")

  submitBtn.disabled = true
  submitBtn.textContent = "Importing..."
  errorEl.hidden = true

  try {
    const data = await api("/api/admin/guests/import", {
      method: "POST",
      body: JSON.stringify({ csv: moduleState.csvData }),
    })
    const result = /** @type {Types.ImportResult} */ (data)

    getElement("import-instructions").hidden = true
    getElement("import-results").hidden = false

    getElement("import-results-content").innerHTML = html`
      <div class="import-summary">
        <div class="import-stat success">
          <strong>${result.added}</strong> guests added
        </div>
        <div class="import-stat warning">
          <strong>${result.skipped.length}</strong> skipped
        </div>
        <div class="import-stat error">
          <strong>${result.errors.length}</strong> errors
        </div>
      </div>
      ${result.skipped.length > 0 &&
      html`
        <h4>Skipped (duplicates):</h4>
        <ul class="import-list">
          ${result.skipped.map(
            (s) => html`
              <li><strong>Line ${s.line}:</strong> ${s.name} - ${s.reason}</li>
            `,
          )}
        </ul>
      `}
      ${result.errors.length > 0 &&
      html`
        <h4>Errors:</h4>
        <ul class="import-list error-list">
          ${result.errors.map(
            (e) => html` <li><strong>Line ${e.line}:</strong> ${e.error}</li> `,
          )}
        </ul>
      `}
    `
    submitBtn.textContent = "Done"

    await loadGuests()
    await loadStats()
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
    submitBtn.disabled = false
    submitBtn.textContent = "Import Guests"
  }
}

/** @type {Types.initCSVImport} */
export function initCSVImport() {
  getElement("import-csv-btn").addEventListener("click", openImportModal)
  getInputElement("csv-file").addEventListener("change", handleFileSelect)
  getButtonElement("import-submit-btn").addEventListener(
    "click",
    handleImportSubmit,
  )
}
