# Hand-off: launch (2026-10-31 → 11-01)

The single current record of getting the post-wedding site **finished, deployed and
face-tagged**. It supersedes `HANDOFF-session-3.md` (kept for history and for its §1 rules
and §7 "don't re-derive" notes, which still apply). Read `CLAUDE.md` first, as always.

**Where it stands in one paragraph.** Production (jordanaandjesse.com, on **vps3**) runs
`05dae87`: the full Workspace admin, the note-flower guestbook, and the tuned face pipeline
(`route-r3`). The face tables there exist and are **empty**. Two more commits are on
`face-tagging` and **not pushed or deployed**, because the owner said wait. They are
the **Honeymoon gallery section** (`35b21d0`) and **guest-name suggestions** in Faces → People
(`b99049d`). The owner has **a few more last-minute changes** to describe first, then the
order is: make those → deploy #2 → production face pass → phone smoke test.

---

## 1. Rules this stretch learned (in addition to `CLAUDE.md` and `HANDOFF-session-3.md` §1)

- **Production is vps3, deployed by the homelab repo**, not by this repo. Its host, user and
  ssh port are in `../homelab`, and stay out of this public repo. The deploy definition is
  `../homelab/services/wedding/service.js`, which deploys `ref: main` into `~/services/wedding`
  and renders `.env` from the sealed `secrets.enc.yaml`.
  - The other VPS is a **spare** that serves nothing.
  - This repo's CI is tests-only (`.github/workflows/ci.yml`).
  - `scripts/deploy.js` is a stub that prints the homelab commands.
- **`homelab deploy` does no DB backup and no app health poll.** Take a snapshot first and
  check `/api/health` after (§3). It also refuses a dirty `~/services/wedding`.
- **Never run the photo-reading steps yourself.** The photo directory is always the owner's
  argument, and the owner types the prod admin password at the importer's hidden prompt.
- **SSH to prod needs the owner's OK** (the auto-mode classifier blocks "production reads").
  The owner granted it on 11-01 for this work; a new session should confirm again.
- **Remote quoting trap:** nested quotes in `ssh '... docker exec ... node -e "..."'` get
  mangled twice. Write the script to a local file and pipe it:
  `ssh … 'docker exec -i wedding node --no-warnings -' < tmp/script.cjs`. This is how §3's
  snapshot works.
- **The live image is the deployed one.** Scripts exist in the container only after a deploy:
  `backup-db.js` exists now, but did not before `05dae87`.
- **A Traefik static-config change needs a restart.** `restartOnFiles: true` is now set on
  homelab's traefik service, so `homelab deploy traefik --apply --yes` restarts it, which is a
  1–3 s outage for **every** site on vps3. Always say so first.
- **No measurement of the photographs goes in the repo**, including counts from the tuning
  pass. The method is in `public/vision/defaults.js`; the numbers live only in the
  conversation and in `tmp/`.

## 2. What was done (all committed)

On `face-tagging`, oldest first. `main` = `origin/main` = `05dae87`.

| Commit | What |
| --- | --- |
| `dcd93be` | `docs/archive/` gitignored (owner: local scratch only); the archived specs were removed from git; `LIGHTHOUSE_CHANGES.md` moved under `docs/post-wedding/`. About 20 code comments still cite archived specs; dead links are acceptable (owner). |
| `b760cd9` | One quarantine mover (`quarantineDirAs`) for every orphan. The sweep's misplaced-prefix branch had no collision suffix and no quarantine-time stamp, so the TTL purge could delete the orphan in the same pass. Gallery curation no longer re-renders the grid on a no-op position edit, which used to wipe unsaved captions. |
| `0b1eebb` | `TODO.md` retired: all 18 findings fixed or obsolete. `DEFERRED.md` caught up. |
| `1f80498` | CI test-only; `scripts/deploy.js` stub. The old deploy job SSHed to the spare. |
| `fcf08d7` | **Tuning pass → `route-r3`**, with the owner's picks: <ul><li>`route.acceptMinSharpness` raised, so blurry faces are asked about rather than auto-accepted;</li><li>a pose bar on accept was considered and **not** added;</li><li>`assign.suggestMinMargin` = 0.10, derived by held-out simulation;</li><li>**set-aside faces no longer seed groups** (`groupThenAttach` in `public/vision/group.js`). They attach afterward to their nearest group, shown dimmed, so junk can't chain people into one group. That was the cause of faces #2.</li></ul> |
| `05dae87` | `HANDOFF-session-3.md` part 5. |
| *(deployed)* | `05dae87` → vps3, see §3. |
| `b99049d` | **Faces → People:** <ul><li>unlinked people show the invitations their informal name probably is ("Mike" → "Michael & Dana Rossi", "Aunt Sue" → "Susan Park"), with one click to link and a "maybe …?" hint on the list row;</li><li>a linked person with a different name gets **Rename to "<guest-list name>"**, offered and never automatic;</li><li>namesake guests get distinct labels (email, phone or invite code).</li></ul>Matching lives in `public/pages/admin/guest-match.js` (pure, tested). **Not deployed.** |
| `35b21d0` | **Honeymoon gallery section** (built by a sub-agent; reviewed and merged): <ul><li>`section = 'honeymoon'`, admin-only like Official: auto-approved, its own `sort_order`;</li><li>`/gallery` tab hidden while empty; `?section=honeymoon` deep links work;</li><li>admin Gallery → Honeymoon, with upload, reorder, and Move to Official ⇄ Honeymoon (new `POST /api/admin/media/:id/section`);</li><li>importer `--section=honeymoon`;</li><li>a guest naming the section is silently coerced to `guest`, the same as for official;</li><li>the card composer's photo picker and "Photos they're in" include honeymoon.</li></ul>Migration `add_honeymoon_section` only drops and recreates the two section CHECK triggers, transactionally; it does not rebuild the table and touches no rows. **Not deployed.** |

