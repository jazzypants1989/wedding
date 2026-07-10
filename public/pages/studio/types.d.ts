/** @file Types for the effect studio dev tool */
import type { EffectInstance } from "../../effects/types.js"

/** Slider/number bounds (and enum options) for a single config parameter. */
export interface ControlHint {
  min?: number
  max?: number
  step?: number
  options?: string[]
}

/** Resolved numeric slider bounds. */
export interface NumericBounds {
  min: number
  max: number
  step: number
}

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
