/**
 * @file Black-and-white twins, end to end. The privacy rule under test:
 *
 *   A twin is never an item of its own, and its bytes reach a non-admin only
 *   when its colour primary is approved AND the couple turned the lightbox flip
 *   on. Otherwise every read 404s, exactly like a hidden photo.
 *
 * So every way in is tried — by URL (GET, HEAD, Range, conditional), by feed,
 * by id, by comment and reaction, and by thank-you card — with the setting off,
 * on, and with the primary hidden, pending or removed.
 */
// MUST be first: sets TEST_SERVER_PORT before ../helpers.js reads it.
import "./_media-twins-port.js"
// MUST be second: points db/*.js at the test server's database, and provisions
// an admin credential when .env has none.
import "./_media-twins-env.js"

/** @import { DatabaseSync } from 'node:sqlite' */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import {
  startServer,
  stopServer,
  getTestDb,
  createTestAccount,
  createTestAccountSession,
  createTestGuest,
  adminLogin,
  adminFetch,
  accountFetch,
  cleanupTestData,
  BASE_URL,
} from "../helpers.js"
import { makeExifTiff, makeJpeg, makeJpegWithMetadata } from "../media-fixtures.js"
import { createThankYouCard, markCardSent } from "../../db/thank-you-cards.js"
import { init as initDb, close as closeDb } from "../../db/connection.js"

/** @type {DatabaseSync} */
let db
/** @type {any} */
let admin

const SHOT = "2026-04-26 17:03:12"
const PUBLIC_VARIANTS = ["thumb", "display"]

/** @param {Response} res */
async function json(res) {
  return /** @type {any} */ (await res.json().catch(() => ({})))
}

/** @param {{ trusted?: 0 | 1, name?: string }} [opts] */
function signIn({ trusted = 1, name = "Guest" } = {}) {
  const account = createTestAccount(db, { name, trusted })
  const session = createTestAccountSession(db, Number(account.id))
  return {
    accountId: Number(account.id),
    auth: { cookieHeader: session.cookieHeader, csrfToken: session.csrfToken },
  }
}

/**
 * One full image upload. An admin may declare a capture time and finish hidden.
 * @param {any} auth @param {any} fetcher
 * @param {{ section?: string, finalize?: Record<string, unknown>, original?: Buffer }} [opts]
 * @returns {Promise<{ id: number, fileKey: string, status: string }>}
 */
