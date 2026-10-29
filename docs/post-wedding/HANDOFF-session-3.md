# Hand-off: session 3 (2026-10-28 → 29)

Session 3 in `SESSION-PLAN.md` was "fix the faces UI issues". The owner widened
it to all twelve open issues, absorbing session 4's non-vision backlog. It ran
in two parts: part 1 (one context, which ran out) and part 2 (this rewrite).
This document is the single current record of both, and replaces part 1's
hand-off.

**Where it stands in one paragraph.** Six of the twelve issues are fixed and
proposed as resolved, awaiting the owner's acceptance: site #8, #9, #10, #12,
#14 and #15. Five of the other six wait on one owner action, **picking from the
design review** at `node prototypes/serve.js` → http://localhost:4700/. That
review covers nine guestbook / memory-book sketches and three admin redesigns,
and it unblocks site #11 and #13 and faces #1, #3 and #4. The sixth, faces #2,
is half done; its other half is the vision tuning pass, which the owner wants
to watch.

---

## 1. Read first: rules this session learned or reconfirmed

All in addition to `CLAUDE.md`.

- **Never screenshot `/`.** It shows the couple's photograph. Tell every
  subagent this explicitly. Part 1 had an incident (§9).
- **Artwork the owner cleared for viewing:** `/images/top-mobile*.webp`,
  `bottom-mobile*.webp` and `top-desktop*.webp` (the guestbook/gallery/RSVP
  header waves). Nothing else under `public/images` is cleared.
- **Seeded gallery media are 64-byte JPEG stubs** (`tests/media-fixtures.js`
  `makeJpeg`): broken images, not photographs. A render of the gallery over the
  scratch DB contains no photograph.
- **`scripts/seed-preview.js` now honours `DATABASE_PATH`** (fixed this
  session). It is safe to seed a scratch DB with
  `DATABASE_PATH=$PWD/tmp/fix/wedding.db node scripts/seed-preview.js --gallery 12`.
  Boot the server on that path first so the full schema exists.
- **Worktree subagents start without `CLAUDE.md` or `.claude/settings.json`**
  (both gitignored), so the photo-snooping hook is absent. Point them at
  `/Users/jessepence/repos/wedding/CLAUDE.md`, restate the photo rules, and
  give them the base commit to check against.
