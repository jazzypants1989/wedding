# Hand-off: bulk media import (+ a modal centering fix already landed)

**Date:** 2026-07-29
**Branch:** `track-1-content-as-data`
**Status:** one bug fixed and verified; the bulk-import feature is **designed but not
built** — and the key architectural decision is still open (see §4).

---

## 1. Why this document exists

The owner wanted to fill the post-wedding demo with real photos instead of seeded
stock images, and asked whether the admin "Add official photos" flow can take a
whole directory. Answering that surfaced (a) a genuine CSS bug, now fixed, and
(b) the need for a bulk importer, which was **not** written because the design
question in §4 hadn't been settled. Do not start coding until §4 is decided.

---

## 2. Current machine / server state

- Dev server was running on **:3000** via `npm start` (background). It may have
  been stopped since — restart with `npm start`.
- `npm run seed:demo` has been run successfully. Seeded: 47 media (8 official,
  28 approved guest, 4 pending, 2 hidden, 1 rejected, 5 video), 19 approved
  guestbook entries, 5 gifts, 4 thank-you cards (one per state).
- Guest login for the demo: invite code **`LOVEBIRD`** + any name = trusted.
- Seeded thank-you card links (printed by the seed, reproduced for convenience):
  - sent/unviewed → `/thanks?card=4gVBa85t`
  - viewed → `/thanks?card=YBQWZgRK`
  - viewed + replied → `/thanks?card=ipmt4arh`
- A `tmp/` scratch dir was created and **deleted** at the end of the session. It
  is not gitignored; if you create one, clean it up or add it to `.gitignore`.

### Uncommitted changes in the working tree

| File | What | Origin |
|---|---|---|
| `scripts/seed-demo.js` | `DEMO_CODE` `LOVEBIRDS` → `LOVEBIRD`; cleanup now also matches on the `@seed.demo` email marker | pre-existing (earlier session) |
| `docs/post-wedding/demo-walkthrough.html` | same code rename in 3 places | pre-existing (earlier session) |
| `public/styles/components.css` | dialog centering fix, see §3 | **this session** |

The invite-code rename is a real fix: `LOVEBIRDS` is 9 characters, but
`validateInviteCode()` requires exactly 8 and the auth-sheet input is
`maxlength="8"`, so the old code was physically untypeable. All three files
should be committed together.

---

## 3. Fixed and verified: every modal rendered at the viewport's top-left

**Symptom:** the admin "Add official photos" dialog appeared off-centre.

