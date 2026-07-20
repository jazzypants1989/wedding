/** @file Sound lab — a STUDIO-ONLY WebAudio sound-design prototype.
 *
 *  ⚠️ DECISION PROTOTYPE — wired to nothing else in the app. It exists only so
 *  the owner can audition four *synthesized* audio cues (no asset files — every
 *  sound is generated live via the WebAudio API) before deciding whether any
 *  sound belongs in the thank-you card reveal.
 *
 *  If approved: the four pure synth functions below (playSealCrack,
 *  playPaperRustle, playSoftChime, playCorkPop) are written to be lifted
 *  verbatim into a new `public/pages/thanks/card-sound.js`. There they would be
 *  gated behind a MUTED-BY-DEFAULT toggle AND `prefers-reduced-motion`, sharing
 *  one lazily-created AudioContext exactly as they do here. Each takes the
 *  shared `ctx`, a destination node, a plain params object, and an absolute
 *  start time (`when`) — no globals, no DOM — precisely so they port cleanly.
 *
 *  Studio-only conventions honoured: zero deps (WebAudio is built in), no regex,
 *  ESM .js imports, JSDoc types in ./types.d.ts. Lives entirely under
 *  public/pages/studio/ and touches no other feature.
 */
/** @import * as Types from "./types.js" */

import { getElement, getButtonElement, getInputElement } from "../utils.js"

// ---- Shared audio graph (lazy — autoplay policy needs a user gesture) -------

/** @type {AudioContext | null} */
let ctx = null
/** @type {GainNode | null} */
let master = null
let masterLevel = 0.4
let muted = false

/**
 * Get (creating on first call) the shared AudioContext + master gain. Created
 * lazily so the very first click satisfies the browser autoplay policy; resumed
 * on every call in case the tab suspended it.
 * @returns {{ ctx: AudioContext, master: GainNode }}
 */
function audio() {
  if (!ctx || !master) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : masterLevel
    master.connect(ctx.destination)
  }
  if (ctx.state === "suspended") void ctx.resume()
  return { ctx, master }
}

/** Push the current master level / mute state onto the live gain node. */
function applyMasterGain() {
  if (!ctx || !master) return
  const target = muted ? 0.0001 : Math.max(0.0001, masterLevel)
  master.gain.setTargetAtTime(target, ctx.currentTime, 0.01)
}

/**
 * Fill a mono buffer with white noise — the raw material for the crack, rustle,
 * and fizz cues.
 * @param {AudioContext} c @param {number} seconds @returns {AudioBuffer}
 */
function noiseBuffer(c, seconds) {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

// ---- The four synth voices (pure — safe to lift into the thanks page) -------

/**
 * 1. Seal crack — the wax seal snapping: a short bandpassed noise burst plus a
 *    fast pitch-down click transient, like brittle wax breaking.
 * @type {Types.SoundSynth}
 */
export function playSealCrack(c, dest, p, when) {
  const t = when
  const dur = p.duration

  // Bandpassed noise body (~2–4 kHz snap).
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, dur + 0.02)
  const bp = c.createBiquadFilter()
  bp.type = "bandpass"
  bp.frequency.value = p.freq
  bp.Q.value = 1.4
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, p.level), t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(bp).connect(g).connect(dest)
  src.start(t)
  src.stop(t + dur + 0.02)

  // Pitch-down click transient (~40 ms) — the "snap".
  const osc = c.createOscillator()
  osc.type = "triangle"
  osc.frequency.setValueAtTime(Math.max(60, p.freq * 0.9), t)
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.04)
  const og = c.createGain()
  og.gain.setValueAtTime(0.0001, t)
  og.gain.exponentialRampToValueAtTime(Math.max(0.0001, p.level * 0.8), t + 0.002)
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
  osc.connect(og).connect(dest)
  osc.start(t)
  osc.stop(t + 0.06)
}

/**
 * 2. Paper rustle — the envelope unfolding: lowpassed noise whose cutoff sweeps
 *    ~1k→4k and back, under a gentle amplitude swell.
 * @type {Types.SoundSynth}
 */
export function playPaperRustle(c, dest, p, when) {
  const t = when
  const dur = p.duration

  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, dur + 0.05)
  const lp = c.createBiquadFilter()
  lp.type = "lowpass"
  lp.Q.value = 0.7
  lp.frequency.setValueAtTime(1000, t)
  lp.frequency.linearRampToValueAtTime(p.peak, t + dur / 2)
  lp.frequency.linearRampToValueAtTime(1000, t + dur)

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, p.level), t + dur * 0.4)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(lp).connect(g).connect(dest)
  src.start(t)
  src.stop(t + dur + 0.05)
}

