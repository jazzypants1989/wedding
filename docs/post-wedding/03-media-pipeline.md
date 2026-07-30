# Phase 3 — Media Pipeline & Serving

**Goal**: everything between a file on a guest's phone and bytes in a browser: upload-session endpoints, streaming disk writes, validation, storage layout, the `/media/:fileKey/:variant` file server with Range support, the client-side processing module, and ops guards. No gallery UI (Phase 4). Parallelizable with Phase 2 once Phase 1 has shipped.

**Prerequisites**: Phase 1 (`withAccount`, accounts). **Read first**: `00-overview.md`,
`core/http.js` (parseBody — the thing we deliberately do NOT reuse; error classes), `core/static.js` (header/ETag/traversal patterns to adapt; CSP constant to edit), `server.js` (requestTimeout line ~70, `/api` dispatch, activeRequests/graceful shutdown, hourly interval), `core/rate-limit.js`, `db/sql.js`, `Dockerfile` + `docker-compose.yml` (volume, non-root user), `scripts/backup-db.js`, `DEFERRED.md` (§2 off-host backups), `tests/helpers.js`.

## 1. Schema (add to `createTables()`; triggers via `runMigrations` entry `add_media_triggers`)

```sql
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_key TEXT UNIQUE NOT NULL,                 -- 32 lowercase hex, crypto.randomBytes(16)
  account_id INTEGER,                            -- NULL = admin/official upload
  kind TEXT NOT NULL,                            -- image|video
  section TEXT NOT NULL DEFAULT 'guest',         -- official|guest
  status TEXT NOT NULL DEFAULT 'uploading',      -- uploading|pending|approved|hidden|rejected
  caption TEXT,
  original_ext TEXT,                             -- derived from sniff: jpg|png|webp|heic|mp4|mov
  original_bytes INTEGER, display_bytes INTEGER, thumb_bytes INTEGER, poster_bytes INTEGER,
  width INTEGER, height INTEGER,
  duration_seconds REAL,                         -- video only
  needs_display INTEGER NOT NULL DEFAULT 0,      -- HEIC-from-Chrome fallback (see §5.2)
  sort_order INTEGER NOT NULL DEFAULT 0,         -- official-section ordering (Phase 6)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  deleted_at TEXT DEFAULT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
-- Serves admin/status-filtered lists; the public feed's OR-disjunction picks the PK scan
-- (fine for keyset id DESC at this scale) — same note as idx_guestbook_feed.
CREATE INDEX IF NOT EXISTS idx_media_guest_feed
  ON media(section, status, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_official_order
  ON media(section, sort_order, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_account ON media(account_id);
```

Triggers: enum pairs for `status` (five values incl. `uploading`), `kind`, `section`; `auto_updated_at_media`.

Constants in `types.js` (+ mirrors in `types.d.ts`):

```js
export const MEDIA_LIMITS = Object.freeze({
  IMAGE_ORIGINAL_MAX: 30 * 1024 * 1024,
  VIDEO_ORIGINAL_MAX: 110 * 1024 * 1024,   // 100MB cap + container slack
  DISPLAY_MAX: 4 * 1024 * 1024,
  THUMB_MAX: 500 * 1024,
  POSTER_MAX: 1024 * 1024,
  VIDEO_MAX_DURATION_S: 60,
  UPLOAD_IDLE_TIMEOUT_MS: 30_000,
  UPLOAD_ABSOLUTE_TIMEOUT_MS: 10 * 60_000,
  MAX_CONCURRENT_UPLOADS_PER_ACCOUNT: 3,
})
export const MEDIA_KIND = Object.freeze({ IMAGE: "image", VIDEO: "video" })
export const MEDIA_SECTION = Object.freeze({ OFFICIAL: "official", GUEST: "guest" })
// RATE_LIMITS: MEDIA_CREATE: { windowMs: 60*60*1000, max: 30 }  (per account)
```