**Root cause:** the universal reset at `public/styles/layout.css:6`

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
```

zeroes `margin` on *every* element, which silently overrides the UA stylesheet's
`dialog:modal { margin: auto }` — the only thing that centres a native
`<dialog>` opened with `showModal()`. Measured geometry before the fix:
`x: 0, y: 0`, computed `margin: 0px`.

**Scope:** this affected all ~20 `<dialog>` elements in the app, plus the guest
"Who's celebrating?" auth sheet on desktop. It survived unnoticed because
`social.css:191-194` gives the auth sheet `margin: auto auto 0` inside a mobile
media query — so the mobile bottom sheet looked correct while desktop was broken.

**Fix:** one declaration added to the base `dialog` rule in
`public/styles/components.css` (with a comment explaining the interaction, so
nobody "cleans it up" later).

**Verified** (headless Chrome, 1280×720):

| Surface | Before | After |
|---|---|---|
| Admin upload modal | `0, 0` | `283/298` horiz, `232/232` vert ✓ |
| Guest auth sheet, desktop | top-left | `413/428`, `36/36` ✓ |
| Guest auth sheet, mobile 390×844 | bottom sheet | still bottom sheet, `bottomGap: 0` ✓ |
| Gallery lightbox | fullscreen | unchanged — `gallery.css:195` sets its own `margin: 0`, which wins on specificity ✓ |

**Dev gotcha that cost time:** the CSS in `public/styles/` is concatenated and
inlined into the HTML `<head>` at **server startup**, then SHA-256 hashed for the
CSP (`core/static.js:75-80`). A CSS edit is invisible until the server restarts —
a browser reload is not enough. Worth knowing before you conclude a style fix
"didn't work."

---

## 4. THE OPEN DECISION — read before writing any importer code

Two viable architectures. **This was not decided.** Picking wrong means either a
maintenance liability or a lot of wasted work.

### Option A — write DB rows + variant files directly

What `scripts/seed-demo.js` already does: generate variants, `fs.writeFileSync`
them via `variantDiskPath()`, `INSERT INTO media (...)`.

- **Pro:** fast, simple, no server needed, proven pattern in-repo.
- **Con:** bypasses magic-byte sniffing (`core/sniff.js`), the disk/quota guards
  (`MEDIA_STORAGE` in `types.js:229`), and `finalize`'s validation. It duplicates
  invariants that already live in one place — notably `expectedVariants()`
  (`types.js:262`) and the per-variant byte caps (`MEDIA_LIMITS`,
  `types.js:200`). When those change, a direct-write importer drifts silently and
  the daily integrity sweep starts flagging rows.

### Option B — drive the real upload API over HTTP as the admin principal

Log in, then use the same upload-session endpoints the browser uses
(`api/media.js`, `core/upload.js`).

- **Pro:** reuses sniffing, quota accounting, disk guards, and finalize
  validation. Zero duplicated invariants. Exercises the production path, so the
  importer doubles as an integration smoke test.
- **Con:** still needs variants generated locally (the browser normally does this
  in `public/components/media-processing.js`), needs session + CSRF handling,
  slower, and needs the server running.

**Leaning:** B for correctness and long-term maintainability, A if this is only
ever a one-off local convenience. The owner has stated this is
**"something other people should be able to use in the future"** — which argues
strongly for B. Confirm before building.

---

## 5. Requirements gathered (valid under either option)

### 5.1 The interface must be parameterised — no hard-coded paths

`scripts/import-media.js <dir> [--section=official|guest] [--dry-run]`. The
directory is an **argument**. Do not hard-code a path, do not read a path from a
config file, and **do not search the user's filesystem to guess it** — the owner
objected to that specifically and was right to.

### 5.2 Image resize backend — a portability trap

Variant generation normally happens client-side in a canvas. Server-side there is
no image library, and the **zero-npm-dependency rule forbids adding one**. So the
script must shell out to a system binary — which is a *new class* of dependency
for this repo and deserves an explicit call-out in `CLAUDE.md`.

`sips` is macOS-only. Hard-coding it would break every non-Mac user. **Probe an
ordered list of backends and fail with a message naming what to install.**
Detected on the owner's machine:

| Binary | Present | Notes |
|---|---|---|
| `/usr/bin/sips` | ✓ | macOS built-in; also converts HEIC → JPEG |
| `/opt/homebrew/bin/magick`, `convert` | ✓ | ImageMagick, cross-platform |
| `/opt/homebrew/bin/vips` | ✓ | fastest for large batches |
| `ffmpeg` | **✗** | needed for video posters — see 5.3 |
| `/usr/bin/qlmanage` | ✓ | macOS-only; can generate a video thumbnail as an ffmpeg fallback |

### 5.3 Videos

A video row requires `original` + `poster` (`types.js:263`). Extracting a poster
frame needs `ffmpeg`, which is **not installed**. Options: skip videos with a
clear message and let the browser path handle them (probably right — most people
have a handful of videos and hundreds of photos), require ffmpeg only when video
files are present, or use `qlmanage -t` on macOS. Decide explicitly; don't let
videos fail silently.

### 5.4 EXIF / GPS privacy — do not miss this

The browser path re-encodes images through a canvas, which **strips EXIF
entirely**, and `core/mp4-meta.js` blanks GPS atoms in MP4/QuickTime originals.
A server-side importer that copies image originals byte-for-byte would
**preserve EXIF GPS on every photo** — a privacy regression versus the existing
pipeline, on a public wedding site. Either strip EXIF when writing the original
(most backends can: `sips` and `magick` both re-encode) or copy the browser's
behaviour and store a re-encoded original. This is a requirement, not a nice-to-have.

### 5.5 HEIC

Relevant either way, and the reason a CLI importer is attractive: desktop Chrome
cannot decode HEIC (`public/components/media-processing.js:46-52`). Those uploads
land `needs_display = 1`, original-only, with **no thumbnail or display variant** —
i.e. a gallery of broken-looking tiles. Safari 17+ decodes HEIC in-page, and iOS's
Photos picker hands over JPEG, so the failure is specific to desktop Chrome plus
Files-app HEIC. A server-side importer with `sips`/`magick` sidesteps it completely
and should always produce real `display` + `thumb` variants (`needs_display = 0`).

### 5.6 Idempotency

Re-running on the same directory must not double-import. `seed-demo.js` uses an
`app_state` manifest keyed `seed_demo_manifest`; an importer probably wants a
content hash per file instead, so moved/renamed files aren't re-added. Note there
is **no `source_filename` column** on `media` — if you want provenance you need a
migration, or to overload `caption`, or a separate manifest row in `app_state`.

### 5.7 Ordering and captions

`section = 'official'` renders in `sort_order` (`db/media.js:61`,
`idx_media_official_order`). Decide how order is derived: filename sort is
predictable; EXIF capture time is more natural but needs metadata parsing
(`sips -g` can print some). Captions: a sidecar `.txt` per image, a CSV manifest,
or leave null and let the owner type them in the admin grid (which already
supports inline caption editing).

### 5.8 Row shape for official imports

From the schema (`sqlite3 data/wedding.db ".schema media"`) and
`seed-demo.js:359`: `account_id = NULL` (NULL means admin/official),
`section = 'official'`, `status = 'approved'`, `needs_display = 0`,
`original_ext` from sniffing, and `original_bytes` / `display_bytes` /
`thumb_bytes` / `width` / `height` all populated. Respect `MEDIA_LIMITS`
(30 MB image original, 4 MB display, 500 KB thumb) and the `MEDIA_STORAGE` disk
caps.

---

## 6. Answer to the original question, for the record

The admin flow is **not** one-at-a-time, and the walkthrough docs don't say so
either way:

- **Multi-select already works.** `public/pages/admin/index.html:1334` has
  `multiple`. ⌘A in the picker selects a whole folder's contents. The queue
  processes one file at a time with 2 concurrent uploads
  (`MAX_UPLOAD_CONCURRENCY`, `public/components/media-uploader.js:11`) and shows
  "Uploading 7 of 200…".
- **You cannot point it at a directory.** The input has no `webkitdirectory`.
  Adding it needs a *separate* input/button — `webkitdirectory` makes an input
  folder-only, so it can't just be added to the existing one.
- **The admin modal has no drag-and-drop.** The *guest* gallery does
  (`public/pages/gallery/upload.js:410`); the admin modal never got a drop zone.
  Dragging files onto it does nothing. (Note: dropping a *folder* wouldn't work
  even there — `dataTransfer.files` is empty for directories without
  `webkitGetAsEntry`.)

Two small optional UI improvements, independent of the importer: a "Choose
folder" button with its own `webkitdirectory` input, and a drop zone on the admin
modal mirroring the guest one.

---

## 7. Repo constraints the next agent must respect

From `CLAUDE.md` — these are hard rules, not style preferences:

- **No regex anywhere.** No `RegExp`, no `/pattern/` literals. Use `split`,
  `indexOf`, `includes`, `startsWith`, `endsWith`, `replaceAll`, `charCodeAt`.
  Relevant here: file-extension and filename handling.
- **Zero runtime dependencies.** Node built-ins only. `@types/node` and
  `typescript` are type-check-only and never imported.
- **Typing:** declare the signature in the layer's `types.d.ts`, then annotate the
  implementation with `/** @type {Types.fnName} */`. Do not add `@param`/
  `@returns` on top of a `@type`. Never use `any` or `ts-ignore` — cast through
  `unknown` if you must.
- **`npm run typecheck` covers both tsconfigs.** Bare `tsc` misses `public/`.
- A new script needs: the file in `scripts/`, an entry in `package.json`
  `scripts`, and a line in the `CLAUDE.md` project-structure tree (both the
  `scripts/` block and the `## Commands` list).

