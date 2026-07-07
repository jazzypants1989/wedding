# Design-Review Adjudication Record

An adversarial design review of these specs (3 blockers, 10 risks, simplifications/alternatives/nits)
was adjudicated on 2026-07-06. This file records every verdict and the owner decisions, so agents
building later phases understand *why* the specs say what they say. The spec files are already
amended — this is the rationale, not a to-do list.

## Owner decisions (do not relitigate)

| Item | Decision |
|---|---|
| Image originals (S1) | **Keep** full-res originals as spec'd (uploaded, never served publicly). The ~half of Phase 3 ops complexity they drive is accepted. |
| Cache policy (R2) | Guest-section public variants: `max-age=86400` (+ ETag/304). Official-section: `immutable` 1yr. Hides become effective for prior viewers within ~a day. |
| Notifications (S2) | **Digest-only**: one ~daily email of outstanding pending items + the dashboard badge. No immediate-email path, no cooldown machinery. |
| Auto-trust (A2) | **Adopted**: approving an untrusted account's item auto-promotes the account to trusted (confirm dialog names all effects). Admin can untrust. |
| Recovery (A5) | **Adopted**: magic-link re-login email for untrusted accounts that provided a contact email. Phase 1 stores `contact_email`; Phase 6 ships the endpoints. |

## Blockers — all accepted

| Item | Resolution |
|---|---|
| B1 — videos had no publicly servable bytes | New public `video` variant = the **original file with GPS metadata blanked in place** at finalize, served as `video/mp4`. No second file on disk. **Prototype validated 2026-07-06** (see below). |
| B2 — re-PUT after approval = silent content swap | Variant PUTs and finalize require `status = 'uploading'` (else 409). Finalize is idempotent: re-finalize of an already-finalized row is a no-op 200 returning current status. |
| B3 — Phase 6 admin upload session couldn't authenticate | Phase 3 ships `withAccountOrAdmin()`; upload-session routes accept either principal; ownership check is `account_id = account.id` OR admin. Recorded as binding reconciliation 7 in 00-overview. |

### B1 prototype results (executable evidence)

A real QuickTime file was generated via AVFoundation with both GPS carriers iPhones write —
`com.apple.quicktime.location.ISO6709` in `moov/meta` (mdta `keys`/`ilst`) and the legacy
`moov/udta/©xyz` atom. A zero-dep, no-regex Node pass (~130 lines) blanked both values with
spaces (0x20) in place. Verified: atom tree byte-identical (only the 2×26 value bytes differ);
AVFoundation still reports the file playable with intact tracks/duration and reads both values
back as pure spaces; `avconvert` transcodes it with exit 0; Spotlight (`mdimport -t -d2`)
extracts lat/long from the original and **nothing** from the blanked file; a GPS-free file is a
byte-exact no-op. Two design facts the implementation must respect:

1. **The mdta value is NOT adjacent to the key name.** `keys` holds names; `ilst` holds values
   under child atoms whose 4-byte type is the big-endian 1-based key index. The pass must walk
   `keys` → resolve the index → walk `ilst` → blank the `data` payload(s). A naive
   `Buffer.indexOf(keyName)` + blank-following-bytes is wrong.
2. **Blanking the value is sufficient**; the key name is a harmless label and stays (also keeps
   `keys`/`ilst` index correspondence intact). QuickTime-style `meta` (no version/flags) and ISO
   fullbox `meta` (4-byte version/flags) must both be handled — detect via the `hdlr` first child.

## Risks

| Item | Verdict | Resolution |
|---|---|---|
| R1 autocapitalized invite codes vs BINARY collation | Accept | Registration lookup uses `COLLATE NOCASE` (verified zero case-folded collisions in the real DB; 62⁸ space makes future ones negligible). `/api/rsvp/:code` unchanged (codes arrive by link there). |
| R3 quota exhaustion / rejected files persist | Accept | Untrusted accounts: 250MB storage quota checked at session create. Reject/hide/self-delete unlink variant files (DB row kept for audit). |
| R4 Phase 3 imports Phase 2's notify service | **Dissolved by S2** | Digest-only means content endpoints never call the notify service; `maybeSendModerationDigest()` reads pending counts on the hourly tick. Phase 2/3 parallelism is now real. |
| R5 black posters on iOS | Accept | `preload="metadata"`, post-`seeked` settle (2×rAF), blank-canvas check + retry — in 03 §5. |
| R6 contain-intrinsic-size 4× off on phones | Accept | Estimate computed from column count × row height at init (04 §4). |
| R7 `video/quicktime` unplayable in Chromium | Accept | The `video` variant always serves `Content-Type: video/mp4` regardless of container. HEVC-decode tail documented. |
| R8 `/api/media/:id` metadata leak | Accept | Same visibility gate as the list query; invisible → 404. |
| R9 stale CSRF in long-lived upload tabs | Accept | Uploader: on 403 re-read `guest_csrf` cookie, retry once; client pre-sniffs magic bytes so permanently-bad files don't burn 4 full-size retries. |
| R10 sniff brand lists | Accept | Dropped dead `heif`/`mp4v`, added `hevx` + `3gp4/3gp5/3gp6`; mif1-AVIF pass-through noted as harmless. |

## Simplifications / alternatives not covered above

- **S3 media self-delete**: aligned with guestbook — authors may delete their own media at any
  status (soft-delete + unlink variant files).
- **S4 upload protocol, A3 resumable uploads, A4 SQLite BLOBs, A6 service-worker queue**: specs
  kept as written (review concurred).

## Review "missing entirely" items

- Export/sunset: Phase 7 gains an export-archive line item (JSON/CSV + media tree).
- Photo-subject deletion requests: "Report" mailto link in the lightbox footer (04 §5).
- `HEAD` on `/media` supported; new public GETs get a generous per-IP rate limiter.
- Impersonation-by-shared-code documented as an accepted risk in 01.

## Nits

All accepted as spec'd wording/contract fixes **except** nit 14 (`__Host-` cookie prefix) —
rejected/deferred (breaks plain-HTTP localhost development in some browsers); noted in
DEFERRED.md. Highlights: dedicated `LengthRequiredError` → 411 (03 §3); session-cap trim orders
`created_at DESC, rowid DESC` (01 §4 — the bare version is provably flaky on same-second
inserts); register returns 201 on create / 200 on re-login; promote-to-official is a **move**
(item leaves the guest feed) and both promote and admin-upload finalize **append**
(`sort_order = MAX+1`); If-None-Match is evaluated before Range per RFC 9110 §13.2.2.
