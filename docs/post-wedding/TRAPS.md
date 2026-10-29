# Live traps and defects

**Written 2026-08-06**, extracted from the owner's plan file, which is where all
of this used to live and is no longer a safe place to read it from (see the last
section for why).

**What this is.** The things in this codebase that are *silently* wrong, or that
punish an obvious action. Not a bug list — these are the ones where the failure
produces no error, so nothing will tell you except this file.

**Every entry says how well it is known.**

- **VERIFIED 2026-08-06** — re-checked against the code on that date, evidence
  cited.
- **INHERITED** — carried from the plan file and *not* re-checked. Treat as a
  strong lead, not a fact. Several inherited claims have already turned out to
  be stale, which is why this label exists.

Names, not numbers. The plan file numbered these T1–T20 and **the numbers
collide** — T15, T16, T17, T18 and T19 each name two different traps. Where an
old number is worth knowing it is given as "plan: T3", with the addendum.

---

## Before you touch a migration — session 5's file

### Dropping a table nulls every face assignment
**INHERITED — verify before the deploy. Highest-consequence item here.**
Plan: D1.

`db/connection.js` sets `PRAGMA foreign_keys = ON` *before* migrations run, and
`media_faces.face_identity_id` is `REFERENCES face_identities(id) ON DELETE SET
NULL`. Under that pragma, `DROP TABLE face_identities` performs an implicit
delete of every row and **fires the foreign-key action** — so every assignment
in the database becomes NULL, no error is raised, and the migration records
itself as applied.

Invisible on every developer machine and in every test database, because the
tables are empty when the migration runs. It detonates once, against the data
this project exists to produce.

**This is why session 5 deploys while the production face tables are still
empty.** After that deploy the tables are populated for ever, and any future
migration rebuilding `face_identities` is live ammunition.

### Migrations are not transactional. Only table rebuilds are
**VERIFIED 2026-08-06.** Plan: D3, and the plan's wording is now wrong.

The plan says "there is no `BEGIN` in the file". There are 67 — and **all of
them are `CREATE TRIGGER` bodies.** `db/schema.js` contains exactly three real
transaction statements (`db.exec("BEGIN"|"COMMIT"|"ROLLBACK")` at :377, :387,
:392), all inside `rebuildTable`.

So the live risk stands: an individual migration that throws half-way leaves a
half-built schema with no ledger row, and the next boot re-enters that branch
against it. And because `server.js` calls `init()` on import, a throwing
migration means `npm start` fails outright.

> Do not re-derive this with `grep -c BEGIN`. That returns 67 and reads as
> "thoroughly transactional". It is the same shape of mistake as the plan's own
> NUL-byte lesson: **a grep result is evidence about text, not about meaning.**

### Use `rebuildTable` for any table rebuild
**VERIFIED 2026-08-06** — `db/schema.js:373`. Plan: T3 (Addendum 2).

It owns all four silent-failure safeguards, and the ordering of each matters:
`PRAGMA foreign_keys = OFF` **before** `BEGIN`; `PRAGMA foreign_key_check`
**before** `COMMIT`, so a violation rolls the rebuild back whole; and
**`ROLLBACK` first, pragma second** in the failure path. Its header documents
all four.

`relax_comment_account_null` is explicitly **not** the shape to copy.

### SQLite compiles trigger bodies lazily, at fire time
**INHERITED.** Plan: T17 (Addendum 5).

`CREATE TRIGGER` over a column that does not exist yet **succeeds silently**,
then breaks every INSERT into the watched table — far from the migration that
caused it, and only on databases pinned at the earlier state, which is exactly
the population the `PRAGMA table_info` guards exist to protect.

Guard triggers on their *columns*, not just on their tables.

### A migration records itself as applied even when its guards skip the work
**INHERITED.** Plan: T18 (Addendum 5).

Every migration in `db/schema.js` calls `record.run(name)` unconditionally
(21 call sites). On a database whose prerequisites are absent, the work never
happens, the name is recorded, and no later pass ever retries it. Not introduced
deliberately; worth a decision rather than a surprise.

---

## Before the production face pass — session 6's file

### Duplicate content hashes silently drop faces
**VERIFIED 2026-08-06** — `scripts/vision/ingest-faces.js:294-302`. Plan: D7.

