# 08 — Bulk media import

**Status:** built. Supersedes `HANDOFF-bulk-media-import.md`, which was the design
document written before the architecture was settled.

The admin "Add official photos" modal is a browser, and a browser has three
problems with a few hundred wedding photos: no folder picker, no HEIC decode on
desktop Chrome (every iPhone photo lands `needs_display = 1`, showing a
placeholder tile), and somebody has to watch it for half an hour.
`npm run import:media` does the same work from a shell.

---

## 1. Usage

```bash
npm run import:media -- <dir> [options]
```

Always dry-run first. It reads every file, reports exactly what would happen, and
touches no write path — no login, no password prompt, no database created.

```bash
npm run import:media -- ~/Photos/Wedding --dry-run
npm run import:media -- ~/Photos/Wedding
```

| Option | Default | |
|---|---|---|
| `--section=official\|guest` | `official` | Which gallery section. |
| `--dry-run` | off | Report only. |
| `--url=URL` | — | Import over the API instead of writing locally (§4). |
| `--recursive` | off | Descend into subdirectories. |
| `--order=name\|mtime` | `name` | Import order (§3). |
| `--captions=sidecar` | off | Read `IMG_1234.txt` beside `IMG_1234.jpg`. |
| `--concurrency=N` | `min(8, cores-1)` | Files in flight. |
| `--manifest=PATH` | `<data dir>/import-manifest.json` | Idempotency record (§2). |
| `--report=PATH` | — | Write the run summary as JSON. |
| `--force` | off | Import even files the manifest records. |
| `--skip-reorder` | off | Leave `sort_order` alone. |
| `--strip-original` | off | Also remove EXIF from stored originals (§5). |
| `--heic-original=keep\|jpeg` | `keep` | Re-encode HEIC originals to JPEG (§5). |
| `--videos=skip\|require` | `skip` | Missing ffmpeg skips videos, or fails the run. |
| `--verbose` | off | Per-file detail, including backend stderr. |

Exit codes: **0** clean, **1** some files failed, **2** aborted (bad arguments,
no image backend, destination full), **130** interrupted by SIGINT/SIGTERM.

130 is split out from 2 because a wrapper that retries on failure should retry a
`DESTINATION_FULL` stop and *not* retry a Ctrl-C the operator typed deliberately.
Either way the cleanup is the same, and it is the part that matters: sessions
created but not finalized are `discard()`ed, so no row is left in `uploading`
holding its declared bytes against the disk guard, and the manifest is flushed so
the next run resumes instead of re-importing (§9).

Progress goes to stderr one line per file; the summary goes to stdout. So
`npm run import:media -- ~/Photos/Wedding > summary.txt` keeps the progress on
screen and the summary in a file.

### Requirements

One image tool on `PATH`, probed in this order: **vips** → **magick** →
**convert** (ImageMagick 6) → **sips** (macOS built-in). `brew install vips` is
worth doing: sips produces display variants roughly 3× the size at the same
nominal quality, cannot write WebP at all, and reads HEIC orientation
differently from the other two.

Videos additionally need **ffmpeg**, for the poster frame. Without it videos are
skipped per-file with an install hint — never fatal, unless `--videos=require`.

`WEDDING_IMAGE_BACKEND` / `WEDDING_IMAGE_BIN` pin the choice; see `.env.example`.

---

## 2. Re-running is a no-op

Every import is recorded in a JSON manifest keyed **origin → sha256 → row**.

- **Content-keyed**, so renaming or moving a photo does not re-import it.
- **Origin-keyed**, so importing to staging does not suppress importing to
  production.
- **Present means skip, unconditionally.** The manifest is deliberately never
  reconciled against the server: if the couple deleted a photo in the admin grid,
  the next run must not resurrect it. `--force` overrides.
- Written after **every** finalize, so an interrupted run resumes rather than
  re-importing what already landed.

The manifest is machine-local. A second machine re-imports everything. If that
matters, `--manifest=` parks it beside the photos — e.g. on the external drive
the photos live on. A manifest inside the imported directory is recognized and
skipped, not reported as an unsupported file.

There is no `source_sha256` column on `media` and this is why: adding one means a
schema migration, an index, an admin-only field on `POST /api/media` and a lookup
endpoint — a permanent expansion of the core schema to serve a one-directional
CLI. Revisit only if multi-machine imports become real.

---

## 3. What it produces

Rows identical to an admin upload through the modal: `account_id NULL`,
`status = 'approved'`, `needs_display = 0`, populated `width`/`height` and
per-variant byte counts, real `display`/`thumb` WebP (or JPEG on sips) on disk.

**Nothing parses a file extension.** Every file is classified by its first 32
bytes through the same `core/sniff.js` the server uses — which is also what makes
`.DS_Store`, `.AAE` sidecars and stray text files skip themselves, and what makes
a JPEG named `.png` import correctly.

