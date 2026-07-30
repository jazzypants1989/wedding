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
  group: { cutoff: number; cannotLinkWithinPhoto: boolean }
  describe: { mirrorAverage: boolean }
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

/**
 * All labelled pairs, split by whether they are the same person.
 * `keep(i, j)` filters — that is how the report builds its strata (excluding
 * near-duplicate frames, or splitting by capture-time gap) without this function
 * knowing anything about photographs.
 */
export function pairDistances(
  set: DescriptorSet,
  options: {
    labels: ReadonlyArray<string | null>
    keep?: (i: number, j: number) => boolean
  },
): { same: number[]; diff: number[] }

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
