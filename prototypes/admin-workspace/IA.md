# Admin redesign — "Workspace"

A persistent, grouped, mode-aware sidebar with every feature one click away, and
behind it **list → detail split views** that work like a good mail client: the
queue on the left, the selected item on the right, actions in place, `j`/`k` to
move. Faces becomes a **three-pane review** (groups | faces in the group | who is
it), framed as a four-step walk. Every place is a real URL. Back always goes to the
previous *screen*.

Prototype: `node prototypes/serve.js 4757` → <http://localhost:4757/admin-workspace/>
(fake data, no images; `?reset` on any URL restores the fixture. The "Prototype"
menu in the top bar can simulate a session expiry). The prototype is mounted at
`/admin-workspace`; every path below is written as it would be in the real app,
under `/admin`.

---

## 1. Principles

1. **One click to anything, always.** The sidebar never scrolls away and never
   changes shape. Phones get a four-item bottom bar plus **More**, which is a page
   listing the whole tree.
2. **Back undoes navigation, not motion.** Going somewhere is `pushState`. Moving
   the selection inside a list that already shows a selection (`j`, `k`, clicking
   the next row, auto-advancing after Approve) is `replaceState`. So a session of
   thirty decisions in Review is *one* history entry, and Back leaves Review to
   wherever you came from, instead of replaying thirty posts.
3. **The URL is the place.** Section, sub-view, filter, selected item, open
   dialog, and the step of a flow are all in the path or query string. Reload, a
   bookmark, a link in the digest email, or a re-login all land exactly there.
4. **Anchor on things that don't move.** Faces URLs name a *face id*, never a group
   index. Review URLs name a post's type and id. A link to something that has
   since changed state resolves to a "this is now X" card, never a 404 and never a
   different item.
5. **Every screen says what to do next.** Lists start with the item that needs you
   first. Each detail has one primary action. When a queue runs dry, the empty state
   is a button to the next step ("All caught up → Next: name the faces (9 groups)").
   Home is three numbered steps, and only the first unfinished one is highlighted.
6. **Never lose your place.** The sidebar remembers the last path in each section
   (leave Faces on face 1240, go to Cards, click Faces → face 1240). Pane scroll is
   kept across re-renders. Session expiry raises an overlay and never navigates.
   Unsaved edits veto navigation, including the browser's Back button.
7. **Undo instead of confirm.** Approve, hide, reject, name a group, mark not a
   face, apply same-moment matches: all are done immediately, with an Undo toast
   (`z`). Confirm dialogs are kept for things that really can't be undone (send,
   delete) and for discarding unsaved work.
8. **Density done well.** Fixed-height rows, two lines each, truncated, with a
   thumbnail or monogram. The detail pane gets the room. Keyboard hints are inline
   on the buttons, and are hidden on touch screens.

## 2. Navigation tree

The same twelve items in both modes, re-ordered by season. The mode comes from the
wedding date (`getTimelineMode` in `content.js`, the pattern `isRegistryShown`
already uses). The sidebar footer shows the current order ("After the wedding"),
and an admin can flip it by hand.

**After the wedding** (default now):

```
Home                        three numbered steps + "pick up where you left off"
MEMORIES
  Review posts      (14)    was Moderation › Queue
  Name faces        (17)    was Faces (all 7 stacked sections)
  Gallery                   Official | Most loved   (was Gallery's pills)
THANK-YOUS
  Gifts              (2)    was the gift table inside Thank yous
  Cards              (6)    was the card table + composer + send wizard
  Replies          (♥ 1)    was the Mailbox pill
GUEST LIST
  Guests & RSVPs            Guests + RSVPs merged
  Accounts                  was Moderation › Accounts
  Requests           (1)    Invitation requests + Blocklist merged
SITE
  Site content
  Effects
```

**Before the wedding:** Home · Guest list (Guests & RSVPs, Requests, Accounts) ·
Site · Memories (Review posts, Gallery, Name faces) · Thank-yous. Nothing is hidden
in either mode. Things just move down.

**Counts** are work that's waiting, never totals: pending posts, unnamed groups plus
open questions, gifts with no card, drafts, unread replies, pending requests. One
poll refreshes them all (the existing 3-minute poll), along with every badge.

