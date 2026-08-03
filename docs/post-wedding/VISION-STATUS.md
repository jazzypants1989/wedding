# Vision project: where it actually stands

**Date:** 2026-07-31
**Status:** **this is the current-state document.** It is the one file in this
directory that is meant to be true today, and the one that must be updated when
anything changes. Every other `SESSION-*.md` is a dated record.
**Binding above it:** [`CLAUDE.md`](../../CLAUDE.md) (the photograph rules —
hook-enforced) · [`DECISIONS-vision.md`](./DECISIONS-vision.md) (the owner's
answers; not re-litigated) · [`SPEC-vision-lab.md`](./SPEC-vision-lab.md) §15
(working rules)
**Reference:** [`VISION-MODELS.md`](./VISION-MODELS.md) — the model ledger, still
accurate.

---

## 0. How to read this, and how it was produced

Every claim below was checked against the code, the database or the run
artifacts on 2026-07-31 — tests executed, row counts queried, comparisons
re-run — not carried over from a previous document. Several statements in the
session documents did not survive that check, which is why those files now carry
staleness banners and this one exists.

**Do the same to this file.** It will go stale too. When it disagrees with the
code, the code is right and this file is a bug.

⚠ **No measurement taken from the photographs appears here, and none may be
added** — not face counts, not people counts, not accuracy figures, not
percentages, not distributions. That is `CLAUDE.md`'s fourth photograph rule and
it is a hard line, because this repository is public and those are all facts
about identifiable people. Where a number would be the natural thing to write,
this file says **which artifact to read locally** instead. The run reports print
everything; they live in `tmp/` and are deleted with it.

---

## 1. What exists and works

**The pipeline runs end to end**, and has been run over a full photograph set
more than once.

| Piece | Where | State |
|---|---|---|
| Align, gate, group, metrics, assign, confidence, must-link, frame-hash, defaults | `public/vision/` | ⊙ first-party, pure numeric JS, no DOM, no `node:*`, fully unit-tested |
| Batch runner | `scripts/vision/session1.js` | ⊙ |
| Labelling page | `scripts/vision/label.html` | ⊙ |
| Report (terminal + HTML) | `scripts/vision/session1-report.js` | ⊙ |
| Contact sheet | `scripts/vision/contact-sheet.html` | ⊙ |
| Label-data rebuild, pool growth | `scripts/vision/relabel-data.js` | ⊙ |
| Independent detection oracle (macOS Vision) | `scripts/vision/oracle-macos.swift` | ⊙ |
| ONNX structure inspector | `scripts/vision/inspect-onnx.js` | ⊙ |
| Weight digest verifier | `scripts/vision/verify-weights.js` | ⊙ |
| Label/timing backup tool | `scripts/vision/labels-backup.js` | ⊙ |
| Model A/B rig (re-describe existing crops) | `scripts/vision/redescribe-crops.js` | ⊙ |
| DB schema `media_faces` + `face_identities` | `db/schema.js` | ⊙ built, migrated, triggered |
| Ingest CLI | `scripts/vision/ingest-faces.js` | ⊙ built |
| Admin faces API | `api/admin/faces.js` | ⊙ built, integration-tested |
| Admin Faces tab | `public/pages/admin/` | ⊙ built |
| Must-link propagation across near-duplicate frames | `public/vision/must-link.js` | ⊙ built, tested |

**Verification, as of this date:** the full suite passes — unit and integration,
zero failures — and both TypeScript projects typecheck clean. The vision subset
is a few hundred unit tests on its own. Re-run with `npm test` and
`npm run typecheck`; do not take this paragraph's word for it.

**Run artifacts exist** under `tmp/` (gitignored scratch, deleted freely):

- **Two complete batch runs over an identical photograph set**, differing in one
  parameter — the channel order fed to the detector. Each carries its own
  `timing.json` recording the full configuration that produced it.
- **A labelling file** attached, by verified `datasetId`, to one of those two
  runs. It is partial: a substantial share of the census is done, and a
  meaningful share remains. Read the report for the exact figures.
- **An oracle file** from the independent macOS Vision detector over the same
  frames, used to score both runs.
- The borrowed inference wrapper (`tmp/rig/engine.mjs`) and the verified model
  files.

**The mirror check has passed.** Landmark order is correct, confirmed against the
independent detector rather than by eye. This was the highest-consequence silent
failure available and it is ruled out.

