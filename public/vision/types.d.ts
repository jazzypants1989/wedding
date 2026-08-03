/**
 * Types for the venue-agnostic face pipeline (public/vision/).
 *
 * Everything here is pure numeric JS: inputs are typed arrays, outputs are typed
 * arrays and plain objects. No node:*, no DOM. That single constraint is what
 * lets the same code run under the CLI, in a Web Worker, and in the unit tests,
 * without forking the pipeline — and it is checked, not trusted, because
 * public/tsconfig.json declares no `types: ["node"]`.
 */

// --- defaults.js ---

/**
 * The tunables table. Sections are typed precisely so that a consumer reading
 * `allDefaults().gate` gets Record<string, number> and can hand it straight to
 * applyGate — while `getDefaults(name)` stays loose for the generic control
 * builder, which iterates sections it does not know the names of.
 */
export interface VisionDefaults {
  dedup: Record<string, number>
  detect: Record<string, number>
  align: Record<string, number>
  gate: Record<string, number>
  route: Record<string, number>
  group: { cutoff: number; cannotLinkWithinPhoto: boolean }
  describe: { mirrorAverage: boolean }
  assign: { sameBandCutoff: number }
  propagate: { minIou: number; iouMargin: number; corroborationCutoff: number }
}

/** Whole table, deep-copied. */
export function allDefaults(): VisionDefaults

/** One section, deep-copied. Throws on an unknown name. */
export function getDefaults(section: string): Record<string, number | boolean>

export function configSections(): string[]

/** Tightly packed RGB, orientation already applied. Seam 1's contract. */
export interface RgbImage {
  width: number
  height: number
  rgb: Uint8Array
}

/** A detection box in source pixels. */
export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
}

// --- detect.js ---

/**
 * One face, in whatever coordinate frame it was decoded in. The engine decodes
 * in the DETECTION frame (a downsample); `scaleDetections` maps a batch back to
 * the source frame the crops are taken from.
 */
export interface Detection {
  box: FaceBox
  /** Flat [x0,y0,...], five points, same frame as `box`. */
  landmarks: number[]
  score: number
}

/** Intersection over union. 0 when the boxes do not overlap. */
export function boxIou(a: FaceBox, b: FaceBox): number

/**
 * Multiply boxes and landmarks by 1/scale, mapping a detection made on a
 * downsampled buffer back into source pixels.
 *
 * `scale` is the ACTUAL ratio `boxDownsample` achieved, not the requested one —
 * rounding makes them differ, and the difference is a slow drift that reads as
 * a bad detector.
 */
export function scaleDetections(
  detections: readonly Detection[],
  scale: number,
): Detection[]

/**
 * Drop any detection overlapping a higher-scoring kept one above `iou`.
 *
 * Distinct from NMS and required after it. Two boxes surviving NMS on one face
 * become a permanent cannot-link split in `groupFaces` AND a false
 * different-person pair in the metrics — worse than losing the detection.
 * Input order is irrelevant; the highest score always wins.
 */
export function dedupeDetections(
  detections: readonly Detection[],
  iou: number,
): Detection[]

// --- frame-hash.js ---

/**
 * `size`×`size` luma average hash, lowercase hex, MSB-first.
 *
 * The second level of duplicate detection. `hashFile` in
 * scripts/lib/import-manifest.js hashes raw file bytes, so it catches renames
 * and exact copies only — not the retouched and re-encoded copies of one frame
 * that a photo delivery is full of, which is the case that matters: two
 * near-identical frames make two near-identical descriptors, collapsing
 * same-person distances toward zero and forging a good result.
 */
export function averageHash(image: RgbImage, size?: number): string

/** Differing bits between two equal-length hex hashes. -1 if lengths differ. */
export function hammingDistance(a: string, b: string): number

// --- align.js ---

/**
 * A similarity transform mapping source pixels to output pixels:
 *   x' = a*x - b*y + tx
 *   y' = b*x + a*y + ty
 * Rotation and uniform scale only. No shear and, critically, no reflection.
 */
export interface SimilarityTransform {
  a: number
  b: number
  tx: number
  ty: number
  /** hypot(a, b). Above 1 means the crop is upsampled from a small face. */
  scale: number
  /** radians */
  rotation: number
  /** RMS landmark error after fitting, in output pixels. */
  residual: number
}

