/** @file Sound lab — a STUDIO-ONLY WebAudio sound-design prototype.
 *
 *  ⚠️ DECISION PROTOTYPE — wired to nothing else in the app. It exists only so
 *  the owner can audition the *synthesized* audio cues (no asset files — every
 *  sound is generated live via the WebAudio API) before deciding whether any
 *  sound belongs in the thank-you card reveal.
 *
 *  The four cues follow the reveal arc: a sealed-envelope TAP → the envelope
 *  OPENS → the words CASCADE onto the card → a CELEBRATION pop. The register is
 *  an intimate, warm, analog wedding card: stationery ASMR + music box, quiet
 *  and reverberant — never game SFX.
 *
 *  Craft used to get there (all pure WebAudio, no samples):
 *   • Shared procedural reverb — a stereo impulse response is synthesized into
 *     an AudioBuffer (exponentially decaying noise, one-pole-darkened tail) and
 *     run through a ConvolverNode with a ~15 ms pre-delay. Every cue sends a
 *     cue-dependent wet amount; dry + wet mix through a master gain into a gentle
 *     bus compressor. This is the single biggest upgrade: "sound in a room", not
 *     "beep in a void".
 *   • Every cue is layered (2–4 components at staggered offsets), lightly
 *     randomized per play, and panned per-grain so repeats feel alive and wide.
 *   • Envelopes start/end at true near-zero (linear-up → exponential-down) so no
 *     click survives at any slider position. Loudness is balanced across cues
 *     (the bell cascade sits quieter than the tap/pop).
 *
 *  If approved: the four pure synth functions below (plus buildImpulse / audio's
 *  reverb bus) lift into a new `public/pages/thanks/card-sound.js`, gated behind
 *  a MUTED-BY-DEFAULT toggle AND `prefers-reduced-motion`, sharing one lazily-
 *  created AudioContext + reverb bus exactly as they do here. Each synth takes
 *  the shared `ctx`, a { dry, wet } bus, a plain params object, and an absolute
 *  start time (`when`) — no globals, no DOM — precisely so they port cleanly.
 *
 *  Studio-only conventions honoured: zero deps (WebAudio is built in), no regex,
 *  ESM .js imports, JSDoc types in ./types.d.ts. Lives entirely under
 *  public/pages/studio/ and touches no other feature.
 */
/** @import * as Types from "./types.js" */

import { getElement, getButtonElement, getInputElement, getTextAreaElement } from "../utils.js"

// ---- Shared audio graph (lazy — autoplay policy needs a user gesture) -------

/** @type {AudioContext | null} */
let ctx = null
/** @type {GainNode | null} */
let master = null
/** @type {Types.SoundBus | null} */
let bus = null
let masterLevel = 0.4
let muted = false

// ---- Decision capture state (Jordana's per-beat verdict) --------------------

/**
 * The current per-beat selection, keyed by cue/beat id. `null` until picked (or
 * restored from a saved decision). A value is "synth:<beat>", "sample:<file-id>",
 * or "none" (silent) — the exact string the server whitelists.
 * @type {Record<string, string | null>}
 */
const decisionChoices = {
  "envelope-tap": null,
  "envelope-open": null,
  "word-cascade": null,
  celebration: null,
}

/**
 * `${cueId}:${paramKey}` → a function that writes a value onto the live cue AND
 * its slider + readout, so a restored decision can push saved synthParams back
 * onto the UI. Populated as sliders are built.
 * @type {Map<string, (value: number) => void>}
 */
const sliderUpdaters = new Map()

/** ISO timestamp of the last saved decision (loaded on open / set on save). */
let lastSavedAt = ""

/**
 * Synthesize a stereo reverb impulse response into an AudioBuffer: decaying
 * noise per channel with a one-pole lowpass whose smoothing deepens over the
 * tail (so the reverb darkens as it fades — like a warm room, not a plate).
 * The `Math.pow(1 - t, decay)` envelope hits exactly zero at the end, so the
 * convolved tail never clicks.
 * @param {AudioContext} c @param {number} seconds @param {number} decay
 * @returns {AudioBuffer}
 */