---

## 2. What does not exist

- **Tier 2** — the tensor converter (`pack-tensors.js`), the weight fetcher
  (`fetch-weights.js`), the model registry. The inspector and the digest
  verifier exist; the fetching and converting do not.
- **Tiers 3–4** — the hand-written kernels. `detect` and `describe` are still the
  borrowed runtime's. `public/vision/detect.js` is post-detection geometry, not
  the network.
- **Tier 5** — the Vision Lab bench in `/studio`.
- **Tiers 6–7** — upload-time detection, WebGPU backend.
- **Label portability across detection sets** — re-keying labels by content hash
  and box overlap. Not built. `datasetId` *detects* a mismatch; nothing
  *repairs* one.
- **An import path for labels into the labelling page** — *now built*, see §6.

---

## 3. The feature has never been run

> **⚠ Point 2 below is closed, 2026-08-03.** The roster gap is no longer a
> blocker and no longer schema-level: the `people` table shipped, a face is
> assigned to a *person*, and `people.guest_id` is a nullable link to the
> roster. See [`DECISIONS-vision.md`](./DECISIONS-vision.md) §6 for the ruling
> and the reason. The paragraph is kept because it is why the table exists. The
> rest of this section — and §1's inventory — is a snapshot of 2026-07-31 and is
> being overtaken; check the code.

This is the single most important line in this document.

**`media_faces` and `face_identities` contain zero rows.** `ingest-faces.js` has
never been run for real. The Faces tab has never displayed a face. Every part of
tier 1 is built, tested and committed, and none of it has met a photograph.

Two further gaps sit between the built feature and a usable one:

1. **The gallery holds a fraction of the photographs.** The batch runs read a
   directory; the gallery holds media rows. The full set was never imported. The
   importer exists (`npm run import:media`) and takes the directory as an
   explicit argument.
2. **The roster gap — and this one is schema-level.**
   `face_identities.guest_id` is `NOT NULL`, because an identity *is* the
   confirmed link to a roster guest. But the `guests` table holds **parties, not
   people** — a row is an invitation — and many people in the photographs are on
   it under someone else's row or not on it at all: partners, children,
   photographer, vendors. **So "confirm this group as a person" currently has
   nothing valid to point at for much of the cast.** Naming is the entire
   product, so this blocks the feature outright.

---

## 4. The constraint that governs all sequencing

**Labels join to a detection set by sequential face id.** Face ids are positions
in a scan order, so anything that changes the detection set renumbers everything
after the first divergence, and there is no partial recovery.

- **Upstream of `faces.jsonl` — orphans every label:** the channel order fed to
  the detector, detection and source resolution, score threshold, NMS cutoff,
  duplicate cutoff, adding/removing/renaming photographs.
- **Downstream of it — completely free:** gate cutoffs, grouping cutoffs, the
  assignment UI, `assign.js`, `confidence.js`, `must-link.js`, everything in the
  admin feature.

`scripts/vision/relabel-data.js` and the `datasetId` check are what tell you
which side of that line a change landed on.

### ⚠ But the feature is not on the labelled side of that line

The labelling census and the shipped feature are **two pipelines that share a
detector**, and they have been discussed as one thing throughout this project's
history. They are not:

- **`labels.json` is a measurement artifact.** It answers "do the descriptors
  separate these people, and at what thresholds". It lives in `tmp/`, it never
  reaches the database, and no product surface reads it.
- **The feature's ground truth is what the owner confirms in the Faces tab**,
  which lives in `face_identities` and is keyed on media rows and face rows in
  SQLite — not on a scan-order index in a scratch file.

**Consequence, and it is the unlock for shipping soon: ingesting and tagging the
gallery does not depend on finishing the census, and it does not depend on
settling the channel order.** A re-detection later would discard the *ingested
boxes* and require re-running ingest — cheap, automated, minutes — while the
*confirmations* are attached to identities and can be re-associated. Losing an
unfinished census is the expensive loss; losing a set of machine-detected boxes
is not.

⚠ **This was written as a proposal, and the owner adopted it on 2026-08-03.**
[`DECISIONS-vision.md`](./DECISIONS-vision.md) §4 now says it outright: the
census is an evaluation set, not a gate on ingest, and §1's feature-first ruling
governs where the two conflict. That document is the binding record; this
paragraph is the argument behind it.

