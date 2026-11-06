/** @file Unit test: Gallery → Sort's pure rules (public/pages/admin/sort-moments.js):
 *  capture-time parsing, moments, the session's queue, progress and the next
 *  moment to show. Imports a browser module, so it is excluded from the server
 *  tsconfig. */

import { describe, it } from "node:test"
import assert from "node:assert"

import {
  SORT_DEFAULTS,
  captureTimeMs,
  groupMoments,
  isSortable,
  sortState,
  buildSortQueue,
  sortProgress,
  nextOpenMoment,
  momentLabel,
} from "../../public/pages/admin/sort-moments.js"
import { parseCapturedAt } from "../../core/capture-time.js"
import { capturedAtToMs } from "../../scripts/vision/session1.js"
import { wallClockFromMs } from "../../scripts/vision/ingest-faces.js"

const BASE = Date.UTC(2026, 5, 20, 17, 0, 0)

/** A capture time `s` seconds after BASE, in the ISO form the face ingest stores.
 *  @param {number} s */
function at(s) {
  return new Date(BASE + s * 1000).toISOString()
}

/**
 * @param {number} id
 * @param {{ status?: string, captured?: string | null, decided?: string | null }} [o]
 */
function row(id, o = {}) {
  return {
    id,
    status: o.status ?? "hidden",
    captured_at: o.captured === undefined ? null : o.captured,
    decided_at: o.decided ?? null,
  }
}

describe("captureTimeMs", () => {
  it("reads the three stored forms as the same instant", () => {
    const want = Date.UTC(2026, 5, 20, 17, 3, 12)
    assert.strictEqual(captureTimeMs("2026-06-20T17:03:12.000Z"), want)
    assert.strictEqual(captureTimeMs("2026-06-20 17:03:12"), want)
    assert.strictEqual(captureTimeMs("2026:06:20 17:03:12"), want)
  })

  it("reads an uploaded photo and a face-ingested one in one format, one moment", () => {
    // An upload or the importer stores the EXIF string as checked here; the face
    // ingest goes through session1's local-time ms and back. Same form, so the
    // twin scan's equality and Sort's differences both hold across writers.
    const uploaded = parseCapturedAt("2026-06-20 17:03:12")
    const ingested = wallClockFromMs(Number(capturedAtToMs("2026-06-20 17:03:14")))
    assert.strictEqual(uploaded, "2026-06-20 17:03:12")
    assert.strictEqual(ingested, "2026-06-20 17:03:14")
    assert.strictEqual(parseCapturedAt(ingested), ingested)
    const moments = groupMoments([
      { id: 1, t: captureTimeMs(uploaded) },
      { id: 2, t: captureTimeMs(ingested) },
    ])
    assert.deepStrictEqual(moments.map((m) => m.ids), [[1, 2]])
    assert.strictEqual(moments[0].spanMs, 2000)
  })

  it("keeps sub-seconds, because a burst is several frames in one second", () => {
    assert.strictEqual(
      Number(captureTimeMs("2026-06-20T17:03:12.250Z")) - Number(captureTimeMs("2026-06-20T17:03:12Z")),
      250,
    )
  })

  it("honours a stated zone", () => {
    assert.strictEqual(
      captureTimeMs("2026-06-20T19:03:12+02:00"),
      captureTimeMs("2026-06-20T17:03:12Z"),
    )
    assert.strictEqual(
      captureTimeMs("2026-06-20T12:03:12-0500"),
      captureTimeMs("2026-06-20T17:03:12Z"),
    )
  })

  it("is null for anything that isn't a usable time", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "yesterday",
      "2026-06-20",
      "0000:00:00 00:00:00",
      "2026-13-01 00:00:00",
      "2026-06-20 25:00:00",
      "2026-06-2x 10:00:00",
      "2026-06-20 10:00",
      "2026-06-20T10:00:00+xx:00",
    ]) {
      assert.strictEqual(captureTimeMs(bad), null, String(bad))
    }
  })
})

describe("groupMoments", () => {
  it("joins shots a few seconds apart and splits at a longer pause", () => {
    const moments = groupMoments([
      { id: 1, t: BASE },
      { id: 2, t: BASE + 2000 },
      { id: 3, t: BASE + 9000 },
      { id: 4, t: BASE + 9000 + SORT_DEFAULTS.gapMs + 1 },
    ])
    assert.deepStrictEqual(
      moments.map((m) => m.ids),
      [[1, 2, 3], [4]],
    )
    assert.strictEqual(moments[0].spanMs, 9000)
    assert.strictEqual(moments[1].spanMs, null)
  })

  it("never merges a photo with no capture time", () => {
    const moments = groupMoments([
      { id: 1, t: BASE },
      { id: 2, t: null },
      { id: 3, t: BASE + 1000 },
      { id: 4, t: null },
    ])
    assert.deepStrictEqual(
      moments.map((m) => m.ids),
      [[1, 3], [2], [4]],
    )
  })

  it("stops a moment growing past its span or its photo limit", () => {
    // One shot every 5 seconds for two minutes: a chain the gap alone would never break.
    const chain = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, t: BASE + i * 5000 }))
    const bySpan = groupMoments(chain, { gapMs: 10000, spanMs: 30000, maxPhotos: 100 })
    assert.deepStrictEqual(
      bySpan.map((m) => m.ids.length),
      [7, 7, 7, 4],
    )
    const byCount = groupMoments(chain, { gapMs: 10000, spanMs: 1e9, maxPhotos: 8 })
    assert.deepStrictEqual(
      byCount.map((m) => m.ids.length),
      [8, 8, 8, 1],
    )
  })

  it("orders members by time and moments by the gallery's order", () => {
    // Gallery order: 10, 11, 12, 13. Capture order: 13, 11 | 12, 10.
    const moments = groupMoments([
      { id: 10, t: BASE + 600000 },
      { id: 11, t: BASE + 1000 },
      { id: 12, t: BASE + 599000 },
      { id: 13, t: BASE },
    ])
    assert.deepStrictEqual(
      moments.map((m) => m.ids),
      [
        [12, 10],
        [13, 11],
      ],
    )
  })

  it("keeps the gallery's order for shots taken at the same instant, and is repeatable", () => {
    const photos = [
      { id: 5, t: BASE },
      { id: 3, t: BASE },
      { id: 9, t: BASE },
    ]
    assert.deepStrictEqual(groupMoments(photos)[0].ids, [5, 3, 9])
    assert.deepStrictEqual(groupMoments(photos), groupMoments(photos.slice()))
  })

  it("makes nothing from nothing", () => {
    assert.deepStrictEqual(groupMoments([]), [])
  })
})

