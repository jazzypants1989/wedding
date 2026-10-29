# The remaining sessions, and what to hand each one

**Written 2026-08-06.** This is the **entry point for planning a session**, not
for doing one. It answers exactly one question: _what is the next session, and
which documents does the agent running it need?_

**Status: live.** Update it when a session finishes — cross off the row, move
anything that slipped, and correct the estimate. A roadmap nobody edits becomes
a roadmap nobody trusts, and this project already has several of those.

**Scope:** it spans **two repositories**. Most sessions are `~/repos/wedding`;
sessions 2 and 3 are `~/repos/make-a` (the `@make-a/devloop` module). That is
why this file exists rather than a section inside `VISION-STATUS.md` — the
devloop work has its own docs, its own gates, and no natural home in a wedding
repo.

---

## How to start a session from this file

1. Find the first unfinished row in the table.
2. Hand the agent **the files in its "hand over" column, and nothing else.**
   That list is the whole point of this document — it is deliberately short, and
   it has been checked against what each session actually needs.
3. Read that session's detail block yourself first, for the preconditions and
   hazards. Some are things only you can do (starting a server, supplying a
   path, making a judgement call).

**Every session, regardless:** `CLAUDE.md` is binding and partly hook-enforced.
An agent in a **git worktree has no `CLAUDE.md`** — git does not carry ignored
files into worktrees — so `cp` it in after creating one. This is permanent and
settled; it is not a bug to fix.

---

## The sequence

| #   | Session                                          | Repo    | Hand over                                                                        | Size                      |
| --- | ------------------------------------------------ | ------- | -------------------------------------------------------------------------------- | ------------------------- |
| 1   | Faces UI review (devloop dogfood)                | wedding | `SCREENSHOT-PROXY.md` · `VISION-STATUS.md` · `/capture-issues` skill             | Medium — owner-driven     |
| 2   | Devloop burrs + docs                             | make-a  | `ORCHESTRATOR-HANDOFF.md` · `IMPLEMENTATION-PLAN.md` · session 1's notes         | Small                     |
| 3   | Fix the faces UI issues + small vision hardening | wedding | **`HANDOFF-session-3.md`** (supersedes the rest for this row) · `DESIGN-SLOTS.md` · `/fix-issues` skill | **In progress** — see below |
| 4   | ~~The non-vision backlog~~ — merged into 3       | wedding | —                                                                                            | Absorbed 2026-10-28       |
| 5   | Deploy                                           | wedding | **`TRAPS.md` §migrations** · `DECISIONS-vision.md` §10 · `scripts/deploy.js`     | Medium — **highest risk** |
| 6   | The production face pass                         | wedding | **`TRAPS.md` §production** · `DECISIONS-vision.md` §8–§10 · `export-face-work.js` header | Medium — **never run** |
| 7   | Doc closeout + archive                           | wedding | This file · `VISION-STATUS.md` · `docs/post-wedding/`                            | Small                     |

**Then, and only then:** the guest-facing surface
(`DECISIONS-vision.md` §9) — post-deploy, optional, portfolio work. Not
scheduled, deliberately.

---

## 1 — Faces UI review (the devloop dogfood)

**Goal.** Two things at once, which is the point: exercise the finished devloop
trust arc on a real app, and produce the issue list that session 3 works from.

**Hand over:** `../../../wedding-backup/face-artifacts/SCREENSHOT-PROXY.md`
(self-contained; it says so and it is true) · `VISION-STATUS.md` · the
`/capture-issues` skill.

**Preconditions — yours, not an agent's.** The three-hop chain has to be up:
smoke server on :3000, `placeholder-proxy.mjs` on :3002, capture overlay on
:4600. **Browse only the outermost port** — :3000 and :3002 still serve real
photographs, and a stray tab on either defeats the whole exercise. Rebuild
`tmp/smoke.db` first if it is gone.

**Hazards.**

- **The first scroll is slower than SCREENSHOT-PROXY.md warns.** Chips now load
  the `display` variant (1600px) rather than `thumb` (400px), and the proxy
  fetches each real variant once to read its header. Expected, not a bug to
  file.
- The proxy's known gaps are real and listed in its own doc: videos do not
  play, range requests are ignored, and the clip scrubber's inline `style=`
  attribute is blocked by this app's CSP (the same T18 issue). Stills are fine.
- This is the **first real use of the approval gate**. If it fights you, that is
  session 2's input, not something to work around.

**Done when** the `.claude/issues-faces` store holds the issues, and you have a
short note on how devloop itself behaved.

**Closes:** devloop S10, and with it `TRUST-PROPOSAL.md`,
`ORCHESTRATOR-HANDOFF.md`, `IMPLEMENTATION-PLAN.md` and `SCREENSHOT-PROXY.md`.

## 2 — Devloop burrs and docs

**Goal.** Fix what session 1 found in the tool, then retire its planning docs.

**Hand over:** `docs/research/devloop/ORCHESTRATOR-HANDOFF.md` ·
`docs/research/devloop/IMPLEMENTATION-PLAN.md` · your notes from session 1.

