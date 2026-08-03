# Owner decisions: the vision project's direction

**Date:** 2026-07-31
**Status:** binding. These are the owner's answers, stated directly. No future
session re-litigates a question answered here; if something seems to conflict,
ask the owner — do not reinterpret.
**Reads with:** [`SPEC-vision-lab.md`](./SPEC-vision-lab.md) ·
[`SESSION-4-vision.md`](./SESSION-4-vision.md)

This file exists because the owner answered the project's largest open question
**twice** in conversation and no agent wrote it down, so three days of documents
kept treating it as open. That failure mode ends here.

---

## 1. Q1 — craft or feature? **Both. In that order: feature first, craft after.**

The owner's stated plan, verbatim in substance:

1. **A usable feature, as fast as possible.** The assisted face-tagging feature
   ships now, on the borrowed engine, admin-only. The target was always "working
   this week," not "working after the kernels."
2. **Then weeks of dedicated craft.** After the feature is live and the gallery
   is tagged, the hand-written implementation (spec tiers 2–4, and beyond) is
   the project — pursued for its own sake, ending with the borrowed engine
   deleted.

This is exactly the shape spec §5's ladder was designed for. The borrowed
engine's status is unchanged: **scaffolding with an extended lifetime**, never
imported by anything in the repo, never on the server path, deleted in the
craft phase. The feature the owner uses — database rows, admin Faces tab,
assignment queue — is first-party code throughout. No rule change is required
for this sequencing; what spec §2.1 forbids is shipping the engine as the
*permanent* implementation, and permanence is precisely what the craft phase
removes.

## 2. Why: this repo is part of the owner's work portfolio

The wedding site is a portfolio piece. Both halves serve that: a real,
polished, working feature — and the from-scratch inference work as the
headline craft achievement. Ambition is not to be constrained on either half.
"Simplify for its own sake" is not a goal of this project and never was.

## 3. The population is a census, not a sample

The set of people across the photographs is small, finite, and known to the
owner. Consequences, binding on all measurement work:

- **Labelling is a census to finish, not a sample to extend.** Statistical
  machinery that models labelled people as a draw from a larger population
  (bootstrap intervals over "a re-draw of people," labelling targets
  extrapolated from sampling curves) answers a question this project does not
  have. When labels are complete, every quality question is exact arithmetic.
- The report's UNDECIDED verdict band is an artifact of the sampling frame,
  not a fact about the feature.
- Per the standing rules, no count measured from the photographs appears in
  this file; the point is the *finiteness*, which the owner attests directly.

## 4. Sequencing constraint learned the hard way

Labels join to a detection set; detection-configuration changes (channel
order, resolution) orphan them. Therefore, in order:

1. Settle the detection configuration (the channel-order comparison against
   the independent oracle — both runs already exist).
2. Make labels portable across detection sets (re-key by content hash + box
   overlap), so this class of catastrophe is retired rather than guarded.
3. Finish the labelling census, once, against the settled configuration.
4. Ingest for real, tag the gallery in the Faces tab, wire the results into
   the product surfaces that already exist (memory book, thank-you cards,
   sunset archive — owner to choose which).
5. Craft phase begins.

## 5. The recogniser: the incumbent stays, and mirror-averaging is off

**Decided 2026-08-03.** SFace 128-d ships, mirror-averaging off. The 512-d
challenger (AuraFace / glintr100) does not replace it.

Read the outcome correctly: the challenger was **not** worse. It led on both
metrics. It led by less than the margin the decision rule named in advance, and
"a margin under the bar keeps the incumbent" is that rule's default branch — so
this is a decision, not a deferral. Resolving a near-tie by looking at the
numbers again is precisely what predeclaring a margin prevents. Mirror-averaging
lost on both models and is off regardless of which one ships.

`model_version` for ingest is `sface128-n127.5d128-nomirror`.

**The method, to re-derive locally.** No measured figure appears in this
repository (rule 3); everything below regenerates from a local run in minutes.

1. Re-describe one detection run's existing crops under each of four variants —
   both models, each with and without mirror-averaging — with
   `scripts/vision/redescribe-crops.js`. Crops, boxes and face ids are untouched
   by a recogniser change, which is what makes the labels stay valid.
2. Score them with `scripts/vision/compare-models.js`, which implements the
   predeclared rule and decides nothing on its own: top-1 prototype-suggestion
   accuracy on a within-person frame-grouped split with a per-person cap, plus
   group purity at each model's own cutoff derived on person-disjoint folds it
   is not scored on.
3. The rule itself — metrics, margin, the spread condition, the no-decision
   default, and five dated amendments including one that is post-hoc and says so
   — is `decision-rule-phase2.md` in the owner's private artifact repository,
   alongside the results. It is not in this repository because it sits next to
   measurements.

**One finding that outlives the comparison, because Phase 4 depends on it:** in
neither descriptor space does any swept cutoff separate this cast without welding
two people together. That is a property of the photographs and the cast, not of
the recogniser, so routing and grouping work must not assume a clean cutoff
exists. Re-derive it from the sweep table in `scripts/vision/session1-report.js`'s
output — the `welded` column, over every cannot-link point.

## 6. Open questions that remain genuinely open

Recorded so they are asked, not assumed:

- Which product surfaces get the tags first (memory-book chapters,
  thank-you-card photo suggestions, archive index, opt-in "photos of you")?
- Video: in scope for the craft phase, or a recorded non-goal?
- The roster gap: labelling used free-typed names; the `guests` table holds
  parties, not people, and non-guests (photographer, vendors) appear in
  photographs. How identities link to roster rows is undecided.
- How far the craft phase goes beyond re-implementation (e.g. training on the
  owner's own labels with hand-written backpropagation) — raised 2026-07-31,
  unevaluated, explicitly not dismissed.