**Ordering.** `sort_order` follows filename ascending, using a plain code-unit
sort rather than `localeCompare` so the result is identical on every machine and
in every locale. Photos already in the gallery keep their relative order and the
imported ones are appended — an import never reshuffles what was already curated.
`--order=mtime` exists as an escape hatch but is not the default, because mtime
is usually when the files were copied off the camera. (EXIF capture time is read
and available but not yet an ordering option.)

**Captions** are null by default; the admin grid has inline caption editing.
`--captions=sidecar` reads `IMG_1234.txt` next to `IMG_1234.jpg`, trimmed and
clamped through the same sanitizer the API uses.

**Variants are provably metadata-free.** This is not a nicety: `api/media.js`
stores public `display`/`thumb` bytes as-received with no server-side strip,
relying on the browser's canvas re-encode to have dropped EXIF. A CLI importer is
exactly the non-conforming client that posture warns about — and vips and magick
preserve metadata by default while sips has no strip flag at all. So every derived
variant is rewritten through `core/image-meta.js` and the result is asserted, not
assumed. ICC profiles are deliberately **kept** (they carry no location data, and
dropping them would render Display-P3 iPhone photos desaturated); EXIF, XMP and
IPTC are dropped.

Each variant is also re-sniffed and size-checked against the same
`VARIANT_SPEC` the server enforces before it is written, so a 413 or 415 at
upload time is impossible. A quality/size ladder steps down until a variant fits
its cap.

---

## 4. Local vs `--url`

**Local (default).** Imports the server's own `db/`, `core/` and `api/` modules
and writes rows and files directly. Use this whenever you are on the machine
hosting the site. Stop the server first, or at least don't import next to a busy
one — SQLite is in WAL mode with a 5s busy timeout, so a concurrent writer means
a stall, not corruption.

**`--url=http://host:port`.** Drives the real upload API as an admin, for a site
you are not sitting next to. Password from `WEDDING_ADMIN_PASSWORD` or a hidden
prompt; deliberately not a flag, because flags land in shell history and `ps`.

Two things `--url` cannot do:

1. **It cannot set `sort_order` exactly.** `POST /api/admin/media/reorder`
   validates the submitted ids against `getOfficialMediaIds()`, which includes
   hidden and rejected rows, while a client can only enumerate the approved-only
   public feed. When they differ the reorder 400s and the importer **warns rather
   than failing** — the photos imported fine, only their order is unset. Drag them
   into place in the admin Gallery tab, or import locally. The admin
   drag-and-drop UI has the identical limitation.
2. **It cannot attribute a `--section=guest` item to a named guest.**
   `withAccountOrAdmin` gives an admin principal `accountId: null`
   unconditionally, so guest-section imports show as the couple's. The local sink
   *could* set `account_id`; it doesn't, because nothing has asked for it.

---

## 5. Originals and EXIF

Originals are stored **byte-for-byte** by default. That is exact parity with the
browser uploader, which PUTs the raw `File`, and it is not a privacy regression:
`core/media-serve.js` excludes `original` from `PUBLIC_VARIANTS`, so image
originals are admin-only, `private, no-store`, `Content-Disposition: attachment`.
They are never served publicly.

So the dry run and the summary say how many originals carry GPS, and what that
does and doesn't mean, rather than changing the policy silently:

```
  47 of 203 photos carry GPS coordinates in their original file.
  Originals are admin-only (private, no-store, never served publicly) — this
  matches what the browser uploader does. The public display/thumb variants
  this importer generates are always metadata-free.
  Pass --strip-original to remove EXIF from the stored originals too
  (lossless for JPEG/PNG/WebP; HEIC needs --heic-original=jpeg).
```

`--strip-original` is a lossless container rewrite for JPEG/PNG/WebP. It cannot
clean a HEIC container, and says so rather than pretending: use
`--heic-original=jpeg` to store a native-size metadata-free JPEG instead. HEIC
originals are kept as `.heic` by default because the server accepts them, they're
admin-only, and re-encoding inflates them toward `IMAGE_ORIGINAL_MAX`.

**Worth knowing separately:** `scripts/export-archive.js` hardlinks the whole
`data/uploads/media/` tree, so GPS-bearing originals land in the sunset archive.
That predates this importer and applies to browser uploads too — and it is the
couple's own archive — but it is the one place those bytes leave the admin
boundary.

---

## 6. Architecture decision record

The open question in the hand-off document was: reimplement the write path in the
script, or drive the HTTP API? The answer is **both, behind one interface**, and
two claims in that document turned out to be wrong.

**Corrected: byte-for-byte originals are not a privacy regression** (§5 above).
The hand-off's §5.4 assumed image originals were publicly served. They are not.

**Corrected: the real EXIF hazard is inverted, and it is live.** The risk was
never the originals — it is the public `display`/`thumb` variants, which the
server stores as-received. That is what made a provable strip pass mandatory
rather than optional, and it is the single most important thing this importer
does that the browser path does not.

**Also found: `sort_order` is never set by the upload path.** `createMediaRow`
omits it and `finalizeMedia` doesn't set it, so every API-created official row
lands at the schema default `0`. Ordering needed an explicit step; it was not
free.

