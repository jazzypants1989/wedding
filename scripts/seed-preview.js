#!/usr/bin/env node

/**
 * @file Seed preview data for testing the guest RSVP experience.
 * Creates test guests covering different scenarios and prints preview URLs.
 * Idempotent: removes previous preview data before seeding.
 */

import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { createTables, runMigrations } from "../db/schema.js"

const DB_PATH = path.join(import.meta.dirname, "..", "data", "wedding.db")
const BASE_URL = "http://localhost:3000"

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
  "INSERT INTO rsvps (guest_id, attending, actual_party_size, dietary_restrictions, song_request, message) VALUES (?, ?, ?, ?, ?, ?)",
)

insertRsvp.run(
  guestIds["PREVIEWc"],
  1,
  2,
  "Vegetarian",
  "At Last by Etta James",
  "So excited for your big day!",
)

insertRsvp.run(
  guestIds["PREVIEWd"],
  0,
  null,
  null,
  null,
  "Sorry we can not make it, congratulations!",
)

db.close()

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
