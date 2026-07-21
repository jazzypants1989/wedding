/** @file Deterministic monogram avatar — an initial chip beside each author.
 *
 * The initial(s) and a hue are derived purely from the author name (a charCodeAt
 * hash, no regex), so the same name always gets the same colored circle across
 * the feed and comment threads. Emoji / non-Latin names degrade gracefully: the
 * leading grapheme is shown as-is, and a blank name falls back to a star glyph.
 */
/** @import * as Types from "./types.js" */

import { html } from "../pages/utils.js"

/** Shown when a name is blank/whitespace — a small decorative stand-in. */
const FALLBACK_GLYPH = "✦"

/** @param {string} cp single-codepoint string @returns {boolean} */
function isLatinLetter(cp) {
  const c = cp.charCodeAt(0)
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
}

/** @param {string} cp single-codepoint string @returns {boolean} */
function isDigit(cp) {
  const c = cp.charCodeAt(0)
  return c >= 48 && c <= 57
}

/**
 * The leading grapheme of a word, iterating by code point (surrogate-pair safe)
 * so an emoji first "letter" isn't split. @param {string} word @returns {string}
 */
function firstGrapheme(word) {
  for (const cp of word) return cp
  return ""
}

/**
 * Derive 1–2 initials. Latin names get up-to-two uppercased word initials; a
 * digit-leading name keeps the digit; anything else (emoji, CJK, accented) shows
 * its leading grapheme verbatim. A blank name → the fallback glyph.
 * @param {string} name @returns {string}
 */
function deriveInitial(name) {
  const trimmed = name.trim()
  if (!trimmed) return FALLBACK_GLYPH

  const words = trimmed.split(" ").filter((w) => w !== "")
  const first = firstGrapheme(words[0])

  if (isLatinLetter(first)) {
    let initial = first.toUpperCase()
    if (words.length > 1) {
      const second = firstGrapheme(words[words.length - 1])
      if (isLatinLetter(second)) initial += second.toUpperCase()
    }
    return initial
  }
  if (isDigit(first)) return first
  // Emoji / CJK / accented leading char — show it as-is (graceful, not blank).
  return first
}

/** Stable hue in [0, 360) from a charCodeAt rolling hash. @param {string} str */
function hashHue(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0
  }
  return h % 360
}

/** @type {Types.monogramData} */
export function monogramData(name) {
  return { initial: deriveInitial(name || ""), hue: hashHue(name || "") }
}

/** @type {Types.renderMonogram} */
export function renderMonogram(name) {
  const { initial, hue } = monogramData(name)
  return html`<span class="monogram" style="--mono-hue: ${hue}" aria-hidden="true"
    >${initial}</span
  >`
}
