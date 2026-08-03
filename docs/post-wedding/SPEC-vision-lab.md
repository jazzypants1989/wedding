# Spec: the Vision Lab — a first-party face pipeline

**Date:** 2026-07-29, revised 2026-07-31 (revision 5)
**Status:** **living build spec — partly built.** Tiers 0 and 1 exist in the
repository; tiers 2–7 do not. This document describes the whole design including
the parts not yet written, so read every section as "the design", and read
[`VISION-STATUS.md`](./VISION-STATUS.md) for what actually exists today. Where a
section describes something unbuilt, it now says so inline.
**Read first:** [`DECISIONS-vision.md`](./DECISIONS-vision.md) — the owner's
binding answers, which settle §2.1's fork and §14's Q4 · then
[`VISION-MODELS.md`](./VISION-MODELS.md) — every model fact this spec depends
on, each one parsed out of the actual file.
**Background:** [`../what-counts-as-a-dependency.md`](../what-counts-as-a-dependency.md)
(why borrowed weights are acceptable and borrowed code is not).

**There is deliberately no code in this document.** Every algorithm is described
in plain language, precisely enough to implement from scratch in this repo's
idiom. Where a reference implementation exists, it is cited as the *specification
of behaviour*; read it to check your understanding, not to translate. If
something here is ambiguous, ask.

Two project rules govern everything below, and both were earned the hard way:

> **Parse the artifact, don't cite the write-up.** Model cards, papers and
> READMEs describe these files inaccurately often enough to be useless as an
> implementation reference. `scripts/vision/inspect-onnx.js` exists for this.

> **Every threshold here is a reference default, not a measured one.** Published
> defaults come from benchmark datasets; the repo's seeded test images are venue
> details and props, so they are no better. Tuning is done locally by whoever
> runs the pipeline, against input they own, and **the results stay local** —
> `tmp/`, gitignored, deleted afterwards. See §15.

---

## 1. What we're building

Assisted face tagging for the gallery, against the known guest roster in the
`guests` table, with the owner confirming everything. Four stages —
**detect → align → describe → group** — then a human attaches names.

That framing is load-bearing. This is not open-set identification; it is
**ranking and grouping that a human confirms**. It tolerates a far weaker signal
than authentication would, and it is a better product besides.

Design targets, so the engineering has a scale to aim at: a few thousand
photographs at up to ~25 MP, a roster of ~100 names, and a batch that runs on one
machine in minutes. Nothing below depends on any property of a particular set of
photographs.

Three new directories and one extended page (⊙ = exists today, ○ = designed, not
built):

```
⊙ public/vision/          venue-agnostic pipeline: align, gate, group, metrics,
                          assign, confidence, must-link, frame-hash, defaults.
                          Pure numeric JS. No DOM, no node:*. Fully unit-tested
○ public/vision/weights/  gitignored (already reserved in .gitignore); the
                          directory does not exist yet because nothing fetches
                          into it — weights currently live in tmp/weights/ and
                          are checked by scripts/vision/verify-weights.js
⊙ scripts/vision/         the CLI side: session1 batch, report, labeller,
                          relabel, oracle, inspector, ingest, weight verifier
○ public/pages/studio/    EXTENDED — a third bench
  ⊙ effects lab           existing — 29 effects, live param tuning
  ⊙ sound lab             existing — synth cues vs samples A/B
  ○ vision lab            NOT BUILT  (§9)
```

⚠ **`public/vision/` is not yet the whole pipeline.** It holds every stage the
project wrote itself; **detect** and **describe** are still the borrowed engine's
(§2.1), reached through `scripts/vision/engine-loader.js`. `public/vision/detect.js`
exists, but it is the geometry *after* detection — rescaling boxes to source
pixels and de-duplicating survivors — not the network. The head decode of §6.1,
the NMS, the convolutions: all still the borrowed runtime's. That is tier 3–4
work, and §6.1 below is its specification rather than a description of what runs
today.

**Explicit non-goal:** do not rewrite the 29 visual effects onto the GPU. They
are DOM-based, they work, the payoff is nil. `public/vision/` is justified on its
own terms.

---

## 2. The dependency rule, and the one honest fork in this project

`CLAUDE.md` already draws this line in three tiers:

| Tier | Examples | Rule |
|---|---|---|
| **Code that executes in our process** | kernels, decode, grouping, loaders, the converter | **We write it.** All of it |
| **Inert data** | trained weights, CC0 sound samples | **May vendor**, licence recorded, provenance documented, hash pinned. Committing is a separate decision — weights are fetched (§3) |
| **Dev-machine tools** | vips, ImageMagick, ffmpeg, macOS Vision | **CLI only**, never the request path, probed by try-exec, argv arrays, output never trusted |

Why the middle tier is defensible: every cost that "dependency" is a proxy for —
supply-chain injection, transitive graphs, upgrade treadmills, API churn, CVEs —
is a cost of **code that executes and changes.** A pinned array of floats has
none of them.

### 2.1 The borrowed engine, and what it may and may not do

A stock inference runtime (`onnxruntime-node`, installed into the gitignored
`tmp/rig/`) can run both models on this machine today. It is verified working:
detector 16.7 ms per photo at working resolution, recogniser 5.1 ms per face.

That is enormously useful and it is also a genuine problem, so be precise about
it. It is **npm code that executes in our process**, which is tier 1 — the tier
we write ourselves. It is not analogous to vips: vips is a separate binary
invoked over a pipe, and the rule that permits it says *CLI only, never on the
request path*. A library `import`ed into our own process is a different thing,
and stretching tier 3 to cover it would be exactly the kind of reasoning this
project has committed to not doing.

So the honest position, stated once:

- **As scaffolding and as an oracle: yes, without reservation.** It lives in
  `tmp/rig/`, it is never imported by anything in the repo, nothing it produces
  is trusted without re-checking, and it is deleted when the kernels pass. This
  is how we find out whether the product works before spending four weeks, and
  it is how every hand-written layer gets checked (§8).
- **As the *permanent* shipped implementation: no, not without changing the
  rule.** Which is a decision the owner can legitimately make — it is a different
  project, not a worse one, and it takes about three days instead of four weeks.

### ⚠ 2.1a The owner has answered this, and the answer is BOTH

[`DECISIONS-vision.md`](./DECISIONS-vision.md) §1 settles what this section and
§14 Q4 both leave open, and no session re-litigates it:

