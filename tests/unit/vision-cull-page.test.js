/** @file Browser test: the real culling page, in headless Chrome, over file://.
 *
 *  The page is built by cull-data.js from a synthetic directory: magic-byte stubs
 *  from tests/media-fixtures.js, which no browser can even decode. No photograph is
 *  involved. Each tab is driven by the keys the owner presses, and the selection
 *  file is read from the page's own Download path.
 *
 *  Skipped wherever Chrome cannot be run, because Chrome is a dev-machine binary.
 *  It is probed by trying to run it (CLAUDE.md), and the skip reason says so.
 */
/** @import * as Types from '../../scripts/vision/types.js' */

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, beforeEach, describe, test } from "node:test"
import { pathToFileURL } from "node:url"

import { chromeCandidates, connect, readDebugPort, startChrome } from "../../scripts/dev/cdp.js"
import { runCullData } from "../../scripts/vision/cull-data.js"
import { CULL_DEFAULTS } from "../../scripts/vision/cull-logic.js"
import { makeJpeg, makeMov, makeMp4, makePng } from "../media-fixtures.js"

/** @returns {string | null} why Chrome cannot run here, or null */
function whyNot() {
  for (const binary of chromeCandidates(null, process.env.CHROME)) {
    const probe = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 20000 })
    if (!probe.error && probe.status === 0) return null
  }
  return "no Chrome could be run"
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** @typedef {Awaited<ReturnType<typeof connect>>} Connection */
/** @typedef {{ id: string, page: Connection, errors: string[] }} Tab */

const reason = whyNot()

