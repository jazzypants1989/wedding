# Phase 4 — Gallery UI

**Goal**: `/gallery` — section switcher, a grid that stays smooth at thousands of items, a lightbox (images + video, keyboard/swipe, deep links), and the upload tray wired to the Phase 3 pipeline. Comments/reactions panel space is stubbed (Phase 5 fills it).

**Prerequisites**: Phases 1, 3 (+ auth sheet/guest-session/celebrate from Phase 2). **Read first**: `00-overview.md`, `03-media-pipeline.md` §5 (processing contract + transport spec),
`public/pages/guestbook/` (page conventions established in Phase 2), `public/pages/utils.js`, `public/components/` (Phase 2 components), `public/styles/tokens.css`, `scripts/seed-preview.js` (to extend).

> **Status (implemented):** the list API (§2), `public/components/media-uploader.js`, and the gallery
> page scaffolding (`public/pages/gallery/`: `main.js`, `grid.js`, `lightbox.js`, `upload.js`) are
> built. This spec now documents shipped behavior; sections still describe the intended design, not
> pending work. (The reactions/comments panel space in §5 is filled by Phase 5.)

## 1. Files

```
public/pages/gallery/
  index.html      (head/nav template per Phase 2 conventions; three canonical stylesheet
                   links byte-identical; + /styles/social.css + /pages/gallery/gallery.css)
  main.js         entry: nav/theme/session bootstrap, section switcher, ?item deep link
  grid.js         grid rendering, keyset paging, batch management
  lightbox.js     lightbox: media stage, nav, swipe, deep-link, panel shell
  upload.js       tray UI driving components/media-uploader.js
  gallery.css
  types.d.ts      MediaItem view types, GridState, LightboxState, UploadQueueItem
public/components/
  media-uploader.js   NET-NEW this phase (implemented — exports `createUploadQueue()`). UI-agnostic
                      queue engine (XHR, concurrency, retry) — admin reuses it in Phase 6. Consumes the EXISTING
                      components/media-processing.js (`processMediaFile()`, shipped in Phase 3) for
                      client resize/poster; this module owns only transport (session flow + XHR).
```

## 2. List API — handlers in `api/media.js` (public; implemented as specified below)

Beyond Phase 3's 4 upload-session routes (`POST /api/media`, `PUT /api/media/:id/:variant`,
`POST /api/media/:id/finalize`, `DELETE /api/media/:id`), this phase's **two public read routes are
implemented**: `GET /api/media` → `media.list` and `GET /api/media/:id` → `media.getOne`, registered
in `core/router.js` with `errorHandling: true` (they call `getOptionalAccount` internally, exactly
like `guestbook.list`). Segment counts disambiguate them from the existing routes: `/api/media`
(2 segs, shares path with `POST`), `/api/media/:id` (3 segs, shares path with `DELETE`).

**Query — `getMediaFeed({ callerId, section, before, limit })` in `db/media.js`** (implemented), modeled on
`getGuestbookFeed` (`db/guestbook-entries.js:22`), with one structural difference that the guestbook
does NOT have:

> **`account_id` is NULL for admin/official uploads**, so the accounts join MUST be a `LEFT JOIN`
> and `author_name` comes back NULL for those rows. Coalesce it server-side to the couple's display
> name (`WEDDING.COUPLE_NAMES` in `types.js`, "Jesse & Jordana"). A plain `JOIN` (as guestbook uses)
> would silently drop every official item from the feed.

```sql
SELECT m.id, m.file_key, m.account_id, m.kind, m.section, m.status, m.caption,
       m.width, m.height, m.duration_seconds, m.needs_display, m.created_at,
       a.name AS author_name, <is_own> AS is_own
FROM media m
LEFT JOIN accounts a ON a.id = m.account_id
WHERE m.deleted_at IS NULL AND m.section = ${section}
  AND (m.status = 'approved' <ownPending>)     -- ownPending: OR (m.status='pending' AND m.account_id=callerId)
  <beforeFilter>                                -- guest only: AND m.id < ${before}
ORDER BY <ordering>                             -- guest: m.id DESC   |  official: m.sort_order, m.id
LIMIT ${limit}
```

- **`guest`**: keyset `id DESC`, approved + caller's own pending (flagged `is_own` + `status`),
  default limit 100, clamp ≤100 (grid pages are bigger than the 20-row guestbook feed).
- **`official`**: ordered `sort_order, id`, offset-free single page, cap 500 (official stays small);
  `nextCursor` is always `null`. Own-pending is irrelevant here (admin-only section) but harmless.
- Reuse the guestbook handler's `parseCursor` / `clampLimit` helpers' logic; validate `section`
  against `MEDIA_SECTION` (default `guest`). Rate-limit with the shared `publicRead` limiter.

