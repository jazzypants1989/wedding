# TODO — Code-Review Findings (uncommitted work, branch `track-1-content-as-data`)

Findings from a multi-agent review of the uncommitted diff (51 files + new
`public/components/announce.js`). Every item below was independently verified against the
actual code (all CONFIRMED). Ordered most-severe first within each section.

---

## Correctness bugs

### 1. Rejecting media no longer frees quota-counted disk space

`db/media.js:203`, `core/media-storage.js` (`quarantineItemDir`), `api/media.js:148-161`

Reject used to `fs.rmSync` the item directory; it now moves files to `quarantine/` on the
**same disk**. But `sumOriginalBytes` / `sumOriginalBytesForAccount` both filter
`status != 'rejected'` on the premise the bytes are gone.

- Failure: untrusted account uploads 250MB → admin rejects (quota sum drops to 0, bytes stay
  on disk) → uploads another 250MB → repeat. `MEDIA_MAX_TOTAL_BYTES` and the per-account
  quota no longer bound real disk usage; only the `MEDIA_MIN_FREE_BYTES` statfs check remains.
- Fix options: count quarantined bytes in the sums, or sweep/delete quarantine on a schedule,
  or delete-on-reject and reserve quarantine for the sweep's orphan path.

### 2. Lookup form dead-ends guests when /api/config fails and `ENABLE_NAME_LOOKUP=true`

`public/pages/rsvp/lookup-form.js:124`, `public/pages/rsvp/index.html`, `api/lookup.js:42-47`

The static form was narrowed to the flags-off default (`#lookup-name-group` ships `hidden`,
name no longer `required`, contact is `type=tel`); `fetchConfig()` only widens on success and
swallows errors.

- Failure: config fetch fails (network blip / 429) on a deployment with the flag on → the name
  field stays hidden, the client guard `if (!name && !elements.nameGroup.hidden)` passes
  because the group is hidden → server 400 "Name is required" for a field the guest cannot see.
- Fix: keep the static form permissive and narrow only on a successful config response (the
  pre-diff behavior), or block submit until config resolves.

### 3. Admin badge poll never stops after logout/expiry — and wipes the password field

`public/pages/admin/main.js:43`, `public/pages/admin/auth.js:40,131-139`

The 3-minute `setInterval` armed in `onLoginSuccess` is only cleared on re-login — never on
logout or session expiry.

- Failure: after logout or the 30-min idle timeout with the tab open, every poll 401s →
  `api()`'s onUnauthorized runs `clearNotification()` + `showLogin()`, which does
  `getInputElement("password").value = ""` — erasing a password the admin is mid-typing,
  every 3 minutes, forever.
- Also (efficiency): `loadPetitionCount()` fetches the **full** pending-petitions list from
  `/api/admin/petitions?status=pending` just to read `counts.pending`; the moderation badge
  already has a counts-only endpoint (`/api/admin/moderation/counts`) to copy.
- Fix: own the timer in the auth lifecycle (stop on `showLogin()`/logout), and add a
  counts-only petitions endpoint or param.

### 4. `approveFast` mishandles hidden items (two facets)

`public/pages/admin/moderation.js:321,334,339,497,747`, `api/admin/moderation.js:206-209`

- **No confirm for unhide (trusted authors):** replacing `openConfirm("approve", [item])` with
  `approveFast(item)` removed the confirmation not just for pending items but also for
  republishing deliberately-hidden content — a mis-click (or stray `A` keypress in the detail
  modal, which allows status `hidden`) instantly republishes it. Hide still confirms; unhide
  doesn't.
- **False promise for untrusted authors:** the confirm says "Approve this item and trust
  {name}? Their future posts will go live instantly", but `applyTransition` guards auto-trust
  with `!wasHidden` — unhiding never trusts, so the admin is told something the server won't
  do. (The server comment even assumes the client only names the trust effect for pending
  items.)
- Fix: in `approveFast`, treat `status === 'hidden'` as its own path — confirm the unhide and
  drop the trust wording.

