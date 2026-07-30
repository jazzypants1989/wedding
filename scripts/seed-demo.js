#!/usr/bin/env node

/**
 * @file Seed a realistic post-wedding DEMO dataset for hands-on review of the
 * gallery + guestbook features (see docs/post-wedding/). Unlike
 * `seed-preview.js --gallery N` (which writes undecodable magic-byte stubs for a
 * grid perf check), this downloads REAL stock photos/videos so everything
 * renders, and it seeds guestbook entries, comments and reactions across every
 * moderation state so the admin queue + curation flows have something to act on.
 *
 * Zero-dep: only Node built-ins (node:sqlite/https/fs/path/crypto). Variant
 * generation is normally client-side (public/components/media-processing.js), so
 * we fetch pre-sized real images from picsum.photos and write the thumb/display/
 * original files directly — no image library needed.
 *
 * Idempotent: a manifest of everything it created is stored in app_state, so a
 * re-run cleans the prior demo dataset first (rows + on-disk files). Requires
 * network access on first run; downloads are cached under data/.seed-cache/.
 */

import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import fs from "node:fs"
import crypto from "node:crypto"
import https from "node:https"
import { createTables, runMigrations } from "../db/schema.js"
import {
  ensureUploadDirs,
  itemDir,
  variantDiskPath,
  QUARANTINE_DIR,
} from "../core/media-storage.js"
import { normalizeName, generateInviteCode } from "../db/utils.js"

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.join(import.meta.dirname, "..", "data", "wedding.db")
const DATA_DIR = path.dirname(DB_PATH)
const CACHE_DIR = path.join(DATA_DIR, ".seed-cache")
const BASE_URL = process.env.BASE_URL || "http://localhost:3000"

// Household invite code guests type to log in trusted. Must be exactly 8
// alphanumeric chars — validateInviteCode() rejects anything else and the
// auth sheet's input is maxlength="8", so a longer code is untypeable.
const DEMO_CODE = "LOVEBIRD"
const MANIFEST_KEY = "seed_demo_manifest"
const EMAIL_MARKER = "@seed.demo" // marks demo accounts/guests for cleanup

/** @typedef {{ url: string, duration: number, cache: string }} VideoSource */
/** A few real sample clips of varying length so the gallery has more than one
 *  video to play. @type {Record<string, VideoSource>} */
const VIDEO_SOURCES = {
  s5: { url: "https://download.samplelib.com/mp4/sample-5s.mp4", duration: 5, cache: "sample-5s.mp4" },
  s10: { url: "https://download.samplelib.com/mp4/sample-10s.mp4", duration: 10, cache: "sample-10s.mp4" },
  s15: { url: "https://download.samplelib.com/mp4/sample-15s.mp4", duration: 15, cache: "sample-15s.mp4" },
  s20: { url: "https://download.samplelib.com/mp4/sample-20s.mp4", duration: 20, cache: "sample-20s.mp4" },
}

/** @typedef {"L" | "P" | "S"} Orient */
/** @type {Record<Orient, { original: [number, number], display: [number, number], thumb: [number, number] }>} */
const IMAGE_DIMS = {
  L: { original: [2000, 1333], display: [1600, 1067], thumb: [400, 267] },
  P: { original: [1333, 2000], display: [1067, 1600], thumb: [267, 400] },
  S: { original: [2000, 2000], display: [1600, 1600], thumb: [400, 400] },
}

// ---------------------------------------------------------------------------
// Networking: GET with redirect-follow + on-disk cache (picsum 302s to a CDN).
// ---------------------------------------------------------------------------

/**
 * @param {string} url
 * @param {number} [redirectsLeft]
 * @returns {Promise<Buffer>}
 */
function download(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "wedding-seed-demo" } },
      (res) => {
        const status = res.statusCode || 0
        const location = res.headers.location
        if (status >= 300 && status < 400 && location) {
          res.resume()
          if (redirectsLeft <= 0) {
            reject(new Error("Too many redirects: " + url))
            return
          }
          resolve(download(new URL(location, url).toString(), redirectsLeft - 1))
          return
        }
        if (status !== 200) {
          res.resume()
          reject(new Error("HTTP " + status + " for " + url))
          return
        }
        /** @type {Buffer[]} */
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => resolve(Buffer.concat(chunks)))
        res.on("error", reject)
      },
    )
    req.on("error", reject)
    // Guard against a hung connection stalling the whole seed indefinitely.
    req.setTimeout(30_000, () => req.destroy(new Error("Timeout fetching " + url)))
  })
}

/**
 * @param {string} url
 * @param {string} cacheName
 * @returns {Promise<Buffer>}
 */
async function cachedDownload(url, cacheName) {
  const p = path.join(CACHE_DIR, cacheName)
  if (fs.existsSync(p)) return fs.readFileSync(p)
  const buf = await download(url)
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(p, buf)
  return buf
}

// ---------------------------------------------------------------------------
// Materialize real on-disk variants for a media row.
// ---------------------------------------------------------------------------

/**
 * @param {string} fileKey
 * @param {number} picsumId
 * @param {Orient} orient
 * @returns {Promise<{ width: number, height: number, originalBytes: number, displayBytes: number, thumbBytes: number }>}
 */
