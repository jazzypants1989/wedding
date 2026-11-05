/**
 * @file Integration tests for the admin site-content editor: GET/PUT/DELETE
 * round-trips through the app_state override, propagation to /api/config and
 * templated pages, validation, and reset-to-defaults.
 */
// MUST be first: sets TEST_SERVER_PORT before ../helpers.js reads it.
import "./_site-content-port.js"

import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import { DatabaseSync } from "node:sqlite"
import {
  startServer,
  stopServer,
  adminLogin,
  adminFetch,
  BASE_URL,
  TEST_DB_PATH,
} from "../helpers.js"

/** Read the raw stored site_content override straight from the server's DB
 *  (committed after the PUT's 200), parsed — or null if the key is absent. */
function readStoredOverride() {
  const db = new DatabaseSync(TEST_DB_PATH, { readOnly: true })
  try {
    const row = /** @type {{ value: string } | undefined} */ (
      db.prepare("SELECT value FROM app_state WHERE key = 'site_content'").get()
    )
    return row ? JSON.parse(row.value) : null
  } finally {
    db.close()
  }
}

/** Whether the content-media row with this file_key has been soft-deleted. */
function isSoftDeleted(/** @type {string} */ fileKey) {
  const db = new DatabaseSync(TEST_DB_PATH, { readOnly: true })
  try {
    const row = /** @type {{ deleted_at: string | null } | undefined} */ (
      db.prepare("SELECT deleted_at FROM media WHERE file_key = ?").get(fileKey)
    )
    return Boolean(row && row.deleted_at)
  } finally {
    db.close()
  }
}

/** @typedef {{ content: { couple: { display: string }, contactEmail: string | null } }} ContentResp */
/**
 * @typedef {{ coupleDisplay: string, mode: string, gallery: { showBlackAndWhite: boolean } }}
 *   ConfigResp
 */

/** @param {Response} res @returns {Promise<ContentResp>} */
async function contentJson(res) {
  return /** @type {ContentResp} */ (await res.json())
}

/** @param {Response} res @returns {Promise<{ content: import("../../types.js").SiteContent }>} */
async function siteContentJson(res) {
  return /** @type {{ content: import("../../types.js").SiteContent }} */ (await res.json())
}

/** @returns {Promise<{ guestbook: { showFavorites: boolean } }>} */
async function favoritesConfig() {
  const res = await fetch(`${BASE_URL}/api/config`)
  return /** @type {{ guestbook: { showFavorites: boolean } }} */ (await res.json())
}

/** @returns {Promise<ConfigResp>} */
async function configJson() {
  return /** @type {ConfigResp} */ (await (await fetch(`${BASE_URL}/api/config`)).json())
}

const hasAdmin = Boolean(process.env.TEST_ADMIN_PASSWORD)

/** A full, valid SiteContent body with distinctive values. */
function sampleBody() {
  return {
    couple: {
      display: "Testy & McTestface",
      first: "Testy and McTestface",
      monogram: "T&M",
      fullNames: ["Testy Test", "Mc Testface"],
    },
    weddingDate: "2030-09-09T17:00:00-07:00",
    location: "Testville, TS",
    contactEmail: "",
    schedule: {
      title: "The Plan",
      items: /** @type {import("../../types.js").SiteContentScheduleItem[]} */ ([
        {
          time: "5:00 PM",
          title: "Ceremony",
          officiant: "Officiant McOfficiant",
          venue: null,
          address: "1 Test Way",
          details: ["First paragraph.", "Second paragraph."],
          note: "Park on the street.",
        },
        { time: "6:00 PM", title: "Reception", officiant: null, venue: "The Hall", address: null, details: ["Dinner and dancing."], note: null },
      ]),
    },
    dressCode: {
      title: "What to Wear",
      body: "Wear teal.",
      images: [
        { src: "/images/we-wear-pink.webp", srcset: null, sizes: null, alt: "Example outfit", caption: "Nice", width: 800, height: 460 },
      ],
    },
    registry: {
      title: "Gifts",
      body: "No gifts needed.",
      frameNote: "Frame loads below.",
      url: "https://example.com/registry",
      label: "Our registry",
    },
    memories: { title: "Looking Back", body: "Relive the day." },
    footer: { githubUrl: "https://github.com/example/repo", eventHeading: "The Big Day" },
    copy: {
      pre: { welcomeHeading: "Hello Pre", welcomeIntro: "Come <em>celebrate</em>." },
      post: { welcomeHeading: "Thanks Post", welcomeIntro: "It was grand." },
    },
    nav: {
      pre: [
        { href: "#", label: "Home" },
        { href: "/rsvp", label: "RSVP Now" },
      ],
      post: [{ href: "#", label: "Home" }],
    },
  }
}