## 2. Upload protocol — raw binary PUT per variant (binding decision; see 00-overview decision log)

All under `/api/media/*` (normal router dispatch; mutations wrapped with **`withAccountOrAdmin()`** — a new wrapper this phase adds to `core/auth.js` that accepts a guest `guest_session` OR an admin `session` cookie, applying the matching CSRF check; binding reconciliation 7. It reads only headers, so it composes with streaming bodies. This is what lets Phase 6's admin upload reuse these exact routes with `adminFetch` and `account_id: NULL` rows).

**Normalized principal (implemented):** an admin caller has no `accounts` row, so the wrapper hands the handler a `routeInfo.principal = { isAdmin, accountId: number|null, trusted, session }` rather than the raw session — admin → `{ isAdmin: true, accountId: null, trusted: true }`, guest → `{ isAdmin: false, accountId: account.account_id, trusted: !!account.trusted }`. Ownership is `principal.isAdmin || row.account_id === principal.accountId`; finalize status is `principal.isAdmin || principal.trusted ? 'approved' : 'pending'`. **Precedence: check `guest_session` first, fall back to admin `session`** — so a couple browsing with both cookies uploads as their guest account, while Phase 6's `adminFetch` (no guest cookie) resolves as admin. (Note: the overview's reconciliation 7 / adjudication B3 shorthand `account_id = account.id` refers to this `accountId` field — the session object exposes `account_id`, never `.id`.)

```
POST /api/media                    JSON via existing parseBody:
                                   { kind, originalName?, width?, height?, durationS?, originalBytes }
                                   (admin caller may add section:'official')
                                   → disk-guard + quota check (§6) → 201 { id, fileKey }, row status='uploading'
PUT  /api/media/:id/:variant       ONE parameterized route (implemented as such — not four separate
                                   routes); a per-kind VARIANT_SPEC map gates which :variant is legal
                                   for the row's kind, so an invalid pairing (e.g. poster on an image)
                                   → 400 before any body is read. The four valid variant/kind pairings:
                                     :variant=original  raw body; Content-Type in allowlist; Content-Length REQUIRED (411 if absent)
                                     :variant=display   images only (canvas JPEG/WebP)
                                     :variant=thumb     images only
                                     :variant=poster    videos only
                                   REQUIRES row status='uploading' → 409 otherwise (binding reconciliation 8:
                                   re-PUT idempotency spans ONLY the upload window; once finalized, variants
                                   are immutable — without this gate an owner could silently replace
                                   approved content that then serves under an unchanged ETag)
                                   → 200 { variant, bytes, sha256 } — idempotent within the window
                                   → 413 over cap (mid-stream abort), 415 sniff/Content-Type mismatch
POST /api/media/:id/finalize       JSON { width, height, durationS?, displayMissing? }
                                   REQUIRES status='uploading'; verifies required variants on disk
                                   (image: original+display+thumb; video: original+poster;
                                   displayMissing→ requires ONLY original + sets needs_display=1 —
                                   a HEIC that desktop Chrome couldn't decode has NEITHER display
                                   NOR thumb, since both come from the one canvas decode);
                                   video: runs blankVideoGps() on the original IN PLACE (§7.5) — the
                                   original then doubles as the public `video` variant;
                                   flips status = admin-created ? 'approved'
                                                : account.trusted ? 'approved' : 'pending'
                                   → 200 { id, status }
                                   IDEMPOTENT: re-finalize of an already-finalized row is a no-op 200
                                   returning current status (client retries finalize after network errors)
DELETE /api/media/:id              own (or admin) — ANY status, matching guestbook self-delete: soft-delete
                                   the row AND unlink the variant files (keep the row for audit). A guest
                                   who regrets a photo must not need to contact the couple.
```

