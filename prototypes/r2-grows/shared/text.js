/** @file Reading a note's shape without regex: words, sentences, terminal
 *  punctuation, emoji, salient words, and a "key name" out of an author line.
 *  Every function here is pure and string-method only (CLAUDE.md: no regex). */

/** A cased letter in any script that has case (Latin, Greek, Cyrillic, …).
 *  @param {string} ch */
export function isLetter(ch) {
  return ch.toLowerCase() !== ch.toUpperCase()
}

/** @param {number} cp */
export function isEmojiCode(cp) {
  return (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) || cp === 0x2764
}

/** Joiners and variation selectors that ride along with an emoji. @param {number} cp */
function isEmojiGlue(cp) {
  return cp === 0xfe0f || cp === 0x200d || (cp >= 0x1f3fb && cp <= 0x1f3ff)
}

/** Lowercase a–z only, accents folded ("Sørensen" → "srensen", "Domínguez" → "dominguez").
 *  @param {string} str */
export function foldLetters(str) {
  const nfd = str.normalize("NFD").toLowerCase()
  let out = ""
  for (const ch of nfd) {
    const c = ch.charCodeAt(0)
    if (c >= 97 && c <= 122) out += ch
  }
  return out
}

/** Whitespace-split words with leading/trailing non-letters trimmed. Empty and
 *  pure-punctuation tokens are dropped. @param {string} message @returns {string[]} */
export function words(message) {
  const flat = message.replaceAll("\n", " ").replaceAll("\t", " ").replaceAll("\r", " ")
  /** @type {string[]} */
  const out = []
  for (const raw of flat.split(" ")) {
    const chars = Array.from(raw)
    let a = 0
    let b = chars.length
    while (a < b && !isLetter(chars[a]) && !isDigit(chars[a])) a++
    while (b > a && !isLetter(chars[b - 1]) && !isDigit(chars[b - 1])) b--
    if (b > a) out.push(chars.slice(a, b).join(""))
  }
  return out
}

/** @param {string} ch */
function isDigit(ch) {
  const c = ch.charCodeAt(0)
  return c >= 48 && c <= 57
}

/**
 * A note's grammar, the thing the art grows from. A sentence ends at `.`, `!`,
 * `?` or `…`; a run of the same mark counts (`!!!` is three bangs). Emoji are
 * collected per sentence. Commas are counted per sentence, by word index.
 * @typedef {{ words: string[], end: "" | "." | "!" | "?", marks: number,
 *   commas: number[], emoji: string[] }} Sentence
 * @param {string} message @returns {Sentence[]}
 */
export function sentences(message) {
  /** @type {Sentence[]} */
  const out = []
  /** @type {Sentence} */
  let cur = { words: [], end: "", marks: 0, commas: [], emoji: [] }
  let word = ""
  const chars = Array.from(message)
  const flushWord = () => {
    if (word) cur.words.push(word)
    word = ""
  }
  const flushSentence = () => {
    flushWord()
    if (cur.words.length || cur.emoji.length) out.push(cur)
    cur = { words: [], end: "", marks: 0, commas: [], emoji: [] }
  }
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const cp = ch.codePointAt(0) || 0
    if (isEmojiCode(cp)) {
      flushWord()
      let glyph = ch
      while (i + 1 < chars.length && isEmojiGlue(chars[i + 1].codePointAt(0) || 0)) {
        glyph += chars[++i]
      }
      cur.emoji.push(glyph)
      continue
    }
    if (isEmojiGlue(cp)) continue
    if (ch === "!" || ch === "?" || ch === "." || ch === "…") {
      // A dot inside a token ("10.5", "a.m.") is not a sentence end.
      const next = chars[i + 1]
      if (ch === "." && next && !isSpace(next) && next !== "." && next !== "!" && next !== "?") {
        word += ch
        continue
      }
      flushWord()
      const mark = ch === "…" ? "." : ch
      let n = ch === "…" ? 3 : 1
      while (i + 1 < chars.length && (chars[i + 1] === ch || chars[i + 1] === "!" || chars[i + 1] === "?")) {
        i++
        n++
      }
      if (cur.words.length === 0 && out.length) {
        // Stray marks after an emoji-only or empty run attach to the previous sentence.
        const prev = out[out.length - 1]
        prev.marks += n
        continue
      }
      cur.end = /** @type {"." | "!" | "?"} */ (mark)
      cur.marks = n
      flushSentence()
      continue
    }
    if (ch === "," || ch === ";" || ch === ":") {
      flushWord()
      cur.commas.push(cur.words.length)
      continue
    }
    if (isSpace(ch)) {
      flushWord()
      continue
    }
    if (isLetter(ch) || isDigit(ch) || ch === "'" || ch === "’" || ch === "-") word += ch
  }
  flushSentence()
  return out
}

