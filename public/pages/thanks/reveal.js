/** @file The reveal stage machine — the emotional core. Drives the card element's
 *  `data-stage` through a fixed timeline; CSS owns every transition per
 *  [data-stage]. Timing is delegated to cancellableDelay(ms, signal) so skip()
 *  (an AbortController) can cut the choreography at any beat.
 *
 *  Timeline (~4.5s): sealed (waits for the envelope tap — the gift moment) →
 *  opening (flap + reveal one-shot, 900ms) → unfolding (paper unfolds, 700ms) →
 *  message (word cascade, 1500ms) → photos (polaroids drop + fan, 800ms) →
 *  ambient (card effects swell in, 400ms) → reply → complete (replay shown).
 *
 *  REVEAL_STAGES is exported (inspectable) for unit tests: the order is the spec,
 *  and skip()'s target is always the final stage. */
/** @import * as Types from "./types.js" */

import { cancellableDelay } from "../../effects/effect-utils.js"

/** The stage order, start → finish. The last entry is skip()'s jump target. */
/** @type {typeof Types.REVEAL_STAGES} */
export const REVEAL_STAGES = [
  "sealed",
  "opening",
  "unfolding",
  "message",
  "photos",
  "ambient",
  "reply",
  "complete",
]

/** Per-stage dwell time (ms) before advancing to the next stage. */
const TIMINGS = {
  opening: 900,
  unfolding: 700,
  message: 1500,
  photos: 800,
  ambient: 400,
  reply: 250,
}

/** Reduced motion: uniform short crossfade beats, no particles, no one-shots. */
const REDUCED_STEP = 220

/** @type {typeof Types.playReveal} */
export function playReveal(cardEl, opts) {
  const reduced = opts.reduced
  const step = (/** @type {number} */ ms) => (reduced ? REDUCED_STEP : ms)

  /** Aborted by skip() to cut the current delay chain. */
  let runController = new AbortController()
  let done = false

  /** @param {Types.RevealStage} stage */
  function setStage(stage) {
    cardEl.dataset.stage = stage
  }

  // Once the envelope has faded (unfolding onward) it's decorative — pull it out
  // of the tab order and hide it from assistive tech. Restored on replay.
  function hideEnvelope() {
    opts.envelopeEl.setAttribute("aria-hidden", "true")
    opts.envelopeEl.setAttribute("tabindex", "-1")
  }
  function showEnvelope() {
    opts.envelopeEl.removeAttribute("aria-hidden")
    opts.envelopeEl.removeAttribute("tabindex")
  }

  /**
   * True only for the skip()/replay() abort. cancellableDelay rejects with
   * `signal.reason` — a DOMException named "AbortError" when abort() is called
   * without an explicit reason. Anything else is a genuine failure we must not
   * silently swallow.
   * @param {unknown} err @param {AbortSignal} signal
   */
  function isAbort(err, signal) {
    if (err === signal.reason) return true
    return err instanceof DOMException && err.name === "AbortError"
  }

  /**
   * Invoke a host beat callback in isolation: a throw is logged and swallowed so
   * one failing beat can't kill the beats (or the delays) that follow it.
   * @param {string} label @param {() => void} thunk
   */
  function beat(label, thunk) {
    try {
      thunk()
    } catch (err) {
      console.error('Reveal beat "' + label + '" failed:', err)
    }
  }

  /**
   * Run the sequence forward from a starting stage. `fromOpening` fires the
   * reveal one-shot + focus hop; a replay starts at `unfolding` and skips those.
   * @param {"opening" | "unfolding"} from
   */
  async function run(from) {
    runController = new AbortController()
    const signal = runController.signal
    try {
      if (from === "opening") {
        setStage("opening")
        beat("reveal", () => {
          if (!reduced && opts.onReveal) opts.onReveal(opts.envelopeEl)
        })
        await cancellableDelay(step(TIMINGS.opening), signal)
      }
      setStage("unfolding")
      hideEnvelope()
      beat("opened", () => opts.onOpened?.())
      await cancellableDelay(step(TIMINGS.unfolding), signal)

      setStage("message")
      await cancellableDelay(step(TIMINGS.message), signal)

      setStage("photos")
      await cancellableDelay(step(TIMINGS.photos), signal)

      setStage("ambient")
      beat("ambient", () => opts.onAmbient?.())
      await cancellableDelay(step(TIMINGS.ambient), signal)

      setStage("reply")
      beat("reply", () => opts.onReply?.())
      await cancellableDelay(step(TIMINGS.reply), signal)

      setStage("complete")
      done = true
    } catch (err) {
      // A skip()/replay() abort is expected — that path sets the final state.
      if (isAbort(err, signal)) return
      // Anything else is a real failure. Never strand the guest on a blank
      // opened envelope: log it, then force the usable end state. The card's
      // content is already mounted (applyCardContent runs at render); make sure
      // the reply UI + ambient effects are up and land on `complete`.
      console.error("Reveal sequence failed; forcing complete:", err)
      hideEnvelope()
      beat("reply", () => opts.onReply?.())
      if (!reduced) beat("ambient", () => opts.onAmbient?.())
      setStage("complete")
      done = true
    }
  }

  // sealed: the interaction gate. The card opens only when the recipient taps.
  setStage("sealed")
  function onTap() {
    opts.envelopeEl.removeEventListener("click", onTap)
    // Fire exactly once, on the real open (never on replay): the view beacon +
    // a soft haptic tick live here in the host's onOpen callback.
    beat("open", () => opts.onOpen?.())
    void run("opening")
  }
  opts.envelopeEl.addEventListener("click", onTap)

  return {
    skip() {
      if (done) return
      runController.abort()
      opts.envelopeEl.removeEventListener("click", onTap)
      // Jump straight to the end: mount reply, start effects, show the card fully.
      beat("reply", () => opts.onReply?.())
      if (!reduced) beat("ambient", () => opts.onAmbient?.())
      hideEnvelope()
      setStage("complete")
      done = true
    },
    replay() {
      // Re-run from unfolding: no envelope tap, no reveal one-shot, no beacon.
      // First re-seal for a beat (envelope back, flap swings shut) so it reads as
      // receiving the card again, then unfold. onAmbient is idempotent
      // (startCardEffects re-seeds), so effects simply restart.
      done = false
      runController.abort()
      runController = new AbortController()
      const signal = runController.signal
      showEnvelope()
      setStage("sealed")
      cancellableDelay(reduced ? 150 : 400, signal)
        .then(() => run("unfolding"))
        .catch(() => {
          // Aborted by a skip during the re-seal beat — skip() owns the state.
        })
    },
  }
}
