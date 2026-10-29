# Admin redesign — "Guided journeys"

One of three parallel proposals. This one starts from the observation that
post-wedding admin work is not a set of tools, it is a short list of **jobs with
a beginning and an end** — keep the guestbook tidy, curate the gallery, name the
faces, thank everyone — and that the current dashboard hides the shape of every
one of them behind a tab that opens onto a long vertical page.

Prototype: `node prototypes/serve.js 4787`, then open
<http://localhost:4787/admin-journeys/>. Every path below is real in the
prototype with `/admin` replaced by `/admin-journeys`. Fake data only; every face
and photo is a generated SVG. The dashed **Prototype ⚙** button switches season
(pre/post), light/dark, expires the session, and resets the demo.

---

## 1. Principles

1. **A journey is a feature, not a wizard on top of one.** A journey's steps *are*
   its sub-tabs. There is one structure, so there's nothing to keep in sync and no
   "wizard mode" vs "power mode". The stepper is the tab bar.
2. **Every step says what it is for, in large type, the first time.** The step's
   intro is a tinted panel with a serif headline, one or two sentences, and two
   or three "→" bullets. Doing the step's work once shrinks it to the heading and
   a "What do I do here?" button (remembered per step). Exposition is loud when you
   need it and gone when you don't.
3. **There is always one obvious next thing.** Home leads with a single "Next up"
   card. Every step has a sticky action bar whose right-hand button is
   "Skip ahead: <next step>" (quiet) until the step is done, then becomes
   "Next: <next step>" (primary, gently pulsing). On a phone that slot holds the
   action for the current item instead (Approve, Name all 23, Check 3 cards).
4. **Every feature is one click away, always.** Desktop: a sidebar lists every
   journey and tool, and expands the current journey into its numbered steps. The
   "Everything…" page is a plain index. Nothing hides under a "more" menu on desktop.
5. **Back undoes navigation, never work.** Screens push history; stepping through
   items *within* a screen replaces it. You never re-walk forty approvals with Back,
   and Back never lands you on a "Send 6 cards" button you already pressed.
6. **The URL always names what you're looking at.** Reload, a bookmark, a link in
   the digest email, or a re-login all return to the same screen, the same group,
   the same post.
7. **Finishing feels finished.** Each step has an empty state that says it's done
   ("All the big groups are named") and each journey ends on a completion screen
   that points at the next journey in the natural order.
8. **The season decides the order, not the existence.** After the wedding, the
   post-wedding journeys come first and the pre-wedding ones sit below, dimmed, as
   plain links. Before the wedding it flips. Nothing disappears.

---

## 2. Navigation tree and journey map

```
Home  /admin                                  "Next up" card + journey map
│
├─ AFTER THE WEDDING  (first in post mode — "in the order we'd do them")
│  ├─ 1 Keep the guestbook tidy  /admin/review        (ongoing; badge = posts waiting)
│  │     1 Look at new posts     /review/new  (one at a time)  ·  /review/all (all at once)
│  │     2 Pin your favourites   /review/favorites
│  │     3 Trust the regulars    /review/trusted
│  ├─ 2 Curate the gallery       /admin/gallery
│  │     1 Add the official photos   /gallery/add
│  │     2 Put them in order         /gallery/order
│  │     3 Bring in guests' favourites /gallery/loved
│  ├─ 3 Name the faces           /admin/faces
│  │     1 Who's in the photos?      /faces/people
│  │     2 Name the big groups       /faces/groups  →  /faces/groups/f<faceId>
│  │     3 Answer the hard ones      /faces/ask/f<faceId>
│  │     4 Same moment, same person  /faces/same-moment
│  │     5 Check the results         /faces/check  (People · Set aside · History)
│  └─ 4 Thank everyone           /admin/thanks        (badge = ♥ unread replies)
│        1 Log the gifts             /thanks/gifts
│        2 Write the cards           /thanks/write  →  /thanks/write/c<cardId>
│        3 Send them                 /thanks/send  →  /preview  →  /sent
│        4 Read their replies        /thanks/replies
│
├─ BEFORE THE WEDDING  (first in pre mode; flat links in post mode)
│  └─ Get everyone there     /admin/invite
│        Guest list  /guests · Invitations  /invites · RSVPs  /rsvps · Invitation requests  /requests
│
├─ YOUR SITE   (tools, not journeys — no beginning or end)
│     Words & pictures  /site · Look & effects  /site/effects
│
└─ Everything…  /admin/all     plain index of every step and tool
```