`loadMediaShaMap` builds `Map<sha256, mediaId>` with `map.set(...)` per row, so
**two media rows sharing a hash means the last one wins and the other never
receives faces** — no warning, no count.

The local delivery never triggered this (its `-Copy1` files are edits, so all
bytes differ), which is not evidence it is safe: a guest re-uploading a
photographer's file is the ordinary case that produces it, and production is
where guests are. Fan out to every row sharing the hash, or refuse loudly.

> **FIXED 2026-10-29: fan-out.** `loadMediaShaMap` now returns every row per
> hash. Ingest writes a photo's faces to all of them and prints how many extra
> rows it reached. `export-face-work.js import` matches one key to every row
> carrying it, in `--match-overlap` mode too, where identical boxes used to tie
> as "ambiguous". Tests: `ingest-faces.test.js` ("EVERY media row") and
> `vision-export-face-work.test.js` ("fanned out to two media rows").

### `--replace` soft-deletes the rows confirmations point at
**INHERITED.** Plan: D12.

`retireCliFaces` soft-deletes previous CLI face rows for a `(media_id,
model_version)` pair. Anything referencing those rows must be snapshotted first.

### `media_faces.deleted_at` has more than one author
**INHERITED.** Plan: T10 and T16 (both Addendum 5) — *two different traps under
those numbers*, and they are the same column.

The assignment ledger's `not_a_face` projection writes it, and so do
`db/schema.js`'s precedence triggers, which soft-delete an upload-sourced row
that a CLI row supersedes. A blanket "the projection owns `deleted_at`" would
resurrect every superseded upload row — invisible locally, detonating on the
production pass, which is D1's signature exactly.

The fix that shipped needs both halves: a receipt (`ledger_retired_at`) *and* a
supersession trigger that releases the claim. Authorship alone is not enough,
because the other authors only ever act on live rows and never get to stake a
claim once the ledger has soft-deleted one.

### `face_assignments.identity_id` has no `ON DELETE` clause
**INHERITED.** Plan: T14 (Addendum 5).

A hard `DELETE FROM face_identities` is therefore blocked whenever any event
names that identity. That changes hard-delete semantics repo-wide, nobody
designed it deliberately, and it is arguably right — recorded because it was
discovered by a test breaking rather than by intent.

### Known gaps, named rather than forgotten
**INHERITED**, all from Addendum 5. None is a blocker; each is a sharp edge.

- A `redescribe-crops` output cannot be ingested — the provenance could compose
  into a valid `vision_ingests` row, but the instruction was to fail closed and
  the extension was never built.
- "Refuse on conflict" contradicts "match people by content". If an incoming
  person's only matched face is already confirmed as someone on the target,
  content matching says they *are* that person whatever the two machines call
  them. The reachable conflicts are `person-split`, `person-collapse` and
  `not_a_face` against a confirmed face.
- A set-aside face on a **soft-deleted** media row is unreachable: the header
  count is over live faces, the list is over live photographs, so those faces
  are counted with no row beneath. The panel says so in words rather than
  rendering an empty list that reads as a bug.
- `negativesForFace`, the `negative` op, and `replayFace`'s `ignoreBatchId` have
  **no production caller**. Tested, never exercised in anger.
- Revoking a `propagate` batch leaves its `provenance:'propagated'` identity row
  live with zero faces, and `liveIdentityCountForPerson` counts identities — so
  deleting that person then refuses with "still has 1 live face identity" for a
  person no face points at.
- The single-writer scan **cannot see `ON DELETE SET NULL`** on
  `media_faces.face_identity_id`. That is a genuine second writer no source scan
  could catch, so the test's claim is stronger than the schema's guarantee.

---

## If any labelling is ever redone

**All INHERITED.** Plan: T1, T4 (Addendum 2); D4, D5, D6 (body §2).

- **A run directory freezes `label.html` *and* `label-data.js` at batch time.**
  A v1 `label-data.js` carries no `datasetId`, so the page sets it to null — and
  the mismatch refusal is gated on `datasetId !== null`, so it **short-circuits
  and verifies nothing**, with no warning either way. A load "succeeding" that
  way means the check was disabled, not that it passed. Fix:
  `node scripts/vision/relabel-data.js <run-dir>`.
