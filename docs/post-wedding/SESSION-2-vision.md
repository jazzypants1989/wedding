# Session 2: what session 1 actually established, and what to do next

**Date:** 2026-07-30
**Status:** decision document. Supersedes [`SESSION-1-vision.md`](./SESSION-1-vision.md) §5.
**Reads with:** [`SPEC-vision-lab.md`](./SPEC-vision-lab.md) (the build spec, §15 =
the rules that govern running any of this) · [`VISION-MODELS.md`](./VISION-MODELS.md)
(the model ledger, whose §Stale rejections was written from this review)

Session 1 ran. The pipeline works, the code is sound, and the feature is real.
The *report* about it drew three conclusions its own numbers did not support, and
this document exists because two of those conclusions were about the product
shape rather than about a detail.

---

## 0. Read this before you read anything else

**No number measured from the photographs appears in this document, and none may
be added to it.** `CLAUDE.md` ("Photographs Are Input To Code, Not To A Reader",
rule 4) and spec §15 rule 4 make this a constraint, not a preference: face
counts, pose and sharpness distributions, per-person accuracy and separation
scores are all facts about identifiable people, and this repository is public.

That shapes what this document can be. It cannot tell you what the answers were.
It tells you **what to run, what to look at, what each number means, and which
readings are traps.** The numbers live in `tmp/`, they regenerate in minutes, and
they are deleted when you are done.

The one carve-out that already exists: a *tuned constant* may live in
`public/vision/defaults.js` with no note of what was measured to arrive at it.
See §5 for why nothing has been written there yet, and the rounding rule that
applies when something is.

**Everything below is admin-side and local.** Nothing is served, nothing is
committed, nothing leaves the machine.

---

## 1. What exists now

### Shipped, first-party, tested, model-agnostic

| Module | Does |
|---|---|
| `public/vision/align.js` | five landmarks → similarity transform → 112×112 bilinear crop |
| `public/vision/gate.js` | measures nine quality signals (`gateSignals`) and separately decides (`applyGate`) |
| `public/vision/group.js` | average-linkage grouping, cosine distance, cannot-link-within-a-photo |
| `public/vision/metrics.js` | separation, grouping quality, leave-one-out prototype rank-1 |
| `public/vision/detect.js` | scale-back-to-source and post-NMS duplicate removal |
| `public/vision/frame-hash.js` | perceptual hash for near-duplicate frame detection |
| `public/vision/defaults.js` | every tunable in one table, reference values only |

All pure numeric JavaScript. No `node:*`, no DOM — enforced by
`public/tsconfig.json` declaring no node types, so a `node:` import fails
`npm run typecheck`. None of it cares which engine computes descriptors
underneath, which is what makes every decision in §4 reversible.

### Tooling

`scripts/vision/` — `session1.js` (the batch), `session1-report.js` (the
analysis), `label.html` (the labelling page), `relabel-data.js` and
`context-crops.js` (regenerate labelling inputs without re-detecting or
renumbering face ids), `contact-sheet.html`, `pixels-cli.js`, `png-write.js`,
`inspect-onnx.js`, `verify-weights.js`, `oracle-macos.swift`.

### Not built

- `scripts/vision/fetch-weights.js` — spec §3. `verify-weights.js` checks a
  weights directory against the ledger; nothing fetches. Weights currently live
  in `tmp/weights/`, not `public/vision/weights/`. This is tier 2 and correctly
  not started.
- Anything from tiers 1 and 3–7 of the spec's ladder.
- **The activation-dumping tool.** See §6 — it is the missing prerequisite for
  the entire hand-written-kernel path and it is on no ladder rung.

### Verified clean

`npm run typecheck` passes both configs. `npm test` passes. No regex anywhere in
the vision code. Nothing derived from the photographs is tracked by git —
`tmp/` is ignored and `defaults.js` still holds only published reference values.
**The privacy discipline held under a full review.** Keep it that way.

---

## 2. The three conclusions that were wrong, and why each mattered

This section is the reason the document exists. Each of these is now either
fixed in code or flagged loudly by the report itself, but a fresh agent needs to
know the *shape* of the mistakes, because all three are easy to reintroduce.

### 2a. A figure was quoted from a population, and a conclusion drawn about another

The report's headline verdict rested on the separation score measured **after**
the recommended gate — that is, on the faces that survived a filter chosen to
maximise that very score. The `kept` count printed on the same line belongs to a
*different* statistic (rank-1, over all labelled faces), so the row reads as
though the separation figure rests on far more evidence than it does.

