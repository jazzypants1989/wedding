# Handoff: Session 1 (vision) — pipeline wired, nothing measured yet

**Date:** 2026-07-29
**Status:** all 8 tasks complete and green. **Nothing has been run against real
photographs.** That is the owner's step (see "Ownership of the run"), and it is
the only thing standing between here and the four decisions.
**The approved plan lives outside the repo** at
`~/.claude/plans/docs-post-wedding-spec-vision-lab-md-do-sharded-cocke.md`
— read it first; it has the full rationale for every decision summarised here.

**Read with:** [`SESSION-1-vision.md`](./SESSION-1-vision.md) (the session's shape),
[`SPEC-vision-lab.md`](./SPEC-vision-lab.md) (§5 build order, §6 algorithms, §15
working rules), [`VISION-MODELS.md`](./VISION-MODELS.md) (every model fact).

---

## The one-paragraph version

Session 1 answers *"do these descriptors separate these people in these
photographs"* before four weeks are spent hand-writing kernels. It runs a borrowed
inference runtime (`onnxruntime-node`, gitignored, `tmp/rig/`) behind first-party
align/gate/group/metrics code that ships unchanged. **All of it is now written,
tested and typechecked** — the math, the engine wrapper, the batch, the labeller
and the report. What remains is one evening of the owner's own time: run the
batch, label for half an hour, read the report.

---

## What is done

| Built | Where |
|---|---|
| Binary-safe raw pixel path | `scripts/lib/image-backend.js` — `runBinaryRaw`, `buildPixelCommand`, `canRawPixels` |
| PPM decode + area downsample | `scripts/vision/pixels-cli.js` (`parsePpm`, `readPixels`, `boxDownsample`) |
| Tunables table | `public/vision/defaults.js` |
| Similarity fit + 112×112 warp | `public/vision/align.js` |
| Quality signals + cutoff sweep | `public/vision/gate.js` |
| Average-linkage grouping + cannot-link | `public/vision/group.js` |
| Reports A / B / C | `public/vision/metrics.js` |
| Types | `public/vision/types.d.ts`, `scripts/vision/types.d.ts`, additions to `scripts/lib/types.d.ts` |
| Detection post-processing (IoU dedup, box rescale) | `public/vision/detect.js` |
| Frame near-duplicate hash | `public/vision/frame-hash.js` |
| Borrowed engine wrapper | `tmp/rig/engine.mjs` (gitignored; never imported by the repo) |
| Engine seam + PNG encoder | `scripts/vision/engine-loader.js`, `scripts/vision/png-write.js` |
| Weight verification | `scripts/vision/verify-weights.js` |
| The batch | `scripts/vision/session1.js` |
| The labeller | `scripts/vision/label.html` |
| The five reports | `scripts/vision/session1-report.js` |
| Oracle orientation fix | `scripts/vision/oracle-macos.swift` |
| Unit tests | `tests/unit/vision-*.test.js` (11 files) |

**Verified green right now:** `npm run typecheck` (both configs, no output),
`npm test` (1638 tests, 0 failures), `node scripts/vision/verify-weights.js`
(3/3 against the pinned digests), and the PPM path smoked through both magick
and vips with generated gradients.

Also modified: `tsconfig.json` (seven vision tests in `exclude`, following the
`effect-themes.test.js` precedent — they import from `public/`; the other four
new test files do not need an entry and do not have one), and three existing test
fixtures that construct fake `ImageBackend` objects and now need `canRawPixels`.

### Facts established by running things, not by reading docs

- **All three weight files in `tmp/weights/` hash-match the ledger exactly.**
  `yunet.onnx` → `ebafce4e…22f0f0`, SFace fp32 → `0ba9fbfa…c34e79`, SFace int8bq →
  `fb143eea…d74ee`. `tmp/rig/` already has `onnxruntime-node` 1.27 installed with
  four working probe scripts (`t.mjs`–`t4.mjs`). **SESSION-1 §1's setup step is
  already complete.**
- Backends present: vips 8.18.4, ImageMagick 7.1.2-29 Q16-HDRI, sips-316. Node
  v26.5.0.
- `magick ppm:-` on this Q16 build emits **maxval 65535** unless `-depth 8` is
  passed. vips writes a `#vips2ppm` comment into the PPM header. Both are handled;
  both would have been silent corruption with the spec's original headerless
  `RGB:-`.
- Alignment residual separates decisively: **~0.3–1.8 for plausible landmark
  jitter, ~19.6 for swapped eyes, ~22.6 for a full reflection.** The
  `gate.maxResidual: 12` default sits comfortably between, derived from synthetic
  geometry rather than from anyone's photographs.

### Deviations from the docs, already decided and implemented

1. **The gate scores; it does not filter.** `gateSignals()` measures, `applyGate()`
   decides, and the batch must call only the first. SPEC §6.2 requires cutoffs be
   derived from the input's own distribution, which a filtering batch cannot know
   before it runs. Describing a would-be-rejected face costs ~5 ms; re-running
   detection because the cutoff was wrong costs the run.
2. **PPM, not raw RGB** (SPEC §4.1's sketch). The header makes "never trust the
   tool's output" a check instead of an assumption.
3. **Labels are opaque person keys** (`p1`, `p2`…), not guest names. The
   measurement only needs "same person or not". No roster query, no real names in
   `tmp/`. Names attach at tier 1.
4. **Report C added** — leave-one-out rank-1 against multi-example prototypes.
   SESSION-1 §5 Q2 (cluster-first vs label-first) says Report B decides it, but B
   measures clustering purity and Q2 is a classification question. Implemented in
   `metrics.js` as `leaveOneOutRank1`.
5. **Two-level dedup required.** `import-manifest.js:91` hashes *raw file bytes*,
   so it catches renames and exact copies only — not the retouched/re-encoded
   duplicates SPEC §7.2 says are the whole point. A 16×16 luma average-hash off
   the already-decoded buffer is the second level. Built as
   `public/vision/frame-hash.js`; its cutoff is `defaults.dedup.nearDuplicateBits`.
6. **Detections must be IoU-deduped before grouping.** Two boxes surviving NMS on
   one face become a permanent cannot-link split *and* a false different-person
   pair in the metrics. `defaults.detect.duplicateIou` exists for this. Built as `dedupeDetections`
   in `public/vision/detect.js`.
7. **The macOS oracle has a real bug**: `oracle-macos.swift:89` hard-codes
   `orientation: .up` while our pipeline auto-orients, so every rotated photo
   landed in a different frame. Fixed; see correction 6 for what is still open.

---

## What remains — the run

Everything described below this section is built. What is left is the evening
SESSION-1 describes, and all of it is the owner's:

1. `node scripts/vision/verify-weights.js` — takes a second.
2. `export PHOTOS=…`, then the batch. **Nothing searches; the path is the
   argument.**
   ```
   node scripts/vision/session1.js "$PHOTOS" --out tmp/session1 --recursive \
        --engine tmp/rig/engine.mjs --weights tmp/weights
   ```
3. `open tmp/session1/label.html` — ~30 minutes. Boredom is a legitimate
   stopping condition; the measurement degrades gracefully, it just gets noisier.
4. `node scripts/vision/session1-report.js tmp/session1`.
5. Write the recommended cutoffs into `public/vision/defaults.js` — **numbers
   only** — delete `tmp/session1/crops/`, and take SESSION-1 §5's four decisions.

### Corrections found while building — these override the text below

1. **`divisor: 32` is enforced by YuNet's own graph, not by convention.** Its
   FPN adds a stride-32 feature map to an upsampled stride-16 one, so any pad
   that is not a multiple of 32 fails to broadcast and the runtime throws before
   anything decodes. The cell-count guard was kept, re-scoped: it earns its place
   against the "`anchors` means prior boxes" misreading, which *would* decode
   plausible garbage.
2. **Budget ~19 ms per photograph at working resolution, not 16.7.** The
   ledger's number is `session.run` alone; packing NCHW adds a consistent
   ~2.6 ms on top.
3. **The `/255` trap is measurable, not theoretical.** Feeding `crop/255`
   instead of raw 0–255 moves the descriptor by cosine distance ~0.79 on
   *identical pixels* — further apart than two unrelated crops. It does not
   degrade the descriptor, it destroys it.
4. **`labels.json`'s `pool` map covers every face, not only the labelled ones.**
   Iterate `labels` and look the pool up; iterating `pool` computes the headline
   number over faces nobody ever labelled.
5. **`parsePpm`'s "no whitespace after maxval" message misdescribes its fault.**
   A non-whitespace byte there is swallowed into the maxval token and surfaces as
   "unreadable maxval". The file is still correctly refused.
6. **The oracle's orientation fix is verified for the frame, not for the face
   fields.** Quarter-turn boxes match `magick -auto-orient` to within 1 px, but
   roll/yaw/pitch sign conventions, `quality` and the 76-point landmark centroids
   under rotation are unverified — Vision will not detect a synthetic face, and
   closing that needs a real rotated photograph, so it is the owner's to do.
7. `nearDuplicateBits` lives in `public/vision/defaults.js` under a new `dedup`
   section, not as a constant inside the batch.

## What was built — tasks 3 to 8

Kept as a record of what each piece does. The build order that worked: **fix the
contracts in the two `types.d.ts` files first, then parallelise everything.**
Tasks 3, 4, 6 and the `detect.js`/`frame-hash.js` prerequisite are independent;
5 needs 3; 7 needs 5 and 6. Without the contracts fixed first, six parallel
workers invent six incompatible `faces.jsonl` formats.

### Task 3 — `tmp/rig/engine.mjs` (borrowed engine wrapper)

Gitignored scaffolding. **Never imported by anything in the repo** (CLAUDE.md;
SPEC §2.1). Two functions:

- `detect(rgb, w, h)` — pad **bottom and right only** to a multiple of 32 (there
  is no letterbox, so no inverse transform); run YuNet; decode per stride ∈
  {8,16,32} over a row-major `padW/stride` × `padH/stride` grid:
  `score = sqrt(clamp01(cls)·clamp01(obj))`, `cx = (col + bbox[0])·stride`,
  `w = exp(bbox[2])·stride`, `kp[n] = ((kps[2n]+col)·stride, (kps[2n+1]+row)·stride)`.
  Then greedy NMS **pooled across all three strides together**. The output
  dimension named `anchors` means *grid cells* — one prediction per cell, no
  priors. Confirmed by execution: at 320×320, `cls_8` has exactly 1600 = 40×40.
- `describe(crop112)` — SFace **fp32** (`face_recognition_sface_2021dec.onnx`).
  The `int8bq` file declares 30 required graph inputs and a stock runtime refuses
  it. Feed **raw 0–255**; the graph's own `Sub`/`Mul` apply `(x−127.5)/128`.
  Dividing by 255 first silently destroys accuracy. L2-normalise the output.

Input tensor is NCHW `f32[1,3,H,W]`, RGB channel order. See `tmp/rig/t.mjs` and
`t2.mjs` for working ORT session setup.

### Task 4 — `verify-weights.js` + oracle orientation fix

- `scripts/vision/verify-weights.js`: SHA-256 the files against a pinned table
  (digests above), fail loudly on mismatch, flag a 131-byte `.onnx` as the git-lfs
  pointer signature. Types are **already declared** in `scripts/vision/types.d.ts`
  (`PinnedWeight`, `WeightCheck`, `verifyWeights`). This is the honest seed of
  tier 2's `fetch-weights.js`, which `.gitignore` already names.
- `scripts/vision/oracle-macos.swift`: read `kCGImagePropertyOrientation` via
  `CGImageSourceCopyPropertiesAtIndex`, map the EXIF number to
  `CGImagePropertyOrientation`, pass it to `VNImageRequestHandler` instead of
  `.up`. Build with `swiftc -O -o tmp/oracle-macos scripts/vision/oracle-macos.swift`.
  **No `swiftc` entry exists in `.claude/settings.local.json` yet** — expect a
  permission prompt.

### Task 5 — `scripts/vision/session1.js`

`node scripts/vision/session1.js "$PHOTOS" --out tmp/session1 [--detect-edge 1280]`.
Path is always an argument; nothing searches (SPEC §15 r1). Per photograph:

1. Two-level dedup: `hashFile` from `scripts/lib/import-manifest.js` + a 16×16
   luma aHash off the decoded buffer. Record near-dup pairs, don't drop them —
   the report quantifies what they were worth.
2. `readPixels` at 2000 px (`defaults.detect.sourceEdge`); keep the buffer.
3. `boxDownsample` to `detect.longEdge`; detect; **scale boxes back by the
   returned `scale`, not by the requested ratio** (rounding makes them differ).
4. IoU-dedupe detections at `detect.duplicateIou`.
5. `alignFace` from the 2000 px buffer.
6. `gateSignals` — record everything, reject nothing.
7. `describe` every crop. `--mirror-tta` also describes `mirrorCrop` and averages
   before normalising.
8. Detect at 2000 px on a subsample too, for the resolution comparison.

Writes `tmp/session1/`: `crops/*.png`, `faces.jsonl`, `photos.jsonl`, `timing.json`.
Also capture EXIF capture time per photo (`planMediaFile` in
`scripts/lib/media-variants.js` already extracts it) — Report A's time-gap strata
need it.

### Task 6 — `scripts/vision/label.html`

Template copied into `tmp/session1/`. Local file, no server, no network. Grid of
crops in **fixed shuffled order** (cherry-picking easy frontal crops produces a
flattering number and a wrong decision). Keyboard-first: click an exemplar
thumbnail to assign, `n` new person, `x` not-a-face, `?` skip. Writes
`labels.json`.

**Two-pool sampling.** Pool A ≈150 crops, uniform — **the headline separation
number comes only from Pool A**. Pool B is group-assisted bulk labelling at a
tight cutoff, for volume in Reports B and C. Pool B alone biases the measurement
(coverage conditioned on what the model already grouped confidently); Pool A alone
is too slow to reach 3+ faces per person.

### Task 7 — `scripts/vision/session1-report.js`

Terminal summary + `tmp/session1/report.html`. All five reports are already
implemented as pure functions in `metrics.js`; this script assembles them.

- **A — Separation** (Pool A only). Use `pairDistances`'s `keep(i,j)` callback to
  build the strata: all pairs / near-dup frames excluded / split by capture-time
  gap (same minute, same hour, different hour). **The different-hour number is the
  honest one** — same-person pairs from one burst are not evidence.
- **B — Grouping** swept across cutoffs, with and without cannot-link. ⚠
  `groupFaces` **mutates** the matrix passed via `options.matrix` (Lance-Williams
  in place) — rebuild or copy between sweep steps.
- **C — Prototype rank-1** (`leaveOneOutRank1`). This decides Q2.
- **D — Gate value**: sweep each cutoff independently via `applyGate`, report the
  effect on A and C. Answers "is the gate earning its place".
- **E — Cost**: per-stage timing, detector recall at 1280 vs 2000 by IoU against
  the oracle, mirror-TTA A/B, residual distribution.

### Task 8 — remaining test wiring

Extend `tests/unit/import-media-backend.test.js` with `buildPixelCommand` argv
assertions and PPM header cases (including a `#` comment line) — canned strings,
no binaries, matching that file's existing style. The five `vision-*.test.js`
files are done and already in `tsconfig.json`'s `exclude`.

---

## Rules that constrain this work — not advice

From `CLAUDE.md` and SPEC §15. These are enforced, not suggested:

1. **The path is always an argument.** Nothing searches for photographs.
2. **Nothing reads the photographs.** Never open one, never load a crop or contact
   sheet into context, never describe what is in one. Code processes pixels;
   nothing characterises them. *The PNG crops in `tmp/session1/crops/` are not
   blocked by the hook — the restraint there is yours.*
3. **Everything derived is scratch**, under `tmp/`, deleted after.
4. **No measurement of real photographs goes into any file in this repo** — not
   scene descriptions, and *not statistics either*. Tuned constants go into
   `public/vision/defaults.js` as bare numbers with no note of what produced them.
5. The repo is public, which is what makes rule 4 a hard line.

`scripts/hooks/no-photo-snooping.js` enforces much of this as a `PreToolUse` hook.
Two practical notes: **keep `$PHOTOS` as a shell variable** — writing the literal
path out will be blocked if it contains `/Volumes`, `/Documents`, `/Desktop`,
`/Downloads` or `/photos` alongside a photo extension, and `/pictures` is blocked
unconditionally. PNG and WebP are deliberately not photo extensions.

## Ownership of the run

**The owner runs the batch**, not the agent (decided in planning). Build and
unit-test against synthetic inputs; hand over the commands; read back only the
aggregate report.

## Verification checklist

1. `npm run typecheck` — both configs. This is also what enforces "no `node:*` in
   `public/vision/`", since `public/tsconfig.json` declares no node types.
2. `npm test`
3. `node scripts/vision/verify-weights.js`
4. Smoke the pixel path with no photograph:
   `magick -size 640x480 gradient: -depth 8 ppm:-` through `parsePpm`, asserting
   `rgb.length === w*h*3`. Repeat via vips to confirm the `#` comment is skipped.
5. `git status` — nothing from `tmp/` staged, and no number from any run in a
   committed file.

## Then

Write tuned cutoffs into `public/vision/defaults.js` (numbers only), delete
`tmp/session1/crops/`, and take SESSION-1 §5's four decisions — Q1 against Report
A, Q2 against Report C.
