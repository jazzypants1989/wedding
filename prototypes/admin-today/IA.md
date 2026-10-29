# Admin redesign — Perspective: "Task-first / Today"

Prototype: `node prototypes/serve.js 4867` → <http://localhost:4867/admin-today/>
(fake data, generated placeholder faces, no photographs). The dev strip at the
bottom shows the **real path** each screen would have (`/admin/...`), flips
pre/post-wedding mode, simulates the idle timeout, and resets the demo.

## 1. The idea in one paragraph

The admin's home page is a short, ordered to-do list called **Today**. It
shows what needs you, top to bottom: things guests are waiting on, then quick
wins, then etiquette with a deadline, then open-ended work. Every item is a
button that takes you to the exact screen for that job. When the job is done,
you're back on Today with that item moved to "Done today". Open-ended work
(faces) is offered as **today's set of 5 groups**, not the whole backlog, so
Today can reach "All caught up". The full grouped navigation is still on screen
(a sidebar on desktop, a bottom bar on phones), so every section stays one
click away. It just stops being the way in. A `/` or `⌘K` palette jumps
anywhere by name: sections, guests, people, cards, tasks.

## 2. Principles

1. **Home is a list of jobs, not a dashboard.** Counts that don't ask you to
   do anything (total guests, headcount) move to the page they describe.
2. **Today can reach zero.** Every task on it is finishable today. "Later"
   snoozes a task until tomorrow. Faces show up as a daily set, never as "540
   faces left".
3. **Every screen, step and dialog has its own real address.** Reload keeps
   you on it, and links to it can be shared.
4. **One history rule:** *going somewhere adds a history entry; moving on
   because you finished something replaces the current one.* So Back always
   means "the screen I was on before", and never "re-do the thing I just did".
   **Back never undoes. Undo (`Z`, or the toast button) undoes.**
5. **Finishing a multi-step flow collapses its steps** into one history
   entry: the result screen. Back from "5 cards on the way" goes to where you
   started, never to a step that has already been used.
6. **No "are you sure?" on things that can be undone.** Moderation already has
   an undo endpoint. Approve, hide and reject save immediately, and the toast
   offers Undo.
7. **Keyboard-first, thumb-first.** Every flow can be done with single keys.
   On phones, the same decisions are big buttons in a bar pinned to the bottom.
8. **Running out of session time never costs you your place.** Sign-in
   appears as an overlay on top of the same screen, then finishes whatever you
   clicked.
9. **Nothing in the admin's interface describes a photograph.** Faces are
   cropped pixels with positions, counts and names someone typed (CLAUDE.md).

## 3. Navigation tree (grouped, mode-aware)

Nothing is ever hidden by mode. Mode only changes the order. Badges only appear
where something needs you.

**After the wedding (now)**

```
Today                         ← badge = open tasks
Memories
  Review queue                ← pending count
  Faces                       ← unnamed groups
  Gallery                     (Official · Most loved)
Thank-yous
  Cards                       ← "N ready" (drafts)
  Gifts
  Mailbox                     ← ♥ unread replies
Guests
  Guest list
  RSVPs
  Requests                    ← pending petitions
  Accounts                    (moved out of Moderation)
  Blocklist
Site
  Site content
  Effects
```

**Before the wedding**: Today, then Guests, then Site, then a group called
"After the wedding" (Review, Faces, Gallery, Cards, Gifts, Mailbox).

**Phone bottom bar**: post-wedding shows Today · Review · Faces · Cards · More.
Pre-wedding shows Today · Guests · RSVPs · Requests · More. "More" is
`/admin/more`, a real page listing every section, with the same badges.

## 4. Route table

Base is `/admin`. **P** = push, **R** = replace, **C** = collapse (rewind to
where the flow started and replace that entry). "Dialog" means the screen is
drawn over the page you came from. On a cold load or a shared link, it's drawn
over its parent instead. Closing a dialog uses `history.back()` when Back
would land on the page underneath, and otherwise replaces the URL with the
parent.