**Response** (mirrors guestbook's `{ entries, nextCursor }`): `{ items, nextCursor }`. `nextCursor` =
last row's `id` when a full page came back, else `null` (guest); always `null` for official.
Item shape: `{ id, file_key, kind, section, status, caption, width, height, duration_seconds,
needs_display, author_name, is_own, created_at }` (SQLite `0|1` flags mapped to booleans, `author_name`
coalesced). URLs are built client-side as `/media/{file_key}/{variant}`.

- **`GET /api/media/:id`** single item (for `?item=` deep links before the grid loads). Implemented
  as `media.getOne` using `getMediaFeedRowById` + the **same visibility gate as the list** (`isVisible`):
  return the item only if `approved`, OR the caller owns it AND it is `pending`; anything else
  (hidden/rejected/deleted/nonexistent, or someone else's pending) → **404**. Without this gate,
  iterating small integer ids leaks captions,
  author names, dimensions, and `file_key`s of unmoderated content (adjudication R8). Returns the same
  item shape (single object, not wrapped).

**Types**: add `MediaFeedRow` (raw, `0|1` flags, nullable `author_name`) and `MediaListItem` +
`MediaListResponse` to root `types.d.ts`; feed-fn signature to `db/types.d.ts`; handler signatures to
`api/types.d.ts`.

## 3. Section switcher

Segmented control under the header, admin-tab pattern (`role="tablist"`, arrow keys): **Official** | **Guest Photos** (+ count once loaded). URL state `?section=guest` via `history.replaceState`. Two persistent grid containers (hide/show, never re-render) — each keeps its own cursor and scroll position. Guest section shows the upload CTA; official doesn't.

## 4. Grid — the scaling strategy (binding; see 00-overview decision log)

Markup: batches of 100 items, each batch a `<ul class="media-grid" data-page>` section; items are `<li><button class="media-cell" data-id><img></button></li>` (3 nodes/item; 3,000 items ≈ 9,000 nodes — fine *if offscreen content isn't laid out*).

```css
.media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 2px; }
@media (min-width: 768px) { .media-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); } }
.media-cell { aspect-ratio: 1; width: 100%; }
.media-cell img { width: 100%; height: 100%; object-fit: cover; }
.media-page { content-visibility: auto; contain-intrinsic-size: auto var(--batch-est, 900px); }
```

Compute `--batch-est` per batch at init instead of trusting the 900px default: measure one
rendered row (or derive from container width ÷ column min-width), then
`rows = ceil(100 / columns)`, `est = rows × (rowHeight + gap)`. On a 375px phone the real batch
height is ~3,800px — a hardcoded 900px estimate is ~4× off, which produces the documented
jumpy-scrollbar failure and lands deep anchor scrolls wrong. The `auto` keyword still lets the
browser remember actual rendered sizes after first paint.

1. **`content-visibility: auto` on each 100-item batch** is the virtualization mechanism — offscreen batches cost ~0 layout/paint. No JS windowing.
2. Every `<img>`: `loading="lazy" decoding="async"` + explicit `width`/`height` from metadata (CLS-free), thumb variant (~400px).
3. One IntersectionObserver on a single sentinel after the last batch, `rootMargin: "1200px 0px"`; guard flag against concurrent fetches. Auto-load caps around 20 batches, then a "Load more" click resumes.
4. **Deferred fallback** (build only if the Phase-4 perf check fails): recycle batches >10 viewport-heights away into fixed-height spacers, restorable from the metadata array.

Cells: uniform squares (`object-fit: cover`); true aspect ratio only in the lightbox. Video cells: poster + duration chip + play glyph (`::after` triangle). `needs_display` items: neutral placeholder tile with a camera glyph. Own-pending items: `status-pending` corner chip (visible only to the author by virtue of the API). Skeleton: 12 shimmer cells on first paint (static under reduced motion). Empty guest section: "No guest photos yet — got some from the big day? 📸" + CTA. Alt text: caption if present else `"Photo by {author_name}"`.

## 5. Lightbox

One fullscreen `<dialog id="lightbox">` (native focus trap + Esc).

- **Stage**: `display` variant image, or `<video src="/media/{key}/video" controls playsinline preload="none" poster="/media/{key}/poster">` (the `video` variant is the GPS-blanked original, served as `video/mp4` — 03 §7). Stage background always near-black (`--color-lightbox-stage: #0b0810`, deliberately not `light-dark()`); `color-scheme: dark` on the dialog so native video controls match.
- **Top bar**: close ×, counter "34 / 512" (`aria-live="polite"`), author + relative time, copy-link button (`navigator.clipboard.writeText`).
- **Footer**: a small "Report" `mailto:` link (prefilled subject with the item's `file_key`) — the zero-backend path for photo *subjects* (not uploaders) to ask the couple to take a photo down; admin hide is the action.
- **Panel** (caption now; reactions/comments in Phase 5): desktop ≥1024px right sidebar 360px; mobile swipe-up drawer collapsed to a handle. **Caption is display-only in Phase 4** — the Phase 3 `finalize` endpoint accepts no caption and the upload tray (§6) has no caption field, so guest-uploaded items carry `caption = NULL`. The panel and the alt-text fallback (§4: `"Photo by {author_name}"`) must degrade gracefully when null; a non-null caption appears only on admin-set official items (capture UI is a later phase).
- **Nav**: ←/→ keys; 44px chevron buttons (fade in on pointer move on desktop); **swipe** via Pointer Events (~60 lines: translate stage with finger, commit past 25% width or 0.3 px/ms velocity). Preload ±1 `display` images via `new Image()` on settle.
- **Video**: pause on navigate; never autoplay.
- **Deep link**: open → `history.pushState(…, "?section=…&item=" + id)`; `popstate` closes/reopens; page load with `?item=` → fetch `GET /api/media/:id`, open immediately, grid backfills behind.

## 6. Upload flow

Entry: "Add photos & videos" button in the guest-section header + mobile FAB (fixed bottom-right, appears after scrolling past header, z below mobile nav). Both → `requireAccount(openPicker)`.

Picker: hidden `<input type="file" accept="image/*,video/*" multiple>`; desktop drag-drop onto the grid (~15 lines).

**Tray** (`.upload-tray`, fixed bottom card): one row per file — preview thumb (`URL.createObjectURL(thumbBlob)`, revoke on removal; requires the Phase 3 CSP `blob:` change), label, state:

```
queued → processing (client resize/poster) → uploading (XHR progress bar) → done ✓ | pending ⏳ | failed ⚠ (Retry · Remove)
Overall: "Uploading 3 of 7…"  [Cancel all]
```

Rules (engine = `public/components/media-uploader.js`, UI-agnostic so admin reuses it):
- Processing serialized (1 at a time — phone canvas memory); uploads 2 in parallel; per-variant XHR retry ~4 attempts, exponential backoff. Retry re-runs only the failed step (blobs stay in memory; page reload loses the queue — `beforeunload` warning while active).
- Upload order per file: thumb → display → original (gallery-usable data lands first; the 100MB tail is the retryable part).
- Session flow per file: `POST /api/media` → PUT variants → `POST finalize`. On finalize success: prepend into the guest grid (trusted) or with pending chip (untrusted, author-only view). First success of the session → `fireConfetti()`.
- Failure copy taxonomy: "File too large (max N MB)", "Not a supported format" (also produced by the client-side magic-byte pre-check — a mid-stream 415 presents as a connection reset, so pre-checking avoids 4 pointless full-size retries; 03 §5), "Videos over 60 seconds can't be uploaded", "This file type isn't supported on your device — try uploading from Photos as JPEG" (HEIC processing failure), "Upload failed — check connection (Retry)". **403 is not a failure**: re-read the `guest_csrf` cookie and retry once with the fresh token (stale-tab CSRF rotation; 03 §5) before surfacing anything.
- Cancel aborts the XHR; cancel-all confirms when >1 in flight.
- Untrusted messaging mirrors guestbook: one-time note that uploads await approval.

Uses `html`` ` templates + `data-action` event delegation (admin-table pattern) for tray rendering.

## 7. Seed script for the perf check

Extend `scripts/seed-preview.js` (flag like `--gallery 2000`): generate 2,000 media rows (mix of image/video, some pending, a handful official) with tiny generated placeholder files on disk (reuse `tests/media-fixtures.js` buffers written per key so `/media/` serves 200s; thumbs can be 1-color JPEG buffers).

## 8. Tests & acceptance criteria

Integration: list pagination (section filter, keyset walk, own-pending inclusion); single-item fetch; official ordering respects `sort_order`.

Manual (documented in the PR/commit):
- Seeded 2,000-item grid scrolls smoothly on a mid-range phone (or 6× CPU-throttled DevTools) — **this validates the content-visibility bet before launch**; note findings.
- Phone upload: multi-select 5 photos + 1 video → progress per file → all land; kill network mid-video → retry succeeds.
- `?item=<id>` deep link opens the lightbox before the grid finishes.
- Keyboard-only lightbox pass (open, navigate, close, focus restored).
- Tray previews render under prod CSP (verifies the `blob:` change).
- Both themes; reduced-motion (no confetti/shimmer/swipe-transition animations).