async function upload(auth, fetcher, opts = {}) {
  const original = opts.original ?? makeJpeg(256)
  const created = await fetcher(
    "/api/media",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "image",
        originalBytes: original.length,
        section: opts.section ?? "official",
      }),
    },
    auth,
  )
  assert.strictEqual(created.status, 201)
  const { id, fileKey } = await json(created)
  for (const [variant, body] of [
    ["original", original],
    ["display", makeJpeg(200)],
    ["thumb", makeJpeg(120)],
  ]) {
    const put = await fetcher(
      `/api/media/${id}/${variant}`,
      /** @type {any} */ ({ method: "PUT", headers: { "Content-Type": "image/jpeg" }, body }),
      auth,
    )
    assert.strictEqual(put.status, 200, `PUT ${variant}`)
  }
  const fin = await fetcher(
    `/api/media/${id}/finalize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 1600, height: 1067, ...opts.finalize }),
    },
    auth,
  )
  assert.strictEqual(fin.status, 200)
  return { id: Number(id), fileKey: String(fileKey), status: (await json(fin)).status }
}

/** An admin-uploaded official photo taken at SHOT. @param {Record<string, unknown>} [finalize] */
function officialShot(finalize = {}) {
  return upload(admin, adminFetch, { finalize: { capturedAt: SHOT, ...finalize } })
}

/** @param {boolean} on */
async function setBlackAndWhite(on) {
  const got = await adminFetch("/api/admin/site-content", {}, admin)
  const { content } = await json(got)
  content.gallery = { showBlackAndWhite: on }
  const put = await adminFetch(
    "/api/admin/site-content",
    { method: "PUT", body: JSON.stringify(content) },
    admin,
  )
  assert.strictEqual(put.status, 200)
}

/** @param {number} primaryId @param {number} twinId */
function pair(primaryId, twinId) {
  return adminFetch(
    `/api/admin/media/${primaryId}/twin`,
    { method: "POST", body: JSON.stringify({ twinId }) },
    admin,
  )
}

/** A thank-you card through the admin composer's endpoint.
 *  @param {number} guestId @param {string[]} mediaKeys */
function createCard(guestId, mediaKeys) {
  return adminFetch(
    "/api/admin/thank-you",
    {
      method: "POST",
      body: JSON.stringify({ guest_id: guestId, message: "Thanks!", media_keys: mediaKeys }),
    },
    admin,
  )
}

/** @param {string} fileKey @param {any} [guest] @returns {Promise<number[]>} */
async function byteStatuses(fileKey, guest) {
  const statuses = []
  for (const variant of PUBLIC_VARIANTS) {
    const res = guest
      ? await accountFetch(`/media/${fileKey}/${variant}`, { method: "GET" }, guest)
      : await fetch(`${BASE_URL}/media/${fileKey}/${variant}`)
    await res.arrayBuffer()
    statuses.push(res.status)
  }
  return statuses
}

/**
 * Every way a non-admin could reach a twin's bytes, and that each is a 404.
 * @param {string} fileKey @param {any} [guest]
 */
async function assertBytesClosed(fileKey, guest) {
  assert.deepStrictEqual(await byteStatuses(fileKey, guest), [404, 404], "GET")
  for (const variant of ["original", "poster", "video"]) {
    const res = await fetch(`${BASE_URL}/media/${fileKey}/${variant}`)
    await res.arrayBuffer()
    assert.strictEqual(res.status, 404, variant)
  }
  const head = await fetch(`${BASE_URL}/media/${fileKey}/display`, { method: "HEAD" })
  assert.strictEqual(head.status, 404, "HEAD")
  const ranged = await fetch(`${BASE_URL}/media/${fileKey}/display`, {
    headers: { Range: "bytes=0-1" },
  })
  await ranged.arrayBuffer()
  assert.strictEqual(ranged.status, 404, "Range")
  const conditional = await fetch(`${BASE_URL}/media/${fileKey}/display`, {
    headers: { "If-None-Match": `"${fileKey}-display"` },
  })
  assert.strictEqual(conditional.status, 404, "a conditional request confirms nothing")
}

/**
 * A twin is no item of its own: not listed, not by id, not commentable or
 * reactable, whatever the setting says.
 * @param {number} twinId @param {any} guest
 */
async function assertNotAnItem(twinId, guest) {
  for (const section of ["official", "honeymoon", "guest"]) {
    for (const read of [
      () => fetch(`${BASE_URL}/api/media?section=${section}`),
      () => accountFetch(`/api/media?section=${section}`, { method: "GET" }, guest),
    ]) {
      const page = await json(await read())
      assert.ok(!page.items.some((/** @type {any} */ r) => r.id === twinId), `listed: ${section}`)
    }
  }
  assert.strictEqual((await fetch(`${BASE_URL}/api/media/${twinId}`)).status, 404, "by id")
  const listComments = await fetch(`${BASE_URL}/api/media/${twinId}/comments`)
  assert.strictEqual(listComments.status, 404, "comment thread")
  const headers = { "Content-Type": "application/json" }
  const comment = await accountFetch(
    `/api/media/${twinId}/comments`,
    { method: "POST", headers, body: JSON.stringify({ message: "the grey one!" }) },
    guest,
  )
  assert.strictEqual(comment.status, 404, "comment")
  const reaction = await accountFetch(
    "/api/reactions/toggle",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ target_type: "media", target_id: twinId, emoji: "heart" }),
    },
    guest,
  )
  assert.strictEqual(reaction.status, 404, "reaction")
}

/** @param {number} id @returns {Promise<any>} */
async function feedItem(id, section = "official") {
  const page = await json(await fetch(`${BASE_URL}/api/media?section=${section}`))
  return page.items.find((/** @type {any} */ r) => r.id === id)
}

before(async () => {
  await startServer()
  db = getTestDb()
  initDb()
})
after(async () => {
  closeDb()
  await stopServer()
})
beforeEach(async () => {
  cleanupTestData(db)
  const a = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
  admin = { cookieHeader: a.cookieHeader, csrfToken: a.csrfToken }
  // The server caches site content, so cleanup's app_state wipe doesn't reach it.
  await setBlackAndWhite(false)
})

describe("capture time, which twins are matched on", () => {
  it("comes from a browser upload's EXIF or the importer, never from a guest", async () => {
    const exif = makeExifTiff({ capturedAt: "2026:04:26 17:03:12" })
    const { auth: guest } = signIn({ trusted: 1 })
    const fromExif = await upload(guest, accountFetch, {
      section: "guest",
      original: makeJpegWithMetadata({ exif }),
    })
    const declaredByGuest = await upload(guest, accountFetch, {
      section: "guest",
      finalize: { capturedAt: SHOT },
    })
    const declaredByAdmin = await officialShot()
    const malformed = await upload(admin, adminFetch, { finalize: { capturedAt: "yesterday" } })
    /** @param {number} id */
    const capturedAt = (id) =>
      /** @type {any} */ (db.prepare("SELECT captured_at FROM media WHERE id = ?").get(id))
        .captured_at
    assert.strictEqual(capturedAt(fromExif.id), SHOT, "from the original's EXIF")
    assert.strictEqual(capturedAt(declaredByGuest.id), null, "a guest can't declare one")
    assert.strictEqual(capturedAt(declaredByAdmin.id), SHOT, "an admin (the importer) can")
    assert.strictEqual(capturedAt(malformed.id), null, "a malformed one is ignored")
  })
})

describe("finding and pairing twins (admin)", () => {
  it("the scan back-fills capture times and groups by moment, size and section", async () => {
    const exif = makeExifTiff({ capturedAt: "2026:04:26 17:03:12" })
    const colour = await officialShot()
    const copy = await upload(admin, adminFetch, {
      original: makeJpegWithMetadata({ exif }),
      finalize: { hidden: true },
    })
    // A row from before capture times were recorded: the scan reads its original.
    db.prepare("UPDATE media SET captured_at = NULL WHERE id = ?").run(copy.id)
    await officialShot({ width: 1067, height: 1600 }) // same moment, other shape
    await upload(admin, adminFetch, { section: "honeymoon", finalize: { capturedAt: SHOT } })

    const res = await adminFetch(
      "/api/admin/media/twins/scan",
      { method: "POST", body: "{}" },
      admin,
    )
    assert.strictEqual(res.status, 200)
    const scan = await json(res)
    assert.strictEqual(scan.backfilled, 1)
    assert.strictEqual(scan.groups.length, 1)
    assert.deepStrictEqual(
      scan.groups[0].members.map((/** @type {any} */ m) => m.id).sort(),
      [colour.id, copy.id].sort(),
    )
  })

  it("pairs and unpairs; the copy leaves the grid and comes back as it was", async () => {
    const colour = await officialShot()
    const copy = await officialShot({ hidden: true })
    const res = await pair(colour.id, copy.id)
    assert.strictEqual(res.status, 200)

    const listed = await json(
      await adminFetch("/api/admin/media/curated?section=official", {}, admin),
    )
    assert.deepStrictEqual(
      listed.items.map((/** @type {any} */ r) => r.id),
      [colour.id],
      "one tile",
    )
    assert.strictEqual(listed.items[0].twin.file_key, copy.fileKey, "the admin always sees it")
    // Reorder names the set without the copy, so it still works.
    const reorder = await adminFetch(
      "/api/admin/media/reorder",
      { method: "POST", body: JSON.stringify({ ids: [colour.id] }) },
      admin,
    )
    assert.strictEqual(reorder.status, 200)

    const unpair = () =>
      adminFetch(`/api/admin/media/${colour.id}/twin`, { method: "DELETE" }, admin)
    const unpaired = await unpair()
    assert.strictEqual(unpaired.status, 200)
    assert.strictEqual((await json(unpaired)).twin.status, "hidden")
    const again = await unpair()
    assert.strictEqual(again.status, 404)
  })

  it("refuses the shapes a pair can't have", async () => {
    const a = await officialShot()
    const b = await officialShot()
    const c = await officialShot()
    const elsewhere = await upload(admin, adminFetch, { section: "honeymoon" })
    assert.strictEqual((await pair(a.id, a.id)).status, 400, "itself")
    assert.strictEqual((await pair(a.id, elsewhere.id)).status, 409, "another section")
    assert.strictEqual((await pair(a.id, 999999)).status, 404, "missing")
    assert.strictEqual((await pair(a.id, b.id)).status, 200)
    assert.strictEqual((await pair(a.id, c.id)).status, 409, "a second copy")
    assert.strictEqual((await pair(c.id, a.id)).status, 409, "a primary as a copy")
    assert.strictEqual((await pair(c.id, b.id)).status, 409, "a copy twice")
    assert.strictEqual((await pair(b.id, c.id)).status, 409, "a copy as a primary")
  })

  it("is admin-only", async () => {
    const a = await officialShot()
    const b = await officialShot()
    const { auth: guest } = signIn({ trusted: 1 })
    const body = JSON.stringify({ twinId: b.id })
    const tries = [
      accountFetch(`/api/admin/media/${a.id}/twin`, { method: "POST", body }, guest),
      accountFetch(`/api/admin/media/${a.id}/twin`, { method: "DELETE" }, guest),
      accountFetch("/api/admin/media/twins/scan", { method: "POST", body: "{}" }, guest),
      accountFetch(`/api/admin/media/${a.id}/twin-options`, { method: "GET" }, guest),
    ]
    for (const res of await Promise.all(tries)) assert.strictEqual(res.status, 401)
    assert.strictEqual(
      /** @type {any} */ (db.prepare("SELECT twin_of FROM media WHERE id = ?").get(b.id)).twin_of,
      null,
    )
  })
})

describe("a twin's privacy", () => {
  it("setting off: one tile, colour only, and the copy closed by every route", async () => {
    const colour = await officialShot()
    // An approved copy: its own status would make it public, and must not.
    const copy = await officialShot()
    assert.strictEqual(copy.status, "approved")
    assert.strictEqual((await pair(colour.id, copy.id)).status, 200)
    const { auth: guest } = signIn({ trusted: 1, name: "Curious" })

    const item = await feedItem(colour.id)
    assert.ok(item, "the colour photo is listed")
    assert.strictEqual(item.twin, null, "and names no copy")
    const one = await json(await fetch(`${BASE_URL}/api/media/${colour.id}`))
    assert.strictEqual(one.twin, null, "nor does its deep link")
    await assertNotAnItem(copy.id, guest)
    await assertBytesClosed(copy.fileKey)
    await assertBytesClosed(copy.fileKey, guest)

    const asAdmin = await adminFetch(`/media/${copy.fileKey}/display`, {}, admin)
    assert.strictEqual(asAdmin.status, 200, "the admin still sees it")
    await asAdmin.arrayBuffer()
  })

  it("setting on: an approved photo names its copy; only its public variants open", async () => {
    const colour = await officialShot()
    const copy = await officialShot({ hidden: true })
    await pair(colour.id, copy.id)
    await setBlackAndWhite(true)

    const item = await feedItem(colour.id)
    assert.deepStrictEqual(item.twin, {
      id: copy.id,
      file_key: copy.fileKey,
      needs_display: false,
    })
    const config = await json(await fetch(`${BASE_URL}/api/config`))
    assert.strictEqual(config.gallery.showBlackAndWhite, true)
    assert.deepStrictEqual(await byteStatuses(copy.fileKey), [200, 200])
    const res = await fetch(`${BASE_URL}/media/${copy.fileKey}/display`)
    await res.arrayBuffer()
    assert.strictEqual(
      res.headers.get("cache-control"),
      "private, no-cache",
      "no shared cache may answer for the gate",
    )
    const original = await fetch(`${BASE_URL}/media/${copy.fileKey}/original`)
    await original.arrayBuffer()
    assert.strictEqual(original.status, 404, "the original stays admin-only")
    // Still not an item of its own.
    const { auth: guest } = signIn({ trusted: 1 })
    await assertNotAnItem(copy.id, guest)

    // Off again: closed at once, no cache to wait out.
    await setBlackAndWhite(false)
    await assertBytesClosed(copy.fileKey)
    assert.strictEqual((await feedItem(colour.id)).twin, null)
  })

  it("follows its primary: hidden or removed closes the copy, setting on or not", async () => {
    await setBlackAndWhite(true)
    const hidden = await officialShot()
    const hiddenCopy = await officialShot({ hidden: true })
    await pair(hidden.id, hiddenCopy.id)
    assert.deepStrictEqual(await byteStatuses(hiddenCopy.fileKey), [200, 200], "open at first")
    const hide = await adminFetch(
      `/api/admin/moderation/media/${hidden.id}/hide`,
      { method: "POST", body: "{}" },
      admin,
    )
    assert.strictEqual(hide.status, 200)
    await assertBytesClosed(hiddenCopy.fileKey)
    assert.strictEqual(await feedItem(hidden.id), undefined)

    const colour = await officialShot()
    const copy = await officialShot() // approved on its own
    await pair(colour.id, copy.id)
    const removed = await adminFetch(`/api/admin/media/${colour.id}`, { method: "DELETE" }, admin)
    assert.strictEqual(removed.status, 200)
    // Released, but hidden: removing the colour photo never publishes the copy.
    const row = /** @type {any} */ (
      db.prepare("SELECT status, twin_of FROM media WHERE id = ?").get(copy.id)
    )
    assert.deepStrictEqual({ ...row }, { status: "hidden", twin_of: null })
    await assertBytesClosed(copy.fileKey)
  })

  it("an uploader's own pending photo shows them colour only, never its copy", async () => {
    await setBlackAndWhite(true)
    const { auth: uploader } = signIn({ trusted: 0, name: "Pending Pat" })
    const colour = await upload(uploader, accountFetch, { section: "guest" })
    const copy = await upload(uploader, accountFetch, { section: "guest" })
    assert.strictEqual(colour.status, "pending")
    assert.strictEqual((await pair(colour.id, copy.id)).status, 200)

    const page = await json(
      await accountFetch("/api/media?section=guest", { method: "GET" }, uploader),
    )
    const mine = page.items.find((/** @type {any} */ r) => r.id === colour.id)
    assert.ok(mine, "their pending photo is still theirs to see")
    assert.strictEqual(mine.twin, null)
    assert.ok(!page.items.some((/** @type {any} */ r) => r.id === copy.id))
    await assertBytesClosed(copy.fileKey, uploader)

    // Nor is the copy waiting in review on its own.
    const queue = await json(
      await adminFetch("/api/admin/moderation/queue?status=pending&type=media", {}, admin),
    )
    const ids = (queue.items ?? []).map((/** @type {any} */ r) => r.id)
    assert.ok(ids.includes(colour.id) && !ids.includes(copy.id))
  })

  it("is never counted: contributors and the landing tally see one photo", async () => {
    await setBlackAndWhite(true)
    const { auth: guest } = signIn({ trusted: 1, name: "Twin Poster" })
    const colour = await upload(guest, accountFetch, { section: "guest" })
    const copy = await upload(guest, accountFetch, { section: "guest" })
    await pair(colour.id, copy.id)
    const feed = await json(await fetch(`${BASE_URL}/api/media?section=guest`))
    assert.strictEqual(feed.contributors.photos, 1)
    const config = await json(await fetch(`${BASE_URL}/api/config`))
    assert.strictEqual(config.counts.photos, 1)
  })

  it("never reaches a thank-you card", async () => {
    await setBlackAndWhite(true)
    const colour = await officialShot()
    const copy = await officialShot()
    await pair(colour.id, copy.id)
    const guest = createTestGuest(db)

    // The card picker: refused like an unknown key.
    const create = await createCard(Number(guest.id), [copy.fileKey])
    assert.strictEqual(create.status, 400)

    // A card written some other way drops the copy, like a hidden photo.
    const card = createThankYouCard({
      guestId: Number(guest.id),
      giftId: null,
      message: "Thank you!",
      theme: "classic",
      effectsConfig: undefined,
      mediaKeys: [colour.fileKey, copy.fileKey],
    })
    markCardSent(card.id, "manual")
    const read = await json(await fetch(`${BASE_URL}/api/thank-you/${card.token}`))
    assert.deepStrictEqual(
      read.media.map((/** @type {any} */ m) => m.file_key),
      [colour.fileKey],
    )
  })

  it("pairing refuses a copy a thank-you card already shows", async () => {
    const colour = await officialShot()
    const copy = await officialShot()
    const guest = createTestGuest(db)
    const create = await createCard(Number(guest.id), [copy.fileKey])
    assert.strictEqual(create.status, 201)
    const res = await pair(colour.id, copy.id)
    assert.strictEqual(res.status, 409)
    assert.ok((await json(res)).error.includes("thank-you card"))
  })
})