| Route | Screen | Got here by | Back goes to |
|---|---|---|---|
| `/admin` | **Today** | P | whatever was before (leaves admin only if you arrived from outside) |
| `/admin/more` | All sections | P | previous |
| `/admin/review` `?type=&status=&account=` | Review queue list. Filters are R (view state, not screens) | P | previous |
| `/admin/review/:type-:id` | One post, decided with A / H / R | P from Today or list. **Decide → next item is R. J/K browsing is R** | where the run started (Today or list) |
| `/admin/review/done` | "Queue clear" + the next task | R | where the run started |
| `/admin/faces` | Faces overview: numbered steps 1–4 and a progress ring | P | previous |
| `/admin/faces/groups` `?order=` | Unnamed groups list | P | previous |
| `/admin/faces/groups/f:faceId` `?face=` | **Name one group.** Addressed by a face it *contains*. Selected face is `?face=` (R) | P. Confirm → next group is R. `[` `]` is R | where the run started |
| `/admin/faces/groups/break` | "That's today's set" (after 5) | R | where the run started |
| `/admin/faces/groups/done` | "Every group has a name" → step 2 | R | where the run started |
| `/admin/faces/ask` | Quick-confirms list / start | P | previous |
| `/admin/faces/ask/f:faceId` | One face, best guesses, keys 1 / 2 / N / S | P. Answer → next is R | where the run started |
| `/admin/faces/moments` | Same-moment batches, "Accept all" | P | previous |
| `/admin/faces/set-aside` | Photos with set-aside faces | P | previous |
| `/admin/faces/photo/m:mediaId` `?face=&box=` | **Dialog:** every face in one photo, named one at a time | P (from group, ask or set-aside) | closes the dialog → the page underneath |
| `/admin/faces/people` | People list | P | previous |
| `/admin/faces/people/p:id` | One person: rename, link a guest, merge, their faces | P | previous |
| `/admin/faces/people/p:id/merge` | Dialog: merge into… | P | closes |
| `/admin/faces/history` | Naming passes (the ledger), newest first | P | previous |
| `/admin/faces/history/b:id/revoke` | Dialog: revoke a pass | P | closes |
| `/admin/thanks` `?status=` | Cards home: ring, next to thank, ready to send, cards | P | previous |
| `/admin/thanks/gifts` | Gift log | P | previous |
| `/admin/thanks/gifts/new` · `/gifts/g:id` | Dialog: add / edit a gift | P | closes |
| `/admin/thanks/mailbox` | Replies feed. Opening it marks them read | P | previous |
| `/admin/thanks/cards/new?guest=g:id` | Composer (guarded) | P | previous, after the guard |
| `/admin/thanks/cards/c:id` `?saved=1` | Composer for an existing card. Saving a new one moves you here with R | P / R | previous (never `/new`) |
| `/admin/thanks/cards/c:id/photos` | Dialog: photo picker | P | closes, back to the composer |
| `/admin/thanks/cards/c:id/details` | Dialog: card timeline, resend | P | closes |
| `/admin/thanks/send` `?cards=` | Send step 1: choose cards | P | previous |
| `/admin/thanks/send/how` | Step 2: channel | P | step 1 |
| `/admin/thanks/send/check` | Step 3: preview, then Send | P | step 2 |
| `/admin/thanks/send/done` | Results, plus links you need to copy and send yourself | **C** | where step 1 was opened from (Today) |
| `/admin/guests` `?q=&status=` | Guest list | P | previous |
| `/admin/guests/new` · `/guests/g:id` · `/guests/g:id/archive` | Dialogs | P | closes |
| `/admin/guests/import` → `/import/preview` | CSV import, 2 steps | P, P | previous step |
| `/admin/guests/invite` → `/how` → `/check` → `/done` | Send invites (same shape as sending cards) | P…C | where it started |
| `/admin/guests/sms` | Manual SMS copy list | P | previous |
| `/admin/guests/rsvps` · `/rsvps/r:id` | RSVPs, plus a detail dialog | P | previous / closes |
| `/admin/guests/requests` · `/requests/pt:id` | Petitions, plus a dialog with Approve / Decline | P | previous / closes. A decision → `returnTo(Today)` |
| `/admin/guests/accounts` | Accounts and trust | P | previous |
| `/admin/guests/blocklist` · `/blocklist/new` | Blocklist, plus an add dialog | P | previous / closes |
| `/admin/gallery` · `/gallery/loved` | Official / Most loved | P | previous |
| `/admin/gallery/upload` · `/gallery/m:id/remove` | Dialogs | P | closes |
| `/admin/site/content` | Site content (guarded) | P | previous, after the guard |
| `/admin/site/effects` | Effects | P | previous |
| `/admin/login?next=` | **Cold load only**, when there's no session at all | — | — |

Overlays that **don't** have their own address (the palette, `?` help) push an
entry with the same URL, tagged `{ overlay }`. Back or Esc closes them. Picking
a result from the palette *replaces* that entry, so Back from the destination
goes to the page under the palette, not to the palette.