The honest ungated figure and the gated figure fall in **different buckets of
`verdict()`'s own ladder** — one reads as a strong result and the other as
"grouping is the wrong product shape." Same photographs, same code. Which
sentence prints is decided entirely by the gate.

**What to do:** read the separation figure and its pair counts together, always.
`--verbose` prints them. Treat any AUC computed from a small number of
same-person pairs as a direction, not a measurement.

**Still outstanding (P1):** `verdict()` has hard-coded thresholds (0.98 / 0.90 /
0.75) that turn a number into an English conclusion, and `MIN_STRATUM_PAIRS` is
10 — far too permissive to justify a confident headline. It should refuse to
print a confident verdict below a much larger pair count, and should say
"undecided, label more people" instead.

### 2b. The grouping sweep ran on a population nothing groups — and it flipped the product recommendation

The report swept grouping cutoffs over **every labelled face, including all the
ones the gate exists to discard**, found no cutoff that welded nobody, and
concluded in alarm markers that *"unsupervised grouping has no safe operating
point here"* — recommending per-person prototypes on the strength of it.

Grouping runs **after** the gate. A sweep over ungated faces measures a
configuration that nothing ships.

**Fixed.** `analyse()` now runs the sweep once per gate configuration and prints
a population table; the verdict now takes its weld-free judgement from the
population a shipped pipeline would actually group. The old ungated warning
still prints, now explicitly labelled as being about a population nothing groups.

**How to read it.** Purity and completeness are comparable across the rows. Weld
counts are **not** — fewer faces means fewer chances to weld, so a falling weld
count across rows is partly an artifact. If purity and completeness both improve
as the gate tightens, the gate is earning its place. If only the weld count
moves, it is not.

**What this does *not* settle.** Prototypes may still be the better shape. They
need no global cutoff, they degrade gracefully, and they can say "I don't know,"
which grouping cannot. The point is that the reason previously given for
choosing between them was not evidence. See §4a.

### 2c. Rank-1 was blended across two labelling routes, one of which is contaminated

`label.html` presents **pool A** one crop at a time and **pool B** as a whole
detector group assignable in one keystroke. That is a good design — it is what
makes labelling fast enough to finish. But it means pool B's labels are partly a
function of the model's own grouping, by construction. A second effect points the
same way: working through groups labels the tidy ones first, so stopping when
bored (an explicitly sanctioned stopping condition) leaves the awkward tail
unlabelled.

Report C blended both pools into one figure, which is therefore carried by
whichever pool is larger — and that is always pool B, because pool A is capped at
`--pool-a` (default 150) while pool B is everything else.

**Fixed.** Report C now prints pool A, pool B and the blend separately, marks
pool A as the one to quote, and raises an explicit warning when pool B scores
higher — which is the signature of the labelling route rather than of the
recogniser.

**How to check the tail-bias directly.** Compare the gate signals of labelled
against unlabelled pool B faces. If the labelled ones are systematically easier
on every axis, the unlabelled remainder is the hard tail and the blended figure
is measuring the easy half of the problem. This is about twenty lines against
`loadRun` and `face.signals`; it is not part of the report yet, and adding it is
a reasonable P1.

---

## 3. Bugs found and fixed, with the ones that will come back

Four had regression tests added in `tests/unit/vision-report.test.js`.

**1. Timing shares were roughly halved.** `timing.stages` contains a `total`
entry *alongside the stages it is the total of*, and the report summed the whole
object — adding the run to its own parts. Every printed share was against a
doubled denominator, and so was the priced cost of raising detector resolution,
which made an expensive change look affordable. **That is the wrong direction for
a cost error to point.** Fixed via `stageBreakdown()`, which every consumer must
now go through. Tested.

**2. The oracle joined photographs by basename.** Deliveries repeat the same
basename across folders — which is *why* the run deduplicates — so the join
silently handed one photograph another photograph's faces, and every
disagreement it caused read as a fault in our detector. Now joins on full path
suffix, refuses ambiguous matches, and counts them. Tested.

**3. The mirror check the plan promised did not exist.** `SESSION-1-vision.md`
claimed it "runs automatically against the Vision oracle's eye positions." It did
not: `oracleSummary` compared boxes only and never touched the eye centroids the
oracle already emits. Now implemented. The session-1 doc has been corrected.

