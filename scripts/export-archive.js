#!/usr/bin/env node
/**
 * @file Sunset-insurance archive export.
 *
 * This wedding site will retire someday. This script turns the live database +
 * upload volume into a single self-contained folder the couple can keep forever:
 * guestbook entries, comments, reactions, the account roster, media metadata,
 * the gift ledger, and every thank-you card (with its full reply thread) as both
 * JSON (machine-readable) and CSV (opens in any spreadsheet), plus the whole
 * `data/uploads/media/` tree copied (hardlinked where possible) alongside an
 * `index.json` mapping each file_key → caption / author / date.
 *
 * It exports EVERYTHING, including hidden/rejected/soft-deleted rows, so nothing
 * the couple owns is lost; each row carries its `status`/`deleted_at` so live
 * content stays distinguishable. Read-only against the DB (safe on a running server).
 *
 * Privacy: a card's `token` is a live share credential while the site is up, so
 * it is NEVER written to the archive. Gift `amount` is admin-only and omitted by
 * default — pass `--include-amounts` to include it.
 *
 * Usage:
 *   node scripts/export-archive.js                    # → data/exports/wedding-archive-<stamp>/
 *   node scripts/export-archive.js --out DIR          # → DIR/wedding-archive-<stamp>/
 *   node scripts/export-archive.js --include-amounts  # include the gift amount column
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

// Gift amounts are admin-only and off by default; opt in explicitly. When off
// the `amount` column is omitted from both the query and the exports entirely
// (absent, not blank), so a shared archive never leaks money figures.
const includeAmounts = process.argv.includes("--include-amounts")

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
         m.needs_display, m.sort_order, m.twin_of, m.created_at, m.updated_at,
         m.reviewed_at, m.deleted_at
  FROM media m
  LEFT JOIN accounts a ON a.id = m.account_id
  ORDER BY m.id
`)

// The gift ledger. `amount` is spliced into the SELECT only under --include-amounts
// so, when off, it never lands in the row objects (and therefore never in the
// JSON or CSV). guest_id is the giver; the joined guests name is exported as
// recipient_name to match the card exports' column vocabulary.
const giftAmountSelect = includeAmounts ? "g.amount, " : ""
const gifts = queryAll(`
  SELECT g.id, g.guest_id, gu.name AS recipient_name, g.description, g.notes,
         ${giftAmountSelect}g.received_at, g.physical_card_sent, g.physical_card_sent_at,
         g.created_at, g.updated_at, g.deleted_at
  FROM gifts g
  LEFT JOIN guests gu ON gu.id = g.guest_id
  ORDER BY g.id
`)

// Thank-you cards. `token` is a live share credential and is REDACTED (never
// selected). The flat rows carry the latest-reply mirror columns (reply_emoji /
// reply_message / replied_at); the full thread is nested per card below.
const thankYouCardsFlat = queryAll(`
  SELECT t.id, t.guest_id, g.name AS recipient_name, t.gift_id, t.message,
         t.theme, t.effects_config, t.media_keys, t.status, t.sent_via,
         t.sent_at, t.viewed_at, t.view_count, t.last_viewed_at,
         t.reply_emoji, t.reply_message, t.replied_at, t.reply_seen_at,
         t.created_at, t.updated_at, t.deleted_at
  FROM thank_you_cards t
  LEFT JOIN guests g ON g.id = t.guest_id
  ORDER BY t.id
`)

// Append-only reply history (flat, exported as CSV and nested into each card).
const thankYouReplies = queryAll(`
  SELECT id, card_id, emoji, message, created_at
  FROM thank_you_card_replies
  ORDER BY id
`)

db.close()

// Group replies by card so each card's JSON carries its full thread in order.
/** @type {Map<number, Array<Record<string, unknown>>>} */
const repliesByCard = new Map()
for (const r of thankYouReplies) {
  const cardId = Number(r.card_id)
  let list = repliesByCard.get(cardId)
  if (!list) {
    list = []
    repliesByCard.set(cardId, list)
  }
  list.push({ emoji: r.emoji, message: r.message, created_at: r.created_at })
}

// JSON view: flat card fields + a nested `replies` array. The CSV stays flat
// (latest-reply columns only); the full thread lives in thank-you-replies.csv.
const thankYouCards = thankYouCardsFlat.map((c) => ({
  ...c,
  replies: repliesByCard.get(Number(c.id)) || [],
}))

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
  // Set on a black-and-white copy: the id of the colour photo it belongs to.
  "twin_of",
  "created_at", "reviewed_at", "deleted_at",
]
// `amount` is present only under --include-amounts (see giftAmountSelect above);
// spreading it in conditionally keeps the header list in lockstep with the rows.
const GIFTS_HEADERS = [
  "id", "guest_id", "recipient_name", "description", "notes",
  ...(includeAmounts ? ["amount"] : []),
  "received_at", "physical_card_sent", "physical_card_sent_at",
  "created_at", "updated_at", "deleted_at",
]
// Flat card CSV: latest-reply mirror columns only (no token). The full thread
// is in thank-you-replies.csv and nested in thank-you-cards.json.
const THANK_YOU_CARDS_HEADERS = [
  "id", "guest_id", "recipient_name", "gift_id", "message", "theme",
  "effects_config", "media_keys", "status", "sent_via", "sent_at", "viewed_at",
  "view_count", "last_viewed_at", "reply_emoji", "reply_message", "replied_at",
  "reply_seen_at", "created_at", "updated_at", "deleted_at",
]
const THANK_YOU_REPLIES_HEADERS = [
  "id", "card_id", "emoji", "message", "created_at",
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
writeJSON("gifts.json", gifts)
writeText("gifts.csv", rowsToCSV(GIFTS_HEADERS, gifts))
writeJSON("thank-you-cards.json", thankYouCards)
writeText("thank-you-cards.csv", rowsToCSV(THANK_YOU_CARDS_HEADERS, thankYouCardsFlat))
writeText("thank-you-replies.csv", rowsToCSV(THANK_YOU_REPLIES_HEADERS, thankYouReplies))

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
    gifts: gifts.length,
    thankYouCards: thankYouCards.length,
    thankYouReplies: thankYouReplies.length,
    mediaFiles: mediaStats.fileCount,
  },
  files: {
    accounts: ["accounts.json", "accounts.csv"],
    guestbook: ["guestbook.json", "guestbook.csv"],
    comments: ["comments.json", "comments.csv"],
    reactions: ["reactions.json", "reactions.csv"],
    media: ["media.json", "media.csv"],
    gifts: ["gifts.json", "gifts.csv"],
    thankYouCards: ["thank-you-cards.json", "thank-you-cards.csv"],
    thankYouReplies: ["thank-you-replies.csv"],
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
console.log(`  Gifts:       ${gifts.length}${includeAmounts ? " (incl. amounts)" : ""}`)
console.log(`  Thank-yous:  ${thankYouCards.length} cards, ${thankYouReplies.length} replies`)
console.log(`  Media files: ${mediaStats.fileCount} (${mb} MB)`)
console.log("")
console.log("Each entity written as both .json and .csv; index.json maps file_keys.")
console.log("")