export interface AlignResult {
  crop: RgbImage
  transform: SimilarityTransform
  scale: number
  /**
   * The mirror check, free. Reflection is excluded from the transform family, so
   * a swapped or mirrored landmark order cannot be absorbed by the fit and shows
   * up here as a systematically large error. A mirrored crop otherwise looks
   * entirely plausible and quietly degrades every match.
   */
  residual: number
  /** Fraction of output samples that mapped outside the source frame. */
  outsideFraction: number
}

export interface AlignOptions {
  size?: number
  /** Flat [x0,y0,...]. Comes from pack metadata in the shipped pipeline. */
  template?: readonly number[]
}

/** Least-squares similarity fit. Both lists are flat [x0,y0,x1,y1,...]. */
export function fitSimilarity(
  src: readonly number[] | Float32Array,
  dst: readonly number[] | Float32Array,
): SimilarityTransform

export function alignFace(
  image: RgbImage,
  landmarks: readonly number[] | Float32Array,
  options?: AlignOptions,
): AlignResult

/** Horizontal flip, for mirror-averaged description. */
export function mirrorCrop(image: RgbImage): RgbImage

/** Swap the two eye points. Test scaffolding only — see the implementation. */
export function swapEyeOrder(landmarks: readonly number[]): number[]

// --- gate.js ---

export interface GateSignals {
  score: number
  /** Shorter box edge, source pixels. */
  boxPx: number
  /** Distance from box to nearest image edge; negative when it runs off. */
  borderPx: number
  /** Eye separation / box width. Doubles as the pose proxy. */
  eyeRatio: number
  /** Eye-line tilt, radians. */
  eyeAngle: number
  alignScale: number
  residual: number
  outsideFraction: number
  sharpness: number
}

export interface GateInput {
  box: FaceBox
  landmarks: readonly number[] | Float32Array
  imageWidth: number
  imageHeight: number
  score: number
  crop: RgbImage
  alignScale: number
  residual: number
  outsideFraction: number
}

export interface GateVerdict {
  pass: boolean
  /** Every failing check. */
  reasons: string[]
  /** The first failing check in cost order, for single-attribution breakdowns. */
  primaryReason: string | null
}

/**
 * Laplacian energy normalised by pixel count and by local contrast, so it is
 * comparable across crop sizes and exposures. Raw variance is neither.
 */
export function sharpness(crop: RgbImage): number

export function gateSignals(input: GateInput): GateSignals

export function applyGate(signals: GateSignals, cutoffs: Record<string, number>): GateVerdict

// --- route.js ---

/**
 * What the Faces tab does with a face. Not a quality score and not a verdict on
 * the person — `set_aside` means "not worth your attention", never "not a face"
 * and never "deleted". Every state is still grouped and still nameable.
 */
export type RouteState = "accept" | "ask" | "set_aside"

export interface RouteVerdict {
  state: RouteState
  /**
   * Which check decided. The failing gate check for `set_aside`, the weakest
   * accept condition for `ask`, and null for `accept` — nothing held it back.
   */
  reason: string | null
  /**
   * Absolute ordering score in [0, 1], for ranking WITHIN `ask`: how close the
   * face came to `accept`. Never a percentile and never population-relative, so
   * it is comparable across ingests. 1 for `accept`, 0 for `set_aside`.
   */
  score: number
  /** The cutoff set this grade was computed under. See route.js PROFILE. */
  profile: string
}

export function routeFace(signals: GateSignals, cutoffs: Record<string, number>): RouteVerdict

/** `defaults.gate` and `defaults.route` flattened into one table. */
export function routeCutoffs(overrides?: Record<string, number>): Record<string, number>

export function isRouteState(value: unknown): value is RouteState

export function gateCheckKeys(): string[]

// --- group.js ---

/** N descriptors of `dim` each, packed end to end. */
export interface DescriptorSet {
  dim: number
  data: Float32Array
}

export interface FaceGroup {
  /** Indices into the descriptor set, ascending. */
  members: number[]
  size: number
}

export interface GroupOptions {
  /** Cosine DISTANCE, not similarity. Merging stops above this. */
  cutoff: number
  /** Per-face photograph id. Required for the cannot-link constraint. */
  photoIds?: readonly number[] | Int32Array
  cannotLinkWithinPhoto?: boolean
  /** Precomputed matrix, so a cutoff sweep does not rebuild it. Mutated. */
  matrix?: { n: number; d: Float32Array }
}

