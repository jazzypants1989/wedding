/** @file Unit test: the fictional preview states.
 *
 *  Builds real scratch databases under tmp/states/, because that is the only place
 *  the seeder agrees to write. Everything in them is invented. The properties that
 *  matter: it can't touch a real database, its faces route the way they claim, and
 *  a crafted URL can't become a path or an off-site redirect.
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { after, describe, it } from "node:test"

import { routeCutoffs, routeFace } from "../../public/vision/route.js"
import {
  PREVIEW_SIGNALS,
  PREVIEW_STATES,
  isPreviewDatabasePath,
  previewFaceBox,
} from "../../scripts/dev/preview-fixtures.js"
import {
  createPreviewServer,
  isSwappedPhoto,
  lanAddress,
  parseControlPath,
  previewCookies,
  renderSwitcher,
} from "../../scripts/dev/preview-states.js"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..")
const SEEDER = path.join(REPO_ROOT, "scripts", "dev", "preview-fixtures.js")
const TEST_ROOT = path.join(REPO_ROOT, "tmp", "states", `.test-${process.pid}`)

/** @param {string} state @param {string} databasePath */
function seed(state, databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  return spawnSync(process.execPath, ["--no-warnings", SEEDER, state], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_PATH: databasePath },
    encoding: "utf8",
  })
}

/** @param {string} state @param {string} query */
function queryState(state, query) {
  const db = new DatabaseSync(path.join(TEST_ROOT, state, "wedding.db"), { readOnly: true })
  const rows = db.prepare(query).all().map((row) => ({ ...row }))
  db.close()
  return rows
}

after(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }))

describe("the seeder's safety rail", () => {
  it("accepts only paths strictly inside tmp/states", () => {
    assert.equal(isPreviewDatabasePath(path.join(REPO_ROOT, "tmp/states/a/wedding.db")), true)
    for (const bad of [
      path.join(REPO_ROOT, "data/wedding.db"),
      path.join(REPO_ROOT, "tmp/smoke.db"),
      path.join(REPO_ROOT, "tmp/states/../smoke.db"),
      path.join(REPO_ROOT, "tmp/states"),
      "",
    ]) {
      assert.equal(isPreviewDatabasePath(bad), false, bad)
    }
  })

  it("refuses to run against any other database, and creates nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-refuse-"))
    const target = path.join(dir, "wedding.db")
    const result = seed("sparse", target)
    assert.notEqual(result.status, 0)
    assert.equal(result.stderr.includes("tmp/states"), true)
    assert.equal(fs.existsSync(target), false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("refuses an unknown state", () => {
    const result = seed("nope", path.join(TEST_ROOT, "nope", "wedding.db"))
    assert.notEqual(result.status, 0)
  })
})

describe("fixture geometry", () => {
  it("routes each signal shape to the state it is named for", () => {
    const cutoffs = routeCutoffs()
    for (const [state, signals] of Object.entries(PREVIEW_SIGNALS)) {
      assert.equal(routeFace(signals, cutoffs).state, state)
    }
  })

  it("keeps every face box inside its image", () => {
    const sizes = { landscape: [1600, 1067], portrait: [1067, 1600], square: [1200, 1200] }
    for (const [orientation, [width, height]] of Object.entries(sizes)) {
      for (const slot of [0, 1, 2]) {
        const box = previewFaceBox(/** @type {"square"} */ (orientation), slot)
        assert.equal(box.x >= 0 && box.x + box.w <= width, true)
        assert.equal(box.y >= 0 && box.y + box.h <= height, true)
        assert.equal(box.landmarks?.length, 10)
      }
    }
  })
})