/** @param {string} ch */
function isSpace(ch) {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r"
}

export const STOPWORDS = new Set(
  (
    "a an the and or but so of to in on at for with from by is are was were be been am i you " +
    "your yours we our us me my it its this that these those as if then than there here " +
    "what when who how all any both each more most much many very just not no yes do did " +
    "have has had will would can could should may might one two too also into out up down " +
    "about over again still ever even only really such some own same well love lots thank " +
    "thanks congrats congratulations dear both who it's i'm you're we're that's here's let " +
    "them they their he she his her him being every everyone something nothing"
  ).split(" "),
)

/** Content words, lowercased and accent-folded, length ≥ 4, stopwords dropped.
 *  @param {string} message @returns {string[]} */
export function salientWords(message) {
  /** @type {string[]} */
  const out = []
  for (const w of words(message)) {
    const lw = w.toLowerCase()
    if (STOPWORDS.has(lw)) continue
    const folded = foldLetters(w)
    if (folded.length >= 4 && !STOPWORDS.has(folded)) out.push(folded)
  }
  return out
}

/** A light stemmer so "danced"/"dancing"/"dance" and "vows"/"vow" meet.
 *  @param {string} w */
export function stem(w) {
  for (const suf of ["ing", "ed", "es", "s", "e"]) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) return w.slice(0, -suf.length)
  }
  return w
}

const HONORIFICS = new Set(
  "little auntie aunt uncle cousin grandma grandpa nana papa professor prof dr mr mrs ms mx the family age and".split(
    " ",
  ),
)

/** The word in an author line that reads as a name: "Little Maya (age 7)" → "Maya",
 *  "The Abernathy-Nguyen Family" → "Abernathy", "Henrietta "Hen" Vasquez" → "Henrietta".
 *  @param {string} author */
export function keyName(author) {
  for (const raw of words(author)) {
    const w = raw.split("-")[0]
    const lw = foldLetters(w)
    if (lw.length < 2 || HONORIFICS.has(lw)) continue
    if (isDigit(w.charAt(0))) continue
    return w.charAt(0).toUpperCase() + w.slice(1)
  }
  return author.trim().split(" ")[0] || "Guest"
}

/** Initials for a seal: up to two letters. @param {string} author */
export function initials(author) {
  const ws = words(author).filter((w) => !HONORIFICS.has(foldLetters(w)))
  const a = ws[0] ? ws[0].charAt(0) : "?"
  const b = ws.length > 1 ? ws[ws.length - 1].charAt(0) : ""
  return (a + b).toUpperCase()
}

/** "2026-05-01 16:42:00" → "1 May 2026". @param {string} ts */
export function longDate(ts) {
  const [d] = ts.split(" ")
  const [y, m, day] = d.split("-")
  const MONTHS = "January February March April May June July August September October November December".split(" ")
  return Number(day) + " " + MONTHS[Number(m) - 1] + " " + y
}

/** Hour of day 0–23 from the fixture's timestamp. @param {string} ts */
export function hourOf(ts) {
  const t = ts.split(" ")[1] || "12:00"
  return Number(t.split(":")[0])
}

/** Escape for HTML/SVG text and attributes. @param {unknown} v */
export function esc(v) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