/** `1 - cosine similarity`. 0 identical, 1 orthogonal, 2 opposite. */
export function cosineDistance(
  a: Float32Array,
  b: Float32Array,
  offsetA?: number,
  offsetB?: number,
  dim?: number,
): number

export function l2Normalize(vec: Float32Array): Float32Array

/**
 * Full symmetric matrix, n*n floats. Deliberately the obvious data structure:
 * at a few thousand faces it is tens of megabytes and builds in seconds.
 *
 * ⚠ `groupFaces` MUTATES this in place (Lance-Williams). Rebuild or copy it
 * between cutoff sweeps.
 */
export function distanceMatrix(set: DescriptorSet): { n: number; d: Float32Array }

export function groupFaces(set: DescriptorSet, options: GroupOptions): FaceGroup[]

/** Mean of the given members, re-normalised to unit length. */
export function centroid(set: DescriptorSet, indices: readonly number[]): Float32Array

// --- metrics.js ---

export interface Histogram {
  min: number
  max: number
  counts: number[]
}

export interface Percentiles {
  [key: string]: number
}

export interface SeparationReport {
  sameCount: number
  diffCount: number
  /**
   * P(a random same-person pair is closer than a random different-person pair).
   * The headline: threshold-free, so it says whether the signal exists at all,
   * separately from whether any single cutoff can exploit it.
   */
  auc: number
  eer: number
  eerThreshold: number
  /** Maximises TPR - FPR. */
  bestThreshold: number
  bestTpr: number
  bestFpr: number
  /** To catch 95% of true matches, how often are two people confused. */
  fprAt95Tpr: number
  samePercentiles: Percentiles
  diffPercentiles: Percentiles
  sameHistogram: Histogram
  diffHistogram: Histogram
}

export interface GroupingReport {
  groups: number
  labelledFaces: number
  people: number
  purity: number
  completeness: number
  pairPrecision: number
  pairRecall: number
  pairF1: number
  /** Groups containing more than one labelled person. The expensive failure. */
  weldedGroups: number
}

export interface Rank1Report {
  evaluated: number
  correct: number
  rank1: number
  /** People with a single face, who cannot be evaluated leave-one-out. */
  singletonPeople: number
  marginPercentiles: Percentiles
  perPerson: Array<{ label: string; n: number; rank1: number }>
}

export function percentile(sortedAsc: readonly number[], p: number): number

export function histogram(
  values: readonly number[],
  binCount: number,
  min: number,
  max: number,
): Histogram

/** One same-person pair distance, tagged with the person it belongs to. */
export interface TaggedSamePair {
  distance: number
  person: string
}

/** One different-person pair distance, tagged with both people. */
export interface TaggedDiffPair {
  distance: number
  personA: string
  personB: string
}

/**
 * All labelled pairs, split by whether they are the same person.
 * `keep(i, j)` filters — that is how the report builds its strata (excluding
 * near-duplicate frames, or splitting by capture-time gap) without this function
 * knowing anything about photographs.
 *
 * `sameTagged`/`diffTagged` carry the same distances as `same`/`diff`, each
 * paired with the person id(s) that produced it — what `bootstrapAuc` needs
 * to resample by person rather than by pair.
 */
export function pairDistances(
  set: DescriptorSet,
  options: {
    labels: ReadonlyArray<string | null>
    keep?: (i: number, j: number) => boolean
  },
): { same: number[]; diff: number[]; sameTagged: TaggedSamePair[]; diffTagged: TaggedDiffPair[] }

export function separation(
  same: readonly number[],
  diff: readonly number[],
  options?: { bins?: number },
): SeparationReport

export function groupingQuality(
  groups: readonly FaceGroup[],
  labels: ReadonlyArray<string | null>,
): GroupingReport

/**
 * Rank-1 accuracy against per-person prototypes, holding each face out of its
 * own prototype. This is the number that decides cluster-first vs label-first.
 *
 * `queryMask` restricts which faces are asked, by row. Prototypes are still
 * built from every label in `labels`, so the candidate pool — and therefore the
 * difficulty — is unchanged. That is what makes a held-out subset's rank-1
 * comparable to the number measured over everybody; masking the prototypes too
 * would quietly measure an easier problem and report it as the same one.
 */
