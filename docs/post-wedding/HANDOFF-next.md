# Hand-off: what's left before the photos go live (written 2026-11-05)

**Start here.** This replaces the "what's next" parts of `HANDOFF-launch.md`. Read `CLAUDE.md`
first, as always. Then read §1 before saying anything to the owner.

## 1. How to work with the owner right now

- **Every message that waits on the owner must stand on its own.** While agents report back, many
  messages can arrive between the owner's replies, and earlier ones scroll out of sight. So the last
  message before you wait must repeat everything the owner needs to act: the exact commands, paths,
  and open questions. Never write "as above" or point back to an earlier message. Length is fine;
  having to scroll back is not. The 2026-11-05 session got this wrong repeatedly.
- **Don't use devloop's Accept/Reopen panel to get verdicts.** The owner finds it useless: it shows
  only a screenshot, with no title, note or summary of the change (`DEFERRED.md`, "Design fixes that
  missed"). Instead, describe each fix in a sentence in chat and ask yes/no. Then record the answer
  yourself with `node ~/.claude/skills/cli.js issues accept|reopen …`.
- **Design rule from the owner:** before any redesign, have them spell out what good looks like, and
  restate it back. Two agent guesses at "clearer" already missed (`DEFERRED.md`).
- **Ask before** pushing `main`, deploying, or any production write. Access cleared for this work:
  `../homelab`, `../wedding-backup/face-artifacts` (as a backup destination), and SSH to vps3. Confirm
  the SSH one again; it was granted in an earlier session.

## 2. What's left, in order

1. **Cull** (owner). Steps are in §3. The output is a `selection.json` file, which you back up
   (§3, step 5) and never open.
2. **Dress rehearsal** (Phase D). The owner names a small photo folder: about 10–20 photos, a video,
   a few faces. Against a throwaway local server, over HTTP, run import with `--selection` → backfill
   → ingest → export → import → revoke → re-import. Include hidden rows, fix what breaks, then delete
   the scratch data. This has never run end to end.
3. **Deploy #2** (`HANDOFF-launch.md` §3 is the procedure).
   - Resend key, `FROM_EMAIL` and `CONTACT_EMAIL` go into `../homelab/services/wedding/secrets.enc.yaml`.
     The owner has the values and a verified domain.
   - Scan the whole push range for hosts, secrets, photos and DBs. **Ask**, then
     `git branch -f main face-tagging && git push origin main`.
   - Snapshot the prod DB, rehearse the migrations (there are new ones today: check `db/schema.js` and
     the session `last_activity_at` change), run `node cli/homelab.js deploy wedding`, then check
     `/api/health`, logs and integrity.
   - Send a real recovery email and a real card email.
   - **Test the backups:** the server now writes an hourly `VACUUM INTO` snapshot beside the DB
     (`db/snapshot.js`). After a night's run, restore one with homelab's `drill` command
     (`../homelab/cli/commands/drill.js`) and open it.
4. **Production face pass** (Phase F; commands in `HANDOFF-launch.md` §4.3).
   - Import is now `npm run import:media -- <dir> --url=https://jordanaandjesse.com --selection=<file>
     --manifest=tmp/face-pass/prod-import-manifest.json --dry-run`, then the same command without
     `--dry-run`. The owner supplies the directory and types the password.
   - A later run to the same site needs `--selection` again. `--apply-selection` fixes rows that
     disagree with the selection. Check `--help` for both.
   - Before the face export, generate the local page showing display names shared by two people. The
     owner opens it; you don't read it.
   - **Delete every staged file on vps3** afterwards. Faces #2 (people lumped into one group) gets its
     real verdict here.
5. **Closeout:**
   - Owner's phone test on cellular (`DEFERRED.md`).
   - Uptime and disk alerts if there's time.
   - Update `CLAUDE.md` (see §6).
   - Scratch cleanup, with the owner confirming the list (§5).

Phase H (open source) is out of scope until all of this is done.

## 3. Culling, step by step (give the owner these one at a time)

The scores are already computed (`tmp/cull/`). Nothing needs re-scoring.

1. Build the page, using the same photo folder the scorer used:
   `node scripts/vision/cull-data.js <photo-dir> --labels tmp/session4/labels.json --identities tmp/session4/identities.json`
2. `open tmp/cull/cull.html`. Use one tab. Press `?` there for keys.
3. Work through the groups: `Enter` keeps the suggested frame and moves on, `p` keeps the frame
   you're on instead, `Space` / `x` keep / hide one frame, and `u` undoes. `c` shows people with few
   good photos left.
4. Videos: press `v`, then `Space` / `x` per video and `n` for the next. Undecided videos import
   hidden.
5. Press `e`, then **Download selection.json**. Then back it up:
   `node scripts/vision/labels-backup.js --selection <path-to-selection.json> --to ../wedding-backup/face-artifacts`

Nothing goes public unless it's kept, and anything skipped can be shown later from the admin gallery.
So this doesn't need to be perfect. Decisions persist in the browser, keyed by content.

## 4. Done on 2026-11-05 (all on `face-tagging`, nothing pushed)

| Area | What |
| --- | --- |
| Old issues | All 18 of the old issues were reviewed with the owner. 17 are accepted. #11 (sparkles) is resolved and waiting for the owner's yes. |
| New issues | #16–#18 and #19 (see §5). Faces #2 stays open until the real face pass. |
| Effects | Per-page placement (`pages` config key, admin table at `/admin/site/effects`). Cursor trail and sparkles run site-wide, and the sparkles sit behind content. |
| Guestbook | "Print a fancy version of the guestbook" replaces "memory book". The 8px sideways scroll is fixed. |
| Gallery | Curated sections page past 500. A guest sees their own pending photos. Curated photos cache for 10 minutes (was a year). |
| Importer | A later run without `--selection` is refused. Flipped selections are listed and fixed with `--apply-selection`. Storage estimates are honest. `.env` is loaded. |
| Culling page | Undecided videos stay hidden. Tabs merge. Decisions are keyed by content. Loading a selection means exactly what it says. Output stays under the repo's `tmp/`. |
| Admin | Guests and Accounts are one "Guests" list. Faces shows an empty state with no data. Review bulk tick is 44px, its primary button isn't danger-red any more, it uses wide screens, and the trust prompt waits until a sender's posts are all approved. Gallery manager has 44px controls and drag-to-reorder. |
| Sessions | New sessions get an ISO `last_activity_at` (the hourly cleanup was deleting fresh logins). Eviction drops the longest-idle session. |
| Backups | Hourly WAL-safe snapshot, newest 24 kept (`db/snapshot.js`). |
| Docs | `DEFERRED.md` "Design fixes that missed". `SESSION-1-devloop-notes.md` D-6 to D-12. |

The admin logouts were diagnosed: there's no timer bug. The likely causes are a hidden tab or a
sleeping machine for more than 30 minutes, five other logins evicting this one (fixed), and
`session`/`csrf` cookies shared across `localhost` ports.

## 5. Loose ends

- **Issue ledger** (`.claude/issues`): #11, #16, #17 and #18 are resolved and awaiting the owner's
  yes. Ask in chat, one sentence each. #19 is reopened and deferred. `.claude/issues-faces`: #2 open.
- **Owner decisions the Review fix left open.** Ask these briefly; don't re-litigate:
  - **Auto-trust changed.** Approving one post, or a bulk tick, no longer auto-trusts the sender. A
    "Trust them" button appears once everything from that sender is approved. "Approve all" still
    auto-trusts. Is that the scope they want?
  - **Colour.** Primary buttons are now the brand coral with dark text, and destructive buttons carry a
    red tint. The owner had floated pink or yellow.
  - **Wide screens.** The admin's 1200px cap is gone. Review got a two-column detail and a draggable
    divider. Guests, Requests, Cards and Faces now leave empty space on the right at wide widths.
- **Processes:** none left running. The leftover preview (:3120/:3129), the October review server
  (:3031), and this session's preview (:3100) and capture (:4600) servers were all stopped at the
  end of the 2026-11-05 session.
- **Agent worktrees** under `.claude/worktrees/agent-*` (plus two older ones holding only Chrome
  profiles). Every commit worth keeping is on `face-tagging`. Ask, then
  `git worktree remove` / delete the branches.
- **Unreachable code** after the Guests merge: the old Accounts screen in
  `public/pages/admin/moderation.js`, `#ac-split` in `admin/index.html`, and its CSS in
  `admin-review.css`. Delete it. Review's author-card link still says "Account".
- **Scratch:** `tmp/step1/` (logs, after shots), `tmp/capture-tour-profile`,
  `tmp/step1/chain-profile`. The earlier plan's cleanup table still applies to the rest of `tmp/`.

## 6. Rules this session learned

- **Tests:** each integration file fixes its own port (`TEST_SERVER_PORT || "30NN"`). Never set
  `TEST_SERVER_PORT` globally for `npm test`: everything collides. Parallel worktrees can't run
  `npm test` at once either. Agents run `npm run test:unit` plus single integration files on their own
  port, and the main session runs the full suite after merging. An EADDRINUSE in a full run means a
  stale server: rerun that file.
- **Worktree agents start on an old commit** (`main`). Tell them to `git merge --ff-only face-tagging`
  first and to copy `CLAUDE.md` in. Merge their work with `git cherry-pick`.
- **Verify agent claims about files.** One reported a screenshot that didn't exist.
- **`CLAUDE.md` is behind (gitignored, edit locally):**
  - `db/snapshot.js`, `scripts/vision/scratch-dir.js`.
  - The `--selection` / `--apply-selection` / `--no-selection` rules.
  - Cull output must be under the repo's own `tmp/`.
  - The Guests merge.
  - `cdp.js --touch`.
  - `DB_SNAPSHOT` in `types.js`.
  - The older drift is listed in `HANDOFF-launch.md` §4.8.
- **No photo-derived numbers in any repo file**, this one included.
