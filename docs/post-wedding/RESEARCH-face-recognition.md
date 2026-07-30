# Research: face recognition under this repo's constraints

**Date:** 2026-07-29
**Status:** ⚠️ **Historical record. Substantially superseded — do not build from
this document.**
**Build from:** [`SPEC-vision-lab.md`](./SPEC-vision-lab.md) ·
[`VISION-MODELS.md`](./VISION-MODELS.md)
**Question originally asked:** how hard would it be to add simple face
recognition, given zero-npm-dependencies / no-regex / Node-built-ins-only?

This was the first pass. It is kept because the *reasoning* is still worth
reading and because several of its findings turned out to be load-bearing. But
its central recommendations were reversed, and one of its technical premises was
wrong. Read it for context, then read the spec.

## What survived, and what didn't

| This document says | Current status |
|---|---|
| §1 four-stage pipeline; difficulty concentrates in Embed | ✅ **Stands.** The framing the whole project uses |
| §2 vendor pico.js (~200 lines MIT JS) + `puploc` | ❌ **Reversed.** Owner ruled out vendoring third-party *code*. All code is first-party; only weights are imported. The chosen CNN detector also emits five landmarks directly, deleting the entire pupil-localisation stage |
| §3 Option A: vendor a small CNN, hand-write inference | ✅ **Stands** — this is the plan. But see the timing correction below |
| §3 Option A timings: "221 MFLOPs, 0.2–1 s/face, 20–100 min for the gallery" | ⚠️ **Optimistic.** Computed for MobileFaceNet at 1.0 M params. The chosen model (SFace) is **9.67 M** — nearly 10×. Treat as unmeasured; see SPEC §5.2 |
| §3 Option B: classical LBP/HOG descriptor as a cheap baseline | 🔶 **Never spiked, still un-refuted.** The cheapest unknown in the project |
| §3 Option C: browser `FaceDetector` API | ✅ **Stands** — don't build on it. But macOS Vision *is* now used as a dev-machine oracle (SPEC §9.1) |
| §4.1 the client already has decoded bitmaps — detection is nearly free | ✅ **Stands, and got promoted.** This is now the "free rider" design in SPEC §8 |
| §4.2 server-side is harder; no image decode in Node | ❌ **Wrong conclusion from a true premise.** Node genuinely cannot decode images — but the repo already shells out to vips/ImageMagick/sips (`CLAUDE.md:17`, `scripts/lib/image-backend.js`). `magick x.jpg -depth 8 RGB:-` yields raw pixels. **Offline CLI is now the primary venue** |
| §4.3 the CSP blocks WebAssembly | ⚠️ **True but not load-bearing.** The CSP is already per-page (`FRAMEABLE_SAMEORIGIN_PAGES`), so scoping a relaxation to `/studio` would be trivial. WASM is excluded because every usable runtime is third-party *code*. See SPEC §6.1 |
| §4.4 read `display`, not `thumb`, never `original` | 🔶 **Applies to the browser-batch venue only.** The CLI reads `uploads/` off disk, where `original` is the right choice |
| §4.5 no-regex is a non-issue; needs new tables | ✅ **Stands.** See SPEC §12 |
| §4.6 you already know who the guests are | ✅ **Stands, and it's the key reframe.** Assisted tagging against a ~100-person roster, not open-set identification |
| §5 recommended architecture (worker + pico.js in admin page) | ❌ **Superseded** by SPEC §4's venue-agnostic core with four adapter seams |
| §6 tier table (0–3) | ❌ **Superseded** by SPEC §10's seven-rung ladder |
| §7 privacy | ✅ **Stands and still governs.** Sharpened in SPEC §12: embeddings are computed admin-side only |
| §8 the reframe — the useful features may not need identity | ✅ **Stands, and it aged well.** Tiers 1–3 of the current plan are exactly this |

**One thing this document got right that later drafts nearly lost:** §8's
argument that smart crops and "more like this" deliver most of the value without
identity at all. The current ladder puts them at tier 1, before any embedder
exists.

---

**Original short answer, preserved:** face *detection* is genuinely easy here
(~1–2 days, ~250 KB of vendored MIT assets). Face *recognition* — "this is the
same person" — is a real project (~2 weeks) whose difficulty is almost entirely
one question: **are you willing to vendor a ~1–4 MB neural-net weights file into
the repo?** If yes, it's tractable and the accuracy is good. If no, you can still
ship something, but it will be noticeably worse and probably annoying to use.