function buildImpulse(c, seconds, decay) {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds))
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      // Coefficient falls from ~0.6 (bright, early) to ~0.16 (dark tail).
      const a = 0.6 * (1 - t * 0.72)
      lp += a * (Math.random() * 2 - 1 - lp)
      data[i] = lp * Math.pow(1 - t, decay)
    }
  }
  return buf
}

/**
 * Get (creating on first call) the shared AudioContext, master gain, and reverb
 * bus. Graph: cue layers → { dry, wet }; dry → master; wet = preDelay →
 * convolver → wetGain → master; master → soft compressor → destination.
 * @returns {{ ctx: AudioContext, master: GainNode, bus: Types.SoundBus }}
 */
function audio() {
  if (!ctx || !master || !bus) {
    ctx = new AudioContext()

    master = ctx.createGain()
    master.gain.value = muted ? 0.0001 : masterLevel

    // Gentle glue compressor — tames layered peaks, adds "expensive" cohesion.
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.knee.value = 26
    comp.ratio.value = 2.2
    comp.attack.value = 0.003
    comp.release.value = 0.25
    master.connect(comp).connect(ctx.destination)

    // Dry path.
    const dry = ctx.createGain()
    dry.gain.value = 1
    dry.connect(master)

    // Wet path: pre-delay keeps transients crisp before the tail blooms.
    const preDelay = ctx.createDelay(0.1)
    preDelay.delayTime.value = 0.015
    const convolver = ctx.createConvolver()
    convolver.buffer = buildImpulse(ctx, 1.6, 2.4)
    const wetGain = ctx.createGain()
    wetGain.gain.value = 0.9
    preDelay.connect(convolver).connect(wetGain).connect(master)

    bus = { dry, wet: preDelay }
  }
  if (ctx.state === "suspended") void ctx.resume()
  return { ctx, master, bus }
}

/** Push the current master level / mute state onto the live gain node. */
function applyMasterGain() {
  if (!ctx || !master) return
  const target = muted ? 0.0001 : Math.max(0.0001, masterLevel)
  master.gain.setTargetAtTime(target, ctx.currentTime, 0.01)
}

// ---- Synthesis helpers (pure — lift alongside the voices) -------------------

/**
 * Fill a mono buffer with white noise — raw material for taps, rustle, fizz.
 * @param {AudioContext} c @param {number} seconds @returns {AudioBuffer}
 */
function noiseBuffer(c, seconds) {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/**
 * Route one finished layer node into the dry bus and (optionally) send a copy
 * to the reverb. Keeping wet per-layer lets each cue pick its own space.
 * @param {AudioContext} c @param {AudioNode} node @param {Types.SoundBus} b
 * @param {number} wet Send level (0 = fully dry).
 */
function route(c, node, b, wet) {
  node.connect(b.dry)
  if (wet > 0) {
    const send = c.createGain()
    send.gain.value = wet
    node.connect(send)
    send.connect(b.wet)
  }
}

/** Random stereo pan in [-spread, spread]. @param {number} spread */
function rpan(spread) {
  return (Math.random() * 2 - 1) * spread
}

/**
 * Schedule one short bandpassed noise grain (the atom of tap clusters, paper
 * rustle, and champagne fizz). Linear attack from near-zero → exponential tail,
 * so it never clicks. Panned.
 * @param {AudioContext} c @param {Types.SoundBus} b
 * @param {number} t @param {number} len @param {"bandpass" | "highpass"} type
 * @param {number} freq @param {number} q @param {number} peak
 * @param {number} pan @param {number} wet
 */
function grain(c, b, t, len, type, freq, q, peak, pan, wet) {
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, len + 0.004)
  const filt = c.createBiquadFilter()
  filt.type = type
  filt.frequency.value = freq
  filt.Q.value = q
  const g = c.createGain()
  const top = Math.max(0.0001, peak)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(top, t + Math.min(0.002, len * 0.3))
  g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  const pn = c.createStereoPanner()
  pn.pan.value = pan
  src.connect(filt).connect(g).connect(pn)
  route(c, pn, b, wet)
  src.start(t)
  src.stop(t + len + 0.004)
}