- **Growing pool A promotes faces that already carry pool-B labels**, and the
  page will not re-present them as outstanding because it restores from
  `localStorage`, not from `labels.json`.
- **Person keys are scrambled on every export, by design** — the numbering
  carries nothing. One permutation is applied to `labels.json` *and*
  `identities.json` together, so any tool rewriting one must rewrite the other
  under the same remap. On import, keys are re-allocated and never trusted.
- **`labels.json.excluded` is keyed by group id, and group ids renumber.**
  Exclusions cannot be copied across runs as-is.
- **The page ignores `pool` and `group` on import**, always taking pool
  membership from the run's own `label-data.js`.

---

## Standing, and already in `SESSION-PLAN.md`

Repeated here only so this file is a complete index.

- **`npm test` could be pointed at the production database.** A convenience that
  reads an environment variable *someone else's documentation tells you to set*
  is a trap by construction. Fixed by renaming the override to
  `TEST_DATABASE_PATH` plus a hard refusal for any test database resolving
  inside `data/`. Plan: T15 (Addendum 5).
- **Static assets are gzipped at boot** — restart the server after editing
  served CSS or JS. Plan: T17 (Addendum 6).
- **The CSP blocks *parsed* `style="…"` attributes**; CSSOM writes are fine.
  Three admin tabs carry templates that silently never apply. Plan: T18
  (Addendum 6). Session 3 clears it.
- **A NUL byte makes `grep` report no matches for anything**, with exit code 1.
  An empty search result is not proof of absence. Plan: T19 (both addenda).
- **Inline JSDoc casts must stay on one line.** A type broken across lines
  silently mangles the parenthesised expression at runtime. Plan: T20.

## Closed — do not re-raise

Each was real and is fixed. Listed because two of them have already been
re-reported by later sessions that found the old note and not the fix.

| Was | Why it is closed |
|---|---|
| The `actor` column "leaks a credential" | It holds a **digest**. `withAdmin` passes the sessions row through and `db/sessions.js` stores `hashToken(token)`. Eight hex characters of a SHA-256 authenticate nobody. **Raised falsely twice.** Plan: T2, T13 |
| Mirror-averaged descriptors never ingested | Descriptors are canonical since `ca71a28`, and mirror-averaging lost the comparison anyway. Plan: D2 |
| Quality signals stored and never read | Routing reads them. Plan: D8 |
| The roster cannot express the cast | The `people` table shipped. Plan: D10 |
| The tab crashed on the first name typed | `JSON.stringify(Infinity)` is `null`; `margin` is `number \| null`. Plan: T11 |
| `CLAUDE.md` is gitignored | Owner ruling: permanent. `cp` it into a worktree. Plan: T12 |
| Manifest row ids die with their database | The backfill re-hashes and treats the manifest as authorization, never an id map. Plan: T15 (Addendum 6) |
| Face chips render as blank background | `img { max-width: 100% }` clamped the crop. Plan: T16 (Addendum 6) |

---

## Why the plan file is not the place to read this from

`~/.claude/plans/we-ve-been-working-on-resilient-yeti.md` is ~1,500 lines with
seven addenda, of which **1–6 are superseded**. Three specific problems make it
unsafe to hand to an agent:

1. **The trap numbers collide.** T15, T16, T17, T18 and T19 each name two
   entirely different traps, in Addenda 5 and 6. A cross-reference to "T16" is
   ambiguous, and the two candidates are a CSS bug and a schema-authorship bug.
2. **Its defect catalogue is partly stale, and the staleness runs in the
   dangerous direction.** D2, D8 and D10 are described as live blockers and are
   all fixed. An agent working the list would "fix" solved problems and, worse,
   would trust the framing around the ones that remain.
3. **It is a narrative, not a reference.** The reasoning is genuinely valuable —
   it is the best record of *why* the sequencing was what it was — but you have
   to read six superseded addenda to find out which paragraph is current.

**So: keep it, read it for reasoning, and cite this file for facts.** Session 7
folds the rest of its still-useful content into `VISION-STATUS.md` and retires
it.
