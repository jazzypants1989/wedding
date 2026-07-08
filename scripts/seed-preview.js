#!/usr/bin/env node

/**
 * @file Seed preview data for testing the guest RSVP experience.
 * Creates test guests covering different scenarios and prints preview URLs.
 * Idempotent: removes previous preview data before seeding.
 */

import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import fs from "node:fs"
import crypto from "node:crypto"
import { createTables, runMigrations } from "../db/schema.js"
import { ensureUploadDirs, itemDir, variantDiskPath } from "../core/media-storage.js"
import { makeJpeg, makeMp4 } from "../tests/media-fixtures.js"

const DB_PATH = path.join(import.meta.dirname, "..", "data", "wedding.db")
const BASE_URL = "http://localhost:3000"

// --gallery N seeds ~N media rows (+ tiny on-disk fixtures) for the grid perf
// check. Default 2000 when the flag is present without a count.
const galleryFlag = process.argv.indexOf("--gallery")
const galleryCount =
  galleryFlag === -1 ? 0 : Math.max(1, Number(process.argv[galleryFlag + 1]) || 2000)

const db = new DatabaseSync(DB_PATH)
db.exec("PRAGMA foreign_keys = ON")
db.exec("PRAGMA journal_mode = WAL")
db.exec("PRAGMA synchronous = NORMAL")

createTables(db)
runMigrations(db)

// Clean previous preview data
db.prepare(
  "DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE invite_code LIKE 'PREVIEW%')",
).run()
db.prepare("DELETE FROM guests WHERE invite_code LIKE 'PREVIEW%'").run()

// Preview guests
const guests = [
  {
    name: "Alice Solo",
    email: "preview-alice@example.com",
    party_size: 1,
    invite_code: "PREVIEWa",
    status: "invited",
    notes: "Preview: solo guest, no RSVP yet",
  },
  {
    name: "Bob Family",
    email: "preview-bob@example.com",
    party_size: 4,
    invite_code: "PREVIEWb",
    status: "invited",
    notes: "Preview: group of 4, no RSVP yet",
  },
  {
    name: "Carol Yes",
    email: "preview-carol@example.com",
    party_size: 3,
    invite_code: "PREVIEWc",
    status: "responded",
    notes: "Preview: RSVP yes with party of 2",
  },
  {
    name: "Dave No",
    email: "preview-dave@example.com",
    party_size: 2,
    invite_code: "PREVIEWd",
    status: "responded",
    notes: "Preview: RSVP declined",
  },
]

const insertGuest = db.prepare(
  "INSERT INTO guests (name, email, phone, party_size, invite_code, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
)

/** @type {Record<string, number | bigint>} */
const guestIds = {}
for (const g of guests) {
  const result = insertGuest.run(
    g.name,
    g.email,
    null,
    g.party_size,
    g.invite_code,
    g.status,
    g.notes,
  )
  guestIds[g.invite_code] = result.lastInsertRowid
}

// Insert RSVPs for Carol (yes) and Dave (no)
const insertRsvp = db.prepare(
  "INSERT INTO rsvps (guest_id, attending, actual_party_size, dietary_restrictions, message) VALUES (?, ?, ?, ?, ?)",
)

insertRsvp.run(
  guestIds["PREVIEWc"],
  1,
  2,
  "Vegetarian",
  "So excited for your big day!",
)

insertRsvp.run(
  guestIds["PREVIEWd"],
  0,
  null,
  null,
  "Sorry we can not make it, congratulations!",
)

if (galleryCount > 0) seedGallery(db, galleryCount)

db.close()

/**
 * Seed ~count media rows with tiny on-disk fixtures so /media serves 200s and
 * the content-visibility grid can be perf-checked. Idempotent: clears prior
 * preview media (by preview accounts + the official marker) first.
 * @param {DatabaseSync} db @param {number} count
 */