describe("seeded states", () => {
  /** @param {string} state */
  const build = (state) => {
    const result = seed(state, path.join(TEST_ROOT, state, "wedding.db"))
    assert.equal(result.status, 0, result.stderr)
  }

  it("leaves fresh empty, but with an admin who can log in", () => {
    build("fresh")
    assert.deepEqual(queryState("fresh", "SELECT count(*) n FROM media"), [{ n: 0 }])
    assert.deepEqual(queryState("fresh", "SELECT count(*) n FROM guests"), [{ n: 0 }])
    assert.deepEqual(queryState("fresh", "SELECT key FROM app_state WHERE key = 'admin_hash'"), [
      { key: "admin_hash" },
    ])
  })

  it("stores decodable images, not stubs", () => {
    build("sparse")
    const [{ file_key: key }] = queryState("sparse", "SELECT file_key FROM media LIMIT 1")
    const file = path.join(
      TEST_ROOT,
      "sparse",
      "uploads",
      "media",
      String(key).slice(0, 2),
      String(key),
      "thumb.jpg",
    )
    assert.deepEqual([...fs.readFileSync(file).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  })

  it("leaves faces-half with work still to do, recorded through the ledger", () => {
    build("faces-half")
    const [{ open }] = queryState(
      "faces-half",
      "SELECT count(*) open FROM media_faces WHERE deleted_at IS NULL AND face_identity_id IS NULL",
    )
    const [{ named }] = queryState(
      "faces-half",
      "SELECT count(*) named FROM media_faces WHERE face_identity_id IS NOT NULL",
    )
    assert.equal(Number(open) > 0, true)
    assert.equal(Number(named) > 0, true)
    const [{ revoked }] = queryState(
      "faces-half",
      "SELECT count(*) revoked FROM face_assignment_batches WHERE revoked_at IS NOT NULL",
    )
    assert.equal(revoked, 1)
  })

  it("names everyone in faces-named except the deliberately unmatched", () => {
    build("faces-named")
    const states = queryState(
      "faces-named",
      `SELECT count(*) n FROM media_faces f JOIN media m ON m.id = f.media_id
        WHERE f.deleted_at IS NULL AND f.face_identity_id IS NOT NULL`,
    )
    assert.equal(Number(states[0].n) > 0, true)
  })

  it("puts a card in every state and offers links to some", () => {
    build("cards")
    const statuses = queryState("cards", "SELECT DISTINCT status FROM thank_you_cards").map(
      (row) => row.status,
    )
    assert.deepEqual(statuses.sort(), ["draft", "sent", "viewed"])
    const [{ replied }] = queryState(
      "cards",
      "SELECT count(*) replied FROM thank_you_cards WHERE replied_at IS NOT NULL",
    )
    assert.equal(Number(replied) > 0, true)
    const links = JSON.parse(fs.readFileSync(path.join(TEST_ROOT, "cards", "links.json"), "utf8"))
    assert.equal(links.length, 3)
  })

  it("hides most of Official in culled, faces and a video included", () => {
    build("culled")
    assert.equal(PREVIEW_STATES.culled.title, "Culled import")
    const count = (/** @type {string} */ where) =>
      Number(queryState("culled", `SELECT count(*) n FROM media WHERE ${where}`)[0].n)
    const hidden = count("section = 'official' AND status = 'hidden'")
    const visible = count("section = 'official' AND status = 'approved'")
    assert.equal(visible > 0, true)
    assert.equal(hidden > visible * 2, true, "most of the section is hidden")
    assert.equal(count("section = 'official' AND status = 'hidden' AND kind = 'video'"), 1)
    const onHidden = queryState(
      "culled",
      `SELECT count(*) n, sum(f.face_identity_id IS NOT NULL) named FROM media_faces f
        JOIN media m ON m.id = f.media_id
        WHERE m.status = 'hidden' AND f.deleted_at IS NULL`,
    )[0]
    assert.equal(Number(onHidden.n) > 10, true, "hidden photos have faces")
    assert.equal(Number(onHidden.named) > 0, true, "some of them already named")
    assert.equal(count("section = 'guest' AND status = 'approved'") > 0, true)
  })

  it("reaches the limits in long-text without tripping a database constraint", () => {
    build("long-text")
    const [{ longest }] = queryState(
      "long-text",
      "SELECT max(length(message)) longest FROM guestbook_entries",
    )
    assert.equal(longest, 2000)
  })
})

describe("the control routes", () => {
  it("leaves ordinary paths for the real server", () => {
    assert.equal(parseControlPath("/"), null)
    assert.equal(parseControlPath("/admin/faces"), null)
    assert.equal(parseControlPath("/__statesish"), null)
  })

  it("parses a switch and a reset", () => {
    assert.deepEqual(parseControlPath("/__states"), { action: "list" })
    assert.deepEqual(parseControlPath("/__states/go/lots?to=%2Fgallery"), {
      action: "go",
      state: "lots",
      to: "/gallery",
      view: "admin",
    })
    assert.deepEqual(parseControlPath("/__states/reset/cards"), {
      action: "reset",
      state: "cards",
      to: "/",
      view: "admin",
    })
  })

  it("accepts only known views, falling back to admin", () => {
    for (const view of ["visitor", "guest", "admin"]) {
      const control = parseControlPath(`/__states/go/fresh?view=${view}`)
      assert.equal(control && "view" in control ? control.view : "", view)
    }
    const crafted = parseControlPath("/__states/go/fresh?view=root")
    assert.equal(crafted && "view" in crafted ? crafted.view : "", "admin")
  })

  it("never turns a crafted name into a path", () => {
    for (const bad of ["/__states/go/..%2F..%2Fdata", "/__states/go/__proto__", "/__states/go/"]) {
      assert.deepEqual(parseControlPath(bad), { action: "list" }, bad)
    }
  })

  it("keeps an ordinary local path, query and all", () => {
    const control = parseControlPath("/__states/go/fresh?to=" + encodeURIComponent("/gallery?x=1#a"))
    assert.equal(control && "to" in control ? control.to : "", "/gallery?x=1#a")
  })

  it("never redirects off-site", () => {
    const crafted = [
      "//evil.example",
      "/\\evil.example",
      "/ok\\path",
      "/a\r\nSet-Cookie: x=1",
      "/a\nb",
      "/a\x00b",
      "/a\x7fb",
      "https://evil.example",
      "evil",
    ]
    for (const to of crafted) {
      const control = parseControlPath(`/__states/go/fresh?to=${encodeURIComponent(to)}`)
      assert.equal(control && "to" in control ? control.to : "", "/", to)
    }
  })

  it("lists every state, and escapes what it interpolates", () => {
    const page = renderSwitcher("fresh", (state) =>
      state === "cards" ? [{ label: "<b>x</b>", url: "http://localhost/thanks?card=A" }] : [],
    )
    for (const info of Object.values(PREVIEW_STATES)) {
      assert.equal(page.includes(info.title), true)
    }
    assert.equal(page.includes("<b>x</b>"), false)
    assert.equal(page.includes("&lt;b&gt;x&lt;/b&gt;"), true)
  })
})

describe("the address for --lan", () => {
  it("skips loopback and IPv6", () => {
    const address = lanAddress({
      lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
      en0: [
        { family: "IPv6", internal: false, address: "fe80::1" },
        { family: "IPv4", internal: false, address: "192.0.2.7" },
      ],
    })
    assert.equal(address, "192.0.2.7")
  })

  it("reports having no network rather than guessing", () => {
    assert.equal(lanAddress({ lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }] }), null)
  })
})