async function materializeImage(fileKey, picsumId, orient) {
  const dims = IMAGE_DIMS[orient]
  fs.mkdirSync(itemDir(fileKey), { recursive: true })
  const [ow, oh] = dims.original
  const [dw, dh] = dims.display
  const [tw, th] = dims.thumb
  // /seed/<n>/ (not /id/<n>/) — deterministic per seed and never 404s, so we can
  // scale the dataset to any number of distinct images without hitting a retired id.
  const original = await cachedDownload(
    `https://picsum.photos/seed/${picsumId}/${ow}/${oh}.jpg`,
    `seed-${picsumId}-o-${ow}x${oh}.jpg`,
  )
  const display = await cachedDownload(
    `https://picsum.photos/seed/${picsumId}/${dw}/${dh}.jpg`,
    `seed-${picsumId}-d-${dw}x${dh}.jpg`,
  )
  const thumb = await cachedDownload(
    `https://picsum.photos/seed/${picsumId}/${tw}/${th}.jpg`,
    `seed-${picsumId}-t-${tw}x${th}.jpg`,
  )
  fs.writeFileSync(variantDiskPath(fileKey, "original", "jpg"), original)
  fs.writeFileSync(variantDiskPath(fileKey, "display", "jpg"), display)
  fs.writeFileSync(variantDiskPath(fileKey, "thumb", "jpg"), thumb)
  return {
    width: ow,
    height: oh,
    originalBytes: original.length,
    displayBytes: display.length,
    thumbBytes: thumb.length,
  }
}

/**
 * @param {string} fileKey
 * @param {number} posterSeed
 * @param {VideoSource} source
 * @returns {Promise<{ width: number, height: number, durationSeconds: number, originalBytes: number, posterBytes: number }>}
 */
async function materializeVideo(fileKey, posterSeed, source) {
  fs.mkdirSync(itemDir(fileKey), { recursive: true })
  const mp4 = await cachedDownload(source.url, source.cache)
  const poster = await cachedDownload(
    `https://picsum.photos/seed/${posterSeed}/1280/720.jpg`,
    `seed-${posterSeed}-poster-1280x720.jpg`,
  )
  fs.writeFileSync(variantDiskPath(fileKey, "original", "mp4"), mp4)
  fs.writeFileSync(variantDiskPath(fileKey, "poster", "jpg"), poster)
  return {
    width: 1280,
    height: 720,
    durationSeconds: source.duration,
    originalBytes: mp4.length,
    posterBytes: poster.length,
  }
}

// ---------------------------------------------------------------------------
// Cleanup: remove any prior demo dataset (rows + files) before reseeding.
// ---------------------------------------------------------------------------

/** @param {DatabaseSync} db @param {string} fileKey */
function removeItemFiles(db, fileKey) {
  fs.rmSync(itemDir(fileKey), { recursive: true, force: true })
  fs.rmSync(path.join(QUARANTINE_DIR, fileKey), { recursive: true, force: true })
}

/** @param {DatabaseSync} db */
function cleanupPriorDemo(db) {
  /** @type {Set<string>} */
  const fileKeys = new Set()

  const manifestRow = /** @type {{ value: string } | undefined} */ (
    db.prepare("SELECT value FROM app_state WHERE key = ?").get(MANIFEST_KEY)
  )
  if (manifestRow) {
    try {
      const parsed = /** @type {{ fileKeys?: string[] }} */ (JSON.parse(manifestRow.value))
      for (const k of parsed.fileKeys || []) fileKeys.add(k)
    } catch {
      // Corrupt manifest — fall through to the email-marker sweep below.
    }
  }

  // Belt-and-suspenders: media owned by any demo account, even if the manifest
  // was lost (e.g. hand-edited DB). "Demo account" = one we email-marked, OR one
  // bound to the demo household guest — the latter also catches the trusted
  // account the *user* registered during the walkthrough (no @seed.demo email),
  // plus any media they uploaded, so a reseed doesn't leave orphans behind.
  const householdRow = /** @type {{ id: number } | undefined} */ (
    db
      .prepare(
        "SELECT id FROM guests WHERE invite_code = ? OR email LIKE ? LIMIT 1",
      )
      .get(DEMO_CODE, "%" + EMAIL_MARKER)
  )
  const householdId = householdRow ? householdRow.id : null

  const markedMedia = /** @type {{ file_key: string }[]} */ (
    db
      .prepare(
        `SELECT file_key FROM media WHERE account_id IN
           (SELECT id FROM accounts
              WHERE contact_email LIKE ? OR (? IS NOT NULL AND guest_id = ?))`,
      )
      .all("%" + EMAIL_MARKER, householdId, householdId)
  )
  for (const m of markedMedia) fileKeys.add(m.file_key)

  for (const key of fileKeys) {
    removeItemFiles(db, key)
    db.prepare("DELETE FROM media WHERE file_key = ?").run(key)
  }

  // Deleting demo accounts cascades their guestbook entries, comments and
  // reactions (ON DELETE CASCADE); official media has account_id NULL and was
  // already removed above by file_key.
  db.prepare(
    `DELETE FROM accounts WHERE contact_email LIKE ? OR (? IS NOT NULL AND guest_id = ?)`,
  ).run("%" + EMAIL_MARKER, householdId, householdId)
  // Match on the email marker as well as the code so a household seeded under
  // an older DEMO_CODE still gets wiped instead of lingering as a duplicate.
  db.prepare(
    "DELETE FROM guests WHERE invite_code = ? OR email LIKE ?",
  ).run(DEMO_CODE, "%" + EMAIL_MARKER)
  db.prepare("DELETE FROM app_state WHERE key = ?").run(MANIFEST_KEY)
}

// ---------------------------------------------------------------------------
// Timestamp helpers — stagger created_at so feeds look natural (not all "now").
// ---------------------------------------------------------------------------

const NOW = Date.now()
/** @param {number} hoursAgo @returns {string} SQLite datetime (UTC) */
function ago(hoursAgo) {
  return new Date(NOW - hoursAgo * 3600_000).toISOString().replace("T", " ").slice(0, 19)
}