**Bottom bar (phones):** after the wedding it's Home · Review · Faces · Cards ·
More. Before the wedding it's Home · Guests · Requests · Site · More. Gifts and
Replies are one tap from Cards through the Thank-yous segmented control at the top
of each list. That control only appears when there's no full sidebar.

## 3. Layout

```
┌──────────┬──────────────────────────────────────────────────────────┐
│ J&J      │ Memories › Review posts › Hannah Weiss · Photo   ? Keys  │ ← breadcrumb = URL
│          ├──────────────────────┬───────────────────────────────────┤
│ Home     │ Review posts         │ PHOTO · 18M AGO · 1 OF 14   ↑ ↓   │
│ MEMORIES │ [To review 14|Hidden]│ ┌───────────────────────────────┐ │
│ ▸Review 14│ (All)(Photos)(Msgs) │ │           the post            │ │
│  Faces 17│ ▌Hannah · Photo  18m │ └───────────────────────────────┘ │
│  Gallery │  Grandpa Walt   22m  │ Hannah Weiss · Friend of the bride│
│ THANK-YOU│  Sam · Comment  31m  │ [Trust Hannah t]                  │
│  Gifts 2 │  …                   │                                   │
│  Cards 6 │                      ├───────────────────────────────────┤
│  …       │ j k move · x tick    │ [Approve a] [Hide h] [Reject r]   │ ← sticky
└──────────┴──────────────────────┴───────────────────────────────────┘
```

- **≥1200px:** sidebar 236px with labels. List pane 360px. Detail fills the rest.
- **900–1199px:** the sidebar becomes a 68px icon rail (counts become corner
  badges, labels become tooltips). List pane 320px.
- **<900px (phones):** no sidebar, a bottom bar instead. The split collapses to one
  pane. The list route shows the list, the item route shows the detail with a
  "‹ Review" chevron. The breadcrumb shrinks to its last segment. Dialog routes
  become bottom sheets. Wide screens auto-select the first item (with
  `replaceState`). Phones don't, because there the list *is* the screen.

## 4. Route table

`sel` means selection: changing it inside the same list is `replaceState`. Every
other link is `pushState` unless noted. "Back" describes the *default* history
for someone who clicked their way in. Deep links and reloads behave the same,
except that the first entry has nothing before it.

### Shell

| Path | Screen | Back from here |
|---|---|---|
| `/admin` | Home: three steps + resume link | Previous site page (leaves the admin) |
| `/admin/more` | Phones only: the whole tree as a list. On wide screens it redirects (replace) to `/admin` | Previous screen |
| *(any path, logged out)* | Login form drawn over that route. After sign-in the route renders in place | n/a: no history entry |
| *(session expired)* | Re-login overlay over the current screen (§7) | n/a: no history entry |

### Memories

| Path | Screen | Back from here |
|---|---|---|
| `/admin/review` | Queue. Wide: replaces itself with the first item | Previous screen |
| `/admin/review?status=hidden\|rejected\|approved&type=photo\|message\|comment` | Filtered queue. Filter chips use `replaceState` | Previous screen |
| `/admin/review/photo-411` (also `video-`, `message-`, `comment-`) `sel` | Post in detail. a/h/r act and advance (replace) | Wide: previous screen. Phone: the list |
| `/admin/review?author=a5` | Queue filtered to one account (from Accounts) | Account |
| `/admin/faces` | Redirects (replace) to the first unfinished step | — |
| `/admin/faces/groups` | Step 1, group list. Wide: replaces itself with the first group's face | Previous screen |
| `/admin/faces/groups/f1240` `sel` | **The group containing face 1240, with 1240 on stage.** ←/→ steps through faces (replace). j/k moves between groups (replace). Naming advances (replace) | Wide: previous screen. Phone: group list |
| `/admin/faces/ask` · `/admin/faces/ask/f2003` `sel` | Step 2, Quick questions (the Ask queue) | Same as groups |
| `/admin/faces/same-moment` | Step 3: must-link propagations, tick list + one Confirm | Previous screen |
| `/admin/faces/leftovers` | Step 4: photos whose faces are all set aside (the Set-aside list) | Previous screen |
| `/admin/faces/photos/m380` | **Dialog route:** one photograph, every face, named one at a time (was `#faces-photo-modal`). Drawn over whichever faces screen opened it | Closes the dialog |
| `/admin/faces/people` · `/admin/faces/people/p12` `sel` | The cast: rename, merge, link to guest | Same as groups |
| `/admin/faces/history` | Recent bulk passes, each with "Undo this" (was Batches) | Previous screen |
| `/admin/gallery` · `/admin/gallery/loved` | Official (reorder) · Most loved (promote) | Previous screen |
| `/admin/gallery/upload` | Dialog route: add official photos | Closes the dialog |