describe("the real photograph", () => {
  it("covers every variant of it in public/images", () => {
    const variants = fs
      .readdirSync(path.join(REPO_ROOT, "public", "images"))
      .filter((name) => name === "us.webp" || name.startsWith("us-"))
    assert.equal(variants.length > 0, true)
    for (const name of variants) assert.equal(isSwappedPhoto(`/images/${name}`), true, name)
    assert.equal(isSwappedPhoto("/images/us.webp?v=2"), true)
  })

  it("leaves other images and pages alone", () => {
    for (const urlPath of ["/images/top-mobile.webp", "/", "/media/us.webp"]) {
      assert.equal(isSwappedPhoto(urlPath), false, urlPath)
    }
  })
})

describe("the cookies for a view", () => {
  const live = (/** @type {string[]} */ cookies) =>
    cookies.filter((cookie) => !cookie.includes("Max-Age=0")).map((cookie) => cookie.split("=")[0])
  const expired = (/** @type {string[]} */ cookies) =>
    cookies.filter((cookie) => cookie.includes("Max-Age=0")).map((cookie) => cookie.split("=")[0])

  it("signs a visitor out of everything", () => {
    const cookies = previewCookies("typical", "visitor", [])
    assert.deepEqual(live(cookies), ["preview__typical__visitor"])
    for (const name of ["session", "csrf", "guest_session", "guest_csrf"]) {
      assert.equal(expired(cookies).includes(name), true, name)
    }
  })

  it("keeps the session it was given and drops the other kind", () => {
    const cookies = previewCookies("cards", "guest", ["guest_session=a; Path=/", "guest_csrf=b; Path=/"])
    assert.deepEqual(live(cookies), ["guest_session", "guest_csrf", "preview__cards__guest"])
    assert.equal(expired(cookies).includes("session"), true)
    assert.equal(expired(cookies).includes("csrf"), true)
    assert.equal(expired(cookies).includes("guest_session"), false)
  })

  it("expires every other state's marker, so an issue names exactly one", () => {
    const cookies = previewCookies("cards", "admin", [])
    const markers = live(cookies).filter((name) => name.startsWith("preview__"))
    assert.deepEqual(markers, ["preview__cards__admin"])
    assert.equal(expired(cookies).includes("preview__fresh__guest"), true)
    assert.equal(expired(cookies).includes("preview__cards__admin"), false)
  })
})

