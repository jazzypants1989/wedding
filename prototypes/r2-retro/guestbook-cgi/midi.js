/** @file canon_in_d.mid — Pachelbel's Canon (public domain, 1680s) played the
 *  way a 1999 homepage played it: General-MIDI-ish square and triangle voices
 *  through a SoundBlaster-dull lowpass. Pure WebAudio, no samples, no file.
 *
 *  Never autoplays: start() must be called from a click, and audioContext()
 *  refuses under prefers-reduced-motion.
 */

import { audioContext } from "../shared/kit.js"

/** Note name → Hz. "F#4" style, no regex: letter, optional #, octave digit.
 *  @param {string} name */
function hz(name) {
  const SEMI = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }
  const letter = /** @type {keyof typeof SEMI} */ (name[0])
  const sharp = name[1] === "#"
  const octave = Number(name[sharp ? 2 : 1])
  const n = SEMI[letter] + (sharp ? 1 : 0) + (octave - 4) * 12
  return 440 * Math.pow(2, n / 12)
}

const BEAT = 0.75 // seconds per ground-bass note
const BASS = ["D3", "A2", "B2", "F#2", "G2", "D2", "G2", "A2"]
const CHORDS = [
  ["D4", "F#4", "A4"],
  ["C#4", "E4", "A4"],
  ["D4", "F#4", "B4"],
  ["C#4", "F#4", "A4"],
  ["B3", "D4", "G4"],
  ["A3", "D4", "F#4"],
  ["B3", "D4", "G4"],
  ["C#4", "E4", "A4"],
]
/** Upper voices, one array per pass of the ground. Each note gets an equal
 *  share of the bar's beats. */
const MELODY = [
  [],
  ["F#5", "E5", "D5", "C#5", "B4", "A4", "B4", "C#5"],
  ["D5", "C#5", "B4", "A4", "G4", "F#4", "G4", "E4"],
  ["D4", "F#4", "A4", "G4", "F#4", "D4", "F#4", "E4", "D4", "B3", "D4", "A4", "G4", "B4", "A4", "G4"],
  ["F#4", "D4", "E4", "C#5", "D5", "F#5", "A5", "A4", "B4", "G4", "A4", "F#4", "D4", "D5", "D5", "C#5"],
]

/** @typedef {{ stop: () => void, elapsed: () => number }} Playing */

/** @param {number} [volume] 0..1 @returns {Playing | null} */
export function playCanon(volume) {
  const ac = audioContext()
  if (!ac) return null
  const master = ac.createGain()
  master.gain.value = 0.07 * (volume === undefined ? 1 : volume)
  const lp = ac.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = 2200
  lp.connect(master)
  master.connect(ac.destination)
  const t0 = ac.currentTime + 0.05
  /** @type {OscillatorNode[]} */
  const live = []
  let scheduledUntil = t0
  let pass = 0

  /** @param {string} note @param {number} at @param {number} dur @param {OscillatorType} type @param {number} level */
  function tone(note, at, dur, type, level) {
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = type
    o.frequency.value = hz(note)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(level, at + 0.012)
    g.gain.setValueAtTime(level * 0.7, at + dur * 0.6)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.98)
    o.connect(g)
    g.connect(lp)
    o.start(at)
    o.stop(at + dur)
    live.push(o)
    o.onended = () => {
      const i = live.indexOf(o)
      if (i >= 0) live.splice(i, 1)
    }
  }

  function schedulePass() {
    const base = scheduledUntil
    const tune = MELODY[pass % MELODY.length]
    for (let i = 0; i < BASS.length; i++) {
      const at = base + i * BEAT
      tone(BASS[i], at, BEAT, "triangle", 0.9)
      // Broken-chord eighths: the MIDI-file "harpsichord".
      CHORDS[i].forEach((n, j) => tone(n, at + (j * BEAT) / 3, BEAT / 3, "square", 0.18))
    }
    if (tune.length > 0) {
      const each = (BASS.length * BEAT) / tune.length
      tune.forEach((n, i) => tone(n, base + i * each, each, "square", 0.32))
    }
    scheduledUntil = base + BASS.length * BEAT
    pass++
  }

  schedulePass()
  // Keep one pass of headroom scheduled; a MIDI loop never ends.
  const tick = setInterval(() => {
    if (scheduledUntil - ac.currentTime < BEAT * 3) schedulePass()
  }, 250)

  return {
    stop() {
      clearInterval(tick)
      const now = ac.currentTime
      master.gain.setTargetAtTime(0, now, 0.05)
      for (const o of live.slice()) {
        try {
          o.stop(now + 0.2)
        } catch {}
      }
      setTimeout(() => master.disconnect(), 400)
    },
    elapsed() {
      return Math.max(0, ac.currentTime - t0)
    },
  }
}