describe("admin site-content editor", () => {
  before(async () => {
    await startServer()
  })

  after(async () => {
    // Best-effort reset so a leftover override doesn't affect other runs.
    if (hasAdmin) {
      try {
        const auth = await adminLogin()
        await adminFetch("/api/admin/site-content", { method: "DELETE" }, auth)
      } catch {
        // ignore
      }
    }
    await stopServer()
  })

  it("requires admin auth", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/site-content`)
    assert.strictEqual(res.status, 401)
  })

  it("GET returns the shipped defaults before any override", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const res = await adminFetch("/api/admin/site-content", {}, auth)
    assert.strictEqual(res.status, 200)
    const data = await contentJson(res)
    assert.strictEqual(data.content.couple.display, "Jordana & Jesse")
  })

  it("PUT persists an override and propagates to /api/config", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const put = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(sampleBody()) },
      auth,
    )
    assert.strictEqual(put.status, 200)
    const putData = await contentJson(put)
    assert.strictEqual(putData.content.couple.display, "Testy & McTestface")
    // contactEmail "" normalizes to null.
    assert.strictEqual(putData.content.contactEmail, null)

    // /api/config is public and reads the effective content.
    const cfg = await configJson()
    assert.strictEqual(cfg.coupleDisplay, "Testy & McTestface")
    // 2030 date → still pre-wedding.
    assert.strictEqual(cfg.mode, "pre")
  })

  it("propagates to templated HTML (cache evicted on save)", { skip: !hasAdmin }, async () => {
    // Prime the page cache with the current value.
    await fetch(`${BASE_URL}/`)

    const auth = await adminLogin()
    const body = sampleBody()
    body.couple.display = "Fresh & Baked"
    await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )

    const homeHtml = await (await fetch(`${BASE_URL}/`)).text()
    // The "&" is HTML-escaped in the templated output (renders as "&" in-browser).
    assert.ok(
      homeHtml.includes("Fresh &amp; Baked"),
      "home page should reflect the freshly saved couple display (escaped)",
    )
  })

  it("renders social share (Open Graph) tags into every guest page head", async () => {
    for (const path of ["/", "/rsvp", "/guestbook", "/gallery"]) {
      const head = (await (await fetch(`${BASE_URL}${path}`)).text()).split("</head>")[0]
      assert.ok(head.includes('property="og:title"'), `${path} head should include og:title`)
      assert.ok(head.includes('property="og:image"'), `${path} head should include og:image`)
      assert.ok(head.includes('name="twitter:card"'), `${path} head should include twitter:card`)
      // Every OG/token placeholder must resolve — no literal "{{…}}" leaks.
      assert.ok(!head.includes("{{"), `${path} head should have no unresolved template tokens`)
    }
  })

  it("replaces nav wholesale and renders the new links", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const body = sampleBody()
    body.nav.pre = [{ href: "/rsvp", label: "Just RSVP" }]
    await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    const homeHtml = await (await fetch(`${BASE_URL}/`)).text()
    assert.ok(homeHtml.includes("Just RSVP"), "new nav label should render")
  })

  it("guestbook Favorites default off, round-trip through PUT, and reach /api/config", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    await adminFetch("/api/admin/site-content", { method: "DELETE" }, auth)
    const before = await favoritesConfig()
    assert.deepStrictEqual(before.guestbook, { showFavorites: false }, "off by default")

    // A body that predates the field is still valid and keeps it off.
    const legacy = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(sampleBody()) },
      auth,
    )
    assert.strictEqual(legacy.status, 200)
    assert.strictEqual((await siteContentJson(legacy)).content.guestbook.showFavorites, false)

    const body = { ...sampleBody(), guestbook: { showFavorites: true } }
    const put = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    assert.strictEqual(put.status, 200)
    assert.strictEqual((await siteContentJson(put)).content.guestbook.showFavorites, true)
    assert.deepStrictEqual(readStoredOverride().guestbook, { showFavorites: true })
    const after = await favoritesConfig()
    assert.deepStrictEqual(after.guestbook, { showFavorites: true })
  })

  it("the gallery black-and-white flip defaults off, saves, and reaches /api/config", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    await adminFetch("/api/admin/site-content", { method: "DELETE" }, auth)
    assert.deepStrictEqual((await configJson()).gallery, { showBlackAndWhite: false }, "off")

    const body = { ...sampleBody(), gallery: { showBlackAndWhite: true } }
    const put = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    assert.strictEqual(put.status, 200)
    assert.strictEqual((await siteContentJson(put)).content.gallery.showBlackAndWhite, true)
    assert.deepStrictEqual(readStoredOverride().gallery, { showBlackAndWhite: true })
    assert.deepStrictEqual((await configJson()).gallery, { showBlackAndWhite: true })

    const badBody = { ...sampleBody(), gallery: { showBlackAndWhite: 1 } }
    const bad = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(badBody) },
      auth,
    )
    assert.strictEqual(bad.status, 400)
    await adminFetch("/api/admin/site-content", { method: "DELETE" }, auth)
  })

  it("rejects a non-boolean guestbook Favorites toggle", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const body = { ...sampleBody(), guestbook: { showFavorites: "yes" } }
    const res = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("rejects a missing required field", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const body = sampleBody()
    body.couple.display = ""
    const res = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("rejects a non-http registry URL", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const body = sampleBody()
    body.registry.url = "javascript:alert(1)"
    const res = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("renders edited schedule items and headings into the landing HTML", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const body = sampleBody()
    body.schedule.title = "Order of the Day"
    body.schedule.items = [
      { time: "9:00 AM", title: "Sunrise Yoga", officiant: null, venue: "The Lawn", address: null, details: ["Bring a mat."], note: "BYO water." },
    ]
    body.memories.title = "The Afterglow"
    await adminFetch("/api/admin/site-content", { method: "PUT", body: JSON.stringify(body) }, auth)

    const homeHtml = await (await fetch(`${BASE_URL}/`)).text()
    assert.ok(homeHtml.includes("Order of the Day"), "schedule heading should render")
    assert.ok(homeHtml.includes("Sunrise Yoga"), "schedule item title should render")
    assert.ok(homeHtml.includes('class="schedule-venue">The Lawn'), "optional venue line should render")
    assert.ok(homeHtml.includes("Bring a mat."), "schedule detail paragraph should render")
    assert.ok(!homeHtml.includes('class="schedule-officiant"'), "null officiant line should be omitted")
    assert.ok(homeHtml.includes("The Afterglow"), "memories heading should render")
  })

  it("rejects a schedule item missing its time", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const body = sampleBody()
    body.schedule.items = /** @type {import("../../types.js").SiteContentScheduleItem[]} */ ([
      { time: "", title: "No Time", officiant: null, venue: null, address: null, details: ["x"], note: null },
    ])
    const res = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("rejects a dress-code image with an unsafe src scheme", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const body = sampleBody()
    body.dressCode.images[0].src = "javascript:alert(1)"
    const res = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    assert.strictEqual(res.status, 400)
  })

  it("accepts a media-backed dress-code image and renders its ladder srcset", { skip: !hasAdmin }, async () => {
    // Mirrors what the admin image manager produces after a content upload:
    // src = /media/{key}/w1600, srcset built from the responsive ladder.
    const auth = await adminLogin()
    const key = "abcdef0123456789abcdef0123456789"
    const body = sampleBody()
    // Cast: sampleBody() infers srcset/sizes as null from its literal; this
    // media-backed descriptor supplies real strings (as reqContentImage allows).
    body.dressCode.images = /** @type {any} */ ([
      {
        src: `/media/${key}/w1600`,
        srcset: `/media/${key}/w400 400w, /media/${key}/w800 800w, /media/${key}/w1600 1200w`,
        sizes: "(min-width: 400px) 400px, 100vw",
        alt: "Dress code figure",
        caption: "Wear pink",
        width: 1200,
        height: 800,
      },
    ])
    const put = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    assert.strictEqual(put.status, 200, "media-backed descriptor passes the content validators")

    const homeHtml = await (await fetch(`${BASE_URL}/`)).text()
    assert.ok(homeHtml.includes(`/media/${key}/w1600`), "landing page renders the media src")
    assert.ok(homeHtml.includes(`/media/${key}/w400 400w`), "landing page renders the ladder srcset")
    assert.ok(homeHtml.includes('alt="Dress code figure"'), "alt attribute rendered")
    assert.ok(homeHtml.includes("Wear pink"), "caption rendered")
  })

  it("soft-deletes a content media row when its dress-code image is dropped on save", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const key = "beef000000000000000000000000feed"
    // Seed an approved content-section row, as a finished admin upload would leave.
    const seed = new DatabaseSync(TEST_DB_PATH)
    try {
      seed
        .prepare(
          "INSERT INTO media (file_key, kind, section, status, original_bytes) VALUES (?, 'image', 'content', 'approved', 1000)",
        )
        .run(key)
    } finally {
      seed.close()
    }

    // Save content that references it → row stays live.
    const withImg = sampleBody()
    withImg.dressCode.images = /** @type {any} */ ([
      {
        src: `/media/${key}/w1600`,
        srcset: null,
        sizes: null,
        alt: "Figure",
        caption: null,
        width: 800,
        height: 600,
      },
    ])
    let put = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(withImg) },
      auth,
    )
    assert.strictEqual(put.status, 200)
    assert.ok(!isSoftDeleted(key), "row stays live while still referenced")

    // Save again without the image → the de-referenced row is reclaimed.
    put = await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(sampleBody()) },
      auth,
    )
    assert.strictEqual(put.status, 200)
    assert.ok(isSoftDeleted(key), "dropped content image's media row is soft-deleted")
  })

  it("escapes content tokens in templated HTML (no raw injection)", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    const body = sampleBody()
    body.couple.display = 'Amp & <script>x=1</script> "q"'
    await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    const homeHtml = await (await fetch(`${BASE_URL}/`)).text()
    // The raw payload must never appear; the escaped form must.
    assert.ok(!homeHtml.includes("<script>x=1</script>"), "raw script tag must not be injected")
    assert.ok(homeHtml.includes("&lt;script&gt;x=1&lt;/script&gt;"), "display should be HTML-escaped")
  })

  it("stores only the diff from defaults (sparse override)", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    // Start from defaults, then read the full effective content.
    await adminFetch("/api/admin/site-content", { method: "DELETE" }, auth)
    const defaults = /** @type {any} */ (
      (await contentJson(await adminFetch("/api/admin/site-content", {}, auth))).content
    )
    // Submit the full body unchanged except one field.
    const body = { ...defaults, location: "Sparse City, SP" }
    await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(body) },
      auth,
    )
    // Only the changed field is persisted; unchanged fields keep tracking defaults.
    assert.deepStrictEqual(readStoredOverride(), { location: "Sparse City, SP" })
  })

  it("clears the override when a submission equals the defaults", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    // Reset first so GET returns the true shipped defaults, not a prior override.
    await adminFetch("/api/admin/site-content", { method: "DELETE" }, auth)
    const defaults = /** @type {any} */ (
      (await contentJson(await adminFetch("/api/admin/site-content", {}, auth))).content
    )
    await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(defaults) },
      auth,
    )
    assert.strictEqual(readStoredOverride(), null)
  })

  it("DELETE resets to content.js defaults", { skip: !hasAdmin }, async () => {
    const auth = await adminLogin()
    // Ensure an override exists first.
    await adminFetch(
      "/api/admin/site-content",
      { method: "PUT", body: JSON.stringify(sampleBody()) },
      auth,
    )
    const del = await adminFetch("/api/admin/site-content", { method: "DELETE" }, auth)
    assert.strictEqual(del.status, 200)
    const delData = await contentJson(del)
    assert.strictEqual(delData.content.couple.display, "Jordana & Jesse")

    const cfg = await configJson()
    assert.strictEqual(cfg.coupleDisplay, "Jordana & Jesse")
  })
})