The sink interface (`preflight` / `createSession` / `putVariant` / `finalize` /
`discard` / `applyOrder` / `close`) means scanning, hashing, variant generation,
the manifest, the error taxonomy and reporting are written once. The local sink
imports the server's own modules — including `VARIANT_SPEC`, now exported from
`api/media.js` — so "duplicated invariants", the hand-off's objection to writing
directly, does not apply.

**One deliberate departure from the plan:** variant generation and upload share a
single worker pool rather than two pools joined by a bounded hand-off queue. A
worker uploading is a worker not generating, so the CPU/IO overlap is the same;
temp disk is still bounded at `concurrency × one file's variants`; and there is no
queue to drain on abort.

**Shelling out to a system image binary is a new dependency class** — the first
in this codebase. It is confined: probed at runtime by trying to execute it
(never `which`, never a hard-coded path), invoked only as an argv array with no
shell (filenames come from a user's photo directory and can contain spaces,
quotes, `$`, `;`, newlines), CLI-only, and never on the server request path. See
the note under Core Principles in `CLAUDE.md`.

---

## 7. New modules

```
core/image-meta.js       Pure-JS image header reader + lossless metadata filter
                         (JPEG/PNG/WebP). Peer of core/mp4-meta.js. The server can
                         adopt it later to close the api/media.js posture note.
core/mp4-probe.js        Duration/dimensions/rotation from MP4 boxes, no ffprobe.
                         Shares box-walking primitives with core/mp4-meta.js.
scripts/import-media.js  The CLI: parseArgs, scanDirectory, buildPlan, runImport.
scripts/lib/
  image-backend.js       Backend probe, capability table, argv builders, parsers.
  media-variants.js      Planning + variant generation, strip pass, self-checks.
  import-manifest.js     The idempotency record.
  sink-local.js          Direct DB + filesystem writes.
  sink-http.js           The upload API as an admin.
  media-errors.js        MediaImportError + its code taxonomy.
  prompt.js              Hidden password prompt, extracted from setup-admin.js.
```

---

## 8. Admin modal (the small browser-side half)

The modal now also has a **"Choose folder"** button and a **drop zone**, so a
moderate batch doesn't require the CLI. The folder picker needs its own
`<input>`: `webkitdirectory` makes an input folder-only, so it cannot be combined
with the existing `multiple` one.

Folder picks are filtered by magic bytes before enqueueing — a folder hands over
`.DS_Store` and `.AAE` sidecars, and the queue would otherwise render each as a
red "Not a supported format" row — and the count skipped is reported.

**Dropping a folder does not work in any browser**: `dataTransfer.files` is empty
for directories unless you walk `webkitGetAsEntry`. The drop zone handles file
selections, the button handles folders, and the helper text says so.

This does **not** fix desktop-Chrome HEIC. Those still land `needs_display = 1`
as placeholder tiles. That is what the CLI is for.

---

## 9. Verification status

Automated: 46 unit tests (arg parsing, scanning, planning, the run loop's
taxonomy and ordering, the HTTP transport contract) and 7 integration tests
driving the whole pipeline against both real sinks. `npm test` covers them.

Checked by hand against real files, because these are the parts a synthetic
fixture cannot prove:

| | |
|---|---|
| Orientation-6 source (stored landscape, displays portrait) | ✅ correct `1600×2400` on **all three** backends, including sips's explicit rotate pass |
| HEIC decode | ✅ vips, magick **and** sips |
| No upscaling of a source smaller than the target | ✅ a 300×200 source stays 300×200 through sips `-Z` |
| Derived variants metadata-free | ✅ zero EXIF/XMP/IPTC fields on every backend's output |
| ICC profile retained | ✅ a Display-P3 profile survives `vips keep=icc` and the WebP ICCP filter into `display.webp`, while its EXIF does not |
| `--strip-original` | ✅ EXIF removed, ICC kept, image intact |
| `--url` end to end | ✅ against a live server: dry run without a prompt, correct `sort_order`, publicly-served display variants, second run imports nothing |

**Still unverified**, for want of the right thing to test with — flag these if
they matter:

1. **ffmpeg argv.** Written from the spec; ffmpeg was not installed on the
   machine this was built on. The first video import is the real test. Photos are
   unaffected — a missing ffmpeg skips videos per-file with an install hint.
2. **Real 12MP display sizes.** Only 2000px sources were available, so the
   quality step-down ladder has never actually needed a rung. It exists for
   exactly this gap; if it fires, the run reports `steppedDown`.
3. **ImageMagick 6 (`convert`).** Only IM7 (`magick`) was installed. The
   operators used are IM6-compatible in principle but unexercised.
4. **A real iPhone HEIC.** The HEIC tested was ImageMagick-produced. Backends are
   known to disagree about iPhone HEIC orientation (vips/magick vs sips), which is
   why the reported dimensions are cross-checked against the largest derived
   variant rather than trusted.

## 10. Note for whoever edits the CSS

CSS in `public/styles/` and the per-page sheets is concatenated and inlined at
server startup, then SHA-256 hashed for CSP (`core/static.js`). A `.css` edit is
invisible until the server restarts — a browser reload is not enough.
