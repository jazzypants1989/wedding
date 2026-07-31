# Session 3: two audits, a merge, and the feature getting built

> ## ⚠ This is a dated record, not the current state
>
> **Written 2026-07-30 and not maintained since.** It records what was built that
> day. Code has changed since — including fixes to defects in the report this
> session shipped.
>
> **For current state, go to [`VISION-STATUS.md`](./VISION-STATUS.md).** For the
> owner's binding decisions, [`DECISIONS-vision.md`](./DECISIONS-vision.md).

**Date:** 2026-07-30
**Status:** decision + build record, as of its date. Supersedes [`SESSION-2-vision.md`](./SESSION-2-vision.md) §7
(the what-to-do-next ordering) and corrects one claim in its §1 and one proposal in its §8.
**Reads with:** [`SPEC-vision-lab.md`](./SPEC-vision-lab.md) §15 (since amended — the
one carve-out is now three) · [`VISION-MODELS.md`](./VISION-MODELS.md) (AuraFace now
parsed; new candidate rows; the detector's channel order added later)
**Followed by:** [`SESSION-4-vision.md`](./SESSION-4-vision.md) — a run was destroyed
and rebuilt from the label file alone. Nothing here is superseded; §5's `datasetId`
refusal is what made that possible.

Two independent reviews of the session-2 state ran in parallel, disagreed
productively, and were merged. Then most of the merged plan was built. As
always: **no number measured from the photographs appears here**, and none may
be added. This records what exists, what was corrected, and what remains.

---

## 1. Corrections to the previous documents

### 1a. SESSION-2's fixes were prose until this session

Nearly everything SESSION-2 §1 describes as built or fixed — the timing fix,
the oracle path-suffix join, the mirror check, the gated sweep tables, the pool
split, all four regression tests — existed only in an uncommitted working tree.
`SESSION-2-vision.md` itself was untracked. First act of this session: commit
it all. A review whose fixes can be lost to one `git stash` has not finished
reviewing.

### 1b. The purity guarantee was a grep wearing a compiler's badge

SESSION-2 §1 claimed `public/tsconfig.json` "declares no node types, so a
`node:` import fails typecheck." The file had no `"types"` key, so TypeScript
auto-included `@types/node` from the repo root; the only real guard was the
source grep in `vision-purity.test.js`. Fixed: `"types": []` is now set, the
claim is finally true, and both the test header and SESSION-2 carry the
correction. Total fallout: one entity type that said `Buffer` where it meant
`Uint8Array`.

### 1c. The household prior of SESSION-2 §8 does not survive the schema

`guests` rows ARE parties — `name`, `party_size`, one shared `invite_code`
(`db/schema.js:38-51`). Individual members exist only if they created an
account. So for any party where nobody registered — skewed toward exactly the
guests who appear least and are hardest to recognise — the roster yields one
name and a count, not a membership list. Worse, it is circular: household
membership as a prior on identification is only knowable *through*
identification. Demoted: co-occurrence over **confirmed identities** is sound
and stays; temporal locality is strong, free, and stays; the household prior
is at most a weak tie-breaker and must never be described as the roster
"knowing who came together."

### 1d. Two stale claims in the model ledger, now settled by parsing

AuraFace's "6 op types" figure had **no public source anywhere** — and then our
own parse confirmed it anyway (see the ledger's new verified table). The more
important correction: op-type count prices *implementation effort*, multiply-adds
price *runtime*, and AuraFace is an IResNet100 at roughly 20–40× SFace's
arithmetic. Cheaper to hand-write; far more expensive to hand-*run* in scalar
JS. EdgeFace's licence contradiction was re-checked and is still unresolved.
LVFace and GhostFaceNets are recorded so nobody re-litigates them either.

### 1e. `labels.json` is not scratch, and the docs said it was

SPEC §15 rule 3 called every derived artifact "deletable at any time; it
regenerates in minutes." True of everything except the one file both prior
sessions call the most valuable artifact of the project: labelling is human
judgement and does not regenerate. The rule now carries exactly one carve-out,
and `scripts/vision/labels-backup.js <run-dir> --to <path>` copies it (plus
`identities.json` and `timing.json`) to an owner-chosen destination, verified
byte-for-byte. Still never committed, quoted or summarised.

---

## 2. What the report now refuses to do

All committed with regression tests; SESSION-2 §2's list continues.

- **Join labels to the wrong run.** `datasetId` existed precisely so a
  `labels.json` could be refused against a run it was not made from; nothing
  ever checked it. `loadRun` now recomputes and refuses on mismatch (face ids
  are sequential counters over a content-dependent scan; a renamed file shifts
  every id and the old join was silent).
- **Print a confident verdict from thin pairs.** `verdictBasis` required pair
  counts only in its held-out branch; the default-gate and no-gate fallbacks
  accepted any finite AUC — and `separation()` returns one from a single pair
  per side. All branches now require `MIN_VERDICT_PAIRS` (30) on both sides, and
  an under-powered run routes to UNDECIDED.
- **Blend the coverage table.** The appearance-coverage table mixed pool A and
  pool B, re-inheriting exactly the contamination §2c split rank-1 over. Pool A
  is now the quoted table; the blend prints separately, labelled as context.
- **Trust a point estimate about a re-draw of people.** The verdict now buckets
  on a **person-level bootstrap interval** (`bootstrapAuc` in
  `public/vision/metrics.js` — reweight, never duplicate; injected RNG; refuses
  under 3 people a side). If the interval spans one of the verdict's own band
  boundaries, the headline is UNDECIDED — the verdict would have depended on
  who happened to get labelled.
- **Guess how much labelling is enough.** `labellingTarget()` subsamples the
  labelled people, fits interval-width against √people, and prints roughly how
  many more labelled people would let the interval fit inside one band.
  SESSION-2's P0 said "about twenty minutes"; the report now derives the number
  that sentence was guessing at. **Owner labelling should follow that printed
  number**, using `relabel-data.js --pool-a N`, which grows pool A as a
  verified prefix extension of the same seeded shuffle — every existing label
  stays valid, and the superset property is asserted at runtime and pinned in
  tests.

---

## 3. What now exists that did not

| Piece | Where | State |
|---|---|---|
| Match-confidence primitives: prototypes, margin, per-photo joint assignment with priced abstain + twins guard | `public/vision/assign.js` | committed, tested |
| Crop/match confidence split (eyeAngle and eyeRatio folded band-shaped) | `public/vision/confidence.js` | committed, tested |
| Person-level cluster bootstrap + tagged pairs | `public/vision/metrics.js` | committed, tested |
| Interval-bucketed verdict + labelling target | `scripts/vision/session1-report.js` | committed, tested |
| `media_faces` + `face_identities` schema, both precedence-trigger directions, `media.source_sha256` + `captured_at` | `db/schema.js`, `db/media-faces.js` | committed, tested |
| PNG decoder (filter-0 strict, CRC-checked) + re-describe-from-crops A/B rig + `--embedder` | `scripts/vision/png-read.js`, `redescribe-crops.js`, `session1.js` | committed, tested |
| Pool-A growth without invalidating labels | `scripts/vision/relabel-data.js --pool-a` | committed, tested |
| Oracle 5-point output (geometry-named mouth corners) + mouth mirror check | `oracle-macos.swift`, report | committed, tested |
| ONNX activation exposure (append-only graph-output surgery) | `scripts/vision/expose-activations.js` | committed, tested |
| Labels backup | `scripts/vision/labels-backup.js` | committed |
| Admin assignment feature (ingest CLI, admin API, Faces tab) | `scripts/vision/ingest-faces.js`, `api/admin/faces.js`, `public/pages/admin/face-assignment.js` | committed, tested |
| Must-link propagation across near-duplicate frames (four rules) + admin review UI | `public/vision/must-link.js`, `api/admin/faces.js`, `public/pages/admin/face-assignment.js` | committed, tested |
| Frame identity + capture time as durable columns | `db/schema.js` (`media.frame_root_sha256`), `scripts/vision/ingest-faces.js` | committed, tested |
| Co-occurrence prior over confirmed identities (ordering only) | `db/media-faces.js`, `api/admin/faces.js` | committed, tested |

Architecture note worth keeping: **clusters are not persisted.** The only
durable identity state is `face_identities` + `media_faces.face_identity_id`;
grouping and prototype matching are recomputed on demand by importing the pure
`public/vision/` modules server-side — which is exactly what SPEC §4's
venue-agnosticism was for. Suggestions order; a human confirms; nothing
auto-publishes; descriptors never leave the server in any response, admin
included.

## 4. Q1, updated with real numbers instead of a mood

Three options now, all still open, but priced:

1. **Hand-written kernels.** The "missing prerequisite" of SESSION-2 §6 cost
   **under an hour**, not half a day — `inspect-onnx.js` already knew every
   field number, and `graph` is a direct field of `ModelProto` (one length
   prefix to rewrite; the varint-width-growth case is test-pinned). The one
   risk left open — whether a stock runtime accepts the shapeless appended
   output at `session.run` time — **is now closed: it does.** Checked against
   `onnxruntime-node` on both models, on synthetic input: the patched files
   load, the appended tensors come back with correct concrete shapes resolved
   at run time, and **the pre-existing outputs are bit-identical to the
   unpatched file's** (max absolute difference exactly zero, not merely within
   tolerance). It holds for the dynamic-dim detector export as well as the
   static recogniser, so shape inference over symbolic dims is not disturbed
   by an output carrying no declared shape. Oracle A is available whenever
   tiers 3–4 want it. SESSION-2 also overstated the tool as "load-bearing for tiers 3–4
   in their entirety": end-to-end comparison over many inputs leaves little
   room for a surviving layer bug; the tool is the *debugger* for when
   end-to-end fails.
2. **Ship the borrowed engine.** Needs the CLAUDE.md paragraph, as before.
3. **The engine as a subprocess over stdio** — new option. CLAUDE.md's CLI
   carve-out is written about *reachability* (vips is fine because it is a
   separate binary over a pipe), and `engine-loader.js`'s same-process
   `import()` is the only thing that makes the rig tier 1. Spawning it as a
   child process meets the existing rule's letter. State the limit honestly:
   the supply-chain costs are incurred at `npm install` time, and a subprocess
   does nothing about a malicious postinstall — only hand-writing does. A real
   third option, not a loophole; it still deserves a written decision.

## 5. What the propagation pass added, and three things it settled

**Must-link is the inverse of cannot-link, and it is the only mechanism that
gets coverage back.** `group.js` refuses to merge two faces in one photograph;
`must-link.js` carries a confirmed identity onto the *same* box in a
near-duplicate frame — the burst shot, the retouched export — which is where
the people the quality gate discarded actually are. All four safety rules are
enforced and each has a test that fails the propagation: frames resolve to a
union-find root rather than a one-hop pointer; the best box must beat the
runner-up by a margin (two guests shoulder to shoulder is the failure case);
the descriptors must corroborate the geometry (two people swapping places
between frames is invisible to boxes alone); and an applied propagation writes
a second-class `provenance='propagated'` identity, never the confirmed one, so
it can never seed a prototype.

**Frame identity is now a column, not a recomputed guess.**
`media.frame_root_sha256` holds the sha256 of the lowest-id photo in the run's
duplicate equivalence class — content-addressed, so a re-run that numbers
photos differently still agrees with itself. That keeps the near-duplicate
cutoff a single CLI-authoritative decision instead of a threshold that could
quietly differ between the batch and the server. `media.captured_at` is
populated by the same pass; it was a column nothing wrote until now.

Three things settled along the way:

- **The queue was weighting the wrong unit.** `unlocks` counted distinct
  *media rows*, so a ten-shot burst of one moment outranked a face appearing
  across ten genuinely different pictures — the coverage-table bug of §2, in a
  second costume. It now counts distinct frames.
- **A separate merge-groups action is not needed.** Because `assign`
  find-or-creates exactly one confirmed identity per guest, naming two
  over-split groups with the same guest already merges them onto one identity.
  That is now pinned by a test. Whether the *discoverability* of that is good
  enough — a reviewer has to notice the two groups are one person — is a
  judgement to make while using it, not one to pre-empt with UI.
- **Every face chip in the Faces tab was rendering uncropped.** The frontend
  documented an assumption that the server rode `fileKey` + original
  `width`/`height` alongside each box. It did not, so every crop silently
  bailed out and showed the whole photograph. Fixed at the source and pinned
  by an integration test — a good argument for writing assumptions down where
  a test can later be pointed at them.

## 6. Standing rules

SESSION-2 §9 stands, with rule 3 amended by §1e above (one artifact, one
backup path, never committed). Everything else — path-as-argument, nothing
reads a photograph into context, no measurements in repo files, round tuned
constants hard — unchanged and re-verified this session.
