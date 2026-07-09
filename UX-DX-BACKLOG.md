# Wedding Site — UX & DX Improvement Backlog

## Context

The post-wedding phases (accounts, guestbook, gallery, media pipeline, comments/reactions,
admin moderation, launch polish) were implemented by a horde of agents and are ~feature-complete.
The build quality is genuinely high — optimistic UI with rollback, accessible focus management in
the auth sheet and admin modals, reduced-motion guards throughout, keyset pagination, Range/206
media serving, GPS blanking, magic-link recovery. This is a **triage-and-polish pass, not a rebuild**.

This document is the deliverable the owner asked for: **every UX and DX issue found, in detail, as
reference material** for this and future agent sessions. It won't all be done in one session.

> **Progress (session 1):** DONE — §1.1 (report email recipient via `/api/config.contactEmail`),
> §1.2 (reaction failures now toast — new `public/components/toast.js`), §1.3 (honest copy-link with
> execCommand + prompt fallback), §1.4 (auth code panel requires the code), §1.5 (auth sheet restores
> focus to the activating control), §1.7 (`100dvh` for lightbox + mobile nav), §4.1 (lockfile
> un-ignored so `npm ci` works — still needs a commit of `package-lock.json`). Verified: `npm run
> typecheck` clean (both configs), `npm test` 965/965 pass, pages render.
> STILL OPEN in §1: **§1.6** (auth sheet closed mid-write gives no feedback). Everything in §2–§6 remains. It was
assembled from: (a) full-page screenshots of `/`, `/rsvp`, `/guestbook`, `/gallery`, `/admin` at
desktop + mobile widths against the existing seeded DB, and (b) three parallel code audits of the
guest frontend, the admin dashboard + DX surface, and the specs-vs-implementation delta.

### Owner decisions locked for this pass (from clarifying questions)

- **Launch status: launching very soon.** → Guest-facing correctness is P0. Do those first.
- **Scope: everything** (guest UX, admin UX, DX, portfolio) — catalog it all in detail.
- **Dev tooling: keep minimal.** → **Do NOT add ESLint/Prettier.** Stay zero-runtime-dep; rely on
  `tsc`. Any formatting/consistency work must be hand-done or via a no-dependency script.
- **Dev-only pages: leave for later.** → **Out of scope:** gating `/studio` + `/demo` behind
  `NODE_ENV`, and retiring the dead change-review demo machinery. These stay in `DEFERRED.md` §11–§12.

### Reusable pieces to lean on (found during audit — prefer these over new code)

- `showSuccess(msg)` — `public/pages/admin/utils.js:26` (a shared banner; **defined but wired in only
  one place**). Use it for admin success feedback.
- `showError(...)` / `setButtonLoading(btn, bool)` — `public/components/celebrate.js:10`; the standard
  loading/disabled pattern already used on RSVP/guestbook/auth submit buttons.
- `.spinner` / `.loading` CSS — `public/styles/components.css:271-287` (**defined but unused** on the
  social surfaces). Use for guestbook/gallery/admin loading states.
- `initModals` accessible `<dialog>` system — `public/pages/admin/utils.js:80`; the confirm-dialog in
  `public/pages/admin/moderation.js:300-391` is the **model pattern** the rest of admin should copy.
- `openAuthSheet(trigger)` already accepts a trigger element — `public/components/auth-sheet.js:409`.
- `api()` wrapper (timeout/abort/CSRF/401) — `public/pages/utils.js:191-264`; auto-escaping ``html``
  template — `public/pages/utils.js:124`.
- `/api/config` (`api/config.js:8-15`) — the place to expose new public config (e.g. contact email).

---

## Priority / sequencing

- **P0 — before you announce to guests** (live correctness; §1)
- **P1 — soon after / alongside launch** (visible polish + the one broken CI path; §2, §4.1)
- **P2 — portfolio-readiness pass** (admin consistency, DX hygiene, docs; §3, §4, §5)
- **P3 — nice-to-have** (low-severity refinements sprinkled through)
- **Owner-only / can't-code-fix** — §6 (secret rotation, deploy checklist, copy decisions)

---

## §1 — Guest-facing correctness (P0, do before announcing)