### Thank-yous

| Path | Screen | Back from here |
|---|---|---|
| `/admin/gifts` · `/admin/gifts/g41` `sel` | Gifts, un-thanked first. Detail has "Write Auntie's card →" | Previous / list |
| `/admin/gifts/new` · `/admin/gifts/g41/edit` | Dialog routes | Closes the dialog |
| `/admin/cards` · `?status=draft\|sent\|opened\|replied` | Cards, with the "6 drafts ready → Send" strip on top | Previous screen |
| `/admin/cards/c17` `sel` | Card preview + Edit / Send / Copy link | Previous / list |
| `/admin/cards/c17/edit` | Composer, full width with live preview. **Guarded** | Card (asks first if dirty) |
| `/admin/cards/new?gift=41` | Composer for a gift with no card. **Guarded.** Saving replaces this with `/cards/c{new}` | Gift (asks first if dirty) |
| `/admin/cards/c17/edit/photos` | Dialog route: photo picker (inside the guard's path, so no prompt) | Closes the picker |
| `/admin/cards/c17/send` | Dialog route: send one card | Closes the dialog |
| `/admin/cards/send` | Batch step 1: **Choose** (all drafts ticked) | Cards |
| `/admin/cards/send/how` | Step 2: **How**, the channel for each card, pre-picked | Step 1 |
| `/admin/cards/send/check` | Step 3: **Check**, previews + "Send 6 cards" | Step 2 |
| `/admin/cards/send/done` | Step 4: **Sent**. Replaces Check, so Back can never land on a live Send button | Step 2, which now says "That batch has gone out" |
| `/admin/replies` · `/admin/replies/c17` `sel` | Replies, newest first. Opening one marks it read | Previous / list |

### Guest list & Site

| Path | Screen | Back from here |
|---|---|---|
| `/admin/guests` · `?rsvp=yes\|no\|awaiting` · `/admin/guests/g112` `sel` | Guests with RSVP as a column, a filter, and a block in the detail | Previous / list |
| `/admin/guests/new` · `/admin/guests/g112/edit` · `/admin/guests/import` · `/admin/guests/invite` | Dialog routes (invite send stays a dialog. Its results step replaces itself, like batch send) | Closes the dialog |
| `/admin/accounts` · `/admin/accounts/a5` `sel` | Accounts: trust, delete, "See their posts" → `/review?author=a5` | Previous / list |
| `/admin/requests` · `/admin/requests/p3` `sel` · `/admin/requests/blocked` | Invitation requests, plus a Blocked tab | Previous / list |
| `/admin/site/content` | Site content form. **Guarded** | Previous screen (asks first if dirty) |
| `/admin/site/effects` | Effects config | Previous screen |

### How the Back rules are built

- `history.state = { idx, prev }`. `idx` is a counter. `prev` is the app path
  this entry was pushed *from*.
- **Close / "‹ chevron" / Esc** go through one function, `up(target)`. If
  `state.prev === target` it calls `history.back()`, so Close and the browser's
  Back do the same thing and the forward stack stays intact. Otherwise (you arrived
  by deep link) it does `replaceState(target)`, so the dialog is closed and Back
  still leaves the admin, as you'd expect from a link.
- **Dialog routes** render their parent route underneath, then a native
  `<dialog>` on top. The parent is the route's `parent(ctx)`. For the faces photo
  dialog that's `state.prev` when it was another faces screen (so it opens over the
  group you were on), otherwise Leftovers.
- **Redirects** (auto-select, `/faces` → first step, `/more` on desktop) are
  always `replaceState`, so they never leave a dead entry that bounces you forward
  again.