---

## 5. The channel order — decided: the reference order (BGR)

> **⚠ Rewritten 2026-08-03, and the rewrite is the point.** This section
> previously summarised, in words, what the channel-order comparison found —
> which order recovered more of the faces the oracle also found, which had the
> lower corroboration rate, which placed landmarks better. It carried no
> figures, and it was still a violation of §0 and of `CLAUDE.md`'s fourth
> photograph rule: a comparative conclusion drawn from measuring photographs of
> identifiable people is a measurement of those people, quantified or not. What
> a document records is **the decision** and **the method to re-derive it**.
> Never the evidence.

The wrapper feeds the detector one channel order; OpenCV's reference
implementation feeds it the other. Both are plausible; neither errors; they
produce different detections.

**Decided: BGR, the reference order.** See
[`DECISIONS-vision.md`](./DECISIONS-vision.md) §7, which is the binding record.
One of the two reasons behind it is not a measurement and can be stated here —
the network was trained on what the reference implementation feeds it. The
other is the oracle comparison, and what that returned belongs in `tmp/`.

**To re-derive the comparison locally:** run `oracleSummary()` from
`session1-report.js` against each of the two run directories and the shared
oracle file, and read recall against the independent detector first (that is the
metric closest to "did we miss someone"), corroboration rate second and
sceptically (the oracle is conservative; a detection it declines to confirm is
not thereby a false positive), landmark placement only as a tie-breaker. The
run directories live in `tmp/` and the numbers stay there.

Adopting BGR means a re-detection, which orphans a labelling keyed to the old
detection set. `scripts/vision/rekey-labels.js` — built since this section was
first written — carries a labelling across by content hash and box overlap, so
that is now a migration rather than a cliff.

---

## 6. Defects found and fixed on 2026-07-31

All four were live in committed code. Each is fixed, tested, and the tests fail
without the fix.

1. **The report printed a confident verdict band with no interval behind it.**
   The person-level bootstrap correctly *refuses* below three distinct people on
   a side — but the branch that turns a refusal into `UNDECIDED` was guarded by a
   finiteness check that the refusal itself failed, so the report fell through to
   whichever band the point estimate landed in. It was least hedged exactly where
   it had least evidence. Now: no interval, no band.
2. **The "cutoffs to write into `defaults.js`" block was three kinds of wrong at
   once.** Values printed to five significant figures against a round-hard rule;
   two cutoffs that are proxies for something other than face quality
   (distance-from-frame-edge measures whether someone was the *subject* of the
   photograph; an alignment-scale cap is a minimum face size in disguise) printed
   without their caution; and `detect.longEdge` — a **re-detection**, which
   orphans every label — printed in the same list as eight cutoffs that are all
   safe to edit. Now: hard rounding, inline cautions, and the label-orphaning
   entry in its own block under a warning.
3. **The oracle join had a basename-only fallback.** If exactly one oracle record
   shared a photograph's basename, it was accepted even when the paths did not
   match — so a run over one directory tree could silently adopt another tree's
   faces, and every resulting disagreement would read as a detector fault.
   Removed; a path the oracle does not corroborate is now reported absent.
   (Verified: removing it changes nothing about the existing runs, so it was
   never load-bearing — only dangerous.)
4. **The labelling page was a one-way door.** Labels lived in one browser's
   `localStorage`; every export rebuilt the file under a *fresh random person-key
   permutation*; and nothing could read a file back. So a rescued backup could
   not be returned to the labeller, and exporting from an empty browser over a
   good file destroyed the single artifact in this project that does not
   regenerate. **Now there is a Load button**, with three rules: local labels
   always win (it fills blanks, never overwrites), person keys are re-allocated
   rather than trusted (the file records the *partition*, not the numbering), and
   a `datasetId` mismatch is refused outright.

### Still open, not fixed

- **The report's labelling target is priced as a sampling question.** It
  estimates how many more *people* would narrow the interval, then converts to
  faces at the *mean* faces-per-person — but labelling draws faces, not people,
  and the per-person distribution is heavy-tailed, so the real cost is
  materially higher than the converted figure. More fundamentally, per
  [`DECISIONS-vision.md`](./DECISIONS-vision.md) §3, this is a **closed event
  with a finite cast**: a census to finish, not a sample to extend. The report
  now prints that objection and the census remainder alongside the target, but
  the underlying statistic is unchanged. **Proper fix:** replace the sampling
  machinery with census arithmetic once labelling is complete — at which point
  the interval, the bands and the target all stop being needed at once.