**4. `--oracle` was never passed.** The oracle output existed on disk and the
report was never given it, so it printed "unverified against an independent
detector" while the verification sat in the next file along. **Always pass
`--oracle`.**

### ⚠ The trap in the mirror check, which was fallen into twice in opposite directions

macOS Vision names eyes from the **image's** point of view. Our landmark order
names them from the **subject's**. The same physical eye carries the opposite
word.

Comparing name to name reports that essentially every face is mirrored.
"Correcting" that by inverting the comparison reports essentially every face
mirrored *again*, the other way. **Neither is a fact about the pipeline**, both
look like a catastrophe, and both were produced during this review — once in a
scratch probe and once in the shipped code, which then printed a confident
"LANDMARK ORDER IS MIRRORED, fix this before anything else."

The fix, and the rule: **trust neither source's vocabulary.** Anchor ours by
order (columns 4–5 are the subject's right eye, per the detector's own decode
comment) and theirs by geometry (whichever point is further left in the frame).
Then score both pairings by distance and let the closer win, which also stops a
rolled head being counted as a mirror. There is a test asserting both directions.

The general lesson, which is worth more than the specific bug: **a check that can
fail loudly in two opposite ways, for a reason unrelated to what it measures, is
worse than no check** until it has a test pinning both directions.

### Two things the residual check cannot do

The alignment residual is a good check and it is not the mirror check. It catches
a landmark order that disagrees with the **template**. It cannot catch a
mirroring that is consistent all the way through, because a consistent mirror
fits the template perfectly. Only a second detector's eyes see that. This is why
`--oracle` is not optional.

---

## 4. The four decisions, restated with what is now known

### 4a. Q2 — grouping, or prototypes?

**The evidence previously given was invalid (§2b). The question is open again.**

**Recommendation: both, in that order, and stop treating them as rivals.**
Grouping's job — which spec §6.4 already argues — is to make the *first*
labelling pass cheap. Set the cutoff deliberately tight so it over-splits into
many small, very pure piles; name those fast; the confirmed faces become
per-person prototypes; prototypes then handle the long tail, with an "unsure"
route for the ambiguous.

That is not a compromise. Over-splitting costs clicks to merge; welding two
people is expensive to notice and annoying to unpick. The asymmetry is the whole
argument, and it is why the two techniques compose rather than compete.

### 4b. The gate: filter, or router?

**This is the decision that most changes the product, and it was never posed.**

Every gate cutoff is chosen by maximising separation and rank-1. Both rise
monotonically as faces are discarded. The degenerate optimum keeps one clean face
per person and scores nearly perfectly while tagging almost nothing. The only
restraint in the code is `GATE_JOINT_MIN_KEPT_FRACTION` — a floor, which is a
leash and not a price.

**Fixed in the report:** a coverage table now prices every configuration in
**person-in-a-frame appearances** (one labelled person in one distinct frame,
duplicate frames collapsed). That is the honest unit: a person is tagged in a
photograph if *any* surviving face carries them, so a dropped face is not tagged
wrongly — it is not tagged at all, and the photograph silently loses that person.

**Recommendation: three buckets, not two.** All nine signals are continuous, and
collapsing them to pass/fail throws away the information that says *how*
confident to be:

- **auto-tag** — high confidence, no human step;
- **ask** — the system offers its best guess, one keystroke to confirm or reject;
- **set aside** — too poor to be worth a question. Still croppable, just not
  identified.

A binary gate is the special case where two buckets are empty. Spec §6.2 now
records this.

**Where I think this proposal is weakest, and how to fix it:** the middle bucket
has a cost, and if it is large you have recreated exactly the labelling grind
that ended session 1. So it is only a good design if the queue is **ordered by
what answering unlocks** — resolve the face that would attach a name to the most
photographs first — and if it is **abandonable at any point with partial value
retained.** A queue that must be finished to be worth anything is a worse product
than a filter. Build the ordering with the queue, not after it.

### 4c. Q1 — hand-written kernels, or ship the borrowed engine?

**Still open, and nothing found in this review bears on it much.** It is a
question about what you want to build, not about whether the feature works.

What *has* changed is that the honest description of the outcome is known: this
finds the people who appear repeatedly and asks about the rest. That is a good
product. It is not "tags everyone," and the interface should say so.

