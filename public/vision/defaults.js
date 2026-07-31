/** @file Every tunable in the face pipeline, in one table.
 *
 *  Shaped like public/effects/config.js's EFFECT_CONFIGS on purpose: flat plain
 *  values, cloned on read. That shape is what lets components/effect-controls.js
 *  infer a control per key, so the vision bench in /studio gets its UI for free
 *  rather than as a fifth of the project.
 *
 *  ⚠ **These are REFERENCE defaults, not measured ones.** Every number below
 *  comes from a published source — OpenCV's own `sface.py` and `face_detect.cpp`
 *  for the detector and threshold constants, the recogniser's model card for
 *  0.363 — or is a deliberately conservative placeholder. Published defaults come
 *  from benchmark datasets that are frontal, well-lit and nothing like event
 *  photography. Tune them locally, against input you own, and replace the values
 *  here.
 *
 *  ⚠ **When you replace one, replace only the number.** CLAUDE.md's fourth
 *  photograph rule: a tuned constant may live here, but no note of what was
 *  measured to arrive at it may live anywhere in this repository. "p5 of the
 *  observed eye-separation ratio" is a measurement of identifiable people. `0.21`
 *  is a constant.
 */

/** @import * as Types from './types.js' */

/** @type {Types.VisionDefaults} */
const VISION_CONFIG = {
  dedup: {
    /**
     * Hamming distance, in bits out of 256, below which two frames are treated
     * as the same photograph taken twice.
     *
     * This is the SECOND level. The importer's content hash is over raw file
     * bytes, so it catches renames and exact copies and nothing else — while
     * the case that actually corrupts the measurement is the retouched or
     * re-encoded copy of one frame, which every photo delivery is full of. Two
     * near-identical frames make two near-identical descriptors, which collapses
     * same-person distances toward zero and forges a good result.
     *
     * Near-duplicates are RECORDED, never dropped: the report needs to quantify
     * what they were worth, and that is only possible if they are still there.
     */
    nearDuplicateBits: 12,
  },

  detect: {
    /**
     * Long edge the detector runs at. Not just a speed knob: cost scales with
     * pixel count (a 24MP frame is ~14x a 1280px one), and YuNet was trained on
     * faces roughly 10-300px, so at native resolution a face filling a decent
     * fraction of the frame lands ABOVE the band it was trained on. Downscaling
     * is a correctness measure that happens to also be the speed measure.
     */
    longEdge: 1280,
    /** Long edge the crop buffer is decoded at. Must comfortably exceed 112. */
    sourceEdge: 2000,
    /** Reference default from face_detect.cpp. */
    scoreThreshold: 0.6,
    /** Reference default. NMS is pooled across all three strides, not per-stride. */
    nmsIou: 0.3,
    topK: 5000,
    /** YuNet pads bottom and right to a multiple of this. Not a free parameter. */
    divisor: 32,
    /**
     * Two boxes overlapping above this are treated as one face. Distinct from
     * nmsIou and needed after it: a duplicate that survives NMS becomes a
     * permanent cannot-link split AND a false different-person pair in the
     * metrics, which is worse than losing the detection.
     */
    duplicateIou: 0.55,
  },

  align: {
    /** The recogniser's input. Fixed by the model, not a preference. */
    size: 112,
  },

  gate: {
    /** Minimum shorter box edge, in SOURCE pixels. */
    minBoxPx: 40,
    /** Minimum distance from the box to any image edge, in source pixels. */
    minBorderPx: 0,
    /**
     * Plausible band for eye separation / box width. Outside it the detection is
     * either wrong or the landmark order is mirrored, and both must go. The low
     * end doubles as the pose proxy: a turned face has one eye occluded, so its
     * eyes crowd together.
     */
    minEyeRatio: 0.2,
    maxEyeRatio: 0.62,
    /**
     * Alignment fit residual (RMS, in 112-px template units) above which the
     * five landmarks did not describe a face in the expected arrangement.
     */
    maxResidual: 12,
    /** Above 1 the crop is upsampled from a face smaller than 112px. */
    maxAlignScale: 1.6,
    /** Fraction of crop samples allowed to fall outside the source frame. */
    maxOutside: 0.02,
    /** Normalised Laplacian energy; see gate.js for what the normalisation is. */
    minSharpness: 0.004,
  },

  group: {
    /**
     * Cosine DISTANCE (1 - cosine similarity), not similarity. Deliberately
     * tighter than any verification threshold: the costs are asymmetric. One
     * person split across three groups costs two clicks; two people welded into
     * one is expensive to notice and annoying to unpick.
     */
    cutoff: 0.45,
    /** Two faces in one photograph are different people. Blocks the worst merge. */
    cannotLinkWithinPhoto: true,
  },

  describe: {
    /**
     * Describe the crop and its mirror and average before normalising. Costs 2x.
     * Plausibly worth more here than usual: the head flattens a 7x7 grid instead
     * of pooling it, so it has no translation invariance at the end.
     */
    mirrorAverage: false,
  },

  assign: {
    /**
     * Cosine DISTANCE below which two UNIDENTIFIED faces are treated as "the
     * same person" for the admin ask-queue's `unlocks` estimate (how many
     * photos would gain a name if this one face were confirmed). This is a
     * priority signal, not an identity decision, so it deliberately reuses the
     * published pairwise VERIFICATION distance — `1 -` the SFace repo's own
     * 0.363 similarity threshold (see REFERENCE_VERIFICATION_SIMILARITY below)
     * — rather than `group.cutoff`'s tighter, asymmetric-cost clustering
     * threshold: over-including here just means asking about a face sooner,
     * where over-including in a persisted cluster means welding two people.
     */
    sameBandCutoff: 0.64,
  },
}

/**
 * The published verification threshold for SFace, as cosine SIMILARITY, from
 * upstream's sface.py. Kept out of the table above because it is not a knob —
 * it is a reference point for the similarity explorer, and it is emphatically
 * not a grouping cutoff. Recorded here so nobody re-derives it from a blog post.
 */
export const REFERENCE_VERIFICATION_SIMILARITY = 0.363

/** Same object, indexable by name for the generic accessor below. */
const CONFIG_INDEX = /** @type {Record<string, unknown>} */ (
  /** @type {unknown} */ (VISION_CONFIG)
)

/**
 * A deep copy, so callers cannot mutate the table. Mirrors getDefaultConfig in
 * public/effects/config.js.
 *
 * Loosely typed on purpose: this is the accessor the generic control builder
 * uses, and it iterates sections whose names it does not know. Code that wants
 * a specific section should read `allDefaults().gate`, which is precise.
 * @type {Types.getDefaults}
 */
export function getDefaults(section) {
  const found = CONFIG_INDEX[section]
  if (!found) throw new Error(`Unknown vision config section: ${section}`)
  return structuredClone(/** @type {Record<string, number | boolean>} */ (found))
}

/** @type {Types.configSections} */
export function configSections() {
  return Object.keys(VISION_CONFIG)
}

/** @type {Types.allDefaults} */
export function allDefaults() {
  return structuredClone(VISION_CONFIG)
}