/**
 * Schedule one warm bell note: a beating fundamental (two slightly-detuned
 * sines, ~1–2 Hz beat) plus quiet inharmonic partials (2.76, 5.40 — stretched,
 * bell-like), summed through a warmth lowpass, panned, generously reverbed.
 * Highs decay faster than the fundamental. Gentle 10 ms attack.
 * @param {AudioContext} c @param {Types.SoundBus} b
 * @param {number} freq @param {number} peak @param {number} t
 * @param {number} decay @param {number} warmth @param {number} pan
 * @param {number} wet
 */
function bellNote(c, b, freq, peak, t, decay, warmth, pan, wet) {
  const out = c.createGain()
  out.gain.value = 1
  const lp = c.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = 850 + warmth * 5200
  lp.Q.value = 0.5
  const pn = c.createStereoPanner()
  pn.pan.value = pan
  out.connect(lp).connect(pn)
  route(c, pn, b, wet)

  /** @param {number} f @param {number} lvl @param {number} dec @param {number} det */
  const voice = (f, lvl, dec, det) => {
    const o = c.createOscillator()
    o.type = "sine"
    o.frequency.value = f
    o.detune.value = det
    const g = c.createGain()
    const top = Math.max(0.0001, lvl)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(top, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + dec + 0.05)
  }

  // Beating fundamental (~1.5 Hz at typical roots).
  voice(freq, peak * 0.55, decay, -3)
  voice(freq, peak * 0.55, decay, 3)
  // Stretched inharmonic partials — quieter and shorter-lived.
  voice(freq * 2.76, peak * 0.2, decay * 0.5, rpan(6))
  voice(freq * 5.4, peak * 0.09, decay * 0.32, rpan(6))
}

// ---- The four synth voices (pure — safe to lift into the thanks page) -------

/**
 * 1. Envelope tap — a soft finger tap on the sealed card: a low woody "knock"
 *    (damped ~200 Hz sine, tiny downward glide) under a short cluster of 3 soft
 *    bandpassed noise ticks a few ms apart. Warm and close, only a touch of room.
 * @type {Types.SoundSynth}
 */
export function playEnvelopeTap(c, b, p, when) {
  const t = when
  const level = p.level

  // Woody knock body.
  const knock = c.createOscillator()
  knock.type = "sine"
  knock.frequency.setValueAtTime(p.body * 1.4, t)
  knock.frequency.exponentialRampToValueAtTime(p.body, t + 0.05)
  const kg = c.createGain()
  kg.gain.setValueAtTime(0.0001, t)
  kg.gain.linearRampToValueAtTime(Math.max(0.0001, level * 0.55), t + 0.004)
  kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
  const kpan = c.createStereoPanner()
  kpan.pan.value = rpan(0.12)
  knock.connect(kg).connect(kpan)
  route(c, kpan, b, 0.14)
  knock.start(t)
  knock.stop(t + 0.12)

  // Soft tick cluster — the papery contact.
  const ticks = 3
  for (let i = 0; i < ticks; i++) {
    const ct = t + i * (0.004 + Math.random() * 0.004)
    const freq = p.tone * (0.8 + Math.random() * 0.55)
    const peak = level * (0.5 - i * 0.13)
    grain(c, b, ct, 0.014, "bandpass", freq, 6 + Math.random() * 6, peak, rpan(0.4), 0.14)
  }
}

/**
 * 2. Envelope opens — the paper unfolding: 8–15 tiny bandpassed noise grains
 *    (granular, not a static hiss) scattered over ~0.5 s under an overall swell,
 *    a soft lowpassed noise bed, and a warm low "whum" that blooms and fades as
 *    the flap lifts. Sounds like fingers on real stationery.
 * @type {Types.SoundSynth}
 */
