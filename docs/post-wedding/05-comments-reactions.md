# Phase 5 — Comments & Reactions Everywhere

**Goal**: polymorphic comments + emoji reactions on both guestbook entries and gallery media; shared `reaction-bar.js` and `comment-thread.js` components integrated into guestbook cards and the lightbox panel/drawer; optimistic updates with rollback.

**Prerequisites**: Phases 2 and 4 (both surfaces exist). **Read first**: `00-overview.md` (reconciliations 2 & 4),
`api/guestbook.js` (feed shapes to extend), `public/components/` (Phase 2/4 components), `public/pages/guestbook/feed.js`, `public/pages/gallery/lightbox.js`.

## 1. Schema (add to `createTables()`; triggers via `runMigrations` entry `add_social_triggers`)

```sql
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,                     -- guestbook|media
  target_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  deleted_at TEXT DEFAULT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comments_target
  ON comments(target_type, target_id, status, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_account ON comments(account_id);

CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,               -- heart|clap|laugh|heart_eyes|cheers|fire
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, target_type, target_id, emoji),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id);
```

Triggers (INSERT+UPDATE enum pairs, plus polymorphic-FK substitute — INSERT only):

```sql
CREATE TRIGGER IF NOT EXISTS check_comment_target_exists
BEFORE INSERT ON comments FOR EACH ROW
WHEN (NEW.target_type = 'guestbook'
        AND NOT EXISTS (SELECT 1 FROM guestbook_entries WHERE id = NEW.target_id AND deleted_at IS NULL))
  OR (NEW.target_type = 'media'
        AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.target_id AND deleted_at IS NULL))
BEGIN SELECT RAISE(ABORT, 'Comment target does not exist'); END;
-- identical trigger for reactions
```

**Handlers must pre-check target existence with a SELECT** (visible + approved-or-own) so triggers stay defense-in-depth — `RAISE(ABORT)` otherwise surfaces as a generic 500 through `withErrorHandling`.