// ---------------------------------------------------------------------------
// Seed.
// ---------------------------------------------------------------------------

const db = new DatabaseSync(DB_PATH)
db.exec("PRAGMA foreign_keys = ON")
db.exec("PRAGMA journal_mode = WAL")
db.exec("PRAGMA synchronous = NORMAL")

createTables(db)
runMigrations(db)
ensureUploadDirs()
cleanupPriorDemo(db)

/** @type {string[]} */
const manifestFileKeys = []

// Persist the fileKey manifest to app_state. Called incrementally (before each
// item's download) so that if a download throws mid-run — a network blip or a
// slow CDN — the next reseed can still find and remove the partial rows
// and on-disk files, including account-less official items the marker sweep
// can't reach.
const upsertManifest = db.prepare(
  `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
)
function persistManifest() {
  upsertManifest.run(MANIFEST_KEY, JSON.stringify({ fileKeys: manifestFileKeys }), ago(0))
}

// --- Demo household guest (its invite code makes trusted logins possible) ---
const household = Number(
  db
    .prepare(
      `INSERT INTO guests (name, email, phone, party_size, invite_code, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "The Demo Household",
      "demo-household" + EMAIL_MARKER,
      null,
      6,
      DEMO_CODE,
      "invited",
      "Demo household for the walkthrough — register at /gallery with this code.",
    ).lastInsertRowid,
)