- **Filters** are in the query string and use `replaceState`. Back doesn't step
  through filter clicks.

## 5. The three core flows

### A. Moderate the queue

1. Home → **Review 14 posts** (step 1 is the only highlighted button). Push
   `/admin/review`, which replaces itself with `/admin/review/photo-400`, the
   oldest post, already open.
2. The post is large on the right. The author card says whether they're trusted.
   Press `a`. The post is approved, an "Approved · Hannah's photo — Undo" toast
   appears, and the URL **replaces** to `/review/message-401`. Your eye doesn't
   move: the next post is in the same place.
3. `h` hides (off the site, kept for you). `r` rejects. `j`/`k` skip. `t` trusts the
   author, which also approves everything they have waiting (said in the toast,
   undoable).
4. Bulk: `x` ticks rows. A bar appears on top of the list: "4 ticked — Approve ·
   Hide · Reject".
5. Comments show their parent (the photo or message they reply to) above them, so
   you never approve a reply without knowing what it's a reply to.
6. Queue empty → "All caught up" with **Next: name the faces (9 groups) →**.
7. Back at any point → Home. (The scripted walk confirms: Home → Review → a → j → h
   → **Back = Home**, **Forward = the post you were on**.)

On a phone, the list is the screen. Tap a post (push), then Approve walks on to the
next post (replace), and "‹ Review" or Back returns to the list.

### B. Name faces, first group to done

The header is a stepper, **① Groups 9 — ② Quick questions 8 — ③ Same moment 5 —
④ Leftovers 4**, with People and History off to the right as reference. Each step
is a route. The counts drop as you work, and a finished step gets a ✓.

1. Home → **Name 9 groups** → `/admin/faces` → (replace) `/faces/groups` →
   (replace) `/faces/groups/f1201`.
2. Three panes:
   - **Left: the groups**, biggest first, one fixed-height row each (four mini
     chips, "Rosa Méndez?" or "Who is this?", "14 faces · 2 unclear"). Named groups
     drop into a "Named" list under it, with ✓ and a link back.
   - **Middle: the group.** The selected face large (the `display` variant in the
     real app), then a filmstrip of *every* face in the group, set-aside ones dimmed
     and labelled "unclear". ←/→ steps through them (replace, so the URL always names
     the face on stage). **Not the same person (`e`)** drops one face out of the
     confirm. The sentence under the strip says what confirming will do: "confirming
     names **12**". **Open photo** pushes the photo dialog route.
   - **Right: who is it?** The suggestion, large: "Looks like **Rosa Méndez** ·
     Strong match" (or "Close call — check the faces below" when the margin is
     thin), with one big **Yes, name 12 faces Rosa ⏎**. Below that: two numbered
     alternatives (`1`, `2`), "Someone else" type-ahead (`/`) that offers "+ New
     person 'Rosa M'" when nothing matches, then **Not a face** and **Skip for now
     (`s`)**. "Nothing here is final. Every naming can be undone from History."
3. Press Enter. The faces are named, one ledger batch is written, the toast says
   "Named 12 faces Rosa Méndez — Undo", and the URL **replaces** to the next group's
   face. Same panes, same places, a new person.
4. Last group done → the middle pane says **Step done — Next: Answer quick
   questions (8) →**. Quick questions has the same layout. The middle pane says
   *why* the face was held back ("it's side-on") and how many photos answering it
   unlocks. `1`–`3` pick a candidate.
5. Same moment: one screen, a ticked list of "named face → same-moment face" pairs,
   one **Confirm 5** button (one batch, undoable from History).
6. Leftovers: a grid of photos. Each opens the photo dialog. Back closes it.
7. All four done → "Everyone has a name — **Next: thank-you cards →**".

Because the URL names a face, `/admin/faces/groups/f1240` survives regrouping,
reloads, re-login and links. If face 1240 has since been named, the middle pane
says "Named Rosa Méndez · 12 faces" with Undo and **Next group →**.

### C. Send a batch of thank-you cards

1. Home → **Send 6 drafted cards** (or Cards → the "6 drafts ready" strip) →
   `/admin/cards/send`.
2. **① Choose.** Every draft, ticked, each with a one-line preview and an Edit
   link. Untick to hold one back. **Next: how to send 6 →** (push).