Gates at `35b21d0`: `npm run typecheck` clean; `npm test` **2388/2388**, none skipped.

**In homelab:** `9aa39c35` sets `readTimeout: 10m` on Traefik's `https` entrypoint (the v3
default of 60 s would cut slow phone uploads off; the app allows 600 s) and adds
`restartOnFiles`. It was deployed, and every site matched its baseline after the restart.
The owner's own uncommitted `docs/plan/08-other-kinds.md` there was left alone.

**Housekeeping:**
- All agent worktrees were removed. Every unmerged commit they held is on a `design/*`
  branch, and those branches are kept.
- **Labels backup:** `../wedding-backup/face-artifacts/labels-backup-2026-11-01T01-07-23Z/`
  (`labels.json`, `identities.json`, `timing.json`, verified). `engine.mjs` beside it was
  already identical to `tmp/rig/engine.mjs`, digest `0aaef800…`.

## 3. The first deploy, and how to repeat it

Production was on **`5dbb861` (January 2026)** before this, 171 commits behind. The steps
taken, in order (repeat them for deploy #2):

1. **Rehearse the migrations** on vps3 against a copy of the live DB.
   - Stage the code and the copy: `git archive <commit> | ssh … tar -x -C /tmp/wedding-rehearse/app`,
     plus a `VACUUM INTO` copy of the live DB.
   - Migrate the copy in the Dockerfile's pinned image:
     `docker run --rm -v …:/w -e DATABASE_PATH=/w/rehearse.db node:22-alpine@sha256:16e22a55… node -e "init()"`.
   - Diff the per-table row counts and columns, and boot `server.js` on port 3999 to probe pages.
   - **Delete `/tmp/wedding-rehearse` afterwards.** It holds guest data.
   - Result: 20 migrations in 57 ms, integrity ok, 0 FK violations, no rows or columns lost,
     every page 200. For deploy #2 the only migration is `add_honeymoon_section`, which is
     trigger-only, so rehearsing is optional but cheap.
2. `git branch -f main face-tagging && git push origin main`. This repo is public: scan the
   push for secrets, photos and DBs first. (The design-tour JPEGs in `prototypes/tour/shots/`
   are renders of fictional fixtures.)
3. Snapshot the live DB into the volume by piping a script (§1), e.g.:
   ```js
   const { DatabaseSync } = require("node:sqlite")
   const out = "/app/data/backups/pre-deploy-YYYYMMDD.db"
   new DatabaseSync("/app/data/wedding.db").exec(`VACUUM INTO '${out}'`)
   ```
   Then check `PRAGMA integrity_check` on it. Or, now that it's deployed:
   `docker exec wedding node scripts/backup-db.js`.
   Existing: `/app/data/backups/pre-deploy-20261101.db`.
4. In `../homelab`: `node cli/homelab.js deploy wedding` (the plan; read it), then
   `node cli/homelab.js deploy wedding --apply --yes`. Its verify step compares all 7 vps3
   hostnames to the baseline.
5. After: `curl https://jordanaandjesse.com/api/health`; `docker logs wedding` should be clean
   (the "Could not load .env file" warning is harmless, because compose injects the env);
   check the migrations count and integrity in the live DB.

**Production config facts:**
- Compose sets `NODE_ENV=production`, `PORT` and `BASE_URL`.
- The sealed `.env` holds only `ADMIN_PASSWORD_HASH` and `TRUSTED_PROXIES`.
- `npm run doctor` with the prod `.env` reports no failures.
- Disk is fine: 86 G free on `/`.
- Off-host backups: homelab's nightly restic job (`homelab-backup.timer`, to two off-host targets).

## 4. What still needs doing, in order

1. **The owner's last-minute changes.** They were about to describe more when they left.
   Ask first. Their UX/DX notes from the session-3 review are also still queued
   ("can wait until later").
2. **Deploy #2** (`b99049d` and `35b21d0`, plus whatever item 1 adds), per §3. The owner said
   *wait* on 11-01, so ask before pushing. **The face pass and any honeymoon upload need
   this deployed first.** An un-updated server would quietly file `--section=honeymoon`
   uploads under `guest`.
3. **Production face pass.** It has never run, so expect defects. The binding specs are
   `SESSION-PLAN.md` §6, the header and `--help` of `scripts/vision/export-face-work.js`, and
   `VISION-STATUS.md` "What remains". Steps:
   1. Gallery import, from the owner's photo directory (their argument; they type the
      password):
      ```
      npm run import:media -- <dir> --url=https://jordanaandjesse.com \
        --manifest=tmp/face-pass/prod-import-manifest.json --dry-run
      ```
      then the same command without `--dry-run`. Add `--recursive` if the directory nests.
      Use the same directory that `tmp/session4` was detected from.
      If the owner culled with `scripts/vision/cull.html`, add `--selection=<their file>`:
      files it leaves out finish hidden. After one selection run, every later run to the
      site needs `--selection` again (or an explicit `--no-selection`), or it is refused.
      A run whose already-imported rows disagree with the selection lists them by name
      and id, exits non-zero, and prints the `--apply-selection` command that fixes them.
      The dry run's storage check includes an estimate for display/thumb variants, and for
      `--heic-original=jpeg` it estimates the larger JPEG.
   2. Copy `tmp/session4/{photos,faces}.jsonl` and that manifest to a scratch directory on
      vps3 that is visible inside the container, then run:
      ```
      docker exec wedding node scripts/vision/ingest-faces.js --backfill-manifest <manifest>
      docker exec wedding node scripts/vision/ingest-faces.js <run-dir> \
        --model-version sface128-n127.5d128-nomirror --dry-run
      ```
      Then without `--dry-run`, on a subset first if possible. The model version and dataset
      (`9fb7be1426bc6410`) match `tmp/smoke.db`'s ingest. Rows are graded under `route-r3`.
   3. Export locally:
      ```
      node scripts/vision/export-face-work.js export tmp/face-pass/face-work.json --database tmp/smoke.db
      ```
      The dry run was clean on 11-01. The artifact carries real names, so keep it under
      `tmp/` only.
   4. Copy it up, then run
      `docker exec wedding node scripts/vision/export-face-work.js import <artifact> --expect-engine 0aaef800504a5fcaa085fdc9c3bb9c487a8279a96b7faf4669fe17b6e88ad58d --dry-run`,
      then for real. No weights or engine are needed on the VPS.
   5. **Delete every staged file on vps3** (JSONL, manifest, artifact).
   6. The owner, in prod `/admin/faces/people`: link people to invitations, using the new
      suggestions from deploy #2. Linking can only happen on prod: the export deliberately
      carries no guest links. Then check Groups, Quick questions and Leftovers.
   - **Never** pull the prod DB down and push it back (SESSION-PLAN §6: live writes would
     be lost).
