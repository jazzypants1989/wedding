#!/usr/bin/env node
/** @file CLI: seed one fictional site state into a scratch database under tmp/states/.
 *
 *  Run by `preview-states.js`, one child process per state, because the database
 *  and uploads paths are read from DATABASE_PATH at import time.
 *
 *  **Everything here is fictional and safe to screenshot:** invented people, and
 *  images that are drawings with cartoon faces at the face boxes. No photograph, no
 *  real descriptor and no real name is read or written. The media files are PNG
 *  bytes under the variant names the server looks for; browsers decode by content.
 *  Videos only play when `tmp/.seed-cache` holds a sample clip, and are otherwise
 *  undecodable stubs with a drawn poster.
 *
 *  It refuses any database outside `tmp/states/`, so it can never touch real data.
 *  Rows go through the real ledger functions where one exists, so Faces state is
 *  what an actual naming session would leave behind.
 */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { hashPassword } from "../../core/password-policy.js"
import { ensureUploadDirs, itemDir } from "../../core/media-storage.js"
import { getDb, init } from "../../db/connection.js"
import { createBatch, recordAssignment, revokeBatch } from "../../db/face-assignments.js"
import { createGift, setPhysicalCardSent } from "../../db/gifts.js"
import { createIdentity } from "../../db/media-faces.js"
import { createPerson } from "../../db/people.js"
import {
  createThankYouCard,
  markCardSent,
  recordCardOpen,
  setCardReply,
} from "../../db/thank-you-cards.js"
import { normalizeName, setAppState } from "../../db/utils.js"
import { makeMp4 } from "../../tests/media-fixtures.js"
import { LIMITS } from "../../types.js"
import { drawPlaceholder } from "./placeholder-proxy.js"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..")
const STATES_DIR = path.join(REPO_ROOT, "tmp", "states")
const SAMPLE_VIDEO = path.join(REPO_ROOT, "tmp", ".seed-cache", "sample-5s.mp4")

/** The admin password in every state. These databases hold nothing real. */
export const PREVIEW_PASSWORD = "scratch-pass-1234"
export const PREVIEW_INVITE_CODE = "PREVIEW1"

const ACTOR = "preview"
const DESCRIPTOR_DIM = 128
const POOL_SIZE = 6
const THUMB_WIDTH = 400

/** @type {Record<Types.PreviewOrientation, { width: number, height: number }>} */
const SIZES = {
  landscape: { width: 1600, height: 1067 },
  portrait: { width: 1067, height: 1600 },
  square: { width: 1200, height: 1200 },
}
/** @type {Types.PreviewOrientation[]} */
const ORIENTATIONS = ["landscape", "landscape", "portrait", "square"]

/** @type {Types.PREVIEW_STATES} */
export const PREVIEW_STATES = {
  fresh: {
    title: "Fresh",
    description: "Set up, but nothing has happened: no photos, notes or guests.",
  },
  sparse: {
    title: "Sparse",
    description: "The first few guests have shown up: a handful of photos and notes.",
  },
  typical: {
    title: "Typical",
    description: "A normal gallery and guestbook. No faces, no cards, no Honeymoon photos.",
  },
  lots: {
    title: "Lots of everything",
    description: "Thousands of photos, hundreds of notes, a long guest list.",
  },
  backlog: {
    title: "Moderation backlog",
    description: "A long pending queue, hidden and rejected items, a photo used in a card.",
  },
  honeymoon: {
    title: "Honeymoon",
    description: "Typical, with the Honeymoon section filled.",
  },
  "faces-half": {
    title: "Faces: half named",
    description: "Mid-way through naming: groups, questions, same-moment pairs, leftovers.",
  },
  "faces-named": {
    title: "Faces: groups done",
    description: "Every group is resolved. Lone faces and leftovers remain; some people are linked.",
  },
  cards: {
    title: "Thank-you cards",
    description: "Gifts logged, and cards in every state: draft, sent, opened, replied.",
  },
  culled: {
    title: "Culled import",
    description: "Official holds every photo, and most are hidden. Some hidden photos have faces.",
  },
  "long-text": {
    title: "Long text",
    description: "Names, captions and notes at their limits, plus emoji and right-to-left text.",
  },
}

