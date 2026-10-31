# Hand-off: session 3 (2026-10-28 → 30)

Session 3 in `SESSION-PLAN.md` was "fix the faces UI issues". The owner widened
it to all twelve open issues, absorbing session 4's non-vision backlog. It has
run in three parts: part 1 (one context, which ran out), part 2 (the design
review), and part 3 (the owner's picks, and building them). This document is
the single current record of all three, rewritten in place each time.

**Where it stands in one paragraph.** Six of the twelve issues are fixed and
proposed as resolved, awaiting the owner's acceptance: site #8, #9, #10, #12,
#14 and #15. In part 3 the owner picked from the design review, and both picks
are **built but uncommitted, waiting for the owner's review** (§3): the
guestbook / memory-book **note flowers** (a pared-down "Herbarium", for #11 and
#13), and **slice 1 of the Workspace admin** (real-path routes, grouped
sidebar, phone bottom bar; the base for faces #1, #3, #4). Faces #2 is half
done; its other half is the vision tuning pass, which the owner wants to watch.

**Part 4 (2026-10-30) superseded the review step above.** The owner found
slice 1 unfinished (old panels inside the new frame) and asked for the whole
Workspace admin plus a guestbook polish before seeing anything again. Every
admin section is now built to the prototype and all of it is uncommitted —
see §3.5. **First thing with a fresh agent:** the owner reviews §3.5 on
`:3031`, then commit (§3.5 lists how).

---

## 1. Read first: rules this session learned or reconfirmed

All in addition to `CLAUDE.md`.

- **Never screenshot `/`.** It shows the couple's photograph. Tell every
  subagent this explicitly. Part 1 had an incident (§9).
- **Artwork the owner cleared for viewing:** `/images/top-mobile*.webp`,
  `bottom-mobile*.webp` and `top-desktop*.webp` (the guestbook/gallery/RSVP
  header waves). Nothing else under `public/images` is cleared. `/guestbook`,
  `/memory-book` and `/admin` on the scratch DBs show no photographs.
- **Seeded gallery media are 64-byte JPEG stubs** (`tests/media-fixtures.js`
  `makeJpeg`): broken images, not photographs.
- **`scripts/seed-preview.js` honours `DATABASE_PATH`.** Boot the server on
  that path first so the full schema exists.
- **Worktree subagents start without `CLAUDE.md` or `.claude/settings.json`**
  (both gitignored), so the photo-snooping hook is absent. Point them at
  `/Users/jessepence/repos/wedding/CLAUDE.md` and restate the photo rules.
- **Every `Agent`/`Workflow` call must set `model`** (owner's global rule).
- **The static server gzips CSS/JS at boot.** Restart after editing served
  files (`sh tmp/flower/restart.sh`). This cost time again in part 3.
- **Commit with a pathspec.** The owner's own uncommitted `docs/` →
  `docs/archive/` move is in the working tree (the ` D docs/...` and
  `?? docs/archive/` lines, plus `LIGHTHOUSE_CHANGES.md` and
  `SESSION-1-devloop-notes.md`). Don't sweep them in.
- **zsh does not word-split `$VAR`.** For a commit pathspec list, use
  `set -- a b c; git commit -- "$@"`.
- **No-semicolon style trap:** a line starting with `(` or `/** @type */ (`
  glues onto the previous line. Bind it to a `const` first.
- **Tests that import from `public/`** must be added to the root
  `tsconfig.json` `exclude` list (the server tsconfig has no DOM types); the
  public tsconfig still checks the module itself.
- **A `MutationObserver` must not write into the subtree it observes**
  unconditionally: part 3 froze the admin that way once (caught on the first
  render, fixed in `router.js` `updateMoreDot`).

## 2. The scratch environment (all gitignored, under `tmp/`)

| Thing | Where / how |
| --- | --- |
| **Running now** | **`:3031`** — the part-3 scratch server, left up for the owner. `sh tmp/flower/restart.sh` restarts it. DB `tmp/flower/wedding.db`: 300 fictional guestbook notes (from `prototypes/fixtures/entries.json`, cycled), 3 pinned, one fictional guest "Penny Fictional" with a pending note, and the scratch admin password **`scratch-pass-1234`** (copied from `tmp/fix`; the real `.env` hash is untouched). Re-seed with `node tmp/flower/seed.mjs tmp/flower/wedding.db 300`. |
| Also running | `:4700` — the design review, `node prototypes/serve.js 4700`. |
| Part 1–2 scratch | `tmp/fix/wedding.db` (12 stub media, a photo-free thank-you card `EMOJTST1`, same password); `sh tmp/fix/restart.sh` runs it on `:3030` (stopped). |
| Headless driver | `node tmp/flower/cdp.mjs <url> <W>x<H> [--eval=file.js]… [--shot=out.png] [--print-media] [--reduced-motion]` — part 3's copy of `tmp/fix/cdp.mjs`, on its own debug port (9345), with reduced-motion emulation added. |
| Part-3 probes | In `tmp/flower/`: `login.js` (admin login), `walk.js` (deep link → sidebar → pills → Back×3 → Forward), `guard.js` (leave guard via sidebar and Back), `behave.js` (More dot, Back closes a dialog, scroll restore, account View), `inbox.js`, `more.js`, `perf.js` (scroll FPS / long tasks / node count), `sign.js` + `reg.js` (sign the guestbook end to end), `rm.js`, `empty.js`. Renders in `tmp/flower/shots/`. |
| Issue CLI | `node /Users/jessepence/.claude/skills/cli.js issues …` (through the `fix-issues` skill). `tmp/issue-summary.mjs <store> <ids…>` prints the useful fields. |

---

## 3. Part 3: the picks, and what was built (uncommitted)

### 3.1 What the owner decided

- **Guestbook:** of the nine sketches, only the flower one ("Herbarium") is
  usable, and it was "too overwrought and not performant". For the owner's own
  site, **this week**: a pared-down version. For the open-source version later,
  the other sketches may be polished so users can pick favourites; the
  `prototypes/` folders stay untouched as that parts bin.
  - Meadow band: **keep it, frozen** (drawn once, never animated).
  - Motion: **the composer grows your flower live; each card's flower grows in
    once on scroll.** Nothing sways.
  - Memory book: **a flower beside each entry.** No specimen sheets, binomials
    or index.
  - Copy: **one quiet hint** under the composer.
  - The owner typed more nuance into these answers, which the app lost. **Ask
    them to re-add anything** when they review.
- **Admin:** **Workspace** (always-on grouped sidebar, mail-client list/detail,
  Faces in three panes). Ideas taken from Today and Journeys are now
  `prototypes/admin-workspace/IA.md` §13. The strongest is **"photos they're in"**
  in the card composer once a face group is named and linked to a guest.
- **Phones get the prototype's bottom bar**, not a scrolling strip (the owner
  caught the strip as a deviation; it's fixed). Then: "fix anything else that
  would obviously annoy me later" — see 3.3.

### 3.2 Note flowers (for #11 / #13)

| File | What |
| --- | --- |
| `public/components/note-flower.js` | The generator, ported from `prototypes/r2-grows/herbarium/plant.js` and cut down. Pure, deterministic (author + message, never the row id), no regex, no `Math.random`. Every part is transformed into world coordinates and **merged into one `<path>` per style**, so a plant is ≤ ~7 elements however long the note. Exports `noteSentences`, `growFlower`, `flowerSVG`. |
| `public/styles/note-flower.css` | Theme-token palette only; the one-time `.nf-grow`/`.nf-waiting` clip-path reveal; reduced motion and print show everything. |
| `public/pages/guestbook/meadow.js` | Frozen meadow of the newest ≤ 40 notes, cropped to its tallest flower, redrawn only when a guest signs or deletes, and on a narrow/wide `matchMedia` change. Decorative (`aria-hidden`); a tap calls `openEntry(id)`. |
| `public/pages/guestbook/feed.js` | Flower on each card (gold eyes for pinned Favorites), one shared `IntersectionObserver` for the grow-in (none under reduced motion), the meadow state, and the composer preview (same size as a card, re-grown once per animation frame). |
| `guestbook.css` / `index.html` | Card grid (flower bottom-right on ≥600px, beside the message on phones); the oversized close-quote `::after` is gone. Meadow host, composer preview, hint *"Your note grows a flower: ! blooms, ? buds"*. |
| `public/pages/memory-book/*` | Flower beside each entry; print forces `color-scheme: light`, so a dark-mode browser still prints on white. |
| `tests/unit/note-flower.test.js` | Determinism, no `Math.random(`/`RegExp(`, every ending → its tip, emoji, gold, empty/odd notes, element ceiling, size caps. |

**Verified** (headless Chrome, fictional data):
- Desktop and phone, light and dark.
- Memory book in print media from a dark screen theme.
- Reduced motion: every flower is shown at once and nothing animates.
- The empty guestbook.
- Signing end to end: the posted card's flower is byte-identical to the
  composer's preview, it shows pending, and it joins the meadow.

Scroll performance against the sketch, both at 300 notes:

| | Sketch | Flowers |
| --- | --- | --- |
| Page elements | 48,640 | 2,105 |
| Animations always running | 697 | 0 |
| Worst frame | 100 ms | 17 ms |
| Long tasks while scrolling | 350 ms | 0 ms |

**Not done:** the Favorites strip has no flowers (deliberately compact). Pinning
or unpinning doesn't re-gild an already-rendered card until reload. No slot
registry or mixer yet. That is still the open-source plan in `DESIGN-SLOTS.md`,
and `note-flower.js` is already shaped as the `card` slot's `ornament(entry)`.

### 3.3 Workspace admin, slice 1 (the base for faces #1, #3, #4)

Full record: `prototypes/admin-workspace/IA.md` **§14** (what's built, and what
is deliberately not yet).

| File | What |
| --- | --- |
| `public/pages/admin/routes.js` | Pure route table: path → panel (`tab`), sub-view pill (`sub`), sidebar item (`nav`), title. Longest whole-segment match (`/admin/faces/anything` is still Faces), old `#tab` redirects, `/admin/more`. Unit-tested in `tests/unit/admin-routes.test.js`. |
| `public/pages/admin/router.js` | Push/replace with `history.state.idx`; link interception; the **leave guard** (in-app `#admin-leave-modal`) on sidebar clicks, re-opening the same section, and **Back/Forward** (undo with `go(-delta)`, *await* that popstate, ask, replay); **Back with a dialog open closes the dialog**; per-entry **scroll restore**; the More page and More's dot. |
| `public/pages/admin/main.js` | `switchTab` is now `showPanel`; `startRouter()` after login. |
| `index.html` / `admin.css` | The 11-tab bar became the grouped sidebar (Memories / Thank-yous / Guest list / Site). Links keep their `tab-btn-*` ids, so modules that `.click()` them still work. Below 900px it's the **bottom bar** (Inbox · Review · Faces · Cards · More). `--admin-bar` keeps sticky bars clear of it; `viewport-fit=cover`. The success/Undo banner is sticky. Stat cards show only on Guests/RSVPs. |
| `public/pages/admin/utils.js` | `topModal()`: `openModal` tracks the opening order (the DOM can't tell top-layer order). |
| `inbox.js`, `moderation.js`, `services/email.js` | Inbox jumps to Replies by its link. Account "View" records `/admin/review`. The digest email links `/admin/thank-yous/replies`. |

**Verified by scripted walks** (the `tmp/flower` probes above):
- A cold deep link.
- The sidebar, the pills, Back ×3, Forward.
- The guard: Keep editing keeps the edit; Back asks with the URL already put
  back; Discard completes the Back; Forward doesn't ask.
- Old hash links and unknown paths redirect.
- The Inbox's "Open →" buttons, with Back returning to the Inbox.
- The More page and its dot; `/admin/more` redirecting on a wide screen.
- Back closing the guest dialog.
- Scroll restore.
- Account View → Back.

**Labels were chosen by the agent:** "Review posts", "Name faces", "Cards &
gifts", "Replies", "Blocked", "Inbox" (not "Home" yet). Easy to rename in
`routes.js` (title) and `index.html` (label).

### 3.4 Committing it (after the owner has looked)

Nothing from part 3 is committed. The two pieces touch disjoint files except
`tsconfig.json` (two `exclude` lines), which goes with the first commit.

```sh
# 1. Note flowers
set -- public/components/note-flower.js public/components/types.d.ts \
  public/styles/note-flower.css public/pages/guestbook/ public/pages/memory-book/ \
  tests/unit/note-flower.test.js tsconfig.json
git add -- "$@" && git commit -m "feat(guestbook): every note grows a flower (pared-down Herbarium)" -- "$@"

# 2. Admin slice 1
set -- public/pages/admin/ services/email.js tests/unit/admin-routes.test.js \
  prototypes/admin-workspace/IA.md
git add -- "$@" && git commit -m "feat(admin): real-path routes, grouped sidebar, phone bottom bar (Workspace slice 1)" -- "$@"

# 3. This hand-off and SESSION-PLAN
set -- docs/post-wedding/HANDOFF-session-3.md docs/post-wedding/SESSION-PLAN.md
git add -- "$@" && git commit -m "docs(handoff): session 3 part 3 — picks built, what is next" -- "$@"
```

Add the attribution lines from the system reminder to each message. Run
`npm run typecheck && npm test` first (last run: clean, **2316/2316**).

**Superseded by part 4:** the pathspecs above no longer cover everything
(part 4 touched `api/`, `db/`, `core/`, `content.js`, `types.d.ts` and
added tests). Group the commits by §3.5's pieces instead.

### 3.5 Part 4: the whole Workspace admin, and the guestbook polish

Built by parallel agents (each on its own port and scratch DB), then one QA
pass per side. All uncommitted. `npm run typecheck` clean; `npm test`
**2363/2363** plus integration **446/446**.

- **Foundation:** the prototype's tokens, type, sidebar, icon rail
  (900–1199px), bottom bar, More, Home step cards with progress in each job's
  unit, toast, dialogs. `routes.js` gained `:param` routes, dialog routes,
  section memory, replace navigation, crumbs; guards take `save` (three-way
  "Save and leave") and `discard`. Contract: `public/pages/admin/WORKSPACE.md`.
  Per-slice CSS: `admin-{review,thanks,faces,panels}.css`. `admin.css`
  4874 → 2790 lines (dead rules removed, verified by 140 before/after pairs).
- **Review + Accounts:** list/detail, `/admin/review/:id`, `?status=&type=&author=`
  survive reload, `j k a h r t x`, bulk bar, Undo on every decision including
  Reject (restores from quarantine). Trust applies to new posts; "Approve
  their N waiting" is separate. Approving still auto-trusts (July decision).
- **Thank-yous:** Gifts / Cards / Replies lists; composer at
  `/admin/thank-yous/cards/:id/edit` with "Save and write the next one";
  batch send Choose → How → Check → Sent (collapses on finish; Check lists
  every recipient and channel); **"Photos they're in"** via
  `GET /api/admin/guests/:id/photos` (`db/guest-photos.js`).
- **Faces:** stepper (Groups · Quick questions · Same moment · Leftovers) +
  People/History, three panes, group routes keyed on face ids, photo dialog
  as a nested route. Resolves faces #1, #3, #4 (propose once the owner
  accepts). No clustering/threshold change — #2 still waits on the tuning pass.
- **Panels:** Guests & RSVPs as one split view (`rsvps.js` deleted),
  Requests | Blocked, Gallery, Site content, Effects; guest/invite/import/
  upload dialogs are routes.
- **Guestbook:** `.` grows a tulip (hint: "Sentences grow: . tulips ! blooms
  ? buds"), `?` hangs as a crooked bud, daisy, sage leaves; flower sized to
  the card; reaction capsule; meadow on the composer; memory book as a paper
  sheet with cover and page numbers. **Favorites strip is now a Site content
  setting, `guestbook.showFavorites`, default off**; pinning still gilds the
  flower and re-gilds in place. Copy trimmed: "Leave us a note — we read every
  one 💗" → "Leave us a note.", "Favorites ✨" → "Favorites". Perf at 300
  notes unchanged (17ms worst frame, 0 long tasks).
- **Owner follow-up (10-31):** the meadow sways again — each plant is its own
  HTML layer rotating 1–2° from its root (compositor-only; paused off-screen
  and under reduced motion; 60fps, 0 long tasks while swaying). Petal hues
  4 → 8 (`TINTS` in `note-flower.js`; flowers redraw in new colours). The
  page has a paper grain and a light pooled behind the meadow (`.gb-page`,
  `.gb-meadow::before`, dimmed in dark mode), and on screens ≥1180px two
  still pressed-flower sprays sit in the lower corners, drawn by the same
  generator from fixed seeds (`public/pages/guestbook/backdrop.js`; one fixed
  layer, never repainted). Perf unchanged: 60fps, 17ms worst frame, 0 long
  tasks, scrolling or swaying.
- **Next session:** the faces tuning pass (§6 item 3) with the owner
  watching. The owner has more design notes queued for later. Issues ready
  to propose as resolved once the owner says so: site #11, #13; faces #1,
  #3, #4. Commit is still pending (group by §3.5's pieces).
- **Review server:** `sh tmp/owner-review/restart.sh` → `:3031`, DB
  `tmp/owner-review/wedding.db` (fictional; synthetic faces on stub media),
  password `scratch-pass-1234`. Prototype for comparison stays on `:4700`.

---

## 4. Earlier in the session (parts 1–2, committed)

Commits on `face-tagging`, oldest first. After each: typecheck clean, `npm
test` green (2301/2301 by `4933c4b`).

| Commit | What |
| --- | --- |
| `725373f` | #12 registry hidden after the wedding; #9 gallery tab spacing; #10 lightbox Share was covered by the panel. |
| `9a65aae` | #14 header art cropped to its wave band; #15 counter ↔ Sign gap; T18 (no client template emits `style=`; monogram hue as 12 classes; a scan test); `seed-preview.js` honours `DATABASE_PATH`. |
| `8482dae` | Slots contract `DESIGN-SLOTS.md`; `effects/autostart.js`, `pages.js`; `prototypes/serve.js` and the shared fixture. |
| `b42f50f` | Faces #2 part 1: suggestions must clear `assign.suggestMaxDistance` 0.64 / `suggestMinMargin` 0.05 (UNTUNED placeholder) or say "no confident match"; clearest-first group order; stable group `key` = lowest shown face id. |
| `0106c58` | #8 free emoji reply (`components/emoji.js` `isSingleEmoji`, migration `reply_emoji_glyphs`). |
| `ec02d9a` | `--expect-engine` on `export-face-work.js import`; duplicate content hashes fan out (TRAPS D7 FIXED). |
| `8c015f4` | Face chips load `thumb` when it covers the chip. |
| `e571b37` | `/admin/*` serves the admin shell; a 401 mid-session opens a re-login dialog over the dashboard. |
| `0434bb6` | Several admin sessions at once (keeps the newest 5). |
| `8edf6ba` | Slots contract gains `ornament(entry)` and `arrangement`. |
| `4933c4b` | The unified design review under `prototypes/`. |
| `9527d3d` | The part-2 hand-off. |

**Issue stores:**
- **`.claude/issues` (site):**
  - Approved and `resolved`, awaiting the owner's acceptance: #8, #9, #10,
    #12, #14, #15.
  - **#11 and #13 are still open.** Propose resolutions once the owner accepts
    the flowers, or leave them open if they want the mixer first.
  - The 7 older resolved issues (#1–#7) were resolved without ever being
    approved; the owner should look.
  - `show` warns that the store predates the secret sidecar; running
    `scrub-secrets` is the owner's call.
- **`.claude/issues-faces`:** all four are open.
  - #1, #3, #4 wait on Workspace slices 2–4.
  - #2 waits on the tuning pass.

## 5. Decisions the owner made this session (all parts)

- **Mixer** (for later): both. The couple sets the default in admin; guests
  remix locally (allowlisted ids, bounded params, localStorage).
- **Round 2 process:** contract first, cheap sketches, build only the picks.
- **Admin:** a full UX rethink with real-path routes and grouped, mode-aware
  navigation → **Workspace** (part 3).
- **Guestbook:** the pared-down flowers above (part 3).
- **Faces #2:** abstain and clearest-first now; clustering and the pose bar go
  into **the one deliberate tuning pass, which the owner wants to watch.**
- **#8:** free emoji picker storing the glyph; nothing vendored.
- **Several admin sessions:** yes.
- **`data/wedding.db` preview rows** written by part 1's mistaken seed: leave
  them.
- **Hand-off:** this file is rewritten in place; SESSION-PLAN is updated;
  agent worktrees are kept.

## 6. Not done: the next session's list, in order

1. **Owner review of §3** in the running `:3031` server:
   - guestbook at http://localhost:3031/guestbook and the memory book at
     `/memory-book`
   - the admin at `/admin`, password `scratch-pass-1234`; narrow the window
     below 900px for the bottom bar
   - collect their lost nuance on the flowers and any label changes
   - then commit (§3.4)
   - then decide #11 / #13.
2. **Workspace slices 2–4**, in `IA.md` §11's order, each independent now that
   slice 1 exists:
   - **Slice 2, Review split view** (`moderation.js`): list + detail,
     `a`/`h`/`r` act and advance with replace, a bulk bar, and `?author=` in
     the URL.
   - **Slice 3, Thank-yous:**
     - Gifts / Cards / Replies as separate lists.
     - The composer as a guarded route.
     - The new batch-send flow (Choose → How → Check → Sent, where Sent
       *collapses* history).
     - From §13: "Save and write the next one", "Save and leave", and
       **"photos they're in"**.
   - **Slice 4, Faces in three panes** (`face-assignment.js`, 2990 lines):
     - Steps as routes, keyed on face ids (`/admin/faces/groups/f1240`;
       `group.key` is already the lowest shown face id).
     - The photo dialog as a route.
     - Then resolve faces #1, #3, #4.
   - **Answer IA §12's questions first, with the owner:**
     - sidebar memory
     - auto-advance after each decision
     - whether trusting an author approves their backlog
     - batch SMS
     - where the mode switch lives
3. **Tuning pass, with the owner watching.** Run once, deliberately, against
   **`tmp/smoke.db`** (labels plus r2 grades; it is in-repo):
   - The pool-A calibration check: any declined face routed `accept` means a
     threshold moves.
   - Clustering where weak (ask / turned-head) faces only attach to groups
     seeded by accept-quality faces.
   - The pose bar `defaults.js` proposes.
   - Derive `assign.suggestMinMargin`.
   - Bump `PROFILE` in `route.js` and re-run `regrade-faces.js` if anything
     moves.
   - Results stay in `tmp/` and the conversation; only bare numbers go in
     `defaults.js`.
   - Then propose a resolution for faces #2.
4. **Small loose ends** (any time):
   - The owner accepts the six resolved site issues and looks at #1–#7.
   - `scrub-secrets` on `.claude/issues` (owner's call).
   - Worktree cleanup when the owner says so: six round-2 ones and about 16
     older `worktree-agent-*` ones. Round-2 PDFs and screenshots live only in
     their `tmp/`.
   - Round-1 branches (`design/a-confetti-party`, `b-romantic-keepsake`,
     `c-theme-native`) stay as a parts bin; ask before deleting.
   - Decide whether `prototypes/` stays on `face-tagging` (it serves no app
     path) or moves to its own branch before the merge.
   - Ask the owner to paste the review app's **"Copy summary"** if their notes
     there matter (localStorage on their browser; an agent can't read it).
   - `docs/post-wedding/SESSION-1-devloop-notes.md` (untracked, the owner's)
     still holds part 1's D-4 / D-5 notes.

**Not touched at all, still carried from SESSION-PLAN:** sessions 2 (devloop
burrs, in `~/repos/make-a`), 5 (deploy), 6 (production face pass) and 7 (doc
closeout).

---

## 7. Things a future session should not re-derive

- **Why the Herbarium sketch was slow** (all from code):
  - every plant was drawn twice (meadow + card)
  - an infinite `hb-sway` animation ran on every plant's SVG `<g>` (not
    composited)
  - each leaf/vein/tip had its own transition
  - `pointerover` ran `querySelectorAll` and toggled opacity on every plant
  - resizing rebuilt the meadow through `innerHTML`

  The flowers fix all five, and merging paths per style is what keeps the node
  count flat.
- **The keep-alive heartbeat isn't needed.** `BADGE_POLL_MS` (3 min, visible
  tabs only) plus `updateSessionActivity` on every admin request means a visible
  tab never idles out; the re-login overlay covers hidden tabs. Checked in code.
- **Router mechanics worth keeping:**
  - A vetoed Back must *await* its own `go(-delta)` popstate before asking;
    calling `go(delta)` before the first traversal lands is unreliable.
  - `history.scrollRestoration = "manual"`, because panels render
    asynchronously.
- **Why #2 happened** (from code):
  - groups are re-clustered from unnamed leftovers
  - a turned head (`eyeRatioLow`) still clusters
  - average linkage at 0.55 accepts loose groups
  - groups were sorted by size
  - `matchFace` always named its nearest prototype

  Part 1 fixed the last two.
- **#14's cause:** the art fills the top ~60% of its frame over transparency;
  `object-position: center bottom` with a height cap showed only the
  transparent band. The fix is an aspect-ratio crop.
- **T18's failure mode:** a blocked `style=` on a block `div` falls back to
  `width: auto`, so progress bars sat at 100%.
- **The emoji validator's choices:**
  - Skin tones and regional indicators count as components unless paired.
  - Keycap bases count only with U+20E3.
  - The cap is 32 UTF-16 units; the DB trigger caps at 16 code points.
- **Same origin:** the review server puts every prototype on one origin; their
  storage keys are all prefixed (`ws-*`, `aj-*`, `admin-today-*`, `r2-*`),
  except the site's shared `theme` key, which is intentional.

## 8. Contract notes

`DESIGN-SLOTS.md` has the `ornament(entry)` hook and the `arrangement` slot
(`8edf6ba`). Still undecided, for when the mixer is built: the `furniture` slot,
and data-attribute option params. The flowers were built **directly into the
pages**, not through a slot registry, because the owner needed them this week.
Moving them behind the `card` slot is part of the open-source theme work.

## 9. Incidents

- **Part 1:**
  - The seed script wrote to `data/wedding.db`, before the `DATABASE_PATH` fix.
    The owner said to leave the rows.
  - A design agent screenshotted `/`. It wasn't described, and the render was
    deleted unopened with the owner's approval. Every brief since warns about
    `/`.
- **Part 2:** none.
- **Part 3:** none involving photographs or data outside the repo. All renders
  were of fictional notes, the cleared header art, and the admin over scratch
  DBs. One self-inflicted bug (the More-dot observer loop, §1) hung a test run;
  it was fixed and re-verified before the hand-off.
