# Vision models: provenance ledger

**Date:** 2026-07-29
**Status:** verified reference. Every number below was read out of the actual
file, not a write-up.
**Companions:** [build spec](./SPEC-vision-lab.md) ·
[feasibility study](./RESEARCH-face-recognition.md) ·
[dependency essay](../what-counts-as-a-dependency.md)

This is the ledger `scripts/fetch-weights.js` pins against and
`public/vision/weights/<name>.LICENCE.md` is generated from. It exists because a
trained weight file is the one artifact in this codebase nobody can audit by
reading it, so everything *around* it has to be written down instead.

**Nothing in this ledger is committed to the repo.** See
[§Distribution](#distribution-why-no-weights-are-committed).

---

## How these numbers were obtained

An earlier draft of the spec carried op inventories and byte sizes from model
cards, papers and READMEs. Roughly half of them were wrong, and two were wrong
in ways that would have cost days of implementation time. So the rule for this
file is:

> Every structural claim here comes from parsing the `.onnx` protobuf directly.
> Every licence claim comes from the `LICENSE` file in the distributing
> repository, read in full. Every algorithmic claim comes from the reference
> implementation's source, cited by file.

A first-party ONNX inspector (protobuf byte walk, no regex, built-ins only)
produced the structural tables. It **exists**, at
`scripts/vision/inspect-onnx.js` — it is the same code `pack-tensors.js` needs
anyway, and re-running it is how you re-verify this file after any upstream
change.

Every table below was re-confirmed on 2026-07-29 by downloading the files fresh
and running that inspector over them. Byte counts and SHA-256 digests match; op
inventories, initializer counts, parameter counts, input and output shapes and
attribute signatures all match.

---

## ⚠ Where the bytes actually come from

`fetch-weights.js` needs this and it is not obvious. Both facts are verified.

**The `raw.githubusercontent.com` URLs do not serve models.** These files are
stored in git-lfs, so a raw fetch returns a **131–133 byte pointer file** whose
body is the literal text `version https://git-lfs.github.com/spec/v1` followed by
the object's `sha256:` and size. Downloading that and writing it out produces a
file that is not a model and does not announce itself as one.

Usefully, the pointer's `oid sha256:` **is** the digest of the real file, so it
independently corroborates the table below.

**The real bytes come from the LFS media host:**

```
https://media.githubusercontent.com/media/opencv/opencv_zoo/<ref>/<path>
```

**Pin `<ref>` to a commit, not `main`**, so the URL is immutable:

| Ref | SHA | Date |
|---|---|---|
| repo HEAD at verification | `47534e27c9851bb1128ccc0102f1145e27f23f98` | 2026-05-28 |
| last commit touching `models/face_detection_yunet` | `26cc381e4d2594bb9f47a26eb8fd96c94a13660d` | 2026-05-22 |

Paths are `models/face_detection_yunet/<file>` and
`models/face_recognition_sface/<file>`.

Hash pinning protects integrity but **not availability**. If upstream moves,
nothing recovers the URL — so `fetch-weights.js` should also document a manual
placement path: drop a file with the expected name at the expected path and
re-run, and the hash check validates it regardless of provenance.

---

## Chosen: the pair

Both come from [`opencv/opencv_zoo`](https://github.com/opencv/opencv_zoo),
which matters more than it sounds — it is the one distribution point found with
real `LICENSE` files covering the actual `.onnx` artifacts rather than licence
tags asserted in metadata.

### Detector — YuNet

| | |
|---|---|
| **Licence** | **MIT.** `models/face_detection_yunet/LICENSE`, "Copyright (c) 2020 Shiqi Yu". The directory README states: *"All files in this directory are licensed under MIT License."* |
| Upstream | [ShiqiYu/libfacedetection.train](https://github.com/ShiqiYu/libfacedetection.train), commit `a61a428` |
| Paper | [Wu, Peng & Yu 2023, *YuNet: A Tiny Millisecond-level Face Detector*](https://link.springer.com/article/10.1007/s11633-023-1423-y) |
| Params | **54 K** (0.05 M across 112 initializers) |
| Embedding of choice | n/a |
| Opset | 11 (fp32) · 21 (int8bq) |

**Correction to the earlier spec draft: this is MIT, not BSD-3-Clause.** MIT is
the more permissive of the two (no attribution-in-binary clause), so this is a
strict improvement over what was assumed, and it makes the detector the least
encumbered component in the pipeline.

Files, all verified:

| File | Bytes | SHA-256 | Notes |
|---|---|---|---|
| `face_detection_yunet_2026may.onnx` | 229,738 | `ebafce4e…22f0f0` | **Use this one.** Dynamic input `f32[1,3,height,width]` |
| `face_detection_yunet_2023mar.onnx` | 232,589 | `8f2383e4…52fa4` | Fixed input `f32[1,3,640,640]` |
| `face_detection_yunet_2023mar_int8bq.onnx` | 122,489 | `49f000ec…726f10` | Block-quantised, `block_size=64` |
| `face_detection_yunet_2023mar_int8.onnx` | — | — | **Avoid.** True integer `QLinearConv` path |

Accuracy on WIDER FACE (easy / medium / hard), from opencv_zoo's own
`tools/eval`:

| | Easy | Medium | Hard |
|---|---|---|---|
| fp32 | 0.8844 | 0.8656 | 0.7503 |
| block-quantised (`int8bq`) | **0.8845** | 0.8652 | **0.7504** |
| fully quantised (`int8`) | 0.8810 | 0.8629 | 0.7503 |

The upstream README separately claims 0.834 / 0.824 / 0.708 — a different eval
protocol, quoted here only so the discrepancy isn't mistaken for an error later.
The earlier spec draft cited 0.892 / 0.883 / 0.811, which matches neither and
appears to have described a different export entirely (`yunet_n_640_640`,
317,466 B, not an opencv_zoo artifact).

**Block quantisation is free.** It is *equal or better* on two of three splits.
Ship `int8bq` without hesitation if wire size ever matters.

**Why `2026may`.** The README documents it as *"re-exported from
`face_detection_yunet_2023mar.onnx` with static H/W dims replaced by symbolic
dims, allowing inference at any resolution without resizing."* Parsing confirms
this exactly: **106 nodes, 8 op types, 112 initializers — byte-for-byte the same
graph structure as `2023mar`, with no shape-inference ops added.**

That last clause matters. The earlier spec draft warned against dynamic exports
because they *"bolt on twelve `Shape`/`Gather`/`Unsqueeze`/`Concat` nodes you'd
have to emulate for no benefit."* True of some dynamic exports; **not true of
this one.** It is a free upgrade: any input resolution, identical kernels, 2,851
bytes smaller. There is no `2026may` int8bq variant.

### Outputs — YuNet

Twelve tensors: four heads × three strides. After the in-graph
`Reshape` + `Transpose perm=[0,2,3,1]`, each is `[1, cells, channels]`:

| Head | Shape | Meaning |
|---|---|---|
| `cls_8`, `cls_16`, `cls_32` | `f32[1, anchors, 1]` | classification score, already sigmoid'd |
| `obj_8`, `obj_16`, `obj_32` | `f32[1, anchors, 1]` | objectness score, already sigmoid'd |
| `bbox_8`, `bbox_16`, `bbox_32` | `f32[1, anchors, 4]` | centre offset (2) + log size (2) |
| `kps_8`, `kps_16`, `kps_32` | `f32[1, anchors, 10]` | five landmark offsets |

⚠️ **The symbolic dimension is literally named `anchors` in the export, and this
is almost certainly the source of the anchor-based misreading corrected below.**
There is exactly **one prediction per grid cell** and no prior boxes anywhere;
`anchors` here means `cells` — `padH/stride × padW/stride`, row-major. Read the
decode, not the dim name.

### Op inventory — YuNet (both `2023mar` fp32 and `2026may`)

106 nodes, 8 op types:

```
Conv ×53   Relu ×15   Reshape ×12   Transpose ×12
Sigmoid ×6   MaxPool ×4   Add ×2   Resize ×2
```

Complete geometry — this is the whole kernel requirement:

| Op | Signature | Count |
|---|---|---|
| Conv | 3×3, pad 1, stride 2, group 1 | 1 (stem) |
| Conv | 1×1, pad 0, stride 1, group 1 | 26 |
| Conv | 3×3, pad 1, stride 1, group 1 | 6 |
| Conv | 3×3, pad 1, stride 1, group 64 | 10 |
| Conv | 3×3, pad 1, stride 1, group 32 | 2 |
| Conv | 3×3, pad 1, stride 1, group 16 | 2 |
| Conv | 3×3, pad 1, stride 1, group 10 | 3 |
| Conv | 3×3, pad 1, stride 1, group 4 | 3 |
| MaxPool | 2×2, stride 2, pad 0, `ceil_mode=0` | 4 |
| Resize | **`mode=nearest`**, `coordinate_transformation_mode=asymmetric`, `nearest_mode=floor` | 2 |
| Transpose | `perm=[0,2,3,1]` (NCHW→NHWC) | 12 |

Three things worth extracting from that table:

1. **Dilation is always 1. Padding is always "same". Stride is only ever 1 or
   2.** Every convolution is either 1×1/pad-0 or 3×3/pad-1.
2. **Groups take six distinct values** (1, 4, 10, 16, 32, 64), so a general
   grouped convolution is required — but that *one* kernel subsumes dense
   (group 1) and depthwise (group = channels) as special cases, so the
   generality is free.
3. **`Resize` is nearest-neighbour, not bilinear.** The FPN upsample is index
   arithmetic — `src = floor(dst × scale⁻¹)` — with no interpolation at all.

### Embedder — SFace

| | |
|---|---|
| **Licence** | **Apache-2.0.** `models/face_recognition_sface/LICENSE`, full 11,358-byte text |
| Upstream | [zhongyy/SFace](https://github.com/zhongyy/SFace); ONNX conversion by Chengrui Wang |
| Paper | [*SFace: Sigmoid-Constrained Hypersphere Loss for Robust Face Recognition*](https://arxiv.org/abs/2205.12010) (arXiv 2205.12010) |
| Params | **9.67 M** across 174 initializers |
| Input | `data: f32[1,3,112,112]` |
| Output | `fc1: f32[1,128]` — **128-d**, half the width of most alternatives |
| Opset | 11 (fp32) · 21 (int8bq) |
| LFW | 0.9940 fp32 · **0.9942 int8bq** · 0.9932 int8 |

| File | Bytes | SHA-256 |
|---|---|---|
| `face_recognition_sface_2021dec.onnx` | 38,696,353 | `0ba9fbfa…c34e79` |
| `face_recognition_sface_2021dec_int8bq.onnx` | 10,667,852 | `fb143eea…d74ee` |

### Op inventory — SFace fp32

88 nodes, 8 op types:

```
BatchNormalization ×29   Conv ×27   PRelu ×27
Sub ×1   Mul ×1   Dropout ×1   Flatten ×1   Gemm ×1
```

Geometry:

| Op | Signature | Count |
|---|---|---|
| Conv | 3×3, pad 1, stride 1, group 1 | 1 (stem) |
| Conv | 1×1, pad 0, stride 1, group 1 | 13 (pointwise) |
| Conv | 3×3, pad 1, stride 1, group = C | 9 (depthwise) |
| Conv | 3×3, pad 1, stride 2, group = C | 4 (strided depthwise) |
| BatchNormalization | `epsilon=1e-3` | 27 |
| BatchNormalization | `epsilon=2e-5` | 2 |
| PRelu | per-channel slope, shape `[C,1,1]` | 27 |
| Gemm | `alpha=1, beta=1, transA=0, transB=1` | 1 |
| Dropout | `ratio=0.4` — identity at inference | 1 |

**⚠ Two BatchNorm epsilons.** Twenty-seven nodes use `1e-3`; two (`bn1`, `fc1`)
use `2e-5`. Fold with the per-node value. A single hard-coded epsilon is exactly
the kind of error that produces plausible output and quietly degraded accuracy.

**⚠ There are 29 BatchNorms against 27 convolutions**, so at least one of them
does not follow a convolution — and one of the odd-epsilon pair is named `fc1`,
which is the graph's output name. A converter rule phrased as "fold into the
preceding convolution" will silently skip it. Folding into the final `Gemm` is
just as easy (scale the rows, shift the bias) but it is a **second code path**,
and skipping it costs accuracy without erroring. Confirm the wiring with the
inspector before writing the fold.

**The quantised file needs no integer kernels.** `int8bq` is opset 21 with 145
nodes across 11 op types — the fp32 eight, plus `DequantizeLinear ×29`,
`Reshape ×27`, `Constant ×1`, and 261 initializers holding 9.98 M values (the
extra ones are scales and zero points). That is weights-only block quantisation:
dequantise and reshape offline in the converter and the identical fp32 88-node
graph falls out. Same holds for YuNet's `int8bq` (214 nodes, 9 types, adding
`DequantizeLinear ×64` and 44 extra `Reshape`).

### ⚠ Both SFace files declare their weights as graph *inputs*

The inspector reports **175 graph inputs** for each file: `data`, then
`scalar_op1`, `scalar_op2` and all 174 weight tensors — which are *also* present
as initializers. An old-exporter artifact. Two consequences:

1. **For our converter: harmless.** Read initializers directly from the
   protobuf; treat a name that is both an input and an initializer as an
   initializer. Note it means `scalar_op1`/`scalar_op2` are technically
   overridable at runtime, which is why their values are recorded below rather
   than assumed.
2. **For a stock runtime: not harmless, and asymmetric between the two files.**
   Measured with `onnxruntime-node` 1.27:

   | File | Required inputs | Runs? |
   |---|---|---|
   | `..._2021dec.onnx` (fp32) | 1 — `data` | ✅ 5.10 ms/face, output `fc1: [1,128]` |
   | `..._2021dec_int8bq.onnx` | **30** — `data` + 29 weight tensors | ❌ `input 'conv_1_conv2d_weight' is missing in 'feeds'` |

   **So use the fp32 file as the reference oracle.** Attempting to validate
   against the quantised file in a generic runtime fails in a way that looks like
   a bug in your own code. Shipping the quantised file is still fine — our
   converter never runs it, it only reads its initializers.

⚠ **Dump reference activations from whichever file you ship.** Block-dequantised
weights are not bit-identical to the float file's. Mixing the two produces real
per-layer deviations that are indistinguishable from an implementation error.

### Parameters are not arithmetic — the cost table

The 9.67 M parameter count is misleading about where the work is, and budgeting
runtime from it overstates the cost of this model by roughly 4×.

| Part | Parameters | Multiply-adds per face | Share of work |
|---|---|---|---|
| Convolution body (stem + 13 blocks) | **3.25 M** | **~569 M** | ~99% |
| Head — `Flatten` → `Gemm[128 × 50176]` | **6.42 M** (66% of params) | **6.4 M** | ~1% |
| **Total** | 9.67 M | **~575 M** | |

The body's 3.25 M matches standard MobileNetV1's convolution parameter count
(3.2 M) exactly, and because the stem is stride 1 at 112×112 rather than stride 2
at 224×224, its per-layer spatial sizes match MobileNetV1-1.0/224 layer for
layer — so the published **569 M multiply-adds** carries over directly.

Against MobileFaceNet's 221 MFLOPs that is **2.6×, not the 10× the parameter
ratio suggests.** The inspector can print exact per-op multiply-adds given an
input shape; worth adding to it, and worth putting in the re-verification
checklist, precisely because the parameter count is the number everyone quotes.

### Measured runtime on this machine

`onnxruntime-node` 1.27, Apple silicon, optimised multi-threaded C++ with vector
instructions. A **floor** for hand-written scalar JavaScript, useful mainly for
relative cost:

| Model | Input | ms |
|---|---|---|
| YuNet `2026may` | 320×320 | 2.9 |
| YuNet `2026may` | 960×1280 — a 24 MP portrait at working resolution | **16.7** |
| YuNet `2026may` | 1280×1280 | 20.2 |
| SFace fp32 | 112×112, one face | **5.10** |

**The detector, not the recogniser, is the bulk of the work** — it runs on whole
photographs while the recogniser runs on 112×112 crops. Since detector cost scales
with pixel count, working resolution is the largest single lever on batch runtime;
see the spec's §6.1 for the resolution argument and §12 for the scalar-JS
extrapolation.

**A side benefit: the decode is confirmed against a running model.** At 320×320
the `cls_8` output has exactly 1600 entries, and 1600 = 40×40 = (320/8)². One
prediction per grid cell, no prior boxes — the anchor-free decode below, verified
by execution rather than by reading a source comment.

### ⚠ Correction: SFace is not MobileFaceNet

opencv_zoo's README states *"Model files encode MobileFaceNet instances."* The
exported graph does not support that reading, and an earlier spec draft built its
whole §7.1 architecture description on it — describing inverted-residual
bottleneck blocks and a global-depthwise-convolution head, citing the
MobileFaceNet paper. **Implementing that description would not have reproduced
this model.** What the file actually contains:

- **No inverted residuals.** There are zero `Add` nodes, therefore no residual
  connections anywhere. Blocks are a flat alternation of 3×3 depthwise then 1×1
  pointwise — plain **MobileNetV1**.
- **Channel schedule** 32 → 64 → 128 → 128 → 256 → 256 → 512(×6) → 1024 → 1024,
  read off the initializer names (`conv_1` … `conv_14`, each with a `_dw`
  sibling). That is MobileNetV1's schedule exactly.
- **No global depthwise head.** Four stride-2 stages take 112 → 56 → 28 → 14 →
  7, and `pre_fc1_weight` is `f32[128, 50176]` where 50176 = 1024 × 7 × 7. So
  the head is `Flatten` → one dense `Gemm`. **That single matrix is 6.42 M of
  the model's 9.67 M parameters** — two thirds of the network.
- **Scale.** MobileFaceNet is ~1.0 M parameters. This is 9.67 M. A 10×
  discrepancy settles it independently of topology.

Implement MobileNetV1 + BN + PReLU + flatten + GEMM. Do not implement
MobileFaceNet.

### Verified preprocessing — the whole silent-failure surface

Every value here was read from the graph or from OpenCV's own source, because
this is where the pipeline fails without erroring.

**Input normalisation is baked into SFace's graph.** The first two nodes are
`Sub(data, scalar_op1)` then `Mul(·, scalar_op2)`, and the initializer values
are:

```
scalar_op1 = 127.5
scalar_op2 = 0.0078125        exactly 2⁻⁷ = 1/128
```

So the graph computes `(x − 127.5) / 128` and you must **feed raw 0–255**.
Dividing by 255 first — the reflex — silently destroys accuracy. Note `/128`,
not `/127.5`: `1/127.5 = 0.00784…`, a different number. Confirmed by
`face_recognize.cpp`, which calls
`blobFromImage(aligned, /*scalefactor=*/1, Size(112,112), /*mean=*/Scalar(0,0,0), …)`
— unit scale, zero mean.

**Channel order is RGB.** Same call passes `swapRB=true`; OpenCV decodes BGR, so
the network receives RGB.

**The alignment template**, from `getSimilarityTransformMatrix` in
`modules/objdetect/src/face_recognize.cpp`:

```
right eye     38.2946, 51.6963      (subject's right = image left)
left eye      73.5318, 51.5014
nose tip      56.0252, 71.7366
right mouth   41.5493, 92.3655
left mouth    70.7299, 92.2041

destination centroid  56.0262, 71.9008
output 112×112, similarity transform, INTER_LINEAR
```

**Landmark order — now verified, not inferred.** From the comment in
`modules/objdetect/src/face_detect.cpp`:

```
(tl_x, tl_y, w, h, re_x, re_y, le_x, le_y, nt_x, nt_y, rcm_x, rcm_y, lcm_x, lcm_y, score)
're': right eye, 'le': left eye, 'nt': nose tip,
'rcm': right corner of mouth, 'lcm': left corner of mouth
```

Landmarks occupy columns 4–13, in the order right eye, left eye, nose, right
mouth, left mouth — which maps **directly onto the template above with no
permutation.** Verify by eye anyway on day one: swapping the eyes yields a
mirrored crop that looks entirely plausible and degrades every match.

**Similarity metric and published threshold**, from `sface.py`:

```
cosine threshold   0.363      ← L2-normalise both, then dot product
L2 threshold       1.128
```

0.363 is the reference *verification* threshold — a starting point for the lab's
similarity explorer, not a clustering cutoff, and not a number to trust on real
photographs until measured on them.

### ⚠ Correction: YuNet is anchor-free

An earlier spec draft described YuNet as *"anchor-based … each output cell
carries predictions relative to a prior box; decode by applying the predicted
deltas to the prior."* There are no priors. From `postProcess` in
`face_detect.cpp`, the decode is centre-based, per stride ∈ {8, 16, 32}, over a
row-major grid of `cols = padW/stride` by `rows = padH/stride`:

```
score  = sqrt(clamp01(cls) * clamp01(obj))        geometric mean of two heads
cx     = (c + bbox[0]) * stride
cy     = (r + bbox[1]) * stride
w      = exp(bbox[2])  * stride
h      = exp(bbox[3])  * stride
x1, y1 = cx - w/2, cy - h/2
kp[n]  = ((kps[2n] + c) * stride, (kps[2n+1] + r) * stride)
```

Then greedy NMS (`dnn::NMSBoxes`, `eta=1.0`) pooled **across all three strides
together**, not per-stride. The `Sigmoid ×6` in the graph is the cls and obj
heads at three strides, so scores arrive pre-sigmoid'd — clamp, multiply, square
root.

**And there is no letterboxing.** `padWithDivisor` calls
`copyMakeBorder(src, dst, /*top=*/0, bottom, /*left=*/0, right, BORDER_CONSTANT, 0)`
— zero padding on the **bottom and right only**, to round dimensions up to a
multiple of 32 (`divisor = 32`). Because nothing is added at the top or left,
every decoded coordinate is already in original-image space. **The inverse
un-letterbox transform the earlier draft flagged as a likely silent bug does not
exist**; combined with `2026may`'s dynamic input, there is no resize either.

Reference defaults, for the lab's initial knob positions: `inputSize` 320×320,
`scoreThreshold` 0.6, `nmsThreshold` 0.3, `topK` 5000, `divisor` 32.

---

## The unresolved provenance question

**SFace's training data is unknown, and the question is now closed
unanswered.** The paper lists CASIA-WebFace, VGGFace2 and MS1MV2; all three are
non-commercial. [`opencv_zoo#124`](https://github.com/opencv/opencv_zoo/issues/124)
asked which was used. It is **closed with no answer on record** — so asking
again means opening a fresh issue.

What that does and doesn't mean:

- The Apache-2.0 grant covers **the file**. It says nothing about data lineage.
- Whether a dataset licence reaches trained weights is **legally untested; there
  is no case law.** The only model author found conceding in writing that it
  does is Davis King, for dlib's 68-point landmark predictor.
- **For this deployment it is moot.** A personal wedding site is
  non-commercial, so every candidate restriction is already satisfied.
- It is not moot for anyone forking this commercially, which is why it is
  written down here rather than resolved by assumption.

YuNet's chain has the same shape one layer down: MIT weights trained on WIDER
FACE (**CC BY-NC-ND 4.0** — non-commercial *and* no-derivatives) with SCRFD
`labelv2` annotations from InsightFace's corpus, which its own author restricts
to non-commercial research. Permissive tag, restricted upstreams. Nobody in the
chain is being dishonest; the links just don't compose.

---

## Distribution: why no weights are committed

This repository is **public**. Committing a weights file makes us its
distributor, which is a different permission from using it — and the one place
where "it's non-commercial" stops being a sufficient answer.

So: **`public/vision/weights/` is gitignored, and `scripts/fetch-weights.js`
populates it.** The script reads this ledger, downloads from the pinned URLs,
verifies SHA-256, refuses to proceed on mismatch, and writes
`<name>.LICENCE.md` next to each artifact with source URL, full licence text,
retrieval date and hash.

Four things this buys, in order of weight:

1. **The repo distributes zero encumbered bytes.** Every no-derivatives,
   non-commercial and ShareAlike redistribution question becomes structurally
   absent rather than argued away. Each clone makes its own licence decision at
   fetch time.
2. **Swapping a model is a ledger entry**, not a code change.
3. **A 10 MB blob stays out of git history**, permanently.
4. **Re-verification is a command**, not an audit.

Note that the two chosen files are MIT and Apache-2.0, so committing them would
*probably* be fine. The point is not to have to decide.

---

## Rejected candidates

Recorded so they don't get re-litigated. Read
[RESEARCH-face-recognition.md](./RESEARCH-face-recognition.md) for the fuller
search narrative.

| Model | Why not |
|---|---|
| **Entire YOLO-face family** (v8/v10/v11/v12) | **AGPL-3.0.** Ultralytics asserts it reaches trained weights *"even if you train your own model from scratch"* and that network deployment triggers source disclosure. The counterargument (weights are program output) is substantial and untested. **Note: copyleft does not care that we are non-commercial** — this exclusion holds regardless. |
| **YOLOv5-Face** | GPL-3.0 (forked pre-relicence, so no §13 network clause), but shipping weights is still distribution, so still copyleft. 11 MB besides. |
| **SCRFD / InsightFace detectors** | Non-commercial research only. Hugging Face re-uploads tagged `apache-2.0`/`mit` are third-party mislabels — a downstream trainer cannot grant a licence they don't hold. |
| **InsightFace buffalo / antelopev2** | **No `LICENSE` file exists** — the URL 404s. Licensing position is README prose. 16–407 MB. |
| **AuraFace-v1** | Apache-2.0 and an architecturally *simpler* graph (6 op types) — a legitimate fallback, disqualified only by 260.69 MB. If taken, **take the embedder file alone**; the repo also bundles InsightFace-derived `scrfd_10g_bnkps`, `2d106det`, `1k3d68` and `genderage`, which its Apache grant does not cover. |
| **EdgeFace-XS / XXS** | Best accuracy found (LFW 99.73, **IJB-C 94.85**) at 3.38 MB fp16, and a genuine transformer — `Softmax`+`MatMul`, `Erf`, `Sin`/`Cos`/`CumSum`, `LayerNormalization`, in-graph dynamic shape. **~30 op types versus SFace's 8**, sharing nothing with the detector. Licence is self-contradictory (two BSD-3 `LICENSE` files; HF card says CC-BY-NC-SA *and links to the BSD file*) and could not be re-verified in this pass — the model card returned HTTP 401. Treat the contradiction as unresolved. Not needed now that YuNet is MIT and SFace is Apache-2.0. |
| **HyperFace / Vec2Face** | MIT, but 175–390 MB, and its "synthetic" data was generated by Arc2Face (WebFace42M) with ArcFace/Glint360K teachers. |
| **TinyFaR-C** | GPL-3.0 *and* distilled from an MS-Celeb-1M teacher. Fails twice. |
| **`face_det_lite` (Qualcomm)** | BSD-3 with SPDX headers, proprietary training data — **the cleanest lineage found**, and the designated escape hatch if YuNet's provenance ever becomes load-bearing. Not chosen: 3,544,927 B, ~878 K params, MobileNetV3 backbone needing squeeze-excite (`GlobalAveragePool`+`Mul`) that YuNet does not, no published WIDER AP, and **undocumented landmark order** requiring empirical determination. Its op counts were reported inconsistently across three parses in the previous session and were **not** re-verified here — re-parse before relying on them. |
| **`.pt` / `.ckpt` as converter targets** | Zip + Python pickle; extracting tensors needs a pickle-VM subset. Lightning checkpoints carry optimiser state. **ONNX or safetensors only.** |

**The synthetic-data escape hatch does not exist yet.** DigiFace-1M has the
cleanest provenance in the field — 511 consented 3D scans — but its Research Use
of Data Agreement §5.5 defines trained models as "Results" and §2.1 forbids
commercial use, so the cleanliness doesn't survive into the weights. DCFace never
released FR weights and its repo has no licence. No FRCSyn challenge winner
releases weights. **You cannot currently have all three of small, permissively
licensed, and clean training-data lineage. Pick two.** That gap is real, not a
search failure.

---

## The swap matrix

What actually has to change to replace a component. This is the concrete form of
"leave holes someone else can fill."

| Swap | Ledger entry | Pack metadata | Kernels | Code |
|---|---|---|---|---|
| YuNet `2026may` ↔ `2023mar` ↔ `int8bq` | url + hash | input shape | none | none |
| YuNet → `face_det_lite` | new entry | input shape, normalisation, landmark order | +`GlobalAveragePool` | new decode (CenterNet-style) |
| SFace `int8bq` ↔ fp32 | url + hash | none | none | none |
| SFace → AuraFace | new entry | normalisation `/127.5`, dim 512 | none (subset) | none |
| SFace → EdgeFace | new entry | normalisation `x/127.5−1`, dim 512 | +~22 op types | constant-folding in converter |

The first four rows are configuration. Only the last is a project.

---

## Re-verification checklist

Run after any upstream change, before trusting anything above:

1. `node scripts/vision/inspect-onnx.js public/vision/weights/*.onnx` — op
   inventory, attribute signatures, initializer count, params, input/output
   shapes.
2. Diff the op-type set against the tables here. **Op types matter; counts vary
   between exports of the same model.** (`2023mar` and `2026may` happen to agree
   exactly; the non-opencv_zoo `yunet_n_640_640` export does not.)
3. Re-read the distributing repository's `LICENSE`. Not the model card, not the
   README's summary, not a Hugging Face tag — the file.
4. Re-extract `scalar_op1` / `scalar_op2` and both BatchNorm epsilons.
5. Re-check the landmark-order comment in the reference decode.
6. Confirm SHA-256 against the table above; `fetch-weights.js` does this
   automatically and should fail loudly.
7. **Confirm the download still needs the LFS media host**, and that a raw fetch
   has not silently started returning a pointer file into your weights directory.
   A 131-byte `.onnx` is the signature.
8. **Re-check the BatchNorm-to-Conv count** (29 vs 27) and where the extra ones
   attach, since the fold depends on it.
9. **Re-derive multiply-adds, not just parameters.** The cost table above is the
   number that predicts runtime; the parameter count is the number that misleads.