Ownership: every `:id` route verifies `row.account_id = principal.accountId` OR the caller is admin. Rows stay `uploading` until finalize; nothing partial is ever publicly visible. (No notification call on pending — the Phase 2 digest service discovers pending items on its own schedule; this is what makes this phase genuinely parallel with Phase 2. This phase's only touch to the digest is wiring a real `countPendingMedia()` into `getModerationCounts()` — added in `db/media.js`, imported by `db/guestbook-entries.js` — so the hourly digest picks up pending media automatically.)

**Orphan cleanup** (hook the existing hourly `setInterval` in `server.js`): `cleanAbandonedUploads()` — delete `status='uploading'` rows older than 6h + their directories; unlink `data/uploads/tmp/*.part` older than 1h; log counts. Full integrity pass daily (hourly counter modulo 24): files-without-rows → move to `data/uploads/quarantine/` (never auto-hard-delete); finalized rows with missing variant files → log loudly + flag for admin. The "missing variant" check computes each row's **expected** variants (video → original+poster; image → original+display+thumb, but a `needs_display=1` image expects only original) so HEIC fallbacks don't false-alarm.

## 3. Streaming write path — new `core/upload.js`

Pattern: `stream.pipeline(req, guardTransform, fs.createWriteStream(stagingPath, { flags: "wx", flush: true }))`, then atomic `fs.promises.rename` into the final location (same filesystem — both under `data/uploads`).

```js
/** @param {import('node:http').IncomingMessage} req
 * @param {{ maxBytes: number, expectedKinds: string[], stagingDir: string }} opts
 * @returns {Promise<{ stagingPath: string, bytes: number, sniffed: string, sha256: string }>} */
export async function streamToStaging(req, opts) {
  const declared = Number(req.headers["content-length"])
  if (!Number.isInteger(declared) || declared <= 0) throw new LengthRequiredError() // → 411
  // This phase adds THREE AppError subclasses to core/validation.js, each mapping to
  // the right status: LengthRequiredError (411, "LENGTH_REQUIRED"), PayloadTooLargeError
  // (413, "PAYLOAD_TOO_LARGE"), UnsupportedMediaTypeError (415, "UNSUPPORTED_MEDIA_TYPE").
  // Plain ValidationError maps to 400 and would fail §9's 411/413/415 tests.
  if (declared > opts.maxBytes) throw new PayloadTooLargeError()
  const stagingPath = path.join(opts.stagingDir, crypto.randomBytes(16).toString("hex") + ".part")
  let bytes = 0, sniffed = "", headBuf = Buffer.alloc(0)
  const hash = crypto.createHash("sha256")
  // idle timer (reset per chunk, 30s) + absolute timer (10min) both req.destroy() on fire
  const guard = new Transform({
    transform(chunk, _enc, cb) {
      resetIdle()
      bytes += chunk.length
      if (bytes > opts.maxBytes || bytes > declared) return cb(new PayloadTooLargeError())
      if (headBuf.length < 32) {
        headBuf = Buffer.concat([headBuf, chunk]).subarray(0, 32)
        if (headBuf.length >= 12 && !sniffed) {
          sniffed = sniffMagic(headBuf)
          if (!opts.expectedKinds.includes(sniffed)) return cb(new UnsupportedMediaTypeError("Unsupported file type")) // fail fast → 415
        }
      }
      hash.update(chunk)
      cb(null, chunk)
    },
  })
  const ws = fs.createWriteStream(stagingPath, { flags: "wx", flush: true }) // flush → fsync before close
  try {
    await pipeline(req, guard, ws)
    if (bytes !== declared) throw new ValidationError("Body shorter than Content-Length")
    if (!sniffed || !opts.expectedKinds.includes(sniffed)) throw new UnsupportedMediaTypeError("Unsupported file type")
    return { stagingPath, bytes, sniffed, sha256: hash.digest("hex") }
  } catch (err) {
    fs.promises.unlink(stagingPath).catch(() => {}) // hourly sweep is the backstop
    throw err
  } finally { clearTimers() }
}
```

Notes:
- `pipeline` handles backpressure and mutual teardown — never hand-roll `data`/`write` loops.
- `{ flush: true }` fsyncs the **file**, not the directory — after the atomic rename a crash can still lose the dir entry. Accepted: the hourly integrity pass + re-PUT idempotency cover it; do not "fix" this with dir-fd fsync complexity.
- On mid-stream cap violation the socket is destroyed; clients may not read the 413 — the frontend treats network-error-on-PUT as "retry" (idempotent).
- Per-account concurrency cap (3) via a module-level `Map<accountId, count>`; also a module-level `reservedBytes` counter so the disk guard accounts for in-flight uploads (ENOSPC race).
- Graceful shutdown: uploads are counted by `activeRequests` already; a >10s upload at deploy time gets dropped and retried (idempotent PUTs). Optionally export `abortAllUploads()` for the shutdown handler — recommended.

### REQUIRED `server.js` change

`server.requestTimeout = 30_000` (line ~70) kills any request not fully received in 30s — a 100MB video on a 10 Mbit uplink takes ~80s minimum. Node has no per-route override. Change to `600_000`, keep `headersTimeout` ~35s, and comment why. Safety is preserved: every other body path still goes through `parseBody` (own 30s/1MB), uploads have idle+absolute timers.

## 4. Validation — new `core/sniff.js`

Magic-byte signatures (Buffer compares on first 32 bytes; `toString("latin1")` for ASCII tags):

| Kind | Signature |
|---|---|
| jpeg | `FF D8 FF` at 0 |
| png | `89 50 4E 47 0D 0A 1A 0A` at 0 |
| webp | "RIFF" at 0 AND "WEBP" at 8 |
| heic | "ftyp" at 4 AND brand at 8 ∈ {heic,heix,hevc,hevx,heim,heis,mif1,msf1} |
| mp4 | "ftyp" at 4 AND brand ∈ {isom,iso2,iso4,iso5,iso6,mp41,mp42,avc1,"M4V ",3gp4,3gp5,3gp6} |
| mov | "ftyp" at 4 AND brand = "qt  " (two trailing spaces) |

Brand-list notes (verified against the MP4RA registry): `heif` and `mp4v` are **not** registered
brands (dead entries — removed); `hevx` is registered (added); the `3gpN` brands cover older
Android camcorder files that often carry a `.mp4` extension (added — they demux fine as MP4).
Known accepted quirk: `mif1` is codec-agnostic, so an AVIF with `mif1` major brand passes the
HEIC gate — harmless (it stores with a `.heic` ext; the client-generated display variant is what
the public sees). (ftyp-first is true for every real phone-camera file; exotic/legacy files that
fail are acceptably rejected.) Returns `""` for unknown.

- **Extension derives from sniff** (`jpeg→jpg` etc.), never from client filename. `Content-Type` header must agree with sniff (allowlist: image/jpeg, image/png, image/webp, image/heic, image/heif, video/mp4, video/quicktime) → 415 on disagreement.
- Variant kind allowlists: original(image): jpeg/png/webp/heic; original(video): mp4/mov; display/thumb/poster: jpeg/webp only.
- **Dimensions: trust the client** (finalize body). They only feed layout; a lying client only breaks its own tile. Optional sanity check for display/thumb (JPEG SOF walk / PNG IHDR at bytes 16–23) is nice-to-have, not required.
- **EXIF/privacy**: display/thumb/poster are canvas re-encodes → EXIF (incl. GPS) stripped automatically; orientation must be baked by the client (`imageOrientation: 'from-image'`). **Image originals are never served publicly** — admin-only download route with `Content-Disposition: attachment` (Phase 6 exposes it in UI). **Video originals become publicly servable only after finalize's in-place GPS blanking** (§7.5) and are then exposed as the `video` variant — always with `Content-Type: video/mp4`, because Chromium demuxes QuickTime files through its MP4 path but does not register the `video/quicktime` MIME type (a `<video>` fed that type won't play in Chrome/Edge even when the codec is fine). HEVC caveat: Files-app originals may be HEVC, which Chrome/Edge decode hardware-only and Firefox 134+ — a small tail of viewers gets a black player; the dominant iOS Photos-picker path re-encodes to H.264 and masks this. Accepted.