---

## 8. How to verify admin UI headlessly (saves rediscovering this)

`TEST_ADMIN_PASSWORD` in `.env` happens to match `ADMIN_PASSWORD_HASH` on this
machine, so you can log in without prompting the owner:

```bash
P=$(grep '^TEST_ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -D h.txt -o /dev/null -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' -d "{\"password\":\"$P\"}"
# session= and csrf= cookies come back in h.txt
```

Then pass those cookies to the screenshot tool and drive the UI with steps:

```bash
node ~/.claude/skills/cli.js screenshot "http://localhost:3000/admin" shot.png \
  --env='{"cookies":{"session":"...","csrf":"..."}}' \
  --step='click:[data-tab="gallery"]' --step='sleep:800' \
  --step='click:#gallery-add-btn' \
  --evaluate='(()=>{const r=document.getElementById("gallery-upload-modal").getBoundingClientRect();return{x:r.x,y:r.y}})()'
```

`--evaluate` returning geometry is far cheaper than reading a PNG, and it's how
the centering bug was pinned down and confirmed.

---

## 9. Suggested order of work

1. Commit the three pending changes (invite-code fix + modal fix) so the tree is
   clean before anything new lands.
2. Get a decision on §4 (A vs B). Everything else depends on it.
3. Resolve §5.2 (backend probing), §5.3 (videos), §5.4 (EXIF stripping) — these
   are requirements, not implementation details.
4. Build `scripts/import-media.js` with `--dry-run` first, so a 200-file
   directory can be validated before anything touches the DB or disk.
5. Register it: `package.json`, `CLAUDE.md` (×2 places), and a short usage note
   in `docs/post-wedding/`.
6. `npm run typecheck && npm test` before handing back.

---

## 10. Process note

The owner's explicit feedback this session, worth honouring: **plan the design
before writing code**, and **never go hunting through their filesystem** for
inputs a flag should supply. Both were fair criticisms of how this session went.