3. **② How.** One row per card, with the channel already picked from what we have:
   email if there's an address, otherwise SMS if there's a phone, otherwise "copy a
   link (send it yourself)". Channels we can't use are disabled, not hidden, so
   it's clear *why* someone is getting a link. **Next: check →** (push).
4. **③ Check.** "Ready to send 6 cards · 5 by email · 1 as a link you'll copy",
   then a grid of the actual card previews. **Send 6 cards.**
5. **④ Sent.** This *replaces* Check. A list of results, with **Copy link** buttons
   for the manual ones and "opens and replies will show up in Replies".
6. Back from Sent → step 2, which now says "That batch has gone out — going back
   can't un-send it" with links to the results and to Cards. Back again → step 1 →
   the card you started from. (Scripted walk: Cards → Choose → How → Check → Back →
   Forward → Send → Back → Back → Back = exactly that.)

Writing a missing card (Gifts → "Write Auntie's card →" → `/cards/new?gift=41`)
saves into `/cards/c{id}` (replace) and toasts the next un-thanked guest. That's
today's "next guest" queue prompt, kept.

## 6. The navigation guard

Two screens hold unsaved work: the card composer and Site content. Each sets
`guard.current = { path, dirty(), what }` when it mounts. The guard covers any
destination **outside** `path`, so the composer's own photo-picker dialog route
(`…/edit/photos`) doesn't trigger it.

- **In-app links, sidebar, keyboard chords:** `navigate()` awaits an in-app
  confirm ("Leave without saving? Your changes to this card haven't been saved."
  **Keep editing** / **Discard changes**) before it pushes. Keep editing means
  nothing happened.
- **Browser Back/Forward:** popstate can't be cancelled, because the URL has
  already moved. The router compares `event.state.idx` with its own `curIdx` to get
  `delta`, then:
  1. calls `history.go(-delta)` with the next popstate suppressed. This puts the URL
     back *without* touching the forward stack. (Re-pushing the old URL would
     truncate it, so Forward would stop working.)
  2. shows the confirm.
  3. on **Discard**, clears the guard and calls `history.go(delta)`. The original
     move replays and renders normally.
  If an entry has no `idx` (a pre-router entry), it falls back to re-pushing the
  guarded URL.