## 5. Client processing module — new `public/components/media-processing.js`

Contract consumed by Phase 4's uploader:

```
processMediaFile(file) → Promise<{
  kind: "image"|"video", displayBlob?, thumbBlob?, posterBlob?,
  width, height, durationS?, displayMissing?: true }>
```

1. **Images**: `createImageBitmap(file, { imageOrientation: "from-image" })` → canvas at ≤2000px long edge → `convertToBlob({ type, quality: 0.82 })` for display (prefer image/webp where supported, JPEG fallback — server accepts both), ≤400px q0.7 for thumb.
2. **HEIC caveat**: Safari/iOS decodes HEIC into canvas; desktop Chrome cannot. Strategy: try decode; on failure resolve with `displayMissing: true` (original-only upload; server sets `needs_display=1`; gallery shows a placeholder). Rare in practice for the right reason: iOS's Photos picker hands the page a **JPEG** for HEIC images (raw HEIC only arrives via the Files app), and Safari 17+ decodes HEIC in-page anyway — so this fallback mostly serves Android-HEIC and Files-app uploads viewed on Chrome. Keep the comment citing that mechanism so nobody "optimizes" the fallback away.
3. **Video**: no client transcode. Enforce ≤60s/≤100MB pre-upload (reject with a clear message); duration from `video.duration` after `loadedmetadata`. Poster extraction (iOS-verified sequence — deviating produces black posters): `preload="metadata"` is **mandatory** for blob: URLs; seek `t = min(0.5, duration/2)`; wait `seeked`; then wait ~2 rAFs (~100ms) — on iOS Safari `seeked` fires before the frame is paintable; draw ≤2000px JPEG 0.8; **verify the canvas isn't blank** (sample a few pixels) and retry once after a further delay if it is.
4. Serialize processing (one file at a time — phone canvas memory).

