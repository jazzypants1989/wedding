# Owner decisions: the vision project's direction

**Date:** 2026-07-31 · **amended 2026-08-03** (§5–§8 added; §4 corrected where it
contradicted §1; sections renumbered, so a citation to a §-number written before
this date may be off — check the heading, not the number).
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

## 4. Sequencing: the census is an evaluation set, not a gate

> **⚠ Amended 2026-08-03.** As first written, this section ordered "ingest for
> real" fourth, behind finishing the labelling census — which contradicted §1,
> the ruling this file exists to record, while both were marked binding. **§1
> governs: feature first, ship on the borrowed engine, craft later.** The
> constraint below is real and unchanged; what was wrong was reading it as a
> constraint on the *product*. It is a constraint on the *measurement*.

Labels join to a detection set by scan position, so detection-configuration
changes (channel order, resolution) orphan them. That is the hard-learned part
and it still holds. What it does not imply is that the product waits, because
the census and the feature are two pipelines that merely share a detector:

- **`labels.json` is a measurement artifact.** It answers "do the descriptors
  separate this cast, and at what cutoffs". It lives in `tmp/`, it never reaches
  the database, and no product surface reads it. Its standing job now is to be
  **the evaluation set for model comparisons** — which is exactly what §5 spent
  it on.
- **The product's ground truth is what the owner confirms in the Faces tab**,
  which lives in `people` and `face_identities`, keyed on media and face rows in
  SQLite. A later re-detection discards ingested *boxes* — cheap, automated,
  minutes — while the *confirmations* are attached to identities and survive.

Losing an unfinished census is the expensive loss; losing a set of
machine-detected boxes is not. So the census is not a gate on ingest.

**What has happened**, in order:

1. Detection configuration settled — the channel-order comparison against the
   independent oracle (§7).
2. Labels made portable across detection sets by content hash plus box overlap
   (`scripts/vision/rekey-labels.js`), so this class of catastrophe is retired
   rather than guarded.
3. The recogniser settled (§5).
4. The roster gap closed with a `people` table (§6).
5. Quality routing, so the Faces tab offers faces that are worth naming instead
   of every box the detector produced.

**What remains:**

6. Ingest provenance and the assignment ledger — record which engine actually
   produced a face, and make every naming decision an event that can be revoked
   without destroying the corrections made after it.
7. Smoke-test the whole path on a small subset. This is where code that has only
   ever met tests first meets photographs; expect it to find things no test
   could.
8. Ingest for real, and tag the gallery.
9. Name the rest, in the Faces tab. This is the product, and it is also the only
   way to find out whether the interface is any good.
10. Production hand-off — a separate exercise with its own decisions (§8), not a
    deployment step tacked onto the end of this one.
11. Craft phase begins.

Finishing the labelling census stays worth doing, on its own schedule, for the
job §5 used it for. It is not on this path. Wiring tags into a product surface
(memory book, thank-you cards, sunset archive) is still the owner's choice and
is still open — §9.

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

## 6. The roster gap: a `people` table, not a nullable column

**Decided 2026-08-03**, and shipped. A face is assigned to a **person**;
`face_identities` points at a `people` row, and `people.guest_id` is a nullable
link to the roster.

The gap was real. A `guests` row is an **invitation** — one per party, with a
single invite code — and much of the cast in the photographs is not on that list
under its own row: partners recorded under someone else's, children, the
photographer, vendors. An identity that could only point at a roster row had
nothing valid to point at for a large share of the people in the gallery, and
naming is the entire product.

> **⚠ The reason previously given here was wrong on its facts, and is corrected
> rather than deleted.** This section's earlier text said the gap arose because
> "labelling used free-typed names". It did not: `labels.json` holds opaque
> person keys (`p1`, `p2`, …) and never a name, and names live in an
> `identities.json` sidecar written only on an explicit, default-off opt-in. The
> gap was never about how labelling stored names — it was about the *roster*
> being a list of invitations. The conclusion stood; the stated reason did not.

Two shapes were on the table: make `face_identities.guest_id` nullable and give
that table its own `display_name`, or add a `people` table and link *it* to the
roster. **The owner chose the `people` table.** The nullable column would have
encoded the same idea in a table still shaped like the wrong one, and would have
had to be undone later regardless.

This is decided. It is no longer an open question and no longer a blocker.

## 7. Detection: the reference (BGR) channel order

**Decided 2026-08-03.** The detector is fed the channel order OpenCV's reference
implementation feeds it — **BGR**. The borrowed wrapper's default was the other
one; both are plausible, neither errors, and they produce different detections.

