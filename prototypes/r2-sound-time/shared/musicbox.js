/** @file A synthesised music-box comb. No samples, no assets: pure WebAudio.
 *
 *  Rules (DESIGN-SLOTS.md "Sound is opt-in"):
 *   - Muted by default. Nothing here creates an AudioContext until `enable()`
 *     is called, and the sketches only call it from a click handler.
 *   - Off under prefers-reduced-motion: `canPlay()` says no and `enable()`
 *     refuses.
 *
 *  The voice: a struck steel tine. A real comb tine is a cantilever beam, so
 *  its overtones are inharmonic (about 6.27× and 17.5× the fundamental); they
 *  die in tens of milliseconds and leave a near-pure sine ringing. On top of
 *  that, a 3 ms noise "tick" for the pin catching the tine. Everything runs
 *  into one small procedural room (the sound-lab's buildImpulse approach:
 *  decaying noise that darkens as it fades) and a gentle bus compressor.
 *
 *  Graph:  tine layers → panner → { dry, send } ; dry → master ;
 *          send → preDelay → convolver → wet → master ; master → comp → out
 */

import { hzOf, midiOf } from "./motif.js"

/** @type {AudioContext | null} */
let ctx = null
/** @type {GainNode | null} */
let master = null
/** @type {GainNode | null} */
let dry = null
/** @type {AudioNode | null} */
let wet = null
let enabled = false
let level = 0.5
/** Notes started in the last window, for the polyphony guard. */
let recent = 0
let recentAt = 0

/** Reduced motion turns sound off (contract). `?motion=reduce` forces it for review. */
export function reducedMotion() {
  // Set pre-paint by shared/theme-init.js from the OS setting or ?motion=.
  return document.documentElement.hasAttribute("data-still")
}

export function canPlay() {
  return typeof AudioContext !== "undefined" && !reducedMotion()
}

export function isEnabled() {
  return enabled
}

/** @param {number} v 0..1 */
export function setLevel(v) {
  level = Math.max(0, Math.min(1, v))
  if (ctx && master) master.gain.setTargetAtTime(Math.max(0.0001, level), ctx.currentTime, 0.02)
}

/** @param {AudioContext} c @param {number} seconds @param {number} decay */
function buildImpulse(c, seconds, decay) {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds))
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const a = 0.55 * (1 - t * 0.7)
      lp += a * (Math.random() * 2 - 1 - lp)
      data[i] = lp * Math.pow(1 - t, decay)
    }
  }
  return buf
}

/** Call ONLY from a user gesture. Returns false if sound is not allowed here. */
export function enable() {
  if (!canPlay()) return false
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = level
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -20
    comp.knee.value = 24
    comp.ratio.value = 2.5
    comp.attack.value = 0.002
    comp.release.value = 0.2
    master.connect(comp).connect(ctx.destination)

    dry = ctx.createGain()
    dry.connect(master)

    const pre = ctx.createDelay(0.1)
    pre.delayTime.value = 0.012
    const conv = ctx.createConvolver()
    conv.buffer = buildImpulse(ctx, 1.4, 2.6)
    const wetGain = ctx.createGain()
    wetGain.gain.value = 0.55
    pre.connect(conv).connect(wetGain).connect(master)
    wet = pre
  }
  if (ctx.state === "suspended") void ctx.resume()
  enabled = true
  return true
}

export function disable() {
  enabled = false
  if (ctx && ctx.state === "running") void ctx.suspend()
}

/** Current audio time, or 0 before enable(). */
export function now() {
  return ctx ? ctx.currentTime : 0
}

/**
 * Strike one tine.
 * @param {number} lane 0..13 (C4..B5), or higher for a bell
 * @param {{ when?: number, velocity?: number, pan?: number, decay?: number, position?: { x: number, z: number } }} [opts]
 */
export function pluck(lane, opts) {
  if (!enabled || !ctx || !dry || !wet) return
  const o = opts || {}
  const t = Math.max(ctx.currentTime, o.when || 0) + 0.005

  // Polyphony guard: a fast scroll can cross dozens of holes in a frame.
  if (Math.abs(t - recentAt) > 0.05) {
    recent = 0
    recentAt = t
  }
  if (++recent > 6) return

  const f = hzOf(midiOf(lane))
  const vel = Math.max(0.05, Math.min(1, o.velocity === undefined ? 0.7 : o.velocity))
  // Higher tines are shorter and ring for less time, like a real comb.
  const decay = (o.decay || 2.2) * (1.25 - lane / 28)

  /** @type {AudioNode} */
  let out
  if (o.position) {
    const p = ctx.createPanner()
    p.panningModel = "HRTF"
    p.distanceModel = "inverse"
    p.refDistance = 1
    p.rolloffFactor = 0.8
    p.positionX.value = o.position.x
    p.positionY.value = 0
    p.positionZ.value = o.position.z
    out = p
  } else {
    const p = ctx.createStereoPanner()
    p.pan.value = o.pan === undefined ? (lane / 13) * 1.2 - 0.6 : o.pan
    out = p
  }
  out.connect(dry)
  const send = ctx.createGain()
  send.gain.value = 0.35
  out.connect(send).connect(wet)

  /** @param {number} freq @param {number} peak @param {number} dec */
  const partial = (freq, peak, dec) => {
    if (!ctx || freq > ctx.sampleRate / 2.2) return
    const osc = ctx.createOscillator()
    osc.type = "sine"
    osc.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec)
    osc.connect(g).connect(out)
    osc.start(t)
    osc.stop(t + dec + 0.02)
  }
  partial(f, 0.32 * vel, decay)
  partial(f * 2.0, 0.035 * vel, decay * 0.35)
  partial(f * 6.27, 0.05 * vel, 0.09)
  partial(f * 17.5, 0.02 * vel, 0.03)

  // The pin catching the tine.
  const len = 0.004
  const n = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate)
  const d = n.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
  const src = ctx.createBufferSource()
  src.buffer = n
  const hp = ctx.createBiquadFilter()
  hp.type = "highpass"
  hp.frequency.value = 3000
  const tg = ctx.createGain()
  tg.gain.value = 0.05 * vel
  src.connect(hp).connect(tg).connect(out)
  src.start(t)
}

/**
 * Play a whole motif from `when`, one eighth = `unit` seconds.
 * @param {import("./motif.js").Motif} motif
 * @param {{ when?: number, unit?: number, velocity?: number, position?: { x: number, z: number } }} [opts]
 * @returns {number} duration in seconds
 */
export function playMotif(motif, opts) {
  const o = opts || {}
  const unit = o.unit || 0.16
  const start = o.when || now()
  for (const n of motif.notes) {
    const when = start + n.start * unit
    const base = { when, velocity: o.velocity, position: o.position }
    pluck(n.lane, base)
    for (const c of n.chord) pluck(c, { ...base, velocity: (o.velocity || 0.7) * 0.6 })
    if (n.bell) pluck(n.lane + 7, { ...base, when: when + unit * 0.5, velocity: 0.45, decay: 3 })
  }
  return motif.units * unit
}

/** A paper-punch: used by the "punch" burst when a guest types their name. */
export function punch() {
  if (!enabled || !ctx || !dry) return
  const t = ctx.currentTime + 0.003
  const len = 0.03
  const n = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate)
  const d = n.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3)
  const src = ctx.createBufferSource()
  src.buffer = n
  const bp = ctx.createBiquadFilter()
  bp.type = "bandpass"
  bp.frequency.value = 1800
  bp.Q.value = 1.4
  const g = ctx.createGain()
  g.gain.value = 0.18
  src.connect(bp).connect(g).connect(dry)
  src.start(t)
}