- **The report quotes several different people-counts in one artifact** — the
  headline, the rank-1 table and the identities file each count a different
  population (evaluable vs. recoverable vs. named). None is wrong; nothing says
  which is which. They should be labelled.
- **Pool growth can promote group-labelled faces into the individually-judged
  pool** without accounting for it, which would quietly contaminate the one
  uniform sample the honest number is measured on.

---

## 7. Necessary next actions — the shortest path to a working feature

The owner's stated priority is **a usable feature as fast as possible, admin-only,
on the borrowed engine** ([`DECISIONS-vision.md`](./DECISIONS-vision.md) §1). It
was wanted days ago. This is the shortest honest path there, and none of it is
throwaway work.

> **⚠ Steps 0 and 1 were answered on 2026-08-03 and are kept for their
> reasoning, not as instructions.** Step 0 is **yes** — the census is an
> evaluation set, not a gate ([`DECISIONS-vision.md`](./DECISIONS-vision.md)
> §4). Step 1's *recommendation* was not taken: the owner chose a separate
> `people` table over the nullable column, and it has shipped (§6 there). The
> current, binding ordering of everything below is
> [`DECISIONS-vision.md`](./DECISIONS-vision.md) §4.

**Step 0 — one question the owner must answer before anything starts (§4):**
may ingest run against the *current* detection set, ahead of settling the channel
order and finishing the census? If yes, the feature ships in days and the
measurement project continues independently behind it. If no, the feature waits
on a re-detection and a full census, and the honest estimate is weeks.

Assuming yes:

1. **Close the roster gap.** The blocker, and a small migration. Recommended
   shape: make `face_identities.guest_id` **nullable** and give the table its own
   `display_name`, so an identity is a *person* who may optionally be linked to a
   roster row. That covers the photographer and the plus-ones without polluting
   the RSVP roster, and it is the honest data model — the current one encodes
   "every person in a photograph was invited", which was never true. A separate
   `people` table is the same idea one refactor further out; the nullable column
   gets there incrementally.
2. **Import the full photograph set into the gallery** — `npm run import:media`
   with `--dry-run` first. The path is always an explicit argument. Media rows
   are what face rows key on.
3. **Run `ingest-faces.js` for real.** First on a small subset, then the whole
   set. This is the step that has never happened; expect it to surface
   real-data problems that no test could.
4. **Use the Faces tab and name people.** This is the product, and it is also the
   only way to find out whether the interface is any good. Expect to change it.
5. **Wire tags into exactly one product surface.** Not all four. One, chosen for
   being the least reversible-looking and the most immediately satisfying —
   memory-book chapters and thank-you-card photo suggestions are the two
   strongest candidates, and the archive index is the safest. **Owner chooses;
   this is open in `DECISIONS-vision.md` §9.**

**Step 6 is not optional: back up `labels.json`, `identities.json` and every
run's `timing.json` right now, outside this repository**, with
`scripts/vision/labels-backup.js <run-dir> --to <path>`. Copy `tmp/rig/engine.mjs`
by hand — no module in the repo names it, so nothing in the repo can rebuild it.
These are the only artifacts in the project that do not regenerate. They have
been lost once.

---

## 8. Potential future actions — where the ambition goes

This repository is a portfolio piece and ambition is explicitly not to be
constrained ([`DECISIONS-vision.md`](./DECISIONS-vision.md) §2). None of the
following is scheduled; all of it is real work with a real payoff.

**Near, and unblocking:**

- **Label portability** — re-key labels onto a new detection set by content hash
  plus box overlap, instead of by scan position. This is what turns "changing the
  detector orphans everything" from a cliff into a migration, and it is the
  prerequisite for adopting BGR without losing the census. It needs the labelling
  page's new import path, which now exists. **This is the highest-leverage
  unbuilt thing in the project.**
- **Census arithmetic replacing sampling statistics** in the report, once
  labelling is complete (§6).

**The craft phase — the headline work, and the point of the project:**

- **Tier 2** — the ONNX→safetensors converter, BatchNorm folding (mind the
  per-node epsilon and the fold that is *not* into a convolution), the weight
  fetcher, the model registry.