describe("cull.html in headless Chrome", { skip: reason ?? false }, () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cull-page-"))
  const library = path.join(scratch, "library")
  const day1 = path.join(library, "day1")
  const day2 = path.join(library, "day2")
  // Outside every repository, under a directory named tmp: what the output rule asks.
  const outDir = path.join(scratch, "tmp", "cull")
  const pageUrl = pathToFileURL(path.join(outDir, "cull.html")).href
  const profile = path.join(scratch, "profile")
  const blankPage = path.join(scratch, "blank.html")
  fs.writeFileSync(blankPage, "<!doctype html><title>blank</title>")

  /** @type {import('node:child_process').ChildProcess} */
  let chrome
  /** @type {number} */
  let port
  /** @type {Tab[]} */
  const open = []

  fs.mkdirSync(day1, { recursive: true })
  fs.mkdirSync(day2, { recursive: true })
  fs.writeFileSync(path.join(day1, "IMG_0001.jpg"), makeJpeg(201))
  fs.writeFileSync(path.join(day1, "IMG_0002.jpg"), makeJpeg(202))
  // An edited export and the Live Photo clip that kept the original's name.
  fs.writeFileSync(path.join(day1, "IMG_E0003.jpg"), makeJpeg(203))
  fs.writeFileSync(path.join(day1, "IMG_0003.mov"), makeMov(301))
  fs.writeFileSync(path.join(day1, "clip.mp4"), makeMp4(302))
  fs.writeFileSync(path.join(day2, "extra.png"), makePng(401))
  fs.writeFileSync(path.join(day2, "party.mp4"), makeMp4(402))

  /** @param {string} dir */
  async function build(dir) {
    const args = { dir, outDir, labels: null, identities: null, run: null, defaults: CULL_DEFAULTS }
    return (await runCullData(args, { log: () => {} })).data
  }

  /**
   * @param {Tab} tab
   * @param {string} expression
   * @returns {Promise<any>}
   */
  async function evaluate(tab, expression) {
    const reply = await tab.page.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    const details = reply.result.exceptionDetails
    if (details) throw new Error(details.exception?.description ?? details.text)
    return reply.result.result.value
  }

  /** @param {Tab} tab @param {string} [url] */
  async function navigate(tab, url = pageUrl) {
    const loaded = new Promise((resolve) => {
      tab.page.onEvent((method, params) => {
        if (method === "Page.loadEventFired") resolve(true)
        if (method === "Runtime.exceptionThrown") {
          const details = params.exceptionDetails
          tab.errors.push(details.exception?.description ?? details.text)
        }
      })
    })
    await tab.page.send("Page.navigate", { url })
    await loaded
  }

  /** @param {string} [url] @returns {Promise<Tab>} */
  async function openTab(url = pageUrl) {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
    const target = /** @type {{ id: string, webSocketDebuggerUrl: string }} */ (await res.json())
    const tab = { id: target.id, page: await connect(target.webSocketDebuggerUrl), errors: [] }
    await tab.page.send("Page.enable")
    await tab.page.send("Runtime.enable")
    await tab.page.send("Page.setDownloadBehavior", { behavior: "deny" })
    await navigate(tab, url)
    open.push(tab)
    return tab
  }

  /** @param {Tab} tab @param {string} key */
  const press = (tab, key) =>
    evaluate(
      tab,
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)} }))`,
    )

  /** @param {Tab} tab @param {string} id @returns {Promise<string>} */
  const text = (tab, id) =>
    evaluate(tab, `document.getElementById(${JSON.stringify(id)}).textContent`)

  /** Saves now, as the page does when a tab is hidden. @param {Tab} tab */
  const flush = (tab) => evaluate(tab, `dispatchEvent(new Event("pagehide"))`)

  /**
   * @typedef {object} Counts
   * @property {number} visible
   * @property {number} hidden
   * @property {number} undecided
   * @property {string} videos
   * @property {string} reviewed
   * @property {string} saved
   */
  /** @param {Tab} tab @returns {Promise<Counts>} */
  const counts = (tab) =>
    evaluate(
      tab,
      `({
        visible: Number(document.getElementById("nVisible").textContent),
        hidden: Number(document.getElementById("nHidden").textContent),
        undecided: Number(document.getElementById("nUndecided").textContent),
        videos: document.getElementById("undecidedVideos").hidden
          ? "" : document.getElementById("undecidedVideos").textContent,
        reviewed: document.getElementById("reviewed").textContent,
        saved: document.getElementById("saved").textContent,
      })`,
    )

  /**
   * The bytes the Download button would save, caught on their way to the blob URL.
   * @param {Tab} tab
   * @returns {Promise<Types.CullSelection>}
   */
  const exported = (tab) =>
    evaluate(
      tab,
      `(async () => {
        let blob = null
        const original = URL.createObjectURL
        URL.createObjectURL = (b) => { blob = b; return original.call(URL, b) }
        try {
          document.getElementById("btnDownload").click()
        } finally {
          URL.createObjectURL = original
        }
        return JSON.parse(await blob.text())
      })()`,
    )

  /**
   * @param {() => Promise<boolean>} check
   * @param {string} what
   */
  async function until(check, what) {
    for (let i = 0; i < 200; i++) {
      if (await check()) return
      await sleep(100)
    }
    assert.fail(`timed out waiting for ${what}`)
  }

  /** @param {Types.CullPageData} data @param {string} rel */
  const shaOf = (data, rel) => {
    const item = data.items.find((i) => i.rel === rel)
    assert.ok(item, rel)
    return item.sha
  }

  before(async () => {
    await build(day1)
    fs.mkdirSync(profile)
    chrome = await startChrome(chromeCandidates(null, process.env.CHROME), profile)
    // Each attempt waits several seconds. A loaded machine can need more than one.
    for (let attempt = 1; ; attempt++) {
      try {
        port = await readDebugPort(profile)
        break
      } catch (err) {
        if (attempt === 6) throw err
      }
    }
  })

  /** Closes every tab, and waits until they are gone: closing one saves it. */
  async function closeAll() {
    const ids = new Set()
    for (const tab of open.splice(0)) {
      assert.deepEqual(tab.errors, [], "no uncaught errors on the page")
      ids.add(tab.id)
      tab.page.close()
      await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`)
    }
    await until(async () => {
      const list = /** @type {Array<{ id: string }>} */ (
        await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      )
      return !list.some((target) => ids.has(target.id))
    }, "closed tabs to go")
  }

  beforeEach(async () => {
    await closeAll()
    await build(day1)
    // Every test starts with nothing saved: a fresh browser, as far as the page knows.
    // Cleared from a plain file:// page, the same origin: a cull page would save its
    // decisions straight back as it closed.
    const blank = await openTab(pathToFileURL(blankPage).href)
    await evaluate(blank, "localStorage.clear()")
    await closeAll()
  })

  after(async () => {
    if (port) await closeAll()
    if (chrome) {
      const exited = new Promise((resolve) => chrome.once("exit", resolve))
      chrome.kill()
      await Promise.race([exited, sleep(3000)])
    }
    fs.rmSync(scratch, { recursive: true, force: true })
  })

  test("deciding nothing exports nothing: every photo and every video stays hidden", async () => {
    const tab = await openTab()
    const now = await counts(tab)
    assert.equal(now.visible, 0)
    assert.equal(now.undecided, 5, "three photos and two videos, all undecided")
    assert.equal(now.videos, "2 videos undecided", "the header counts undecided videos")
    assert.equal(now.saved, "0 restored", "a fresh browser says so, not a silent zero")
    assert.deepEqual(await exported(tab), { version: 1, visible: [] })

    await press(tab, "e")
    const dialog = await text(tab, "exportBody")
    assert.ok(dialog.includes("2 video(s) are still undecided"), dialog)
    assert.deepEqual(tab.errors, [])
  })

  test("the video counter leads to every video, and only a kept one is exported", async () => {
    const data = await build(day1)
    const tab = await openTab()
    await evaluate(tab, `document.getElementById("undecidedVideos").click()`)
    const on = await evaluate(tab, `document.getElementById("videos").classList.contains("on")`)
    assert.equal(on, true)
    const cards = await evaluate(tab, `document.querySelectorAll("#videoCards .card").length`)
    assert.equal(cards, 2)
    const shown = await text(tab, "videos")
    assert.ok(!shown.includes("null"), "no stray text where an optional part is absent")
    const live = await evaluate(
      tab,
      `Array.from(document.querySelectorAll("#videoCards .card"))
        .filter((card) => card.textContent.includes("Live Photo clip?"))
        .map((card) => card.querySelector(".meta div").textContent)`,
    )
    assert.deepEqual(live, ["IMG_0003.mov"], "the clip beside IMG_E0003.jpg is labelled only")
    assert.equal(
      await evaluate(tab, `document.getElementById("btnLiveClips") !== null`),
      true,
      "and can be hidden in one keypress",
    )

    const first = await evaluate(
      tab,
      `document.querySelector("#videoCards .card.on .meta div").textContent`,
    )
    await press(tab, " ")
    assert.equal((await counts(tab)).videos, "1 video undecided")
    // In "only undecided", the kept one leaves the list and the next is under the cursor.
    await press(tab, "x")
    assert.equal((await counts(tab)).videos, "", "nothing left undecided, so the counter goes")
    assert.deepEqual((await exported(tab)).visible, [shaOf(data, first)])
  })

  test("two tabs: a stale tab never writes over a newer decision", async () => {
    const data = await build(day1)
    const a = await openTab()
    const b = await openTab()
    const firstPick = data.items[data.groups[0].pick].sha

    // A decides and saves. B loaded before that, and saves afterwards.
    await press(a, " ")
    await flush(a)
    await until(async () => (await counts(b)).visible === 1, "B to hear of A's keep")
    await flush(b)
    assert.deepEqual((await exported(a)).visible, [firstPick])
    assert.deepEqual((await exported(b)).visible, [firstPick])

    // The same item decided again, later, in B. A, now stale, saves and must not revert it.
    await press(b, "x")
    await flush(b)
    await until(async () => (await counts(a)).visible === 0, "A to hear of B's hide")
    // A's own undo would put back A's older keep. It was dropped when B's hide arrived.
    await press(a, "u")
    await flush(a)
    const stored = await evaluate(a, `JSON.parse(localStorage.getItem("cull:v2")).log`)
    assert.equal(stored[firstPick][0], "hide")
    assert.deepEqual((await exported(a)).visible, [])

    // An undo in the tab that made the decision is a newer decision, and reaches both.
    await press(b, "u")
    await flush(b)
    await until(async () => (await counts(a)).visible === 1, "A to hear of B's undo")
    await flush(a)
    assert.deepEqual((await exported(a)).visible, [firstPick])
    assert.deepEqual((await exported(b)).visible, [firstPick])
  })

  test("re-scoring from a parent directory keeps every decision", async () => {
    const before = await build(day1)
    const tab = await openTab()
    await press(tab, "Enter")
    await press(tab, "Enter")
    await flush(tab)
    const kept = (await exported(tab)).visible
    assert.equal(kept.length, 2)

    const after = await build(library)
    assert.notEqual(after.rootId, before.rootId, "another root: the old key would differ")
    await navigate(tab)
    const now = await counts(tab)
    assert.equal(now.visible, 2)
    assert.equal(now.saved, "2 restored")
    assert.deepEqual((await exported(tab)).visible, kept)
  })

  test("decisions saved by the previous version of the page are brought over", async () => {
    const data = await build(day1)
    const tab = await openTab()
    const keep = shaOf(data, "IMG_0001.jpg")
    const hide = shaOf(data, "IMG_0002.jpg")
    // One store under this directory's key and one under another root's: both count.
    // This is the shape the first version wrote: { decisions, cursor, frame }.
    /** @param {string} sha @param {string} d */
    const oldStore = (sha, d) => JSON.stringify({ decisions: { [sha]: d }, cursor: null, frame: 0 })
    await evaluate(
      tab,
      `localStorage.setItem(${JSON.stringify("cull:v1:" + data.rootId)}, ${JSON.stringify(oldStore(keep, "keep"))});
       localStorage.setItem("cull:v1:0123456789abcdef", ${JSON.stringify(oldStore(hide, "hide"))})`,
    )
    await navigate(tab)
    const now = await counts(tab)
    assert.equal(now.visible, 1)
    assert.equal(now.hidden, 1)
    assert.deepEqual((await exported(tab)).visible, [keep])
    const kept = await evaluate(tab, `localStorage.getItem("cull:v1:${data.rootId}") !== null`)
    assert.equal(kept, true, "the old store is left where it was")
    const log = await evaluate(tab, `JSON.parse(localStorage.getItem("cull:v2")).log`)
    assert.deepEqual(log[keep], ["keep", 0])
    assert.deepEqual(log[hide], ["hide", 0])
  })

  test("loading a selection sets exactly what the file says, and u undoes it", async () => {
    const data = await build(day1)
    const tab = await openTab()
    // Kept before the load, and not in the file: the file wins.
    await press(tab, " ")
    const before = (await exported(tab)).visible
    assert.equal(before.length, 1)

    const listed = [shaOf(data, "IMG_0002.jpg"), shaOf(data, "clip.mp4")].sort()
    assert.ok(!listed.includes(before[0]))
    const file = path.join(scratch, "selection.json")
    fs.writeFileSync(file, JSON.stringify({ version: 1, visible: listed }))

    await evaluate(tab, `window.confirm = () => true`)
    const { root } = await tab.page.send("DOM.getDocument").then((r) => r.result)
    const { nodeId } = await tab.page
      .send("DOM.querySelector", { nodeId: root.nodeId, selector: "#loadFile" })
      .then((r) => r.result)
    await tab.page.send("DOM.setFileInputFiles", { nodeId, files: [file] })
    await until(async () => (await text(tab, "exportNote")).startsWith("Loaded"), "the load")

    const now = await counts(tab)
    assert.deepEqual([now.visible, now.hidden, now.undecided], [2, 3, 0])
    assert.equal(now.reviewed, "3 of 3 groups", "a rejected group comes back reviewed")
    assert.deepEqual((await exported(tab)).visible, listed)

    await press(tab, "u")
    assert.deepEqual((await exported(tab)).visible, before)
  })
})
