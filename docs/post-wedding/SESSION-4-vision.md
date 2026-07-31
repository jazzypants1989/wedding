# Session 4: a run was destroyed, and what made it recoverable

**Date:** 2026-07-31
**Status:** recovery record + standing rules. Adds to
[`SESSION-3-vision.md`](./SESSION-3-vision.md); supersedes nothing.
**Reads with:** [`SPEC-vision-lab.md`](./SPEC-vision-lab.md) §15 (working rules,
now with a fourth durable artifact) · [`VISION-MODELS.md`](./VISION-MODELS.md)
(§Verified preprocessing gained the detector's channel order, which was missing)

An assistant session deleted the session-1 run directory, the borrowed engine's
wrapper, and the downloaded weights. The owner had already backed up
`labels.json`, which is the only reason the labelling survived. This document
records how the run was rebuilt from that one file, because the method
generalises and because the same loss will otherwise cost the same search twice.

As always: **no number measured from the photographs appears here**, and none
may be added. Face counts are named by rule 4 explicitly. What follows is
method.

---

## 1. What was lost, and what that cost

| Lost | Recoverable by | Cost |
|---|---|---|
| `faces.jsonl`, `photos.jsonl`, `crops/`, `label-data.js`, `timing.json` | re-running the batch | minutes of compute |
| `tmp/rig/engine.mjs` — the borrowed runtime's wrapper | rewriting it | hours, plus a parameter search |
| `tmp/weights/*.onnx` | re-downloading against the ledger | minutes, and `verify-weights.js` proved the new copies byte-exact |
| `labels.json` | **nothing** | it does not regenerate |

The first and third rows are why SPEC §15 rule 3 calls derived data scratch, and
that judgement held. The second row is the one the rules had not anticipated,
and §4 below fixes it.

**The join is all-or-nothing.** `labels.json` maps a face id to an identity
string and carries no photograph reference and no box. Face ids are sequential
counters over scan order, so a re-run that differs anywhere shifts every id
after the divergence. Either the detection set is reproduced exactly and every
label is valid, or none of them are. There is no partial recovery and no fuzzy
re-join — which is precisely why `datasetId` exists and why SESSION-3 made
`loadRun` refuse on mismatch. That refusal is what turned a silent catastrophe
into an afternoon.

---

## 2. The recovery, which is four checks of increasing strength

The useful discovery: **`labels.json` records the pool assignment of every
face, not only of the labelled ones** — and pool assignment is a pure function
of the face count, the shuffle seed and `--pool-a`. So a substantial part of a
lost run's configuration is solvable **offline, from the label file alone, with
no photograph read and no compute**.

1. **Face count and `--pool-a`, solved by replaying the seeded shuffle.**
   `assignPools` is exported and deterministic, so candidate `(faceCount,
   poolASize)` pairs can be replayed until one reproduces the recorded pool-A
   set. Sweeping neighbouring face counts showed **no other count within ±40
   reproduces it**, so the recovered count is a hard, single-valued constraint
   on the detection configuration — checkable at the end of a candidate run's
   detect stage, before a single descriptor is computed.
2. **Pool-A membership**, as a guard against a count matched by coincidence.
3. **`datasetId`** — the digest over every face's id, photo id and box at two
   decimal places. This is the exact join check, and it proves the **detector**
   was reproduced.
4. **The pool-B group partition**, also recorded in `labels.json`, compared as
   an unordered partition rather than by group id. Descriptors do not enter
   `datasetId`, so a wrong embedder configuration would satisfy checks 1–3
   perfectly and quietly corrupt every number the report then produced. This
   check is the only surviving evidence about the **recogniser**, and it is what
   makes the recovery trustworthy rather than merely plausible.

Checks 1–4 live in `tmp/recovery/check-run.mjs` (scratch; rebuild from this
description if it is gone). It is worth writing its self-test again too: it
asserts that an identical run passes, that a half-pixel box shift fails, that a
missing face fails, and that a run with identical boxes but a different grouping
fails. A verifier that cannot fail is not a verifier.

### The search, done in one pass rather than five

A rewritten wrapper has free parameters the ledger does not pin. Searching them
by re-running the batch per candidate would have cost a run each. Instead:
**decode each photograph once, run the detector once per channel order, and
price every candidate scoring rule from those same forward passes.** Decoding
dominates the batch — everything downstream of it is arithmetic over cells
already computed — so widening the search from two hypotheses to ten cost
nothing. One pass identified the configuration exactly.

Generalises to: **when searching for a lost configuration, separate the
expensive shared prefix from the cheap varying suffix, and pay the prefix
once.**

---

## 3. What the search turned up, which is a real finding

**The engine feeds the detector RGB. OpenCV's reference implementation feeds it
BGR.**

`FaceDetectorYN` calls `blobFromImage` with `swapRB` defaulted to false on a Mat
that OpenCV decoded as BGR, so the reference network receives BGR. A wrapper
that passes this pipeline's `RgbImage` straight through — which is the natural
thing to write, and what the original engine did — feeds RGB. Those are
different inputs to a trained model and they produce different detections, in
quantity and in position.

Three things follow:

- **The ledger had a hole.** `VISION-MODELS.md` documented the *recogniser's*
  channel order explicitly (`swapRB=true`, so the network receives RGB) and said
  nothing about the detector's. Now recorded, along with a re-verification step.
- **Which order is correct here is unresolved.** More detections is not better
  detection; the extra ones may be false positives. `oracle-macos.swift` is the
  instrument that can answer it — an independent detector over the same frames,
  compared under both orders. That experiment has not been run, and it is
  cheap.
- **This is exactly the failure class SPEC §8 is organised around.** It produces
  plausible output and no error. It went unnoticed through an entire session
  because nothing compared the pipeline against the reference on this axis.

⚠ **Do not "fix" this by switching to BGR before running the oracle
comparison.** Switching changes the detection set, which changes every face id,
which orphans the labels again. If BGR turns out better, that is a decision to
re-detect and re-label deliberately, not a one-line change.

### The general form of that warning, which is larger than the channel order

**Any change to a detection parameter orphans every label.** Face ids are
positions in a detection set; the set is a function of the detector's input and
configuration; the labels join by id alone. So all of these are label-orphaning
changes, not tuning knobs:

- the channel order fed to the detector;
- `--detect-edge` and `--source-edge` — **including the higher detection
  resolution the report itself recommends**, which is the live trap, because the
  recommendation appears in the same block as the gate cutoffs, and the gate
  cutoffs are safe to change and this is not;
- the score threshold, the suppression cutoff, the post-suppression duplicate
  cutoff;
- adding, removing or renaming photographs in the source directory.

Gate cutoffs, grouping cutoffs and anything in `assign.js` or `confidence.js`
are all downstream of the face records and change nothing about the join. That
is the line: **upstream of `faces.jsonl` orphans the labels; downstream of it is
free.** A parameter that crosses the line needs a deliberate decision to
re-label, and `check-run.mjs` is what tells you which side you landed on.

---

## 4. Standing rules, added to SESSION-2 §9 and SPEC §15

1. **A run's `timing.json` is not scratch.** It is the only durable record of
   how a run was made — detection resolutions, `--recursive`, `--mirror-tta`,
   `--pool-a`, the image backend and version, and the engine's own
   identification. Losing it is what turned a one-command re-run into a
   parameter search. `labels-backup.js` already copies it when present; make
   sure it is present.
2. **`engine.info()` must encode every free parameter the wrapper has**, not
   just the model filenames. The rebuilt engine reports its channel orders and
   its top-K stage in the runtime string, so `timing.json` now records them.
   This is what makes rule 1 sufficient rather than merely reassuring. A new
   knob that does not appear in `info()` is a knob that will have to be searched
   for.
3. **The engine wrapper is scaffolding, but it is not reproducible from
   memory.** It stays out of the repository — no module may name it, or the
   dependency graph stops being honest (SPEC §2.1) — so keep a copy wherever
   the labels are backed up. It is a small file and it costs a search to
   reconstruct.
4. **`labels.json`'s `pool` and `group` maps are forensic evidence, not just
   labelling state.** They pin a lost run's face count, its pool size, and the
   behaviour of its recogniser. Anything that rewrites that file should preserve
   both, in full, for every face rather than only the labelled ones.

---

## 5. Where the project stands

The reproduced run passes all four checks, the labels are attached to it, and
the report runs against them unchanged. Nothing about the pipeline changed;
this session restored a position rather than advancing one.

The report's own verdict is **UNDECIDED** — its person-level bootstrap interval
spans one of its verdict bands, so a re-draw of which people happened to get
labelled could move the headline. That is the report working as SESSION-3 built
it to. It prints the number of additional labelled people that would close the
interval; **that number, not a feeling, is the labelling target**, and it
shrinks fastest if the new people recur across the day.

Two things follow, and they are the same two SESSION-2 §7 listed as P0:

- **Label more people**, to the printed target, via `relabel-data.js --pool-a N`
  — which grows pool A as a verified prefix extension of the same seeded
  shuffle, so every existing label stays valid.
- **Run the report with `--oracle`.** It has still never been passed. Without
  it the mirror check does not run, and the alignment residual is not a
  substitute — it cannot see a mirroring that is consistent throughout. The
  oracle now has a second job as well: settling §3.

**Still do not write tuned cutoffs into `defaults.js`.** SESSION-2 §9 rule 6
deferred that until after the labelling, and the verdict being UNDECIDED is
exactly the condition that rule was written for. The report's recommendations
also continue to include the two cutoffs SESSION-2 flagged as measuring
something other than face quality — distance from the frame edge measures
whether someone was the *subject* of the photograph, and an alignment-scale cap
is a minimum face size in disguise. Re-derive after labelling, round hard, then
write.
