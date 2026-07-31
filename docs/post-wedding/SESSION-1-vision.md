# Session 1: find out whether this works, in one evening

**Date:** 2026-07-29
**Status:** ✅ **run.** This document is the plan as written beforehand, kept
because the predictions in §4 are worth checking against. What the session
actually found — including three places where the report drew a conclusion its
own numbers did not support — is in
[`SESSION-2-vision.md`](./SESSION-2-vision.md), **which supersedes §5 of this
document.** Read that before acting on anything here.
**Reads with:** [`SPEC-vision-lab.md`](./SPEC-vision-lab.md) §5 (build order) and
§15 (working rules) · [`VISION-MODELS.md`](./VISION-MODELS.md) (the models)

One evening. It ends with a number that says whether the feature is worth
building, a labelled evaluation set that every later threshold gets tuned
against, and four decisions that determine everything after it.

**Everything in this session is local and admin-side.** Nothing is served,
nothing is committed, nothing leaves the machine.

---

## 0. Before anything runs

Spec §15 applies to every command below. In short: you supply the path, nothing
searches for it, everything derived is `tmp/` and gets deleted, and no number
measured tonight ends up in a document.

```
export PHOTOS=/path/to/the/directory        # you supply this
```

---

## 1. Set up (me, ~20 minutes)

**The borrowed engine.** A stock inference runtime goes into `tmp/rig/`
(gitignored) so the real models can run tonight instead of in week four. It is
scaffolding and an oracle, never part of the app — see spec §2.1 for why that
distinction is drawn strictly and what it costs.

```
mkdir -p tmp/rig && cd tmp/rig && npm init -y && npm i onnxruntime-node
```

**The weights.** Fetched from the pinned commit URLs in the ledger and
hash-checked. Note these must come from `media.githubusercontent.com/media/...` —
the `raw.` URLs return 131-byte git-lfs pointers.

**First-party code, written tonight, that ships:**

| Module | Does |
|---|---|
| `public/vision/align.js` | five landmarks → similarity transform → 112×112 bilinear crop |
| `public/vision/gate.js` | the quality gate — size, edge clipping, eye-separation geometry, normalised blur |
| `public/vision/group.js` | average-linkage grouping, cosine distance, cannot-link-within-a-photo |
| `public/vision/metrics.js` | the separation report of spec §7 |
| `scripts/vision/pixels-cli.js` | raw RGB out of `scripts/lib/image-backend.js` |

**Scaffolding, thrown away later:** the engine wrapper and the labelling page.
Being honest about which is which — the pipeline modules above are real, the
labelling page is a single standalone HTML file that reads a manifest and writes
`labels.json`. Its *interaction design* seeds the eventual assignment UI; its
code does not.

⚠ One setup note: vips on this machine can't load its HEIF module (missing
`libx265`) and `vips header` isn't a subcommand — `vipsheader` is a separate
binary. `brew reinstall x265 vips` fixes it, or let the backend probe fall
through to ImageMagick, which works fine for JPEG.

---

## 2. Detect, align, gate (me, ~10 minutes of compute)

```
node scripts/vision/session1.js "$PHOTOS" --out tmp/session1
```

What it does, per photograph:

1. **Deduplicate by content hash first.** Photo deliveries carry retouched and
   unretouched copies of the same frame, and repeated basenames across folders.
   Leaving them in would collapse same-person distances toward zero and forge a
   good result — the single easiest way to get a falsely encouraging answer, so it
   happens before anything else.
2. Decode once at 2000 px on the long edge.
3. Downsample in memory to **1280 px** and detect there — cheaper by roughly 14×
   than native 24 MP, and it is also what puts faces inside the model's trained
   size band. Report recall at both so the choice is checked, not assumed.
4. Align each face to 112×112 from the 2000 px buffer.
5. Run the quality gate, recording *why* each rejection happened.
6. Describe every surviving crop.

Writes `tmp/session1/crops/*.png`, `faces.jsonl` (box, landmarks, gate verdict,
descriptor) and `contact-sheet.html`.

### Guided thing #1 — look at the contact sheet (you, 5 minutes)

Open `tmp/session1/contact-sheet.html`. You are checking three things by eye,
and each has a specific failure signature:

| Look for | Failure signature | What it means |
|---|---|---|
| Are the crops **centred and upright**? | consistently mirrored or rotated | landmark order is swapped — a mirrored crop looks plausible and quietly degrades every match |
| Are the **rejects** actually bad? | good faces in the reject pile | the gate is too tight; loosen before measuring |
| Are the **keeps** actually faces? | detections that are not people at all — printed or painted faces are faces to a detector, and recur consistently enough to form tidy groups | expected, harmless, and a good reason the interface shows crops rather than counts |

The mirror check runs against the Vision oracle's eye positions — but **only if
you pass `--oracle` to the report**, and the oracle has to have been run first.
It is not automatic and it does not happen by default. A run without it prints
the alignment-residual distribution instead, which is a different and weaker
check: the residual catches a landmark order that disagrees with the *template*,
and cannot catch a mirroring that is consistent all the way through, because a
consistent mirror fits the template perfectly. Look at the crops anyway. This is
the cheapest bug in the project to catch here and the most expensive later.

---

## 3. Guided thing #2 — label faces (you, ~30 minutes)

This is the decisive act of the session. Everything else is arithmetic around it.

```
open tmp/session1/label.html
```

A grid of crops. For each: type a name (autocompletes against the `guests`
table), or `x` for not-a-face, or `?` to skip. Keyboard only, no mouse needed.

**Target: whichever comes first —**

- **enough people with at least 3 faces each to be representative**, or
- **250 labelled crops**, or
- **you get bored.**

