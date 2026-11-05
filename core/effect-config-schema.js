/** @file Server-visible schema of the browser effect-config shape.
 *
 *  `public/effects/config.js` (EFFECT_CONFIGS) is the single source of truth for
 *  effect ids + their tunable keys, but it's a browser module (reads CSS tokens
 *  at import, pulls in DOM types) so the server can't import it without breaking
 *  the server tsconfig. This is a plain-data mirror of each effect's *keys and
 *  the value shape each key accepts*, used by api/admin/effect-config.js to
 *  validate an admin override before storing it.
 *
 *  Drift is guarded by tests/unit/effect-config-schema.test.js, which imports
 *  both this map and the real EFFECT_CONFIGS and asserts the ids + keys match
 *  AND that each spec's `kind`/bounds are consistent with the shipped default
 *  value (so a mis-classified key or a bound tighter than the default is caught).
 *  When you add or rename an effect key in config.js, update the matching entry
 *  here. Zero deps, no regex.
 *
 *  One key is not in the defaults: `pages`, where the effect runs. Every effect
 *  has it, and a missing one means the landing page, so it is added to every entry
 *  below rather than listed in each. EFFECT_CONFIG_PAGES mirrors
 *  PLACEABLE_EFFECT_PAGES in public/effects/pages.js, guarded by the same test.
 *
 *  Why per-key specs (not just a name allowlist): key names collide across
 *  effects with *different* types — `dividers.color` is a number (0.5) while
 *  `frost.color` / `namespark.shimmerColor` are strings. And an unbounded number
 *  on a count-like key (e.g. `snow.flakeCount: 1e9`) would make every visitor's
 *  browser try to build a billion nodes. The spec pins both.
 */

/** @import * as Types from './types.js' */

// Generous-but-finite bounds. Effect values are all small; these ceilings exist
// to block absurd/DoS values, not to second-guess reasonable tuning.
const MIN_NUM = -100000
const MAX_NUM = 100000
// Element-generating counts (loop bounds / grid sizes). Kept well above every
// shipped default (max is starfield.starCount = 70) but low enough that no
// single override can hang a visitor's browser.
const MAX_COUNT = 5000

/** @param {number} [min] @param {number} [max] @returns {Types.EffectKeySpec} */
const num = (min = MIN_NUM, max = MAX_NUM) => ({ kind: "number", min, max })
/** A non-negative count that drives element/loop creation. @param {number} [max] @returns {Types.EffectKeySpec} */
const count = (max = MAX_COUNT) => ({ kind: "count", min: 0, max })
/** @returns {Types.EffectKeySpec} */
const str = () => ({ kind: "string" })
/** A numeric range pair `[a, b]`. @returns {Types.EffectKeySpec} */
const range = () => ({ kind: "numberArray", min: MIN_NUM, max: MAX_NUM, minItems: 2, maxItems: 2 })
/** An array of color/token strings. @returns {Types.EffectKeySpec} */
const colors = () => ({ kind: "stringArray", maxItems: 64 })

/** The page ids a `pages` override may name. No memory-book: it prints.
 *  @type {readonly string[]} */
export const EFFECT_CONFIG_PAGES = ["home", "guestbook", "gallery", "rsvp"]

/** Each effect id → { tunable key → the value shape an override may set }.
 *  @type {Record<string, Record<string, Types.EffectKeySpec>>} */