export function playEnvelopeOpen(c, b, p, when) {
  const t = when
  const dur = 0.55
  const level = p.level
  const density = Math.round(p.density)
  const brightness = p.brightness
  const lo = 1000 + brightness * 2000
  const hi = lo + 2000 + brightness * 2600

  // Soft lowpassed bed.
  const bed = c.createBufferSource()
  bed.buffer = noiseBuffer(c, dur + 0.05)
  const bedLp = c.createBiquadFilter()
  bedLp.type = "lowpass"
  bedLp.frequency.value = 900 + brightness * 1500
  bedLp.Q.value = 0.6
  const bedG = c.createGain()
  bedG.gain.setValueAtTime(0.0001, t)
  bedG.gain.linearRampToValueAtTime(Math.max(0.0001, level * 0.28), t + dur * 0.45)
  bedG.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  bed.connect(bedLp).connect(bedG)
  route(c, bedG, b, 0.2)
  bed.start(t)
  bed.stop(t + dur + 0.05)

  // Warm low "whum" as the flap lifts.
  const whum = c.createOscillator()
  whum.type = "sine"
  whum.frequency.setValueAtTime(96, t)
  whum.frequency.linearRampToValueAtTime(78, t + dur)
  const wg = c.createGain()
  wg.gain.setValueAtTime(0.0001, t)
  wg.gain.linearRampToValueAtTime(Math.max(0.0001, level * 0.5), t + dur * 0.4)
  wg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05)
  whum.connect(wg)
  route(c, wg, b, 0.22)
  whum.start(t)
  whum.stop(t + dur + 0.05)

  // Granular rustle — swell shaped by a sine arch across the duration.
  for (let i = 0; i < density; i++) {
    const frac = (i + Math.random() * 0.6) / density
    const gt = t + frac * dur
    const len = 0.01 + Math.random() * 0.03
    const freq = lo + Math.random() * (hi - lo)
    const swell = Math.sin(Math.min(1, Math.max(0, frac)) * Math.PI)
    const peak = level * (0.16 + 0.5 * swell) * (0.5 + Math.random() * 0.5)
    grain(c, b, gt, len, "bandpass", freq, 0.8 + Math.random() * 1.2, peak, rpan(0.55), 0.2)
  }
}

/**
 * 3. Word cascade — the message appearing line by line: a rising major-pentatonic
 *    run of warm bell notes (see bellNote — beating fundamental + stretched
 *    inharmonic partials), staggered ~0.11 s apart with a loudness arch and
 *    slight timing jitter, drenched in reverb. "Music box heard across a room."
 * @type {Types.SoundSynth}
 */
export function playWordCascade(c, b, p, when) {
  const t = when
  const root = p.root
  const decay = p.decay
  const warmth = p.warmth
  const base = 0.13 // intentionally quiet — the softest cue.
  const steps = [0, 2, 4, 7, 9, 12] // major pentatonic, ascending.
  const stagger = 0.11
  for (let i = 0; i < steps.length; i++) {
    const nt = t + i * stagger * (0.85 + Math.random() * 0.3)
    const freq = root * Math.pow(2, steps[i] / 12)
    // Loudness arch: swells in, eases out.
    const arch = 0.6 + 0.4 * Math.sin((i / (steps.length - 1)) * Math.PI)
    const peak = base * arch
    bellNote(c, b, freq, peak, nt, decay * (1 - i * 0.05), warmth, rpan(0.5), 0.32)
  }
}

/**
 * 4. Celebration — the champagne moment: a pitch-drop thump (sine 320→70 Hz,
 *    ~60 ms), a quiet resonant "hollow bottle" ping (high-Q bandpassed click),
 *    a champagne fizz tail (dozens of tiny highpassed grains thinning out over
 *    ~0.55 s), and 3 bright bell "sparkle" twinkles scattered on top.
 * @type {Types.SoundSynth}
 */