const CAST = [
  "Rosa Méndez",
  "Theo Lindqvist",
  "Priya Raman",
  "Marcus Bell",
  "Hannah Weiss",
  "Grandpa Walt",
  "Auntie Lou",
  "Kofi Mensah",
  "Dana Kim",
  "Ines Moreau",
  "June Okafor",
  "Sam Whitaker",
]
const INVITATIONS = [
  "Rosa & Daniel Méndez",
  "Theo Lindqvist",
  "Priya Raman & Family",
  "Marcus Bell",
  "Hannah Weiss",
  "Walter Holloway",
  "Louise Holloway",
  "Kofi & Ama Mensah",
  "Dana Kim",
  "Ines Moreau",
  "June Okafor",
  "Sam Whitaker",
]
const CAPTIONS = [
  "The moment the rings came out",
  "First dance, from the balcony",
  "Table nine knows how to party",
  "Sparklers!!",
  "Golden hour",
  null,
  "Groomsmen, unsupervised",
  "That cake was unreal",
  null,
  "Grandpa on the dance floor",
]
const NOTES = [
  "Thank you for having us. The whole day felt like a hug.",
  "Still thinking about that dance floor!",
  "Sixty-one years married and I still cried at the vows.",
  "Best party I have been to in years. Welcome to the family.",
  "The toast had the whole table in tears, in a good way.",
  "So happy for you both. Save me a slice of that cake.",
  "We drove nine hours and would do it again tomorrow.",
  "I have never seen either of you smile that much.",
]
const COMMENTS = [
  "Is that ME in the background??",
  "Gorgeous.",
  "This is the one to frame.",
  "I need a copy of this!",
  "Who let him near the microphone?",
  "Crying again.",
]
const EMOJI = ["heart", "clap", "laugh", "heart_eyes", "cheers", "fire"]

/** @type {Types.previewFaceBox} */
export function previewFaceBox(orientation, slot) {
  const { width, height } = SIZES[orientation]
  const w = Math.round(width * 0.17)
  const h = Math.round(w * 1.15)
  const x = Math.round(width * (0.08 + slot * 0.32))
  const y = Math.round(height * 0.3)
  // Eyes, nose, mouth corners, in the order align and the drawing both expect.
  const landmarks = [
    [0.31, 0.4],
    [0.69, 0.4],
    [0.5, 0.56],
    [0.36, 0.72],
    [0.64, 0.72],
  ].flatMap(([fx, fy]) => [Math.round(x + w * fx), Math.round(y + h * fy)])
  return { x, y, w, h, landmarks }
}

/** @type {Types.PREVIEW_SIGNALS} */
export const PREVIEW_SIGNALS = {
  accept: {
    score: 0.95,
    boxPx: 230,
    borderPx: 100,
    eyeRatio: 0.42,
    eyeAngle: 0.02,
    alignScale: 1.2,
    residual: 2,
    outsideFraction: 0,
    sharpness: 0.2,
  },
  ask: {
    score: 0.9,
    boxPx: 120,
    borderPx: 60,
    eyeRatio: 0.15,
    eyeAngle: 0.05,
    alignScale: 1.2,
    residual: 3,
    outsideFraction: 0,
    sharpness: 0.1,
  },
  set_aside: {
    score: 0.7,
    boxPx: 30,
    borderPx: 10,
    eyeRatio: 0.4,
    eyeAngle: 0.1,
    alignScale: 1.3,
    residual: 5,
    outsideFraction: 0,
    sharpness: 0.01,
  },
}

/** @type {Types.isPreviewDatabasePath} */
export function isPreviewDatabasePath(databasePath) {
  const relative = path.relative(STATES_DIR, path.resolve(databasePath))
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
}

/** @param {number} minutesAgo */
function timestamp(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60000).toISOString().slice(0, 19).replace("T", " ")
}