**Hazards.** The handoff's "Working-tree hazards" section is still live: a
parallel session may share the git index, so commit with the pathspec form; the
pre-commit hook fails on `main` because the doc linter walks retained worktrees,
so devloop commits use `--no-verify` and say so. Gates are `npx tsc --noEmit`
and the devloop module tests.

**Also decide:** whether TRUST-PROPOSAL §9's open questions get folded back in
(the handoff records this as undecided), and whether the "unfocused tabs get no
overlay" regression is worth fixing.

**Done when** the three devloop planning docs are archived and `README` /
`HANDOFF` / `TODO` describe what the module actually is.

## 3 — Fix the faces UI issues, plus small vision hardening

> **Status 2026-10-29 — in progress; read `HANDOFF-session-3.md` first.** The
> owner widened this session to all twelve issues (session 4's too). Done: 6 of
> 12 issues fixed and awaiting acceptance (site #8 #9 #10 #12 #14 #15), faces #2
> half done, carried items 2 (T18), 3 (`--expect-engine`, extended to
> weights) and 4 (duplicate-hash fan-out), and the per-face chip variant. Left:
> the owner's picks from the design review (`node prototypes/serve.js`), which
> unblock the admin redesign (faces #1 #3 #4) and the guestbook/memory-book
> redesign (#11 #13); and **carried item 1, the tuning pass, deferred at the
> owner's request until they can watch it** (it also finishes faces #2).

**Goal.** Work session 1's issue list, and clear three carried items while the
context is loaded.

**Hand over:** `VISION-STATUS.md` · the `/fix-issues` skill · the
`.claude/issues-faces` store.

**The three carried items**, all small and all independent:

1. **Finish the tuning pass.** The predeclared calibration check has not run:
   every face a careful human declined to identify that the gate now routes
   `accept` is a threshold that must move. Both the labelling and the r2 grades
   are in one database, so this is a query rather than a JSONL join. The owner's
   ruling is that tuning happens **once, deliberately** — so do this before
   calling the thresholds settled, and re-run `regrade-faces.js` if anything
   moves.
2. **T18** — three admin tabs build templates containing `style="…"` attributes
   that silently never apply, because the CSP has no `style-src-attr` allowance
   and CSSOM writes are the working alternative. `guests.js`,
   `gallery-admin.js`, `manual-sms.js`.
3. **`--expect-engine`** on `export-face-work.js import`, so session 6 never
   needs the borrowed engine on the VPS. See `DECISIONS-vision.md` §10 for why
   this is the right shape. **Do this here** — discovering it during the deploy
   is the failure mode it exists to prevent.
4. **Duplicate content-hash fan-out.** `loadMediaShaMap` keeps one media row per
   `source_sha256` and the last one wins, so faces silently never reach the
   others. Fan out to every matching row, or refuse loudly. See `TRAPS.md`
   §production — this is latent locally and ordinary in production, where a
   guest re-uploading a photographer's file is the case that triggers it.

**Probably also worth doing:** per-face variant selection for chips. A chip
knows `box.w` and the media's original width, and the `thumb` cap is a known
400px, so it can compute whether `thumb` already gives enough pixels and only
reach for `display` when it does not. Bounded, no server work, and it matters
much more once session 6 puts this over a VPS link.

**Hazard.** `core/static.js` gzips assets **at boot** and serves from that
cache, so a CSS/JS edit is invisible until the server restarts. This has cost
real time twice.

## 4 — The non-vision backlog

> **Merged into session 3 on 2026-10-28** at the owner's request; its issues are
> tracked in `HANDOFF-session-3.md`. Kept below for the record.

**Goal.** The issues about the rest of the app, which have been parked since
July.

**Hand over:** the `/fix-issues` skill · `docs/archive/00-overview.md` (archived
2026-08-06, but still the binding spec for this area) · the `.claude/issues`
store.

**Size, as of 2026-08-06:** 15 issues filed, 7 resolved and awaiting review, **8
still open**. Smaller than it looks from the file sizes. It may be worth merging
into session 3 if that one runs light — the reason to keep it separate is
headspace, not volume.

**Note.** This store is deliberately separate from `.claude/issues-faces`. Do
not mix them.

## 5 — Deploy

**Goal.** Code and migrations onto the VPS. **No face data moves in this
session.**

**Hand over:** `VISION-STATUS.md` · `DECISIONS-vision.md` §10 ·
`scripts/deploy.js`.

**The ordering is not a convention, it is the safety property.**
`export-face-work.js`'s own usage text opens with _"DEPLOY THE SCHEMA CHANGE
BEFORE MOVING ANY DATA"_ — pushing a re-schema'd database under the old server
breaks the admin faces endpoints outright. And it is what defuses **D1**: the
`face_identities` rebuild fires `media_faces`' `ON DELETE SET NULL` and silently
nulls every assignment, so it must run while the production face tables are
still **empty**, when there is nothing to destroy.

> ⚠ **Verify that D1 reasoning against `db/schema.js` on the day.** It is the
> single most expensive thing in this project to get wrong, it has never been
> exercised against a populated database, and the argument above is a read of
> the code rather than an observation of it.

**Read `TRAPS.md`'s migration section before starting.** Four things there bear
directly on this session and are in none of the other handover docs: D1's
mechanism; that **migrations are not transactional** (only `rebuildTable` is —
verified, and a naive `grep BEGIN` says the opposite because 67 of them are
trigger bodies); that `rebuildTable` is the required shape for any rebuild; and
that SQLite compiles trigger bodies lazily, so a trigger over a not-yet-existing
column succeeds silently and breaks inserts later.

**After this deploy, permanently:** any future migration that rebuilds
`face_identities` is a live hazard, because the tables will no longer be empty.

**Also here:** the site is live from this point. Everything after assumes real
guests may be writing to that database at any moment.

## 6 — The production face pass

**Goal.** The photographs, the face rows and the naming, on the live server.
**This has never run.**

**Hand over:** `VISION-STATUS.md` · `DECISIONS-vision.md` §8–§10 ·
`scripts/vision/export-face-work.js`'s file header (it is the real spec).

**What runs where** — settled 2026-08-06, and narrower than it looked:

| Step                              | Where                                     | Engine + weights?                |
| --------------------------------- | ----------------------------------------- | -------------------------------- |
| `import-media --url=` (HTTP sink) | local → prod                              | no                               |
| `--backfill-manifest`             | VPS (re-hashes stored originals)          | no                               |
| `ingest-faces.js`                 | VPS (needs the prod DB + the run's JSONL) | **no**                           |
| `export-face-work.js import`      | wherever the DB is                        | **yes, unless §10's fix landed** |

Detection already happened locally; ingest is a content-hash join. The only step
wanting the borrowed engine is the artifact import's **provisioning digest
check**, which session 3 should have turned into `--expect-engine`.

**Explicitly rejected:** pulling the production database down, running the pass
locally, and pushing it back. The site is live by now, and every guestbook
entry, RSVP, comment, reaction and upload landing during that window is silently
destroyed by the push.

**Expect defects.** Every first contact with real data in this project has
surfaced several — the 2026-08-04 session found four, none of which any test
could have caught. Budget for that rather than for a clean run.

**Before starting:** back up what does not regenerate —
`scripts/vision/labels-backup.js`, plus `tmp/rig/engine.mjs` by hand, since no
module in the repo names it and nothing here can rebuild it.

## 7 — Doc closeout and archive

**Goal.** Leave one true document and a clearly-marked history.

**Hand over:** this file · `VISION-STATUS.md` · `docs/post-wedding/`.

**Already done, 2026-08-06** (by the owner, mid-session — this session shrank
accordingly). Eighteen files moved to `docs/archive/`: the eight numbered
feature specs, the four dated `SESSION-*-vision.md` records,
`HANDOFF-session-1-vision.md`, `RESEARCH-face-recognition.md`,
`review-adjudication.md`, `demo-walkthrough.html` and
`what-counts-as-a-dependency.md`. `docs/post-wedding/` is down to eight live
files, and the top-level listing is honest for the first time.

**The work that remains.**

- **Fix the references the move broke.** Verified broken on 2026-08-06 and
  **not yet fixed**: `CLAUDE.md` points at `docs/what-counts-as-a-dependency.md`
  and `docs/post-wedding/08-bulk-import.md`, both of which are now under
  `docs/archive/`. `CLAUDE.md` is the first thing every agent reads and it is
  gitignored, so nothing will catch this but a person. (This file and
  `VISION-STATUS.md` were repointed the same day.)
- **Decide whether "archived" is the right status for the feature specs.**
  `00-overview.md` is described in `CLAUDE.md` as *binding*, and
  `08-bulk-import.md` documents a CLI that still ships. Archiving something
  still binding is a category error worth resolving deliberately — either they
  come back, or `CLAUDE.md` stops calling them binding.
- **Collapse the owner's plan file into `VISION-STATUS.md`.** Its traps are
  already extracted into `TRAPS.md`; what is left worth keeping is the
  *reasoning* — why the sequencing was what it was. Then retire it.
- **Update `CLAUDE.md`'s project tree** — it has drifted behind several
  `scripts/vision/` additions (`convert-labels-to-face-work.js`,
  `regrade-faces.js`, `compare-models.js` among them).
- **Answer or explicitly park the last open questions:** video in scope
  (`DECISIONS-vision.md` §10), how far the craft phase reaches, and which
  guest-facing surface gets tags (§9).

---

## Standing hazards, for any session here

- **Static assets are gzipped at boot.** Restart the server after editing served
  CSS or JS.
- **An empty `grep` result is not proof of absence.** A file containing a NUL
  byte is classified as binary and returns no matches for anything, with exit
  code 1. This has bitten twice.
- **Gates before any commit:** `npm test` and `npm run typecheck` (both
  tsconfigs — bare `tsc` misses `public/`). Both are clean today, so a failure
  is yours.