**1.1 · "Report this photo" email has no recipient — reporting is broken.** 🔴
`public/pages/gallery/lightbox.js:136-138`. `report.href = "mailto:?subject=..."` sets a subject but
no `to:` address, so the link opens a blank-recipient draft — a guest cannot report anything. Also the
static markup declares it as `<a href="#" id="lightbox-report">` (`gallery/index.html:146`), a dead `#`
anchor until the first `render()`.
*Fix:* give it a real recipient. Cleanest: expose a `contactEmail` field from `/api/config`
(`api/config.js` reads `CONTACT_EMAIL` — already an env var) and build `mailto:${contactEmail}?subject=…`.
Consider upgrading later to an in-app report that flags the media row into the moderation queue (no email
round-trip), but the recipient fix is the P0.

**1.2 · Reaction toggle failures are completely silent.** 🟡→🔴 (raise for launch)
`public/pages/reaction-bar.js:96-100` — on error the pill rolls back and only `console.warn`s. Unlike the
comment composer and guestbook (both show inline errors), a failed reaction gives the guest zero feedback;
the pill just snaps back and they'll assume they mis-tapped.
*Fix:* surface a brief inline/toast error near the bar (reuse the toast/`showError` idiom). Keep the
optimistic rollback.

**1.3 · "Copy link" always claims success even when nothing was copied.** 🟡
`public/pages/gallery/lightbox.js:159-171` — `navigator.clipboard?.writeText(url)` is optional-chained and
**unawaited**, but the button unconditionally flips to "Copied!". In a non-secure context or where the API
is missing, the UI lies.
*Fix:* `await` the write; on success show "Copied!", on failure fall back (select-and-`document.execCommand`
like `manual-sms.js:53`, or show the URL for manual copy). Guard the whole thing so it never claims success
it didn't achieve.