If the answer is "ship it," spec §2.1 requires a deliberate paragraph in
`CLAUDE.md` establishing a new tier for CLI-only npm in a script that is never
served. That is a legitimate decision. It must not be a drift.

**See §6 for the prerequisite nobody has built**, which changes the effort
estimate for the hand-written path more than anything else in this document.

### 4d. Q3 and Q4 — guest-facing, and in-browser detection

Unchanged. Admin-only stands (spec §10). In-browser detection stays near the top
of the ladder.

⚠ **But note the second-order effect:** Q4's "no" is what retires the file-size
constraint that disqualified AuraFace. See §5b. A decision to revive tier 6 would
revive that constraint with it.

---

## 5. The models

### 5a. Is the recogniser the limit? Mostly no — and there is a negative result

Three things point the same way, and the third is the useful one.

**Performance tracks input quality closely.** Run the report and compare the
separation figure ungated, at the shipped defaults, and at the recommended gate.
The three rows are in the same table. Given clean, frontal, sharp, adequately
large faces, this recogniser is not the bottleneck.

**A learned linear correction does not help.** The obvious move for a fixed
domain — everyone under one venue's light, one set of cameras, one day — is to
learn a transform from the labelled faces that stretches the descriptor space
where people differ and squashes it where one person varies (mean-centring,
then within-person covariance whitening with shrinkage). Fitted on training
people and scored on held-out people, **this produced no useful gain**; plain
centring was actively worse.

That is worth recording precisely because it is the thing a fresh agent will
propose. It is ~120 lines including a Jacobi eigensolver, it is pure arithmetic
with no dependencies, it is entirely first-party — and on this input it does
nothing. **The signal that is missing is not one linear transform away.**

**Therefore the limit is input quality, not the descriptor.** Which is why §5c
and §5d rank above a model swap.

### 5b. Two rejections in the ledger have expired

Written up in full in [`VISION-MODELS.md`](./VISION-MODELS.md) §Stale rejections.
In brief:

- **AuraFace was disqualified on file size alone** — a constraint that only bites
  if the model ships to guests' browsers, which Q4 recommends against. What
  survives the objection is Apache-2.0 and *fewer* op types than the incumbent,
  making it cheaper to hand-write. **Re-parse it with `inspect-onnx.js` before
  believing any of that** — the op count is upstream's claim, not ours, and this
  project's rule is that unverified structural claims are worth nothing.
- **LFW cannot distinguish modern recognisers.** It has been saturated for a
  decade. IJB-C is the benchmark with discriminating power on in-the-wild input,
  and the ledger has no IJB-C figure for the incumbent. The comparison was run on
  the axis that cannot see a difference.

**And the choice is two choices.** Under a borrowed runtime the recogniser is a
registry entry, so take the most accurate one. Under hand-written kernels the
op-type count *is* the project.

### 5c. The A/B rig you already own

A session-1 run leaves aligned 112×112 crops and a label file behind. Every
candidate in the ledger uses the same five-point template, so **those crops are
directly reusable**: point a different recogniser at them, re-run report C,
compare on identical faces and identical labels. No re-detection, no re-decoding,
**no new labelling.** Roughly an hour.

This is what spec §5 meant by calling the evaluation set the most valuable
artifact of the project, and it has not been used this way yet.

**Three ways to get this A/B wrong:**

1. **Run it on gate-passing crops only.** That measures which model is better on
   easy faces, which is the question nobody is asking. Run it on *all* crops —
   the differences live in the tail.
2. **Compare blended rank-1.** Use pool A (§2c), or you are comparing two models
   on contaminated labels.
3. **Assume the template transfers.** It does for the ledger's candidates, but
   confirm from the pack metadata, not from a README. If a candidate wants a
   different template, its crops must be regenerated from the stored landmarks,
   which needs the source photographs and therefore a full re-run.

### 5d. Alignment headroom — probably worth more than a model swap

The report now prints how far our eye positions sit from the oracle's, as a
fraction of the subject's own eye separation (scale-free, so large and small
faces contribute comparably). Neither detector is ground truth, so this **bounds
headroom rather than blaming either.**

It matters more for this recogniser than for most: its head flattens a 7×7 grid
instead of pooling it, so it has no translation invariance at the end and a crop
off by a few pixels shifts every one of 50,176 inputs to the final layer. Spec
§6.2 makes the same point.