// --- Accounts -------------------------------------------------------------
const insertAccount = db.prepare(
  `INSERT INTO accounts (guest_id, name, name_normalized, relation, contact_email, trusted, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
/**
 * @param {number | null} guestId @param {string} name @param {string | null} relation
 * @param {0 | 1} trusted @param {string} slug @param {number} hoursAgo
 * @returns {number}
 */
function account(guestId, name, relation, trusted, slug, hoursAgo) {
  return Number(
    insertAccount.run(
      guestId,
      name,
      normalizeName(name),
      relation,
      slug + EMAIL_MARKER,
      trusted,
      ago(hoursAgo),
    ).lastInsertRowid,
  )
}

const accounts = {
  carol: account(household, "Aunt Carol", "Aunt of the bride", 1, "carol", 1200),
  dave: account(household, "Best Man Dave", "Best man", 1, "dave", 1100),
  priya: account(household, "Maid of Honor Priya", "Maid of honor", 1, "priya", 1150),
  pete: account(household, "Uncle Pete", "Uncle of the groom", 1, "pete", 1050),
  grace: account(household, "Grandma Grace", "Grandmother", 1, "grace", 1000),
  riley: account(null, "Cousin Riley", "Cousin", 0, "riley", 400),
  sam: account(null, "Sam (Plus One)", "Friend", 0, "sam", 300),
  jo: account(null, "Neighbor Jo", null, 0, "jo", 200),
  marcus: account(null, "College Friend Marcus", "College friend", 0, "marcus", 350),
  lena: account(null, "Coworker Lena", "Coworker", 0, "lena", 250),
}

// --- Media ----------------------------------------------------------------
const insertMedia = db.prepare(
  `INSERT INTO media (file_key, account_id, kind, section, status, caption, original_ext,
     original_bytes, display_bytes, thumb_bytes, poster_bytes, width, height,
     duration_seconds, needs_display, sort_order, created_at, reviewed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)

/**
 * @typedef {Object} MediaSpec
 * @property {"image" | "video"} kind
 * @property {"official" | "guest"} section
 * @property {"approved" | "pending" | "hidden" | "rejected"} status
 * @property {number | null} accountId
 * @property {string | null} caption
 * @property {number} picsumId
 * @property {Orient} [orient]
 * @property {number} hoursAgo
 * @property {boolean} [quarantine]
 * @property {number} [sortOrder]
 * @property {VideoSource} [video]
 */

const orients = /** @type {Orient[]} */ (["L", "P", "S", "L", "P", "L", "S", "P"])
let orientIx = 0
/** @returns {Orient} */
const nextOrient = () => orients[orientIx++ % orients.length]

/** @type {MediaSpec[]} */
const mediaSpecs = []

// Official section — curated, ordered, admin-owned (account_id NULL, approved).
const officialCaptions = [
  "The first look 💍",
  "Walking down the aisle",
  "Our first kiss as newlyweds",
  "The toast 🥂",
  "Our first dance",
  "Sparkler send-off ✨",
  "The venue at golden hour",
  "Cutting the cake 🍰",
]
const officialIds = [1015, 1016, 1024, 1039, 1043, 1044, 1050, 1060]
officialCaptions.forEach((caption, i) => {
  mediaSpecs.push({
    kind: "image",
    section: "official",
    status: "approved",
    accountId: null,
    caption,
    picsumId: officialIds[i],
    orient: nextOrient(),
    hoursAgo: 900 - i * 5,
    sortOrder: i,
  })
})

// Guest section — approved images (mostly trusted authors, a couple approved
// untrusted so the feed feels real).
/** @type {[number, number | null, string | null][]} id, accountId, caption */
const approvedGuest = [
  [1051, accounts.carol, "Best. Wedding. Ever. 😍"],
  [1052, accounts.dave, "Caught the bouquet!"],
  [1059, accounts.carol, null],
  [1062, accounts.dave, "The cake was unreal 🍰"],
  [1074, accounts.riley, "So happy for you two ❤️"],
  [1080, accounts.carol, "Golden hour on the dance floor"],
  [1084, accounts.dave, null],
  [1005, accounts.carol, "The whole crew together"],
  [1011, accounts.sam, "What a night!"],
  [1012, accounts.dave, "Grandma showed us all up dancing"],
  [1025, accounts.carol, "This good boy came to the wedding 🐶"],
  [1035, accounts.riley, null],
  [111, accounts.dave, "Cheers to the newlyweds"],
  [164, accounts.carol, "Confetti everywhere"],
  // --- added for a fuller feed ---
  [201, accounts.priya, "Getting ready this morning 💄"],
  [214, accounts.priya, "The bridesmaids before the ceremony"],
  [233, accounts.pete, "Ceremony under the oaks 🌳"],
  [247, accounts.pete, null],
  [268, accounts.grace, "So proud of my grandbabies ❤️"],
  [279, accounts.marcus, "Old college crew, reunited"],
  [286, accounts.marcus, "The photobooth was a hit 📸"],
  [295, accounts.lena, "Loved every second of this"],
  [308, accounts.lena, null],
  [317, accounts.riley, "Sunset toasts 🌅"],
  [326, accounts.sam, "Dance floor never emptied"],
  [339, accounts.dave, "Table 4 says hi 👋"],
  [351, accounts.carol, "The flowers were stunning 💐"],
  [368, accounts.priya, "Happy tears all around 😭"],
]
approvedGuest.forEach(([picsumId, accountId, caption], i) => {
  mediaSpecs.push({
    kind: "image",
    section: "guest",
    status: "approved",
    accountId,
    caption,
    picsumId,
    orient: nextOrient(),
    hoursAgo: 700 - i * 12,
  })
})

// Pending images (untrusted authors → moderation queue).
/** @type {[number, number, string | null][]} */
const pendingGuest = [
  [177, accounts.riley, "Adding a few from my phone 📱"],
  [219, accounts.sam, null],
  [225, accounts.jo, "Hope these are okay to share!"],
]
pendingGuest.forEach(([picsumId, accountId, caption], i) => {
  mediaSpecs.push({
    kind: "image",
    section: "guest",
    status: "pending",
    accountId,
    caption,
    picsumId,
    orient: nextOrient(),
    hoursAgo: 30 - i * 4,
  })
})

// Hidden images (previously approved, moderator-hidden).
mediaSpecs.push({
  kind: "image",
  section: "guest",
  status: "hidden",
  accountId: accounts.jo,
  caption: "Blurry one, sorry",
  picsumId: 250,
  orient: nextOrient(),
  hoursAgo: 120,
})
mediaSpecs.push({
  kind: "image",
  section: "guest",
  status: "hidden",
  accountId: accounts.sam,
  caption: null,
  picsumId: 306,
  orient: nextOrient(),
  hoursAgo: 100,
})

// Rejected image (files quarantined, recoverable — matches the real reject flow).
mediaSpecs.push({
  kind: "image",
  section: "guest",
  status: "rejected",
  accountId: accounts.jo,
  caption: "Off-topic snapshot",
  picsumId: 431,
  orient: nextOrient(),
  hoursAgo: 90,
  quarantine: true,
})

// Videos — several approved (trusted + approved-untrusted) plus one pending
// (untrusted) that lands in the moderation queue. Distinct poster seeds and clip
// lengths so the gallery has real variety to play.
mediaSpecs.push({ kind: "video", section: "guest", status: "approved", accountId: accounts.dave, caption: "The first dance 🎥", picsumId: 701, video: VIDEO_SOURCES.s5, hoursAgo: 650 })
mediaSpecs.push({ kind: "video", section: "guest", status: "approved", accountId: accounts.priya, caption: "Walking in — I can't 😭🎥", picsumId: 702, video: VIDEO_SOURCES.s10, hoursAgo: 600 })
mediaSpecs.push({ kind: "video", section: "guest", status: "approved", accountId: accounts.pete, caption: "Grandma's toast brought the house down 🥂", picsumId: 703, video: VIDEO_SOURCES.s15, hoursAgo: 560 })
mediaSpecs.push({ kind: "video", section: "guest", status: "approved", accountId: accounts.marcus, caption: "Dance floor chaos 💃🕺", picsumId: 704, video: VIDEO_SOURCES.s20, hoursAgo: 520 })
mediaSpecs.push({ kind: "video", section: "guest", status: "pending", accountId: accounts.riley, caption: "Speeches — worth a watch!", picsumId: 705, video: VIDEO_SOURCES.s10, hoursAgo: 20 })

/** @typedef {{ id: number, status: string, fileKey: string }} SeededMedia */
/** @type {{ image: SeededMedia[], video: SeededMedia[], official: SeededMedia[] }} */
const seededMedia = { image: [], video: [], official: [] }

let downloaded = 0
for (const spec of mediaSpecs) {
  const fileKey = crypto.randomBytes(16).toString("hex")
  manifestFileKeys.push(fileKey)
  persistManifest() // record before downloading so a mid-run crash stays cleanable
  const reviewedAt = spec.status === "pending" ? null : ago(spec.hoursAgo)

  let mediaId
  if (spec.kind === "video") {
    const v = await materializeVideo(fileKey, spec.picsumId, spec.video ?? VIDEO_SOURCES.s5)
    mediaId = Number(
      insertMedia.run(
        fileKey, spec.accountId, "video", spec.section, spec.status, spec.caption, "mp4",
        v.originalBytes, null, null, v.posterBytes, v.width, v.height,
        v.durationSeconds, 0, spec.sortOrder ?? 0, ago(spec.hoursAgo), reviewedAt,
      ).lastInsertRowid,
    )
    seededMedia.video.push({ id: mediaId, status: spec.status, fileKey })
  } else {
    const img = await materializeImage(fileKey, spec.picsumId, spec.orient ?? "L")
    mediaId = Number(
      insertMedia.run(
        fileKey, spec.accountId, "image", spec.section, spec.status, spec.caption, "jpg",
        img.originalBytes, img.displayBytes, img.thumbBytes, null, img.width, img.height,
        null, 0, spec.sortOrder ?? 0, ago(spec.hoursAgo), reviewedAt,
      ).lastInsertRowid,
    )
    if (spec.section === "official") seededMedia.official.push({ id: mediaId, status: spec.status, fileKey })
    else seededMedia.image.push({ id: mediaId, status: spec.status, fileKey })
  }

  if (spec.quarantine) {
    // Move the on-disk files to quarantine to mirror a real rejection.
    const src = itemDir(fileKey)
    const dest = path.join(QUARANTINE_DIR, fileKey)
    fs.mkdirSync(QUARANTINE_DIR, { recursive: true })
    if (fs.existsSync(src)) fs.renameSync(src, dest)
  }
  downloaded++
  if (downloaded % 5 === 0) process.stdout.write(`  …${downloaded}/${mediaSpecs.length} media\n`)
}

// --- Guestbook ------------------------------------------------------------
const insertEntry = db.prepare(
  `INSERT INTO guestbook_entries (account_id, message, status, created_at, reviewed_at)
   VALUES (?, ?, ?, ?, ?)`,
)
/**
 * @typedef {Object} EntrySpec
 * @property {number} accountId @property {string} message
 * @property {"approved" | "pending" | "hidden"} status @property {number} hoursAgo
 */
/** @type {EntrySpec[]} */
const entrySpecs = [
  { accountId: accounts.carol, message: "What a magical day. We are so proud of you both. Here's to a lifetime of love! ❤️", status: "approved", hoursAgo: 800 },
  { accountId: accounts.dave, message: "From college roommates to your wedding day — what a ride. Love you two.", status: "approved", hoursAgo: 780 },
  { accountId: accounts.riley, message: "The dance floor was ELECTRIC. Best wedding I've ever been to.", status: "approved", hoursAgo: 700 },
  { accountId: accounts.sam, message: "Thank you for including me in your special day. It was beautiful.", status: "approved", hoursAgo: 650 },
  { accountId: accounts.carol, message: "Still crying happy tears. The vows! 😭", status: "approved", hoursAgo: 600 },
  { accountId: accounts.dave, message: "Wishing you a marriage as fun as that reception.", status: "approved", hoursAgo: 540 },
  { accountId: accounts.jo, message: "So glad we could be neighbors AND wedding guests. Congrats!", status: "approved", hoursAgo: 500 },
  { accountId: accounts.riley, message: "The cake. I need the recipe. Also — congratulations!! 🍰", status: "approved", hoursAgo: 420 },
  { accountId: accounts.carol, message: "Every detail was perfect. We love you both so much.", status: "approved", hoursAgo: 360 },
  { accountId: accounts.priya, message: "Standing next to you as you said 'I do' is a moment I'll never forget. Love you both endlessly.", status: "approved", hoursAgo: 760 },
  { accountId: accounts.pete, message: "Welcome to the family — officially! Couldn't be happier for you two.", status: "approved", hoursAgo: 720 },
  { accountId: accounts.grace, message: "Sixty years ago I was the bride. Watching you today brought it all back. Bless you both. 💗", status: "approved", hoursAgo: 680 },
  { accountId: accounts.marcus, message: "From dorm-room ramen to your wedding day. So proud of you, man.", status: "approved", hoursAgo: 620 },
  { accountId: accounts.lena, message: "Easily the best wedding I've ever been to. The karaoke was next-level.", status: "approved", hoursAgo: 560 },
  { accountId: accounts.dave, message: "The speech may have run long, but every word was true. Love you both.", status: "approved", hoursAgo: 520 },
  { accountId: accounts.priya, message: "The way you looked at each other during the vows — I'm still not over it. 😭", status: "approved", hoursAgo: 460 },
  { accountId: accounts.pete, message: "Great food, great music, greater people. What a day.", status: "approved", hoursAgo: 400 },
  { accountId: accounts.grace, message: "Thank you for seating me near the cake. A grandmother knows what she's doing. 🍰", status: "approved", hoursAgo: 340 },
  { accountId: accounts.marcus, message: "Already planning the reunion. Same dance floor, same energy.", status: "approved", hoursAgo: 280 },
  { accountId: accounts.sam, message: "Adding my note before I forget — thank you for the best weekend!", status: "pending", hoursAgo: 18 },
  { accountId: accounts.jo, message: "Cheers to the happy couple from the whole street! 🥂", status: "pending", hoursAgo: 10 },
  { accountId: accounts.riley, message: "(test message please ignore)", status: "hidden", hoursAgo: 300 },
]
/** @type {{ id: number, status: string }[]} */
const seededEntries = []
for (const e of entrySpecs) {
  const reviewedAt = e.status === "pending" ? null : ago(e.hoursAgo)
  const id = Number(
    insertEntry.run(e.accountId, e.message, e.status, ago(e.hoursAgo), reviewedAt).lastInsertRowid,
  )
  seededEntries.push({ id, status: e.status })
}

// --- Comments (polymorphic; targets already exist) ------------------------
const insertComment = db.prepare(
  `INSERT INTO comments (account_id, target_type, target_id, message, status, created_at, reviewed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
/**
 * @param {number} accountId @param {"media" | "guestbook"} targetType @param {number} targetId
 * @param {string} message @param {"approved" | "pending"} status @param {number} hoursAgo
 */
function comment(accountId, targetType, targetId, message, status, hoursAgo) {
  insertComment.run(
    accountId, targetType, targetId, message, status, ago(hoursAgo),
    status === "pending" ? null : ago(hoursAgo),
  )
}

const approvedImages = seededMedia.image.filter((m) => m.status === "approved")
const approvedOfficial = seededMedia.official
const approvedEntries = seededEntries.filter((e) => e.status === "approved")

if (approvedImages[0]) {
  comment(accounts.dave, "media", approvedImages[0].id, "This is my favorite shot of the whole night.", "approved", 690)
  comment(accounts.riley, "media", approvedImages[0].id, "Frame it!! 🖼️", "approved", 680)
}
if (approvedImages[1]) {
  comment(accounts.carol, "media", approvedImages[1].id, "I can't believe you actually caught it 😂", "approved", 660)
}
if (approvedOfficial[2]) {
  comment(accounts.jo, "media", approvedOfficial[2].id, "The photographer nailed this one.", "approved", 500)
}
if (approvedImages[2]) {
  comment(accounts.sam, "media", approvedImages[2].id, "Adding a note — hope this shows up soon!", "pending", 12)
}
if (approvedEntries[0]) {
  comment(accounts.dave, "guestbook", approvedEntries[0].id, "Seconded, every word. ❤️", "approved", 700)
}
if (approvedEntries[2]) {
  comment(accounts.carol, "guestbook", approvedEntries[2].id, "It really was! My feet still hurt 😅", "approved", 620)
}
if (approvedImages[3]) {
  comment(accounts.priya, "media", approvedImages[3].id, "That cake was a work of art 🍰", "approved", 640)
}
if (approvedImages[5]) {
  comment(accounts.pete, "media", approvedImages[5].id, "Golden hour did NOT miss.", "approved", 610)
  comment(accounts.grace, "media", approvedImages[5].id, "My favorite photo of the whole night.", "approved", 600)
}
if (approvedImages[7]) {
  comment(accounts.marcus, "media", approvedImages[7].id, "The whole crew! Look at us. 🙌", "approved", 580)
}
if (approvedOfficial[0]) {
  comment(accounts.carol, "media", approvedOfficial[0].id, "That first look — I lost it. 😭", "approved", 520)
}
if (approvedOfficial[4]) {
  comment(accounts.dave, "media", approvedOfficial[4].id, "Best first dance I've ever seen.", "approved", 500)
}
if (approvedEntries[1]) {
  comment(accounts.priya, "guestbook", approvedEntries[1].id, "College roommates to newlyweds. ❤️", "approved", 700)
}
if (approvedEntries[3]) {
  comment(accounts.lena, "guestbook", approvedEntries[3].id, "Agreed — completely unforgettable.", "approved", 540)
}

// --- Reactions (unique per account/target/emoji) --------------------------
const insertReaction = db.prepare(
  `INSERT OR IGNORE INTO reactions (account_id, target_type, target_id, emoji, created_at)
   VALUES (?, ?, ?, ?, ?)`,
)
const EMOJI = /** @type {const} */ (["heart", "clap", "laugh", "heart_eyes", "cheers", "fire"])
const reactorIds = [
  accounts.carol, accounts.dave, accounts.priya, accounts.pete, accounts.grace,
  accounts.riley, accounts.sam, accounts.jo, accounts.marcus, accounts.lena,
]

/** @param {"media" | "guestbook"} targetType @param {number} targetId @param {number} popularity @param {number} hoursAgo */
function reactTo(targetType, targetId, popularity, hoursAgo) {
  for (let i = 0; i < popularity; i++) {
    const accountId = reactorIds[i % reactorIds.length]
    const emoji = EMOJI[i % EMOJI.length]
    insertReaction.run(accountId, targetType, targetId, emoji, ago(hoursAgo))
  }
}

// Spread reactions across official + approved guest media and guestbook entries,
// with a few "popular" items carrying several emoji.
approvedOfficial.forEach((m, i) => reactTo("media", m.id, 5 - (i % 3), 480 - i * 3))
approvedImages.forEach((m, i) => reactTo("media", m.id, (i % 4) + 1, 600 - i * 7))
approvedEntries.forEach((e, i) => reactTo("guestbook", e.id, (i % 3) + 1, 560 - i * 9))

// --- Gifts & digital thank-you cards ---------------------------------------
// The household guest is the only real `guests` row this script creates, so
// it's both the giver of every gift and the recipient of every card — the
// FK cascade on guests(id) means cleanupPriorDemo()'s
// `DELETE FROM guests WHERE invite_code = DEMO_CODE` already wipes these
// tables on the next reseed with no extra cleanup code needed here.
const insertGift = db.prepare(
  `INSERT INTO gifts (guest_id, description, amount, notes, received_at,
     physical_card_sent, physical_card_sent_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
)

/**
 * @typedef {Object} GiftSpec
 * @property {string} key @property {string} description @property {string | null} amount
 * @property {string | null} notes @property {number} hoursAgo @property {boolean} physicalCardSent
 */
/** @type {GiftSpec[]} */
const giftSpecs = [
  { key: "honeyfund", description: "Honeymoon fund contribution", amount: "$150", notes: null, hoursAgo: 300, physicalCardSent: false },
  { key: "cash", description: "Cash gift toward the new house", amount: "$200", notes: null, hoursAgo: 260, physicalCardSent: false },
  { key: "mixer", description: "KitchenAid stand mixer", amount: null, notes: "From the registry — already put it to use!", hoursAgo: 240, physicalCardSent: false },
  { key: "blanket", description: "Hand-knit throw blanket", amount: null, notes: "Made by hand — so sweet", hoursAgo: 200, physicalCardSent: false },
  { key: "towels", description: "Set of monogrammed towels", amount: null, notes: null, hoursAgo: 320, physicalCardSent: true },
]

/** @type {Record<string, number>} gift key -> gift id */
const gifts = {}
for (const g of giftSpecs) {
  // received_at is free-form short text in the admin form (e.g. "2026-06-14"),
  // not a full datetime — trim ago()'s SQLite datetime down to just the date.
  const receivedAt = ago(g.hoursAgo).slice(0, 10)
  gifts[g.key] = Number(
    insertGift.run(
      household, g.description, g.amount, g.notes, receivedAt,
      g.physicalCardSent ? 1 : 0, g.physicalCardSent ? ago(g.hoursAgo - 12) : null, ago(g.hoursAgo),
    ).lastInsertRowid,
  )
}

const insertCard = db.prepare(
  `INSERT INTO thank_you_cards
     (token, guest_id, gift_id, message, theme, effects_config, media_keys, status,
      sent_via, sent_at, viewed_at, view_count, last_viewed_at,
      reply_emoji, reply_message, replied_at, reply_seen_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
// Append-only reply history (Track D3): the card's reply_* columns mirror the
// newest reply, while this table carries the full thread the admin detail shows.
const insertReply = db.prepare(
  `INSERT INTO thank_you_card_replies (card_id, emoji, message, created_at)
   VALUES (?, ?, ?, ?)`,
)
/** @returns {string} an 8-char token guaranteed unique among cards inserted so far */
function uniqueCardToken() {
  for (let i = 0; i < 10; i++) {
    const candidate = generateInviteCode()
    if (!db.prepare("SELECT 1 FROM thank_you_cards WHERE token = ?").get(candidate)) {
      return candidate
    }
  }
  throw new Error("Could not generate a unique demo card token")
}

// A couple of approved guest photos for the card's polaroid strip — guarded
// (slice() never throws) in case media seeding above ever comes up short.
const cardPhotoKeys = approvedImages.map((m) => m.fileKey)

/**
 * @typedef {Object} CardSpec
 * @property {string} key @property {number} giftId @property {string} message @property {string} theme
 * @property {{ reveal: string, effects: { id: string, config: Record<string, unknown> }[] }} effectsConfig
 * @property {string[]} mediaKeys
 * @property {"draft" | "sent" | "viewed"} status
 * @property {import('../types.js').ThankYouSentVia | null} sentVia
 * @property {number} [sentHoursAgo] @property {number} [viewedHoursAgo]
 * @property {number} [viewCount] @property {number} [lastViewedHoursAgo]
 * @property {{ emoji: string, message: string, repliedHoursAgo: number }[]} replies
 */
/** @type {CardSpec[]} */
const cardSpecs = [
  {
    key: "draft",
    giftId: gifts.blanket,
    message: "That blanket has already become the thing we fight over on the couch. Thank you for making something with your own hands for us — it means more than you know.",
    theme: "elegant",
    effectsConfig: {
      reveal: "confetti",
      effects: [
        { id: "frameglint", config: { intensity: 0.6, sweepIntervalMs: 5000 } },
        { id: "confettidrift", config: { pieceCount: 12 } },
      ],
    },
    mediaKeys: [],
    status: "draft",
    sentVia: null,
    replies: [],
  },
  {
    key: "sentUnviewed",
    giftId: gifts.honeyfund,
    message: "Because of you, our honeymoon is going to be even more ridiculous than planned. Thank you for helping us start this next chapter — we can't wait to tell you all about it.",
    theme: "celebration",
    effectsConfig: {
      reveal: "champagne",
      effects: [
        { id: "fizz", config: { streamCount: 5 } },
        { id: "lanterns", config: { lanternCount: 10 } },
      ],
    },
    mediaKeys: cardPhotoKeys.slice(0, 1),
    status: "sent",
    sentVia: "email",
    sentHoursAgo: 48,
    replies: [],
  },
  {
    key: "viewed",
    giftId: gifts.cash,
    message: "We keep staring at the down payment fund and pinching ourselves. Thank you for being so generous with us — it's going toward something we'll get to live in and love for years.",
    theme: "gratitude",
    // reveal:"none" — the "quiet" reveal: ambient effects still drift, but no
    // one-shot burst on open. Opened three times → admin shows "opened 3×".
    effectsConfig: {
      reveal: "none",
      effects: [
        { id: "ribbons", config: { ribbonCount: 8 } },
        { id: "inksparkle", config: { glyphCount: 10 } },
      ],
    },
    mediaKeys: [],
    status: "viewed",
    sentVia: "sms",
    sentHoursAgo: 120,
    viewedHoursAgo: 90,
    viewCount: 3,
    lastViewedHoursAgo: 84,
    replies: [],
  },
  {
    key: "viewedReplied",
    giftId: gifts.towels,
    message: "Our bathroom looks so fancy now, thank you! Every time we dry off we think of you two.",
    theme: "garden",
    effectsConfig: {
      reveal: "confetti",
      effects: [
        { id: "lanterns", config: { swayRange: [10, 40] } },
        { id: "frameglint", config: { sweepIntervalMs: 4500, angle: 30 } },
      ],
    },
    mediaKeys: cardPhotoKeys.slice(1, 3),
    status: "viewed",
    sentVia: "manual",
    sentHoursAgo: 200,
    viewedHoursAgo: 170,
    viewCount: 2,
    lastViewedHoursAgo: 40,
    // A multi-entry reply thread (oldest → newest); the card's latest columns
    // mirror the last entry, and it stays unread for the admin badge.
    replies: [
      { emoji: "heart", message: "These are so soft! Thank you both. 💕", repliedHoursAgo: 165 },
      { emoji: "heart_eyes", message: "We cried a little opening this. Thank you both for EVERYTHING — see you at Thanksgiving! 🥹💕", repliedHoursAgo: 40 },
    ],
  },
]

/** @type {Record<string, { token: string, status: string }>} card key -> summary info */
const seededCards = {}
for (const c of cardSpecs) {
  const token = uniqueCardToken()
  const sentAt = c.sentHoursAgo !== undefined ? ago(c.sentHoursAgo) : null
  const viewedAt = c.viewedHoursAgo !== undefined ? ago(c.viewedHoursAgo) : null
  // Latest reply drives the card's mirrored reply_* columns; the whole thread
  // goes into thank_you_card_replies below.
  const latestReply = c.replies.length > 0 ? c.replies[c.replies.length - 1] : null
  const repliedAt = latestReply ? ago(latestReply.repliedHoursAgo) : null
  const viewCount = c.viewCount ?? 0
  const lastViewedAt = c.lastViewedHoursAgo !== undefined ? ago(c.lastViewedHoursAgo) : viewedAt
  const cardId = Number(
    insertCard.run(
      token,
      household,
      c.giftId,
      c.message,
      c.theme,
      JSON.stringify(c.effectsConfig),
      c.mediaKeys.length > 0 ? JSON.stringify(c.mediaKeys) : null,
      c.status,
      c.sentVia,
      sentAt,
      viewedAt,
      viewCount,
      lastViewedAt,
      latestReply ? latestReply.emoji : null,
      latestReply ? latestReply.message : null,
      repliedAt,
      null, // reply_seen_at — every seeded reply starts unread for the admin badge
      ago((c.sentHoursAgo ?? 24) + 24),
    ).lastInsertRowid,
  )
  // Append the full reply thread oldest → newest (cascades away with the card).
  for (const r of c.replies) {
    insertReply.run(cardId, r.emoji, r.message, ago(r.repliedHoursAgo))
  }
  seededCards[c.key] = { token, status: c.status }
}

// --- Manifest for idempotent cleanup on the next run ----------------------
persistManifest()

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
const counts = {
  media: mediaSpecs.length,
  official: seededMedia.official.length,
  approvedGuest: approvedImages.length,
  pending: mediaSpecs.filter((s) => s.status === "pending").length,
  hidden: mediaSpecs.filter((s) => s.status === "hidden").length,
  rejected: mediaSpecs.filter((s) => s.status === "rejected").length,
  videos: seededMedia.video.length,
  guestbook: entrySpecs.length,
  gifts: giftSpecs.length,
  giftsWithAmount: giftSpecs.filter((g) => g.amount).length,
  giftsWithPhysicalCard: giftSpecs.filter((g) => g.physicalCardSent).length,
  unreadReplies: cardSpecs.filter((c) => c.replies.length > 0).length,
  draftCards: cardSpecs.filter((c) => c.status === "draft").length,
}

console.log("")
console.log("=== Wedding DEMO data seeded ===")
console.log("")
console.log(
  `Media: ${counts.media} (${counts.official} official, ${counts.approvedGuest} approved guest, ` +
    `${counts.pending} pending, ${counts.hidden} hidden, ${counts.rejected} rejected, ${counts.videos} video)`,
)
console.log(`Guestbook: ${counts.guestbook} entries (+ comments & reactions)`)
console.log(
  `Gifts: ${counts.gifts} logged for The Demo Household (${counts.giftsWithAmount} with a private $ amount, ` +
    `${counts.giftsWithPhysicalCard} already physical-card-sent)`,
)
console.log(`Thank-you cards: ${cardSpecs.length}, one per state:`)
console.log(`  draft (admin-only, not yet sent)`)
console.log(`  sent, unviewed   → ${BASE_URL}/thanks?card=${seededCards.sentUnviewed.token}`)
console.log(`  viewed (3× opens, quiet "none" reveal) → ${BASE_URL}/thanks?card=${seededCards.viewed.token}`)
console.log(`  viewed + replied (2-message thread) → ${BASE_URL}/thanks?card=${seededCards.viewedReplied.token}   (reply unseen)`)
console.log(
  `  Admin → Thank yous badge should read ${counts.draftCards + counts.unreadReplies} ` +
    `(${counts.draftCards} draft + ${counts.unreadReplies} unread ${counts.unreadReplies === 1 ? "reply" : "replies"}) before you touch anything.`,
)
console.log(
  `  The "sent, unviewed" card is addressed to The Demo Household — sign in as any trusted guest ` +
    `(code ${DEMO_CODE}, any name) on /gallery first and the 💌 banner on /, /gallery and /guestbook`,
)
console.log(`  should point at that same link.`)
console.log("")
console.log("Log in as a GUEST:")
console.log(`  Trusted (auto-approves) → open ${BASE_URL}/gallery, "Add photos", enter code:  ${DEMO_CODE}`)
console.log(`      then any name, e.g. "Your Name" (household members each pick their own name)`)
console.log(`  Untrusted (held for review) → use "I don't have a code" and just enter a name`)
console.log("")
console.log("Key URLs:")
console.log(`  Landing:   ${BASE_URL}/`)
console.log(`  Gallery:   ${BASE_URL}/gallery`)
console.log(`  Guestbook: ${BASE_URL}/guestbook`)
console.log(`  Admin:     ${BASE_URL}/admin   (log in with your admin password)`)
console.log("")

db.close()