Two things stand behind it, and only one of them may be written down. The
training-convention prior is not a measurement and stands on its own: the
network was trained on what the reference implementation feeds it. The other is
the comparison against the independent macOS Vision detector over the same
frames — which *is* a measurement of the photographs, so this file records how
to re-run it and not what it returned.

**The method, to re-derive locally.** No measured figure appears in this
repository (rule 3); the comparison regenerates from artifacts that already
exist. Run `oracleSummary()` from `scripts/vision/session1-report.js` against
each of the two run directories and the shared oracle file. Read them in this
order:

1. **Recall of the faces the independent detector also found.** This is the
   metric closest to "did we miss someone", and the product's failure mode is a
   guest silently absent from their own photographs. It is the one that decided
   this.
2. **Corroboration rate, read carefully.** The oracle is conservative, so a
   detection it declines to confirm is not thereby a false positive. This
   comparison is genuinely ambiguous and is not a counter-argument of equal
   weight to the first.
3. **Landmark placement**, as a tie-breaker only.

Adopting BGR means a re-detection, which is why §4's step 2 came first:
`rekey-labels.js` makes that a migration instead of a cliff.

## 8. Everything runs locally until the naming is done

**Decided 2026-08-03.** The whole face pipeline — ingest, labelling, model
comparison, the Faces tab, naming — runs on the owner's machine, against a local
database, with the photograph directory passed as an explicit argument every
time. Nothing in this work touches the production deployment.

**The production pass is a later, separate exercise**, with its own decisions
still to make: what travels, what is recomputed on the other side, and what
never leaves the laptop at all. It is the last item on §4's list because it is a
different piece of work, not because it is the easy part, and no session should
treat it as a deploy step tacked onto the end.

## 9. Tags do reach a guest-facing surface — after the deploy, as portfolio work

**Decided 2026-08-06**, closing the longest-standing open question here.

Admin-only is **not** permanent. Once the site is deployed, tagging becomes an
input to at least one guest-facing feature, built as optional and additive. The
framing the owner gave is the important part: after deploy, the goal is *"as
much cool stuff as possible for portfolio value"* — so this is not a commitment
to a particular feature, it is a ruling that the door stays open and the data
model should not assume otherwise.

**Which surface is still open** (memory-book chapters, thank-you-card photo
suggestions, sunset-archive index, opt-in "photos of you"). That choice is
deliberately deferred to the post-deploy sessions rather than guessed now,
because nothing before the deploy depends on it.

**What this rules out:** nothing in the current build. It does mean §3 of
`VISION-STATUS.md`'s old "admin-only, permanent?" framing is dead, and that a
future guest-facing reader is a design constraint on any schema change from
here — a `people` row is a thing a guest may eventually see the name of.

## 10. Open questions that remain genuinely open

Recorded so they are asked, not assumed:

- Which guest-facing surface gets the tags first (§9 settles *that* they do, not
  *which*).
- Video: in scope for the craft phase, or a recorded non-goal?
- What the production hand-off actually moves (§8) — **narrowed 2026-08-06**,
  see below.
- How far the craft phase goes beyond re-implementation (e.g. training on the
  owner's own labels with hand-written backpropagation) — raised 2026-07-31,
  unevaluated, explicitly not dismissed.

### The production hand-off, as far as it is settled

**Decided 2026-08-06: the borrowed engine does not go to the VPS.** The
production pass runs from the owner's machine wherever it can, and the one step
that resists is a small, known change rather than an unknown.

What forces the question is narrower than it looked. `ingest-faces.js` needs
**no engine and no weights** — detection already happened locally, and ingest is
a content-hash join over the run's own `faces.jsonl`. `import-media` has an HTTP
sink (`--url=`) built for driving a remote server. So the only step wanting
`tmp/rig/engine.mjs` on the target machine is `export-face-work.js import`,
which hard-requires `--weights` and `--engine` and then *hashes the engine and
compares it to the digest the artifact carries*.

That is a **provisioning check** — the error strings say so — and its content is
a comparison of two digests. On a machine that will never run inference it
verifies a property that does not matter there. So the intended fix is to let
`import` accept `--expect-engine SHA256` in place of `--engine PATH`, with the
digest coming from a locally-run `preflight` or the pinned table. Same
guarantee, same two strings compared, and nothing borrowed ever reaches
production — which keeps the tier-4 promise ("ends with the borrowed engine
deleted") true by construction rather than by cleanup.

**Explicitly rejected: pulling the production database down, running the pass
locally, and pushing it back.** The site is live. Every guestbook entry, RSVP,
comment, reaction and upload landing during that window is silently destroyed by
the push. Named here so nobody reaches for it under time pressure.
