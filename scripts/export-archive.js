#!/usr/bin/env node
/**
 * @file Sunset-insurance archive export.
 *
 * This wedding site will retire someday. This script turns the live database +
 * upload volume into a single self-contained folder the couple can keep forever:
 * guestbook entries, comments, reactions, the account roster, and media metadata
 * as both JSON (machine-readable) and CSV (opens in any spreadsheet), plus the
 * whole `data/uploads/media/` tree copied (hardlinked where possible) alongside
 * an `index.json` mapping each file_key → caption / author / date.
 *
 * It exports EVERYTHING, including hidden/rejected/soft-deleted rows, so nothing
 * the couple owns is lost; each row carries its `status`/`deleted_at` so live
 * content stays distinguishable. Read-only against the DB (safe on a running server).
 *
 * Usage:
 *   node scripts/export-archive.js            # → data/exports/wedding-archive-<stamp>/
 *   node scripts/export-archive.js --out DIR  # → DIR/wedding-archive-<stamp>/
 */

import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import fs from "node:fs"
import { escapeCSVField } from "../core/csv.js"
import { MEDIA_DIR, itemDir } from "../core/media-storage.js"

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.join(import.meta.dirname, "..", "data", "wedding.db")

/** Local timestamp as YYYYMMDD-HHMMSS (fixed-width → name-sortable), no RegExp. */
function timestamp() {
  const d = new Date()
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0")
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${date}-${time}`
}

// --out DIR chooses the parent directory; the archive itself is a timestamped
// subfolder so repeated runs never clobber each other.
const outFlag = process.argv.indexOf("--out")
const parentDir =
  outFlag !== -1 && process.argv[outFlag + 1]
    ? process.argv[outFlag + 1]
    : path.join(path.dirname(DB_PATH), "exports")
const outDir = path.join(parentDir, `wedding-archive-${timestamp()}`)

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH} — nothing to export.`)
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })

const db = new DatabaseSync(DB_PATH)

/**
 * Run a query and return its rows as plain records (safe to JSON.stringify and
 * to index by header name for CSV).
 * @param {string} sql
 * @returns {Record<string, unknown>[]}
 */
function queryAll(sql) {
  return /** @type {Record<string, unknown>[]} */ (db.prepare(sql).all())
}

const accounts = queryAll(`
  SELECT id, guest_id, name, relation, contact_email, trusted,
         created_at, updated_at, deleted_at
  FROM accounts ORDER BY id
`)

const guestbook = queryAll(`
  SELECT g.id, g.account_id, a.name AS author_name, a.trusted AS author_trusted,
         g.message, g.status, g.created_at, g.updated_at, g.reviewed_at, g.deleted_at
  FROM guestbook_entries g
  LEFT JOIN accounts a ON a.id = g.account_id
  ORDER BY g.id
`)

const comments = queryAll(`
  SELECT c.id, c.account_id, a.name AS author_name, c.target_type, c.target_id,
         c.message, c.status, c.created_at, c.updated_at, c.reviewed_at, c.deleted_at
  FROM comments c
  LEFT JOIN accounts a ON a.id = c.account_id
  ORDER BY c.id
`)

const reactions = queryAll(`
  SELECT r.id, r.account_id, a.name AS author_name, r.target_type, r.target_id,
         r.emoji, r.created_at
  FROM reactions r
  LEFT JOIN accounts a ON a.id = r.account_id
  ORDER BY r.id
`)

const media = queryAll(`
  SELECT m.id, m.file_key, m.account_id, a.name AS author_name, m.kind, m.section,
         m.status, m.caption, m.original_ext, m.original_bytes, m.display_bytes,
         m.thumb_bytes, m.poster_bytes, m.width, m.height, m.duration_seconds,
         m.needs_display, m.sort_order, m.created_at, m.updated_at,
         m.reviewed_at, m.deleted_at
  FROM media m
  LEFT JOIN accounts a ON a.id = m.account_id
  ORDER BY m.id
`)

db.close()

// ---- CSV serializers (per-entity header lists on top of escapeCSVField) -------

/**
 * @param {string[]} headers
 * @param {Record<string, unknown>[]} rows
 */
function rowsToCSV(headers, rows) {
  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCSVField(row[h])).join(","))
  }
  return lines.join("\n")
}

const ACCOUNTS_HEADERS = [
  "id", "guest_id", "name", "relation", "contact_email", "trusted",
  "created_at", "updated_at", "deleted_at",
]
const GUESTBOOK_HEADERS = [
  "id", "author_name", "author_trusted", "message", "status",
  "created_at", "updated_at", "reviewed_at", "deleted_at",
]
const COMMENTS_HEADERS = [
  "id", "author_name", "target_type", "target_id", "message", "status",
  "created_at", "updated_at", "reviewed_at", "deleted_at",
]
const REACTIONS_HEADERS = [
  "id", "author_name", "target_type", "target_id", "emoji", "created_at",
]
const MEDIA_HEADERS = [
  "id", "file_key", "author_name", "kind", "section", "status", "caption",
  "original_ext", "original_bytes", "width", "height", "duration_seconds",
  "created_at", "reviewed_at", "deleted_at",
]