describe("sortState and isSortable", () => {
  it("names where a photo stands", () => {
    assert.strictEqual(sortState(row(1)), "undecided")
    assert.strictEqual(sortState(row(1, { status: "pending" })), "undecided")
    assert.strictEqual(sortState(row(1, { decided: "x" })), "kept-hidden")
    assert.strictEqual(sortState(row(1, { status: "approved", decided: "x" })), "shown")
    assert.strictEqual(sortState(row(1, { status: "approved" })), "on-site")
  })

  it("leaves rejected and uploading rows out", () => {
    assert.strictEqual(isSortable({ status: "rejected" }), false)
    assert.strictEqual(isSortable({ status: "uploading" }), false)
    assert.strictEqual(isSortable({ status: "hidden" }), true)
  })
})

describe("buildSortQueue", () => {
  it("is for hidden photos nobody has decided, in moments that show their on-site siblings", () => {
    const rows = [
      row(1, { status: "approved", captured: at(0) }), // the burst's frame already on the site
      row(2, { captured: at(1) }),
      row(3, { captured: at(2) }),
      row(4, { captured: at(300), decided: "x" }), // kept hidden earlier: not this session
      row(5, { status: "approved", captured: at(600) }), // a moment with nothing to decide
      row(6), // no capture time: alone
      row(7, { status: "rejected", captured: at(1) }), // never shown
    ]
    const queue = buildSortQueue(rows)
    assert.deepStrictEqual(queue.ids, [2, 3, 6])
    assert.deepStrictEqual(
      queue.moments.map((m) => m.ids),
      [[1, 2, 3], [6]],
    )
  })

  it("looks again at the kept-hidden ones when asked", () => {
    const rows = [row(1, { decided: "x" }), row(2, { status: "approved", decided: "x" }), row(3)]
    assert.deepStrictEqual(buildSortQueue(rows, { again: true }).ids, [1, 3])
    assert.deepStrictEqual(buildSortQueue(rows).ids, [3])
  })

  it("is empty when nothing is hidden", () => {
    const queue = buildSortQueue([row(1, { status: "approved" }), row(2, { status: "rejected" })])
    assert.deepStrictEqual(queue, { moments: [], ids: [] })
  })
})

describe("sortProgress", () => {
  it("counts what is left, shown and kept hidden, and nothing Sort never asked about", () => {
    const progress = sortProgress([
      row(1),
      row(2, { status: "pending" }),
      row(3, { status: "approved", decided: "x" }),
      row(4, { decided: "x" }),
      row(5, { decided: "x" }),
      row(6, { status: "approved" }), // uploaded straight onto the site
      row(7, { status: "rejected" }),
    ])
    assert.deepStrictEqual(progress, { left: 2, shown: 1, keptHidden: 2, decided: 3, total: 5 })
  })
})

describe("nextOpenMoment", () => {
  const moments = [{ ids: [1, 2], spanMs: 1 }, { ids: [3], spanMs: null }, { ids: [4], spanMs: null }]

  it("finds the next moment still waiting, from where you are", () => {
    const open = new Set([3, 4])
    assert.strictEqual(nextOpenMoment(moments, (id) => open.has(id), 0), 1)
    assert.strictEqual(nextOpenMoment(moments, (id) => open.has(id), 2), 2)
  })

  it("wraps round to a moment that was skipped", () => {
    const open = new Set([2])
    assert.strictEqual(nextOpenMoment(moments, (id) => open.has(id), 1), 0)
  })

  it("is -1 when every photo is decided", () => {
    assert.strictEqual(nextOpenMoment(moments, () => false, 0), -1)
    assert.strictEqual(nextOpenMoment([], () => true, 0), -1)
  })
})

describe("momentLabel", () => {
  it("says how many and how close together", () => {
    assert.strictEqual(momentLabel(1, null), "1 photo")
    assert.strictEqual(momentLabel(3, 400), "3 shots in under a second")
    assert.strictEqual(momentLabel(3, 1000), "3 shots in 1 second")
    assert.strictEqual(momentLabel(4, 6400), "4 shots in 6 seconds")
    assert.strictEqual(momentLabel(2, 90000), "2 shots in 2 minutes")
    assert.strictEqual(momentLabel(2, null), "2 photos")
  })
})
