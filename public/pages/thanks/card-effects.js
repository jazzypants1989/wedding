/** @file Card-scoped ambient effect runner. A miniature of effects/main.js, but
 *  it runs the *card's authored* effect list (from effects_config) instead of the
 *  site theme's — so this deliberately does NOT reuse the site manager (which
 *  reads document.dataset.effectTheme). Reduced motion bails entirely: no
 *  particles are ever started. Own instance Map + visibilitychange handling. */
/** @import * as Types from "./types.js" */

import { EFFECT_DEFINITIONS } from "../../effects/registry.js"
import { getDefaultConfig, mergeConfig } from "../../effects/config.js"
import { prefersReducedMotion } from "../../effects/effect-utils.js"

/** @type {Map<string, import("../../effects/types.js").EffectInstance>} */
const instances = new Map()

/** @type {Types.CardEffectEntry[]} */
let authored = []

let active = false

/** @type {AbortController | null} */
let visController = null

/** Registry id → factory, built once. */
const BY_ID = new Map(EFFECT_DEFINITIONS.map((d) => [d.id, d]))

/** Tilt/parallax effect ids to look for at runtime (another track may register
 *  one). Never imported by name — presence is probed against the live registry. */
const TILT_IDS = ["tiltdepth", "cardtilt"]

/** The one subtle seasonal garnish for the current month, mapped to a real
 *  registry id with a low particle count. Returns null when nothing fits.
 *  @returns {Types.CardEffectEntry | null} */
function seasonalEntry() {
  const month = new Date().getMonth()
  // Dec–Feb: snow. Mar–May: petals. Jun–Aug: fireflies. Sep–Nov: leaves.
  if (month === 11 || month === 0 || month === 1) return { id: "snow", config: { flakeCount: 18 } }
  if (month >= 2 && month <= 4) return { id: "petals", config: { petalCount: 10 } }
  if (month >= 5 && month <= 7) return { id: "fireflies", config: { flyCount: 12 } }
  return { id: "leaves", config: { leafCount: 10 } }
}

/** Append the ambient garnish to the authored list: at most one seasonal effect
 *  (never duplicating an authored id, only if its id is a real registry effect)
 *  plus a polaroid-parallax tilt effect when one is registered at runtime.
 *  @param {Types.CardEffectEntry[]} list @returns {Types.CardEffectEntry[]} */
function withGarnish(list) {
  /** @type {Set<string>} */
  const ids = new Set()
  for (const e of list) if (e && typeof e.id === "string") ids.add(e.id)
  const out = list.slice()

  const season = seasonalEntry()
  if (season && BY_ID.has(season.id) && !ids.has(season.id)) {
    out.push(season)
    ids.add(season.id)
  }

  for (const tiltId of TILT_IDS) {
    if (BY_ID.has(tiltId) && !ids.has(tiltId)) {
      out.push({ id: tiltId })
      break
    }
  }

  return out
}

/** Create + start every authored effect, layering its partial config over the
 *  effect's defaults. Unknown / config-less ids are skipped silently. */
function startAll() {
  for (const entry of authored) {
    if (!entry || typeof entry.id !== "string") continue
    if (instances.has(entry.id)) continue
    const def = BY_ID.get(entry.id)
    if (!def) continue
    const base = getDefaultConfig(entry.id)
    if (!base) continue
    const cfg = mergeConfig(base, entry.config || {})
    try {
      // Snapshot the body's children so we can tag *only* the container(s) this
      // effect appends. Card ambient effects render BEHIND the card paper (see
      // .effect-layer--behind in effects.css); one-shot celebrate.js bursts use
      // their own inline layer and are never started here, so they stay in front.
      const before = new Set(document.body.children)
      const instance = def.create(cfg)
      instance.start()
      instances.set(entry.id, instance)
      for (const child of document.body.children) {
        if (!before.has(child)) child.classList.add("effect-layer--behind")
      }
    } catch (err) {
      console.warn('Card effect "' + entry.id + '" failed to start:', err)
    }
  }
}

function stopAll() {
  for (const [id, instance] of instances) {
    try {
      instance.stop()
    } catch (err) {
      console.warn('Card effect "' + id + '" failed to stop:', err)
    }
  }
  instances.clear()
}

function onVisibility() {
  if (!active) return
  if (document.hidden) stopAll()
  else startAll()
}

/** Mid-card reduced-motion toggle. Mirrors effects/main.js: if the guest turns
 *  reduced motion ON while the card is live, tear the ambient effects down for
 *  good. We deliberately don't auto-restart when they turn it back off — the next
 *  stage transition or a replay will call startCardEffects() again if warranted.
 *  @param {MediaQueryListEvent} e */
function onReducedMotion(e) {
  if (active && e.matches) stopCardEffects()
}

/** @type {typeof Types.startCardEffects} */
export function startCardEffects(list) {
  // Reduced motion: never start particles. The card still reads as composed —
  // its paper theme + the message/photos are all applied elsewhere.
  if (prefersReducedMotion()) return
  // Idempotent: a replay or a double-call re-seeds from a clean slate.
  stopCardEffects()

  // The authored list, plus a single season-aware garnish and (when present) a
  // runtime polaroid-tilt effect. Reduced motion already bailed above, so the
  // garnish only ever rides the full-motion path.
  authored = withGarnish(Array.isArray(list) ? list : [])

  // Flip the deferred effects stylesheet on (mirrors effects/main.js). It ships
  // media="print" so the effect keyframes/layers don't cost anything until now.
  const link = document.getElementById("effects-css")
  if (link instanceof HTMLLinkElement) link.media = "all"

  active = true
  startAll()

  visController = new AbortController()
  document.addEventListener("visibilitychange", onVisibility, {
    signal: visController.signal,
  })
  // Reduced motion can be toggled mid-card — stop effects if it flips on. The
  // listener rides visController, so stopCardEffects() (incl. its own teardown)
  // cleans it up automatically.
  window
    .matchMedia("(prefers-reduced-motion: reduce)")
    .addEventListener("change", onReducedMotion, { signal: visController.signal })
}

/** @type {typeof Types.stopCardEffects} */
export function stopCardEffects() {
  active = false
  if (visController) {
    visController.abort()
    visController = null
  }
  stopAll()
}