4. **Phone smoke test** (owner, on cellular; `DEFERRED.md`):
   - register;
   - sign the guestbook;
   - upload a photo and a ~30 MB video (the slow upload proves the Traefik timeout);
   - react, comment, approve;
   - play the video in iOS Safari.
5. **Email/SMS are off in production.** `RESEND_API_KEY`, `FROM_EMAIL`, the Twilio keys and
   `CONTACT_EMAIL` are missing from the sealed `.env`. Without them, emailed/texted
   thank-you cards, account-recovery magic links and the moderation digest all no-op, and
   guests see the placeholder contact address. Copy-link and manual-SMS card sending still
   work. Fix in `../homelab/services/wedding/secrets.enc.yaml` (owner's call), then
   `homelab deploy wedding`.
6. **Issues** (via `/fix-issues`):
   - Propose resolutions for faces #1, #3, #4 (Workspace), faces #2 (route-r3 +
     seed-then-attach) and site #11, #13 (flowers).
   - The owner accepts these, plus site #8, #9, #10, #12, #14, #15, and looks at the
     never-approved #1–#7.
   - Stores: `.claude/issues`, `.claude/issues-faces`.
   - `tmp/issue-summary.mjs` crashed on the faces store on 11-01 (its "from the captured
     page" split didn't match). Read the ledger JSONL directly, text fields only.
7. **Honeymoon follow-ups** (small, optional):
   - In the All view, honeymoon photos sit between Official and Guest with no heading;
     consider a label.
   - Seed scripts don't create honeymoon rows.
   - The honeymoon migration and the new `/section` route aren't described in any doc.
8. **Doc closeout** (SESSION-PLAN §7):
   - **`CLAUDE.md`'s project tree is behind.** Missing: `public/pages/admin/routes.js`,
     `router.js`, `guest-match.js`, `WORKSPACE.md`; `db/guest-photos.js`; `scripts/doctor.js`,
     `backup-db.js`; `scripts/vision/{regrade-faces,convert-labels-to-face-work,export-face-work}.js`;
     `groupThenAttach`; the honeymoon section in the media/section lists and the trigger list.
   - Its "Commands" section has no deploy line: it should say `homelab deploy wedding`.
     (`CLAUDE.md` is gitignored: edit locally.)
   - `HANDOFF-session-3.md` §3.3–3.4 still carry old pathspec instructions; they're
     history, superseded here.
9. **Later, explicitly parked by the owner:**
   - `prototypes/` polish, the slots/mixer theme work, and the open-source/template
     de-personalisation (`DEFERRED.md`);
   - SESSION-PLAN session 2 (`make-a`);
   - the guest-facing face-tag surface (`DECISIONS-vision.md` §9).

## 5. Scratch environment (all gitignored, under `tmp/`)

| Thing | Where / how |
| --- | --- |
| Review server | **`:3031`**, `sh tmp/owner-review/restart.sh`, DB `tmp/owner-review/wedding.db` (fictional; synthetic faces on stub media), password `scratch-pass-1234`. It runs `35b21d0`. The 11-01 click-test left fictional "Grandpa Walt" (person 6) linked to and renamed "Grandpa Walt Lindqvist". |
| Prototype review | `:4700`, `node prototypes/serve.js 4700`. |
| Headless driver | `node scripts/dev/cdp.js <url> <W>x<H> [--eval=f.js]… [--shot=out.png]`. The profile is fresh each run, so pass `--profile=DIR` to stay logged in. `tmp/flower/login.js` logs in. New probes: `people-check.js` and `people-click.js` (Faces → People), `hm-check.js` (gallery tabs). |
| Labelled faces | `tmp/smoke.db`: the labelling plus named people. **Regraded to route-r3**; the pre-regrade copy is `tmp/smoke-pre-r3.db`. Run dir `tmp/session4` (labels + JSONL, dataset `9fb7be1426bc6410`). |
| Tuning | `node scripts/vision/tune.js {calibrate,sweep,groups,leftovers,real-left,full-noaside,margin} <run-dir>`. stdout only, nothing written. It re-derives every tuning decision. |
| Face pass staging | `tmp/face-pass/` (empty; the artifact and manifest go here). |

## 6. Docs worth opening

- `docs/post-wedding/SESSION-PLAN.md`: §5 deploy, §6 the production face pass, §7 closeout,
  and the standing hazards.
- `docs/post-wedding/VISION-STATUS.md`: "START HERE" and "What remains".
- `docs/post-wedding/TRAPS.md`: migrations (D1; non-transactional; `rebuildTable`).
- `docs/post-wedding/DECISIONS-vision.md`: §9 surfaces, §10 the engine on the VPS.
- `scripts/vision/export-face-work.js`: its header is the real spec for moving face work.
- `public/vision/defaults.js`: the tuning-pass note (method only) and the `route-r3` record.
- `DEFERRED.md`: ops items (monitoring, backups via WAL-safe snapshots, the smoke test).
- `../homelab/README.md`, `../homelab/docs/plan/README.md`: the old tool is live and `next/`
  is mid-renovation. Deploy with `node cli/homelab.js`, never anything from `next/`.
- `HANDOFF-session-3.md`: §1 rules and §7 "don't re-derive".

## 7. Incidents

None involving photographs or data outside the repo.
- Photo-derived numbers from the tuning pass stayed in the conversation and `tmp/`.
- The prod-DB rehearsal copy was made and deleted on vps3; it never left the box.
- One pre-existing photo-derived count was found in a `defaults.js` comment (in the
  tuning note's pool-A line) and scrubbed in `fcf08d7`.