export function playCelebration(c, b, p, when) {
  const t = when
  const level = p.level
  const fizzAmt = p.fizz

  // Pitch-drop thump.
  const thump = c.createOscillator()
  thump.type = "sine"
  thump.frequency.setValueAtTime(p.pop, t)
  thump.frequency.exponentialRampToValueAtTime(70, t + 0.06)
  const tg = c.createGain()
  tg.gain.setValueAtTime(0.0001, t)
  tg.gain.linearRampToValueAtTime(Math.max(0.0001, level * 0.9), t + 0.003)
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
  thump.connect(tg)
  route(c, tg, b, 0.18)
  thump.start(t)
  thump.stop(t + 0.12)

  // Hollow bottle ping — resonant, very quiet.
  grain(c, b, t + 0.002, 0.05, "bandpass", 620 + Math.random() * 280, 12, level * 0.12, rpan(0.2), 0.22)

  // Champagne fizz — grains front-loaded then thinning, level fading.
  const fizzStart = t + 0.02
  const fizzDur = 0.55
  const grains = Math.round(34 * fizzAmt)
  for (let i = 0; i < grains; i++) {
    const frac = i / Math.max(1, grains)
    const gt = fizzStart + fizzDur * Math.pow(frac, 0.75) + Math.random() * 0.01
    const len = 0.003 + Math.random() * 0.006
    const freq = 3500 + Math.random() * 4000
    const peak = level * 0.14 * (1 - frac) * (0.4 + Math.random() * 0.6)
    grain(c, b, gt, len, "highpass", freq, 0.7, peak, rpan(0.7), 0.15)
  }

  // Bright sparkle twinkles — celebratory shimmer over the fizz.
  for (let i = 0; i < 3; i++) {
    const st = t + 0.04 + Math.random() * 0.28
    const freq = 1500 + Math.random() * 1600
    bellNote(c, b, freq, level * 0.05, st, 0.4 + Math.random() * 0.25, 0.9, rpan(0.6), 0.3)
  }
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
    id: "envelope-tap",
    label: "Envelope tap",
    offset: 0.0,
    play: playEnvelopeTap,
    params: [
      { key: "level", label: "Level", min: 0, max: 1, step: 0.02, value: 0.45, unit: "level" },
      { key: "tone", label: "Tap tone", min: 1200, max: 3500, step: 50, value: 2200, unit: "Hz" },
      { key: "body", label: "Wood body", min: 150, max: 280, step: 5, value: 205, unit: "Hz" },
    ],
  }),
  makeCue({
    id: "envelope-open",
    label: "Envelope opens",
    offset: 0.5,
    play: playEnvelopeOpen,
    params: [
      { key: "level", label: "Level", min: 0, max: 0.6, step: 0.01, value: 0.32, unit: "level" },
      { key: "density", label: "Grain density", min: 6, max: 18, step: 1, value: 12, unit: "level" },
      { key: "brightness", label: "Brightness", min: 0, max: 1, step: 0.05, value: 0.5, unit: "level" },
    ],
  }),
  makeCue({
    id: "word-cascade",
    label: "Word cascade",
    offset: 1.35,
    play: playWordCascade,
    params: [
      { key: "root", label: "Root note", min: 262, max: 523, step: 1, value: 392, unit: "Hz" },
      { key: "decay", label: "Ring", min: 1.2, max: 2.8, step: 0.05, value: 2.0, unit: "s" },
      { key: "warmth", label: "Warmth", min: 0, max: 1, step: 0.05, value: 0.5, unit: "level" },
    ],
  }),
  makeCue({
    id: "celebration",
    label: "Celebration",
    offset: 4.3,
    play: playCelebration,
    params: [
      { key: "level", label: "Level", min: 0, max: 1, step: 0.02, value: 0.55, unit: "level" },
      { key: "pop", label: "Pop pitch", min: 240, max: 420, step: 10, value: 320, unit: "Hz" },
      { key: "fizz", label: "Fizz", min: 0, max: 1, step: 0.05, value: 0.6, unit: "level" },
    ],
  }),
]

// ---- CC0 sample manifest (A/B against the synth cues) -----------------------

/**
 * Real CC0 recordings (BigSoundBank, processed to short m4a/AAC — see
 * public/sounds/card/SOURCES.md). Hardcoded so the lab needs no directory
 * listing. `beat` matches a CUES id so the sample sequence reuses the synth
 * arc's spacing; one `primary` sample per beat drives that sequence.
 * @type {Types.SoundSample[]}
 */
const SAMPLES = [
  { id: "tap-wood", label: "Tap — wooden gavel", beat: "envelope-tap", path: "/sounds/card/tap-wood.m4a", primary: true },
  { id: "open-paper", label: "Open — paper rustle", beat: "envelope-open", path: "/sounds/card/open-paper.m4a", primary: true },
  { id: "cascade-chimes", label: "Cascade — dream chimes", beat: "word-cascade", path: "/sounds/card/cascade-chimes.m4a", primary: true },
  { id: "cascade-bells", label: "Cascade — butterfly bells", beat: "word-cascade", path: "/sounds/card/cascade-bells.m4a", primary: false },
  { id: "celebrate-cork", label: "Celebrate — champagne cork", beat: "celebration", path: "/sounds/card/celebrate-cork.m4a", primary: true },
  { id: "celebrate-fizz", label: "Celebrate — sparkling fizz", beat: "celebration", path: "/sounds/card/celebrate-fizz.m4a", primary: false },
]

