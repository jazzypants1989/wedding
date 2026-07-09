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