### 5. Upload-tray failures are no longer announced; summary says "Uploads complete" on failure

`public/pages/gallery/index.html:123`, `public/pages/gallery/upload.js:137-140,253`,
`public/components/media-uploader.js:341-343`

`aria-live="polite"` moved from the whole tray to only the summary span, so per-row failure
text ("⚠ Not a supported format", "⚠ File too large") is outside any live region. And
`activeCount()` counts only queued/processing/uploading, so failed items drop active to 0 and
the summary announces "Uploads complete" even when every item failed.

- Fix: make the summary failure-aware ("2 uploads failed") and/or announce row failures via
  the live region.

### 6. First `announcePolite()` on a page is never spoken

`public/components/announce.js:19`

The live region is created, appended, and populated in the same synchronous task on first use.
Screen readers only announce *changes* to a region already in the accessibility tree, so the
first announcement (a guest's first reaction toggle / first comment — the exact events this
was built for) is dropped by VoiceOver/NVDA.

- Fix: insert the region empty at module init (or on first call), then set `textContent` in a
  later task (`setTimeout`/`requestAnimationFrame` chain).

### 7. No-op blur on a curated position input rebuilds the whole admin grid

`public/pages/admin/gallery-admin.js:131-134,257-263`

`handleGridBlur` calls `moveTo` on every position-input focusout without checking whether the
value changed, and `moveTo` calls `renderGrid()` even when `clamped === idx`. The old `move()`
early-returned on no-ops.

- Failure: tabbing through a position input, then clicking another photo's caption → the blur
  triggers a full `grid.innerHTML` rebuild that wipes uncommitted caption edits in other rows
  and eats the click. Up to 500 items re-created per no-op blur.
- Fix: bail out (or just reset `target.value`) when the position is unchanged.

### 8. Admin uploader offers a Retry that can never succeed after session expiry

`public/components/media-uploader.js:194`, `public/pages/admin/gallery-admin.js:397`,
`public/pages/gallery/upload.js:65`

401 upload failures are now marked retryable, and the guest tray gained a `requireAccount`
gate to compensate — but the admin official-photos tray calls `queue.retry()` bare. The XHR
path bypasses `api()`'s 401→login handling.

- Failure: admin session expires mid-upload → row shows "Please sign in again to upload" with
  a Retry button that replays the upload with the dead cookie, failing identically forever.
- Fix: gate the admin retry on a session check, or route the uploader's 401 through the same
  onAuthRequired path.

### 9. `URLSearchParams.size` drops query params on older browsers (duplicated snippet)

`public/pages/gallery/main.js:172`, `public/pages/guestbook/main.js:31`

`params.size ? \`/gallery?${params}\` : "/gallery"` — `.size` needs Chrome 113+ / Safari 17+ /
Firefox 112+; on older browsers it's `undefined` → falsy → all remaining params are discarded.

- Failure: Safari 16, dead shared link `/gallery?section=official&item=99` → URL rewritten to
  bare `/gallery`, losing `section=official`.
- Fix: use `params.toString()` truthiness, and hoist the strip-param+`replaceState` dance into
  one shared `stripQueryParam(name, basePath)` helper in `public/pages/utils.js` (it's
  duplicated character-for-character across both files).

### 10. `petitionPending` flag is never cleared for denied petitioners

`public/pages/rsvp/petition-form.js:95` (set), `public/pages/rsvp/lookup-form.js:160` (read),
`public/pages/rsvp/rsvp-form.js:321` (only clear)

The only clear path is a successful invite-code load — which a denied petitioner never gets.

- Failure: petition denied → guest forever sees "You've already sent us a request — it's still
  under review", discouraging the re-petition the server would accept (the duplicate check
  only matches `status='pending'`).
- Fix: derive the notice from server truth (e.g. return petition status from `/api/lookup`),
  or at minimum expire the flag and hoist the magic string (spread across three files) into a
  shared constant.

---

## Robustness / efficiency

