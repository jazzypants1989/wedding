/** @file Types for the effect studio dev tool */
import type { EffectInstance } from "../../effects/types.js"

// Control metadata types now live with the shared control machinery
// (public/effects/control-meta.js) so the card composer can reuse them.
export type { ControlHint, NumericBounds } from "../../effects/types.js"

export type EffectFactory = (
  config?: Record<string, unknown>,
) => EffectInstance

// ---- Per-browser config override store (override-store.js) -----------------

/** A stored config override for one effect: a sparse diff from its defaults. */
export type ConfigPartial = Record<string, unknown>

/** Read the whole override map from localStorage ({} if absent/malformed). */
export type readAll = () => Record<string, ConfigPartial>

/** The stored sparse override for one effect id ({} if none). */
export type readOverride = (id: string) => ConfigPartial

/** Sparse diff: keys of `full` whose value differs from `defaults`. */
export type diffConfig = (
  full: Record<string, unknown>,
  defaults: Record<string, unknown>,
) => ConfigPartial

/** Persist the diff of `full` vs `defaults` for one effect (prunes if empty). */
export type saveOverride = (
  id: string,
  full: Record<string, unknown>,
  defaults: Record<string, unknown>,
) => void

/** Remove one effect's stored override. */
export type clearOverride = (id: string) => void

/** Remove every stored override (wipes the whole key). */
export type clearAll = () => void

/** Defaults clone with the stored partial applied (only for keys in defaults). */
export type seedFromOverride = (
  defaults: Record<string, unknown>,
  partial: ConfigPartial,
) => Record<string, unknown>

// ---- Sound lab (sound-lab.js) — dev-only WebAudio decision prototype --------

/** How a cue's tuning slider is rendered and formatted. */
export interface SoundParam {
  /** Key into the cue's live `values` map. */
  key: string
  /** Human label shown next to the slider. */
  label: string
  min: number
  max: number
  step: number
  /** Default value (also the starting live value). */
  value: number
  /** Readout unit: "Hz" → rounded integer, "s" → 3dp, otherwise 2dp. */
  unit: "Hz" | "s" | "level"
}

/**
 * A pure synth voice: schedules an audio cue on `dest` starting at `when`
 * (an AudioContext currentTime-relative timestamp). Never touches globals so
 * these functions can be lifted into the thanks page unchanged.
 */
export type SoundSynth = (
  ctx: AudioContext,
  dest: AudioNode,
  params: Record<string, number>,
  when: number,
) => void

/** One auditionable reveal cue in the sound lab. */
export interface SoundCue {
  id: string
  label: string
  /** Where this cue lands in the "play sequence" arc, in seconds. */
  offset: number
  play: SoundSynth
  params: SoundParam[]
  /** Live, slider-driven parameter values (seeded from each param's default). */
  values: Record<string, number>
}
