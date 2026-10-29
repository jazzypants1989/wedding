/** @file "Is this exactly one emoji?" — the check behind the thank-you card's
 *  free emoji reply. Pure, no DOM and no imports, so the server validates with
 *  the same code the page uses to give instant feedback.
 *
 *  No regex (CLAUDE.md), so `\p{Extended_Pictographic}` is out. Instead:
 *  `Intl.Segmenter` decides "one user-perceived character", and a code-point
 *  range table decides "made only of emoji parts". The table is deliberately
 *  generous — every pictographic block plus the joiners, selectors, skin tones,
 *  keycaps and tags that build sequences — because the cost of a false reject
 *  is a guest who cannot send the emoji they picked, and the cost of a false
 *  accept is one odd symbol in the couple's Mailbox. What it must never let
 *  through is text, which is what the "at least one pictograph" and
 *  "one grapheme" rules are for.
 */
/** @import * as Types from "./types.js" */

/** The longest stored reply emoji, in UTF-16 units. Generous: a ZWJ family is
 *  11, a subdivision flag 14. The DB trigger bounds code points at 16. */
export const MAX_EMOJI_LENGTH = 32

/** The glyphs the six legacy reply keys stood for. Replies were stored as keys
 *  until the free picker; the `reply_emoji_glyphs` migration rewrote stored
 *  rows, and the server still maps a key a cached page might send. Must equal
 *  reaction-bar.js REACTION_GLYPHS (tests/unit/emoji.test.js). */
export const LEGACY_REPLY_GLYPHS = Object.freeze({
  heart: "❤️",
  clap: "👏",
  laugh: "😂",
  heart_eyes: "😍",
  cheers: "🥂",
  fire: "🔥",
})

/** One-tap choices on the reply form, before "any emoji". The six reaction
 *  glyphs first, so the familiar row is still there. `label` is the pill's
 *  accessible name. */
export const REPLY_QUICK_PICKS = Object.freeze([
  { glyph: "❤️", label: "heart" },
  { glyph: "👏", label: "clapping" },
  { glyph: "😂", label: "laughing" },
  { glyph: "😍", label: "heart eyes" },
  { glyph: "🥂", label: "cheers" },
  { glyph: "🔥", label: "fire" },
  { glyph: "🥹", label: "touched" },
  { glyph: "🥰", label: "smiling with hearts" },
  { glyph: "💐", label: "bouquet" },
  { glyph: "🎉", label: "party popper" },
  { glyph: "🙏", label: "thank you" },
  { glyph: "💌", label: "love letter" },
])

/** Pictographic code points: a grapheme needs at least one of these.
 *  @type {ReadonlyArray<readonly [number, number]>} */
const PICTOGRAPHIC = [
  [0x00a9, 0x00a9],
  [0x00ae, 0x00ae],
  [0x203c, 0x203c],
  [0x2049, 0x2049],
  [0x2122, 0x2122],
  [0x2139, 0x2139],
  [0x2194, 0x2199],
  [0x21a9, 0x21aa],
  [0x231a, 0x231b],
  [0x2328, 0x2328],
  [0x23cf, 0x23cf],
  [0x23e9, 0x23f3],
  [0x23f8, 0x23fa],
  [0x24c2, 0x24c2],
  [0x25aa, 0x25ab],
  [0x25b6, 0x25b6],
  [0x25c0, 0x25c0],
  [0x25fb, 0x25fe],
  [0x2600, 0x27bf],
  [0x2934, 0x2935],
  [0x2b05, 0x2b07],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x3030, 0x3030],
  [0x303d, 0x303d],
  [0x3297, 0x3297],
  [0x3299, 0x3299],
  // Every supplementary emoji block: mahjong and cards through Symbols and
  // Pictographs Extended-A. Regional indicators and skin tones live in here.
  [0x1f000, 0x1faff],
]

/** Parts that only build sequences: ZWJ, variation selectors, keycap, tags.
 *  @type {ReadonlyArray<readonly [number, number]>} */
const COMPONENT = [
  [0x200d, 0x200d],
  [0xfe0e, 0xfe0f],
  [0x20e3, 0x20e3],
  [0xe0020, 0xe007f],
]

const KEYCAP = 0x20e3
const REGIONAL_FIRST = 0x1f1e6
const REGIONAL_LAST = 0x1f1ff
// Skin-tone modifiers sit inside the pictographic block but only modify a base:
// alone, they render as a colour swatch.
const SKIN_FIRST = 0x1f3fb
const SKIN_LAST = 0x1f3ff

/** @param {number} cp @param {ReadonlyArray<readonly [number, number]>} ranges */
function inRanges(cp, ranges) {
  for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true
  return false
}

/** Keycap bases: `#`, `*`, `0`–`9` — emoji only as the head of a keycap.
 *  @param {number} cp */
function isKeycapBase(cp) {
  return cp === 0x23 || cp === 0x2a || (cp >= 0x30 && cp <= 0x39)
}

/** @type {Types.isSingleEmoji} */
export function isSingleEmoji(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_EMOJI_LENGTH) {
    return false
  }
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
  if (segments.length !== 1) return false

  const cps = [...value].map((ch) => /** @type {number} */ (ch.codePointAt(0)))
  let pictographs = 0
  let regionals = 0
  for (const cp of cps) {
    if (cp >= SKIN_FIRST && cp <= SKIN_LAST) continue
    if (inRanges(cp, PICTOGRAPHIC)) {
      pictographs++
      if (cp >= REGIONAL_FIRST && cp <= REGIONAL_LAST) regionals++
    } else if (isKeycapBase(cp)) {
      // Only as a keycap's head: "1️⃣" yes, a bare "1" no.
      if (!cps.includes(KEYCAP)) return false
      pictographs++
    } else if (!inRanges(cp, COMPONENT)) {
      return false
    }
  }
  if (pictographs === 0) return false
  // A lone regional indicator renders as a boxed letter, not a flag.
  if (regionals === 1 && pictographs === 1) return false
  return true
}

/** @type {Types.replyGlyph} */
export function replyGlyph(value) {
  if (!value) return ""
  return Object.hasOwn(LEGACY_REPLY_GLYPHS, value)
    ? LEGACY_REPLY_GLYPHS[/** @type {keyof typeof LEGACY_REPLY_GLYPHS} */ (value)]
    : value
}

/** @type {Types.lastEmojiIn} */
export function lastEmojiIn(text) {
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)]
  for (let i = segments.length - 1; i >= 0; i--) {
    if (isSingleEmoji(segments[i].segment)) return segments[i].segment
  }
  return null
}