### 11. `approveAllPending` does per-row work at 5000-row scale

`api/admin/moderation.js:393-431`, `db/moderation.js:59,72`, `core/utils.js:24,87`

- Fetches **full** queue rows (`SELECT *` over a 3-table UNION with ORDER BY) when it only
  needs `content_type` + `id`.
- Runs `applyTransition` per row (~3 statements each, up to ~15k queries) inside one
  synchronous `withTransaction`, blocking the event loop; re-fetches the same account row for
  every item by the same author. `db/moderation.js` already has the set-based pattern
  (`bulkTransitionForAccount`).
- Emits one `log()` per row — each an `fs.existsSync` + separate `fs.appendFile` to the same
  daily file (5000 FS appends for one request). Batch the lines into one append.
- `APPROVE_ALL_MAX = 5000` is handler-local (not in `types.js` LIMITS) and truncates
  **silently**: response is only `{success, changed, trusted}`, so the UI toasts
  "Approved 5000" with items still pending. Loop until drained or return a `remaining` count.
- The post-transaction tally-and-audit loop (lines 414-429) is a near-verbatim copy of
  `bulk()`'s (lines 369-385) — extract a shared helper.

### 12. `media-sweep` doesn't use the new `quarantineItemDir()` and lacks its collision guard

`core/media-sweep.js:98-105`, `core/media-storage.js:63-71`

The sweep still hand-rolls `mkdirSync` + `renameSync` into `quarantine/` without the
name-collision suffix guard the new helper has. A colliding orphan's rename throws inside the
best-effort `try/catch` and is silently skipped — every pass, until quarantine is emptied.
Call `quarantineItemDir()` from the sweep.

### 13. Friendly CSRF message sniffs human-readable server copy

`public/pages/utils.js:217`, `core/auth.js:195,242,287,323`

The client branch is `status === 403 && serverMessage.includes("CSRF")`; the server has four
copy-pasted `sendJson(res, 403, { error: "Invalid CSRF token" })` sites and no machine code.
Any rewording silently kills the friendly message. Extract one 403-CSRF helper in
`core/auth.js` that also sends `code: "CSRF"`, and branch on the code client-side.

---

## Cleanup / simplification

### 14. `syncCounter()` hardcodes a fifth "0/500" literal

`public/components/comment-thread.js:196,216` — after clearing `input.value`, dispatch
`input.dispatchEvent(new Event("input", { bubbles: true }))` so the existing counter handler
(line 44) updates it, and delete `syncCounter`. The 500 limit currently lives in four literals
in this file.

### 15. `showFindInvitation()` copy-pastes `showError()`'s body

`public/pages/rsvp/rsvp-form.js:53-66` vs `:34-48` — identical show/hide choreography +
`requestAnimationFrame` reveal, differing only in message and the `rsvp-message-neutral`
class. Make it `showError(msg)` + a class toggle, or `showError(msg, { neutral })`.

### 16. Guest "Try again" load-error pattern hand-rolled twice

`public/pages/guestbook/feed.js:153,166-167` and `public/pages/gallery/grid.js:158-161,392` —
the same relabel/reveal/reset dance, while this same diff gave the admin side a shared
`showLoadError` helper. Add one shared helper for the guest feeds in `public/pages/utils.js`.

### 17. `gallery-admin.js` small cleanups

- `:114-131` — `move()` runs `findIndex` + `-1` guard, then `moveTo()` repeats the identical
  lookup on the same array; make `moveTo` the single locator.
- `:165-166` — `rank.has(a.id) ? Number(rank.get(a.id)) : Number.MAX_SAFE_INTEGER` (twice)
  reduces to `rank.get(a.id) ?? Number.MAX_SAFE_INTEGER` (Map values are already numbers).

### 18. Party-size message is a ternary nested inside a template literal inside a ternary

`api/rsvp.js:121-130` — extract a tiny `companionPhrase(n)` helper (outputs for n=1 "just
you", n=2 "your guest", n>2 "your N-1 guests" must be preserved exactly).
