/** @file Entry → tune. The deterministic heart of the music-box sketches.
 *
 *  Pure: no DOM, no audio, no clock, no randomness. The same entry gives the
 *  same tune on every visit, on every device, on screen and in print.
 *
 *  The pitches spell the signer's NAME in the old French musical-cryptogram
 *  style: the letters run A B C D E F G, then wrap (H = A, I = B, … O = A …),
 *  so every letter is a white key and any name is a diatonic phrase. Each
 *  note picks the octave nearest the one before it, so the phrase moves by
 *  step and small leap instead of jumping registers.
 *
 *  The rhythm comes from the MESSAGE: note k takes its length from word k
 *  (cycled). Short words are quick, long words linger.
 *
 *  Hearts close the phrase on a chord; a pinned favourite adds a bell an
 *  octave up. No regex (CLAUDE.md): string methods and char codes only.
 */

/** Lanes on the roll: two octaves of white keys, C4 (lane 0) to B5 (lane 13). */
export const LANES = 14

const NOTE_NAMES = ["C", "D", "E", "F", "G", "A", "B"]
/** Semitones above C for each white key. */
const WHITE = [0, 2, 4, 5, 7, 9, 11]
/** French cryptogram: letter index mod 7 → A B C D E F G → scale degree (C = 0). */
const CRYPTO_DEGREE = [5, 6, 0, 1, 2, 3, 4]
/** Pentatonic alternative: letter index mod 5 → C D E G A. */
const PENTA_DEGREE = [0, 1, 2, 4, 5]

/** Letters NFD does not decompose. Checked by a Map lookup, not a pattern. */
const FOLD = new Map([
  ["ø", "o"],
  ["æ", "ae"],
  ["œ", "oe"],
  ["ß", "ss"],
  ["ł", "l"],
  ["đ", "d"],
  ["þ", "th"],
  ["ð", "d"],
])

/** The longest phrase we spell. Long family names would otherwise run on. */
export const MAX_NOTES = 20

/**
 * A name's letters, accents folded, a–z only.
 * @param {string} name @returns {string}
 */
export function lettersOf(name) {
  const folded = String(name || "")
    .normalize("NFD")
    .toLowerCase()
  let out = ""
  for (const ch of folded) {
    const c = ch.charCodeAt(0)
    if (c >= 97 && c <= 122) out += ch
    else {
      const f = FOLD.get(ch)
      if (f) out += f
    }
  }
  return out
}

/**
 * The letters a tune is spelled from. A name with no Latin letters at all
 * (田中, Οδυσσέας, محمد) still gets a tune: each code point picks a letter,
 * so it is deterministic, just not a readable cryptogram.
 * @param {string} name @returns {string}
 */
export function tuneLetters(name) {
  const latin = lettersOf(name)
  if (latin.length > 0) return latin.slice(0, MAX_NOTES)
  let out = ""
  for (const ch of String(name)) {
    const cp = ch.codePointAt(0) || 0
    if (cp > 32) out += String.fromCharCode(97 + (cp % 26))
  }
  return (out || "aguest").slice(0, MAX_NOTES)
}

/**
 * Words of a message, split on whitespace without a pattern.
 * @param {string} message @returns {string[]}
 */
export function wordsOf(message) {
  const flat = String(message || "")
    .replaceAll("\n", " ")
    .replaceAll("\t", " ")
  return flat.split(" ").filter((w) => w.length > 0)
}

/** @param {string} word @returns {number} beats in eighth-note units */
function beatsFor(word) {
  let n = 0
  for (const ch of word) {
    const c = ch.toLowerCase().charCodeAt(0)
    if ((c >= 97 && c <= 122) || c > 191) n++
  }
  if (n <= 3) return 1
  if (n <= 6) return 2
  return 3
}

/**
 * The lane (0..13) of the nearest octave of `degree` to `prev`.
 * @param {number} degree 0..6 @param {number} prev @returns {number}
 */
function nearestLane(degree, prev) {
  const lo = degree
  const hi = degree + 7
  return Math.abs(lo - prev) <= Math.abs(hi - prev) ? lo : hi
}

/**
 * @typedef {{
 *   lane: number,
 *   letter: string,
 *   name: string,
 *   start: number,
 *   dur: number,
 *   chord: number[],
 *   bell: boolean
 * }} MotifNote
 * @typedef {{
 *   notes: MotifNote[],
 *   units: number,
 *   spelled: string,
 *   hearts: number,
 *   favourite: boolean
 * }} Motif
 * @typedef {{ author_name?: string, message?: string, reactions?: Record<string, { count: number }>, favourite?: boolean }} MotifEntry
 */

/**
 * Turn one guestbook entry into a tune.
 * @param {MotifEntry} entry
 * @param {{ scale?: "cryptogram" | "pentatonic" }} [opts]
 * @returns {Motif}
 */
export function motifFor(entry, opts) {
  const scale = opts && opts.scale === "pentatonic" ? "pentatonic" : "cryptogram"
  const letters = tuneLetters(entry.author_name || "A guest")
  const words = wordsOf(entry.message || "")
  const hearts = (entry.reactions && entry.reactions.heart && entry.reactions.heart.count) || 0
  const favourite = Boolean(entry.favourite)

  /** @type {MotifNote[]} */
  const notes = []
  let prev = 6.5
  let t = 0
  for (let k = 0; k < letters.length; k++) {
    const idx = letters.charCodeAt(k) - 97
    const degree = scale === "pentatonic" ? PENTA_DEGREE[idx % 5] : CRYPTO_DEGREE[idx % 7]
    const lane = nearestLane(degree, prev)
    prev = lane
    const dur = words.length > 0 ? beatsFor(words[k % words.length]) : 2
    notes.push({
      lane,
      letter: letters[k].toUpperCase(),
      name: NOTE_NAMES[lane % 7],
      start: t,
      dur,
      chord: [],
      bell: false,
    })
    t += dur
  }

  const last = notes[notes.length - 1]
  if (last && hearts > 0) {
    // A third below, then a fifth below; if that falls off the roll, stack up.
    const voices = hearts >= 5 ? [-2, -4] : [-2]
    last.chord = voices.map((v) => (last.lane + v >= 0 ? last.lane + v : last.lane - v))
    last.dur += 2
    t += 2
  }
  if (last && favourite) last.bell = true

  return {
    notes,
    units: t,
    spelled: notes.map((n) => n.name).join(" "),
    hearts,
    favourite,
  }
}

/**
 * MIDI number of a lane. C4 = 60.
 * @param {number} lane @returns {number}
 */
export function midiOf(lane) {
  const oct = Math.floor(lane / 7)
  const deg = ((lane % 7) + 7) % 7
  return 60 + 12 * oct + WHITE[deg]
}

/** @param {number} midi @returns {number} Hz, A4 = 440 */
export function hzOf(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}
