/** @file Unit test for public/effects/frame-glint.js#stop() — the one effect
 *  with a JS timer, so it MUST clear its interval AND every per-target setTimeout
 *  it scheduled. Imports a browser module + drives it against a minimal DOM/timer
 *  stub, so this file is excluded from the server tsconfig (same pattern as
 *  effect-themes.test.js). */

import { test } from "node:test"
import assert from "node:assert"

import { createFrameGlint } from "../../public/effects/frame-glint.js"

/** Build a fake framed element the effect can query + style. */
function fakeEl() {
  const classes = new Set()
  return {
    get offsetWidth() {
      return 0
    },
    style: {
      /** @param {string} _n @param {string} _v */
      setProperty(_n, _v) {},
      /** @param {string} _n */
      removeProperty(_n) {},
    },
    classList: {
      /** @param {string} c */
      add(c) {
        classes.add(c)
      },
      /** @param {string} c */
      remove(c) {
        classes.delete(c)
      },
      /** @param {string} c */
      contains(c) {
        return classes.has(c)
      },
    },
  }
}

/**
 * Install stubs for document, window.matchMedia, and the timer globals so the
 * effect runs deterministically and we can count still-live timers. Returns a
 * teardown fn plus the live-timer bookkeeping sets.
 * @param {{ reducedMotion?: boolean }} [opts]
 */
function installEnv({ reducedMotion = false } = {}) {
  const els = [fakeEl(), fakeEl(), fakeEl()]
  /** @type {Set<number>} */
  const liveIntervals = new Set()
  /** @type {Set<number>} */
  const liveTimeouts = new Set()
  let nextId = 1

  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  }

  globalThis.document = /** @type {any} */ ({
    /** @param {string} _selector */
    querySelectorAll(_selector) {
      // Both ".tc-polaroid" (targets) and ".tc-glint-sweep" (cleanup) resolve to
      // the same fake set; Array#forEach matches the (node, index) call shape.
      return els
    },
  })
  globalThis.window = /** @type {any} */ ({
    matchMedia() {
      return { matches: reducedMotion }
    },
  })
  // Non-firing timer stubs: we never advance them, so every scheduled callback
  // stays pending until the effect clears it — which is exactly what we assert.
  globalThis.setInterval = /** @type {any} */ (
    () => {
      const id = nextId++
      liveIntervals.add(id)
      return id
    }
  )
  globalThis.clearInterval = /** @type {any} */ (
    (/** @type {number} */ id) => {
      liveIntervals.delete(id)
    }
  )
  globalThis.setTimeout = /** @type {any} */ (
    () => {
      const id = nextId++
      liveTimeouts.add(id)
      return id
    }
  )
  globalThis.clearTimeout = /** @type {any} */ (
    (/** @type {number} */ id) => {
      liveTimeouts.delete(id)
    }
  )

  function teardown() {
    globalThis.document = saved.document
    globalThis.window = saved.window
    globalThis.setInterval = saved.setInterval
    globalThis.clearInterval = saved.clearInterval
    globalThis.setTimeout = saved.setTimeout
    globalThis.clearTimeout = saved.clearTimeout
  }

  return { liveIntervals, liveTimeouts, teardown, targetCount: els.length }
}

test("frame-glint start() arms an interval + per-target timeouts; stop() clears them all", () => {
  const env = installEnv()
  try {
    const glint = createFrameGlint({ sweepIntervalMs: 1000, sweepDurationMs: 400 })
    glint.start()

    // start() fires the first sweep immediately (one interval armed) and schedules
    // one staggered timeout per target.
    assert.equal(env.liveIntervals.size, 1, "one interval armed")
    assert.equal(env.liveTimeouts.size, env.targetCount, "one pending timeout per target")

    glint.stop()
    assert.equal(env.liveIntervals.size, 0, "stop() clears the interval")
    assert.equal(env.liveTimeouts.size, 0, "stop() clears every tracked timeout")
  } finally {
    env.teardown()
  }
})

test("frame-glint sweep does no work under reduced motion (no timeouts scheduled)", () => {
  const env = installEnv({ reducedMotion: true })
  try {
    const glint = createFrameGlint({})
    glint.start()
    // The interval is still armed (so it resumes if the preference flips) but the
    // sweep early-returns, scheduling zero per-target timeouts.
    assert.equal(env.liveIntervals.size, 1, "interval still armed under reduced motion")
    assert.equal(env.liveTimeouts.size, 0, "no class-thrash timeouts under reduced motion")
    glint.stop()
    assert.equal(env.liveIntervals.size, 0)
  } finally {
    env.teardown()
  }
})