**Why this order.** Review comes first because it is the only recurring job and
the only one with a cost of delay (guests' posts sit invisible). Gallery precedes
Faces because the faces are detected in gallery photos. Faces precedes Thanks
because once faces are named the card composer can offer *"Photos Marcus is in"*
— the prototype does this: name the groups, then open a card for a named guest
and the photo picker fills with photos of them. That cross-journey payoff is the
argument for the order, not just taste.

**Home** has three layers, top to bottom: a greeting with the season ("Six months
married" / "181 days to go"); the **Next up** card — one sentence, one button,
chosen by priority (posts waiting → unread replies → groups to name → cards to
write); then the **journey map** — numbered cards, each with a progress bar in the
journey's own unit ("38 of 212 faces named", "4 of 12 guests thanked"), its steps
as chips (done ones ticked), and a "Continue · Step 3: Answer the hard ones" button
that resumes exactly where you left that journey. Below that, the other season's
features as quiet tiles.

**A journey's overview** (`/admin/faces`) is the same map zoomed in: a vertical
path of numbered steps with their ledes and live counts, "you were here" on the
remembered step, and one big Continue button.

---

## 3. History model (the rules the route table applies)

| Kind of move | History op | Example |
| --- | --- | --- |
| Open a screen (sidebar, stepper, Next/Skip ahead, open a group/card/person) | **push** | `/faces/groups` → `/faces/groups/f1001` |
| Step to the next item *within* a screen | **replace** | group → next group; post → next post; card → "Save and write the next one" |
| Switch a segmented sub-view within a step | **replace** | People ⇄ Set aside ⇄ History; One at a time ⇄ All at once |
| Open a dialog | **push** (its own route) | `/thanks/gifts` → `/thanks/gifts/new` |
| Close a dialog (✕, Esc, backdrop) | **back()** if the previous entry is its parent, else **replace** to the parent | deep-loaded `/faces/groups/f1025/photo/m322` + Esc → `/faces/groups/f1025`, nothing to Back into |
| "Up" link (← All groups, ← All cards) | **back()** if the previous entry is the parent, else **push** the parent | avoids list → item → list duplicates |
| Finish the last item of a step | **up** to the step root | last group named → back to `/faces/groups`, now its "All named ✓" state |
| Irreversible commit | **replace** the confirm screen with the result | `/thanks/send/preview?ids=…` → `/thanks/send/sent?ids=…` |
| A stale deep link (item already handled) | **replace** with the next live item, or the step root | `/faces/groups/f1001` after that group was named → next open group |

The router keeps an index in `history.state` and a small `idx → path` map in
sessionStorage, which is what makes "is the previous entry the parent?" answerable.

---

## 4. Route table

All paths are under `/admin`. † = designed but not built in the prototype (it
shows Not found). **Back** describes what the browser Back button does when you
arrived the normal way (by clicking through); a deep-loaded URL's
Back leaves the admin, as any website does — but every screen also has an "up"
link and the sidebar, so you're never stranded.

### Shell

| Path | Screen | Back from here |
| --- | --- | --- |
| `/admin` | Home: Next up + journey map | leaves admin (it's the root) |
| `/admin/all` | Everything index | previous screen |
| `/admin/<unknown>` | Not found, link to Home | previous screen |
| *(overlay, not a route)* | Re-login | n/a — URL never changes |
| *(overlay, not a route)* | Leave-without-saving guard | n/a |

### Keep the guestbook tidy

| Path | Screen | Back from here |
| --- | --- | --- |
| `/review` | Journey overview | previous screen |
| `/review/new` | Redirects (replace) to the first waiting post; else "All caught up" | the screen before the step |
| `/review/new/:key` (`g-201`, `m-342`, `c-77`) | One post, large: Approve / Hide / Reject / Decide later (`a h r s`) | **the screen before the step** — decisions replace, so 9 approvals are not 9 Back presses |
| `/review/all` | All waiting posts, checkboxes, bulk approve/reject (replace-switch with the above) | the screen before the step |
| `/review/favorites` | Approved messages with a pin star | previous step |
| `/review/trusted` | Accounts with a trust switch (was Moderation › Accounts) | previous step |
| `/review/done` | Completion + "Next: <next journey>" | previous step |

### Curate the gallery

| Path | Screen | Back from here |
| --- | --- | --- |
| `/gallery` | Overview | previous |
| `/gallery/add` | Drop zone + recent official uploads | previous |
| `/gallery/add/upload` *(dialog)* † | The existing uploader as a route | closes |
| `/gallery/order` | Ordered list, ↑/↓, inline captions | previous step |
| `/gallery/order/m:id/references` *(dialog)* † | "Used in N thank-you cards" before removing | closes |
| `/gallery/loved` | Most-hearted guest photos, "Add to official" | previous step |
| `/gallery/done` | Completion | previous step |

### Name the faces

| Path | Screen | Back from here |
| --- | --- | --- |
| `/faces` | Overview path, Continue | previous |
| `/faces/people` | Who's in the photos: people list, roster links, "Add the other N guests" | previous |
| `/faces/people/new` *(dialog)* | Add someone (name + optional roster link) | closes |
| `/faces/people/p:id` *(dialog)* † | Rename / merge / link / retire a person | closes |
| `/faces/groups` | Group list (fixed-height rows), "Start with the biggest group" | previous step |
| `/faces/groups/f:faceId` | **Group review** anchored on a face: big face, filmstrip, "Who is this?", Name all N. `←/→` face, `x` leave out, `[ ]` group, Enter name | **group list** (group-to-group stepping replaces) |
| `/faces/groups/f:faceId/photo/m:mediaId` *(dialog)* | The photo, the face boxed, everyone else in it | closes, same group, same face selected |
| `/faces/ask` | Redirects to the first open question; else "All answered" / "Name a group first" | previous step |
| `/faces/ask/f:faceId` | One face, "Is this…" 2–3 big candidate buttons (`1 2 3`), Someone else, Skip `s`, Not a face `x` | previous step (answers replace) |
| `/faces/ask/f:faceId/photo/m:mediaId` *(dialog)* | Photo | closes |
| `/faces/same-moment` | Near-duplicate pairs, "Yes to all N" | previous step |
| `/faces/check` | Kpis + People grid | previous step |
| `/faces/check/p:personId` | One person's faces, "Not them" per face | People grid |
| `/faces/check/set-aside` | Photos with small/blurry faces (replace-tab) | previous step |
| `/faces/check/set-aside/photo/m:id` *(dialog)* | Name a set-aside face by hand | closes |
| `/faces/check/history` | Assignment batches, "Undo this" (replace-tab; was the Batches panel) | previous step |
| `/faces/done` | Completion | previous step |

### Thank everyone

| Path | Screen | Back from here |
| --- | --- | --- |
| `/thanks` | Overview | previous |
| `/thanks/gifts` | Gift log with each guest's card status | previous |
| `/thanks/gifts/new`, `/thanks/gifts/g:id` † *(dialog)* | Log / edit a gift | closes |
| `/thanks/write` | "Start with <guest>", Still to write, Drafts | previous step |
| `/thanks/write/c:cardId` | **Composer**, guarded: message, reroll, photos (of them, if faces are named), style, live preview. Save draft / **Save and write the next one** | card list (next-card stepping replaces) |
| `/thanks/send` | Every draft, checkbox + channel (defaulted to one that can reach them; "no email on file" in red) | previous step |
| `/thanks/send/preview?ids=…` | Last look: each card exactly as sent (SMS bubble, email subject) · **Send N cards now** | send list |
| `/thanks/send/sent?ids=…` | Result, links to copy for "I'll share a link" cards | **send list** — the preview entry was replaced, so you can't land on "Send" again |
| `/thanks/replies` | Replies, unread first | previous step |
| `/thanks/replies/c:cardId` *(dialog)* | One reply (marks read) | closes |
| `/thanks/done` | Completion | previous step |

### Before the wedding / site

| Path | Screen | Back from here |
| --- | --- | --- |
| `/invite` | Pre-wedding journey overview | previous |
| `/guests` · `/guests/new` · `/guests/g:id` · `/guests/import` | Guest list; dialogs as routes | previous / closes |
| `/invites` · `/invites/manual` | Send invitations; copy-paste texts (was Manual SMS modal) | previous |
| `/rsvps` | RSVPs + the headcount kpis (moved off the top of every tab) | previous |
| `/requests` · `/requests/blocked` | Invitation requests; Blocked (was the Blocklist tab) | previous |
| `/site` · `/site/effects` | Words & pictures (guarded) · Look & effects | previous |

---

## 5. The three core flows

### A. Moderate the queue (≈ 3 minutes)

1. Open `/admin`. The **Next up** card reads "9 new posts from guests — Nothing
   appears on the site until you've looked." One button: **Review them now**.
2. Lands on `/review/new/g-201`. First visit: the intro panel explains Approve /
   Hide / Reject in three lines. Below it, the post, large — a message in the
   display serif, or the photo — with the author, how long ago, and a red "Looks
   like spam" chip where warranted. If the author has posted several times and
   isn't trusted, a green nudge: "Leo has posted 9 times. *Trust them* and their
   posts will go straight up."
3. **Approve** (or `a`). Toast: "Approved — it's on the site. *Undo*". The URL
   *replaces* to the next post. The intro has shrunk to its heading — you've
   shown you know what to do. Progress bar ticks.
4. Repeat. "Decide later" (`s`) moves on without deciding. Prefer a list? **All at
   once** switches (replace) to checkboxes + bulk Approve/Reject.
5. Last post decided → `/review/new` shows **All caught up**, and the action-bar
   button turns primary: **Next: Pin your favourites →**. Optional; skip it and
   nothing is lost.
6. Press Back: you're on Home, not on post 8.

### B. Name the faces, first group to done (≈ 20–40 min, any number of sittings)

1. Sidebar **Faces** → `/faces`. The path shows five steps; step 1 is already ticked
   ("8 people — filled in from your guest list"). **Start · Step 2: Name the big
   groups →**. (Anyone wanting to add a child or the photographer clicks step 1:
   `/faces/people`, **+ Add someone** opens `/faces/people/new` as a dialog route;
   Back closes it.)
2. `/faces/groups`: the intro ("Type a name once and the whole group is named"),
   then one big **Start with the biggest group · 24 faces →** and the fixed-height
   group list beneath it for anyone who'd rather pick.
3. `/faces/groups/f1001` — **Group 1 of 8**. Left: the selected face, large. Right: a
   bordered **Who is this?** panel (name input with the people list as suggestions,
   **Name all 23 faces →**), and the filmstrip of every face in the group. Faded
   faces are set-aside (too small) and excluded automatically.
4. Something off? Tap the odd face in the filmstrip (or `→` to it), **Not the same
   person** (`x`). It greys out with a ✕; the button now reads "Name all 22"; the
   panel says it'll come back in step 3. **Open the photo** pushes
   `/faces/groups/f1001/photo/m322`; Esc/Back returns to the same group with the same
   face selected.
5. Type "Auntie Lou", Enter. Toast "Named 23 faces as Auntie Lou · *Undo*". The URL
   replaces to the next group's anchor. When a later group is the same person, the
   panel says "We think this is **Auntie Lou**" — one tap.
6. Last group named → the router goes **up** to `/faces/groups`, which now says **All
   the big groups are named** with a pulsing **Next: Answer the hard ones →**.
7. `/faces/ask/f1030` — one face, **Is this…** and 2–3 big name buttons with "close
   call / leaning / fairly sure" in words (not margins), `1 2 3` on a keyboard. The
   faces you left out in step 2 are first. Each answer replaces to the next.
8. **Same moment** (`/faces/same-moment`): pairs of near-identical frames, **Yes to
   all 6 →**.
9. **Check the results** (`/faces/check`): who's named, how many each; open a person to
   remove a wrong face; *History* undoes a whole sitting. **Finish →** `/faces/done`:
   "That's everything" and **Next: Thank everyone →**.
10. Close the laptop mid-way. Tomorrow, Home's Faces card says "Continue · Step 2:
    Name the big groups" and drops you on the exact group, because the URL is
    anchored on a face, not an index.

### C. Send a batch of thank-you cards

1. Sidebar **Thank-yous** → `/thanks` → **Continue · Step 2: Write the cards** (gifts
   are already logged — step 1 is ticked).
2. `/thanks/write`: **Start with Tom & Ellie Reyes →** creates a draft and pushes
   `/thanks/write/c508`. The message is pre-written from their name and their gift
   ("thank you so much for the honeymoon kayak trip…"); **↻ Try different wording**
   rerolls; **Add a photo** shows photos they're in (from step B), else the gallery.
   Live preview on the right.
3. Edit the text, then accidentally click **Faces** in the sidebar → *Leave without
   saving? Keep editing / Discard / Save and leave*. Press browser Back instead →
   same dialog; *Keep editing* restores the URL with the text intact (§6).
4. **Save and write the next one →** saves and replaces to the next guest's card.
   Repeat. The last one says **Save and finish →** and goes up to the list.
5. Stepper → **Send them** (`/thanks/send`): every draft, ticked, with a channel per
   guest defaulted to one that can actually reach them. Untick anyone not ready.
6. **Check 3 cards before sending →** `/thanks/send/preview?ids=…`: each card as
   the guest will get it — the SMS bubble or email subject, the message, the
   polaroids. **Send 3 cards now**.
7. `/thanks/send/sent?ids=…` *replaces* the preview: "3 cards are on the way", plus
   copyable links for any "I'll share a link" cards. Back goes to the send list
   (now shorter), never to the Send button.
8. **Next: Read their replies →** unread first; open one (`/thanks/replies/c501`
   dialog) to read and mark it read.

---

## 6. Guards, re-login, and anchor-face deep links

**Unsaved-changes guard.** A screen registers `{ dirty(), save(), discard(), what }`
with the router (composer and site content do). Three entry points:

- *In-app navigation* (any `<a>` or `navigate()`): ask first — **Keep editing /
  Discard / Save and leave** — and only then move.
- *Browser Back/Forward*: popstate can't be cancelled, but the router stores an
  index in `history.state`, so it knows the delta. It immediately undoes the move
  with `history.go(+delta)` (forward history intact — better than re-pushing), shows
  the same dialog, and on Discard/Save replays `history.go(-delta)` with the guard
  bypassed. If the index is missing (an entry from before the router loaded), it
  falls back to re-pushing the old URL.
- *Reload / close tab*: `beforeunload`.

Working copies live in module state, not the DOM, so a re-render, a vetoed
navigation or a re-login never loses a word. (The real composer already keeps
localStorage drafts; keep them as the belt to this brace.)

**Re-login overlay, not a login page.** Every mutating call goes through
`withSession(where, fn)`. On a 401, instead of `state.onAuthRequired()` swapping
the whole dashboard for the login section (today: `utils.js` `api()` →
`onUnauthorized`), show an overlay *over the current screen*: "Welcome back — your
place is saved — you'll carry on right where you were: **Name the faces · Group 4
of 8**", a password field, **Carry on**. On success the failed request is retried
and nothing else happens: same route, same scroll, same selected face, same draft.
Paired with a cheap keep-alive (an authenticated `GET /api/admin/stats` every ~10
min while there has been input in the last 5), long sessions rarely see it at all.
Prototype: ⚙ → *Expire my session*, then do anything.

**Anchor-face deep links.** Group keys are array indices today (`key: index` in
`api/admin/faces.js`), so they shift whenever a group is named. The route uses a
**face id** instead: `/faces/groups/f1234` means "the group that currently contains
face 1234". Resolution on load: recompute groups (as today), find the one holding
the face; if none (named, or not-a-face), replace to the next open group, or the
list if none remain. When stepping, the anchor written into the URL is the group's
lowest live face id, which stays put as long as that face does. Ask cards are
already per-face. The same rule makes the digest email's links and Home's
"Continue" stable across days of other naming.

**Resume.** Each journey remembers its last step path (a dialog remembers its
parent; completion and transient screens are not remembered). Home's and the
overview's **Continue** use it, falling back to the first unfinished step.

---

## 7. Mobile (≤ 860 px)

- **Bottom tab bar**: Home · Review · Faces · Thanks · All, with the same badges.
  "All" is the Everything index — the one place a feature is two taps away; the
  three daily journeys are one tap.
- **Stepper → step picker**: "Step 2 of 5 · Name the big groups ▾" opens the step
  list with counts; a five-segment progress strip sits under it.
- **Action bar sits above the tab bar** and holds the action for *this item* in
  the thumb zone — Hide · Reject · **Approve**; **Name all 23 →**; **Check 3 →** —
  until the step is done, when it becomes **Next: … →**.
- **Group review re-flows**: face (140 px) beside its counter, then the name panel,
  then the filmstrip — so the name box is above the fold.
- **Dialogs become bottom sheets**; Back closes them like on desktop.
- Keyboard hints are hidden; the intro's eyebrow is dropped (the picker says it).

---

## 8. Cut, merged, moved

| Today | Becomes | Why |
| --- | --- | --- |
| 11 tabs in one row | 4 post-wedding journeys + 4 pre-wedding links + 2 site tools, grouped and ordered by season | one click, natural order, nothing below the fold |
| Inbox tab | Home's **Next up** card + journey badges | Inbox was a summary that linked away — the map *is* that summary, with progress |
| Stats grid above every tab | RSVPs page | it's pre-wedding information on every post-wedding screen |
| Moderation › Accounts pill | Review › **Trust the regulars** | trust exists to shorten the queue — it belongs to that job |
| Gallery › Loved pill | Gallery › step 3 | |
| Thank yous › Mailbox subnav | Thanks › **Read their replies** | |
| Per-card send wizard (modal) | **Batch send**: choose → preview → sent, as routes | the owner sends in sittings, not one by one |
| Faces: Set-aside panel, Groups, Ask, Same moment, Identified, People, Batches stacked | five step routes; Identified+People → step 1 and step 5; Batches → Check › History; Set-aside → Check › Set aside | "didn't even know about the stuff at the bottom" |
| Faces "review mode" with Group N of M by index | `/faces/groups/f<faceId>` | stable, reloadable, Back-able |
| Blocklist tab | Requests › Blocked | it only exists for requests |
| Effects tab | Your site › Look & effects | sibling of the content editor |
| Manual SMS modal | Invitations › Text them yourself | |
| `window.confirm` guards | in-app 3-way dialog incl. Save and leave | |
| Login section swap on 401 | re-login overlay | keeps place |

Deliberately **not** added: a global search, notifications centre, or
customisable dashboard — each is a second way to do what the map already does.

---

## 9. Build cost against the current code

Rough, for one person who knows the codebase. The tab modules mostly survive;
what changes is how they're mounted and how they're navigated.

| Work | Notes | Est. |
| --- | --- | --- |
| Server: `/admin/*` → admin `index.html` | `core/static.js` maps extensionless paths to `pages/<path>/index.html`; add an `/admin/` prefix fallback (+ CSP/headers unchanged) and an integration test | 0.5 d |
| Router module | `prototypes/admin-journeys/router.js` is close to shippable (~200 lines, no regex): push/replace/up, dialog routes, guard with go(±delta), beforeunload, link interception. Port to the JSDoc/`types.d.ts` conventions + unit tests | 1.5 d |
| Shell: sidebar, stepper, action bar, intro, tab bar, Home map, overviews, completion screens | New HTML/CSS; journey table (`journeys.js`) drives all of it. Progress counts need one cheap endpoint (or reuse `moderation/counts`, `thank-you/counts`, `faces/overview`) | 3 d |
| Convert 11 tab modules to `mount(params)/unmount()` | Today each has `init*()` + `load*()` and assumes its panel exists; panels move out of `index.html` into per-route templates. Mostly mechanical | 2 d |
| Dialogs → routes | ~23 `<dialog>`s, ~24 `openModal()` call sites. Only the ones a user would Back out of need routes (detail views, add/edit, photo); confirm dialogs stay modal | 1.5 d |
| Faces split into five routes + face-id anchors | `renderBody()` already composes per-section functions — they become step screens. Server: expose each group's anchor face id; client resolves `f<id>`; replace `reviewGroupKey` index | 2 d |
| Moderation one-at-a-time view | The detail modal already has review-mode nav (`detailItem` index); promote it to a route keyed by `type-id` | 1 d |
| Thank-you batch send | Client loop over the existing per-card `send` endpoint, or a small `POST /thank-you/send-batch` that reuses claim-first send; preview/sent screens | 1.5 d |
| Re-login overlay + keep-alive | Change `utils.js` `api()` `onUnauthorized` to queue the request and show the overlay; retry on login | 1 d |
| Intro panels, empty/complete states, copy | Writing, mostly | 1 d |
| Tests + a11y pass (focus on route change, live regions, keyboard) | | 2 d |
| **Total** | | **≈ 17 days** |

Cheaper first slice (≈ 6 d): server fallback + router + sidebar + Faces split with
anchors + re-login overlay. That alone answers "back button", "stuff at the
bottom", "number was a link" and "lost my place".

---

## 10. Open questions for the owner

1. **Should finished steps stay ticked?** Today "Trust the regulars" is ticked as
   soon as anyone is trusted. Is a tick "done for now" (recurring) or "never again"?
2. **Batch send — one endpoint or a loop?** A batch endpoint is cleaner for partial
   failures ("2 of 6 failed — retry those"); a loop ships sooner.
3. **How loud should the intro be on a phone?** It's full-size on first visit;
   the alternative is to start compact on phones.
4. **"Continue" on Home — last place, or most valuable place?** It resumes where
   you left; the Next-up card picks by value. Is having both right?
5. **Does the couple share one login?** If both work at once, "you were here" is
   per-browser (as built) rather than per-person.