**Look at whether the disagreement concentrates in turned faces** — the ones the
gate discards. If it does, some of the coverage the gate throws away may not be
un-recognisable faces so much as **badly-aligned** ones, and that is coverage
recoverable without touching the recogniser.

**Where this proposal is weakest, and it is weaker than it first looks:**

- **`oracle-macos.swift` currently emits only the two eye centroids.** The
  alignment template needs five points — two eyes, nose tip, two mouth corners.
  Vision computes 76 landmarks and the oracle reports only the count. So
  "re-align from the oracle's landmarks" is **not free**; it needs the Swift tool
  extended first. Small, but not zero, and it is the first thing to do if this
  path is taken.
- **It risks an architectural divergence.** Tuning the batch against Apple's
  landmark quality means the hand-written detector (tiers 3–4) would later have
  to match it, or the pipeline regresses when our detector is swapped in. Under
  spec §8.2 the oracle is explicitly *not a fallback* and must never be on a code
  path the app depends on.

So treat this as an **experiment that bounds headroom**, not as a shipping
proposal. If it shows a large gain, the right response is probably "improve our
own landmark handling, or feed the recogniser better crops," not "depend on
Apple."

### 5e. Untested and cheap

- **Mirror averaging** (`describe.mirrorAverage`, spec §6.3): describe each crop
  and its mirror, average before normalising. Costs 2× the describe stage.
  Plausibly worth more here than usual, for the same position-sensitivity reason
  as §5d. **And it can be tested from the existing crops** — mirror them, run the
  engine, average — without re-decoding any photographs. Minutes, not an evening.
  The report already A/Bs it whenever mirror descriptors are present.
- **Detection resolution.** The report's recommendation to detect at the larger
  edge rests on a comparison run over a small subset of the batch. Widen it
  before paying for it, and note the true cost is now correctly priced (bug 1).

---

## 6. ⚠ The missing prerequisite for the hand-written path

**`tmp/rig/engine.mjs` returns only the models' final outputs** — boxes,
landmarks, and the descriptor. Spec §8.1's entire verification strategy is
"implement one layer at a time and assert against the borrowed engine's
*intermediate* activations to a tolerance." Those intermediates are not
obtainable from the engine as it stands.

Getting them means **editing the model file to expose intermediate tensors as
graph outputs.** `inspect-onnx.js` only reads that format; nothing in the project
writes it.

So there is a tool — call it `scripts/vision/expose-activations.js` — that is:

- **not on any rung of the spec's ladder**, and
- **load-bearing for tiers 3 and 4 in their entirety.**

Without it, "check each layer against the oracle" is not available, and the
mitigation the whole hand-written plan is organised around does not exist. Spec
§8 says hand-written inference *"fails silently and numerically"*; the plan for
that is layer-by-layer comparison; the tool for that has not been built.

**Estimate it before committing to a schedule.** It is probably half a day. If it
turns out hard, that is a material fact about the four-to-six-week estimate, and
better learned first than in week three.

Two traps already documented, repeated here because they will be hit:

- **Dump reference activations from the same file you ship.** Block-dequantised
  weights are not bit-identical to the float file's, and mixing them produces
  real per-layer deviations indistinguishable from your own bug.
- **The block-quantised recogniser cannot be run by a stock runtime as
  distributed** — it declares 30 required graph inputs. Use the float file for
  the oracle. Our own converter reads initializers straight from the protobuf and
  is unaffected.

---

## 7. What to do next

Ordered. Each step is independently valuable and none blocks the others except
where stated.

### P0 — the estimate everything else is designed against

**Extend pool A and label the extension.** Every honest figure in this project
rests on pool A, which is capped at 150 by default. That is a thin base for
designing a review queue, and the confidence interval on it is wide.

The clean way: **draw more faces into pool A uniformly from those not already in
it, and label them one at a time.** Sequential uniform sampling without
replacement is still uniform, so pool A stays an unbiased sample of the whole run
and the existing labels stay valid. Do *not* draw only from the unlabelled
remainder and merge — that is a sample from a harder population and combining
them naively is wrong.

Check whether `relabel-data.js` supports growing pool A without renumbering face
ids. **Face ids are the join key for labels; renumbering them destroys the
labelling.** If it does not support it, that is the work.

Roughly twenty minutes of labelling. It improves the *estimate*, not the system —
but every decision below is a choice between numbers.

### P0 — finish the report corrections