const TUNABLE_SPECS = {
  disco: {
    spinSpeed: num(), ballSize: num(1, 600), rayCount: count(), rayBrightness: num(),
    rayColors: colors(), tileSize: num(1, 200), tileGap: num(0, 200),
    rayDurationRange: range(), rayDelayRange: range(),
  },
  cursor: {
    trailDensity: count(), trailType: str(), throttleMs: num(), fadeSpeed: num(),
    size: num(), colors: colors(), minDistance: num(),
  },
  shimmer: {
    opacity: num(), gradientSpeed: num(), colorPalette: str(), scaleSize: num(), gradientAngle: num(),
  },
  dividers: { dotDensity: count(), color: num(), animationDelayStep: num() },
  namespark: { shimmerSpeed: num(), shimmerColor: str() },
  textglow: { intensity: num(), threshold: num() },
  parallaxsparkles: {
    layerCount: count(), density: count(), speedMultiplier: num(), colorScheme: str(),
    sizeRange: range(), opacityRange: range(), glowThreshold: num(),
  },
  entrance: {
    entranceStyle: str(), sparkleIntensity: count(), speed: num(), colors: colors(),
    sparkleSizeRange: range(), waveCount: count(),
  },
  spotlight: {
    beamCount: count(), sweepSpeed: num(), beamWidth: num(), colors: colors(),
    colorCycleMs: num(), beamStagger: num(),
  },
  reflections: {
    reflectionCount: count(), speed: num(), brightness: num(), colors: colors(),
    sizeRange: range(), frameInterval: num(),
  },
  petals: {
    petalCount: count(), fallDurationRange: range(), delayRange: range(),
    sizeRange: range(), swayRange: range(), colors: colors(),
  },
  hearts: {
    heartCount: count(), riseDurationRange: range(), delayRange: range(),
    sizeRange: range(), driftRange: range(), colors: colors(),
  },
  dust: {
    density: count(), driftDurationRange: range(), delayRange: range(),
    sizeRange: range(), swayRange: range(), colors: colors(),
  },
  starfield: {
    starCount: count(), sizeRange: range(), twinkleDurationRange: range(),
    delayRange: range(), colors: colors(),
  },
  shootingstars: {
    streakCount: count(), cycleDurationRange: range(), delayRange: range(),
    lengthRange: range(), colors: colors(),
  },
  aurora: { opacity: num(), speed: num(), palette: str(), height: num(), angle: num() },
  fireflies: {
    flyCount: count(), sizeRange: range(), blinkDurationRange: range(),
    driftDurationRange: range(), driftRange: range(), colors: colors(),
  },
  leaves: {
    leafCount: count(), fallDurationRange: range(), delayRange: range(),
    sizeRange: range(), swayRange: range(), colors: colors(),
  },
  snow: {
    flakeCount: count(), fallDurationRange: range(), delayRange: range(),
    sizeRange: range(), swayRange: range(), colors: colors(),
  },
  frost: { opacity: num(), breatheSpeed: num(), color: str(), clearRadius: num() },
  bubbles: {
    bubbleCount: count(), riseDurationRange: range(), delayRange: range(),
    sizeRange: range(), wobbleRange: range(),
  },
  caustics: { intensity: num(), speed: num(), layerCount: count() },
  lanterns: {
    lanternCount: count(), riseDurationRange: range(), delayRange: range(),
    sizeRange: range(), swayRange: range(), colors: colors(),
  },
  ribbons: {
    ribbonCount: count(), unfurlDurationRange: range(), delayRange: range(),
    widthRange: range(), colors: colors(),
  },
  fizz: {
    streamCount: count(), bubblesPerStream: count(), riseDurationRange: range(),
    delayRange: range(), sizeRange: range(), colors: colors(),
  },
  frameglint: {
    sweepIntervalMs: num(), sweepDurationMs: num(), angle: num(), intensity: num(),
  },
  confettidrift: {
    pieceCount: count(), fallDurationRange: range(), delayRange: range(),
    sizeRange: range(), spinRange: range(), colors: colors(),
  },
  inksparkle: {
    glyphCount: count(), driftDurationRange: range(), delayRange: range(),
    sizeRange: range(), glyphs: colors(), colors: colors(),
  },
  tiltdepth: {
    selector: str(), maxTilt: num(0, 90), depth: num(0, 1000),
  },
}

/** The tunable keys plus `pages`, for every effect.
 *  @type {Record<string, Record<string, Types.EffectKeySpec>>} */
export const EFFECT_CONFIG_SPECS = Object.fromEntries(
  Object.keys(TUNABLE_SPECS).map((id) => [
    id,
    { ...TUNABLE_SPECS[id], pages: { kind: "pages", allowed: EFFECT_CONFIG_PAGES } },
  ]),
)

/** Derived id → set of valid keys (back-compat + the drift key-parity check).
 *  @type {Record<string, ReadonlySet<string>>} */
export const EFFECT_CONFIG_KEYS = Object.fromEntries(
  Object.keys(EFFECT_CONFIG_SPECS).map((id) => [id, new Set(Object.keys(EFFECT_CONFIG_SPECS[id]))]),
)
