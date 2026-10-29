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

  route: {
    /**
     * The two bars a face must clear, ON TOP of passing every gate check, to be
     * routed `accept` rather than `ask`. Failing either is not a rejection —
     * `set_aside` is the gate's job, and these faces are still shown, still
     * grouped, still nameable. It is only the difference between "here, name
     * this" and "here, is this nameable at all?"
     *
     * Two constants rather than nine because a face that reaches this decision
     * has already cleared all nine gate cutoffs, so the question left is not
     * "is it a face" but "can a human put a name to it" — and size and
     * sharpness are what that turns on.
     *
     * ⚠ **NEITHER OF THESE IS TUNED.** They are placed deliberately
     * conservatively — erring toward `ask`, which costs a question, over
     * `accept`, which costs a wrong name — and they are the reference values
     * this ships with, not values derived from anything. See the tuning note
     * below. Changing either means bumping `PROFILE` in route.js.
     */
    /** Minimum shorter box edge, in SOURCE pixels, to be worth auto-accepting. */
    acceptMinBoxPx: 96,
    /** Normalised Laplacian energy, same scale as `gate.minSharpness`. */
    acceptMinSharpness: 0.01,
  },

  group: {
    /**
     * Cosine DISTANCE (1 - cosine similarity), not similarity. Still tighter
     * than any verification threshold, because the costs remain asymmetric —
     * but less so than before, because the old value's cost model was wrong.
     *
     * That model was "one person split across three groups costs two clicks",
     * and both halves were wrong about this UI rather than about any
     * photograph. The tab listed every group at full length with no name
     * suggested, so each extra group cost a scroll and a retype, not a click.
     * And "three" was an assumption the comment made, never a measurement it
     * had. So a tight cutoff was buying purity against a fragmentation cost the
     * comment had no basis for pricing.
     *
     * Derive locally before changing this, and write nothing down: sweep the
     * cutoff over a labelled run, plot groups-per-person against faces landing
     * in the wrong group, and take the knee. Both of those curves are
     * measurements of identifiable people, so they stay where the photographs
     * are (CLAUDE.md's fourth photograph rule). This table carries the value
     * and the method; never the evidence.
     */
    cutoff: 0.55,
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
    /**
     * The bar a GROUP's suggested name must clear, or the group is shown with
     * no suggestion ("no confident match") instead of the nearest person's.
     *
     * `matchFace` always returns its nearest prototype — there is no "nobody"
     * in its answer. Before this bar, a group the recogniser could not place
     * (a pile of profiles and backs of heads, clustered by viewpoint rather
     * than by person) still arrived labelled with whoever's prototype its
     * centroid happened to land nearest, and the bulk-confirm button sat right
     * beside that wrong name.
     *
     * `suggestMaxDistance` reuses the published verification distance, like
     * `sameBandCutoff`: beyond it the reference model itself would call the
     * pair different people, so it is a reference point, not a fitted value.
     * It also guards a lone prototype, whose margin is Infinity.
     */
    suggestMaxDistance: 0.64,
    /**
     * Minimum lead of the best person over the runner-up (cosine distance).
     * ⚠ **UNTUNED placeholder**, deliberately on the abstaining side: a missing
     * suggestion costs a typed name, a wrong one costs a wrong bulk confirm.
     * In the tuning pass's list below.
     */
    suggestMinMargin: 0.05,
  },

  propagate: {
    /**
     * Floor on how much the source box must overlap the best box in the
     * neighbouring frame before propagation is even considered. High, because
     * these are near-duplicate frames: the same person a fraction of a second
     * apart barely moves, so a genuine match overlaps heavily and anything
     * that does not is a different person, not a moved one.
     */
    minIou: 0.5,
    /**
     * How far the best box must beat the runner-up. Rule 2 of must-link.js.
     * Two guests standing shoulder to shoulder both overlap a source box
     * respectably; without a margin, "best of two near-ties" attaches one
     * person's name to the person beside them.
     */
    iouMargin: 0.2,
    /**
     * Cosine DISTANCE above which the two descriptors are taken to disagree
     * and the propagation is suppressed however good the geometry looks.
     * Deliberately looser than `group.cutoff`: this is a veto, not a decision.
     * Its job is to catch the case geometry cannot see at all — two people
     * swapping places between frames — not to re-adjudicate identity, and a
     * tight value here would veto exactly the poor-quality faces the whole
     * mechanism exists to recover.
     */
    corroborationCutoff: 0.64,
  },
}

/**
 * ## The tuning pass — deferred deliberately, and to be done in ONE sitting
 *
 * Almost every number above is a reference default: published constants from
 * OpenCV and a model card, plus conservative placeholders. Nothing here has
 * been fitted to event photography, and event photography is what this runs on.
 *
 * **Owner ruling (2026-08-03): do not tune piecemeal.** Nothing is shipped yet,
 * so there is no live behaviour to protect, and tuning one section at a time
 * means re-deriving the same distributions repeatedly and re-grading against a
 * moving target. It happens once, after the pipeline has run end to end against
 * real input and the failure modes are visible rather than guessed at.
 *
 * When that pass happens, the order that makes sense — each stage's output is
 * the next one's input, so tuning downstream first means tuning it twice:
 *
 * 1. `detect` and `dedup`, against the independent oracle.
 * 2. `gate`, against faces the oracle also found. The floor question is "is
 *    this a face at all", so a signal's cutoff belongs where it stops
 *    discarding real detections.
 * 3. `group.cutoff`, from the same/different distance distributions.
 * 4. `route`, last, because it is defined relative to the gate. **The 22
 *    skipped pool-A faces are the calibration set**: they are faces a careful
 *    human looked at and declined to name, so any of them this table would
 *    route `accept` is a threshold that needs moving. `route.acceptMinBoxPx`
 *    and `route.acceptMinSharpness` are the two to move; the leading candidate
 *    for a third is a pose bar above `gate.minEyeRatio`, since a face turned
 *    far enough is unnameable long before it stops being detectable.
 * 5. `propagate` and `assign` last of all — both are vetoes and priority
 *    signals rather than identity decisions, so they are the least sensitive.
 *    `assign.suggestMinMargin` is the untuned one: derive it from the margins
 *    of groups whose suggestion the human accepted against those they renamed,
 *    and put the bar where a wrong suggestion stops being common.
 *
 * **Then bump `PROFILE` in route.js**, and re-grade. `media_faces.route_profile`
 * exists exactly so that old rows say which table they were graded under
 * instead of silently re-meaning.
 *
 * ⚠ And per CLAUDE.md's fourth photograph rule: replace the NUMBER and nothing
 * else. What was measured to arrive at it does not go in this repository, in a
 * comment or anywhere else. This note names which distribution to derive each
 * one from, which is the pattern that rule prescribes.
 */

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