/**
 * Decoded-buffer cache keyed by path (decode once, replay cheaply).
 * @type {Map<string, AudioBuffer>}
 */
const sampleBuffers = new Map()

/**
 * Fetch + decode one sample into an AudioBuffer (cached). decodeAudioData
 * ignores the response Content-Type, so playback works regardless of how the
 * static server labels .m4a.
 * @param {AudioContext} c @param {string} path @returns {Promise<AudioBuffer>}
 */
async function loadSample(c, path) {
  const cached = sampleBuffers.get(path)
  if (cached) return cached
  const res = await fetch(path)
  if (!res.ok) throw new Error("fetch " + path + " → " + res.status)
  const buf = await c.decodeAudioData(await res.arrayBuffer())
  sampleBuffers.set(path, buf)
  return buf
}

/**
 * Schedule a decoded sample onto the master gain at `when`. Kept dry (the
 * recordings already carry their own room) but still routed through master →
 * compressor, so the mute button and master level apply exactly as to the synths.
 * @param {AudioContext} c @param {GainNode} m @param {AudioBuffer} buf @param {number} when
 */
function scheduleSample(c, m, buf, when) {
  const src = c.createBufferSource()
  src.buffer = buf
  src.connect(m)
  src.start(when)
}

/** @param {Types.SoundSample} sample */
async function playSample(sample) {
  const { ctx: c, master: m } = audio()
  try {
    scheduleSample(c, m, await loadSample(c, sample.path), c.currentTime + 0.03)
    flash("Playing sample: " + sample.label, "ok")
  } catch (err) {
    flash("Sample failed (" + sample.label + "): " + String(err), "err")
  }
}

/** A cue's arc offset by id — reused so samples land on the synth spacing. */
/** @param {string} beat @returns {number} */
function offsetForBeat(beat) {
  for (const cue of CUES) if (cue.id === beat) return cue.offset
  return 0
}

/** Play the four primary samples along the same arc as the synth sequence. */
async function playSampleSequence() {
  const { ctx: c, master: m } = audio()
  const primaries = SAMPLES.filter((s) => s.primary)
  try {
    const bufs = await Promise.all(primaries.map((s) => loadSample(c, s.path)))
    const base = c.currentTime + 0.08
    for (let i = 0; i < primaries.length; i++) {
      scheduleSample(c, m, bufs[i], base + offsetForBeat(primaries[i].beat))
    }
    flash("Playing sample sequence (tap → open → cascade → celebration)", "ok")
  } catch (err) {
    flash("Sample sequence failed: " + String(err), "err")
  }
}

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
  const { ctx: c, bus: b } = audio()
  cue.play(c, b, cue.values, c.currentTime + 0.03)
  flash("Playing " + cue.label, "ok")
}