describe("the switcher end to end", () => {
  /**
   * @param {number} port
   * @param {string} urlPath
   * @param {string} [cookie]
   * @returns {Promise<{
   *   status: number, location: string, cookies: string[], body: string, contentType: string,
   * }>}
   */
  const get = (port, urlPath, cookie) =>
    new Promise((resolve, reject) => {
      const headers = cookie ? { cookie } : {}
      const req = http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
        let body = ""
        res.on("data", (chunk) => {
          body += chunk
        })
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            location: String(res.headers.location ?? ""),
            cookies: res.headers["set-cookie"] ?? [],
            body,
            contentType: String(res.headers["content-type"] ?? ""),
          })
        })
      })
      req.on("error", reject)
    })

  it("builds, serves, logs in, and stops its own server", { timeout: 60000 }, async () => {
    const root = path.join(TEST_ROOT, "switch")
    const backendPort = 3198
    const server = createPreviewServer({ root, backendPort, publicUrl: "http://localhost:1" })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)))
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0

    try {
      const before = await get(port, "/api/health")
      assert.equal(before.status, 302)
      assert.equal(before.location, "/__states")

      const switched = await get(port, "/__states/go/fresh?to=%2Fadmin")
      assert.equal(switched.status, 302, switched.body)
      assert.equal(switched.location, "/admin")
      assert.equal(switched.cookies.length > 0, true)

      const health = await get(port, "/api/health")
      assert.equal(health.status, 200)
      assert.equal((await get(port, "/__states")).body.includes("(current)"), true)

      const photo = await get(port, "/images/us.webp")
      assert.equal(photo.status, 200)
      assert.equal(photo.contentType, "image/png")

      const guest = await get(port, "/__states/go/fresh?view=guest&to=%2Fgallery")
      assert.equal(guest.status, 302, guest.body)
      const guestCookie = guest.cookies.find((cookie) => cookie.startsWith("guest_session=") )
      const token = String(guestCookie).split(";")[0]
      const me = await get(port, "/api/account/me", token)
      assert.equal(JSON.parse(me.body).account?.name, "Preview Guest")

      const visitor = await get(port, "/__states/go/fresh?view=visitor&to=%2F")
      assert.equal(
        visitor.cookies.some((cookie) => cookie.startsWith("session=") && !cookie.includes("Max-Age=0")),
        false,
      )
    } finally {
      server.close()
      server.closeAllConnections()
    }

    let stopped = false
    for (let i = 0; i < 40 && !stopped; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      stopped = await new Promise((resolve) => {
        const probe = http.get({ host: "127.0.0.1", port: backendPort, path: "/" }, (res) => {
          res.resume()
          resolve(false)
        })
        probe.on("error", () => resolve(true))
      })
    }
    assert.equal(stopped, true)
  })
})