- **Tier 3** — hand-written scalar kernels and our own detector: grouped
  convolution, matrix multiply, max pool, nearest resize, elementwise. Four
  kernels plus elementwise covers *both* models. Checked layer-by-layer against
  the borrowed engine, which is already wired to real photographs — the oracle
  is a side effect of the build order, not a thing to remember to build.
- **Tier 4** — our recogniser and the worker pool. **Ends with the borrowed
  engine deleted and `tmp/rig/` removed**, which is the moment the dependency
  claim becomes unconditionally true.
- **Tier 5** — the Vision Lab bench in `/studio`: live knobs, overlays,
  per-layer activation inspection, backend A/B, oracle comparison. This is the
  one that makes the rest *visible*, and visibility is most of what a portfolio
  piece is for.
- **Tiers 6–7** — upload-time detection in guest browsers, WebGPU backend.

**Beyond re-implementation** — raised, unevaluated, and explicitly not
dismissed:

- **Training on the owner's own labels, with hand-written backpropagation.** The
  labelling census is, incidentally, a small supervised dataset with clean
  provenance and unambiguous consent. Fine-tuning a descriptor on it — or
  training a small one from scratch — would be the most ambitious thing in the
  repository by a distance, and it is the one piece of work here that no
  borrowed runtime can do for you.
- **Swapping the recogniser.** The ledger's A/B rig re-describes *existing
  crops*, so comparing candidates costs no re-detection and no re-labelling.
  Under a borrowed runtime a swap is a registry entry; under hand-written kernels
  the op-type count *is* the project, and the ledger's swap matrix prices both.

---

## 9. Open questions for the owner

Recorded so they are asked rather than assumed. Several have been "answered in
conversation and lost" before; that is what
[`DECISIONS-vision.md`](./DECISIONS-vision.md) exists to stop.

1. ~~**May ingest run ahead of the census and the channel-order decision?**~~
   ✅ **Answered: yes.** The census is an evaluation set, not a gate —
   [`DECISIONS-vision.md`](./DECISIONS-vision.md) §4.
2. ~~**Adopt BGR?**~~ ✅ **Answered: yes**, and label portability was built
   first, so a re-detection is a migration (§5,
   [`DECISIONS-vision.md`](./DECISIONS-vision.md) §7).
3. **Which product surface gets tags first?** Memory-book chapters,
   thank-you-card photo suggestions, sunset-archive index, or an opt-in "photos
   of you". — **still open.**
4. ~~**How do identities link to the roster?**~~ ✅ **Answered: a `people`
   table**, with a nullable link to a roster guest —
   [`DECISIONS-vision.md`](./DECISIONS-vision.md) §6. §7 step 1 below proposed
   the nullable-column alternative and was not taken.
5. **Video: in scope, or a recorded non-goal?**
6. **Does anything guest-facing ever use this**, or is admin-only permanent?
7. **How far does the craft phase reach** beyond re-implementation?

---

## 10. Standing rules that govern any work here

Not advice. Constraints, in the same class as "no regex" and "no npm".

1. **The photograph path is always an explicit argument.** Nothing searches for
   images — not `~/Pictures`, not the Photos library, not a path remembered from
   a previous session.
2. **Nothing reads the photographs.** No photograph, video or face crop is ever
   opened to be looked at, loaded into an assistant's context, or sent to any
   service. Code processes pixels; nothing describes what is in them. This is
   enforced by a `PreToolUse` hook, not just written down.
3. **Everything derived is scratch, except three things.** `labels.json` +
   `identities.json`, each run's `timing.json`, and `tmp/rig/engine.mjs`. Those
   three are backed up outside the repository. Everything else regenerates.
4. **No measurement of real photographs is written into any file in this
   repository** — including statistics. Counts, distributions, percentiles and
   accuracy figures are all facts about identifiable people, and this repository
   is public. Tuned constants go into a defaults table with no record of what was
   measured to arrive at them.
5. **The borrowed engine is scaffolding.** It lives in `tmp/rig/`, no module in
   the repository names it, it is never on the server request path, and it is
   deleted at the end of the craft phase. Its `info()` must report every free
   parameter it has, so that `timing.json` records them — a knob absent from
   `info()` is a knob someone will later have to search for.