Transport spec (implemented by Phase 4's `media-uploader.js`, stated here as the contract): **XMLHttpRequest, not fetch** (fetch lacks upload progress everywhere — that's the real reason; whole-Blob fetch uploads do work in Safari). One XHR per variant. Order: thumb → display → original (small first). Two variant-PUTs in parallel; per-variant retry w/ exponential backoff, ~4 attempts. Two mandatory failure-taxonomy entries:
- **403 → CSRF refresh**: guest CSRF rotates every 24h and gallery tabs live for days; on a 403, re-read the `guest_csrf` cookie and retry once with the fresh header before counting it as an attempt. Without this, a stale tab retries 4× with the same dead token and fails every upload.
- **Early connection reset ≠ retryable**: a mid-stream 415 sniff failure destroys the socket, so a permanently-bad file presents as a network error. The client already sniffs magic bytes during processing — pre-check them and surface "Not a supported format" instead of burning 4 full-size retry uploads.

**CSP change (this phase owns it)**: in `core/static.js`, `img-src 'self' data:` → `img-src 'self' data: blob:` and add `media-src 'self' blob:` — required for upload-tray previews (`URL.createObjectURL`) and poster extraction.

## 6. Storage layout & disk guard

```
data/uploads/
  tmp/                       staging: {rand16hex}.part (swept hourly)
  quarantine/                orphan files moved here by the daily integrity pass
  media/{key[0:2]}/{key}/    original.{ext} display.jpg thumb.jpg poster.jpg
```