/**
 * 3. Soft chime — the card revealed: four slightly-detuned sine partials in a
 *    warm major-ish cluster, each with an exponential decay tail. Quiet.
 * @type {Types.SoundSynth}
 */
export function playSoftChime(c, dest, p, when) {
  const t = when
  const dur = p.duration
  // root, major third (5/4), fifth (3/2), octave — a warm add-ish cluster.
  const ratios = [1, 1.25, 1.5, 2]
  const detune = [0, 4, -3, 6]
  for (let i = 0; i < ratios.length; i++) {
    const osc = c.createOscillator()
    osc.type = "sine"
    osc.frequency.value = p.baseFreq * ratios[i]
    osc.detune.value = detune[i]
    const g = c.createGain()
    const peak = Math.max(0.0001, p.level * (1 - i * 0.16))
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02 + i * 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(dest)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }
}

/**
 * 4. Cork pop — the champagne moment: a resonant sine pitch-drop (~400→80 Hz
 *    over ~80 ms) followed by a tiny high-passed noise fizz tail.
 * @type {Types.SoundSynth}
 */
export function playCorkPop(c, dest, p, when) {
  const t = when
  const dur = p.duration

  const osc = c.createOscillator()
  osc.type = "sine"
  osc.frequency.setValueAtTime(p.startFreq, t)
  osc.frequency.exponentialRampToValueAtTime(80, t + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, p.level), t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02)
  osc.connect(g).connect(dest)
  osc.start(t)
  osc.stop(t + dur + 0.05)

  // Fizz tail.
  const fizzDur = 0.25
  const ft = t + dur
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, fizzDur)
  const hp = c.createBiquadFilter()
  hp.type = "highpass"
  hp.frequency.value = 5000
  const fg = c.createGain()
  fg.gain.setValueAtTime(0.0001, ft)
  fg.gain.exponentialRampToValueAtTime(Math.max(0.0001, p.level * 0.15), ft + 0.01)
  fg.gain.exponentialRampToValueAtTime(0.0001, ft + fizzDur)
  src.connect(hp).connect(fg).connect(dest)
  src.start(ft)
  src.stop(ft + fizzDur)
}

// ---- Cue registry -----------------------------------------------------------

/**
 * Build a cue's live `values` map from its params' defaults.
 * @param {Types.SoundParam[]} params @returns {Record<string, number>}
 */
function seedValues(params) {
  /** @type {Record<string, number>} */
  const values = {}
  for (const param of params) values[param.key] = param.value
  return values
}

/**
 * @param {Omit<Types.SoundCue, "values">} cue @returns {Types.SoundCue}
 */
function makeCue(cue) {
  return { ...cue, values: seedValues(cue.params) }
}

/** @type {Types.SoundCue[]} */
const CUES = [
  makeCue({
    id: "seal-crack",
    label: "Seal crack",
    offset: 0.0,
    play: playSealCrack,
    params: [
      { key: "freq", label: "Band center", min: 1500, max: 5000, step: 50, value: 3000, unit: "Hz" },
      { key: "duration", label: "Duration", min: 0.02, max: 0.12, step: 0.005, value: 0.05, unit: "s" },
      { key: "level", label: "Level", min: 0, max: 1, step: 0.02, value: 0.6, unit: "level" },
    ],
  }),
  makeCue({
    id: "paper-rustle",
    label: "Paper rustle",
    offset: 0.35,
    play: playPaperRustle,
    params: [
      { key: "duration", label: "Duration", min: 0.3, max: 0.8, step: 0.01, value: 0.55, unit: "s" },
      { key: "peak", label: "Sweep peak", min: 2500, max: 6000, step: 100, value: 4000, unit: "Hz" },
      { key: "level", label: "Level", min: 0, max: 1, step: 0.02, value: 0.25, unit: "level" },
    ],
  }),
  makeCue({
    id: "soft-chime",
    label: "Soft chime",
    offset: 1.3,
    play: playSoftChime,
    params: [
      { key: "baseFreq", label: "Root freq", min: 330, max: 660, step: 2, value: 528, unit: "Hz" },
      { key: "duration", label: "Decay", min: 1.2, max: 2.2, step: 0.05, value: 1.6, unit: "s" },
      { key: "level", label: "Level", min: 0, max: 0.5, step: 0.01, value: 0.18, unit: "level" },
    ],
  }),
  makeCue({
    id: "cork-pop",
    label: "Cork pop",
    offset: 3.2,
    play: playCorkPop,
    params: [
      { key: "startFreq", label: "Pop start", min: 250, max: 600, step: 10, value: 420, unit: "Hz" },
      { key: "duration", label: "Pop drop", min: 0.05, max: 0.15, step: 0.005, value: 0.08, unit: "s" },
      { key: "level", label: "Level", min: 0, max: 1, step: 0.02, value: 0.5, unit: "level" },
    ],
  }),
]

