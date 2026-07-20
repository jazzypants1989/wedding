/** @file Live-preview iframe controller for the admin thank-you composer.
 *
 *  This page fetches nothing and has no token/auth. It reuses the guest card's
 *  pure render module (card-render.js) + card theme + card ambient effects +
 *  the reveal choreography, and is driven entirely by `postMessage` from the
 *  parent admin document:
 *
 *    child → parent  { type: "card:preview-ready" }    (once, on load)
 *    parent → child  { type: "card:preview", payload }  (on every debounced edit)
 *    parent → child  { type: "card:play-reveal", reveal } (▶ Play reveal, E1)
 *
 *  Both sides check `event.origin === location.origin`. By default the card is
 *  shown fully revealed (data-stage="complete") — a composition preview, not the
 *  choreographed reveal. "Play reveal" resets the scene to sealed and runs the
 *  full sequence once. Content re-renders every push, but the ambient effect
 *  stack only tears down + restarts when the theme or effect list actually
 *  changed (diff-aware) — this kills the per-keystroke particle flicker (E2). */
/** @import * as Types from "./types.js" */
/** @import * as ThanksTypes from "../thanks/types.js" */

import { applyCardContent, setEnvelopeName, setSealMonogram } from "../thanks/card-render.js"
import { applyCardTheme } from "../thanks/card-themes.js"
import { startCardEffects, stopCardEffects } from "../thanks/card-effects.js"
import { playReveal } from "../thanks/reveal.js"
import {
  fireConfetti,
  champagnePop,
  heartBurst,
  miniSparkle,
  sealBreak,
} from "../../components/celebrate.js"
import { prefersReducedMotion } from "../../effects/effect-utils.js"

/** Last-applied theme id, for diff-aware pushes. @type {string | null} */
let lastThemeId = null
/** Last-applied effects, JSON-serialized, for diff-aware pushes. @type {string | null} */
let lastEffectsJson = null
/** The last-applied effect list, replayed by onAmbient during a reveal. @type {ThanksTypes.CardEffectEntry[]} */
let lastEffects = []
/** Active reveal controller, so a re-play can cancel the previous run. @type {ThanksTypes.RevealController | null} */
let activeReveal = null

/** @param {unknown} v @returns {v is Types.CardPreviewPayload} */
function isPayload(v) {
  return typeof v === "object" && v !== null
}

/** Apply one composed-card payload to the preview DOM. @param {Types.CardPreviewPayload} p */
function applyPreview(p) {
  const card = document.getElementById("tc-card")
  if (!(card instanceof HTMLElement)) return

  const themeId = typeof p.themeId === "string" ? p.themeId : "classic"
  const effects = Array.isArray(p.effects) ? p.effects : []
  const effectsJson = JSON.stringify(effects)
  const themeChanged = themeId !== lastThemeId
  const effectsChanged = effectsJson !== lastEffectsJson

  // Retint the ambient palette (tokens.css [data-effect-theme]) + card paper
  // only when the theme actually changed.
  if (themeChanged) {
    document.documentElement.dataset.effectTheme = themeId
    applyCardTheme(card, themeId)
  }

  // Content re-renders on every push — it's cheap and never restarts particles.
  // coupleName is optional on the payload (the composer's sender doesn't carry it
  // yet); absent → card-render hides the sign-off line, avoiding a dangling comma.
  const recipientName = typeof p.recipientName === "string" ? p.recipientName : "friend"
  const coupleName = typeof p.coupleName === "string" ? p.coupleName : undefined

  applyCardContent(card, {
    recipientName,
    message: typeof p.message === "string" ? p.message : "",
    media: Array.isArray(p.mediaItems) ? p.mediaItems : [],
    coupleName,
  })

  // Mirror the guest page's envelope-front personalization so the composer sees
  // the recipient's name in the script hand + the couple's wax monogram.
  const envelope = document.getElementById("tc-envelope")
  if (envelope instanceof HTMLElement) {
    setEnvelopeName(envelope, recipientName)
    const sealEl = envelope.querySelector(".tc-seal")
    if (sealEl instanceof HTMLElement) setSealMonogram(sealEl, coupleName)
  }

  // Only tear down + re-seed the ambient stack when the palette or the effect
  // list changed — message/media/recipient-only edits leave particles running.
  if (themeChanged || effectsChanged) {
    stopCardEffects()
    startCardEffects(effects)
  }

  lastThemeId = themeId
  lastEffectsJson = effectsJson
  lastEffects = effects
}

/** Reset the scene to sealed and run the full reveal choreography once with the
 *  given one-shot ("none" → no burst). Auto-advances past the tap gate. (E1)
 *  @param {string} reveal */
function playRevealPreview(reveal) {
  const scene = document.getElementById("tc-scene")
  const envelope = document.getElementById("tc-envelope")
  if (!(scene instanceof HTMLElement) || !(envelope instanceof HTMLButtonElement)) return

  // Cancel any in-flight reveal so its listeners/timers don't stack.
  if (activeReveal) activeReveal.skip()
  stopCardEffects()

  activeReveal = playReveal(scene, {
    envelopeEl: envelope,
    reduced: prefersReducedMotion(),
    onReveal: (origin) => fireRevealMoment(reveal, origin),
    onAmbient: () => startCardEffects(lastEffects),
  })
  // No human to tap in the preview — advance past the sealed gate ourselves.
  envelope.click()
}

/** Fire the authored reveal one-shot at the opening beat. "none" → quiet.
 *  @param {string} moment @param {HTMLElement} origin */
function fireRevealMoment(moment, origin) {
  // The wax breaks on every full-motion open, independent of the celebration
  // flavour (matches the guest page). Self-gates under reduced motion.
  sealBreak(origin)
  if (moment === "none") return
  miniSparkle(origin)
  if (moment === "champagne") champagnePop(origin)
  else if (moment === "hearts") heartBurst(origin)
  else fireConfetti()
}

window.addEventListener("message", (event) => {
  // The composer is same-origin; ignore anything else outright.
  if (event.origin !== location.origin) return
  const data = event.data
  if (!data || typeof data !== "object") return
  // The parent may prompt us to re-announce readiness (it can attach its
  // listener after our initial "ready" already fired) — reply so it can flush.
  if (data.type === "card:preview-hello") {
    postReady()
    return
  }
  if (data.type === "card:play-reveal") {
    playRevealPreview(typeof data.reveal === "string" ? data.reveal : "confetti")
    return
  }
  if (data.type !== "card:preview") return
  if (isPayload(data.payload)) applyPreview(data.payload)
})

/** Announce readiness so the parent knows it can push (it queues the first push
 *  until this arrives, and may re-prompt via "card:preview-hello"). */
function postReady() {
  try {
    window.parent.postMessage(
      /** @type {Types.CardPreviewReadyMessage} */ ({ type: "card:preview-ready" }),
      location.origin,
    )
  } catch {
    // No parent / cross-origin parent — the preview stays on its defaults.
  }
}

postReady()