- 256 prefix buckets; dir-per-item (delete = one recursive rm; variants co-located for rsync).
- Dirs created at boot (`mkdirSync recursive` beside DB init; volume is owned by `wedding:1001`, no Dockerfile change).
- Capacity estimate: 2,000 photos × 8MB + display/thumbs (~1.3GB) + 200 videos × 60MB + posters ≈ **~30GB; provision ≥50GB**.
- Disk guard at `POST /api/media` and before each original PUT: `fs.statfsSync(TMP_DIR)` (a child of `uploadsDir`, same filesystem — the free-bytes number is identical; `/api/health` reports the same figure via `statfsSync(UPLOADS_DIR)`) → `free = bavail * bsize`; refuse 507 when `free - declaredBytes - reservedInFlight < MEDIA_MIN_FREE_BYTES` (env, default 5GB) or `SELECT SUM(original_bytes)` > `MEDIA_MAX_TOTAL_BYTES` (env, default 45GB).
- **Untrusted-account quota** (abuse guard — open registration is instant, so a stranger with the URL must not be able to fill the disk): at `POST /api/media`, if the account is untrusted, refuse 507 when `SELECT SUM(original_bytes) WHERE account_id = ?` (plus this upload's declared bytes) exceeds `MEDIA_UNTRUSTED_QUOTA_BYTES` (env, default 250MB). Trusted accounts are unlimited (the global caps still apply). Auto-trust on first approval (Phase 6) lifts the cap for legitimate guests quickly.
- **File deletion on terminal states**: reject and self-delete unlink the item's variant files (keep the DB row for audit); hide keeps files (it's reversible). Without this, rejected 100MB videos occupy disk forever with no admin recourse.

## 7. Serving — new `core/media-serve.js`, dispatched in `server.js` before `serveStatic`

```js
if (urlPath.startsWith("/media/")) return serveMedia(req, res)   // one-line branch; logic stays in core/
```