// ---- Rendering / wiring -----------------------------------------------------

/** @param {Types.SoundParam} param @param {number} value @returns {string} */
function formatValue(param, value) {
  if (param.unit === "Hz") return Math.round(value) + " Hz"
  if (param.unit === "s") return value.toFixed(3) + " s"
  return value.toFixed(2)
}

/** @param {string} message @param {"ok" | "err"} kind */
function flash(message, kind) {
  const el = getElement("sound-flash")
  el.textContent = message
  el.className = "flash flash-" + kind
}

/** Fire one cue immediately (small lead so scheduling never lands in the past). */
/** @param {Types.SoundCue} cue */
function playCue(cue) {
  const { ctx: c, master: dest } = audio()
  cue.play(c, dest, cue.values, c.currentTime + 0.03)
  flash("Playing " + cue.label, "ok")
}

/** Play all four cues spaced along the reveal arc so the owner hears the flow. */
function playSequence() {
  const { ctx: c, master: dest } = audio()
  const base = c.currentTime + 0.05
  for (const cue of CUES) cue.play(c, dest, cue.values, base + cue.offset)
  flash("Playing sequence (crack → rustle → chime → pop)", "ok")
}

/**
 * Build one slider row (reusing the studio's .control markup) wired to a cue's
 * live value. The readout keeps the current value visible for transcription.
 * @param {Types.SoundCue} cue @param {Types.SoundParam} param
 * @returns {HTMLDivElement}
 */
function buildSlider(cue, param) {
  const row = document.createElement("div")
  row.className = "control"

  const head = document.createElement("div")
  head.className = "control-head"
  const label = document.createElement("label")
  const inputId = "snd-" + cue.id + "-" + param.key
  label.htmlFor = inputId
  label.textContent = param.label
  const readout = document.createElement("span")
  readout.className = "readout"
  readout.textContent = formatValue(param, cue.values[param.key])
  head.append(label, readout)

  const inputs = document.createElement("div")
  inputs.className = "control-inputs"
  const range = document.createElement("input")
  range.type = "range"
  range.id = inputId
  range.min = String(param.min)
  range.max = String(param.max)
  range.step = String(param.step)
  range.value = String(cue.values[param.key])
  range.addEventListener("input", () => {
    const next = Number(range.value)
    cue.values[param.key] = next
    readout.textContent = formatValue(param, next)
  })
  inputs.appendChild(range)

  row.append(head, inputs)
  return row
}

/** @param {Types.SoundCue} cue @returns {HTMLDivElement} */
function buildCueCard(cue) {
  const card = document.createElement("div")
  card.className = "sound-cue"

  const head = document.createElement("div")
  head.className = "sound-cue-head"
  const title = document.createElement("span")
  title.className = "sound-cue-title"
  title.textContent = cue.label
  const playBtn = document.createElement("button")
  playBtn.type = "button"
  playBtn.className = "ctrl-btn primary"
  playBtn.textContent = "▶ Play"
  playBtn.addEventListener("click", () => playCue(cue))
  head.append(title, playBtn)

  card.appendChild(head)
  for (const param of cue.params) card.appendChild(buildSlider(cue, param))
  return card
}

function initSoundLab() {
  const list = getElement("sound-cues")
  for (const cue of CUES) list.appendChild(buildCueCard(cue))

  const masterRange = getInputElement("sound-master-range")
  const masterReadout = getElement("sound-master-readout")
  masterRange.value = String(masterLevel)
  masterReadout.textContent = masterLevel.toFixed(2)
  masterRange.addEventListener("input", () => {
    masterLevel = Number(masterRange.value)
    masterReadout.textContent = masterLevel.toFixed(2)
    applyMasterGain()
  })

  const muteBtn = getButtonElement("sound-mute-btn")
  muteBtn.addEventListener("click", () => {
    muted = !muted
    muteBtn.textContent = muted ? "🔇 Muted" : "🔊 Sound on"
    muteBtn.classList.toggle("active", muted)
    applyMasterGain()
  })

  getButtonElement("sound-sequence-btn").addEventListener("click", playSequence)
}

initSoundLab()