function seedGallery(db, count) {
  ensureUploadDirs()

  // Clean previous gallery preview data (rows + their on-disk dirs).
  const stale = /** @type {{ file_key: string }[]} */ (
    db
      .prepare(
        `SELECT file_key FROM media
         WHERE account_id IN (SELECT id FROM accounts WHERE name_normalized LIKE 'preview %')
            OR caption = 'preview-official'`,
      )
      .all()
  )
  for (const r of stale) fs.rmSync(itemDir(r.file_key), { recursive: true, force: true })
  db.prepare(
    `DELETE FROM media
     WHERE account_id IN (SELECT id FROM accounts WHERE name_normalized LIKE 'preview %')
        OR caption = 'preview-official'`,
  ).run()
  db.prepare(`DELETE FROM accounts WHERE name_normalized LIKE 'preview %'`).run()

  // Three preview authors (two trusted → approved, one untrusted → pending).
  const insertAccount = db.prepare(
    `INSERT INTO accounts (name, name_normalized, trusted) VALUES (?, ?, ?)`,
  )
  /** @param {string} name @param {0 | 1} trusted */
  const account = (name, trusted) =>
    Number(insertAccount.run(name, name.toLowerCase(), trusted).lastInsertRowid)
  const alice = account("Preview Alice", 1)
  const bob = account("Preview Bob", 1)
  const cara = account("Preview Cara", 0)

  const insertMedia = db.prepare(
    `INSERT INTO media (file_key, account_id, kind, section, status, caption, original_ext,
       original_bytes, display_bytes, thumb_bytes, poster_bytes, width, height,
       duration_seconds, needs_display, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const jpgOriginal = makeJpeg(256)
  const jpgDisplay = makeJpeg(200)
  const jpgThumb = makeJpeg(120)
  const mp4Original = makeMp4(256)

  const OFFICIAL = 6 // a handful of curated items in the official section
  let approved = 0
  let pending = 0
  let videos = 0

  for (let i = 0; i < count; i++) {
    const fileKey = crypto.randomBytes(16).toString("hex")
    const isOfficial = i < OFFICIAL
    const isVideo = !isOfficial && i % 7 === 0
    const isPending = !isOfficial && !isVideo && i % 11 === 0

    const section = isOfficial ? "official" : "guest"
    const status = isPending ? "pending" : "approved"
    const accountId = isOfficial ? null : isPending ? cara : i % 2 === 0 ? alice : bob
    const caption = isOfficial ? "preview-official" : null

    const dir = itemDir(fileKey)
    fs.mkdirSync(dir, { recursive: true })
    if (isVideo) {
      fs.writeFileSync(variantDiskPath(fileKey, "original", "mp4"), mp4Original)
      fs.writeFileSync(variantDiskPath(fileKey, "poster", "jpg"), jpgThumb)
      insertMedia.run(fileKey, accountId, "video", section, status, caption, "mp4",
        mp4Original.length, null, null, jpgThumb.length, 1280, 720, 12.5, 0, 0)
      videos++
    } else {
      fs.writeFileSync(variantDiskPath(fileKey, "original", "jpg"), jpgOriginal)
      fs.writeFileSync(variantDiskPath(fileKey, "display", "jpg"), jpgDisplay)
      fs.writeFileSync(variantDiskPath(fileKey, "thumb", "jpg"), jpgThumb)
      insertMedia.run(fileKey, accountId, "image", section, status, caption, "jpg",
        jpgOriginal.length, jpgDisplay.length, jpgThumb.length, null, 1200, 800, null, 0,
        isOfficial ? i : 0)
      if (isPending) pending++
      else approved++
    }
  }

  console.log("")
  console.log(
    `Gallery: seeded ${count} media (${approved} approved, ${pending} pending, ` +
      `${videos} video, ${OFFICIAL} official) → ${BASE_URL}/gallery`,
  )
}

// Print preview URLs
console.log("")
console.log("=== Wedding Preview Data Seeded ===")
console.log("")
console.log("Preview URLs (start server with: npm start)")
console.log("")
console.log(
  "  Solo guest (no RSVP):     " + BASE_URL + "/rsvp?code=PREVIEWa",
)
console.log(
  "  Group guest (no RSVP):    " + BASE_URL + "/rsvp?code=PREVIEWb",
)
console.log(
  "  Already RSVP'd yes:       " + BASE_URL + "/rsvp?code=PREVIEWc",
)
console.log(
  "  Already RSVP'd no:        " + BASE_URL + "/rsvp?code=PREVIEWd",
)
console.log("")
console.log("Other pages:")
console.log("  Landing page:             " + BASE_URL + "/")
console.log("  Guest lookup:             " + BASE_URL + "/rsvp")
console.log("  Admin dashboard:          " + BASE_URL + "/admin")
console.log("")
console.log("4 preview guests created. Run again to reset.")
console.log("")