/** Play all four cues spaced along the reveal arc so the owner hears the flow. */
function playSequence() {
  const { ctx: c, bus: b } = audio()
  const base = c.currentTime + 0.05
  for (const cue of CUES) cue.play(c, b, cue.values, base + cue.offset)
  flash("Playing sequence (tap → open → cascade → celebration)", "ok")
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

  // Register a programmatic setter so a restored decision can push saved
  // synthParams back onto this cue value + slider + readout.
  sliderUpdaters.set(cue.id + ":" + param.key, (value) => {
    cue.values[param.key] = value
    range.value = String(value)
    readout.textContent = formatValue(param, value)
  })

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

/**
 * Build one sample row (a play button + label) styled like a cue card head, so
 * the Samples section reads as the A/B twin of the Cues section.
 * @param {Types.SoundSample} sample @returns {HTMLDivElement}
 */
function buildSampleRow(sample) {
  const card = document.createElement("div")
  card.className = "sound-cue"

  const head = document.createElement("div")
  head.className = "sound-cue-head"
  const title = document.createElement("span")
  title.className = "sound-cue-title"
  title.textContent = sample.label + (sample.primary ? "" : " · alt")
  const playBtn = document.createElement("button")
  playBtn.type = "button"
  playBtn.className = "ctrl-btn primary"
  playBtn.textContent = "▶ Play"
  playBtn.addEventListener("click", () => void playSample(sample))
  head.append(title, playBtn)

  card.appendChild(head)
  return card
}

// ---- Decision capture (radio groups + play-my-mix + save/load) --------------

/**
 * Build one beat's radio group: the beat's synth cue, each sample for that beat,
 * and "Silent". Nothing is checked until the user picks (or a saved decision is
 * restored). Selecting a radio records the choice string in decisionChoices.
 * @param {Types.SoundCue} cue @returns {HTMLFieldSetElement}
 */
function buildBeatGroup(cue) {
  const group = document.createElement("fieldset")
  group.className = "decision-group"
  const legend = document.createElement("legend")
  legend.textContent = cue.label
  group.appendChild(legend)

  /** @type {{ value: string; label: string }[]} */
  const options = [{ value: "synth:" + cue.id, label: "Synth: " + cue.label }]
  for (const sample of SAMPLES) {
    if (sample.beat === cue.id) options.push({ value: "sample:" + sample.id, label: "Sample: " + sample.label })
  }
  options.push({ value: "none", label: "Silent" })

  for (const opt of options) {
    const row = document.createElement("label")
    row.className = "decision-option"
    const radio = document.createElement("input")
    radio.type = "radio"
    radio.name = "decision-" + cue.id
    radio.value = opt.value
    radio.addEventListener("change", () => {
      if (radio.checked) decisionChoices[cue.id] = opt.value
    })
    const span = document.createElement("span")
    span.textContent = opt.label
    row.append(radio, span)
    group.appendChild(row)
  }
  return group
}

/** Find a sample manifest entry by id. @param {string} id @returns {Types.SoundSample | undefined} */
function sampleById(id) {
  for (const sample of SAMPLES) if (sample.id === id) return sample
  return undefined
}

/**
 * Play the currently-selected option for each beat at the shared arc offsets,
 * skipping silent beats — the same playback paths (synth cue / decoded sample)
 * through the shared master gain + mute, so it sounds exactly as it will ship.
 */
async function playMix() {
  const { ctx: c, master: m, bus: b } = audio()

  /** @type {{ cue: Types.SoundCue; choice: string }[]} */
  const chosen = []
  for (const cue of CUES) {
    const choice = decisionChoices[cue.id]
    if (choice && choice !== "none") chosen.push({ cue, choice })
  }
  if (chosen.length === 0) {
    flash("Pick a sound for at least one beat first (or it's silent everywhere).", "err")
    return
  }

  try {
    // Lazily fetch + decode any sample buffers the mix needs before scheduling,
    // so the whole sequence lands on time.
    /** @type {Map<string, AudioBuffer>} */
    const bufByPath = new Map()
    for (const { choice } of chosen) {
      if (choice.startsWith("sample:")) {
        const sample = sampleById(choice.slice("sample:".length))
        if (sample) bufByPath.set(sample.path, await loadSample(c, sample.path))
      }
    }

    const base = c.currentTime + 0.1
    for (const { cue, choice } of chosen) {
      const when = base + cue.offset
      if (choice.startsWith("synth:")) {
        cue.play(c, b, cue.values, when)
      } else if (choice.startsWith("sample:")) {
        const sample = sampleById(choice.slice("sample:".length))
        const buf = sample && bufByPath.get(sample.path)
        if (buf) scheduleSample(c, m, buf, when)
      }
    }
    flash("Playing your mix (tap → open → cascade → celebration)", "ok")
  } catch (err) {
    flash("Mix failed: " + String(err), "err")
  }
}

/** @param {string} iso @returns {string} */
function formatSavedAt(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

/**
 * POST the current decision (per-beat choices + notes + decidedBy + master level
 * + a full synthParams snapshot) to the dev-only endpoint, which writes it to
 * docs/post-wedding/sound-decision.json. Unpicked beats save as "none" (silent).
 */
async function saveDecision() {
  const status = getElement("decision-status")

  /** @type {Record<string, string>} */
  const choices = {}
  for (const cue of CUES) choices[cue.id] = decisionChoices[cue.id] ?? "none"

  /** @type {Record<string, Record<string, number>>} */
  const synthParams = {}
  for (const cue of CUES) synthParams[cue.id] = { ...cue.values }

  const body = {
    choices,
    notes: getTextAreaElement("decision-notes").value,
    decidedBy: getInputElement("decision-decided-by").value,
    masterLevel,
    synthParams,
  }

  try {
    const res = await fetch("/api/studio/sound-decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status)
    lastSavedAt = typeof data.savedAt === "string" ? data.savedAt : ""
    status.textContent = "Saved ✓ — " + (lastSavedAt ? formatSavedAt(lastSavedAt) : "just now")
    status.className = "flash flash-ok"
  } catch (err) {
    status.textContent = "Save failed: " + (err instanceof Error ? err.message : String(err))
    status.className = "flash flash-err"
  }
}

/**
 * Restore a previously-saved decision onto the UI: check radios, fill notes /
 * decidedBy, restore the master level, and push saved synthParams back onto the
 * cue sliders so "Play my mix" reproduces the saved synth exactly.
 * @param {Record<string, any>} data
 */
function restoreDecision(data) {
  const choices = data.choices && typeof data.choices === "object" ? data.choices : {}
  for (const cue of CUES) {
    const choice = choices[cue.id]
    if (typeof choice !== "string") continue
    decisionChoices[cue.id] = choice
    const radios = document.getElementsByName("decision-" + cue.id)
    for (const radio of radios) {
      if (radio instanceof HTMLInputElement && radio.value === choice) radio.checked = true
    }
  }

  if (typeof data.notes === "string") getTextAreaElement("decision-notes").value = data.notes
  if (typeof data.decidedBy === "string") getInputElement("decision-decided-by").value = data.decidedBy

  if (typeof data.masterLevel === "number") {
    masterLevel = data.masterLevel
    getInputElement("sound-master-range").value = String(masterLevel)
    getElement("sound-master-readout").textContent = masterLevel.toFixed(2)
    applyMasterGain()
  }

  const params = data.synthParams
  if (params && typeof params === "object") {
    for (const cue of CUES) {
      const beatParams = params[cue.id]
      if (!beatParams || typeof beatParams !== "object") continue
      for (const key of Object.keys(beatParams)) {
        const updater = sliderUpdaters.get(cue.id + ":" + key)
        if (updater && typeof beatParams[key] === "number") updater(beatParams[key])
      }
    }
  }

  if (typeof data.savedAt === "string") {
    lastSavedAt = data.savedAt
    const status = getElement("decision-status")
    status.textContent = "Last saved — " + formatSavedAt(data.savedAt)
    status.className = "flash"
  }
}

/** Load any previously-saved decision on open (dev tool — failures are silent). */
async function loadDecision() {
  try {
    const res = await fetch("/api/studio/sound-decision")
    if (!res.ok) return
    const data = await res.json().catch(() => null)
    if (!data || data.exists === false) return
    restoreDecision(data)
  } catch {
    // Dev-only convenience — a stale/unreachable endpoint just means "nothing to
    // restore"; the lab still works for a fresh decision.
  }
}

function initSoundLab() {
  const list = getElement("sound-cues")
  for (const cue of CUES) list.appendChild(buildCueCard(cue))

  const samples = getElement("sound-samples")
  for (const sample of SAMPLES) samples.appendChild(buildSampleRow(sample))

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
  getButtonElement("sound-sample-sequence-btn").addEventListener("click", () => void playSampleSequence())

  // Decision section: per-beat radio groups + play-my-mix + save.
  const decision = getElement("sound-decision")
  for (const cue of CUES) decision.appendChild(buildBeatGroup(cue))
  getButtonElement("decision-mix-btn").addEventListener("click", () => void playMix())
  getButtonElement("decision-save-btn").addEventListener("click", () => void saveDecision())

  // Restore any previously-saved decision (async; the UI is fully usable before
  // it resolves).
  void loadDecision()
}

initSoundLab()