Route `GET /media/:fileKey/:variant` (support `HEAD` identically minus the body — some video players probe with HEAD), variant ∈ {display, thumb, poster, **video**} public; `original` admin-only (`parseCookies` + admin `getSession`). The `video` variant maps to the same `original.{ext}` file on disk — legal to serve publicly only because finalize blanked its GPS atoms in place (§7.5); serve it as `Content-Type: video/mp4` **always**, regardless of container (see §4 — Chromium won't play `video/quicktime`). `video` is only valid for `kind='video'` rows; `original` remains admin-only for both kinds (image originals still carry EXIF GPS).

1. Validate key: exactly 32 chars, each 0-9a-f via charCode loop. Variant from frozen allowlist. Paths built only from validated key + DB ext — traversal structurally impossible.
2. DB gate: `SELECT status, kind, original_ext, ... FROM media WHERE file_key = ?`. Missing, or not `approved` and requester not admin → **404** (never 403 — don't confirm existence). One indexed point-read per request is fine at this scale (the rate limiter already does a DB write per request).
3. Headers: Content-Type from DB (never re-sniff; `video` variant overrides to `video/mp4`), `X-Content-Type-Options: nosniff`, `Accept-Ranges: bytes`, `ETag: "<key>-<variant>"` + If-None-Match → 304. **Cache-Control split** (owner decision 2026-07-06): guest-section variants `public, max-age=86400` (a hidden photo must actually disappear for prior viewers within ~a day; ETag/304 revalidation traffic at this scale is nil); official-section variants `public, max-age=31536000, immutable` (curated, admin-controlled). Originals: `private, no-store` + `Content-Disposition: attachment`. **Evaluate If-None-Match before Range** — RFC 9110 §13.2.2: when the conditional matches and a Range is present, the answer is 304, not 206.
4. **Range support** (iOS Safari refuses video without 206). No-regex parser:

```js
/** @returns {{start:number,end:number} | null | "invalid"} null = ignore, serve 200 */
export function parseRange(header, size) {
  if (!header || !header.startsWith("bytes=")) return null
  const spec = header.slice(6)
  if (spec.includes(",")) return null                       // multi-range → full 200
  const dash = spec.indexOf("-")
  if (dash === -1) return "invalid"
  const startStr = spec.slice(0, dash).trim(), endStr = spec.slice(dash + 1).trim()
  if (startStr === "") {                                    // suffix bytes=-N
    const n = parseDecimal(endStr)
    if (n === null || n === 0) return "invalid"
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = parseDecimal(startStr)
  if (start === null) return "invalid"
  const end = endStr === "" ? size - 1 : parseDecimal(endStr)
  if (end === null || start >= size || start > end) return "invalid" // → 416
  return { start, end: Math.min(end, size - 1) }
}
// parseDecimal: charCodeAt 48-57 loop, max 15 digits, else null
```

`"invalid"` → 416 + `Content-Range: bytes */<size>`. Valid → 206 + `Content-Range: bytes <s>-<e>/<size>` + `Content-Length: e-s+1`, body `fs.createReadStream(p, { start, end })` via `stream.pipeline(rs, res, cb)` (client-abort teardown, no fd leaks). No range → 200 full stream. `fs.stat` at serve time is truth (stat-vs-row drift → 404 + log). **Never gzip media.**

### 7.5 GPS blanking — new `core/mp4-meta.js` (prototype-validated; see `review-adjudication.md`)

`blankVideoGps(filePath)` — called by finalize on video originals before the row can go public. Reads the file, blanks **all three** GPS carriers **in place** — offsets never move, so no re-muxing — writes back, returns the list of blanked regions (log it; empty list is normal for picker-transcoded uploads, which iOS already strips). The two Apple carriers are blanked with spaces (0x20); `loci`'s binary fields are zeroed.

- **Legacy `moov/udta/©xyz`** (type bytes `A9 78 79 7A`): payload is 2-byte string length + 2-byte language + ISO6709 string → blank the string bytes.
- **Modern `moov/meta` (mdta)**: the value is NOT adjacent to the key name. `keys` holds names (`com.apple.quicktime.location.ISO6709`); `ilst` holds values under child atoms whose 4-byte type is the **big-endian 1-based key index**. Walk `keys` → collect location-key indices → walk `ilst` → blank each matching `data` atom's payload (after its 8-byte type/locale header). Blanking the value is sufficient; the key name is a harmless label and keeping it preserves keys/ilst index correspondence.
- **3GPP `moov/udta/loci`** (added after the fact — see below): a FullBox holding `[language(2)][name…\0][role(1)][longitude(4)][latitude(4)][altitude(4)][astronomical_body…\0][notes…\0]`, coordinates as signed **16.16 fixed-point**. Zero everything after the 4-byte version/flags: the numbers, and also `name`/`additional_notes`, which are free text naming the place. Zero rather than space-fill — `0x20202020` as 16.16 decodes to 8225.98°, an out-of-range coordinate, where zero is a well-formed "no location". The box still parses afterwards (empty strings, role 0, 0.0 coordinates).
  - **Why it was missed, and why it mattered:** the original scope was "both Apple carriers", correct for the assumed iPhone source. But ffmpeg writes `loci` for `-metadata location=`, so any clip a guest trimmed or re-encoded can carry one — and because a video's original *is* its public `video` variant (§6 `resolveServable`), the coordinates were recoverable straight out of the served bytes. Found by importing a deliberately GPS-tagged clip through `scripts/import-media.js`; regression-tested in `tests/unit/core/mp4-meta.test.js` against `makeMp4WithLoci()`.
- Structural walker requirements: 32-bit sizes plus `size=1` (64-bit largesize) and `size=0` (to-EOF); recurse into `moov/trak/mdia/minf/udta`; `meta` may be QuickTime-style (children immediately) or ISO fullbox (4-byte version/flags first) — detect via the `hdlr` first child. Bail out cleanly (blank nothing beyond what was found) on malformed structure — never throw finalize into a 500 over weird-but-servable metadata.
- ~130 lines, zero-dep, no regex (`Buffer` reads + `latin1` type compares). Unit fixtures in §9.

## 8. Ops / deployment checklist (record in DEFERRED.md when shipping this phase)

1. Traefik entrypoint `transport.respondingTimeouts.readTimeout` — v3 defaults 60s, kills slow uploads at the proxy. Set 0 or ≥10m on the https entrypoint.
2. Confirm no Traefik buffering middleware on this router (would spool 100MB to proxy disk).
3. Verify `server.requestTimeout` change shipped.
4. VPS: ≥50GB free; set `MEDIA_MIN_FREE_BYTES`/`MEDIA_MAX_TOTAL_BYTES`/`MEDIA_UNTRUSTED_QUOTA_BYTES` in `.env`.
5. Nightly off-host backup: `rsync -a --ignore-existing .../uploads/media/ backuphost:...` + newest DB `*.backup` in the same cron (extends DEFERRED.md §2; uploads are write-once = ideal rsync workload; `--ignore-existing` makes VPS-side deletes non-propagating, which is correct for a backup).
6. Add free-disk bytes to `/api/health` payload.

## 9. Tests

Fixtures: **no binary files in the repo** — build Buffers in a new `tests/media-fixtures.js`: `makeJpeg(n)` = `FF D8 FF E0` + filler + `FF D9`; `makeMp4(n)` = `00 00 00 18` + "ftypisom" + filler; `makeHeic`, `makePng`, `makeMov` likewise.

Unit (`tests/unit/core/`): `sniff.test.js` (every signature incl. the 3gpN brands, truncation, unknown→""), `media-serve.test.js` (`parseRange`: `0-499`, `500-`, `-500`, start>end, start≥size→invalid, multi-range→null, garbage→invalid, 16-digit overflow; If-None-Match + Range together → 304), `upload.test.js` (synthetic `Readable` through `streamToStaging`: over-cap aborts+unlinks, short body rejects, sniff mismatch fails before full body), `mp4-meta.test.js` (fixture built in `tests/media-fixtures.js` with a `moov` containing `udta/©xyz` + QuickTime-style `meta`/`keys`/`ilst` GPS entries: both carriers blanked, atom tree byte-identical, coordinate strings absent afterward; ISO-fullbox `meta` variant; GPS-free file is a byte-exact no-op; malformed sizes bail cleanly).

Integration (`tests/integration/media.test.js`): full session (create → PUT variants → finalize) with `accountFetch`; public GET display → 200 with `max-age=86400` (guest section) — an official-section item serves `immutable`; video finalize → GET `/media/:key/video` serves `video/mp4` with the GPS-blanked bytes; pending item → 404 public / 200 admin; `Range: bytes=0-9` on 1KB fixture → 206 + exact `Content-Range` + 10 bytes; If-None-Match → 304 (with and without a Range header); HEAD mirrors GET headers with empty body; wrong magic → 415, no file on disk; over-cap PUT → error + empty staging; re-PUT idempotency **within** the uploading window; **PUT after finalize → 409** (the moderation-bypass gate); **re-finalize → no-op 200** with unchanged status; DELETE own approved item → row soft-deleted, variant files unlinked; untrusted account over `MEDIA_UNTRUSTED_QUOTA_BYTES` → 507 at create; admin session (adminFetch) drives a full upload session with `account_id NULL` → finalize auto-approves; finalize with missing variant → 400/409; sweep test (backdated `uploading` row + stray tmp file, invoke exported sweep fn, assert both gone); PUT without Content-Length → 411; unauthenticated PUT → 401.

## 10. Acceptance criteria

- All tests + tsc green. Scripted demo: register account, upload a fixture "video" via curl (create/PUT/finalize), fetch `/media/:key/video` with a Range header, see 206 + `video/mp4`; pending item invisible publicly, visible after admin approve (approve endpoint arrives fully in Phase 6 — for this phase flip status via SQL in the demo or reuse the Phase 2 moderation endpoint if it landed first); attempt a re-PUT after finalize and see 409.
- `server.js` diff includes requestTimeout comment, `/media/` branch, sweep hook.