The no-regex rule is a non-issue (this is all numeric code). The zero-dependency
rule is the whole story.

*(The answer to that question turned out to be "yes, but fetch it rather than
commit it, because the repo is public." See SPEC §3.)*

---

## 1. The problem is four stages, not one

People say "face recognition" meaning one thing; it's a pipeline, and the stages
have wildly different costs.

| Stage | What it does | Difficulty here |
|---|---|---|
| 1. **Detect** | find face boxes in a photo | **Easy.** Solved by ~200 lines of vendored MIT JS. |
| 2. **Align** | find the eyes, rotate/scale to a canonical crop | **Easy-ish.** Same author, same technique. Skipping it costs a lot of accuracy. |
| 3. **Embed** | turn a face crop into a ~128–512-dim vector where distance ≈ identity | **The hard part.** This is a CNN. No way around that. |
| 4. **Cluster / match** | group vectors, let a human name the groups | **Easy.** ~150 lines of plain JS. |

Stages 1, 2 and 4 are a few days of work total. Stage 3 is the entire question.

---

## 2. Stage 1–2: detection and alignment — genuinely cheap

[**pico.js**](https://github.com/nenadmarkus/picojs) (Nenad Markuš) is a face
detector in ~200 lines of dependency-free JavaScript, MIT licensed. It's a
modification of Viola-Jones using pixel-intensity comparisons in a decision-tree
cascade. It runs at 200+ FPS on a webcam frame — over a 2000-photo gallery,
detection is a few seconds of work, not minutes.

It needs one binary asset: the pretrained `facefinder` cascade, ~200 KB. That's
a `fetch()` of an `ArrayBuffer` and a `DataView` walk — no npm, no WASM, no eval.

The same author's `puploc` does pupil localisation with the same technique and
another small binary. Two eye centres give you a similarity transform to a
canonical 112×112 crop, which is what every embedding model expects. **Alignment
is not optional if you care about accuracy** — unaligned crops cost you a large
fraction of the model's quality.

So: ~250 KB of vendored MIT binaries + ~400 lines of our own JS gets you boxes
and aligned crops. That part I'd call low-risk.

---

## 3. Stage 3: the embedding — where the decision lives

### Option A — vendor a small pretrained CNN (the real answer)

**MobileFaceNet** is the standard choice: ~1.0 M parameters, 221 MFLOPs per
face at 112×112, and **99.55% verification accuracy on LFW** when trained with
ArcFace loss ([paper](https://arxiv.org/pdf/1804.07573)). That is
better-than-human on the standard benchmark, from a model small enough to ship.

Weights are ~4 MB as float32, ~1 MB quantised to int8. You'd write the inference
yourself — depthwise-separable convolutions, batch-norm folded into the conv
weights offline, PReLU activations, a global-depthwise-conv head. In plain JS
over `Float32Array`s that's maybe 400–800 lines. It's tedious and fiddly to get
numerically right, but it is *not* research; it's careful engineering with a
reference implementation to check against layer by layer.

**Speed, honestly:** 221 MFLOPs in scalar JS lands somewhere around 0.2–1 s per
face depending on how tight the inner loops are. For a 2000-photo gallery at
~3 faces each, that's roughly **20–100 minutes** as a one-time batch in a Web
Worker. That's acceptable for a "go make coffee" admin job and unacceptable for
anything interactive. A WebGPU backend would cut it to seconds, at the cost of
another ~600 lines and WGSL you'd have to debug.

**⚠ The licence trap — read this before committing.** InsightFace's *code* is
MIT, but its *pretrained models* are trained on datasets (MS1M, Glint360K) whose
terms restrict them to **non-commercial research use only**. Lots of blog posts
say "ArcFace is MIT" and are quoting the code licence, not the weights. Some
model-zoo variants are redistributed under Apache 2.0 (e.g. OpenVINO's
`face-recognition-resnet100-arcface-onnx`), but that one is ResNet-100 — far too
big for us. **Whatever weights get vendored, the licence needs to be read and
the file attributed in-repo.** A personal wedding site is plausibly non-commercial
use, but that should be a deliberate call, not an accident.

### Option B — no model file at all: classical descriptors

Skip the CNN. Compute a hand-crafted descriptor over the aligned crop — LBP
histograms over an 8×8 grid, or HOG. Pure JS, ~150 lines, **zero new binary
assets**, instant to run.

Accuracy is the problem: classical descriptors sit around 60–75% verification
where the deep models are at 99.5%. That gap is not a rounding error.

**But the wedding case is unusually forgiving**, and this deserves saying:

- You have ~100 identities, not a million.
- Every photo is the same day, same venue, same lighting, same outfits — which
  is a large real-world advantage over the LFW benchmark condition.
- You don't need a *decision*, you need a *ranking* that a human confirms.
  "Here are 40 clusters, name them" and "show me more photos that look like this
  one" both tolerate a much weaker signal than "is this person authorised."

So Option B is not useless. My honest expectation is it produces clusters that
are maybe 70% useful and 30% irritating — enough to be a fun toy, not enough to
be the thing you actually tag 2000 photos with. Worth a half-day spike to find
out, since it costs nothing and it's the same pipeline either way.

### Option C — the browser's native `FaceDetector`

The Shape Detection API would give detection for free. It never shipped broadly
on desktop, is platform-gated where it exists, and Chrome has signalled
deprecation. **Don't build on it.** Fine as an opportunistic fast path if
present, but you need the pico.js path anyway, so it buys nothing.

---

## 4. Repo-specific findings

These are the things that make *this* app easier or harder than the generic case.
Four of them are load-bearing.

### 4.1 ✅ The client already has decoded bitmaps in hand — detection is nearly free

`public/components/media-processing.js:46` already does
`createImageBitmap(file, { imageOrientation: "from-image" })` and draws to a
canvas for every upload. A detection pass is a `getImageData` away from pixels
that are *already decoded*. Adding face detection at upload time is close to a
free rider on work the app does anyway.

### 4.2 ❌ Server-side is the *harder* path, not the easier one — no image decode in Node

Verified on this machine:

```
createImageBitmap: undefined | OffscreenCanvas: undefined | ImageData: undefined
```

Node 22 has no canvas and no image decoding. To do any of this server-side you
must decode JPEG **and WebP** yourself — and `encodePreferWebp()`
(`media-processing.js:105`) means the display/thumb variants are WebP whenever
the browser supports it. A pure-JS baseline JPEG decoder is ~500 lines and
vendorable; a **pure-JS WebP decoder means implementing a VP8 intra-frame
decoder**, which is a project unto itself and not one I'd take on.

This inverts the usual instinct. **The browser is the right place to run this,
and the admin browser specifically.**

### 4.3 ⚠ The CSP currently blocks WebAssembly

`core/static.js` emits `script-src 'self' 'sha256-<theme-init>'` with no
`'unsafe-eval'` / `'wasm-unsafe-eval'`. Chrome requires `'wasm-unsafe-eval'` in
`script-src` to instantiate WASM at all. So **any WASM-based approach needs a CSP
relaxation** — a security-posture change on a public site, for a feature that
doesn't need it. Plain JS and Web Workers are fine as-is (`default-src 'self'`
covers `worker-src`), and WebGPU/WGSL isn't governed by `script-src` either. This
is a good reason to stay in plain JS + optional WebGPU and skip WASM entirely.

### 4.4 ⚠ Pick the right variant to read: `display`, not `thumb`, never `original`

- `thumb` is 400px long edge. A face in a group shot is ~20px there — useless
  for embedding, though fine for *locating* faces.
- `display` is 2000px — the right input for crops.
- `original` is up to 30 MB. Don't.

Best pattern: detect on the cheap `thumb`, then fetch `display` **only for
photos that actually contain faces**, crop, embed. That avoids pulling ~1 GB of
2000px images into the admin browser to find out which ones have anybody in them.

### 4.5 ✅ No regex is a non-issue; ⚠ the schema needs new tables

None of this is string processing. Not a constraint that bites.

The `media` table has no place for any of this — you'd add `media_faces` (bbox,
landmarks, embedding as a BLOB) and `face_identities`, plus the polymorphic
target trigger pattern the repo already uses for comments/reactions.

### 4.6 💡 You already know who the guests are

There's a populated `guests` table. Recognition here isn't identification from
nothing — it's **assisted tagging against a known ~100-person roster**, with the
couple confirming every cluster. That framing makes a weaker model much more
viable, and it's a better product anyway.

---

## 5. Recommended architecture, if this gets built

Everything client-side, in the **admin** page, in a Web Worker:

```
admin "Faces" tab
  └─ Worker
       ├─ fetch /media/:key/thumb    → pico.js detect        (fast, all photos)
       ├─ fetch /media/:key/display  → crop + puploc align   (only photos with faces)
       ├─ embed (MobileFaceNet | LBP)                        (the slow part)
       └─ cluster + rank
  └─ UI: "40 groups found — who is this?" → link to guests table
  └─ POST embeddings + assignments (or keep them local — see §7)
```

Why admin-side: no server compute, no new server dependencies, sidesteps §4.2
entirely, and it keeps guests' browsers out of it. It's a one-time batch job run
by the couple, which is exactly the shape of the work.

---

## 6. Effort estimate

| Tier | Scope | Effort | Value |
|---|---|---|---|
| **0** | pico.js detection only — smart thumbnail crops that don't decapitate people, "photos with people" filter, face counts | **1–2 days** | Real, immediate, low risk |
| **1** | + alignment + LBP/HOG descriptor + clustering UI in admin | **+3–4 days** | Works or doesn't; find out cheaply |
| **2** | + vendored MobileFaceNet weights + hand-written pure-JS inference in a Worker | **+5–8 days** | The actual feature, good accuracy |
| **3** | + WebGPU backend | **+3–5 days** | Minutes → seconds; only if Tier 2 is too slow to bear |

**Tier 0 is worth doing on its own merits** regardless of whether recognition
ever happens. Smart cropping alone would improve the gallery, and it's a
self-contained day or two.

The honest recommendation: **do Tier 0, then spike Tier 1 in half a day to see
how bad the classical descriptor really is on actual wedding photos.** That
measurement is what should decide whether to commit to Tier 2 — not a benchmark
number from a paper about a different dataset.

---

## 7. Privacy and law — flagging once, not moralising

Face embeddings are **biometric identifiers**. This isn't hypothetical
box-ticking:

- **Illinois BIPA** requires written consent before collecting biometric
  identifiers and has a private right of action with statutory damages. Texas
  (CUBI) and Washington have analogues.
- **GDPR Art. 9** treats biometric data used to identify people as
  special-category data.

Realistically, a wedding guest suing over this is about as likely as anything
gets to zero. But the design costs of getting it right are near zero too, so
there's no reason not to:

1. **Keep embeddings out of the public API.** Nothing in `/api/config` or any
   guest-facing feed should expose who is in a photo.
2. **Prefer local-only storage.** IndexedDB in the admin browser is enough for
   assisted tagging. If they're persisted server-side, they should be
   admin-read-only and covered by the existing soft-delete pattern.
3. **Don't auto-publish tags.** "Photos of you" as a *guest-facing* feature
   should be opt-in, and the couple should confirm every cluster before any name
   is attached to any face.
4. **Give a delete path** — deleting a guest or a media row should cascade the
   face rows.

Points 1–4 are cheap and they're settled. See
[`SPEC-vision-lab.md`](./SPEC-vision-lab.md) §10 for the shipped version and §15
for the rules that govern building it.

---

## 8. One reframe worth considering

The couple already know who's in their photos. The genuinely useful features
here might be the ones that *don't* need identity at all:

- **Smart crops** that keep faces in frame in the gallery grid (Tier 0).
- **"More like this"** — click a face, get ranked similar faces, confirm by eye.
  A ranking that's right 70% of the time is still a big speedup over scrolling.
- **Face count / "photos with people"** as a gallery filter (Tier 0).

Full recognition is the expensive 20% that delivers maybe the last 30% of the
value. Worth knowing that before starting at Tier 2.

---

## Sources

- [pico.js — nenadmarkus/picojs (MIT)](https://github.com/nenadmarkus/picojs)
- [pico.js: face detection in 200 lines of JavaScript](https://nenadmarkus.com/p/picojs-intro/)
- [MobileFaceNets paper (arXiv 1804.07573)](https://arxiv.org/pdf/1804.07573)
- [Keras_insightface — model/weights licence discussion](https://github.com/leondgarse/Keras_insightface)
- [OpenVINO face-recognition-resnet100-arcface-onnx (Apache 2.0)](https://github.com/openvinotoolkit/open_model_zoo/blob/master/models/public/face-recognition-resnet100-arcface-onnx/README.md)