**1.4 · Invite-code panel silently downgrades a household guest to an untrusted (moderated) account.** 🟡
`public/components/auth-sheet.js:277-297` — the code field has no `required`, form is `novalidate`. If a
household guest types their name but forgets to paste the code and hits "Continue", the body sends `{ name }`
with no code and the server registers them as **open/untrusted** (their posts get moderated) — with no hint
that anything went wrong. The panel presents the code as expected input.
*Fix:* if the code field is empty on the code panel, either (a) block + prompt ("Enter your invite code, or
tap 'I don't have a code'"), or (b) confirm the downgrade explicitly. Don't silently reroute.

**1.5 · Focus is dropped to `<body>` after signing in via the write-gate.** 🟡 (a11y)
`public/components/auth-sheet.js:194-212` restores focus to `triggerEl` only if set, but the write-gate path
`requireAccount()` (`public/components/guest-session.js:38`) calls `openAuthSheet()` with **no** trigger, so
`triggerEl` is `null`. After a keyboard user taps "Sign the guestbook" / a reaction / "Post comment", signs
in, and the sheet closes, focus lands on `<body>` — the pending action replays but focus context is lost.
*Fix (one line):* in `openAuthSheet` default `triggerEl = trigger instanceof HTMLElement ? trigger :
document.activeElement`. Optionally thread the trigger element through `requireAccount(action, trigger)` from
its callers for precision.

**1.6 · Closing the auth sheet mid-write gives no feedback; the tapped action evaporates.** 🟢→🟡
`guest-session.js:31-39` + `auth-sheet.js`. Tap "Sign the guestbook", dismiss the sheet (X/backdrop/Esc):
nothing posts and nothing explains why. The stashed action is silently discarded.
*Fix:* on sheet-close-without-auth, either keep the typed content and show a subtle "Sign in to post" hint on
the control, or clear `pendingAction` and briefly flag the composer.

**1.7 · Lightbox + mobile nav use `100vh`, not `100dvh` — controls hide behind mobile browser chrome.** 🟡
`public/pages/gallery/gallery.css:162-174` (`.lightbox { height: 100vh }`) and
`public/styles/layout.css:156` (`.mobile-nav` height uses `100vh`). On mobile Safari/Chrome the dynamic URL
bar makes `100vh` taller than the visible viewport, so the bottom lightbox panel (report link, reactions) or
the nav footer sit under browser chrome.
*Fix:* switch these to `100dvh` (with a `100vh` fallback line above for old browsers).

---

## §2 — Guest-facing UX polish (P1)

**2.1 · No loading state on the guestbook feed or gallery grid; first paint is a blank void.** 🟡
`public/pages/guestbook/feed.js:222` and `public/pages/gallery/grid.js` fetch on init with no spinner/skeleton;
the area is empty until data resolves, then the empty-state only appears after a zero-result fetch. Contrast
RSVP, which has a proper `#rsvp-loading`. The `.spinner`/`.loading` CSS (components.css:271-287) is already
there and unused.
*Fix:* show a spinner (or the skeleton in 2.2) while the first page is in flight; hide on resolve.

**2.2 · Gallery skeleton/shimmer cells were spec'd but never built.** 🟡 (spec gap — Phase 4 §4)
Spec: *"Skeleton: 12 shimmer cells on first paint (static under reduced motion)."* There are zero
`skeleton`/`shimmer` rules for the grid anywhere. On a slow connection the grid is blank then pops in.
*Fix:* render 12 placeholder cells with a shimmer animation (static under `prefers-reduced-motion`); replace on
first fetch. This also covers 2.1 for the gallery.

**2.3 · No signed-in indicator and no sign-out / account switch on guest pages.** 🟡
`public/components/guest-session.js` has `session.account` and there's a working `POST /api/account/logout`
(`api/account.js:173`, routed at `core/router.js:152`), but **nothing in the guest UI shows who you are or lets
you sign out**. The auth copy stresses "invite codes are per household — enter your own name," yet two people
sharing one device/code can't re-identify: the second person posts under the first's name with no visible cue.
*Fix:* add a small "Posting as **{name}** · Not you?" affordance near the composer / in the header, with a
sign-out that calls `/api/account/logout`, clears `session.account`, and re-opens the auth sheet. Add a
`logout()` helper to `guest-session.js`.

**2.4 · Many custom interactive controls have no visible focus ring.** 🟡 (a11y)
The `:focus-visible` outline (`public/styles/components.css:304-314`) only covers `.btn`, `.nav-link`,
`.hamburger-button`, `.home-link`, `.modal-close`. It does **not** cover `.gallery-tab`, `.reaction-pill`,
`.comment-toggle`/`.comment-delete`/`.comment-submit`, `.lightbox-close`/`.lightbox-nav`/`.lightbox-copy`,
`.upload-action`/`.upload-tray-cancel`, `.auth-link`, `.gb-note-dismiss`, and the textareas
(`gb-textarea`/`comment-input` sit outside `.form-group`). Many set `appearance:none`, so keyboard users get
little/no ring.
*Fix:* extend the `:focus-visible` rule set to cover these custom controls; give the textareas the app focus
ring for consistency.

**2.5 · Gallery tablist keeps both tabs in the tab order (no roving `tabindex`).** 🟢 (a11y)
`public/pages/gallery/index.html:94-99` — arrow-key handling exists (`gallery/main.js:72-78`) but both tabs
stay tabbable, a deviation from the tablist pattern.
*Fix:* roving `tabindex` (active tab `0`, others `-1`) so Tab exits the tablist and arrows move within it.

**2.6 · No character counters despite hard `maxlength` caps.** 🟢
Guestbook textarea `maxlength="2000"` (`guestbook/index.html:98`), comment input `maxlength="500"`
(`comment-thread.js:67`), auth name `maxlength="100"`. The user just silently stops being able to type.
*Fix:* live "N/2000" counters near each capped field.

**2.7 · Feed/comment errors render raw server strings.** 🟢
`public/pages/utils.js:252` (`api()`) throws `data.error` verbatim; `feed.js:116`, `grid.js:133`,
`comment-thread.js` render it directly. Server wording may read technically.
*Fix:* map known error codes to friendly copy; keep the generic fallback for the rest.

**2.8 · Landing page has no `<noscript>`; countdown + registry silently break with JS off.** 🟡
`public/pages/index.html` — unlike `/rsvp`, `/guestbook`, `/gallery` (all have `<noscript>`), the landing page
has none. `index.html:65` shows literal `Loading...` forever without JS, and the Honeyfund registry iframe
**and** its fallback link (`index.html:171-176`) are both `hidden`, revealed only by `registry.js` via an
IntersectionObserver — with JS off (or if the observer never fires) the "Open registry in a new window" escape
hatch never appears.
*Fix:* add a `<noscript>` block for the landing page; make the registry fallback link visible by default and
let JS *replace* it with the iframe (progressive enhancement), rather than hiding both up front.

**2.9 · "One-time" untrusted pending note reappears on every post/reload.** 🟢 (spec — Phase 2 §5)
`public/pages/guestbook/feed.js:135` `showPendingNote()` has no `localStorage` guard, unlike the
`gbCelebrated` guard right above it (line 127).
*Fix:* guard it with a `localStorage` flag like its sibling, or accept per-post and update the spec note.

**2.10 · Upload "File too large" doesn't state the limit.** 🟢 (spec — Phase 4 §6)
`public/components/media-uploader.js:~491` returns bare `"File too large"`; spec taxonomy wants
`"File too large (max N MB)"`. (Other taxonomy strings are present and correct.)
*Fix:* interpolate the actual limit into the message.

**2.11 · Lightbox counter shows loaded count, not the true total.** 🟢
`public/pages/gallery/lightbox.js:119` — `${index + 1} / ${items.length}` where `items.length` is only the
loaded page(s), so it reads "3 / 17" and grows as you page.
*Fix:* use the section's known total (the tab count) as the denominator, or drop the denominator.

**2.12 · "Cancel all uploads" only confirms when >1 upload is active.** 🟢
`public/pages/gallery/upload.js:39-43` — a single in-flight upload cancels with no confirm; multiple prompt.
*Fix:* confirm consistently (or don't) regardless of count.

**2.13 · Party-size dropdown renders even when party size is 1.** 🟢
`public/pages/rsvp/rsvp-form.js:166-173` — a solo guest still gets a `<select>` with one no-op option.
*Fix:* hide the control (or render static text) when `party_size === 1`.

**2.14 · `attending-details` clips at `max-height: 500px`.** 🟢
`public/styles/rsvp.css:178` — long dietary/accommodation + message text could exceed the reveal transition's
cap and clip on small screens.
*Fix:* animate on a large-enough cap or transition `grid-template-rows`/`max-height: none` after expand.

**2.15 · Guestbook feed is one big `aria-live="polite"` region.** 🟢 (a11y)
`public/pages/guestbook/index.html:109` — loading 20 entries (and each paginated batch) can flood a screen
reader.
*Fix:* scope live-region announcements to newly *composed* entries, not bulk fetches.

**2.16 · (Observed in screenshots) Large empty vertical band below the footer** on `/guestbook`, `/gallery`,
`/rsvp`. 🟢 Likely the effects/sparkle layer's min-height or a tall spacer. Reads as dead space.
*Fix:* investigate the effects canvas / page min-height; trim to content height.

**2.17 · (Observed) Broken-image tiles fall back to raw alt text on a gray box.** 🟢 (robustness)
Seen with seed data that has no real files; real uploads have images, but any 404/processing gap shows the alt
string on a bare box in `public/pages/gallery/grid.js`.
*Fix:* add an `onerror` fallback tile (icon + caption) consistent with the `needs_display` placeholder.

---

## §3 — Admin dashboard consistency (P2, portfolio-readiness)

**3.1 · Success feedback is almost entirely missing — `showSuccess` is wired in exactly one place.** 🔴 (admin)
`showSuccess` (`public/pages/admin/utils.js:26`) is called only from `moderation.js:418`. Every other mutating
action just closes its modal and silently re-fetches — the admin never gets a positive confirmation:
guest add/edit/archive/restore (`guests.js:236,278,300`), blocklist add/remove (`blocklist.js:92,127`),
petition approve/deny (`petitions.js:202,235`), gallery caption/reorder/remove (`gallery-admin.js`).
*Fix:* call the existing `showSuccess(...)` after each successful mutation. Infrastructure already exists —
this is pure wiring and is the single highest-leverage admin fix.

**3.2 · `restoreGuest` uses native `confirm()` — inconsistent with the accessible `<dialog>` pattern.** 🟡
`public/pages/admin/guests.js:234`. Every other confirm flow uses the styled, focus-managed `<dialog>` system
(`initModals`, `utils.js:80`; the moderation confirm at `moderation.js:300-391` is the model). This one path
pops an unstyled browser prompt.
*Fix:* route it through the shared confirm-dialog helper.

**3.3 · Gallery reorder + caption edits save silently with no persistence feedback.** 🟡
`public/pages/admin/gallery-admin.js:117-133` (reorder auto-saves on a 600ms debounce, no "saving/saved"),
`:138-149` (caption commits on blur, only an error banner on failure). Combined with 3.1 the curated tab feels
inert.
*Fix:* add a transient "Saved ✓" indicator on successful reorder/caption save.

**3.4 · Moderation "Reject" deletes media files but captures no reason.** 🟡
`public/pages/admin/moderation.js:365-398` — rejecting media removes files from disk, yet there's no reason
field (contrast the blocklist form, which has one at `index.html:685`). No note is recorded for an
irreversible action.
*Fix:* add an optional rejection-reason input; persist it to the audit log / a moderation note.

**3.5 · No loading/pending state on any admin tab load.** 🟡
`loadQueue`/`loadAccounts`/`loadPetitions`/`loadBlocklist`/`loadRsvps`/`loadGalleryAdmin`/`loadGuests` all
swap `innerHTML` only on resolve; on a slow network the prior tab's stale rows sit there with no in-flight cue.
Only the invite wizard sets a `"Loading..."` label (`invites.js:233`).
*Fix:* show the shared spinner while fetching each tab.

**3.6 · Batch curated uploads trigger one full grid reload per file.** 🟡 (perf/UX)
`public/pages/admin/gallery-admin.js:248-259` fires `loadGalleryAdmin()` for each item reaching done/pending —
up to N sequential `/api/media?section=official&limit=500` reloads and re-renders for N files (flicker + waste).
*Fix:* debounce/coalesce into a single reload after the batch settles, or prepend items individually like the
guest grid does.

**3.7 · `checkSession` silently logs the admin out on any non-OK/network blip.** 🟡
`public/pages/admin/auth.js:50-68` — any non-`res.ok` or thrown error drops to the login screen with no message.
A transient 500 / dropped connection to `/api/admin/stats` looks identical to an expired session.
*Fix:* distinguish auth failure (401) from transient errors; show a retry/"connection lost" state for the latter.

**3.8 · 401 handling produces double feedback (login screen + stale error banner).** 🟢
`public/pages/utils.js:248-253` — on 401 `api()` calls `onUnauthorized()` (shows login) **and** throws, so the
caller's `catch` also runs `showError(...)`, layering a red banner over the login screen.
*Fix:* on 401, either don't throw after handling, or have callers skip `showError` when the error is a handled 401.

**3.9 · Petitions use `onclick =` assignment; every other module uses `addEventListener`.** 🟢 (consistency)
`public/pages/admin/petitions.js:146-153` reassigns `onclick` on each `viewPetition` open.
*Fix:* bind once in `initPetitions` via `addEventListener` like the rest.

**3.10 · Notification banner mixes `role="alert"` + `aria-live="polite"` and is reused for success.** 🟢 (a11y)
`public/pages/admin/index.html:80`. Success messages get announced through an assertive alert region.
*Fix:* use a separate polite region for success, or drop `role="alert"` where it's reused for success.

**3.11 · Empty-state copy drifts across tables.** 🟢
"Nothing here 🎉" (`moderation.js:124`) vs "No accounts found" / "No guests found" / "No petitions found" /
"No blocklist entries."
*Fix:* one consistent, on-voice empty-state format.

**3.12 · Manual-SMS clipboard fallback uses deprecated `document.execCommand("copy")`.** 🟢
`public/pages/admin/manual-sms.js:53` — acceptable as a fallback; note it's deprecated.

---

## §4 — Developer experience & repo hygiene (P1 for 4.1; rest P2)

**4.1 · CI is likely broken: `.gitignore` ignores `package-lock.json`, but CI runs `npm ci`.** 🔴 (verify first)
`.gitignore:14` ignores `package-lock.json` (confirmed untracked; a 51-line lockfile exists only locally), while
`.github/workflows/deploy.yml:26` runs `npm ci`, which hard-fails without a committed lockfile. Also makes the
`typescript`/`@types/node` versions non-reproducible.
*Fix:* decide the intent — either commit `package-lock.json` (un-ignore it) so `npm ci` works and versions pin,
or change CI to `npm install`. Given only two devDeps, committing the lockfile is the low-risk choice. **Verify
by re-running the workflow / `npm ci` in a clean checkout.**

**4.2 · README is stale and misleading (the primary onboarding doc).** 🟡
`README.md:96-104` scripts table lists **`npm run test:all`** (does not exist), calls `npm test` "integration
tests" (it runs unit + integration + more), and omits `typecheck`, `dev` (watch), `export`, `deploy`, and the
`demo:*` scripts.
*Fix:* regenerate the scripts table from `package.json`; document the type-check and dev-watch workflow; note
that integration tests spin a real server + separate DB.

**4.3 · `.env` vs `.env.example` drift; live `.env` missing documented vars.** 🟡
The live `.env` is missing `CONTACT_EMAIL`, `TRUSTED_PROXIES`, `NODE_ENV`, and all three `MEDIA_*_BYTES`
thresholds that `.env.example` documents and code reads (`types.js`, `core/env.js`). So the template is more
complete than the actual file — a dev copying from `.env` misses real config surface. (Secret rotation is §6.)
*Fix:* fill the missing keys in the working `.env`; keep `.env.example` as the source of truth.

**4.4 · No `.nvmrc` despite `engines.node >= 22` + native `node:sqlite`.** 🟢
A contributor on Node < 22 gets runtime failures rather than an upfront guard.
*Fix:* add `.nvmrc` pinning 22 (matches the installed `v22.18.0`).

**4.5 · Stray `console.log` in a boot-time hot path.** 🟢
`core/static.js:137` logs `"Failed to stat file: …"` via `console.log` (not `warn`/`error`) during the recursive
`public/` scan at startup. (`public/pages/studio/studio.js:426` also has a bare `console.log`, but studio is
dev-only.)
*Fix:* change the static.js one to `console.warn`; leave intentional server start/stop logs alone.

**4.6 · Hand-enumerated test globs + no `test:integration`.** 🟢
`package.json` `test` lists each `tests/unit/<dir>/*.test.js` explicitly, so a new `tests/unit/<newdir>/` won't
run silently. There's a `test:unit` but no `test:integration`, and `npm test` conflates both (integration needs
a DB/env), so there's no documented fast unit-only-in-CI story.
*Fix:* broaden the glob (or a tiny no-dep runner script) so new dirs are picked up; add a `test:integration`
script; document which is which.

**4.7 · `typecheck` short-circuits on the server config.** 🟢
`package.json`: `"typecheck": "tsc && tsc -p public/tsconfig.json"` — if the server check fails the client
config is never checked. (Memory note: `npm run typecheck` runs both configs; tests importing frontend break the
server check.)
*Fix:* run both and aggregate (e.g. `tsc; tsc -p public/tsconfig.json` with combined exit handling, or a small
script) so a dev sees both in one run.

**4.8 · Two drift-prone deploy paths with hardcoded hosts (already DEFERRED §3).** 🟢
`scripts/deploy.js` and the inline `.github/workflows/deploy.yml` duplicate backup→pull→up→health-poll;
`deploy.yml:38` hardcodes port `2420`, `scripts/deploy.js:9-10` hardcodes `jesse@jovial-penguin-1:2420`.
*Fix (later):* collapse to one path (CI calls `scripts/deploy.js`, or a committed remote script).

**4.9 · Audit-log `adminId` truncated to 8 chars with no explanation.** 🟢
`core/utils.js:75` — minor traceability/documentation gap; add a one-line comment on why.

---

## §5 — Portfolio readiness (P2/P3)

**5.1 · De-personalize the hardcoded "disco-mermaid / Jordana & Jesse" touchpoints (DEFERRED §9).** 🟢
For a portfolio where the effects system is a selling point, the identity is baked in: `Jordana & Jesse` / "—
Wedding" copy in `public/pages/studio/index.html`; the `.couple-names` selector in
`public/effects/name-shimmer.js`; `EFFECT_PALETTE.brand` in `public/effects/config.js`; "Mermaid"/"Disco"
labels in `public/pages/studio/controls.js`. Refactoring the effects into ~3 selectable themes is the bigger
DEFERRED §9 item; the copy de-personalization is the cheap first step.

**5.2 · Public GitHub source link is exposed to all guests, and footers are inconsistent.** 🟢 (owner decision)
The footer GitHub link (`https://github.com/jazzypants1989/wedding`) appears on `/` (`index.html:204`) and
`/rsvp` (`rsvp/index.html:225`) but **not** on `/guestbook` or `/gallery` (their `<footer class="site-footer">`
lacks it). So it's both inconsistent and advertises the (public) source + admin surface to wedding guests.
*Decision needed:* for a portfolio you likely *want* the repo link — if so, add it consistently to all four
footers. If not, remove it from guest pages. Either way, make the four footers match.

**5.3 · Landing-page copy is future-tense while the site is post-wedding.** 🟢 (owner copy pass)
`countdown.js` correctly shows a post-wedding "We're married! 💍 / Relive the day below" state and the Memories
section says "the big day has come and gone," but the surrounding landing copy ("Please join us… we want to keep
it simple," the whole Schedule, "Wearing pink is encouraged") still reads as if the event hasn't happened.
*Fix:* owner copy pass to reconcile tense for a post-wedding visitor (or add an explicit "on the day" framing).

**5.4 · Contributor/architecture docs don't ship.** 🟢
`CLAUDE.md` (the richest architecture/constraints doc) is gitignored and untracked; `docs/post-wedding/` are
phase notes, not a contributor guide; `DEFERRED.md §13` itself flags undocumented maintainer-only behaviors.
*Fix:* add a short public `CONTRIBUTING`/architecture section to `README.md` (or a `docs/architecture.md`)
distilled from CLAUDE.md — good portfolio signal, and it de-risks the "only in the maintainer's head" behaviors.

---

## §6 — Owner-only / cannot be code-fixed (surface, don't silently pass)

- **Rotate secrets.** The live `.env` contains real-looking plaintext Twilio SID + auth token (`.env:9-10`), an
  admin password hash, and `TEST_ADMIN_PASSWORD=…` (`.env:14`). It's gitignored (not committed), but if the
  Twilio creds are real, rotate them. Confirm the **production** `.env` has everything (`ADMIN_PASSWORD_HASH`,
  `TRUSTED_PROXIES` once decided, `RESEND_API_KEY`/`FROM_EMAIL`/`TWILIO_*` for the email/SMS paths).
- **Deploy checklist (DEFERRED §1, §2, §6):** Traefik `readTimeout ≥ 10m` on the https entrypoint (the silent
  upload killer), no buffering middleware on the media router, VPS free disk ≥ 50GB with the `MEDIA_*` caps set,
  off-host media rsync + DB-snapshot cron installed and verified, `/api/health` `uploadsFreeBytes` wired into
  monitoring, quarantine dir emptied periodically (DEFERRED §8).
- **Launch smoke test (Phase 7 §6):** on a phone over cellular — register with a seeded code, post a guestbook
  entry, upload one photo **and one ~30MB video**, react, comment, approve from the admin queue, play the video
  on iOS Safari via `/media/:key/video` (validates Range/206 + GPS-blanked variant; spot-check served bytes carry
  no coordinates).

---

## Explicitly OUT of scope this pass (owner's call)

- **Dev tooling:** no ESLint/Prettier — keep zero-runtime-dep; `tsc` stays the only guardrail.
- **Dev-page gating / demo retirement:** `/studio` + `/demo` `NODE_ENV` gate and removing the resolved
  change-review demo machinery stay in `DEFERRED.md §11–§12`.

---

## Suggested execution order (given "launching very soon")

1. **§1 correctness bugs** (1.1–1.7) — small, high-confidence, guest-visible. Do first.
2. **§4.1 CI lockfile** — verify/fix so deploys aren't broken at the worst moment.
3. **§2 guest polish** — loading/skeleton (2.1/2.2), sign-out (2.3), focus rings (2.4), noscript (2.8).
4. **§3 admin** — wire `showSuccess` everywhere (3.1) + confirm-dialog (3.2) + loading (3.5) first; rest after.
5. **§4 DX + §5 portfolio** — README, `.nvmrc`, console.log, de-personalization, footer/GitHub decision, docs.

## Verification

- **Guest bugs:** with the server running (`npm start`) and the seeded DB, drive each fixed flow in a browser —
  open the lightbox, click Report (real recipient), Copy link (real success/failure), force a reaction failure
  (offline) and confirm the error shows, sign in then out, tab through controls to confirm focus rings, resize to
  a mobile viewport for the `dvh` fixes. Use the `screenshot` skill for before/after on both themes.
- **Admin:** log in, perform each mutation, confirm the success banner + loading states appear; trigger a 401
  (clear the cookie) and confirm no double banner.
- **DX:** `npm run typecheck` (both configs green), `npm test` green, `npm ci` in a clean checkout succeeds
  (4.1). Grep confirms no stray `console.log` in `core/`.
- **Regression guard:** where a fix has server-observable behavior (report endpoint, sign-out), add/extend an
  integration test in `tests/integration/`.