export function leaveOneOutRank1(
  set: DescriptorSet,
  labels: ReadonlyArray<string | null>,
  options?: { queryMask?: ReadonlyArray<boolean> },
): Rank1Report

export interface BootstrapAucResult {
  /** Point estimate: every person weighted 1 — the same statistic `separation`'s `auc` reports. */
  auc: number
  /** 2.5th percentile of the resampled AUCs. NaN if refused or every resample was degenerate. */
  lo: number
  /** 97.5th percentile. */
  hi: number
  /** Resamples requested. 0 when refused outright (see below). */
  resamples: number
  /** Resamples where one side's total cluster weight came out to zero. Counted, never dropped silently. */
  degenerate: number
}

/**
 * Person-level cluster bootstrap over `pairDistances`'s tagged output. Each
 * resample draws one Poisson(1) multiplicity per distinct person (reweight,
 * never duplicate — see poisson1 in metrics.js), weights a same-pair by its
 * person's multiplicity and a diff-pair by the product of both people's, and
 * computes a weighted Mann-Whitney AUC over the reweighted pool.
 *
 * Refuses — returns `{ auc: NaN, lo: NaN, hi: NaN, resamples: 0, degenerate: 0 }`
 * — when fewer than 3 distinct people appear on either side: too few
 * independent units for a resample to vary over.
 */
export function bootstrapAuc(
  same: readonly TaggedSamePair[],
  diff: readonly TaggedDiffPair[],
  random: () => number,
  resamples: number,
): BootstrapAucResult

// --- assign.js ---

/** One person's confirmed faces, collapsed to a centroid. */
export interface Prototype {
  label: string
  vector: Float32Array
}

/**
 * Per-person centroid prototypes from confirmed faces only. `assignments[i]`
 * is the confirmed person for descriptor `i`, or null if unconfirmed —
 * unconfirmed rows contribute to no prototype.
 */
export function buildPrototypes(set: DescriptorSet, assignments: ReadonlyArray<string | null>): Prototype[]

export interface MatchCandidate {
  label: string
  distance: number
}

export interface MatchResult {
  /** Ascending by distance. */
  candidates: MatchCandidate[]
  best: MatchCandidate | null
  /**
   * d(second-best) - d(best). Always >= 0 by construction (a tie is 0; this
   * ranks candidates against each other, it does not know which one is
   * truth, so it can never be negative). NaN with zero prototypes (nothing to
   * rank). Infinity with exactly one (no competitor to be unsure about —
   * `best.distance` must still be checked against a threshold separately;
   * a lone prototype can be a bad match with nothing around to reveal it).
   */
  margin: number
}

/** Ranks `descriptor` against every prototype by cosine distance. */
export function matchFace(descriptor: Float32Array, prototypes: readonly Prototype[]): MatchResult

export interface AssignOptions {
  /** Cost of leaving a face unassigned. A candidate is only taken when it beats this. */
  abstainCost: number
  /**
   * Cosine distance below which two faces in ONE photo are suspected to be
   * the same face detected twice, or two people who are true look-alikes —
   * either way, not a case a forced distinct assignment should paper over.
   */
  sameFaceSuspicionCutoff: number
}

export interface FaceAssignment {
  faceIndex: number
  /** null = abstained. */
  label: string | null
  distance: number | null
}

export interface PhotoAssignment {
  assignments: FaceAssignment[]
  /**
   * True when two faces in this photo tripped `sameFaceSuspicionCutoff`.
   * `assignments` is then all-abstain (every `label` null) and `totalCost` is
   * null — the caller routes the photo to review instead of trusting either
   * forced assignment.
   */
  suspicious: boolean
  suspiciousPairs: Array<[number, number]>
  /** Sum of chosen costs (matched distances + abstains). Null when `suspicious`. */
  totalCost: number | null
}

/**
 * Joint per-photo assignment: a cost matrix of faces x prototypes, with one
 * abstain column per face priced at `options.abstainCost`, minimizing total
 * cost subject to no prototype being used by more than one face.
 *
 * Exact (permutation search) for `faces.length <= 8` — `k!` bounded,
 * independent of how many prototypes exist, by restricting the search to the
 * `faces.length` prototypes closest to any face in the photo (the optimum can
 * never use more than that many). Greedy, most-confident-face-first, above 8.
 * Never Kuhn-Munkres.
 */