- **Reload / close tab / typing a URL:** `beforeunload` (the browser's own prompt).
- The confirm is a plain `<dialog>`, deliberately **not** a route: it's a question
  about a navigation that's already happening, so giving it a history entry would
  mean navigating to it.

Scripted walk: edit → type → Back (asks; URL is still `/edit`) → Keep → sidebar
Review (asks) → Keep → Back (asks) → Discard (→ the card) → Forward (→ the editor,
clean, no prompt).

## 7. Session expiry without losing your place

Today a 401 drops the whole dashboard to the login screen and wipes the in-memory
state. In this design:

- **Expiry never navigates.** `api()` gets a 401 → it raises a modal "You were
  signed out" overlay over the *current* screen. The screen is blurred but intact,
  and the overlay names where you'll carry on from (`/admin/faces/groups/f1240`).
- **The request that hit the 401 is queued** and replayed after sign-in, so the
  Approve you just pressed finishes. (Scripted walk: expire → press `a` on
  `message-401` → overlay → sign in → the post is approved and the queue advances to
  `comment-402`.) Mutations are replayed once and only when the server rejected them
  for auth, never after a timeout, so nothing double-posts.
- **The overlay can't be dismissed** (Esc does nothing), and focus is trapped by
  `showModal()`.
- **Fewer expiries in the first place:** a small activity heartbeat. When there's
  been real input (pointer, key) since the last ping, ping
  `GET /api/admin/session` at most every 5 minutes. An admin who is actually working
  (studying a face strip for ten minutes) stays signed in. One who walked away still
  times out at 30 minutes. The 24-hour absolute limit is unchanged.
- Also kept safe: composer drafts are already in localStorage (`clearDraftKeyById`
  exists). The overlay leaves them alone.

## 8. Deep links into Faces

- The **anchor is a face id**: `/faces/groups/f1240`, `/faces/ask/f2003`,
  `/faces/photos/m380` (a media id for the dialog). The server computes groups fresh
  on every request, so the client finds the group *by membership*
  (`groups.find(g => g.faceIds.includes(1240) || g.setAsideMedia…)`), never by
  index. That replaces today's array-index group keys.
- Resolution order for `f1240`: in an unnamed group → that group, with that face on
  stage. Already named → the "Named X" card (Undo, Next group). Not a face → the
  same card, saying so. Deleted (media removed) → "That face isn't in any group any
  more", with the group list still on the left. Never a different group.
- Groups rows link to their *first* face, but any member is a valid anchor. That's
  what lets ←/→ change the URL without changing the group.
- `/admin/faces` alone always resolves to the first unfinished step, so "Name faces"
  in an email or on Home is never stale.

## 9. Mobile

- Bottom bar (4 + More), 64px plus the safe-area inset. Counts as corner badges.
- Lists are full-width screens. Detail screens get a "‹ List" chevron (`up()`, so
  it matches Back) and a sticky action bar right above the bottom bar, with
  equal-width buttons (thumb-sized, 44px+).
- **Faces on a phone:** the group list is the screen. Tapping a group shows a
  single scrolling column: a 170px stage face, the filmstrip (42px chips, two rows),
  then the "Looks like Theo · Yes, name 10 faces Theo" button, within one screen
  height on a 390×844 phone. Alternatives and "someone else" follow. The stepper
  shows only numbers, with the current step's label and count. People and History
  move into the list header.
- Dialog routes are bottom sheets. The composer stacks form over preview.
- Keyboard hints, the `?` button and the list-foot legend are hidden on
  `pointer: coarse`.

## 10. Cut, merged, moved

| Today | In Workspace | Why |
|---|---|---|
| 11-tab bar + stat cards above it | Grouped sidebar. Stats move into the lists that own them ("20 parties · 31 people coming" on Guests) | The tab bar wrapped, and the stats pushed every tab's content down |
| Inbox tab | **Home**: ordered steps, a resume link, unread replies | Inbox deep-linked to tabs in a way the owner called unintuitive. Home doesn't preview the work, it points at it |
| RSVPs tab | Merged into **Guests & RSVPs** (column + filter + detail block) | An RSVP is a fact about a guest |
| Blocklist tab | **Requests › Blocked** | The blocklist only filters requests |
| Moderation › Accounts pill | **Accounts** in Guest list | It's about people, not posts. Reachable from a post's author card |
| Moderation detail modal | The detail pane | The split view *is* the detail |
| Thank yous (one tab: gifts table, cards table, composer swap, Mailbox pill, send modal) | **Gifts**, **Cards**, **Replies** + composer route + batch-send flow | Three different jobs. The batch flow is new: today every card is sent one modal at a time |
| Faces: Set-aside panel, Groups list *and* review mode, Ask, Same moment, Identified, People, Batches, all stacked | **Four steps** + People + History. Review mode *is* the Groups screen. "Identified" becomes People's face counts. Batches becomes History | "Didn't even know about the stuff at the bottom" |
| "N set aside" count-as-button | **Leftovers**, step 4 | "Didn't realise a number was a link" |
| `#hash` tabs + `replaceState` | Real paths, push/replace by rule | Back left the admin |
| `window.confirm` guards | In-app confirm + popstate veto | Same intent, and it now covers Back |

Nothing is removed outright. Every current capability has a home in the table above.

## 11. Build cost, against the current code

The data layer and every API stay. This is a front-end restructure plus one server
fallback.

| Piece | Work | Size |
|---|---|---|
| **Server `/admin/*` fallback** (`core/static.js`) | Serve `pages/admin/index.html` for any extensionless `/admin/…`, same CSP/headers. Add `GET /api/admin/session` for the heartbeat if `/api/admin/sessions` doesn't already cover it | ½ day |
| **Router + shell** (new `router.js`, rewrite `main.js` 223 lines) | Route table, `navigate`/`up`/popstate veto, `history.state.idx`, link interception, section memory, breadcrumbs, title/live region. The prototype's `app.js` is about 450 lines of this and ports almost directly (swap `innerHTML` for the existing `html` helper, no inline `style=`, which matters for CSP) | 2 days |
| **Sidebar / rail / bottom bar / More** (`index.html` 1561 lines → shell + panels, CSS) | Replace the tab bar and stat cards. The badge poll feeds nav counts | 1 day |
| **Module contract** | Each tab module gains `mount(params, query)` / `unmount()` in place of `load*()`, and reads selection from params instead of module state. Mechanical for guests, rsvps, petitions, blocklist, gallery, site-content, effects | 2 days |
| **Dialogs → routes** | 21 `<dialog>`s. About 10 become routes (guest edit/new/import/invite, gift, card send, photo picker, faces photo, gallery upload). The rest are confirms and stay `<dialog>`. `openModal`/`closeModal` go through `navigate`/`up` | 1½ days |
| **Review split view** (`moderation.js` 1170 lines) | List + detail pane replace table + modal. Keyboard, advance-on-act, bulk bar. `showUndo` already exists | 2 days |
| **Faces three-pane + steps** (`face-assignment.js` 2967 lines, the biggest) | The overview list, review view, filmstrip, ask rows, propagations, set-aside list and batches already exist as markup functions. The work is regrouping them into panes and steps, replacing index keys with face anchors (`reloadAnchoredOnFace` / `anchorAfter` already think this way), moving the photo dialog to a route, and the picker panel | 3–4 days |
| **Thank-yous split** (`thank-you.js` 2562 lines) | Gifts / Cards / Replies lists + details, composer as a route with the guard, and the **new** batch-send flow (four step routes over the existing per-card send endpoints, called sequentially, with a results list) | 3 days |
| **Home** (`inbox.js` 196 lines) | Repurpose into the step cards + resume | ½ day |
| **Re-login overlay + heartbeat** (`auth.js` 157, `utils.js` `api()`) | 401 → overlay + replay queue, instead of hiding the dashboard | 1 day |
| **Integration tests** | `/admin/*` fallback, deep-link reloads, heartbeat endpoint. Front-end walks like `tmp/walk.mjs` as a smoke script | 1 day |

**Total: roughly 18–20 focused days.** It can ship in slices behind the same
`/admin` URL: (1) router + shell + server fallback, with old panels mounted
unchanged inside the new shell. That alone fixes Back, one-click access and
re-login. Then (2) Review split, (3) Thank-yous + batch send, (4) Faces
three-pane. After slice 1 every later slice is independent.

## 12. Open questions for the owner

1. **Sidebar memory.** Clicking "Name faces" from elsewhere returns you to the exact
   face you left. Clicking it again while you're in Faces goes to the section root.
   Is that the "never lose my place" you want, or should the sidebar always go to
   the root?
2. **Advance after acting.** Review and Faces jump straight to the next item after
   each decision. Some people prefer to see their decision land first. Keep it
   instant?
3. **Trust = approve the backlog.** Trusting an author also approves everything they
   have waiting (undoable). Is that right, or should trust apply only to new posts?
4. **Batch send of SMS** fires several texts in a row. Is a single Twilio pass
   acceptable, or should SMS stay one at a time?
5. **Before-the-wedding mode** for this couple is history. Should the mode switch
   stay visible in the footer, or move into Settings?

## 13. Taken from Today and Journeys (owner picked Workspace, 2026-10-29)

Workspace is the build. These are the ideas from the other two proposals that
are worth folding into it. Each is small, and none of them changes the shape
above. The build session starts from this list. The other two prototypes stay
as reference (`prototypes/admin-today/`, `prototypes/admin-journeys/`).

1. **"Photos they're in" in the card composer** (Journeys §5 C). Once a face
   group is named and its person is linked to a roster guest
   (`people.guest_id`), the composer's photo picker
   (`/admin/cards/c17/edit/photos`) lists that guest's photos first, then the
   rest of the gallery. This is the point where face tagging pays off in the
   thank-you work, and it is the strongest idea in either proposal. It needs one
   query: media with a live face assigned to a person whose `guest_id` is the
   card's guest. About a day.
2. **"Save and write the next one"** in the composer (Journeys). It saves, then
   replaces the URL with the next un-thanked guest's card. It replaces §5 C's
   toast. The last card says "Save and finish" and goes up to Cards.
3. **A three-way leave guard**: Keep editing / Discard / **Save and leave**
   (both Today and Journeys have it). §6's dialog gains the third button; the
   guard's `save()` is the composer's and Site content's existing save.
4. **Drop the heartbeat in §7** (Today's reasoning, checked against the code).
   `BADGE_POLL_MS` (3 min, `public/pages/admin/main.js`) already runs while the
   tab is visible, and every admin request calls `updateSessionActivity`, so a
   visible tab never reaches the 30-minute idle limit. The idle limit only bites
   on a hidden tab or at the 24-hour cap, and the re-login overlay (`e571b37`)
   already covers both. So: no `GET /api/admin/session` ping.
5. **Collapse on finish for batch send** (Today §4 "C"). Sent replaces Check, and
   Back from Sent rewinds to where step 1 was opened, not to step 2.
   §5 C's "That batch has gone out" card stays for anyone who reaches a step
   with Forward.
6. **Progress in each job's own unit** on Home's step cards (Journeys §2): "38 of
   212 faces named", "4 of 12 guests thanked", alongside the waiting counts.
7. **A trust nudge** on the Review author card (Journeys §5 A): "Posted 9 times.
   Trust them?" for an untrusted author with several approved posts. One tap is
   the same action as `t`.
8. *Optional, later:* a **⌘K / `/` jump-to-name palette** over guests, people and
   cards (Today §5, about half a day), and **faces in sittings** of about 5 groups
   with a break screen (Today §6.2). Revisit sittings after the tuning pass, once
   the group count is known.

Left out on purpose: Today's to-do Home with Later and Done today, and
Journeys' intro panels and pulsing Next. Workspace's Home and empty states
already say what to do next.

## 14. Built so far: slice 1 (router + shell), 2026-10-30

In the real admin, uncommitted on `face-tagging` until the owner reviews it:

- `public/pages/admin/routes.js` (pure route table, unit-tested in
  `tests/unit/admin-routes.test.js`) and `public/pages/admin/router.js`.
  Push/replace, `history.state.idx`, and the popstate veto that waits for its
  own `history.go(-delta)` to land before asking.
- The 11-tab bar is now the grouped sidebar from §2. The links keep their
  `tab-btn-*` ids, so the modules that click them to jump (Inbox, the guest
  dialog) work unchanged. Today's panels are mounted as-is. Pills record their
  path (`/admin/accounts`, `/admin/gallery/loved`, `/admin/thank-yous/replies`).
- The in-app leave dialog (`#admin-leave-modal`) replaces `window.confirm` for
  Site content and the card composer, on sidebar clicks, Back/Forward and
  re-opening the same section.
- Old `/admin#tab` links redirect. The digest email now links
  `/admin/thank-yous/replies`. Stat cards show only on Guests and RSVPs.
- Phones (<900px) get §9's bottom bar: Inbox · Review · Faces · Cards · More,
  counts as corner badges, and a dot on More when a section it holds has one.
  `/admin/more` lists every section, built from the sidebar itself; on a wide
  screen it redirects to the Inbox. Sticky bars and padding clear the bar
  (`--admin-bar`), and the viewport is `viewport-fit=cover` for the home
  indicator.
- Back with a dialog open closes the dialog instead of changing the section
  under it (`topModal()` in `utils.js` tracks the opening order). The leave
  guard and the re-login overlay are never closed this way.
- A new section opens at its top; Back and Forward restore each entry's scroll.
- The success/Undo banner is sticky, so Undo stays in view down a long list.
- Moderation's per-account "View" records `/admin/review`, so Back returns to
  Accounts.

Not yet, on purpose (each belongs to a later slice or waits on §12):

- No mode-aware ordering. The post-wedding order is fixed, which is the only
  one this couple needs now.
- Labels follow today's panels: "Inbox" (not Home yet), "Cards & gifts" (the
  Gifts / Cards split is slice 3), RSVPs separate from Guests, and Blocked as
  its own link.
- No section memory (§12 question 1), and no "Save and leave" (§13 item 3)
  until the panels expose a save.
- The account filter itself isn't in the URL yet (§4's `?author=`), so a
  reload of a filtered queue shows the whole queue.
- The card composer is still a view inside Cards & gifts, not its own route
  (slice 3), so its URL is `/admin/thank-yous` while editing.