> **A usable feature first, as fast as possible, on the borrowed engine,
> admin-only. Then weeks of dedicated craft** — tiers 2–4 and beyond, ending with
> the borrowed engine deleted.

That is not a third option; it is this section's first answer with an explicit
interim. The borrowed engine's status is unchanged — **scaffolding with an
extended lifetime.** It stays in `tmp/rig/`, no module in the repository names
it, it is never on the server request path, and it is deleted in the craft phase.
What §2.1 forbids is shipping it as the *permanent* implementation, and the craft
phase is precisely what removes the permanence.

So no rule changes, and nothing in §§5–8 collapses. The one thing that does
change is *ordering*: tier 1 ships before tiers 2–4 rather than after, which is
what the ladder in §5 was designed for anyway.

**WASM is excluded by the same rule**, not by the Content-Security-Policy. Every
WASM runtime worth having is third-party code. (The CSP is already per-page —
`core/static.js` has `FRAMEABLE_SAMEORIGIN_PAGES` — so scoping a relaxation to
`/studio` would be precedented and easy. It just isn't the reason.) Plain JS and
Web Workers are fine under `default-src 'self'`; WGSL is not governed by
`script-src`.

---

## 3. Weights are fetched, verified, and never committed

**This repository is public.** Committing a weights file makes us its
*distributor*, which is a different permission from *using* it — and the one
place where "we're non-commercial" stops being a sufficient answer, because
copyleft does not care about commercial status.

⚠ **Build status: half of this exists.** The verification half is written and
tested; the fetching half is not, and `scripts/vision/fetch-weights.js` **does
not exist**. Several documents refer to it in the present tense; they are
describing the design. What is real today:

| Piece | State |
|---|---|
| `public/vision/weights/` gitignored | ⊙ reserved in `.gitignore`; directory not created, because nothing writes to it |
| Pinned SHA-256 table | ⊙ **built** — in `scripts/vision/verify-weights.js`, sourced from the ledger |
| Hash check that fails loudly | ⊙ **built**, and it does three things `shasum -c` does not (see the file's header): matches by *bytes* rather than filename, names a git-lfs pointer file as such instead of letting it fail misleadingly downstream, and distinguishes missing from wrong |
| Downloading | ○ **not built.** Weights are placed by hand and verified after |
| `<name>.LICENCE.md` generation | ○ not built |
| The converter (`pack-tensors.js`) | ○ not built — tier 2 |
| Model registry | ○ not built; the ledger is currently the registry, read by humans |

The design, unchanged and still the target:

- `public/vision/weights/` is **gitignored**.
- `scripts/vision/fetch-weights.js` reads the pinned table in
  [`VISION-MODELS.md`](./VISION-MODELS.md), downloads, **verifies SHA-256 and
  refuses to proceed on mismatch**, runs the converter, and writes
  `<name>.LICENCE.md` beside each artifact with source URL, full licence text,
  retrieval date and hash. `verify-weights.js` is the honest seed of it — the
  fetch list minus the fetching — so building it means adding a downloader in
  front of a check that already works.
- A **model registry** — a plain data table, the way `EFFECT_CONFIGS` is — holds
  per model: source URL, hash, licence id, input layout, **normalisation
  constants**, **alignment template**, descriptor dimension, recommended
  threshold, landmark order.

⚠ **Two verified download facts, both of which cost time to discover.**
`raw.githubusercontent.com` URLs for these files return **131-byte git-lfs
pointer files**, not models. The real bytes come from
`media.githubusercontent.com/media/opencv/opencv_zoo/<ref>/...`. Pin `<ref>` to a
commit SHA, not `main`, so the URL is immutable. Both are recorded in the ledger.

Since hash pinning protects integrity but not availability, `fetch-weights.js`
should also document a **manual placement path**: drop a file with this name at
this path and re-run, and the hash check validates it regardless of where it came
from. That keeps a future clone working if upstream moves.

Four things this buys, in order of weight:

1. **The repo distributes zero encumbered bytes.** Every no-derivatives /
   non-commercial / ShareAlike redistribution question becomes structurally
   absent rather than argued away. Each clone decides at fetch time.
2. **Swapping a model is a registry entry, not a code change** — see the ledger's
   swap matrix; four of five swap classes are configuration.
3. **A 10 MB blob stays out of git history**, permanently.
4. **Re-verification is a command**, not an audit.

### 3.1 The tensor container

Two trained artifacts need loading, and the runtime must never parse a
third-party format. `scripts/vision/pack-tensors.js` converts offline and is the
**only** code that ever understands ONNX.

**Emit safetensors, don't invent a format.** It is a little-endian JSON header
followed by raw tensor bytes — about 40 lines to read with `DataView` and
`JSON.parse`, no regex, no dependency, and it is a published layout so the
intermediate files are inspectable by other tools during debugging. Put the
registry metadata in the header's `__metadata__` map, most importantly the
**normalisation constants and the alignment template**, so a model swap cannot
silently desynchronise them from the weights.

Since every tensor is dequantised offline, all of them are `f32` and no
per-tensor scale/zero-point machinery is needed.

The converter does four transforms:

1. **Dequantise the block-quantised weights** — `DequantizeLinear` + `Reshape`
   → plain `f32`. Both models' quantised files are weights-only, so the identical
   float graph falls out with no integer kernels.
2. **Fold BatchNorm into the preceding operator's weights and bias.** At
   inference it is a fixed per-channel affine transform; folding removes an
   operator class, cuts memory traffic, and eliminates a category of numerical
   bug.
   - ⚠ **Use the per-node epsilon.** The recogniser has 27 nodes at `1e-3` and 2
     at `2e-5`. A single hard-coded value is precisely the silent-degradation
     trap this document is organised around.
   - ⚠ **One of those folds is not into a convolution.** There are 29 BatchNorms
     against 27 convolutions, and one of the odd-epsilon pair is named `fc1` —
     the graph's output. Folding into the final matrix multiply is easy but it is
     a second code path; a rule that only handles "the preceding convolution"
     will silently skip it.
3. **Drop `Dropout`** — identity at inference.
4. **Fold the recogniser's input `Sub`/`Mul` into metadata** rather than the
   graph, so the runtime's contract is explicit (§6.3).

⚠ **Both recogniser files declare 175 graph inputs** — `data` plus all 174
weights, which are *also* present as initializers. That is an old-exporter
quirk. Read initializers, and treat a name that is both an input and an
initializer as an initializer. Its practical consequence is in §8.1.

The no-regex rule applies here too; upstream layer-name handling is
string-method work.

---

## 4. Architecture: one core, four seams

```
                 ┌──────────────────────────────────────┐
   pixel source →│  public/vision/  (pure numeric JS)   │→ store
                 │  kernels · detect · align · describe │
                 │  decode · group                      │
                 └───────────────┬──────────────────────┘
                                 │
                          compute backend
```

`public/vision/` may not import `node:*` and may not touch the DOM. Its inputs
are typed arrays; its outputs are typed arrays and plain objects. That single
constraint is what makes both venues, the optional GPU backend, and the whole
unit-test suite possible without forking the pipeline.

### 4.1 Seam 1 — pixel source

Contract: `{ width, height, rgb: Uint8Array }`, tightly packed RGB, orientation
already applied.

- **Node** (`scripts/vision/pixels-cli.js`): shell out, per the existing rule.
  `magick <path> -depth 8 RGB:-` writes raw bytes to stdout — verified, a 4×2
  image yields exactly 24 bytes. vips is preferred for shrink-on-load.
  **Reuse `scripts/lib/image-backend.js`** rather than adding a second backend
  abstraction: it already handles try-exec probing, argv arrays, HEIC and
  orientation. Extending it with a raw-RGB command is a small addition to a
  solved problem. No JPEG decoder, no WebP decoder, none of that.
  - ⚠ **vips was half-broken on this machine when this was written** (2026-07-29):
    its HEIF module failed to load (missing `libx265`), and `vips header` is not
    a subcommand — `vipsheader` is a separate binary. **Since fixed:** batch runs
    have completed on vips 8.18 with no fallback, and the backend each run
    actually used is recorded in that run's `timing.json`. If it breaks again,
    `brew reinstall x265 vips`, or let the backend's probe fall through to
    ImageMagick, which also works. Read `timing.json`, not this paragraph, to
    learn what a given run used.
- **Browser** (`public/vision/pixels-dom.js`): `createImageBitmap(file, {
  imageOrientation: "from-image" })` → `OffscreenCanvas` → `getImageData`, then
  drop alpha. `public/components/media-processing.js:46` already does the first
  half of this for every upload.

**Decode once per photo at ~2000 px** (vips shrink-on-load makes this cheap), then
derive the detection buffer by in-memory box downsample and take recogniser crops
from the 2000 px buffer. One decode, one buffer, no second file read. The two
resolutions are a starting pair, not a result: detection wants faces inside the
model's trained size band (§6.1) and the recogniser wants a 112×112 crop without
upsampling, so ~2000 px is the smallest buffer that serves both for a full-frame
portrait. Confirm both locally before trusting either.

### 4.2 Seam 2 — compute backend

| Backend | Where | Role |
|---|---|---|
| `scalar` | everywhere | **The reference.** Plain loops over `Float32Array`. Correctness first; never deleted |
| `pool` | Node `worker_threads` · browser Web Workers | Same kernels, N-way **over images, not over layers**. 8 cores here |
| `webgpu` | browser only | Optional. WGSL. Verified against `scalar` layer by layer |

Node has no WebGPU — `navigator.gpu` is undefined on Node 26 and there is no
flag. The CLI path is `scalar` + `pool`, which the measurements say is ample.

Parallelise across images: each worker handles whole photographs, so there is no
cross-worker synchronisation and no shared mutable state.

### 4.3 Seam 3 — store

| Store | Venue | Holds |
|---|---|---|
| `sqlite` | CLI | `media_faces`, `face_identities` (§10) |
| `indexeddb` | browser, local-only | descriptors that never leave the machine |
| `http` | browser → admin API | boxes and landmarks from upload-time detection |

Default: **boxes and landmarks server-side; descriptors server-side but
admin-only.** Both under the existing soft-delete pattern.

### 4.4 Seam 4 — model source

The registry and container of §3. Loading a model is: resolve registry entry →
read the safetensors file → hand the runtime a named tensor map plus metadata.

---

## 5. Build order — top-down, not bottom-up

This is the most important section in the document, and it is the one thing that
changed most from earlier drafting.

**The riskiest question in the project is not "can I write a convolution?" — it
is "do the descriptors actually separate the people in this particular set of
photographs, under whatever light and pose they were shot in?"** Published
benchmarks are frontal and well-lit and answer it for a different dataset. That
question is answerable in an afternoon using the borrowed engine (§2.1), and it
should be answered *before* any kernel is written, because a bad answer changes
the product rather than the implementation.

So build the pipeline **from the outside in**, with the borrowed engine standing
in for the not-yet-written middle:

```
Session 1   pixels → [borrowed detect] → align → gate → [borrowed describe] → group → measure
                          ▲                                    ▲
                          └──── first-party from day one ───────┘
                     (align, gate, group, metrics, labelling UI, reports)

Later       pixels → [OUR detect] → align → gate → [OUR describe] → group → measure
                          ▲                                    ▲
                          └── swapped in one function at a time, each checked
                              against the borrowed engine it replaces ──────┘
```

Three things this buys that a bottom-up order does not:

1. **The go/no-go arrives on day one** instead of in week four.
2. **The oracle is continuous, not a one-off dump.** The verification harness
   §8 needs is simply "the pipeline, with the borrowed engine on one side and
   ours on the other." It exists as a side effect of the build order rather than
   as a thing to remember to build first.
3. **Nothing written in session 1 is thrown away.** Alignment, the quality gate,
   grouping, the metrics, the labelling interface and the reports are all
   first-party `public/vision/` code that ships. Only the engine is temporary.

### The ladder

Every rung ships something, and stopping anywhere leaves a finished thing rather
than a hole.

| Tier | What | Ships | State |
|---|---|---|---|
| **0** | [Session 1](./SESSION-1-vision.md): borrowed engine + first-party align/gate/group/metrics + labelling UI | **A measured answer to "does this work?"**, plus a labelled evaluation set | ⊙ **built and run** |
| **1** | Grouping + assignment UI + schema, still on the borrowed engine | **The actual feature**, usable, admin-only | ⊙ **built**, ○ never run on real data |
| **2** | Inspector output → tensor pack → converter → `fetch-weights` | Licence question closed. Nothing user-visible | ◐ inspector built; converter and fetcher not |
| **3** | `scalar` kernels + our detector, checked against tier 0's engine | **Face-aware crops, face counts, "photos with people"** | ○ |
| **4** | Our recogniser + `pool`, checked layer-by-layer | Borrowed engine deleted. `tmp/rig/` removed | ○ |
| **5** | Vision lab bench in `/studio` | You can *see* it, which is what makes it trustworthy | ○ |
| **6** | Upload-time detection in guest browsers | New uploads self-detect | ○ |
| **7** | `webgpu` backend | Minutes → seconds. For fun | ○ |

**The decision point is after tier 0**, and there are two of them: *is the
feature worth building*, and *is it worth building by hand*. Tier 1 delivers the
feature on borrowed code; tiers 2–4 replace the borrowed code with ours. Those
are separable, and pretending otherwise is what pushed the risk to the end of
earlier plans.

⚠ **Both decisions are now made** ([`DECISIONS-vision.md`](./DECISIONS-vision.md)
§1): yes and yes, **in that order**. Tier 1 first and soon; tiers 2–4 after, as
the project rather than as a chore. The gap between "tier 1 is built" and "tier 1
has been run" is the shortest path to a working feature and is where the next
work goes — see [`VISION-STATUS.md`](./VISION-STATUS.md).

---

## 6. Stages

All verified model details live in `VISION-MODELS.md`. Every threshold in this
section is a reference default to be tuned locally (§15). This section is the
algorithm.

### 6.1 Detect

**Input.** Downscale to **~1280 px on the long edge** to start with. Two reasons,
and the second is the one people miss: detector cost scales with pixel count, so
a 24 MP frame is ~14× the work of a 1280 px one; and the model was trained on
faces roughly **10–300 px**, so at native resolution a face that fills a
reasonable fraction of the frame lands *above* the band it was trained on.
Downscaling is a correctness measure as much as a speed one. Sweep the resolution
against your own input and check recall rather than assuming — this is a knob in
the lab (§9), not a constant.

Then zero-pad **bottom and right only** to a multiple of 32; nothing is added at
top or left, so decoded coordinates need no inverse transform beyond the single
uniform scale factor back to source pixels.

**Decode**, per stride ∈ {8, 16, 32}, over a row-major grid of `padW/stride` by
`padH/stride`:

- `score = sqrt(clamp01(cls) · clamp01(obj))` — geometric mean of two heads, both
  already sigmoid'd inside the graph.
- Threshold, then: centre is `(cell index + predicted offset) × stride`; size is
  `exp(predicted) × stride`; top-left is centre − size/2.
- Landmarks use the same scheme: `(predicted + cell index) × stride`.
- Then **greedy non-maximum suppression pooled across all three strides
  together**, not per stride: sort by score, take the highest, drop everything
  overlapping above the intersection-over-union cutoff, repeat.

There are no anchors and no prior boxes. The output dimension is *named*
`anchors` in the export, which is misleading; it means grid cells, and this is
confirmed by running the model — at 320×320 the stride-8 head has exactly
1600 = 40×40 entries. Reference behaviour: `postProcess` in OpenCV's
`modules/objdetect/src/face_detect.cpp`.

Initial lab positions: score 0.6, NMS IoU 0.3, topK 5000.

### 6.2 Align, then gate

**Align.** Fit a similarity transform (rotate + uniform scale + translate, no
shear) by least squares from the five detected landmarks to the canonical
112×112 five-point template, then sample the source through its inverse with
bilinear interpolation. Take template, landmark order and channel order from
**pack metadata**, never hard-coded.

Alignment quality matters more for this recogniser than for most, because its
final layer flattens a 7×7 spatial grid instead of pooling it — so it has no
translation invariance at the end, and a misaligned crop shifts every one of
50,176 inputs to that layer.

**Verify the landmark order on day one, and make it a test rather than a
glance.** Swapping the eyes produces a mirrored crop that looks perfectly
plausible and quietly degrades every match. The oracle already returns eye
centroids in image pixels, so assert that our two eye points land within a few
pixels of Vision's across a batch of photographs.

**Quality gate — before spending anything on description.** In cost order:

| Check | Reject when | Why |
|---|---|---|
| Box size | below a minimum in source pixels | a box far below the rest of the distribution is usually a false positive, and it cannot fill a 112×112 crop without upsampling |
| Edge clipping | box touches the image border | crops would be padded, alignment invalid |
| Landmark geometry | eye separation outside a plausible fraction of box width | outside the plausible band it is either a bad detection or a mirrored landmark order, and both must go |
| Pose | eye separation near the low end, or explicit yaw estimate high | a turned face has one eye occluded, so its five-point landmarks are poor, so the aligned crop is poor. These are the crops that pollute grouping |
| Blur | sharpness below a cutoff | soft crops produce descriptors that sit near everybody |

**Every cutoff in that table is empirical, and none of them are in this
document.** Derive them from the distribution of your own input — a percentile of
the observed eye-separation ratio is a better rule than any literal — and keep
the derivation in `tmp/` (§15). Hard-coding a number measured on someone's
private photographs into a public spec is not a shortcut; it is a leak.

For blur, use a Laplacian-style edge-energy measure but **normalise it by crop
size and local contrast** — raw variance scales with both, so an unnormalised
threshold discards small sharp faces and keeps large soft ones.

Discarding bad crops improves final grouping more than any downstream threshold
tuning. A gate that rejects a third to a half of all detections is doing its job,
not losing data.

⚠ **That last sentence is about detections, and the product is not made of
detections.** Any procedure that picks these cutoffs by maximising separation or
rank-1 is optimising a quantity that *rises monotonically as faces are thrown
away*: the degenerate optimum keeps one clean face per person and scores nearly
perfectly while tagging almost nothing. A floor on how much may be discarded is
not a price, it is a leash.

So the gate must be scored against **person-in-a-frame appearances** — one
labelled person in one distinct frame, duplicate frames collapsed. A person is
tagged in a photograph if *any* surviving face carries them, so appearances are
what the gate actually costs. A dropped face is not tagged wrongly; it is not
tagged at all, and the photograph it was in silently loses that person.

⚠ **And prefer a router to a filter.** Every signal in the table above is
continuous, and collapsing them to one pass/fail decision throws away the
information that says *how* confident to be. Combining them into a per-face
confidence and routing on it — auto-accept, ask a human, set aside — keeps the
accuracy of a tight gate without paying its coverage. That is a strictly more
general design and it costs nothing extra to compute, because the signals are
already being recorded unthresholded. A binary gate is the special case where
two of the three buckets are empty.

### 6.3 Describe

**MobileNetV1 with PReLU and a flatten head.** (Upstream's README calls it
MobileFaceNet; the file is not that. See the ledger.)

- **Input** the 112×112 RGB crop, **raw 0–255**.
- **Normalise** `(x − 127.5) / 128` — from pack metadata, not the graph, not a
  literal. `/128` exactly, not `/127.5`. Dividing by 255 first is the reflex and
  it silently destroys accuracy.
- **Stem** 3×3 convolution, stride 1, 32 channels.
- **Body** 13 × (3×3 depthwise → 1×1 pointwise), BatchNorm folded into each,
  PReLU after each. **No residual connections** — there are zero `Add` nodes.
  Channels 32 → 64 → 128 → 128 → 256 → 256 → 512(×6) → 1024 → 1024. Four
  depthwise convolutions are stride 2, taking 112 → 56 → 28 → 14 → 7.
- **Head** flatten the 1024×7×7 activation to 50176, then one dense matrix
  multiply to 128. That single matrix is two thirds of the parameters.
- **Output** L2-normalise. Similarity is then the dot product.

**PReLU** is ReLU with a learned per-channel slope on negatives, shape `[C,1,1]`.

**Optional, cheap, worth a lab knob:** describe the crop *and* its horizontal
mirror and average the two before normalising. It costs 2× and typically buys a
little robustness — plausibly more than usual here, because the flatten head is
position-sensitive.

### 6.4 Group

N normalised descriptors, unknown number of people.

**Agglomerative average-linkage on cosine distance with a distance cutoff**, not
a target count: start with every face its own group, repeatedly merge the two
closest (distance = mean pairwise distance between members), stop when the
closest pair exceeds the cutoff.

At a few thousand descriptors of 128 numbers this is milliseconds and the full
distance matrix fits in a few megabytes, so the obvious algorithm is the right
one — no approximate-nearest-neighbour index, no incremental scheme. Avoid
connected-components on a thresholded similarity graph, though: it chains, and one
bad edge silently welds two people together.

Three additions, each cheap:

1. **Cannot-link within a photograph.** Two faces in the same frame are different
   people. Refuse any merge where a member of one group shares a photo with a
   member of the other. Cheap, and it blocks the failure that matters most.
2. **Deliberately over-split.** Set the cutoff tight. The costs are asymmetric:
   one person spread across three groups costs two clicks to merge, while two
   people welded into one is expensive to notice and annoying to unpick. Prefer
   many small pure groups over few approximately-right ones and let the interface
   do the merging. This turns the hardest tuning problem in the project into an
   easy one.
3. **Clothing colour as a tie-breaker, never as a merge criterion.** If the input
   is a single event, everyone is wearing one outfit throughout, so a coarse
   colour histogram of the region below the box is a same-person hint — and the
   only signal that survives a shot from behind. It is also worthless on its own,
   because groups of people at events dress alike, and it would weld them
   together. Use it to order suggestions and to flag a proposed merge as
   suspicious. Never to merge.

The published verification threshold for this recogniser is cosine **0.363**.
Treat it as a starting position for the similarity explorer, not as a grouping
cutoff, and not as trustworthy on any real input until §7 measures it.

### 6.5 Assign

Human-in-the-loop, and the interaction matters as much as the maths.

1. Sort groups by size, largest first — the people who show up most are the ones
   worth naming.
2. For each, show a grid of member faces and ask "who is this?", **autocompleting
   against the `guests` table.**
3. Let the user **reject individual faces out of a group** — one bad member
   poisoning a centroid is the common failure — and **merge two groups in one
   click**, since §6.4 deliberately over-splits.
4. Once named, compute the centroid and offer nearby unassigned faces.

**Step 4 is arguably the whole product.** Once a handful of faces per person are
confirmed, matching every remaining face against known multi-example prototypes
is a strictly easier and more accurate problem than unsupervised grouping — no
global cutoff decides anything, and it degrades gracefully if the descriptors turn
out mediocre. Grouping's real job is to make the initial labelling cheap. Which of
these two framings leads is a product decision, and it is one of the questions
session 1 answers with data.

---

## 7. Measuring whether it works

The instrument is **not** "pick a face, see a ranked list." Ranking can look fine
while grouping fails, because grouping depends on a single threshold separating
same-person from different-person *across everybody*, not on nearest neighbours
being right.

The honest instrument, and the tier-0 exit criterion:

0. **Report every figure against the population it was measured on, and never
   blend two.** Three requirements, each of which was violated once and each of
   which turned a real-but-imperfect result into a wrong conclusion:
   - **Split rank-1 by labelling pool, and quote the uniform one.** Faces
     labelled a whole detector group per keystroke carry the model's own opinion
     in their labels, and working through groups labels the tidy ones while the
     awkward tail is left. Both effects flatter. A blended figure is carried by
     whichever pool is larger, which is always the contaminated one.
   - **Run the grouping sweep on the population that would actually be grouped
     — i.e. after the gate.** Grouping runs downstream of the gate, so a sweep
     over every detection measures a configuration nothing ships, and any
     product-shape conclusion drawn from it is about a population that does not
     exist.
   - **Price the gate in appearances, not in faces.** See §6.2.
1. **Hand-label a few hundred crops** with guest identities (session 1 does this).
2. **Deduplicate by content hash first.** Photo deliveries routinely contain
   retouched and unretouched versions of the same frame, and the same basename in
   more than one folder. Two near-identical frames produce two near-identical
   descriptors, which collapses same-person distances toward zero and forges a
   good result. The importer already computes the hash
   (`scripts/lib/import-manifest.js`). This is the single easiest way to get a
   falsely encouraging answer.
3. Plot the **distribution of same-person distances against different-person
   distances**, and report the overlap.
4. From that, report the best achievable threshold and the error rates it implies.
5. Separately, run §6.4 at a range of cutoffs and report, against the labels, how
   pure the groups are and how completely each person is captured.

Numbers 3 and 5 are the decision. Everything else in this project is engineering
with a safety net; this is the only genuine unknown.

**All five outputs are local.** They are `tmp/` artifacts: a labelled evaluation
set and a report about identifiable people. Nothing derived from them belongs in a
committed document — see §15.

Expect it to be mediocre and be pleasantly surprised. Real photographs of people
who are moving, turned away and lit badly are nothing like a verification
benchmark, and this recogniser's only published benchmark is frontal, well-lit and
fully saturated.

---

## 8. Verification — continuous, not a phase

Hand-written inference fails **silently and numerically.** A transposed weight
layout or an off-by-one in padding produces plausible output and quietly terrible
accuracy, and days get spent blaming the model. Three independent oracles are
available and using all three is the whole mitigation.

### 8.1 Oracle A — the borrowed engine, for both models

Because of the build order (§5), the borrowed engine is already in place and
already wired to real photographs when the kernels start. Implement one layer at
a time and assert against its intermediate activations to a tolerance. The lab
surfaces per-layer **max absolute deviation**.

⚠ **Dump reference activations from the same file you ship.** The block-quantised
recogniser's weights are not bit-identical to the float file's. If activations
come from one and the kernels run the other, the deviations are real and you will
not know whether they are your bug.

⚠ **The block-quantised recogniser cannot be run by a stock runtime as
distributed.** It declares 30 *required* graph inputs — `data` plus 29 weight
tensors — and a generic runtime demands all of them. The float file loads with
one input and runs cleanly at 5.1 ms/face. So: **use the float file for the
oracle**; our own converter reads initializers straight from the protobuf and is
unaffected, so shipping the quantised file remains fine.

### 8.2 Oracle B — macOS Vision, for detection

`scripts/vision/oracle-macos.swift` (already written and working) runs
`VNDetectFaceLandmarksRequest` and prints, per face, a pixel-space box, roll and
yaw, Apple's capture-quality score, 76 landmark points and both eye centroids.
It costs roughly 15 ms for a ~20 MP photo on this machine, so a large batch is a
minute of wall-clock. It reads only the paths it is handed and its output is
scratch (§15).

This is a **dev-machine tool** under tier 3. It is not a fallback detector and
must never be on a code path the app depends on. Its value is *independent* ground
truth: when our detector and Vision disagree on a box, something is wrong and you
know roughly where. It is also the automatic check on landmark order (§6.2).

Worth stating plainly, since it is otherwise a tempting piece of
self-justification: this detector is written because the browser venue needs one
and because writing it is the point of the project — not because Vision could not
do the offline backfill. It could. That is a fine reason; it just isn't necessity.

### 8.3 Oracle C — the scalar backend

Once `scalar` is verified against Oracle A it becomes the reference for `pool`
and `webgpu`. Never delete it, and keep a test asserting all backends agree on a
fixed input.

### 8.4 Unit-testable seams

Because `public/vision/` is pure numeric JS, every stage is unit-testable under
the existing `node --test` setup with no server and no browser: kernels against
hand-computed small cases, decode against synthetic head outputs, alignment
against known landmark sets, grouping against synthetic descriptors with known
groupings, the quality gate against the measured geometry ranges. Add these as
`tests/unit/vision-*.js`.

---

## 9. The Vision Lab

⚠ **Not built.** This is tier 5, and nothing in `public/pages/studio/` implements
it. What plays its role today is the HTML report
(`scripts/vision/session1-report.js`) plus the contact sheet — batch artifacts
under `tmp/`, not a live bench, and no knob on them is adjustable without
re-running. The section below is the design, not a description.

A third bench in `/studio`, following the effects-lab idiom exactly: a registry,
declared defaults, generic controls from `components/effect-controls.js`, live
re-run on change, per-browser overrides via `override-store.js`. Every tunable in
§6 surfaces here, from a defaults table the way `EFFECT_CONFIGS` does — **none of
them get hard-coded constants.**

Beyond the effects lab it needs:

- **Load a real photo** — from the gallery by id, or a local file.
- **Stage toggles and per-stage timing.**
- **Overlay rendering** — boxes with confidence, pre- and post-NMS; the five
  landmarks; the aligned crop beside the source with template points drawn on it;
  the bottom-right pad rectangle; the downscale factor.
- **Oracle comparison** — Vision's boxes drawn against ours, with IoU.
- **Activation inspection** — any intermediate layer as a tiled grayscale image,
  plus per-layer max deviation from Oracle A.
- **Backend A/B** — `scalar` vs `pool` vs `webgpu` on the same input, diffed.
- **Similarity explorer plus the separation report of §7** — the ranked view is
  for building intuition; the distribution plot is for deciding.

`/studio` is already in `DEV_ONLY_PAGES` and 404s in production. That stays true.

---

## 10. Schema and privacy

⊙ **Built.** Every table below exists in `db/schema.js`, with the constraints and
precedence triggers noted, and the admin API (`api/admin/faces.js`,
`api/admin/people.js`) and the Faces tab are wired to them. The migrations, in
the order they landed: `add_media_faces`, `add_people`, `add_face_routing`,
`add_vision_provenance`. For what has and has not been *run*, see
[`VISION-STATUS.md`](./VISION-STATUS.md).

**Tables**, following the existing polymorphic-target trigger and soft-delete
patterns:

- `people` — the photographed cast: `display_name`, a **nullable** `guest_id`,
  created-by, notes, soft-delete.
- `media_faces` — `media_id`, bbox, landmarks, the nine `signal_` columns that
  are exactly `gateSignals()`'s output shape (so a row can be re-graded against
  new cutoffs without re-detecting), `descriptor` BLOB (nullable:
  detection-only rows exist), model version, source (`cli` | `upload`), the
  `route_*` columns §6.2's routing writes (`accept` | `ask` | `set_aside`), and
  a nullable `ingest_id`.
- `face_identities` — group → `people` link, provenance (`confirmed` |
  `propagated`, unique per person among live rows), confirmed-by, confirmed-at,
  and `merged_into`.
- `vision_ingests` — **immutable**, one row per ingest run: dataset id, model
  version, the detector / embedder / engine SHA-256s, mirror and normalisation
  settings, route profile, and an **allowlisted** `config_json`. What that
  object may carry is a closed list — versions, digests, channel orders,
  resolutions, thresholds, normalisation and mirror settings, schema version —
  and what it may never carry is equally closed: filesystem paths, argv,
  environment variables, names, and any count or distribution measured from the
  photographs. It travels to production later; §15 r4 travels with it.
- `face_assignment_batches` + `face_assignments` — the **append-only assignment
  ledger**. Every naming decision is an event (`assign` | `clear` |
  `not_a_face` | `negative`) belonging to a batch (`label-import` | `propagate`
  | `manual` | `merge-repair`), and `media_faces.face_identity_id` is a
  *projection* of replaying a face's events. Revoking a batch sets a flag rather
  than writing compensating events, so a manual correction made after it
  survives the revocation — which is the whole reason the ledger is worth
  having.

⚠ **UPDATE is blocked on `vision_ingests` and `face_assignments`; DELETE is
not.** `media_faces` cascades from `media`, so a delete-blocking trigger would
turn a media delete into a hard failure rather than a clean cascade.

⚠ **Merge is a redirect, not an op.** Folding one identity into another is a
fact about *identities*, not about faces: one `merged_into` update, no per-face
events, and every event already written stays true forever. Readers resolve
through the redirect.

⚠ **The roster gap is closed — and it is why `people` exists.** This spec
originally had `face_identities.guest_id NOT NULL`, on the reasoning that an
identity *is* the confirmed link to a roster guest. The reasoning did not survive
contact with the roster: a `guests` row is an **invitation**, one per party, and
plenty of people in the photographs are not on that list under their own row —
photographer, vendors, plus-ones recorded under someone else's row, children. So
"confirm this group" had nothing valid to point at for a large share of the cast,
which made it the one schema-level blocker between the built feature and a usable
one. The `add_people` migration resolved it in favour of a separate `people`
table rather than a nullable column; the ruling and the reasoning are
[`DECISIONS-vision.md`](./DECISIONS-vision.md) §6.

Store the model version so a swap cannot silently mix incompatible descriptors —
and note that `model_version` names the **descriptor space only** (embedder,
output width, normalisation, mirror setting), never the detector. Detection
provenance is what `ingest_id` records. Deleting a guest or a media row **must
cascade**; a deleted guest leaves the `people` row standing with a null
`guest_id`, because the person was still in the photograph.

⚠ **Set a precedence rule for the two sources.** With both a CLI pass and
upload-time detection writing boxes, rows from different code versions and
different thresholds coexist, and "photos with people" then behaves differently
for old and new uploads. The CLI's pass is authoritative and overwrites; guest
boxes are hints until it runs.

**Keying against files that are not gallery rows yet.** A batch run usually
points at a directory, while face rows have to key on `media_id`. So either run
`npm run import:media` over the directory first, or key the run's output on the
content hash the importer already records
(`scripts/lib/import-manifest.js`) and reconcile later. The hash is the durable
identifier; file paths are not.

**Privacy — four design rules.** Face descriptors are biometric identifiers, and
these four are cheap enough that there is no reason to get them wrong:

1. **Descriptors never reach a guest-facing endpoint.** Nothing in `/api/config`
   or any public feed exposes who is in a photo.
2. **Descriptors are computed admin-side only.** Guest devices may locate faces;
   they never compute identifiers.
3. **Tags are never auto-published.** A human confirms every group before any
   name attaches to any face. "Photos of you" as a guest-facing feature is opt-in
   or absent.
4. **Deletes cascade.** Removing a guest or a media row removes the face rows.

---

## 11. Upload-time detection (tier 6)

`public/components/media-processing.js:46` already calls `createImageBitmap` and
draws to a canvas for every upload. A detection pass is a `getImageData` away
from pixels that are **already decoded** — so the detector could run on the
guest's own device, in a Web Worker, on 230 KB of cacheable MIT weights.

It is the prettiest idea in the design and it is deliberately near the top of the
ladder rather than the bottom, because the case for it has weakened: the wedding
has happened, upload volume is declining, and re-running the CLI is free. Against
that it ships the kernel library and the weights to every guest for a feature no
guest sees, and it puts vision code on the public request path for the first
time.

It also lands the privacy seam in a genuinely good place — a bounding box is not a
biometric identifier; a descriptor is. Guests' devices locate faces; the owner's
machine recognises them.

Constraints if it is built:

- **Detector only.** Never ship the recogniser to a guest browser — 10.7 MB, and
  it computes biometric identifiers.
- **Never block the upload.** Opportunistic; if the worker fails or
  `OffscreenCanvas` is missing, the upload proceeds and the CLI picks the photo up
  later. Strictly additive to a working path.
- **Don't trust the client.** Boxes arriving at the API are hints. Validate
  ranges, cap counts per photo, rate-limit as everything else is.
- **The CLI overwrites** (§10).

---

## 12. Effort

⚠ **The first two rows are spent, not forecast.** Both were built; the estimates
are kept only so the remaining rows can be read against a calibration. Tier 0's
"~30 min of labelling" was the one badly wrong number in this table — labelling
to a useful density is hours, and the census is not finished yet.

| Piece | Effort |
|---|---|
| ~~**Tier 0 — session 1: rig, align, gate, group, metrics, labelling UI**~~ | ~~1 evening + ~30 min of labelling~~ · **done; labelling under-estimated** |
| ~~Tier 1 — assignment UI, schema, wiring~~ | ~~4–6 days~~ · **built, not yet run** |
| Tier 2 — tensor pack, converter, `fetch-weights` | 3–4 days |
| Tier 3 — `scalar` kernels + detector + decode + NMS | 4–6 days |
| Tier 4 — recogniser + `pool`, layer-by-layer verification | 5–8 days |
| Tier 5 — Vision Lab bench | 4–5 days |
| Tests, docs, cleanup | 3–4 days |
| **Subtotal** | **~4–6 weeks of evenings** |
| *Optional:* tier 6 upload-time detection | +2–3 days |
| *Optional:* tier 7 `webgpu` | +5–8 days |

The kernel work shrank because reading the graphs removed bilinear resize,
dilated convolutions, general padding and separate dense/depthwise kernels —
none of which either model uses (§13). The lab and the assignment UI are the
items most likely to overrun; they always are.

**Runtime, extrapolated from the per-model timings in the ledger:** the detector
costs ~17 ms per photo at working resolution and the recogniser ~5 ms per face in
optimised C++, so a few thousand photographs is well under a minute of model time.
Scalar JavaScript typically pays 20–50× against that, single-threaded, which puts
a full batch in the **minutes** range across 8 workers. A "go make coffee" job.
This is why the GPU backend is tier 7 and not tier 1.

---

## 13. Kernels — four, plus elementwise

From the parsed attribute tables, across **both** models, after offline BatchNorm
folding and dequantisation:

| Kernel | Covers | Notes |
|---|---|---|
| **Grouped convolution** | every `Conv` in both models | One kernel. `group=1` is dense, `group=C` is depthwise, and the detector also uses 4/10/16/32/64. Only two geometries exist: **1×1/pad-0** and **3×3/pad-1**. Stride ∈ {1,2}. **Dilation is always 1** |
| **Matrix multiply** | the recogniser's head | `transB=1`, one call per face, `[128 × 50176]` |
| **Max pool** | detector ×4 | 2×2, stride 2, pad 0, `ceil_mode=0`. Only this shape |
| **Nearest resize** | detector ×2 | `asymmetric`, `floor`. Index arithmetic, no interpolation |
| Elementwise | `Relu`, `PRelu`, `Sigmoid`, `Add` | Trivial. PReLU slope is per-channel, `[C,1,1]` |
| Layout | `Transpose perm=[0,2,3,1]`, `Reshape` | Output decode only. Reshape is metadata when contiguous |

`BatchNormalization` and `Dropout` never reach the runtime.

**The 1×1 convolutions are where the arithmetic is** — 26 in the detector, 13 in
the recogniser. They are matrix multiplies; write them as tight loops with the
reduction innermost over a contiguous axis. In WGSL, a tiled multiply using
workgroup shared memory.

Note that parameter count and arithmetic diverge sharply in the recogniser: its
9.67 M parameters include a 6.42 M-parameter final matrix that accounts for
roughly 1% of the multiply-adds. The convolution body is 3.25 M parameters and
essentially all of the work — see the ledger's cost table.

If the GPU backend is ever built: **batch aggressively** (hundreds of crops per
dispatch), **keep activations in GPU buffers and read back only descriptors** (a
CPU round-trip per layer erases the entire speedup and is the usual way GPU
inference ends up slower than scalar), ping-pong two scratch buffers sized for
the largest activation, and verify every kernel against `scalar` first.

---

## 14. Open questions

**Answered by measurement in session 1 — all three now have answers:**

1. **Do the descriptors separate these people?** ✅ **Yes**, on the faces the
   gate keeps, and the gate is doing a large share of that work. The full
   qualification is the report's own verdict, which is currently UNDECIDED for a
   reason that is about the *sampling frame*, not about the feature — see
   [`DECISIONS-vision.md`](./DECISIONS-vision.md) §3 and
   [`VISION-STATUS.md`](./VISION-STATUS.md).
2. **What are the actual thresholds?** Measured, and the report prints them each
   run. **Deliberately not written into `defaults.js` yet** (SESSION-2 §9 r6):
   they were fitted on an unfinished labelling, two of them are proxies for
   something other than face quality, and one of the values the report prints
   is not a cutoff at all but a re-detection. The report now flags all three
   classes distinctly.
3. **Cluster-first or label-first** (§6.5) → **label-first.** Prototype rank-1
   is high while no single global grouping cutoff welds nobody, which is exactly
   §6.5's "step 4 is arguably the whole product". Grouping's job is to make the
   first labelling cheap; it is not the product shape.

**Decisions for the owner — Q4 is now answered:**

4. ~~Is the hand-written implementation the point, or is the feature the point
   (§2.1)?~~ ✅ **Answered: both, feature first.** See §2.1a and
   [`DECISIONS-vision.md`](./DECISIONS-vision.md) §1. **This is binding and is
   not re-opened.**
5. Upload-time detection: build it, or leave the CLI to it (§11)? — **still
   open**, and the case has weakened further (§11).
6. Does anything guest-facing ever use this, or is it admin-only forever (§10)?
   — **still open.** Admin-only is what is built and what ships first;
   guest-facing is a later, opt-in decision, not a default.

**Recorded rather than answered:**

7. **The recogniser's training data is unknown** and the upstream issue asking
   about it is closed with no answer. Moot for this deployment — a personal
   wedding site is non-commercial — not moot for a commercial fork.
8. Whether dataset licences reach trained weights at all. No case law.
9. `face_det_lite`'s operator counts and landmark order remain unverified. Only
   matters if the detector is swapped; re-parse with the inspector first.

---

## 15. Working rules

These are constraints on the build, the same as "no regex" and "no npm". They are
not advice.

1. **The input path is always an argument.** Nothing here searches a filesystem
   for photographs. No home directory, no `~/Pictures`, no Photos library, no
   guessing from a previous session's notes.
2. **Photographs are input to code, not to a reader.** Don't open them to look at
   them, and don't put them, crops of them, or descriptions of them into anything
   that leaves the machine. Aggregate numbers answer every design question in this
   document; individual frames answer none of them.
3. **Derived data is scratch — with three exceptions.** Crops, descriptors,
   landmark geometry, distance distributions, reports, contact sheets — all under
   `tmp/`, which `.gitignore` covers, and all deletable at any time. It
   regenerates in minutes. Three things do not, and all three were learned by
   losing them ([`SESSION-4-vision.md`](./SESSION-4-vision.md)):

   - **`labels.json`** (and its `identities.json` sidecar): it records human
     judgement, made one face at a time, and does not regenerate. It stays out
     of the repo and out of git — it is names attached to faces and this
     repository is public — but it is worth copying somewhere durable.
   - **`timing.json`**: the run's own record of how it was made — detection
     resolutions, the scan flags, the pool size, the image backend, and the
     engine's identification. Everything else in a run regenerates *only if you
     still know the configuration*, and this is the only place that is written
     down. Losing it turns a one-command re-run into a parameter search.
   - **`tmp/rig/engine.mjs`**: scaffolding, and deliberately unreferenced by any
     module in the repository (§2.1) — which also means nothing in the repository
     can rebuild it. Keep a copy with the labels.

   `scripts/vision/labels-backup.js <run-dir> --to <path>` copies the first two,
   to a destination that is always the owner's explicit argument, and verifies
   each copy byte-for-byte. The engine is not in a run directory; copy it by
   hand.

   The corollary, which is a constraint on the engine rather than on the
   operator: **`info()` must report every free parameter the wrapper has**, not
   just its model filenames — channel orders, decode variants, anything a
   reimplementation could choose differently. A knob absent from `info()` is a
   knob absent from `timing.json`, and therefore a knob someone will have to
   search for.
4. **No document in this repo records measurements taken from real photographs.**
   Not scene descriptions, and not statistics either — counts, pose and sharpness
   distributions, per-folder breakdowns and face-size percentiles are all facts
   about identifiable people. Tuned thresholds belong in a defaults table in code,
   set by whoever ran the pipeline, with no note of what was measured to get them.
   A spec that needs a number should say which distribution to derive it from.
5. **This repository is public**, which is what makes rule 4 a hard line rather
   than a preference.