export function assignPhoto(
  faces: readonly Float32Array[],
  prototypes: readonly Prototype[],
  options: AssignOptions,
): PhotoAssignment

// --- must-link.js ---

/** One face as the propagator sees it. */
export interface PropagationFace {
  faceId: number
  /**
   * ALREADY-RESOLVED frame equivalence key — a union-find root, never a
   * one-hop duplicate pointer. `frameRoots()` output on the CLI side,
   * `media.frame_root_sha256` on the server side.
   */
  frame: string | number
  /** Distinct photograph within the frame class. */
  photoId: number
  box: FaceBox
  /** Confirmed identity, or null if undecided. */
  identityId: number | null
  /** Row in the companion DescriptorSet, or null when the face has none. */
  descriptorRow: number | null
}

export interface PropagationProposal {
  fromFaceId: number
  toFaceId: number
  identityId: number
  /** IoU of the two boxes across the frame pair. */
  iou: number
  /** IoU of the next-best box in the target photo — the ambiguity check's denominator. */
  runnerUpIou: number
  /** Cosine distance between the two descriptors. */
  distance: number
}

export type PropagationSuppressionReason =
  /** No box in the target photo overlapped the source enough to consider. */
  | "no-overlap"
  /** Best box did not beat the runner-up by `iouMargin` — two people side by side. */
  | "ambiguous-box"
  /** Target already carries a DIFFERENT confirmed identity; never overwritten. */
  | "already-identified"
  /** Target has no descriptor, so rule 3 has nothing to corroborate with. */
  | "no-descriptor"
  /** Descriptors disagree past `corroborationCutoff` — geometry was not enough. */
  | "descriptor-disagrees"
  /** Two different source faces both claimed this target. Both dropped. */
  | "conflicting-sources"
  /** One identity claimed two boxes in a single photo. Both dropped. */
  | "duplicate-identity-in-photo"

export interface PropagationSuppression {
  fromFaceId: number
  toFaceId: number
  identityId: number
  reason: PropagationSuppressionReason
  iou: number
  runnerUpIou: number
  distance: number | null
}

export interface PropagationOptions {
  /** Floor on best-box overlap before a propagation is even considered. */
  minIou: number
  /** How far the best box must beat the runner-up. Rule 2. */
  iouMargin: number
  /** Cosine distance above which the descriptors are taken to disagree. Rule 3. */
  corroborationCutoff: number
}

/**
 * Propose carrying confirmed identities onto unidentified faces in
 * near-duplicate frames. Every result is a PROPOSAL — nothing here decides,
 * and a caller that writes one must record it as `provenance='propagated'` so
 * it can never seed a prototype (rule 4).
 *
 * Deterministic: frames are visited in sorted key order and photos in
 * ascending id, so the same input always yields the same list in the same
 * order regardless of Map iteration or input ordering.
 */
export function propagateWithinFrames(
  faces: readonly PropagationFace[],
  set: DescriptorSet,
  options: PropagationOptions,
): { proposals: PropagationProposal[]; suppressed: PropagationSuppression[] }

// --- confidence.js ---

/**
 * Percentile rank of every gate.js signal for one face, within the run's own
 * population, then the MINIMUM of the nine as the crop's confidence — one
 * bad signal should not be diluted by eight fine ones. See confidence.js for
 * the per-signal polarity table (three signals are non-monotonic and folded
 * around their population median before ranking).
 */
export function cropConfidence(
  signals: GateSignals,
  allSignals: readonly GateSignals[],
): { confidence: number; signalRanks: Record<keyof GateSignals, number> }

/** One point on a margin -> P(correct) calibration curve. */
export interface CalibrationKnot {
  margin: number
  /** Probability, in [0, 1]. */
  p: number
}

/**
 * Maps a `matchFace` margin to P(correct) via piecewise-linear interpolation
 * over `calibration`, clamped at both ends. The table itself is built
 * elsewhere (report-side, from labelled data); this is the pure evaluator.
 *
 * Throws if `calibration` is empty, any knot's `p` is outside [0, 1], or the
 * knots are not sorted strictly increasing by margin. Returns NaN for a NaN
 * margin (matchFace's zero-prototype case — nothing to look up).
 */
export function matchConfidence(margin: number, calibration: readonly CalibrationKnot[]): number