// ---- Write the JSON + CSV data files -----------------------------------------

/** @param {string} name @param {unknown} data */
function writeJSON(name, data) {
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2) + "\n")
}
/** @param {string} name @param {string} text */
function writeText(name, text) {
  fs.writeFileSync(path.join(outDir, name), text + "\n")
}

writeJSON("accounts.json", accounts)
writeText("accounts.csv", rowsToCSV(ACCOUNTS_HEADERS, accounts))
writeJSON("guestbook.json", guestbook)
writeText("guestbook.csv", rowsToCSV(GUESTBOOK_HEADERS, guestbook))
writeJSON("comments.json", comments)
writeText("comments.csv", rowsToCSV(COMMENTS_HEADERS, comments))
writeJSON("reactions.json", reactions)
writeText("reactions.csv", rowsToCSV(REACTIONS_HEADERS, reactions))
writeJSON("media.json", media)
writeText("media.csv", rowsToCSV(MEDIA_HEADERS, media))

// ---- Copy the media tree (hardlink where possible, copy across filesystems) ---

/** @param {string} src @param {string} dest */
function linkOrCopy(src, dest) {
  try {
    fs.linkSync(src, dest)
  } catch {
    // Cross-device (EXDEV) or the link already exists → fall back to a real copy.
    fs.copyFileSync(src, dest)
  }
}

/**
 * Recursively mirror srcRoot into destRoot, preserving the {key[0:2]}/{key}/
 * layout. Returns totals for the summary.
 * @param {string} srcRoot @param {string} destRoot
 */
function copyTree(srcRoot, destRoot) {
  let fileCount = 0
  let byteCount = 0
  /** @param {string} rel */
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(srcRoot, rel), { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name
      if (entry.isDirectory()) {
        walk(childRel)
      } else if (entry.isFile()) {
        const src = path.join(srcRoot, childRel)
        const dest = path.join(destRoot, childRel)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        linkOrCopy(src, dest)
        fileCount++
        byteCount += fs.statSync(src).size
      }
    }
  }
  walk("")
  return { fileCount, byteCount }
}

const mediaOut = path.join(outDir, "media")
let mediaStats = { fileCount: 0, byteCount: 0 }
if (fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(mediaOut, { recursive: true })
  mediaStats = copyTree(MEDIA_DIR, mediaOut)
}

// ---- index.json: manifest + file_key → caption/author/date -------------------

/** @type {Record<string, unknown>} */
const mediaIndex = {}
for (const m of media) {
  const fileKey = String(m.file_key)
  const dir = itemDir(fileKey)
  /** @type {string[]} */
  let variants = []
  if (fs.existsSync(dir)) {
    variants = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
  }
  mediaIndex[fileKey] = {
    caption: m.caption,
    author: m.author_name,
    kind: m.kind,
    section: m.section,
    status: m.status,
    created_at: m.created_at,
    variants,
  }
}

writeJSON("index.json", {
  generatedAt: new Date().toISOString(),
  source: DB_PATH,
  counts: {
    accounts: accounts.length,
    guestbook: guestbook.length,
    comments: comments.length,
    reactions: reactions.length,
    media: media.length,
    mediaFiles: mediaStats.fileCount,
  },
  files: {
    accounts: ["accounts.json", "accounts.csv"],
    guestbook: ["guestbook.json", "guestbook.csv"],
    comments: ["comments.json", "comments.csv"],
    reactions: ["reactions.json", "reactions.csv"],
    media: ["media.json", "media.csv"],
    mediaTree: "media/",
  },
  media: mediaIndex,
})

// ---- Summary -----------------------------------------------------------------

const mb = (mediaStats.byteCount / (1024 * 1024)).toFixed(1)
console.log("")
console.log("=== Wedding Archive Exported ===")
console.log("")
console.log(`  Output:      ${outDir}`)
console.log(`  Accounts:    ${accounts.length}`)
console.log(`  Guestbook:   ${guestbook.length}`)
console.log(`  Comments:    ${comments.length}`)
console.log(`  Reactions:   ${reactions.length}`)
console.log(`  Media rows:  ${media.length}`)
console.log(`  Media files: ${mediaStats.fileCount} (${mb} MB)`)
console.log("")
console.log("Each entity written as both .json and .csv; index.json maps file_keys.")
console.log("")