Existing deep links keep working: `/admin#thankyous` (the digest email) gets
`replaceState`'d to `/admin/thanks`.

## 5. Mechanics

**Router.** About 250 lines and no dependencies. Patterns are split on `/` and
matched segment by segment. `f:faceId` means the literal `f` followed by a
parameter, so there's no regex. Every history entry stores `{ idx }`, which
always increases, so a popstate can tell how far it moved. The router also
keeps `entries[idx] → path` in sessionStorage. That's what lets ✕, "Back to
Today" and closing a dialog *rewind* with `history.go(-n)` when the target is
a few entries back, instead of pushing a loop onto the stack. The prototype's
`router.js` is the real design, not a mock-up of it.

**Guards that can veto Back.** A view with unsaved changes registers
`setGuard({ isDirty, save, message })`.
- *Clicking a link, the nav or a palette result:* the router asks first, using
  an in-app dialog with three buttons: **Keep editing / Discard / Save and go**.
- *Back or Forward:* popstate can't be cancelled. The router immediately calls
  `history.go(-delta)` to put you back, shows the same dialog, and if you pick
  Discard, replays `history.go(delta)`. This is better than re-pushing, which
  would wipe the Forward history. If `delta` is unknown (a missing state), it
  falls back to re-pushing.
- *Reload or closing the tab:* the usual `beforeunload`.
- Every page render calls `setGuard(null)` first, so a guard can't outlive its
  view.
- Composer drafts *also* keep their existing localStorage autosave. The guard
  is a courtesy, not the only safety net.

**Anchor-face deep links.** A group's URL is `/admin/faces/groups/f1203`,
where 1203 is a face in that group. Clusters are recomputed fresh on every
request, so a group has no lasting id. What lasts is the face. Resolving the
URL means "the group that currently contains face 1203". The overview payload
already includes each group's `faceIds`, so this is a client-side `find` with
no new endpoint. Three outcomes:
- **Found and unnamed:** open it.
- **The face has been named since:** the page says "This group was already
  named *X*", with a button to the next unnamed group (R). See
  `tmp/shots/desk-light-10-stale-anchor.png`.
- **The face is gone:** the groups list, with a note.

The anchor is the group's first face when the link was made. Moving between
groups always writes the next group's anchor (R). The selected face is
`?face=`, also a face id. Positions ("Group 3 of 12") are only ever displayed,
never put in a URL.

**Re-login overlay.** Every admin request already refreshes
`last_activity_at`, and the 3-minute badge poll runs while the tab is visible.
So in practice the 30-minute idle timeout bites when **the tab was hidden**
(phone locked, app switched) or at the 24-hour absolute cap. The fix is
recovery, not a heartbeat:
1. Any 401 from `api()` adds the failed request to a queue.
2. The page underneath stays exactly as it was (`inert`), and an overlay asks
   for the password.
3. After login, fetch a fresh CSRF token (it rotates hourly), replay the
   queue, then dismiss the overlay.

The route, scroll position and typed input are never touched. To try it in
the prototype: click "Expire session", then press `1` in Quick confirms. The
answer goes through after you sign in.

**Undo.** A single toast at a time, the latest action, also on the `Z` key.
The undo belongs to the area it was offered in: leaving that area drops it,
except when you land back on Today. Moderation uses the existing
`POST …/:type/:id/undo`. Faces uses batch revoke. Thank-yous: sent is sent,
which is why sending is the one flow with a check step.

## 6. The three core flows

### 6.1 Moderate the queue (from Today, about 2 minutes)

1. **Today**: the top card says "Review 7 new posts. Guests can't see these
   until you approve them. 3 photos · 2 messages · 2 comments". Press
   **Start reviewing** (or just `⏎`). → `/admin/review/media-412` (P).