/** A fixed generator, so a state rebuilds the same every time. */
function createRandom() {
  let state = 11
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

/** @param {number[]} vector */
function unit(vector) {
  const norm = Math.hypot(...vector)
  return vector.map((value) => value / norm)
}

/** @param {number[]} vector */
function descriptorBlob(vector) {
  const blob = Buffer.alloc(vector.length * 4)
  vector.forEach((value, i) => blob.writeFloatLE(value, i * 4))
  return blob
}

/**
 * Draw the shared images once. Every media row hardlinks to these, so a state with
 * thousands of photos costs a few megabytes and no extra drawing.
 * @returns {Record<string, { display: string, thumb: string }>}
 */
function ensurePool() {
  const dir = path.join(STATES_DIR, ".pool")
  fs.mkdirSync(dir, { recursive: true })
  /** @type {Record<string, { display: string, thumb: string }>} */
  const pool = {}
  for (const orientation of /** @type {Types.PreviewOrientation[]} */ (Object.keys(SIZES))) {
    const { width, height } = SIZES[orientation]
    const faces = [0, 1, 2].map((slot) => previewFaceBox(orientation, slot))
    for (let n = 0; n < POOL_SIZE; n++) {
      const name = `${orientation}-${n}`
      const display = path.join(dir, `${name}-display.png`)
      const thumb = path.join(dir, `${name}-thumb.png`)
      const entry = { ow: width, oh: height, faces }
      if (!fs.existsSync(display)) {
        fs.writeFileSync(display, drawPlaceholder(name, width, height, entry))
      }
      if (!fs.existsSync(thumb)) {
        const thumbHeight = Math.round((height * THUMB_WIDTH) / width)
        fs.writeFileSync(thumb, drawPlaceholder(name, THUMB_WIDTH, thumbHeight, entry))
      }
      pool[name] = { display, thumb }
    }
  }
  return pool
}

/**
 * @typedef {object} PreviewMedia
 * @property {number} id
 * @property {string} key
 * @property {Types.PreviewOrientation} orientation
 */

/** The seeding helpers one state's builder works with. */
function createSeeder() {
  const db = getDb()
  const random = createRandom()
  const pool = ensurePool()
  const stubVideo = makeMp4(256)
  const realVideo = fs.existsSync(SAMPLE_VIDEO)
  let mediaCount = 0

  /** @template T @param {readonly T[]} items @param {number} i @returns {T} */
  const cycle = (items, i) => items[i % items.length]

  const insertGuest = db.prepare(
    `INSERT INTO guests (name, email, party_size, invite_code, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const insertRsvp = db.prepare(
    `INSERT INTO rsvps (guest_id, attending, actual_party_size, message) VALUES (?, ?, ?, ?)`,
  )
  const insertAccount = db.prepare(
    `INSERT INTO accounts (guest_id, name, name_normalized, relation, trusted, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const insertMedia = db.prepare(
    `INSERT INTO media (file_key, account_id, kind, section, status, caption, original_ext,
       original_bytes, display_bytes, thumb_bytes, poster_bytes, width, height,
       duration_seconds, sort_order, created_at, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertNote = db.prepare(
    `INSERT INTO guestbook_entries (account_id, message, status, pinned_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const insertComment = db.prepare(
    `INSERT INTO comments (account_id, target_type, target_id, message, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const insertReaction = db.prepare(
    `INSERT OR IGNORE INTO reactions (account_id, target_type, target_id, emoji)
     VALUES (?, ?, ?, ?)`,
  )
  const insertFace = db.prepare(
    `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, landmarks, signal_score,
       signal_boxPx, signal_borderPx, signal_eyeRatio, signal_eyeAngle, signal_alignScale,
       signal_residual, signal_outsideFraction, signal_sharpness, descriptor, model_version,
       source, route_state, route_reason, route_profile)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preview-synthetic', 'cli', ?, ?,
       'route-r3')`,
  )

  return {
    db,
    random,
    cycle,

    /** @param {string} name @param {number} i @param {string} [status] */
    guest(name, i, status = "invited") {
      const code = i === 0 ? PREVIEW_INVITE_CODE : `PREV${String(i).padStart(4, "0")}`
      return Number(
        insertGuest.run(name, `guest${i}@example.test`, 1 + (i % 4), code, status, timestamp(50000))
          .lastInsertRowid,
      )
    },

    /** @param {number} count @param {readonly string[]} [names] */
    guests(count, names = INVITATIONS) {
      const ids = []
      for (let i = 0; i < count; i++) {
        const base = names[i % names.length]
        const name = i < names.length ? base : `${base} ${Math.floor(i / names.length) + 1}`
        const responded = i % 3 !== 2
        const id = this.guest(name, i, responded ? "responded" : "invited")
        if (responded) {
          const attending = i % 5 === 4 ? 0 : 1
          insertRsvp.run(id, attending, attending ? 1 + (i % 4) : 0, cycle(NOTES, i))
        }
        ids.push(id)
      }
      return ids
    },

    /** Account i signs in with invitation `households[i]` when there is one,
     *  except every fourth, who signed up without an invitation. With no
     *  households, everyone did (the open-sign-up shape).
     *  @param {number} count @param {readonly string[]} [names]
     *  @param {readonly number[]} [households] */
    accounts(count, names = CAST, households = []) {
      const ids = []
      for (let i = 0; i < count; i++) {
        const base = names[i % names.length]
        const name = i < names.length ? base : `${base} ${Math.floor(i / names.length) + 1}`
        const trusted = i % 3 === 0 ? 0 : 1
        const household = i < households.length && i % 4 !== 3 ? households[i] : null
        ids.push(
          Number(
            insertAccount.run(
              household,
              name,
              normalizeName(name),
              cycle(["Friend of the bride", "Cousin of the groom", "College roommate"], i),
              trusted,
              timestamp(40000 - i),
            ).lastInsertRowid,
          ),
        )
      }
      return ids
    },

    /**
     * @param {{ section?: string, status?: string, kind?: string, caption?: string | null,
     *   accountId?: number | null, minutesAgo?: number, sortOrder?: number }} [options]
     * @returns {PreviewMedia}
     */
    media(options = {}) {
      const n = mediaCount++
      const kind = options.kind ?? "image"
      const orientation = cycle(ORIENTATIONS, n)
      const { width, height } = SIZES[orientation]
      const source = pool[`${orientation}-${n % POOL_SIZE}`]
      const key = crypto.createHash("md5").update(`preview-${n}`).digest("hex")
      const dir = itemDir(key)
      fs.mkdirSync(dir, { recursive: true })
      const status = options.status ?? "approved"
      const when = timestamp(options.minutesAgo ?? 30000 - n)
      const bytes = fs.statSync(source.display).size
      const thumbBytes = fs.statSync(source.thumb).size
      if (kind === "video") {
        const target = path.join(dir, "original.mp4")
        if (realVideo) fs.linkSync(SAMPLE_VIDEO, target)
        else fs.writeFileSync(target, stubVideo)
        fs.linkSync(source.display, path.join(dir, "poster.jpg"))
        insertMedia.run(
          key,
          options.accountId ?? null,
          "video",
          options.section ?? "guest",
          status,
          options.caption ?? null,
          "mp4",
          fs.statSync(target).size,
          null,
          null,
          bytes,
          1280,
          720,
          5,
          options.sortOrder ?? 0,
          when,
          when,
        )
      } else {
        fs.linkSync(source.display, path.join(dir, "original.jpg"))
        fs.linkSync(source.display, path.join(dir, "display.jpg"))
        fs.linkSync(source.thumb, path.join(dir, "thumb.jpg"))
        insertMedia.run(
          key,
          options.accountId ?? null,
          "image",
          options.section ?? "official",
          status,
          options.caption ?? null,
          "jpg",
          bytes,
          bytes,
          thumbBytes,
          null,
          width,
          height,
          null,
          options.sortOrder ?? n,
          when,
          when,
        )
      }
      const row = /** @type {{ id: number }} */ (
        /** @type {unknown} */ (db.prepare("SELECT id FROM media WHERE file_key = ?").get(key))
      )
      return { id: row.id, key, orientation }
    },

    /**
     * @param {number} officialCount
     * @param {number} guestCount
     * @param {readonly number[]} accounts
     * @returns {PreviewMedia[]}
     */
    gallery(officialCount, guestCount, accounts) {
      const rows = []
      for (let i = 0; i < officialCount; i++) {
        rows.push(this.media({ section: "official", sortOrder: i, caption: i % 9 ? null : cycle(CAPTIONS, i) }))
      }
      for (let i = 0; i < guestCount; i++) {
        rows.push(
          this.media({
            section: "guest",
            accountId: cycle(accounts, i),
            kind: i % 12 === 5 ? "video" : "image",
            caption: cycle(CAPTIONS, i),
            minutesAgo: 20 + i * 37,
          }),
        )
      }
      return rows
    },

    /**
     * @param {number} accountId
     * @param {string} message
     * @param {string} [status]
     * @param {number} [minutesAgo]
     * @param {boolean} [pinned]
     */
    note(accountId, message, status = "approved", minutesAgo = 600, pinned = false) {
      return Number(
        insertNote.run(
          accountId,
          message,
          status,
          pinned ? timestamp(minutesAgo) : null,
          timestamp(minutesAgo),
        ).lastInsertRowid,
      )
    },

    /** @param {number} count @param {readonly number[]} accounts */
    notes(count, accounts) {
      const ids = []
      for (let i = 0; i < count; i++) {
        ids.push(this.note(cycle(accounts, i), cycle(NOTES, i), "approved", 30 + i * 53, i < 3))
      }
      return ids
    },

    /**
     * @param {number} accountId
     * @param {string} targetType
     * @param {number} targetId
     * @param {string} message
     * @param {string} [status]
     * @param {number} [minutesAgo]
     */
    comment(accountId, targetType, targetId, message, status = "approved", minutesAgo = 300) {
      insertComment.run(accountId, targetType, targetId, message, status, timestamp(minutesAgo))
    },

    /**
     * Comments and reactions spread over a set of photos and notes.
     * @param {number} commentCount
     * @param {number} reactionCount
     * @param {readonly number[]} accounts
     * @param {readonly PreviewMedia[]} media
     * @param {readonly number[]} notes
     */
    engagement(commentCount, reactionCount, accounts, media, notes) {
      if (media.length === 0) return
      for (let i = 0; i < commentCount; i++) {
        const onNote = i % 4 === 3 && notes.length > 0
        this.comment(
          cycle(accounts, i),
          onNote ? "guestbook" : "media",
          onNote ? cycle(notes, i) : cycle(media, i * 3).id,
          cycle(COMMENTS, i),
          "approved",
          40 + i * 29,
        )
      }
      for (let i = 0; i < reactionCount; i++) {
        insertReaction.run(
          cycle(accounts, i),
          "media",
          media[Math.floor(random() * Math.min(media.length, 40))].id,
          cycle(EMOJI, i),
        )
      }
    },

    /**
     * @param {PreviewMedia} media
     * @param {number} slot
     * @param {number[]} vector
     * @param {"accept" | "ask" | "set_aside"} [state]
     * @returns {number}
     */
    face(media, slot, vector, state = "accept") {
      const box = previewFaceBox(media.orientation, slot)
      const s = PREVIEW_SIGNALS[state]
      return Number(
        insertFace.run(
          media.id,
          box.x,
          box.y,
          box.w,
          box.h,
          JSON.stringify(box.landmarks),
          s.score,
          s.boxPx,
          s.borderPx,
          s.eyeRatio,
          s.eyeAngle,
          s.alignScale,
          s.residual,
          s.outsideFraction,
          s.sharpness,
          descriptorBlob(vector),
          state,
          state === "accept" ? null : state === "ask" ? "eyeRatioLow" : "sharpness",
        ).lastInsertRowid,
      )
    },

    randomVector() {
      return unit(Array.from({ length: DESCRIPTOR_DIM }, () => random() - 0.5))
    },

    /** @param {number[]} centre @param {number} [spread] */
    near(centre, spread = 0.03) {
      return unit(centre.map((value) => value + (random() - 0.5) * spread))
    },
  }
}

/** @typedef {ReturnType<typeof createSeeder>} Seeder */

/** @param {Seeder} seed */
function typicalBase(seed) {
  const guests = seed.guests(36)
  // Most sign in with their invitation's code; a few signed up without one.
  const accounts = seed.accounts(12, CAST, guests)
  // A second person from the first household, so a row can carry two.
  seed.accounts(1, ["Daniel Méndez"], guests)
  const media = seed.gallery(120, 36, accounts)
  const notes = seed.notes(40, accounts)
  seed.engagement(24, 90, accounts, media, notes)
  return { accounts, media, notes }
}

/** @param {Seeder} seed @param {boolean} everyoneNamed */
function seedFaces(seed, everyoneNamed) {
  const guests = seed.guests(12)
  const accounts = seed.accounts(6)
  seed.notes(6, accounts)
  /** @param {string} note */
  const batch = (note) => {
    const batchId = crypto.randomUUID()
    createBatch({ batchId, kind: "manual", actor: ACTOR, note })
    return batchId
  }
  /** @param {number} [slot] */
  const photo = (slot = 0) => ({ media: seed.media({ section: "official" }), slot })

  const named = CAST.slice(0, 7).map((name, i) => {
    const person = createPerson({
      displayName: name,
      // Link a couple, so the People list shows both linked and unlinked.
      guestId: i < 2 ? guests[i] : null,
      createdBy: ACTOR,
    })
    const identity = createIdentity({
      personId: person.id,
      confirmedBy: ACTOR,
      confirmedAt: new Date().toISOString(),
    })
    return { person, identity, centre: seed.randomVector() }
  })

  // Faces of named people, confirmed through the ledger.
  named.forEach(({ identity, centre }, i) => {
    const batchId = batch(`bulk assign for person ${i + 1}`)
    for (let n = 0; n < 3 + (i * 5) % 7; n++) {
      const { media, slot } = photo()
      const faceId = seed.face(media, slot, seed.near(centre))
      recordAssignment({ faceId, op: "assign", identityId: identity.id, actor: ACTOR, batchId })
    }
  })

  // Unnamed groups, some of them near a named person so suggestions appear.
  const groups = [
    { centre: named[0].centre, size: 11, ask: 2, aside: 2 },
    { centre: named[1].centre, size: 8, ask: 1, aside: 1 },
    { centre: seed.randomVector(), size: 9, ask: 1, aside: 1 },
    { centre: named[3].centre, size: 6, ask: 2, aside: 0 },
    { centre: seed.randomVector(), size: 5, ask: 0, aside: 2 },
    { centre: seed.randomVector(), size: 3, ask: 1, aside: 0 },
    { centre: seed.randomVector(), size: 2, ask: 0, aside: 0 },
  ]
  const leftover = []
  for (const group of groups) {
    for (let i = 0; i < group.size; i++) {
      const state =
        i >= group.size - group.aside
          ? "set_aside"
          : i >= group.size - group.aside - group.ask
            ? "ask"
            : "accept"
      const { media, slot } = photo()
      leftover.push({ faceId: seed.face(media, slot, seed.near(group.centre), state), group })
    }
  }

  // Lone faces nobody else looks like, and photos where every face was set aside.
  for (let i = 0; i < 6; i++) {
    seed.face(photo().media, 0, seed.randomVector(), i % 2 ? "ask" : "accept")
  }
  for (let i = 0; i < 4; i++) {
    const { media } = photo()
    for (let slot = 0; slot < 1 + (i % 3); slot++) {
      seed.face(media, slot, seed.randomVector(), "set_aside")
    }
  }

  // Same-moment pairs: a named face and a near-identical unnamed one.
  named.slice(0, 5).forEach(({ identity, centre }) => {
    const frame = crypto.randomBytes(32).toString("hex")
    const first = photo().media
    const second = photo().media
    seed.db
      .prepare("UPDATE media SET frame_root_sha256 = ? WHERE id IN (?, ?)")
      .run(frame, first.id, second.id)
    const vector = seed.near(centre, 0.02)
    const faceId = seed.face(first, 1, vector)
    recordAssignment({ faceId, op: "assign", identityId: identity.id, actor: ACTOR, batchId: null })
    seed.face(second, 1, seed.near(vector, 0.01))
  })

  // One pass already taken back, so History shows both states.
  const undone = batch("bulk not-a-face of 1 face")
  const junk = seed.face(photo().media, 0, seed.randomVector())
  recordAssignment({ faceId: junk, op: "not_a_face", actor: ACTOR, batchId: undone })
  revokeBatch(undone, ACTOR)

  if (everyoneNamed) {
    const batchId = batch("named everyone left")
    for (const { faceId, group } of leftover) {
      const match = named.find((person) => person.centre === group.centre)
      if (match) {
        recordAssignment({ faceId, op: "assign", identityId: match.identity.id, actor: ACTOR, batchId })
      } else {
        recordAssignment({ faceId, op: "not_a_face", actor: ACTOR, batchId })
      }
    }
  }
}

/**
 * @param {Seeder} seed
 * @param {string} publicUrl
 * @returns {Types.PreviewLink[]}
 */
function seedCards(seed, publicUrl) {
  const guests = seed.guests(14)
  const accounts = seed.accounts(6)
  const media = seed.gallery(24, 6, accounts)
  const gifts = guests.map((guestId, i) => {
    const gift = createGift({
      guestId,
      description: seed.cycle(["Stand mixer", "A very large cheque", "Hand-thrown bowls"], i),
      amount: i % 2 ? `${100 + i * 25}` : null,
      notes: i % 3 ? null : "From the registry",
      receivedAt: timestamp(9000 - i * 100).slice(0, 10),
    })
    if (i % 4 === 0) setPhysicalCardSent(gift.id, true)
    return gift
  })
  /** @type {Types.PreviewLink[]} */
  const links = []
  /** @param {number} i @param {string} message */
  const card = (i, message) =>
    createThankYouCard({
      guestId: guests[i],
      giftId: gifts[i].id,
      message,
      theme: seed.cycle(["classic", "garden", "midnight"], i),
      mediaKeys: [media[i].key, media[i + 1].key, media[i + 2].key],
    })
  const body = "Thank you so much. We use it every single day, and we think of you when we do."

  for (let i = 0; i < 4; i++) card(i, body)
  for (let i = 4; i < 7; i++) markCardSent(card(i, body).id, "link")
  for (let i = 7; i < 10; i++) {
    const sent = card(i, body)
    markCardSent(sent.id, "email")
    recordCardOpen(sent.token)
    if (i === 7) links.push({ label: "An opened card", url: `/thanks?card=${sent.token}` })
  }
  for (let i = 10; i < 13; i++) {
    const sent = card(i, body)
    markCardSent(sent.id, "email")
    recordCardOpen(sent.token)
    setCardReply(sent.id, { emoji: seed.cycle(EMOJI, i), message: "You are so welcome. Come visit!" })
    if (i === 10) links.push({ label: "A replied card", url: `/thanks?card=${sent.token}` })
  }
  const unopened = card(13, body)
  markCardSent(unopened.id, "link")
  links.unshift({ label: "An unopened card", url: `/thanks?card=${unopened.token}` })
  return links.map((link) => ({ ...link, url: new URL(link.url, publicUrl).toString() }))
}

/** @param {Seeder} seed */
function seedLongText(seed) {
  const longName = "Maximiliana Wilhelmina Featherstonehaugh-Cholmondeley de la Vega y Santos"
  const arabic = "ليلى عبد الرحمن"
  const names = [longName, arabic, "李小龙 🐉", "Zoë 👰🏽‍♀️ Müller", "O'Brien-Nakamura, Jr."]
  /** @param {number} length */
  const paragraph = (length) => {
    const text = "We laughed until it hurt and danced until the band gave up. ".repeat(40)
    return text.slice(0, length)
  }
  const guests = seed.guests(10, names.map((name) => `${name} & Family`))
  const accounts = seed.accounts(
    5,
    names.map((name) => name.slice(0, LIMITS.ACCOUNT_NAME_MAX_LENGTH)),
    guests,
  )
  /** @type {PreviewMedia[]} */
  const media = []
  for (let i = 0; i < 12; i++) {
    media.push(
      seed.media({
        section: "guest",
        accountId: seed.cycle(accounts, i),
        caption: i % 2 ? paragraph(280) : seed.cycle(["أجمل يوم في حياتي", "🎉🎉🎉🎉🎉", "A"], i),
      }),
    )
  }
  const unbroken = "Sooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo".repeat(4)
  const notes = [
    seed.note(accounts[0], paragraph(LIMITS.GUESTBOOK_MESSAGE_MAX_LENGTH), "approved", 60, true),
    seed.note(accounts[1], "كان حفلاً رائعاً، شكراً لكم على هذا اليوم الجميل.", "approved", 90, true),
    seed.note(accounts[2], "🥂", "approved", 120),
    seed.note(accounts[3], `${unbroken} good.`, "approved", 150),
    seed.note(accounts[4], "Line one\n\nLine three\n\n\n\nLine seven", "approved", 180),
    seed.note(accounts[0], paragraph(600), "pending", 30),
  ]
  seed.comment(accounts[1], "guestbook", notes[0], paragraph(LIMITS.COMMENT_MAX_LENGTH))
  seed.comment(accounts[2], "media", media[0].id, unbroken.slice(0, LIMITS.COMMENT_MAX_LENGTH))
  const person = createPerson({ displayName: longName, guestId: null, createdBy: ACTOR })
  const identity = createIdentity({ personId: person.id, confirmedBy: ACTOR })
  const centre = seed.randomVector()
  for (let i = 0; i < 4; i++) {
    const faceId = seed.face(media[i], 0, seed.near(centre))
    recordAssignment({ faceId, op: "assign", identityId: identity.id, actor: ACTOR, batchId: null })
  }
}

/** @param {Seeder} seed */
function seedBacklog(seed) {
  const guests = seed.guests(12)
  const accounts = seed.accounts(10, CAST, guests)
  const media = seed.gallery(12, 6, accounts)
  const notes = seed.notes(6, accounts)

  // Untrusted, with several approved posts: this is what triggers the trust nudge.
  for (let i = 0; i < 5; i++) seed.note(accounts[3], seed.cycle(NOTES, i), "approved", 2000 + i)

  for (let i = 0; i < 24; i++) {
    seed.note(seed.cycle(accounts, i), seed.cycle(NOTES, i), "pending", 18 + i * 21)
  }
  for (let i = 0; i < 18; i++) {
    seed.media({
      section: "guest",
      status: "pending",
      kind: i % 6 === 4 ? "video" : "image",
      accountId: seed.cycle(accounts, i),
      caption: seed.cycle(CAPTIONS, i),
      minutesAgo: 25 + i * 33,
    })
  }
  for (let i = 0; i < 12; i++) {
    const onNote = i % 3 === 0
    seed.comment(
      seed.cycle(accounts, i),
      onNote ? "guestbook" : "media",
      onNote ? seed.cycle(notes, i) : seed.cycle(media, i).id,
      seed.cycle(COMMENTS, i),
      "pending",
      31 + i * 17,
    )
  }
  seed.note(accounts[1], "An inside joke that should stay inside.", "hidden", 300)
  seed.note(accounts[2], "Buy cheap watches at example.test", "rejected", 420)
  seed.media({ section: "guest", status: "hidden", accountId: accounts[4], caption: "Blurry one" })
  seed.media({ section: "guest", status: "rejected", accountId: accounts[5] })

  // A public photo already used in a sent card, so hiding it shows the warning.
  const guestId = seed.guest("Marisol Vance", 900)
  const gift = createGift({ guestId, description: "Hand-thrown bowls", receivedAt: "2026-05-02" })
  const inCard = media[13]
  const card = createThankYouCard({
    guestId,
    giftId: gift.id,
    message: "Thank you for the bowls!",
    theme: "classic",
    mediaKeys: [inCard.key],
  })
  markCardSent(card.id, "link")
}

/**
 * The owner's import: every photo uploaded, the rejects hidden. Nearly everything
 * in Official is hidden, a video among them, and the hidden photos with faces are
 * what make the Faces tab different from a public-only view.
 * @param {Seeder} seed
 */
function seedCulled(seed) {
  seed.guests(12)
  const accounts = seed.accounts(6)
  const guestPhotos = seed.gallery(0, 8, accounts)
  seed.notes(6, accounts)
  seed.engagement(4, 12, accounts, guestPhotos, [])

  const OFFICIAL_COUNT = 90
  /** @type {PreviewMedia[]} */
  const hidden = []
  /** @type {PreviewMedia[]} */
  const visible = []
  for (let i = 0; i < OFFICIAL_COUNT; i++) {
    const keep = i % 6 === 0
    const media = seed.media({
      section: "official",
      status: keep ? "approved" : "hidden",
      kind: i === 7 ? "video" : "image",
      sortOrder: i,
      caption: keep && i % 12 === 0 ? seed.cycle(CAPTIONS, i) : null,
    })
    if (keep) visible.push(media)
    else hidden.push(media)
  }
  const images = hidden.filter((_, i) => i !== 6)

  // One named person, whose faces sit mostly on photos guests can't see.
  const person = createPerson({ displayName: CAST[0], guestId: null, createdBy: ACTOR })
  const identity = createIdentity({
    personId: person.id,
    confirmedBy: ACTOR,
    confirmedAt: new Date().toISOString(),
  })
  const named = seed.randomVector()
  const batchId = crypto.randomUUID()
  createBatch({ batchId, kind: "manual", actor: ACTOR, note: "named on culled photos" })
  for (const media of [visible[0], ...images.slice(0, 6)]) {
    const faceId = seed.face(media, 0, seed.near(named))
    recordAssignment({ faceId, op: "assign", identityId: identity.id, actor: ACTOR, batchId })
  }

  // Two unnamed groups, entirely on hidden photos, plus a lone face and a leftover.
  for (const [start, size] of [
    [6, 7],
    [13, 5],
  ]) {
    const centre = seed.randomVector()
    for (const media of images.slice(start, start + size)) {
      seed.face(media, 0, seed.near(centre))
    }
  }
  seed.face(images[18], 0, seed.randomVector(), "ask")
  seed.face(images[19], 0, seed.randomVector(), "set_aside")
}

/**
 * @param {string} state
 * @param {string} publicUrl
 * @returns {Types.PreviewLink[]}
 */
function seedState(state, publicUrl) {
  const seed = createSeeder()
  if (state === "fresh") return []
  if (state === "sparse") {
    seed.guests(3)
    const accounts = seed.accounts(3)
    const media = [
      seed.media({ section: "official", sortOrder: 0 }),
      seed.media({ section: "official", sortOrder: 1 }),
      seed.media({ section: "official", sortOrder: 2 }),
      seed.media({ section: "guest", accountId: accounts[1], caption: "Golden hour" }),
    ]
    const notes = [
      seed.note(accounts[1], "Thank you for having us. The whole day felt like a hug."),
      seed.note(accounts[2], "Still thinking about that dance floor!"),
    ]
    seed.engagement(1, 2, accounts, media, notes)
  } else if (state === "typical") {
    typicalBase(seed)
  } else if (state === "lots") {
    const guests = seed.guests(180)
    const accounts = seed.accounts(140, CAST, guests)
    const media = seed.gallery(1400, 600, accounts)
    const notes = seed.notes(400, accounts)
    seed.engagement(300, 1500, accounts, media, notes)
  } else if (state === "backlog") {
    seedBacklog(seed)
  } else if (state === "honeymoon") {
    typicalBase(seed)
    for (let i = 0; i < 40; i++) {
      seed.media({
        section: "honeymoon",
        sortOrder: i,
        caption: i % 7 ? null : seed.cycle(CAPTIONS, i),
      })
    }
  } else if (state === "faces-half") {
    seedFaces(seed, false)
  } else if (state === "faces-named") {
    seedFaces(seed, true)
  } else if (state === "cards") {
    return seedCards(seed, publicUrl)
  } else if (state === "culled") {
    seedCulled(seed)
  } else if (state === "long-text") {
    seedLongText(seed)
  } else {
    throw new Error(`Unknown state: ${state}`)
  }
  return []
}

function main() {
  const [state, publicUrl = "http://localhost:3100"] = process.argv.slice(2)
  const databasePath = process.env.DATABASE_PATH ?? ""
  if (!isPreviewDatabasePath(databasePath)) {
    throw new Error("DATABASE_PATH must be inside tmp/states/. This tool writes fictional rows.")
  }
  if (!state || !Object.hasOwn(PREVIEW_STATES, state)) {
    throw new Error(`Unknown state: ${state}`)
  }
  init()
  ensureUploadDirs()
  setAppState("admin_hash", hashPassword(PREVIEW_PASSWORD))
  const links = seedState(state, publicUrl)
  fs.writeFileSync(
    path.join(path.dirname(databasePath), "links.json"),
    JSON.stringify(links, null, 2),
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