- Make `verdict()` refuse a confident headline below a serious pair count (§2a).
- Re-run with `--oracle`. Always.

### P1 — settle the model question cheaply

- Re-parse AuraFace with `inspect-onnx.js`. Confirm or refute the op-type claim,
  extract normalisation constants, template and output width (§5b).
- Run the A/B on existing crops, all crops, pool-A metric (§5c).
- Test mirror averaging from existing crops (§5e).

### P1 — bound the alignment headroom

- Extend `oracle-macos.swift` to emit nose tip and mouth corners (§5d).
- Re-align gate-rejected faces from those landmarks, re-describe, re-measure.
- **Read the result as headroom, not as a shipping plan.**

### P2 — build the feature (spec tier 1)

On the borrowed engine, admin-only, with the three-bucket router of §4b and the
grouping-then-prototypes flow of §4a.

Two things ship the same week and need no identity at all: **face-aware
cropping** (thumbnails that do not decapitate people) and **"photographs with
people in them"** as a filter. Both work from boxes that already exist. If
everything else stalls, these are real user-visible value with none of the
remaining risk.

### P2 — decide Q1 deliberately

Estimate `expose-activations.js` first (§6). Then choose, and write the paragraph.

---

## 8. Three signals the pipeline records and completely ignores

Offered as the most promising unexplored direction, because they exploit
structure specific to *this* problem that no general-purpose recogniser has.
They help exactly where the descriptor is weakest — the hard tail — and they cost
almost nothing, because the data is already on disk.

**1. Co-occurrence.** People at a wedding cluster socially. If an unidentified
face repeatedly shares frames with a confirmed person, that is real evidence
about who it is likely to be — a prior over identities conditioned on who else is
in the photograph. A co-occurrence matrix over confirmed identities is a few
lines, and it is orthogonal to the descriptor rather than a refinement of it.

**2. The roster already encodes households.** The RSVP system knows parties and
invitations — who came together. People in one party appear together. That is a
free prior over co-occurrence that needs no learning at all, and no other face
pipeline in the world has it.

**3. Temporal locality.** `photos.jsonl` records capture time. Someone present in
one minute is overwhelmingly likely to be present in the next. For a face the
descriptor cannot resolve, "who was in the adjacent frames" is a strong prior.

The cannot-link-within-a-photo constraint (spec §6.4) is the same *kind* of idea
— cheap structural knowledge beating descriptor quality — and it is already the
single most effective constraint in the grouping code. These three are its
natural continuation, and clothing colour (spec §6.4, tie-breaker only) is a
fourth that is already specified but not built.

**The caution that applies to all of them:** they are *priors*, and a prior that
is allowed to override the evidence will confidently mislabel the people who
moved between groups during the day. Use them to **order suggestions and to flag
a proposed merge as suspicious** — never to decide. Spec §6.4 already draws that
line for clothing colour; it applies unchanged here.

---

## 9. Standing rules for whoever picks this up

1. **`$PHOTOS` is always an argument.** Nothing searches for photographs.
   `scripts/hooks/no-photo-snooping.js` enforces it as a `PreToolUse` hook and
   will block a command that looks like a library sweep. If it blocks something
   legitimate, that is a conversation with the owner, not a hook to work around.
2. **Nothing opens a photograph or a crop to look at it.** Code processes pixels;
   nothing describes them. Aggregate numbers answer every design question here.
3. **Everything derived is `tmp/`,** gitignored, deleted when done. It
   regenerates in minutes.
4. **No measurement from real photographs enters any file in this repository** —
   not scene descriptions and not statistics. A tuned constant may live in
   `defaults.js` with no note of what produced it.
5. **When you do write a tuned constant, round it hard.** A cutoff carried to
   five significant figures *is* a percentile of a private distribution written
   down precisely. `0.22`, not `0.22011`.
6. **Nothing has been written to `defaults.js` yet, deliberately.** Some of the
   report's recommended cutoffs are not quality measures at all — a
   minimum-distance-from-the-frame-edge cutoff measures whether someone was the
   subject of the photograph rather than whether their face is usable, and an
   alignment-scale cap is a minimum face size in disguise (which is why the
   explicit box-size cutoff earned nothing on top of it). They will help on the
   input they were fitted to and will not transfer. Re-derive after the P0 work,
   then round, then write.
7. **Re-read spec §15.** Nothing in a research, measurement or "get real numbers"
   instruction relaxes any of it.