2. One post fills the screen: author, a trust pill ("First post — approving
   trusts Hannah's future posts"), the content, and the actions **Approve `A`
   · Hide `H` · Reject `R`**, plus Skip `J` and Previous `K`. A flow bar shows
   "Review · 1 of 7" with a progress meter and a ✕.
3. Press `A`. The toast says "Approved Hannah's photo. Undo". The next pending
   post replaces this one in the URL (R). Repeat.
4. After the last one → `/admin/review/done` (R): "Queue clear." The primary
   button is **Next: Read 3 card replies** and the secondary is **Back to
   Today**.
5. Browser **Back** → Today, with the review card gone and "Approved 6 · Hid
   1" listed under Done today.

The list view (`/admin/review`) is still there for bulk work and the
approved/hidden/rejected archives. "Start" on the list opens the same
one-at-a-time view.

### 6.2 Name faces, from the first group to done

1. **Today** → "Name today's 5 face groups. 12 left in all, today's set is
   about 61 faces. No one is waiting on this." Press **Start the set** →
   `/admin/faces/groups/f1202?set=5`. `set` is used once and then removed from
   the URL.
   Or go **Faces** in the nav → the overview, which shows the progression as
   numbered steps: *1 Name the groups → 2 Quick confirms → 3 Same moment → 4
   Set aside*. That's the real dependency order, because naming groups is what
   lets Quick confirms make guesses.
2. The group screen shows a large face and "Who is this?" with the suggestion
   already filled in. The button says **Name all 19 `⏎`** (the count leaves
   out set-aside and excluded faces, in plain view). Below it is the strip of
   every face in the group, with set-aside faces dimmed at the end. The flow
   bar shows "1 of 12" and the pill "Today's set: 1 of 5".
3. Check the strip. `←` `→` walk through the faces (the URL `?face=` updates
   with R). `X` marks one as "not this person" and moves on. `O` opens the
   whole photo as a **dialog route**, and Back closes it.
4. Press `⏎`. "Named 19 faces **Auntie Lou** · Undo". The next group replaces
   this one (R). If you type a name nobody has yet, an inline button says "Add
   *Cousin Ada* as a new person". Creating a person is always a deliberate
   step, as the people API requires.
5. After 5 groups → `/admin/faces/groups/break` (R): "That's today's set. 5
   groups named, 71 faces now have a name", with the progress ring. The
   buttons are **Back to Today** and **Keep going: 5 more**. The faces task
   leaves Today and shows up under Done today.
6. When no groups are left → `/groups/done`: "Every group has a name. Quick
   confirms just got smarter." → `/faces/ask/f…`. There, one face is shown
   with buttons `1` *Auntie Lou* and `2` *Tom Okafor* (each with a confidence
   bar), plus `N` someone else, `S` skip, `O` photo. Answering moves to the
   next face (R).
7. Back at any point leaves the run and goes to where you started it.

### 6.3 Send a batch of thank-you cards

1. **Today** → "Send 4 finished cards. Written and waiting: Tom, Mei, Ben and
   1 more." **Send them** → `/admin/thanks/send` (P).
2. **Choose**: every draft is ticked. Untick any you want to look at again.
   "Open" goes to that card's composer. **Next: how to send** (P).
3. **How**: pick *the best way for each guest* (email if we have it, otherwise
   text, otherwise a link for you to copy), *email only*, or *I'll send the
   links myself*. A table shows how each guest will actually get it. Back →
   step 1, Forward → step 2.
4. **Check & send**: "3 by email · 1 by text". It previews the delivery email
   and has an optional personal line. **Send 4 cards** → a live "Sending 2 of
   4…" → **collapse** to `/admin/thanks/send/done`: "4 cards on the way", the
   ring at 63%, and a **Copy link** button for anyone without contact details.
5. **Back** → Today. The three steps are gone from history, and if you reach
   one with Forward, it says "That batch has already gone out".

Writing a card is the matching flow. Today says "Thank Dev Patel, honeymoon
fund, arrived 176 days ago, longest waiting". That opens the composer with the
right template picked. **Save** turns `/new` into `/cards/c10` (R) and offers
**Next: Hannah Kim →** (R), **Send just this one**
(`/send?cards=c10`), and **Back to Today**. Leaving with unsaved edits, even
with the browser's Back button, asks first.

## 7. Phone layout

- A top bar with the page title and a search button (that's the palette, so
  everything is one tap away). A bottom bar with 4 destinations and More.
- **In a flow, the bottom bar becomes the decision bar.** Approve / Hide /
  Reject, the name field with "Name all", or "Next" are fixed above the home
  indicator, at full thumb size. Keyboard hints are hidden.
- The flow bar shrinks to ✕, the progress count and the meter. The title is
  already in the top bar.
- Dialogs become bottom sheets, and the palette drops down from the top.
  Android's Back button closes both, because both are history entries.
- Face strip chips are 56px, comfortably tappable. The large face is capped at
  168px, so the strip and the name bar stay on screen together.
- Screenshots: `tmp/shots/phone-*.png`.

## 8. Cut, merged, moved

| Today's admin | Here |
|---|---|
| Stats grid above the tabs | Gone from the shell. Guest numbers are in the Guest list header. Pre-wedding Today has RSVP tasks instead |
| 11 tabs in one row | Five labelled groups, with Today on top |
| Inbox tab (3 cards with tiny "Open →" buttons) | **Today**: one ordered list, one big primary action, time estimates, Later, Done today |
| Login toast "N items waiting in Moderation" | The Today badge, plus the first task |
| Moderation › Accounts pill | Guests › Accounts. "See posts" filters the queue with `?account=` |
| Moderation detail modal + confirm modal | The review route, with no confirm (Undo instead) |
| Gallery Official/Loved pills | Sub-routes `/gallery` and `/gallery/loved` |
| Faces: one long page (Set aside, Groups, Ask, Same moment, Identified, People, Batches stacked) plus "review mode" keyed by array index | Seven sub-routes with a sub-nav. Overview = numbered steps. Groups addressed by anchor face. "Identified" folded into People. "Recent bulk passes" → History |
| Thank yous: progress + queue prompt + Cards/Mailbox pills + gifts table + cards table + an in-panel editor + a per-card send modal | Cards home (next up and ready to send first), Gifts, Mailbox, the composer as a route, a **batch** send flow (a single card is a batch of one) |
| "Email me on first reply" checkbox in the toolbar | At the bottom of the Mailbox |
| Blocklist as a top-level tab | Under Guests, next to Requests (which is what it blocks) |
| `history.replaceState('#tab')` | Real paths. Old hashes are redirected |

Deliberately **not** added: dashboards and charts, a notifications centre
(Today is the notifications centre), a Faces "wizard" that traps you. The
group screen is a flow you can leave at any face, and every confirm is a
single POST, as now.

## 9. Build cost against the current code

These are rough, focused working days. No server changes are needed beyond
the fallback route.

| Piece | Work | Est. |
|---|---|---|
| `core/static.js` `/admin/*` → admin `index.html` fallback, plus an integration test | ~20 lines | 0.25 |
| `router.js` (from the prototype) + unit tests for `match`, guards and `returnTo` | new, ~250 lines | 1 |
| Shell: sidebar/topbar/bottom bar from a NAV model; `main.js` `switchTab` → route table; panels become view modules with `render`/`mount` (each module already has `init`/`load` split) | rewrite `main.js`, restructure `index.html` | 1.5 |
| Dialogs as routes: one `openDialogRoute()` wrapper over the existing `<dialog>`s and `openModal` | ~120 lines + call sites | 0.75 |
| Palette (`/`, ⌘K) over nav, tasks, guests, people, cards (data already loaded or one call each) | new, ~200 lines | 0.5 |
| Today: grow `inbox.js` from 3 streams to 6 using existing endpoints (`moderation/counts`, `thank-you/counts` + `replies`, `petitions/counts`, `faces/overview`); Later and Done today in localStorage | ~350 lines | 1 |
| Review route: turn the modal step-through in `moderation.js` into a view; drop the confirm modal for approve/hide/reject; Undo toast over the existing `/undo` | moderate | 1 |
| Faces: split `face-assignment.js` (2,967 lines) into view modules for the sub-routes; `reviewGroupKey` index → anchor face id; `?face=`; sets; break/done screens. Server untouched (overview already carries `faceIds`) | biggest piece | 2.5 |
| Thank-yous: editor → route + router guard; per-card send modal → 3-step batch flow looping over the existing per-card `POST /thank-you/send` (claim-first is per card already) | moderate | 1.5 |
| Re-login overlay: `auth.js` 401 path → overlay; retry queue + CSRF refresh in `api()` | ~120 lines | 0.5 |
| Phone CSS: bottom bar, decision bar, sheets | CSS | 0.75 |
| **Total** | | **≈ 11 days** |

Risk: the Faces split, since that module is load-bearing and heavily
commented. The cheapest staging is router + shell + Today first, with the old
panels mounted as-is as views. Then Review, then Thank-yous, then Faces.

## 10. Open questions for the owner

1. **Size of the face set.** 5 groups a day is a guess. Should it be a count
   of faces (about 60) or of minutes (about 5) instead?
2. **Today's order.** The proposal is: guests waiting → replies → requests →
   send drafts → next thank-you → faces. Should the next thank-you rank above
   replies, given the wedding was six months ago?
3. **Is "Later" allowed** on the review queue, where guests are waiting? The
   prototype allows it everywhere.
4. **One undo toast at a time** (latest only), or a small stack?
5. **Batch send channel choice:** is "best way for each guest" safe as the
   default, or should email-only be the default?
6. **Pre-wedding mode** is only reordered here. Is that enough, or should
   pre-wedding Today get RSVP-specific tasks worked out in full?