Boredom is a legitimate stopping condition. The measurement degrades gracefully;
it just gets noisier. What it cannot tolerate is *only* labelling the easy
frontal crops — so the page presents them in a fixed shuffled order rather than
letting you cherry-pick, because a set of only easy faces produces a flattering
number and a wrong decision.

Prioritise whoever recurs most. The feature is only ever going to be good at
people who appear repeatedly, so those are the people the measurement should be
about.

Writes `tmp/session1/labels.json`. This file is the most valuable artifact of the
whole project — every threshold from here on is tuned against it, and it never
needs to be made again. It is also a list of names attached to faces, so it stays
in `tmp/` and is never committed, quoted or summarised anywhere.

---

## 4. The separation report (me, ~5 minutes)

```
node scripts/vision/session1-report.js tmp/session1
```

Three outputs, in order of what they decide:

**A. Separation.** The distribution of same-person distances against
different-person distances, and how much they overlap. This is *the* number. A
clean gap means grouping will work; heavy overlap means no threshold exists that
is right for everybody, and grouping is the wrong product shape regardless of how
well the code is written.

**B. Grouping quality against your labels**, swept across cutoffs — how pure each
group is and how completely each person is captured, with and without the
cannot-link-within-a-photo constraint, at a deliberately tight cutoff and a loose
one.

**C. Cost accounting** — where the gate rejected faces and how many survived,
and per-stage timing. This is where the runtime numbers in spec §12 stop being
extrapolations.

### What the numbers will probably say

Worth writing the prediction down beforehand so the result is informative either
way. The recogniser's only published benchmark is frontal, well-lit and saturated,
and event photography is none of those, so expect:

- Good separation on the frontal, well-lit subset.
- Poor separation on turned and profile faces, probably bad enough that gating
  them out beats feeding them in.
- A useful fraction of the roster recoverable, not all of it.

If that is roughly what comes out, the feature is real but its honest description
is *"finds the people who are actually in the photographs a lot"* rather than
*"tags everyone."* Which is a fine product, and worth building deliberately
rather than discovering later.

Write the resulting cutoffs into the defaults table. Don't write what they were
measured from anywhere (spec §15, rule 4).

---

## 5. Guided thing #3 — four decisions (you)

The first is the largest fork in the project and the data does not answer it.

### Q1. Is the hand-written implementation the point, or is the feature the point?

The borrowed engine works. It could ship. But it is npm code executing in our
process, which is tier 1 of the dependency rule — the tier we write ourselves.
It is genuinely not analogous to vips: vips is a separate binary over a pipe, and
the rule permitting it says *CLI only, never the request path*. Stretching that
to cover an imported library would be the kind of convenient reasoning this
project has committed to not doing.

So there are two honest projects:

| | **Write it** | **Ship it** |
|---|---|---|
| Effort | ~4–6 weeks of evenings | ~3 days |
| Rule | unchanged | needs a new, written-down tier for "CLI-only npm in a script we never serve" |
| You get | four kernels, a lab, a real answer to "how few dependencies can an app have" | the feature, this week |
| Risk | silent numerical bugs, mitigated by three oracles | none of consequence |

Both are legitimate. The second is not a failure — it is a different answer to
the question the project was actually asking. But it should be a decision with a
paragraph in `CLAUDE.md` behind it, not a drift.

*If unsure:* tier 1 of the ladder (the feature, on the borrowed engine, admin-only)
is worth doing under either answer, and it defers this question by two weeks
without wasting any work.

### Q2. Cluster-and-name, or label-a-few-and-classify?

Report B decides this, and the second option is probably better than the plan
originally assumed. You have a known roster. Confirming a handful of faces per person and then
matching everything against those multi-example prototypes is a strictly easier
and more accurate problem than unsupervised grouping — no single global cutoff has
to be right for everybody, and it degrades gracefully if the descriptors are
mediocre.

Under that framing, grouping's job is only to make the initial labelling cheap,
which means **deliberately over-splitting is correct**: prefer many small pure
groups over few approximately-right ones, because merging is two clicks and
un-welding two people is not.

You have just done the labelling work by hand in §3, so you already know how it
feels. That is the best possible input to this decision.

### Q3. Admin-only forever, or does anything guest-facing use this?

Spec §10 defaults to admin-only: descriptors never reach a guest-facing endpoint,
tags never auto-publish. "Photos of you" for guests is the one feature that would
change that. Default is no. Confirm it, or decide what opt-in would look like.

### Q4. Detection in guest browsers — build it, or leave it to the command line?

Spec §11. It is the prettiest idea in the design and its case has weakened: the
wedding has happened, uploads are declining, and re-running the batch is free.
Against that it ships the kernel library and weights to every guest for a feature
no guest sees, and puts vision code on the public request path for the first
time. Recommendation: no, or much later.

---

## 6. What ships regardless of every answer

So that the evening is not contingent on any decision going a particular way:

- **`labels.json`** — the evaluation set. Never has to be made again.
- **Tuned thresholds** — score, NMS IoU, gate cutoffs, grouping cutoff, replacing
  the reference defaults with numbers that fit your own input.
- **`align.js`, `gate.js`, `group.js`, `metrics.js`, `pixels-cli.js`** —
  first-party, tested, and unchanged by whichever engine runs underneath.
- **An honest answer** to whether the feature is worth building, before four
  weeks are spent on it.
- **Face-aware crops**, available the moment boxes exist, which is the one piece
  of user-visible value that needs no descriptors, no grouping and no identity at
  all.

---

## 7. Ready-check

- [ ] `$PHOTOS` set, and it is the only path anything reads
- [ ] `tmp/` confirmed gitignored; nothing derived from the photographs is staged
- [ ] `brew reinstall x265 vips`, or accept the ImageMagick path
- [ ] Guest roster present in the database for the labelling autocomplete
- [ ] About 90 minutes, of which ~30 are yours