Known trigger quirk (accepted, comment it in schema.js): `INSERT … ON CONFLICT DO NOTHING` still
fires the BEFORE INSERT trigger, so **un**-reacting to a since-soft-deleted target aborts (the
handler's visibility pre-check turns this into a 404 anyway) — reactions on deleted/hidden content
are frozen, and orphaned reaction rows accumulate (nothing cascades on target soft-delete). Harmless
at this scale; do not add cleanup machinery.

Constants: `TARGET_TYPE`, `REACTION_EMOJI` frozen objects + `_VALUES` + guards in `types.js`; `LIMITS.COMMENT_MAX_LENGTH: 500`; `RATE_LIMITS.COMMENT_POST: { windowMs: 60*60*1000, max: 60 }`, `REACTION_TOGGLE: { windowMs: 60*1000, max: 30 }` (account-keyed `"acct:" + id`). New validators in `core/validation.js`: `validateTargetType`, `validateReactionEmoji` (`_VALUES.includes`, no regex).

## 2. API (new `api/comments.js`, `api/reactions.js`)

| Method | Path | Auth |
|---|---|---|
| GET | `/api/guestbook/:id/comments` | public + optional account |
| GET | `/api/media/:id/comments` | public + optional account |
| POST | `/api/guestbook/:id/comments` | account, COMMENT_POST |
| POST | `/api/media/:id/comments` | account, COMMENT_POST |
| DELETE | `/api/comments/:id` | account (own only) |
| POST | `/api/reactions/toggle` | account, REACTION_TOGGLE |

Comments GET: all at once ascending (volumes are small; client caps display at 200 with "show all"); approved + caller's own pending flagged. Comment moderation matches guestbook: `status = trusted ? approved : pending` (no notification call — the digest service discovers pending items; 02 §3). Comments on hidden/deleted parents vanish naturally because reads join parent visibility (the GET handler resolves the parent first; 404 if not visible to the caller).

Reactions toggle body `{ target_type, target_id, emoji }` (all validated; target must be visible to caller):

```js
const r = sql`INSERT INTO reactions (account_id, target_type, target_id, emoji)
  VALUES (...) ON CONFLICT(account_id, target_type, target_id, emoji) DO NOTHING`.run()
const active = r.changes > 0
if (!active) sql`DELETE FROM reactions WHERE ...`.run()
// respond { active, counts: { heart: 3, cheers: 5, ... } }  (fresh GROUP BY for this target)
```

Atomic, idempotent, no transaction. Reactions are not moderated and **not audited** (too noisy). Comments audit `COMMENT_CREATE`/`COMMENT_DELETE`.

**Feed enrichment** (extend Phase 2/4 list handlers): after fetching a page of ids, two queries via `sql.list(ids)` —
`SELECT target_id, emoji, COUNT(*) c FROM reactions WHERE target_type=${t} AND target_id IN ${sql.list(ids)} GROUP BY target_id, emoji` plus the caller's own rows; and a comment-count GROUP BY. Merge into each item: `reactions: { heart: { count, mine } … }`, `comment_count`. No counter-cache table.

## 3. `public/components/reaction-bar.js`

Key→glyph map: `{ heart:"❤️", clap:"👏", laugh:"😂", heart_eyes:"😍", cheers:"🥂", fire:"🔥" }` (server speaks keys).

- `renderReactionBar(targetType, targetId, reactions)` → `html`` ` string: `role="group"`, one pill button per emoji (`aria-pressed`, `aria-label="React with …"`, count span; empty count hidden). 44px targets, `--radius-full`, `reaction-mine` = primary-faint fill + primary border. Count changes animate a tiny scale keyframe (skipped under reduced motion).
- `initReactionBars(root)`: ONE delegated click listener per page on a stable ancestor; `requireAccount(() => toggle(...))`.
- **Optimistic toggle**: flip `aria-pressed` + count immediately, `miniSparkle` on activate; then `POST /api/reactions/toggle` and **reconcile with the server's `{ active, counts }`** (handles double-tap races and other users' updates); on error, roll back to the prior state and `console.warn`.

## 4. `public/components/comment-thread.js`

- Collapsed by default everywhere: "N comments" toggle button (count from feed enrichment). First expand → GET, render ascending; composer at bottom gated by `requireAccount`.
- Own pending comments inline with the `status-pending` chip. Optimistic append on POST; rollback + inline error on failure. Delete button on own comments (confirm).
- Renders via `html`` ` (escaped), relative timestamps via `relative-time.js`.

## 5. Integration

- **Guestbook cards** (`feed.js`): reaction bar + comment toggle in the card footer (Phase 2 left a placeholder).
- **Lightbox panel** (`lightbox.js`): caption, reaction bar, comment thread in the desktop sidebar / mobile swipe-up drawer. Drawer handle shows the reaction bar + "View N comments" when collapsed.
- Both pages call `initReactionBars(document.body)` once.

## 6. Tests

Integration (`tests/integration/social.test.js`):
- Toggle on → `{active:true}` + row exists; toggle again → `{active:false}` + row gone; UNIQUE holds under a deliberate double-insert.
- Two parallel toggle requests (Promise.all) → final state consistent with the returned payloads (race reconciliation).
- Invalid emoji / target_type → 400. React/comment on a pending item you don't own → 404.
- Trusted comment instantly public; untrusted held, author-visible, approvable via moderation endpoint (extend `:type` allowlist with `comment` now).
- Comments on a hidden entry → GET 404s for public.
- Feed enrichment: counts + `mine` flags correct after refresh; comment_count matches.
- Rate limits: 31st toggle in a minute → 429.

Unit: validators; key→glyph map completeness vs `REACTION_EMOJI_VALUES`.

## 7. Acceptance criteria / demo

- Two accounts in two browsers reacting to the same entry: counts converge after refresh; double-tapping never double-counts.
- One-per-emoji enforced; untrusted comments held; sparkle on react (and none under reduced motion).
- All tests + tsc green.