- **Every `Agent`/`Workflow` call must set `model`** (owner's global rule).
- **The static server gzips CSS/JS at boot.** Restart after editing served files.
- **Commit with a pathspec.** The owner's own uncommitted `docs/` →
  `docs/archive/` move is in the working tree, along with untracked
  `LIGHTHOUSE_CHANGES.md` and `SESSION-1-devloop-notes.md`. Don't sweep them in.
- **zsh does not word-split `$VAR`.** For a commit pathspec list, use
  `set -- a b c; git commit -- "$@"`.
- **No-semicolon style trap:** a line starting with `(` or `/** @type */ (`
  glues onto the previous line. Bind it to a `const` first.

## 2. The scratch environment (all gitignored, under `tmp/`)

| Thing                    | Where / how                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scratch DB               | `tmp/fix/wedding.db`. Holds 12 stub media, 3 guestbook entries, a photo-free thank-you card `EMOJTST1`, and `app_state.admin_hash` for the password **`scratch-pass-1234`** (scratch only; the real `.env` hash is untouched).                                       |
| Scratch server           | `sh tmp/fix/restart.sh` runs it on :3030 against the scratch DB. Currently stopped.                                                                                                                                                                        |
| Headless driver          | `node tmp/fix/cdp.mjs <url> <W>x<H> [--eval=file.js]… [--shot=out.png] [--print-media]`. Evals run in order, and each one's value is printed. Probe scripts used this session sit beside it (`hit.js`, `reauth.js`, `reply8.js`, `picks.js`, …).                              |
| Renders                  | `tmp/fix/shots/` holds the issue after-renders and the tour screenshots.                                                                                                                                                                                                         |
| Design review server     | `node prototypes/serve.js 4700`. It was left running at the end of the session (pid may differ).                                                                                                                                                                         |
| Issue CLI                | `node /Users/jessepence/.claude/skills/cli.js issues …` (through the `fix-issues` skill). `tmp/issue-summary.mjs <store> <ids…>` prints the useful fields.                                                                                                       |

---

## 3. Done this session

Commits on `face-tagging`, oldest first (part 1's is `725373f`). After each:
typecheck clean, `npm test` green, ending at **2301/2301**.

| Commit    | What                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `725373f` | _(part 1)_ #12: registry hidden after the wedding. #9: gallery tab spacing. #10: lightbox Share was covered by the panel.                                                                                                                                                                                                                                                                                                        |
| `9a65aae` | #14: header art cropped to its wave band (the capture was at 1710px, i.e. the desktop art), and the -15% tuck dropped on content pages. #15: counter ↔ Sign gap. **T18 + monograms:** no client template emits `style=` (CSP-blocked); monogram hue is now 12 classes (avatars were all blue); upload bars use CSSOM; there is a new scan test. `seed-preview.js` honours `DATABASE_PATH`.                                      |
| `8482dae` | **Slots contract** (`docs/post-wedding/DESIGN-SLOTS.md`). Registry entries take a `pages` list (round-1 C's binary scope, generalised); the six landing set pieces are `["home"]`. `effects/autostart.js` and `pages.js` were added (not yet wired into any page). Also `prototypes/serve.js` and the shared fixture `prototypes/fixtures/entries.json` (fictional guests).                                         |
| `b42f50f` | **Faces #2, part 1.** A group suggestion must clear a bar (`assign.suggestMaxDistance` 0.64, a reference value; `suggestMinMargin` 0.05, an UNTUNED placeholder) or it shows "no confident match". Groups are ordered clearest-first (a majority of members accept-routed), then by size. Group `key` is now the lowest shown face id, which is stable across reloads. One integration test asserted the old wrong behaviour and was corrected. |
| `0106c58` | **#8, free emoji reply.** `public/components/emoji.js` `isSingleEmoji` (Intl.Segmenter plus a code-point table, no regex) is shared by server and page. `/thanks` has 12 quick picks plus an "any emoji" box. Glyphs are stored. Migration `reply_emoji_glyphs` runs in an explicit transaction and rewrites old keys. Legacy keys from cached pages map to glyphs.                                                                                  |
| `ec02d9a` | **`--expect-engine`** on `export-face-work.js import`: digest-only mode for the VPS, where neither engine nor weights are needed; without `--weights`, the artifact's weight digests must be pinned. **Duplicate content hashes** fan out to every media row (TRAPS D7 marked FIXED). The overlap matcher collapses identical boxes.                                                                                                |
| `8c015f4` | Face chips load the 400px `thumb` when it already covers the chip (`chip-variant.js`).                                                                                                                                                                                                                                                                                                                                       |
| `e571b37` | **Admin groundwork, IA-agnostic:** `core/static.js` serves the admin shell for any extensionless `/admin/*` (tested: CSP and `X-Frame-Options` kept; look-alikes 404). **A 401 mid-session opens a "Sign back in" dialog over the dashboard**, keeping tab, drafts and dialogs; a cold start still gets the login screen.                                                                                         |
| `0434bb6` | **Several admin sessions** (owner decision): a login no longer deletes other sessions; it keeps the newest `SESSION.MAX_CONCURRENT` (5). This was the leading explanation for "kept logging out on :3002".                                                                                                                                                                                                                 |
| `8edf6ba` | Slots contract gains `ornament(entry)` on cards and a fifth slot, `arrangement`. Both were found independently by two sketch agents.                                                                                                                                                                                                                                                                                            |
| `4933c4b` | **The unified design review**: all six round-2 prototype folders under `prototypes/`, with a review app at `/` (§5).                                                                                                                                                                                                                                                                                                        |

**Verification worth knowing about:**
- **#10:** a hit-test at 1710, 1280, 1024 and 800px finds the buttons clickable. Restoring the old two CSS rules reproduces `BLOCKED by lightbox-panel`, so the test discriminates.
- **#8:** driven end to end in Chrome. Text gets the hint, a ZWJ family emoji is kept, stored in both tables, and restored on "Update your reply".
- **Re-login:** driven in Chrome. The session was ended server-side, then a tab switch gave the dialog over the dashboard. A wrong password showed the error; the right one closed the dialog with the tab and a half-typed filter intact.

### Issue stores

- **`.claude/issues` (site), approved and now `resolved`, awaiting the owner's
  acceptance:** #8, #9, #10, #12, #14, #15, each with an `--after` render.
- **Open:** #11 and #13, which wait on the design picks.
- **Also there:** the **7 older resolved issues** (#1–#7) are listed by
  `issues list --status=resolved` under "awaiting approval". They were resolved
  without ever being approved, which is odd; the owner should look.
- **`show` warns** that the store predates the secret sidecar. Running
  `scrub-secrets` is the owner's call; they declined store chores this session.
- **`.claude/issues-faces`:** all four are still open. #1, #3 and #4 wait on the
  admin IA pick. #2 waits on the tuning pass (part 1 shipped; no resolution
  proposed yet).

---

## 4. Decisions the owner made this session

- **Mixer:** both. The couple sets the site default in admin, and guests can
  remix locally (allowlisted ids and bounded params only, in localStorage; the
  memory book prints the guest's remix).
- **Round 2 process:** land the contract first, then cheap standalone sketches,
  then build only the picks. The angles were grows-from-the-entries, retro
  web / zine, and sound / time / space. (Physical objects was offered and not picked.)
- **Admin:** a full UX rethink. **Real-path routes** (`/admin/faces/groups/f123`,
  not hash routes), **grouped and mode-aware navigation**: "take full advantage
  of it and really think about optimal UX". Three design agents each produced an
  IA doc and a clickable prototype.
- **Faces #2:** abstain and clearest-first now. The clustering change (weak
  faces may only join groups seeded by clear ones) and the pose bar go into **the
  one deliberate tuning pass, which the owner wants to watch**.
- **#8:** a free emoji picker, via quick picks plus the native emoji keyboard,
  storing the glyph. Nothing vendored.
- **Several admin sessions:** yes (done, `0434bb6`).
- **`data/wedding.db` preview rows** (guests 6–9 and their 2 RSVPs, accounts
  14–16, media 320–359, written by part 1's mistaken seed): **leave them.**
- **Hand-off:** this file is rewritten in place, SESSION-PLAN is updated, and
  the agent worktrees are **kept**.

---

## 5. The design review: what the owner is doing next

```sh
node prototypes/serve.js        # http://localhost:4700/
```

One origin, five views behind hash routes:

- **Overview:** everything by family, with thumbnails.
- **Guided tour:** 18 steps, with the intent, surprise, pieces, cost, risks
  and questions beside each live prototype. One toolbar switches guestbook /
  memory book, desktop / phone, light / dark, and 3, 32 or 300 notes. Arrow keys
  step through.
- **Compare:** 2–3 designs side by side.
- **Your picks:** stars, per-slot "keep this piece" ticks and notes, kept in
  localStorage. **"Copy summary" produces the markdown the build session should
  start from. Ask the owner to paste it.**

Files: `prototypes/index.html`, `prototypes/tour/{designs.js,tour.js,tour.css,shots/}`.
The tour copy in `designs.js` comes from each agent's `SKETCH.md` / `IA.md`,
which stay the source of truth and are linked from each step.

### What is in it

| Family                 | Design (branch)                                                             | One line                                                                                     |
| ---------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Grows from the entries | Herbarium, Pattern Book, Archipelago (`design/r2-grows` `66d68ca`)          | Each note grows a plant, is woven on a real loom draft, or raises a named island             |
| Retro web / zine       | guestbook-cgi, cut-and-paste, tractor-feed (`design/r2-retro` `fc696bd`)    | 1999 homepage printed "from Navigator"; an imposed saddle-stitch zine; green-bar/BBS         |
| Sound, time, space     | Player Piano, The Long Day, The Stair (`design/r2-sound-time` `9f176f0`)    | Scroll-cranked punched roll and a playable score; real-sun day + Book of Hours; 3D stair     |
| Admin IA               | Today (`design/admin-today` `bd9117c`): ~11 days                           | Task-first home, ⌘K palette, Faces as "today's 5 groups"                                     |
|                        | Workspace (`design/admin-workspace` `327cfed`): ~18–20 days                | Always-on grouped sidebar plus mail-client list/detail; Faces in 3 panes                    |
|                        | Journeys (`design/admin-journeys` `a418ee6`): ~17 days (6-day first slice) | Four guided journeys whose numbered steps are the sub-tabs                                   |

**All three admin designs converged on** the same things:
- Back undoes navigation and never work (open = push, move-on = replace).
- Dialogs are routes.
- Face-id deep links.
- An unsaved-changes guard that vetoes Back by re-pushing.
- A re-login overlay.

The last two of those, plus the `/admin/*` fallback, are already built (`e571b37`).

### Questions the agents left for the owner (answer after picking)

- **Today:**
  - Daily face-set size?
  - Next thank-you above replies?
  - "Later" on the review queue?
  - One undo toast or a stack?
  - Batch send: best channel or email only?
- **Workspace:**
  - Should a sidebar click restore your place?
  - Should Review and Faces auto-advance after each decision?
  - Should trusting an author approve their waiting posts?
- **Journeys:**
  - Is a finished step "done for now" or "for good"?
  - Should Home's Continue go to where you left off, or the most useful step?
- **Guest sketches:**
  - Are generated names (Herbarium binomials, Archipelago summits) charming or a liability? A per-note override may be needed.
  - Does sound belong on the guestbook (muted by default)?
  - Should there be a sixth, optional **`furniture`** slot for page decorations (marquee, counter, zine masthead, printer housing)? Retro proposed it.
  - Retro switches option params with data attributes, not custom properties. Bless or reject that deviation from the contract.
  - Two small upstream changes were asked for: `data-id` on memory-book entries, and `data-gb-card` on `.gb-section` so Favorites get the card style.

---

## 6. Not done: the next session's list, in order

1. **Get the owner's picks summary** (§5). Nothing below in this list moves
   without it, except item 5.
2. **Admin build (faces #1, #3, #4)** on the chosen IA:
   - A router in `public/pages/admin/` that owns tab state (replacing
     `switchTab`'s `replaceState` in `main.js`), with push/replace semantics and a
     navigation veto for the site-content and thank-you dirty guards. Harvest the
     chosen prototype's router (each has one) rather than writing a fresh one.
   - Routes for the Moderation and Gallery pills and for dialogs, and Faces as
     routed steps keyed on face ids (`group.key` is already the lowest shown face
     id; when the anchor face is named, fall through to the next group).
   - The prototypes are static mock-ups. The real build adapts
     `face-assignment.js` (2967 lines) and the other tab modules. The agents'
     estimates: Today ~11 days, Journeys ~17 (6 for a first slice), Workspace ~18–20.
   - Then resolve faces #1, #3, #4.
3. **Guest design build (#11, #13)** from the picks:
   - Each picked piece becomes a slot piece (registry, config, schema and
     `LABELS` for effects; a small sibling registry for card / arrangement / book,
     designed when the first real one is built).
   - Then the mixer: the couple's default in site content, rendered as data
     attributes; a guest remix drawer in localStorage; the studio gains slot pickers.
   - Wire `effects/autostart.js` into the pages that get ambience.
   - Then resolve #11 and #13.
4. **Tuning pass, with the owner watching.** Run once, deliberately, against
   **`tmp/smoke.db`** (labels plus r2 grades; it is in-repo).
   - The pool-A calibration check: any declined face routed `accept` means a
     threshold moves.
   - Clustering where weak (ask / turned-head) faces can only attach to groups
     seeded by accept-quality faces.
   - The pose bar `defaults.js` already proposes.
   - Derive `assign.suggestMinMargin` (method in `defaults.js`).
   - Bump `PROFILE` in `route.js` and re-run `regrade-faces.js` if anything moves.
   - Results stay in `tmp/` and conversation; only bare numbers go in `defaults.js`.
   - Then propose a resolution for faces #2.
5. **Small loose ends** (any time):
   - The owner accepts the six resolved issues and looks at #1–#7's odd state.
   - `scrub-secrets` on `.claude/issues` (owner's call).
   - Clean up worktrees when the owner says so. That covers the six round-2 ones
     (`agent-a368…`, `agent-ac3f…`, `agent-af71…`, `agent-ae6c…`, `agent-a8dc…`
     (locked), `agent-a702…`), and **about 16 older `worktree-agent-*` ones from
     earlier sessions**. Round-2 PDFs and screenshots live only in those worktrees'
     `tmp/`.
   - The round-1 branches (`design/a-confetti-party`, `b-romantic-keepsake`,
     `c-theme-native`) stay as a parts bin until the picks are built. Ask before
     deleting them.
   - Decide whether `prototypes/` stays on `face-tagging` (it serves no app path)
     or moves to its own branch before `face-tagging` merges.
   - The `:3002` logout note is now explained (single-session deletion). Re-check
     during the next devloop run.
   - `docs/post-wedding/SESSION-1-devloop-notes.md` (untracked, the owner's)
     still holds part 1's D-4 / D-5 notes.

**Not touched at all, still carried from SESSION-PLAN:** sessions 2 (devloop
burrs, in `~/repos/make-a`), 5 (deploy), 6 (production face pass) and 7
(doc closeout). Session 6 is now unblocked on the engine/weights question
(`--expect-engine`) and the duplicate-hash fan-out.

---

## 7. Things a future session should not re-derive

- **Why #2 happened** (from code, no data looked at):
  - The groups are re-clustered from the unnamed leftovers.
  - A turned head (`eyeRatioLow`, the only pose proxy) routes `ask`, so it still clusters, probably by viewpoint.
  - Average linkage at 0.55 accepts loose groups.
  - Groups were sorted by size, putting the leftover viewpoint pile first.
  - `matchFace` always names its nearest prototype.

  Part 1 of the fix addresses the last two; the tuning pass addresses the clustering.
- **#14's real cause:**
  - The art fills the top ~60% of its frame over transparency (mobile ends at 59%, desktop at 62%, measured from alpha by code).
  - `object-position: center bottom` with a height cap showed only the transparent band.
  - The fix is an aspect-ratio crop of the band.
- **T18's failure mode:** a blocked `style=` on a block `div` falls back to `width: auto`, so progress bars sat at 100% rather than 0.
- **The emoji validator's choices:**
  - Skin tones and regional indicators count as components unless paired.
  - Keycap bases count only with U+20E3.
  - The length cap is 32 UTF-16 units; the DB trigger caps at 16 code points.
- **Same origin:** the review server puts all prototypes on one origin. Their storage keys were checked and are all prefixed (`ws-*`, `aj-*`, `admin-today-*`, `r2-*`), except the site's shared `theme` key, which is intentional.

## 8. Contract feedback from the agents, already folded in

`DESIGN-SLOTS.md` gained the per-card `ornament(entry)` hook and the fifth
`arrangement` slot (`8edf6ba`). Still undecided, for the owner: the `furniture`
slot and data-attribute option params (§5).

## 9. Incidents (part 1, both reported to the owner at the time)

- **The seed script wrote to `data/wedding.db`.** That was part 1's
  `npm run seed -- --gallery 40`, before the `DATABASE_PATH` fix. The rows are
  listed in §4; the owner said to leave them. Its deletes only match earlier
  preview markers. Separately, imported media folders from 2026-07-30/31 sit in
  `data/uploads/media` with no rows; that predates session 3.
- **A part-1 design agent screenshotted `/`**, putting the couple's photograph
  in its context. It did not describe it, and the render was deleted unopened with
  the owner's approval. The cause was a brief that didn't warn about `/`; every
  brief since says so.

Part 2 had no incidents. Its design agents were briefed on the photo rules and
worked only on fictional fixtures. The one image the owner cleared mid-session
was viewed only after clearance. The desktop art was first measured by code,
and then viewed after the owner cleared it explicitly.
