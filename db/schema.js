/** @file Database schema and migrations */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"

// Local 8-char token generator for the share-token backfill migration. Mirrors
// db/utils.js#generateInviteCode (same 62-char alphabet, same unbiased sampling)
// but is inlined here on purpose: schema.js must NOT import db/utils.js, which
// pulls in db/connection.js and would freeze its DB_PATH constant too early for
// the test harness's env-swapping (tests/integration/_thank-you-db-env.js).
const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

/** @returns {string} */
function generateShareToken() {
  const maxUnbiased = 248 // 248 = 62 * 4, largest multiple of 62 ≤ 256
  let code = ""
  const bytes = crypto.randomBytes(16)
  let byteIdx = 0
  while (code.length < 8) {
    if (byteIdx >= bytes.length) return generateShareToken()
    const b = bytes[byteIdx++]
    if (b < maxUnbiased) code += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]
  }
  return code
}

/** @type {Types.createTables} */
export function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.exec(`
    -- Whitelist of invited guests
    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      party_size INTEGER DEFAULT 1,
      invite_code TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_invited_at TEXT,
      deleted_at TEXT DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email);
    CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone);
    CREATE INDEX IF NOT EXISTS idx_guests_invite_code ON guests(invite_code);
    CREATE INDEX IF NOT EXISTS idx_guests_status ON guests(status);
    CREATE INDEX IF NOT EXISTS idx_guests_deleted_at ON guests(deleted_at);

    -- RSVP responses (one per guest, updates allowed via UPSERT)
    CREATE TABLE IF NOT EXISTS rsvps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id INTEGER UNIQUE NOT NULL,
      attending INTEGER NOT NULL CHECK(attending IN (0, 1)),
      actual_party_size INTEGER,
      dietary_restrictions TEXT,
      additional_info TEXT,
      message TEXT,
      submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE
    );

    -- Track sent invitations
    CREATE TABLE IF NOT EXISTS communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      message_preview TEXT,
      error_message TEXT,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_communications_guest_id ON communications(guest_id);
    CREATE INDEX IF NOT EXISTS idx_communications_status ON communications(status);
    CREATE INDEX IF NOT EXISTS idx_communications_guest_status ON communications(guest_id, status);

    -- Admin sessions
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      csrf_token TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP,
      csrf_rotated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    -- Blocklist for people who should not see petition option
    CREATE TABLE IF NOT EXISTS blocklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT,
      phone TEXT,
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      CHECK (name IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL)
    );

    CREATE INDEX IF NOT EXISTS idx_blocklist_email ON blocklist(email);
    CREATE INDEX IF NOT EXISTS idx_blocklist_phone ON blocklist(phone);

    -- Petitions from uninvited guests requesting an invitation
    CREATE TABLE IF NOT EXISTS petitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      relationship TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_petitions_status ON petitions(status);
    CREATE INDEX IF NOT EXISTS idx_petitions_email ON petitions(email);

    -- Rate limiting persistence
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT NOT NULL,
      limiter TEXT NOT NULL,
      count INTEGER DEFAULT 1,
      reset_at INTEGER NOT NULL,
      PRIMARY KEY (key, limiter)
    );

    CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);

    -- Guest accounts (passwordless; trusted = registered with a household invite code)
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id INTEGER,                       -- NULL for open (untrusted) registration
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,          -- normalizeName(name); enables re-login match
      relation TEXT,
      contact_email TEXT,                     -- optional; enables magic-link recovery (Phase 6)
      trusted INTEGER NOT NULL DEFAULT 0 CHECK(trusted IN (0, 1)),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT DEFAULT NULL,
      FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_guest_id ON accounts(guest_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_deleted_at ON accounts(deleted_at);
    -- One account per (household guest record, person name); allows re-login by code+name.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_guest_name
      ON accounts(guest_id, name_normalized)
      WHERE guest_id IS NOT NULL AND deleted_at IS NULL;

    -- Guest sessions (N concurrent per account, unlike the single-admin sessions table)
    CREATE TABLE IF NOT EXISTS account_sessions (
      token TEXT PRIMARY KEY,                 -- SHA256 hex of bearer token (hashToken())
      account_id INTEGER NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP,
      csrf_rotated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_account_sessions_account_id ON account_sessions(account_id);
    CREATE INDEX IF NOT EXISTS idx_account_sessions_expires_at ON account_sessions(expires_at);

    -- Generic KV state (used by the Phase 2 moderation digest, and future one-off state)
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Guestbook entries (hybrid moderation: trusted → approved, untrusted → pending)
    CREATE TABLE IF NOT EXISTS guestbook_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',        -- pending|approved|hidden|rejected
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      pinned_at TEXT DEFAULT NULL,                    -- admin "Favorites" pin timestamp (newest-pinned-first)
      deleted_at TEXT DEFAULT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    -- Serves admin/status-filtered lists. The public feed's OR-disjunction
    -- (approved OR own-pending) makes SQLite prefer the PK scan for keyset
    -- id DESC at this scale; don't expect this index in that query plan.
    CREATE INDEX IF NOT EXISTS idx_guestbook_feed
      ON guestbook_entries(status, id DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_guestbook_account ON guestbook_entries(account_id);
    -- NOTE: idx_guestbook_pinned (the "Favorites" partial index) is created by the
    -- add_guestbook_pinned migration, NOT here — createTables runs before
    -- runMigrations, and on a pre-existing DB the pinned_at column doesn't exist
    -- yet at this point (CREATE TABLE IF NOT EXISTS keeps the old shape).

    -- Media items (photos + short videos). file_key is the public/storage id;
    -- account_id NULL = admin/official upload. Rows stay 'uploading' until
    -- finalize, so nothing partial is ever publicly visible.
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_key TEXT UNIQUE NOT NULL,                 -- 32 lowercase hex, crypto.randomBytes(16)
      account_id INTEGER,                            -- NULL = admin/official upload
      kind TEXT NOT NULL,                            -- image|video
      section TEXT NOT NULL DEFAULT 'guest',         -- official|guest|content|honeymoon
      status TEXT NOT NULL DEFAULT 'uploading',      -- uploading|pending|approved|hidden|rejected
      caption TEXT,
      original_ext TEXT,                             -- derived from sniff: jpg|png|webp|heic|mp4|mov
      original_bytes INTEGER, display_bytes INTEGER, thumb_bytes INTEGER, poster_bytes INTEGER,
      w400_bytes INTEGER, w800_bytes INTEGER, w1600_bytes INTEGER, -- content-section responsive ladder (add_content_ladder migration back-fills existing DBs)
      width INTEGER, height INTEGER,
      duration_seconds REAL,                         -- video only
      needs_display INTEGER NOT NULL DEFAULT 0,      -- HEIC-decode fallback: original-only (no display/thumb)
      sort_order INTEGER NOT NULL DEFAULT 0,         -- per-section order: official|honeymoon
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      deleted_at TEXT DEFAULT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );

    -- Serves admin/status-filtered lists; the public feed's OR-disjunction picks
    -- the PK scan (fine for keyset id DESC at this scale) — same note as idx_guestbook_feed.
    CREATE INDEX IF NOT EXISTS idx_media_guest_feed
      ON media(section, status, id DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_media_official_order
      ON media(section, sort_order, id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_media_account ON media(account_id);

    -- Polymorphic comments on guestbook entries or media (target_type+target_id).
    -- Reuses CONTENT_STATUS moderation (pending|approved|hidden|rejected). SQLite
    -- can't do polymorphic FKs, so a BEFORE INSERT trigger (add_social_triggers)
    -- enforces target existence; handlers pre-check visibility so the trigger is
    -- a backstop only. See 00-overview reconciliation 2 + decision log.
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,                             -- NULL = host/couple reply (admin-authored)
      target_type TEXT NOT NULL,                     -- guestbook|media
      target_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',        -- pending|approved|hidden|rejected
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      deleted_at TEXT DEFAULT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_comments_target
      ON comments(target_type, target_id, status, id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_comments_account ON comments(account_id);

    -- Polymorphic emoji reactions. One per (account, target, emoji); toggle =
    -- INSERT ON CONFLICT DO NOTHING else DELETE (atomic, no transaction). No
    -- status/moderation and no updated_at — reactions are never held or edited.
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
  `)

  // Data integrity triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS check_guest_status_insert
    BEFORE INSERT ON guests
    FOR EACH ROW
    WHEN NEW.status NOT IN ('pending', 'invited', 'responded')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid guest status. Must be: pending, invited, or responded');
    END;

    CREATE TRIGGER IF NOT EXISTS check_guest_status_update
    BEFORE UPDATE ON guests
    FOR EACH ROW
    WHEN NEW.status NOT IN ('pending', 'invited', 'responded')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid guest status. Must be: pending, invited, or responded');
    END;

    CREATE TRIGGER IF NOT EXISTS check_guest_party_size_insert
    BEFORE INSERT ON guests
    FOR EACH ROW
    WHEN NEW.party_size < 1 OR NEW.party_size > 20
    BEGIN
      SELECT RAISE(ABORT, 'party_size must be between 1 and 20');
    END;

    CREATE TRIGGER IF NOT EXISTS check_guest_party_size_update
    BEFORE UPDATE ON guests
    FOR EACH ROW
    WHEN NEW.party_size < 1 OR NEW.party_size > 20
    BEGIN
      SELECT RAISE(ABORT, 'party_size must be between 1 and 20');
    END;

    CREATE TRIGGER IF NOT EXISTS check_petition_status_insert
    BEFORE INSERT ON petitions
    FOR EACH ROW
    WHEN NEW.status NOT IN ('pending', 'approved', 'denied')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid petition status. Must be: pending, approved, or denied');
    END;

    CREATE TRIGGER IF NOT EXISTS check_petition_status_update
    BEFORE UPDATE ON petitions
    FOR EACH ROW
    WHEN NEW.status NOT IN ('pending', 'approved', 'denied')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid petition status. Must be: pending, approved, or denied');
    END
  `)
}

/**
 * Run a table rebuild — SQLite's only way to change a column's nullability, its
 * type or its foreign keys — with the four safeguards this pattern needs. Every
 * one of them exists because omitting it fails SILENTLY.
 *
 * 1. `PRAGMA foreign_keys = OFF` **before** `BEGIN`. The pragma is a no-op
 *    inside an open transaction, so setting it after is the same as not setting
 *    it. Without it, `DROP TABLE parent` performs an implicit delete of every
 *    row and FIRES each child's `ON DELETE` action — `SET NULL` children are
 *    silently blanked, `CASCADE` children silently deleted, no error raised,
 *    and the migration records itself as applied. That damage is invisible on a
 *    fresh install (the tables are empty) and total on a populated one.
 * 2. **One transaction** around the whole rebuild, so a mid-rebuild throw cannot
 *    leave a half-built schema that the next boot re-enters against.
 * 3. **`PRAGMA foreign_key_check` before COMMIT, not after.** The check runs
 *    fine inside a transaction even with enforcement off, and running it there
 *    means a violation rolls the rebuild back whole. Checking after COMMIT
 *    would leave the new schema in place and the migration unrecorded — and the
 *    next boot, finding the rebuild already done, would skip straight past the
 *    alarm and record the migration as applied.
 * 4. **ROLLBACK first, pragma second** in the failure path. Restoring
 *    `foreign_keys = ON` while a transaction is still open is itself a no-op,
 *    which would leave this long-lived singleton connection running with
 *    foreign keys OFF for the rest of the process.
 *
 * `relax_comment_account_null` above predates this helper and has none of the
 * four (two bare `exec` calls, no transaction, no check). It is left as-is
 * because it has already run everywhere; it is not a shape to copy.
 *
 * The callback must do the CREATE `_new` / INSERT SELECT / DROP / RENAME and
 * recreate every index and trigger the DROP took with it. **Preserve `id` in
 * the copy** — with foreign keys off, nothing catches a child row left pointing
 * at a renumbered parent.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} label migration name, used in error messages
 * @param {() => void} rebuild runs inside the transaction, foreign keys already off
 */
function rebuildTable(db, label, rebuild) {
  db.exec("PRAGMA foreign_keys = OFF")
  let committed = false
  try {
    db.exec("BEGIN")
    rebuild()

    const violations = db.prepare("PRAGMA foreign_key_check").all()
    if (violations.length > 0) {
      throw new Error(
        `${label}: PRAGMA foreign_key_check reported ${violations.length} violation(s) — rolling the rebuild back`,
      )
    }

    db.exec("COMMIT")
    committed = true
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK")
      } catch {
        /* already rolled back */
      }
    }
    db.exec("PRAGMA foreign_keys = ON")
  }
}

/** @type {Types.runMigrations} */
export function runMigrations(db) {
  const applied = db.prepare("SELECT 1 FROM migrations WHERE name = ?")
  const record = db.prepare("INSERT INTO migrations (name) VALUES (?)")

  // Add CHECK constraints on communications type and status
  if (!applied.get("add_communications_check_triggers")) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS check_communication_type_insert
      BEFORE INSERT ON communications
      FOR EACH ROW
      WHEN NEW.type NOT IN ('email', 'sms')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid communication type. Must be: email or sms');
      END;

      CREATE TRIGGER IF NOT EXISTS check_communication_type_update
      BEFORE UPDATE ON communications
      FOR EACH ROW
      WHEN NEW.type NOT IN ('email', 'sms')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid communication type. Must be: email or sms');
      END;

      CREATE TRIGGER IF NOT EXISTS check_communication_status_insert
      BEFORE INSERT ON communications
      FOR EACH ROW
      WHEN NEW.status NOT IN ('sent', 'failed')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid communication status. Must be: sent or failed');
      END;

      CREATE TRIGGER IF NOT EXISTS check_communication_status_update
      BEFORE UPDATE ON communications
      FOR EACH ROW
      WHEN NEW.status NOT IN ('sent', 'failed')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid communication status. Must be: sent or failed');
      END
    `)
    record.run("add_communications_check_triggers")
  }

  // Add updated_at auto-triggers
  if (!applied.get("add_updated_at_triggers")) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS auto_updated_at_guests
      AFTER UPDATE ON guests
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE guests SET updated_at = datetime('now') WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS auto_updated_at_rsvps
      AFTER UPDATE ON rsvps
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE rsvps SET updated_at = datetime('now') WHERE id = NEW.id;
      END
    `)
    record.run("add_updated_at_triggers")
  }

  // Guest accounts: updated_at auto-trigger
  if (!applied.get("add_account_triggers")) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS auto_updated_at_accounts
      AFTER UPDATE ON accounts
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE accounts SET updated_at = datetime('now') WHERE id = NEW.id;
      END
    `)
    record.run("add_account_triggers")
  }

  // Guestbook entries: status-enum CHECK triggers + updated_at auto-trigger.
  if (!applied.get("add_guestbook_triggers")) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS check_guestbook_status_insert
      BEFORE INSERT ON guestbook_entries
      FOR EACH ROW
      WHEN NEW.status NOT IN ('pending', 'approved', 'hidden', 'rejected')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid guestbook status. Must be: pending, approved, hidden, or rejected');
      END;

      CREATE TRIGGER IF NOT EXISTS check_guestbook_status_update
      BEFORE UPDATE ON guestbook_entries
      FOR EACH ROW
      WHEN NEW.status NOT IN ('pending', 'approved', 'hidden', 'rejected')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid guestbook status. Must be: pending, approved, hidden, or rejected');
      END;

      CREATE TRIGGER IF NOT EXISTS auto_updated_at_guestbook_entries
      AFTER UPDATE ON guestbook_entries
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE guestbook_entries SET updated_at = datetime('now') WHERE id = NEW.id;
      END
    `)
    record.run("add_guestbook_triggers")
  }

  // Media: status/kind/section enum CHECK triggers + updated_at auto-trigger.
  if (!applied.get("add_media_triggers")) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS check_media_status_insert
      BEFORE INSERT ON media
      FOR EACH ROW
      WHEN NEW.status NOT IN ('uploading', 'pending', 'approved', 'hidden', 'rejected')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid media status. Must be: uploading, pending, approved, hidden, or rejected');
      END;

      CREATE TRIGGER IF NOT EXISTS check_media_status_update
      BEFORE UPDATE ON media
      FOR EACH ROW
      WHEN NEW.status NOT IN ('uploading', 'pending', 'approved', 'hidden', 'rejected')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid media status. Must be: uploading, pending, approved, hidden, or rejected');
      END;

      CREATE TRIGGER IF NOT EXISTS check_media_kind_insert
      BEFORE INSERT ON media
      FOR EACH ROW
      WHEN NEW.kind NOT IN ('image', 'video')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid media kind. Must be: image or video');
      END;

      CREATE TRIGGER IF NOT EXISTS check_media_kind_update
      BEFORE UPDATE ON media
      FOR EACH ROW
      WHEN NEW.kind NOT IN ('image', 'video')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid media kind. Must be: image or video');
      END;

      CREATE TRIGGER IF NOT EXISTS check_media_section_insert
      BEFORE INSERT ON media
      FOR EACH ROW
      WHEN NEW.section NOT IN ('official', 'guest', 'content')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid media section. Must be: official, guest, or content');
      END;

      CREATE TRIGGER IF NOT EXISTS check_media_section_update
      BEFORE UPDATE ON media
      FOR EACH ROW
      WHEN NEW.section NOT IN ('official', 'guest', 'content')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid media section. Must be: official, guest, or content');
      END;

      CREATE TRIGGER IF NOT EXISTS auto_updated_at_media
      AFTER UPDATE ON media
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE media SET updated_at = datetime('now') WHERE id = NEW.id;
      END
    `)
    record.run("add_media_triggers")
  }

  // Social (comments + reactions): comment status-enum CHECK triggers, a
  // polymorphic-FK substitute (BEFORE INSERT target-existence check) for both
  // tables, and the comment updated_at auto-trigger. Reactions have no status
  // or updated_at column, so they get only the existence trigger.
  //
  // Known quirk (accepted): `INSERT … ON CONFLICT DO NOTHING` still fires the
  // BEFORE INSERT trigger, so un-reacting to a since-soft-deleted target aborts
  // here — the reaction handler's visibility pre-check turns that into a 404
  // anyway, and orphaned reaction rows on deleted targets are harmless at this
  // scale (nothing cascades on target soft-delete; no cleanup machinery).
  if (!applied.get("add_social_triggers")) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS check_comment_status_insert
      BEFORE INSERT ON comments
      FOR EACH ROW
      WHEN NEW.status NOT IN ('pending', 'approved', 'hidden', 'rejected')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid comment status. Must be: pending, approved, hidden, or rejected');
      END;

      CREATE TRIGGER IF NOT EXISTS check_comment_status_update
      BEFORE UPDATE ON comments
      FOR EACH ROW
      WHEN NEW.status NOT IN ('pending', 'approved', 'hidden', 'rejected')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid comment status. Must be: pending, approved, hidden, or rejected');
      END;

      CREATE TRIGGER IF NOT EXISTS check_comment_target_exists
      BEFORE INSERT ON comments
      FOR EACH ROW
      WHEN (NEW.target_type = 'guestbook'
              AND NOT EXISTS (SELECT 1 FROM guestbook_entries WHERE id = NEW.target_id AND deleted_at IS NULL))
        OR (NEW.target_type = 'media'
              AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.target_id AND deleted_at IS NULL))
      BEGIN
        SELECT RAISE(ABORT, 'Comment target does not exist');
      END;

      CREATE TRIGGER IF NOT EXISTS check_reaction_target_exists
      BEFORE INSERT ON reactions
      FOR EACH ROW
      WHEN (NEW.target_type = 'guestbook'
              AND NOT EXISTS (SELECT 1 FROM guestbook_entries WHERE id = NEW.target_id AND deleted_at IS NULL))
        OR (NEW.target_type = 'media'
              AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.target_id AND deleted_at IS NULL))
      BEGIN
        SELECT RAISE(ABORT, 'Reaction target does not exist');
      END;

      CREATE TRIGGER IF NOT EXISTS auto_updated_at_comments
      AFTER UPDATE ON comments
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE comments SET updated_at = datetime('now') WHERE id = NEW.id;
      END
    `)
    record.run("add_social_triggers")
  }

  // Account recovery (Phase 6): single-use, time-limited magic-link tokens for
  // untrusted accounts that supplied a contact_email. Only the SHA-256 hash is
  // stored (hashToken pattern); the plaintext lives only in the emailed link.
  // used_at marks a spent token (single-use); expiry is checked at consume time.
  if (!applied.get("add_account_recovery")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_recovery_tokens (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_account_recovery_account ON account_recovery_tokens(account_id);
    `)
    record.run("add_account_recovery")
  }

  // Content-section responsive image ladder (Track 1b): the per-variant byte
  // columns for w400/w800/w1600, and the widened section-enum CHECK triggers that
  // admit the new 'content' section (site-content images, e.g. dress-code figures,
  // that are servable by file_key but excluded from every gallery feed).
  if (!applied.get("add_content_ladder")) {
    // Columns are declared in the base CREATE TABLE for fresh installs; ALTER
    // them into pre-existing DBs. Guard each add so a fresh DB (already has them)
    // doesn't raise "duplicate column name". Names are constant literals.
    const have = new Set(
      /** @type {Array<{ name: string }>} */ (
        db.prepare("PRAGMA table_info(media)").all()
      ).map((c) => c.name),
    )
    for (const col of ["w400_bytes", "w800_bytes", "w1600_bytes"]) {
      if (!have.has(col)) db.exec(`ALTER TABLE media ADD COLUMN ${col} INTEGER`)
    }

    db.exec(`
      DROP TRIGGER IF EXISTS check_media_section_insert;
      DROP TRIGGER IF EXISTS check_media_section_update;

      CREATE TRIGGER check_media_section_insert
      BEFORE INSERT ON media
      FOR EACH ROW
      WHEN NEW.section NOT IN ('official', 'guest', 'content')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid media section. Must be: official, guest, or content');
      END;

      CREATE TRIGGER check_media_section_update
      BEFORE UPDATE ON media
      FOR EACH ROW
      WHEN NEW.section NOT IN ('official', 'guest', 'content')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid media section. Must be: official, guest, or content');
      END;
    `)
    record.run("add_content_ladder")
  }

  // RSVP "Anything else we need to know?" free-text field. Declared in the base
  // CREATE TABLE for fresh installs; ALTER it into pre-existing DBs. Guard the add
  // so a fresh DB (already has it) doesn't raise "duplicate column name".
  if (!applied.get("add_rsvp_additional_info")) {
    const have = new Set(
      /** @type {Array<{ name: string }>} */ (
        db.prepare("PRAGMA table_info(rsvps)").all()
      ).map((c) => c.name),
    )
    if (!have.has("additional_info")) {
      db.exec(`ALTER TABLE rsvps ADD COLUMN additional_info TEXT`)
    }
    record.run("add_rsvp_additional_info")
  }

  // Digital thank-you cards (honey-fund gratitude feature, Phase 1): a gift log
  // (giver, optional admin-only amount, physical-card tracking) and the cards
  // themselves (token magic-link auth, message/theme/effects/media, delivery +
  // view tracking, recipient reply). Reply is plain columns (reply_emoji /
  // reply_message / replied_at), NOT the polymorphic `reactions` table — the
  // recipient authenticates by token and may have no account. `reply_seen_at`
  // tracks admin having seen the reply (unread badge/digest gate), separate
  // from the guest-facing `viewed_at` (first card open).
  if (!applied.get("add_thank_you_cards")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS gifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_id INTEGER NOT NULL,                 -- giver
        description TEXT,                          -- what they gave
        amount TEXT,                                -- optional, admin-only, NEVER on the card
        notes TEXT,
        received_at TEXT,
        physical_card_sent INTEGER NOT NULL DEFAULT 0 CHECK(physical_card_sent IN (0, 1)),
        physical_card_sent_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_gifts_guest ON gifts(guest_id);
      CREATE INDEX IF NOT EXISTS idx_gifts_deleted_at ON gifts(deleted_at);

      CREATE TABLE IF NOT EXISTS thank_you_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,                -- 8-char generateInviteCode()
        guest_id INTEGER NOT NULL,                 -- recipient
        gift_id INTEGER,                           -- optional link
        message TEXT NOT NULL,
        theme TEXT NOT NULL DEFAULT 'classic',
        effects_config TEXT,                        -- JSON (opaque to backend), size-capped at write time
        media_keys TEXT,                             -- JSON array of media file_keys
        status TEXT NOT NULL DEFAULT 'draft',       -- draft|sent|viewed
        sent_via TEXT,                               -- email|sms|manual|link
        sent_at TEXT,
        viewed_at TEXT,
        reply_emoji TEXT,                            -- one REACTION_EMOJI key
        reply_message TEXT,
        replied_at TEXT,
        reply_seen_at TEXT,                          -- admin has seen the reply
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE,
        FOREIGN KEY (gift_id) REFERENCES gifts(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tyc_guest ON thank_you_cards(guest_id) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_tyc_status ON thank_you_cards(status) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_tyc_gift ON thank_you_cards(gift_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tyc_token ON thank_you_cards(token);
    `)

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS check_tyc_status_insert
      BEFORE INSERT ON thank_you_cards
      FOR EACH ROW
      WHEN NEW.status NOT IN ('draft', 'sent', 'viewed')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid card status. Must be: draft, sent, or viewed');
      END;

      CREATE TRIGGER IF NOT EXISTS check_tyc_status_update
      BEFORE UPDATE ON thank_you_cards
      FOR EACH ROW
      WHEN NEW.status NOT IN ('draft', 'sent', 'viewed')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid card status. Must be: draft, sent, or viewed');
      END;

      CREATE TRIGGER IF NOT EXISTS check_tyc_sent_via_insert
      BEFORE INSERT ON thank_you_cards
      FOR EACH ROW
      WHEN NEW.sent_via IS NOT NULL AND NEW.sent_via NOT IN ('email', 'sms', 'manual', 'link')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid sent_via. Must be: email, sms, manual, or link');
      END;

      CREATE TRIGGER IF NOT EXISTS check_tyc_sent_via_update
      BEFORE UPDATE ON thank_you_cards
      FOR EACH ROW
      WHEN NEW.sent_via IS NOT NULL AND NEW.sent_via NOT IN ('email', 'sms', 'manual', 'link')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid sent_via. Must be: email, sms, manual, or link');
      END;

      CREATE TRIGGER IF NOT EXISTS check_tyc_reply_emoji_insert
      BEFORE INSERT ON thank_you_cards
      FOR EACH ROW
      WHEN NEW.reply_emoji IS NOT NULL AND NEW.reply_emoji NOT IN ('heart', 'clap', 'laugh', 'heart_eyes', 'cheers', 'fire')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid reply emoji');
      END;

      CREATE TRIGGER IF NOT EXISTS check_tyc_reply_emoji_update
      BEFORE UPDATE ON thank_you_cards
      FOR EACH ROW
      WHEN NEW.reply_emoji IS NOT NULL AND NEW.reply_emoji NOT IN ('heart', 'clap', 'laugh', 'heart_eyes', 'cheers', 'fire')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid reply emoji');
      END;

      CREATE TRIGGER IF NOT EXISTS auto_updated_at_gifts
      AFTER UPDATE ON gifts
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE gifts SET updated_at = datetime('now') WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS auto_updated_at_thank_you_cards
      AFTER UPDATE ON thank_you_cards
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE thank_you_cards SET updated_at = datetime('now') WHERE id = NEW.id;
      END
    `)
    record.run("add_thank_you_cards")
  }

  // Thank-you engagement upgrades (Track B): per-card view tracking
  // (view_count / last_viewed_at, stamped by the envelope-open beacon), an
  // append-only reply-history table (the card keeps latest-reply columns for
  // badge/digest compatibility; this table is the full thread), a partial
  // index for the unread-reply badge hot path, and dropping the redundant
  // token index (the column's inline UNIQUE already covers it).
  if (!applied.get("add_thank_you_engagement")) {
    // Columns are ALTERed into existing DBs (the base CREATE TABLE lives in the
    // add_thank_you_cards block, which is frozen). Guard each add so a re-run or
    // a manually-patched DB doesn't raise "duplicate column name".
    const have = new Set(
      /** @type {Array<{ name: string }>} */ (
        db.prepare("PRAGMA table_info(thank_you_cards)").all()
      ).map((c) => c.name),
    )
    if (!have.has("view_count")) {
      db.exec(`ALTER TABLE thank_you_cards ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`)
    }
    if (!have.has("last_viewed_at")) {
      db.exec(`ALTER TABLE thank_you_cards ADD COLUMN last_viewed_at TEXT`)
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS thank_you_card_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER NOT NULL,
        emoji TEXT,                                  -- one REACTION_EMOJI key or NULL
        message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (card_id) REFERENCES thank_you_cards(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tycr_card ON thank_you_card_replies(card_id);

      CREATE TRIGGER IF NOT EXISTS check_tycr_emoji_insert
      BEFORE INSERT ON thank_you_card_replies
      FOR EACH ROW
      WHEN NEW.emoji IS NOT NULL AND NEW.emoji NOT IN ('heart', 'clap', 'laugh', 'heart_eyes', 'cheers', 'fire')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid reply emoji');
      END;

      CREATE INDEX IF NOT EXISTS idx_tyc_unread ON thank_you_cards(replied_at)
        WHERE reply_seen_at IS NULL AND deleted_at IS NULL;

      DROP INDEX IF EXISTS idx_tyc_token;
    `)
    record.run("add_thank_you_engagement")
  }

  // Read-only public share token for thank-you cards (Track B, Phase 2): an
  // 8-char alnum credential (same generator as the primary `token`) that resolves
  // the card for a NON-reply viewer — the recipient can forward it without also
  // exposing their reply-capable primary token. Distinct UNIQUE column; the
  // public GET resolves by primary OR share token, but the open-beacon and reply
  // endpoints match the primary token column only (a share token 404s there).
  if (!applied.get("add_thank_you_share_token")) {
    // Column is ALTERed into every DB (the base CREATE TABLE lives in the frozen
    // add_thank_you_cards block). Guard the add so a re-run doesn't raise
    // "duplicate column name".
    const have = new Set(
      /** @type {Array<{ name: string }>} */ (
        db.prepare("PRAGMA table_info(thank_you_cards)").all()
      ).map((c) => c.name),
    )
    if (!have.has("share_token")) {
      db.exec(`ALTER TABLE thank_you_cards ADD COLUMN share_token TEXT`)
    }

    // Backfill every existing row with a unique share token before the UNIQUE
    // index goes on. Uniqueness is checked against the running set (empty on a
    // fresh column) so a re-run over a partially-backfilled DB stays consistent.
    const used = new Set(
      /** @type {Array<{ share_token: string | null }>} */ (
        db.prepare("SELECT share_token FROM thank_you_cards WHERE share_token IS NOT NULL").all()
      ).map((r) => r.share_token),
    )
    const pending = /** @type {Array<{ id: number }>} */ (
      db.prepare("SELECT id FROM thank_you_cards WHERE share_token IS NULL").all()
    )
    const setShare = db.prepare("UPDATE thank_you_cards SET share_token = ? WHERE id = ?")
    for (const row of pending) {
      let code = generateShareToken()
      while (used.has(code)) code = generateShareToken()
      used.add(code)
      setShare.run(code, row.id)
    }

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tyc_share_token ON thank_you_cards(share_token);
    `)
    record.run("add_thank_you_share_token")
  }

  // Guestbook "Favorites" pin column (Wow pack, Feature 2). Declared in the base
  // CREATE TABLE for fresh installs; ALTER it into pre-existing DBs (+ its partial
  // index). Guard the add so a fresh DB (already has it) doesn't raise
  // "duplicate column name".
  if (!applied.get("add_guestbook_pinned")) {
    const have = new Set(
      /** @type {Array<{ name: string }>} */ (
        db.prepare("PRAGMA table_info(guestbook_entries)").all()
      ).map((c) => c.name),
    )
    if (!have.has("pinned_at")) {
      db.exec(`ALTER TABLE guestbook_entries ADD COLUMN pinned_at TEXT DEFAULT NULL`)
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_guestbook_pinned
        ON guestbook_entries(pinned_at DESC) WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;
    `)
    record.run("add_guestbook_pinned")
  }

  // Host/couple replies (Wow pack, Feature 1) are comments with account_id NULL,
  // mirroring media's admin uploads. comments.account_id shipped NOT NULL, and
  // SQLite can't ALTER a column's nullability, so rebuild the table when the
  // constraint is still present. The comment triggers + indexes are dropped with
  // the old table and recreated here (add_social_triggers already ran and won't
  // re-fire). FK enforcement is bracketed off around the rebuild.
  if (!applied.get("relax_comment_account_null")) {
    const cols = /** @type {Array<{ name: string, notnull: number }>} */ (
      db.prepare("PRAGMA table_info(comments)").all()
    )
    const accountCol = cols.find((c) => c.name === "account_id")
    if (accountCol && accountCol.notnull === 1) {
      db.exec("PRAGMA foreign_keys=OFF")
      db.exec(`
        CREATE TABLE comments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER,
          target_type TEXT NOT NULL,
          target_id INTEGER NOT NULL,
          message TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT,
          deleted_at TEXT DEFAULT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );
        INSERT INTO comments_new
          (id, account_id, target_type, target_id, message, status,
           created_at, updated_at, reviewed_at, deleted_at)
          SELECT id, account_id, target_type, target_id, message, status,
           created_at, updated_at, reviewed_at, deleted_at FROM comments;
        DROP TABLE comments;
        ALTER TABLE comments_new RENAME TO comments;

        CREATE INDEX IF NOT EXISTS idx_comments_target
          ON comments(target_type, target_id, status, id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_comments_account ON comments(account_id);

        CREATE TRIGGER IF NOT EXISTS check_comment_status_insert
        BEFORE INSERT ON comments
        FOR EACH ROW
        WHEN NEW.status NOT IN ('pending', 'approved', 'hidden', 'rejected')
        BEGIN
          SELECT RAISE(ABORT, 'Invalid comment status. Must be: pending, approved, hidden, or rejected');
        END;

        CREATE TRIGGER IF NOT EXISTS check_comment_status_update
        BEFORE UPDATE ON comments
        FOR EACH ROW
        WHEN NEW.status NOT IN ('pending', 'approved', 'hidden', 'rejected')
        BEGIN
          SELECT RAISE(ABORT, 'Invalid comment status. Must be: pending, approved, hidden, or rejected');
        END;

        CREATE TRIGGER IF NOT EXISTS check_comment_target_exists
        BEFORE INSERT ON comments
        FOR EACH ROW
        WHEN (NEW.target_type = 'guestbook'
                AND NOT EXISTS (SELECT 1 FROM guestbook_entries WHERE id = NEW.target_id AND deleted_at IS NULL))
          OR (NEW.target_type = 'media'
                AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.target_id AND deleted_at IS NULL))
        BEGIN
          SELECT RAISE(ABORT, 'Comment target does not exist');
        END;

        CREATE TRIGGER IF NOT EXISTS auto_updated_at_comments
        AFTER UPDATE ON comments
        FOR EACH ROW
        WHEN NEW.updated_at = OLD.updated_at
        BEGIN
          UPDATE comments SET updated_at = datetime('now') WHERE id = NEW.id;
        END;
      `)
      db.exec("PRAGMA foreign_keys=ON")
    }
    record.run("relax_comment_account_null")
  }

  // Face pipeline (design doc: docs/post-wedding/SPEC-vision-lab.md §10):
  // media_faces (one row per detected face, CLI or upload-time source) and
  // face_identities (a confirmed link from a face-recognition group to a
  // roster guest). Two new columns ride along on `media`: source_sha256 (the
  // content hash the bulk importer already computes — see
  // scripts/lib/import-manifest.js — as the durable key a batch run can
  // reconcile against when it doesn't yet know a row's media_id) and
  // captured_at (EXIF capture time; core/image-meta.js readExifSummary and
  // scripts/lib/media-variants.js:265 already compute/thread this value but
  // nothing writes it yet — that importer wiring is a separate task).
  //
  // Design decisions recorded here because they're easy to get backwards:
  //
  // - face_identities.guest_id is NOT NULL. An identity IS the confirmed link
  //   to a roster guest — that's what "confirmed" means in this schema. A
  //   face-recognition *group* that hasn't been assigned to anyone yet is a
  //   grouping-stage concept (§7/§9) with no row here at all; nothing needs an
  //   identities row to exist before a human names it.
  // - provenance distinguishes a human-confirmed link ('confirmed') from one
  //   propagated automatically from a confirmed identity onto other faces the
  //   grouper judged similar ('propagated', §9's assignment-consistency loop).
  //   Propagated identities are second-class: never treat one as ground truth
  //   for anything downstream, and NEVER let a 'propagated' identity's faces
  //   seed a recognition prototype — that is exactly the feedback loop (an
  //   unreviewed guess reinforcing itself) the confirmed/propagated split
  //   exists to block.
  // - The CLI pass is authoritative over upload-time detection (§10, §11): a
  //   newer/better-thresholded CLI run must never coexist with stale
  //   upload-time boxes for the same photo. Two AFTER INSERT triggers cover
  //   both arrival orders (upload-then-cli and cli-then-upload) — see below.
  if (!applied.get("add_media_faces")) {
    const haveMediaCols = new Set(
      /** @type {Array<{ name: string }>} */ (
        db.prepare("PRAGMA table_info(media)").all()
      ).map((c) => c.name),
    )
    if (!haveMediaCols.has("source_sha256")) {
      db.exec(`ALTER TABLE media ADD COLUMN source_sha256 TEXT`)
    }
    if (!haveMediaCols.has("captured_at")) {
      db.exec(`ALTER TABLE media ADD COLUMN captured_at TEXT`)
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_media_source_sha256 ON media(source_sha256);

      -- One confirmed (or auto-propagated) link from a face-recognition group
      -- to a roster guest. guest_id is NOT NULL: an identity IS the confirmed
      -- link, not a placeholder that precedes one (see comment above).
      CREATE TABLE IF NOT EXISTS face_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_id INTEGER NOT NULL,
        confirmed_by TEXT,
        confirmed_at TEXT,
        provenance TEXT NOT NULL DEFAULT 'confirmed',   -- confirmed|propagated
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_face_identities_guest
        ON face_identities(guest_id) WHERE deleted_at IS NULL;

      -- One detected face. bbox/landmarks/gate signals are hints until a human
      -- (or the CLI's own high-confidence pass) says otherwise; descriptor is
      -- nullable because detection-only rows exist (a box with nothing
      -- recognisable, or recognition simply not run yet). The nine signal_
      -- columns are exactly gateSignals()'s output shape (public/vision/gate.js)
      -- so a row can be re-graded against new cutoffs without re-running
      -- detection.
      CREATE TABLE IF NOT EXISTS media_faces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id INTEGER NOT NULL,
        bbox_x REAL NOT NULL,
        bbox_y REAL NOT NULL,
        bbox_w REAL NOT NULL,
        bbox_h REAL NOT NULL,
        landmarks TEXT,                        -- JSON array of 10 numbers (5 x,y pairs), nullable
        signal_score REAL,
        signal_boxPx REAL,
        signal_borderPx REAL,
        signal_eyeRatio REAL,
        signal_eyeAngle REAL,
        signal_alignScale REAL,
        signal_residual REAL,
        signal_outsideFraction REAL,
        signal_sharpness REAL,
        descriptor BLOB,                       -- nullable: detection-only rows exist
        model_version TEXT NOT NULL,
        source TEXT NOT NULL,                  -- cli|upload (§10 precedence below)
        face_identity_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
        FOREIGN KEY (face_identity_id) REFERENCES face_identities(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_media_faces_media
        ON media_faces(media_id) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_media_faces_identity
        ON media_faces(face_identity_id) WHERE deleted_at IS NULL;
    `)

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS check_media_faces_source_insert
      BEFORE INSERT ON media_faces
      FOR EACH ROW
      WHEN NEW.source NOT IN ('cli', 'upload')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid face source. Must be: cli or upload');
      END;

      CREATE TRIGGER IF NOT EXISTS check_media_faces_source_update
      BEFORE UPDATE ON media_faces
      FOR EACH ROW
      WHEN NEW.source NOT IN ('cli', 'upload')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid face source. Must be: cli or upload');
      END;

      CREATE TRIGGER IF NOT EXISTS check_face_identities_provenance_insert
      BEFORE INSERT ON face_identities
      FOR EACH ROW
      WHEN NEW.provenance NOT IN ('confirmed', 'propagated')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid identity provenance. Must be: confirmed or propagated');
      END;

      CREATE TRIGGER IF NOT EXISTS check_face_identities_provenance_update
      BEFORE UPDATE ON face_identities
      FOR EACH ROW
      WHEN NEW.provenance NOT IN ('confirmed', 'propagated')
      BEGIN
        SELECT RAISE(ABORT, 'Invalid identity provenance. Must be: confirmed or propagated');
      END;

      CREATE TRIGGER IF NOT EXISTS auto_updated_at_media_faces
      AFTER UPDATE ON media_faces
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE media_faces SET updated_at = datetime('now') WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS auto_updated_at_face_identities
      AFTER UPDATE ON face_identities
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE face_identities SET updated_at = datetime('now') WHERE id = NEW.id;
      END;

      -- §10 precedence rule, direction 1: a CLI row lands after upload-time
      -- hints already exist for this photo — the CLI is authoritative, so
      -- retire (soft-delete) every live upload-sourced row for the same
      -- media_id. Scoped to source='upload' so multiple CLI re-runs (a
      -- reprocessed photo) never touch each other's rows.
      CREATE TRIGGER IF NOT EXISTS media_faces_cli_supersedes_upload
      AFTER INSERT ON media_faces
      FOR EACH ROW
      WHEN NEW.source = 'cli' AND NEW.deleted_at IS NULL
      BEGIN
        UPDATE media_faces
        SET deleted_at = datetime('now')
        WHERE media_id = NEW.media_id
          AND source = 'upload'
          AND deleted_at IS NULL;
      END;

      -- §10 precedence rule, direction 2: an upload-time hint arrives for a
      -- photo the CLI has already processed (e.g. a late opportunistic
      -- detection race, or a re-upload of an already-imported photo) — it is
      -- born superseded rather than sitting alongside the authoritative CLI
      -- rows until the next CLI pass happens to clean it up.
      CREATE TRIGGER IF NOT EXISTS media_faces_upload_superseded_by_cli
      AFTER INSERT ON media_faces
      FOR EACH ROW
      WHEN NEW.source = 'upload' AND NEW.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM media_faces
          WHERE media_id = NEW.media_id AND source = 'cli' AND deleted_at IS NULL
        )
      BEGIN
        UPDATE media_faces SET deleted_at = datetime('now') WHERE id = NEW.id;
      END;
    `)
    record.run("add_media_faces")
  }

  // The people table (docs/post-wedding/SPEC-vision-lab.md §10 amendment): the
  // photographed CAST, not the invitation roster. `guests` rows are invitations
  // — one row per party — and many people in the photographs are not on it
  // (partners recorded under someone else's row, children, the photographer,
  // vendors). face_identities therefore re-keys from guest_id to a NOT NULL
  // person_id; people.guest_id is the optional link back to the roster.
  //
  // ⚠ MIGRATION SHAPE IS LOAD-BEARING. face_identities must be REBUILT (SQLite
  // cannot add a NOT NULL column without a default, and the departing guest_id
  // carries an FK and a partial index), and under this codebase's connection
  // setup (db/connection.js turns foreign_keys ON before migrations run) a
  // plain `DROP TABLE face_identities` performs an implicit delete of every
  // row and FIRES media_faces' `ON DELETE SET NULL` — silently nulling every
  // face assignment in the database, with no error, and only on a database
  // that actually has assignments (i.e. production, not a fresh install).
  // `rebuildTable` above owns that hazard and the three others that travel with
  // it; read its comment before touching this. The one safeguard it CANNOT own
  // is preserving `id` in the copy — see the INSERT ... SELECT below.
  //
  // Existing rows are MIGRATED, never refused (a refusing migration stops the
  // server booting): one person per distinct guest_id, display name taken from
  // the guest's name, guest_id preserved as the link. Duplicate live
  // (guest_id, provenance) identities — legal under the old schema, where
  // first-match behaviour depended on row order — are consolidated onto the
  // lowest id in the same pass, so the new partial UNIQUE index
  // (person_id, provenance) WHERE deleted_at IS NULL can go on.
  if (!applied.get("add_people")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        display_name TEXT NOT NULL,
        guest_id INTEGER,                       -- NULL = not on the roster
        created_by TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_people_guest
        ON people(guest_id) WHERE deleted_at IS NULL;

      CREATE TRIGGER IF NOT EXISTS auto_updated_at_people
      AFTER UPDATE ON people
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE people SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
    `)

    const fiCols = new Set(
      /** @type {Array<{ name: string }>} */ (
        db.prepare("PRAGMA table_info(face_identities)").all()
      ).map((c) => c.name),
    )
    if (!fiCols.has("person_id")) {
      rebuildTable(db, "add_people", () => {
        // One person per distinct guest the old identities reference.
        // guest_id was NOT NULL, so there is no null-guest case to handle.
        db.exec(`
          INSERT INTO people (display_name, guest_id)
          SELECT g.name, g.id FROM guests g
          WHERE g.id IN (SELECT DISTINCT guest_id FROM face_identities)
          ORDER BY g.id
        `)

        // Consolidate duplicate live (guest_id, provenance) identities onto
        // the lowest id: re-point their faces, then soft-delete the extras so
        // the partial unique index below can be created. Ids are never reused
        // for a different guest, so downstream references stay truthful.
        const dupes = /** @type {Array<{ guest_id: number, provenance: string, keeper: number }>} */ (
          db
            .prepare(
              `SELECT guest_id, provenance, MIN(id) AS keeper
               FROM face_identities WHERE deleted_at IS NULL
               GROUP BY guest_id, provenance HAVING COUNT(*) > 1`,
            )
            .all()
        )
        for (const dupe of dupes) {
          db.prepare(
            `UPDATE media_faces SET face_identity_id = ?
             WHERE face_identity_id IN (
               SELECT id FROM face_identities
               WHERE guest_id = ? AND provenance = ? AND deleted_at IS NULL AND id != ?
             )`,
          ).run(dupe.keeper, dupe.guest_id, dupe.provenance, dupe.keeper)
          db.prepare(
            `UPDATE face_identities SET deleted_at = datetime('now')
             WHERE guest_id = ? AND provenance = ? AND deleted_at IS NULL AND id != ?`,
          ).run(dupe.guest_id, dupe.provenance, dupe.keeper)
        }

        db.exec(`
          CREATE TABLE face_identities_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER NOT NULL,
            confirmed_by TEXT,
            confirmed_at TEXT,
            provenance TEXT NOT NULL DEFAULT 'confirmed',   -- confirmed|propagated
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT DEFAULT NULL,
            FOREIGN KEY (person_id) REFERENCES people(id)
          );

          INSERT INTO face_identities_new
            (id, person_id, confirmed_by, confirmed_at, provenance,
             created_at, updated_at, deleted_at)
            -- fi.id is carried across DELIBERATELY. Renumbering here would
            -- leave every media_faces.face_identity_id pointing at a different
            -- person's identity, and with foreign keys off for the rebuild
            -- nothing would catch it.
            SELECT fi.id, p.id, fi.confirmed_by, fi.confirmed_at, fi.provenance,
                   fi.created_at, fi.updated_at, fi.deleted_at
            FROM face_identities fi
            JOIN people p ON p.guest_id = fi.guest_id;
        `)

        // The JOIN above silently drops an identity whose guest row vanished.
        // Foreign keys have been ON since the table's creation, so that state
        // is genuine referential corruption — fail loud rather than quietly
        // orphaning someone's confirmations.
        const oldCount = /** @type {{ n: number }} */ (
          db.prepare("SELECT COUNT(*) AS n FROM face_identities").get()
        ).n
        const newCount = /** @type {{ n: number }} */ (
          db.prepare("SELECT COUNT(*) AS n FROM face_identities_new").get()
        ).n
        if (newCount !== oldCount) {
          throw new Error(
            `add_people: face_identities rebuild would drop ${oldCount - newCount} row(s) ` +
              `whose guest_id has no guests row — refusing to migrate a corrupt database`,
          )
        }

        db.exec(`
          DROP TABLE face_identities;
          ALTER TABLE face_identities_new RENAME TO face_identities;

          -- Recreated because DROP TABLE took the old ones with it. The index
          -- is REDEFINED over person_id and made UNIQUE: code takes the FIRST
          -- matching (person, provenance) identity, so without uniqueness
          -- behaviour depends on row order.
          CREATE UNIQUE INDEX idx_face_identities_person
            ON face_identities(person_id, provenance) WHERE deleted_at IS NULL;

          CREATE TRIGGER check_face_identities_provenance_insert
          BEFORE INSERT ON face_identities
          FOR EACH ROW
          WHEN NEW.provenance NOT IN ('confirmed', 'propagated')
          BEGIN
            SELECT RAISE(ABORT, 'Invalid identity provenance. Must be: confirmed or propagated');
          END;

          CREATE TRIGGER check_face_identities_provenance_update
          BEFORE UPDATE ON face_identities
          FOR EACH ROW
          WHEN NEW.provenance NOT IN ('confirmed', 'propagated')
          BEGIN
            SELECT RAISE(ABORT, 'Invalid identity provenance. Must be: confirmed or propagated');
          END;

          CREATE TRIGGER auto_updated_at_face_identities
          AFTER UPDATE ON face_identities
          FOR EACH ROW
          WHEN NEW.updated_at = OLD.updated_at
          BEGIN
            UPDATE face_identities SET updated_at = datetime('now') WHERE id = NEW.id;
          END;
        `)
      })
    }
    record.run("add_people")
  }

  // Frame identity, as a durable column rather than a recomputed guess.
  //
  // A photo delivery contains near-identical frames — burst shots, and
  // retouched/unretouched exports of one exposure. Two things downstream need
  // to know which rows are the same MOMENT rather than the same file:
  //
  //  - must-link propagation (SPEC §6.4's cannot-link, inverted): a person
  //    confidently identified in one frame of a burst is the same person in
  //    the next, which recovers coverage the quality gate discards.
  //  - queue weighting: "how many photographs does answering this unlock"
  //    must count distinct frames, or a ten-shot burst of one moment
  //    outranks a face that appears across ten genuinely different pictures.
  //
  // The value is the sha256 of the LOWEST-id photo in the run's duplicate
  // equivalence class — content-addressed, so it survives re-ingest and does
  // not depend on a run's local photo numbering. A photo with no duplicates is
  // its own root, so the column is never null for an ingested row and
  // "group by frame" needs no coalesce.
  //
  // ⚠ The equivalence classes are the CLI's transitive closure over exact
  // (sha256) and near (perceptual hash) duplicate links — computed once by
  // scripts/vision/session1.js and resolved by frameRoots()'s union-find, NOT
  // recomputed per request from a threshold on this side. That keeps the
  // near-duplicate cutoff a single CLI-authoritative decision (§10) instead of
  // a tunable that could quietly differ between the batch and the server.
  if (!applied.get("add_media_frame_root")) {
    const haveMediaCols = new Set(
      /** @type {Array<{ name: string }>} */ (
        db.prepare("PRAGMA table_info(media)").all()
      ).map((c) => c.name),
    )
    if (!haveMediaCols.has("frame_root_sha256")) {
      db.exec(`ALTER TABLE media ADD COLUMN frame_root_sha256 TEXT`)
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_media_frame_root
        ON media(frame_root_sha256) WHERE frame_root_sha256 IS NOT NULL;
    `)
    record.run("add_media_frame_root")
  }

  // Quality routing (plan §8). `media_faces` already carries the nine gate
  // signals; nothing read them, so the Faces tab would have shown every
  // detection including everything the gate exists to catch (D8).
  //
  // Three columns rather than one, and all three nullable:
  //
  //  - `route_state`  accept | ask | set_aside. NULL means NOT YET GRADED, and
  //    that is a fourth case every query has to handle rather than drop. Rows
  //    written before this migration have it, and so does any row a future
  //    write path forgets to grade; a query that filters `route_state = 'ask'`
  //    silently loses them, which is the same class of bug as D8 itself.
  //  - `route_reason` which check decided, for the UI to explain itself.
  //  - `route_profile` WHICH CUTOFF TABLE the grade was computed under
  //    (`PROFILE` in public/vision/route.js). Without it, revising a cutoff
  //    silently re-means every stored grade and an old queue page becomes
  //    unreadable — you cannot tell whether a row says "ask" because it was
  //    graded that way or because the table moved underneath it. With it, a
  //    revision is an explicit re-grade of rows whose profile is stale.
  //
  // Plain ADD COLUMNs, so this is NOT a table rebuild and D1 is not in play —
  // no DROP, no implicit delete, no ON DELETE SET NULL firing across
  // media_faces.face_identity_id. Kept that way deliberately: a nullable
  // column is the cheap, safe shape here and a NOT NULL default would have
  // forced the rebuild for no gain.
  if (!applied.get("add_face_routing")) {
    const tableExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("media_faces")

    // Guarded like `truncate_durable_actor_tokens` above: a test may pin an
    // earlier ledger state to exercise one migration in isolation, and a
    // migration that hard-depends on another's table turns that into a boot
    // failure (D3 — a throwing migration stops the server starting).
    if (tableExists) {
      const have = new Set(
        /** @type {Array<{ name: string }>} */ (
          db.prepare("PRAGMA table_info(media_faces)").all()
        ).map((c) => c.name),
      )
      for (const [col, decl] of [
        ["route_state", "TEXT"],
        ["route_reason", "TEXT"],
        ["route_profile", "TEXT"],
      ]) {
        if (!have.has(col)) db.exec(`ALTER TABLE media_faces ADD COLUMN ${col} ${decl}`)
      }

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS check_media_faces_route_state_insert
        BEFORE INSERT ON media_faces
        FOR EACH ROW
        WHEN NEW.route_state IS NOT NULL
             AND NEW.route_state NOT IN ('accept', 'ask', 'set_aside')
        BEGIN
          SELECT RAISE(ABORT, 'Invalid face route_state. Must be: accept, ask or set_aside');
        END;

        CREATE TRIGGER IF NOT EXISTS check_media_faces_route_state_update
        BEFORE UPDATE ON media_faces
        FOR EACH ROW
        WHEN NEW.route_state IS NOT NULL
             AND NEW.route_state NOT IN ('accept', 'ask', 'set_aside')
        BEGIN
          SELECT RAISE(ABORT, 'Invalid face route_state. Must be: accept, ask or set_aside');
        END;

        -- The queue's own index. Partial on the live rows, because every
        -- routing query is also a "not deleted" query.
        CREATE INDEX IF NOT EXISTS idx_media_faces_route
          ON media_faces(route_state) WHERE deleted_at IS NULL;
      `)
    }
    record.run("add_face_routing")
  }

  // `people.created_by` and `face_identities.confirmed_by` stored the full
  // 64-char sessions-table key while the audit log stored an 8-char prefix of
  // the same value, so "which admin did this" was two different strings
  // depending on where you read it. `core/utils.js`'s `actorId` is now the one
  // definition; this brings existing rows to it.
  //
  // NOT a credential scrub: the value is the SHA-256 hash db/sessions.js keeps,
  // not the plaintext bearer token, and holding it authenticates nobody. It is
  // a consistency fix, plus one fewer machine-local session key riding along in
  // Phase 9's hand-off export.
  //
  // A prefix is idempotent under re-truncation, so re-running is safe and a row
  // written by either shape lands in the same place.
  // Both UPDATEs are guarded on the table existing. In a real database
  // `add_people` has always run by the time this does, but a test may pin an
  // earlier ledger state to exercise one migration in isolation, and a scrub
  // that hard-depends on a table another migration creates would turn that into
  // a boot failure (D3: a throwing migration stops the server starting).
  if (!applied.get("truncate_durable_actor_tokens")) {
    const tableExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    if (tableExists.get("people")) {
      db.exec(`UPDATE people SET created_by = substr(created_by, 1, 8)
        WHERE created_by IS NOT NULL AND length(created_by) > 8`)
    }
    if (tableExists.get("face_identities")) {
      db.exec(`UPDATE face_identities SET confirmed_by = substr(confirmed_by, 1, 8)
        WHERE confirmed_by IS NOT NULL AND length(confirmed_by) > 8`)
    }
    record.run("truncate_durable_actor_tokens")
  }

  // Ingest provenance and an append-only assignment ledger (plan §9).
  //
  // Two separate problems, one migration, because they answer the same
  // question from opposite ends: *why does this row say what it says?*
  //
  //  - `vision_ingests` is the run that produced a detection. `media_faces`
  //    already carries `model_version`, but that names the DESCRIPTOR SPACE
  //    only (embedder, width, normalisation, mirror) — it says nothing about
  //    which detector, which engine build, which thresholds or which route
  //    profile drew the box. Without that, a row from a superseded run is
  //    indistinguishable from a current one and "re-run only what is stale"
  //    is not a query anyone can write. `ingest_id` makes it one.
  //  - `face_assignments` is the EVENT LOG behind `media_faces.face_identity_id`.
  //    The column alone is a value with no history: a bulk propagate pass and
  //    a human's deliberate correction look identical in it, so undoing the
  //    pass either takes the correction with it or takes nothing. Appending
  //    events and REPLAYING them makes revocation a filter over history
  //    instead of a destructive edit — a later manual event simply outranks
  //    the earlier bulk one that got revoked (plan §9b).
  //
  // Merge is deliberately NOT an op here. It is a fact about identities, not
  // about faces: `face_identities.merged_into` is one column update, no
  // per-face events, and every event ever written stays correct because
  // readers resolve through the redirect (db/face-assignments.js
  // `resolveIdentity`).
  //
  // Append-only on `face_assignments` is spelled UPDATE-blocked and NOT
  // DELETE-blocked. `media_faces` carries `media(id) ON DELETE CASCADE` and
  // `face_assignments` carries `media_faces(id) ON DELETE CASCADE`, so
  // hard-deleting a photo cascades all the way into the ledger; a
  // delete-blocking trigger there would turn a legitimate media deletion into
  // a hard failure. Immutability that fights the cascade is worse than no
  // immutability.
  //
  // ⚠ `vision_ingests` is the exception, and it is enforced by a foreign key
  // rather than by a trigger: `media_faces.ingest_id REFERENCES
  // vision_ingests(id)` carries no ON DELETE clause, so SQLite RESTRICTs —
  // deleting an ingest fails while any face row still points at it, live or
  // soft-deleted. That is deliberate and correct (an ingest is the provenance
  // of the rows it produced, and a face whose ingest_id dangles cannot say what
  // drew its box), and it fights no cascade: deleting a photo removes the
  // FACES, never the ingest. This paragraph once claimed the opposite, which is
  // worse than either choice — `tests/unit/db/vision-provenance-migration.test.js`
  // now pins the behaviour so the two cannot drift apart again.
  //
  // Plain CREATE TABLEs and plain ADD COLUMNs — NOT a table rebuild, so D1
  // (an implicit delete firing `ON DELETE SET NULL` across every existing
  // face assignment) is not in play, and `rebuildTable` is deliberately not
  // used. Each ALTER is guarded on `PRAGMA table_info`, and the ledger tables
  // on their referents existing, for the same reason `add_face_routing` is: a
  // test may pin an earlier ledger state to exercise one migration alone, and
  // a throwing migration stops the server booting (D3).
  if (!applied.get("add_vision_provenance")) {
    const tableExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    )

    // Depends on nothing, so it is created unconditionally.
    db.exec(`
      -- One ingest run: everything needed to say what produced a face row,
      -- and nothing that could identify a photograph or a person. config_json
      -- is an ALLOWLISTED object (versions, hashes, channel orders, detection
      -- resolution, thresholds, top-K stage, normalisation, mirror, schema
      -- version) — never a path, never argv, never an environment variable,
      -- never a count measured from the photographs. This object travels to
      -- production.
      CREATE TABLE IF NOT EXISTS vision_ingests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset_id TEXT NOT NULL,
        model_version TEXT NOT NULL,          -- descriptor space only (see media_faces)
        detector_sha256 TEXT NOT NULL,
        embedder_sha256 TEXT NOT NULL,
        engine_sha256 TEXT NOT NULL,
        mirror_applied INTEGER NOT NULL DEFAULT 0,   -- 0 | 1
        normalisation TEXT NOT NULL,          -- e.g. 'arcface' | 'ingraph'
        route_profile TEXT NOT NULL,          -- PROFILE from public/vision/route.js
        config_json TEXT NOT NULL,            -- allowlisted object, see above
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_vision_ingests_model
        ON vision_ingests(model_version);

      -- One revocable batch of assignment events. NOT append-only: revocation
      -- is the one legitimate update, and it is a flag rather than a
      -- compensating event precisely so it stays reversible.
      CREATE TABLE IF NOT EXISTS face_assignment_batches (
        batch_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,            -- label-import | propagate | manual | merge-repair
        actor TEXT NOT NULL,           -- core/utils.js actorId(), never from the client
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        revoked_at TEXT,
        revoked_by TEXT
      );
    `)

    db.exec(`
      -- Enum enforcement by trigger, matching add_media_faces/add_people
      -- rather than introducing inline CHECKs as a second convention.
      -- INSERT only: every UPDATE on this table already aborts below, so an
      -- update-side check would be unreachable code pretending to be a rule.
      CREATE TRIGGER IF NOT EXISTS check_vision_ingests_mirror_insert
      BEFORE INSERT ON vision_ingests
      FOR EACH ROW
      WHEN NEW.mirror_applied NOT IN (0, 1)
      BEGIN
        SELECT RAISE(ABORT, 'Invalid mirror_applied. Must be: 0 or 1');
      END;

      -- An ingest is a historical fact. Re-running the pipeline writes a NEW
      -- row; editing this one would silently re-mean every face that points
      -- at it. DELETE stays open on purpose (see the module comment above).
      CREATE TRIGGER IF NOT EXISTS vision_ingests_immutable
      BEFORE UPDATE ON vision_ingests
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'vision_ingests is immutable — a new run is a new row');
      END;
    `)

    if (tableExists.get("media_faces")) {
      const faceCols = new Set(
        /** @type {Array<{ name: string }>} */ (
          db.prepare("PRAGMA table_info(media_faces)").all()
        ).map((c) => c.name),
      )
      // Nullable, and permanently so: every row written before this migration
      // predates ingest provenance, and an upload-time detection has no
      // ingest at all. A NOT NULL column here would have forced a rebuild to
      // buy a lie.
      if (!faceCols.has("ingest_id")) {
        db.exec(
          `ALTER TABLE media_faces ADD COLUMN ingest_id INTEGER REFERENCES vision_ingests(id)`,
        )
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_media_faces_ingest ON media_faces(ingest_id);
      `)
    }

    if (tableExists.get("face_identities")) {
      const identityCols = new Set(
        /** @type {Array<{ name: string }>} */ (
          db.prepare("PRAGMA table_info(face_identities)").all()
        ).map((c) => c.name),
      )
      // The merge redirect. NULL = a live identity; non-null = this identity
      // was folded into another and every reader resolves through it. Old
      // assignment events keep pointing at the identity they actually named,
      // which is what makes them still true after a merge.
      if (!identityCols.has("merged_into")) {
        db.exec(
          `ALTER TABLE face_identities ADD COLUMN merged_into INTEGER REFERENCES face_identities(id)`,
        )
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_face_identities_merged
          ON face_identities(merged_into) WHERE merged_into IS NOT NULL;
      `)
    }

    if (tableExists.get("media_faces") && tableExists.get("face_identities")) {
      db.exec(`
        -- The ledger. Ordering is by id and never by created_at: the
        -- timestamp has one-second resolution and a batch writes many events
        -- inside it, so "the latest event wins" would be a coin toss.
        CREATE TABLE IF NOT EXISTS face_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          face_id INTEGER NOT NULL REFERENCES media_faces(id) ON DELETE CASCADE,
          op TEXT NOT NULL,                     -- assign | clear | not_a_face | negative
          identity_id INTEGER REFERENCES face_identities(id),
          actor TEXT NOT NULL,
          batch_id TEXT REFERENCES face_assignment_batches(batch_id),
          reason TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- (face_id, id) covers the replay query whole: seek to the face, walk
        -- its events in id order, stop at the first survivor.
        CREATE INDEX IF NOT EXISTS idx_face_assignments_face ON face_assignments(face_id, id);
        CREATE INDEX IF NOT EXISTS idx_face_assignments_batch ON face_assignments(batch_id);
        CREATE INDEX IF NOT EXISTS idx_face_assignments_identity ON face_assignments(identity_id);
      `)

      db.exec(`
        -- op/identity_id must agree, or the ledger records a state nobody can
        -- replay: assign and negative both NAME someone (negative names who
        -- this face is NOT), clear and not_a_face both name no one.
        CREATE TRIGGER IF NOT EXISTS check_face_assignments_op_insert
        BEFORE INSERT ON face_assignments
        FOR EACH ROW
        WHEN NEW.op NOT IN ('assign', 'clear', 'not_a_face', 'negative')
             OR (NEW.op IN ('assign', 'negative') AND NEW.identity_id IS NULL)
             OR (NEW.op IN ('clear', 'not_a_face') AND NEW.identity_id IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'Invalid face assignment: op must be assign, clear, not_a_face or negative, with identity_id set for assign/negative and null for clear/not_a_face');
        END;

        -- Append-only: a correction is a NEW event, never an edit to an old
        -- one. Rewriting history here would defeat the entire point of
        -- keeping it — a revoked batch could no longer be told apart from a
        -- batch that never happened.
        CREATE TRIGGER IF NOT EXISTS face_assignments_append_only
        BEFORE UPDATE ON face_assignments
        FOR EACH ROW
        BEGIN
          SELECT RAISE(ABORT, 'face_assignments is append-only — correct it by appending a new event');
        END;
      `)
    }

    record.run("add_vision_provenance")
  }

  // The three rules `add_vision_provenance` described and did not enforce.
  //
  // A. `face_assignment_batches.kind` is typed `FaceAssignmentBatchKind` and
  //    commented with its four values, and — alone among the enums in that
  //    migration — was checked by nothing. `createBatch({ kind: 'nonsense' })`
  //    was accepted, and a batch is the unit revocation acts on: a kind nobody
  //    can interpret is a revocable unit nobody can explain.
  //
  // B. That table is deliberately NOT append-only — revocation is a legitimate
  //    update, and a flag rather than a compensating event precisely so it stays
  //    reversible in the ledger's sense. But nothing narrowed WHICH update.
  //    `SET revoked_at = NULL` un-revoked a batch in one statement and left
  //    every `media_faces.face_identity_id` derived from it stale, with nothing
  //    to say which of the two stories was current; and `actor` — the
  //    attribution on the revocable unit, and the more useful one to forge —
  //    was freely rewritable while `face_assignments.actor` beside it was frozen
  //    by the append-only trigger. So: updates are revocations, and everything
  //    else about a batch is fixed at insert. (Revocations were one-way here
  //    too; `add_face_batch_reinstatement` replaced that with a recorded,
  //    re-projecting reinstatement.)
  //
  // C. `media_faces.deleted_at` has THREE authors, not the two anybody had
  //    written down: db/face-assignments.js's `not_a_face` projection, the §10
  //    precedence triggers in `add_media_faces` above, and `retireCliFaces` in
  //    scripts/vision/ingest-faces.js (the `--replace` path). The projection
  //    needs to undo its own retirement when a `not_a_face` event is revoked,
  //    and asking "does a not_a_face event exist in this face's history at all"
  //    answers a different question — whether the ledger ever spoke, not who
  //    wrote the value now in the column — so it handed every other author's
  //    row back to the live pool.
  //
  //    `ledger_retired_at` is the ledger's RECEIPT: it writes the same timestamp
  //    into both columns when it retires a face, and may clear `deleted_at` only
  //    while the two still match. Authorship as a receipt rather than a flag
  //    means any later write to `deleted_at` by anyone silently invalidates the
  //    claim, with no need for that writer to know this column exists.
  //
  //    One case the receipt cannot see on its own, and the trigger below is
  //    for: the ledger's own retirement MASKS the other authors, because all of
  //    them retire live rows only (`WHERE deleted_at IS NULL`). A face the
  //    ledger has already retired is invisible to the §10 trigger and to
  //    `--replace`, so nobody overwrites the receipt — and revoking would then
  //    conclude the row was only ever the ledger's, when in truth it would have
  //    been superseded anyway. The trigger releases the claim at the moment
  //    supersession happens, whether the row is live or already retired.
  //
  // Plain ADD COLUMN and CREATE TRIGGER, guarded on `sqlite_master` / `PRAGMA
  // table_info`: a test may pin an earlier ledger state to exercise one
  // migration alone, and a throwing migration stops the server booting (D3).
  if (!applied.get("add_face_ledger_integrity")) {
    const tableExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    )

    if (tableExists.get("face_assignment_batches")) {
      db.exec(`
        -- Enum by trigger, matching check_vision_ingests_mirror_insert and
        -- check_face_assignments_op_insert rather than introducing an inline
        -- CHECK as a second convention. INSERT only: the update trigger below
        -- freezes 'kind' outright, so an update-side enum check would be
        -- unreachable code pretending to be a rule.
        CREATE TRIGGER IF NOT EXISTS check_face_assignment_batches_kind_insert
        BEFORE INSERT ON face_assignment_batches
        FOR EACH ROW
        WHEN NEW.kind NOT IN ('label-import', 'propagate', 'manual', 'merge-repair')
        BEGIN
          SELECT RAISE(ABORT, 'Invalid batch kind. Must be: label-import, propagate, manual or merge-repair');
        END;

        -- What a batch IS cannot change; only whether it still counts. Every
        -- comparison is NULL-safe (IS NOT, not <>) so that setting a column to
        -- NULL is caught rather than silently passing the WHEN clause.
        CREATE TRIGGER IF NOT EXISTS face_assignment_batches_revocation_only
        BEFORE UPDATE ON face_assignment_batches
        FOR EACH ROW
        WHEN NEW.batch_id IS NOT OLD.batch_id
          OR NEW.kind IS NOT OLD.kind
          OR NEW.actor IS NOT OLD.actor
          OR NEW.note IS NOT OLD.note
          OR NEW.created_at IS NOT OLD.created_at
        BEGIN
          SELECT RAISE(ABORT, 'face_assignment_batches: only revoked_at/revoked_by may be updated');
        END;
      `)
      // This migration used to create `face_assignment_batches_revocation_is_permanent`
      // here as well. `add_face_batch_reinstatement` below drops it and replaces
      // it with a rule that allows a RECORDED reinstatement; creating it here
      // would only re-arm it on a database where this migration runs late (a
      // test that pins it, or a lost ledger row), after its replacement exists.
    }

    if (tableExists.get("media_faces")) {
      const faceCols = new Set(
        /** @type {Array<{ name: string }>} */ (
          db.prepare("PRAGMA table_info(media_faces)").all()
        ).map((c) => c.name),
      )
      // Nullable and permanently so: NULL means "the ledger holds no claim on
      // this row's deleted_at", which is the state of every live row and of
      // every row somebody else retired.
      if (!faceCols.has("ledger_retired_at")) {
        db.exec(`ALTER TABLE media_faces ADD COLUMN ledger_retired_at TEXT`)

        // Back-fill, once, in the same breath as creating the column — so a
        // database that already carries revocable not_a_face verdicts does not
        // silently lose the ability to undo them. Deliberately conservative:
        // a claim is reconstructed only where the row is retired, the ledger
        // has a not_a_face event on it, AND no other author had cause to retire
        // it. Where the two are indistinguishable the row keeps NO claim and
        // stays retired, because the failure this column exists to prevent is
        // reviving something, not leaving something dead.
        if (tableExists.get("face_assignments")) {
          db.exec(`
            UPDATE media_faces SET ledger_retired_at = deleted_at
            WHERE deleted_at IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM face_assignments fa
                WHERE fa.face_id = media_faces.id AND fa.op = 'not_a_face'
              )
              AND NOT EXISTS (
                SELECT 1 FROM media_faces other
                WHERE other.media_id = media_faces.media_id
                  AND other.id <> media_faces.id
                  AND other.source = 'cli'
                  AND other.deleted_at IS NULL
                  AND (
                    media_faces.source = 'upload'
                    OR (media_faces.source = 'cli'
                        AND other.model_version = media_faces.model_version
                        AND other.ingest_id IS NOT media_faces.ingest_id)
                  )
              )
          `)
        }
      }

      // §10's precedence rule, stated for the rows the §10 triggers cannot
      // reach. Those two retire LIVE rows; this one takes the ledger's claim
      // off rows that are already retired, so that revoking a not_a_face on a
      // row the CLI has since superseded leaves it superseded instead of
      // handing it back to the live pool. It writes no `deleted_at` and revives
      // nothing — the row it touches is already dead, and stays dead.
      //
      // The cli-vs-cli half is `--replace`: `retireCliFaces` retires every live
      // cli row for a (media_id, model_version) and the run then inserts its
      // own, so a DIFFERENT ingest_id on the same photo and descriptor space is
      // a later generation. `IS NOT` is NULL-safe, so two rows from one run
      // (equal ingest_id) — or two rows that both predate ingest provenance —
      // are not each other's supersession, which is what keeps a not_a_face on
      // one box in a photograph undoable.
      //
      // ⚠ Guarded on `ingest_id` EXISTING, and that guard is load-bearing in a
      // way `CREATE TRIGGER` does not advertise: SQLite compiles a trigger BODY
      // lazily, at fire time, so creating one over a missing column succeeds
      // quietly and then breaks every INSERT into the table it watches. A test
      // that pins an earlier ledger state (D3) is exactly that database.
      if (faceCols.has("ingest_id")) db.exec(`
        CREATE TRIGGER IF NOT EXISTS media_faces_supersession_releases_ledger_claim
        AFTER INSERT ON media_faces
        FOR EACH ROW
        WHEN NEW.source = 'cli' AND NEW.deleted_at IS NULL
        BEGIN
          UPDATE media_faces SET ledger_retired_at = NULL
          WHERE media_id = NEW.media_id
            AND id <> NEW.id
            AND ledger_retired_at IS NOT NULL
            AND (
              source = 'upload'
              OR (source = 'cli'
                  AND model_version = NEW.model_version
                  AND ingest_id IS NOT NEW.ingest_id)
            );
        END;
      `)
    }

    record.run("add_face_ledger_integrity")
  }

  // Thank-you card replies take ANY single emoji (issue #8), stored as the
  // glyph itself rather than one of six reaction keys. The app validates
  // (public/components/emoji.js — one grapheme, emoji parts only); the triggers
  // become a backstop on size, since "is this an emoji" is not a question
  // SQLite can answer. Existing key rows are rewritten to their glyphs so the
  // column means one thing. (Rewriting reply_emoji bumps those cards'
  // updated_at through auto_updated_at_thank_you_cards; nothing orders by it.)
  //
  // Explicitly transactional, because migrations are not (TRAPS.md): dropping
  // the old triggers and failing before the new ones exist would leave the
  // columns unguarded with no ledger row. Old triggers go FIRST — the old
  // UPDATE trigger would refuse the glyph rewrite.
  if (!applied.get("reply_emoji_glyphs")) {
    const glyphCase = (/** @type {string} */ col) => `CASE ${col}
        WHEN 'heart' THEN '❤️' WHEN 'clap' THEN '👏' WHEN 'laugh' THEN '😂'
        WHEN 'heart_eyes' THEN '😍' WHEN 'cheers' THEN '🥂' WHEN 'fire' THEN '🔥'
        ELSE ${col} END`
    const sizeBad = (/** @type {string} */ col) =>
      `NEW.${col} IS NOT NULL AND (length(NEW.${col}) < 1 OR length(NEW.${col}) > 16)`
    let committed = false
    try {
      db.exec("BEGIN")
      db.exec(`
        DROP TRIGGER IF EXISTS check_tyc_reply_emoji_insert;
        DROP TRIGGER IF EXISTS check_tyc_reply_emoji_update;
        DROP TRIGGER IF EXISTS check_tycr_emoji_insert;

        UPDATE thank_you_cards SET reply_emoji = ${glyphCase("reply_emoji")}
        WHERE reply_emoji IS NOT NULL;
        UPDATE thank_you_card_replies SET emoji = ${glyphCase("emoji")}
        WHERE emoji IS NOT NULL;

        CREATE TRIGGER check_tyc_reply_emoji_insert
        BEFORE INSERT ON thank_you_cards
        FOR EACH ROW
        WHEN ${sizeBad("reply_emoji")}
        BEGIN
          SELECT RAISE(ABORT, 'Invalid reply emoji');
        END;

        CREATE TRIGGER check_tyc_reply_emoji_update
        BEFORE UPDATE ON thank_you_cards
        FOR EACH ROW
        WHEN ${sizeBad("reply_emoji")}
        BEGIN
          SELECT RAISE(ABORT, 'Invalid reply emoji');
        END;

        CREATE TRIGGER check_tycr_emoji_insert
        BEFORE INSERT ON thank_you_card_replies
        FOR EACH ROW
        WHEN ${sizeBad("emoji")}
        BEGIN
          SELECT RAISE(ABORT, 'Invalid reply emoji');
        END;
      `)
      record.run("reply_emoji_glyphs")
      db.exec("COMMIT")
      committed = true
    } finally {
      if (!committed) {
        try {
          db.exec("ROLLBACK")
        } catch {
          /* already rolled back */
        }
      }
    }
  }

  // The Honeymoon gallery section: a second admin-curated section beside
  // 'official' (admin-only upload, auto-approved, its own sort_order order).
  // Only the two section CHECK triggers change — the same widening
  // add_content_ladder did. The media table is NOT rebuilt: media_faces
  // cascades from media, and a rebuild on a live database is the TRAPS.md
  // hazard. Nothing here touches a row.
  //
  // Explicitly transactional, because migrations are not (TRAPS.md): dropping
  // the old triggers and failing before the new ones exist would leave the
  // section column unguarded with no ledger row.
  if (!applied.get("add_honeymoon_section")) {
    let committed = false
    try {
      db.exec("BEGIN")
      db.exec(`
        DROP TRIGGER IF EXISTS check_media_section_insert;
        DROP TRIGGER IF EXISTS check_media_section_update;

        CREATE TRIGGER check_media_section_insert
        BEFORE INSERT ON media
        FOR EACH ROW
        WHEN NEW.section NOT IN ('official', 'guest', 'content', 'honeymoon')
        BEGIN
          SELECT RAISE(ABORT, 'Invalid media section. Must be: official, guest, content, or honeymoon');
        END;

        CREATE TRIGGER check_media_section_update
        BEFORE UPDATE ON media
        FOR EACH ROW
        WHEN NEW.section NOT IN ('official', 'guest', 'content', 'honeymoon')
        BEGIN
          SELECT RAISE(ABORT, 'Invalid media section. Must be: official, guest, content, or honeymoon');
        END;
      `)
      record.run("add_honeymoon_section")
      db.exec("COMMIT")
      committed = true
    } finally {
      if (!committed) {
        try {
          db.exec("ROLLBACK")
        } catch {
          /* already rolled back */
        }
      }
    }
  }

  // A revoked batch can be reinstated, and the history says so.
  //
  // `add_face_ledger_integrity` made revocation one-way, for a sound reason:
  // clearing `revoked_at` by hand re-derives no projection, so the column and
  // the ledger would disagree with nothing to say which was current. It told
  // the operator to reinstate by "appending its events again under a new
  // batch_id" — but the face-work import's batch id IS its content digest, so
  // re-exporting an unchanged source yields the same id, the import refuses a
  // revoked id, and a revoked naming import could never come back.
  //
  // So reinstatement becomes a real operation (db/face-assignments.js
  // `reinstateBatch`), and the two halves of the old objection are each closed:
  //
  //  - **The projections ARE re-derived.** `reinstateBatch` clears the flag and
  //    re-projects every face the batch touched in one transaction, through the
  //    same `projectFace` revocation uses — so a later hand correction still
  //    outranks the batch (replay is newest-id first).
  //  - **There IS a record of which is current.** `face_batch_revocations` is an
  //    append-only history of every revoke and reinstate, and the batch's
  //    `revoked_at`/`revoked_by` become a projection of its LATEST row: a
  //    trigger refuses any change to those columns that does not match it. A
  //    revocation can therefore no more be silently cleared than before — it
  //    can only be cleared by first appending a `reinstate`, with an actor.
  //
  // The history alternates (revoke, reinstate, revoke, …) by trigger, which is
  // also what keeps the old "a revocation is never re-dated" rule: a second
  // `revoke` row while one stands is refused, so there is nothing for a re-dated
  // `revoked_at` to agree with.
  //
  // UPDATE-blocked, NOT DELETE-blocked, and `ON DELETE CASCADE` from the batch:
  // the same stance as `face_assignments`. Batches are never deleted by the app,
  // and a test that resets the batches table should not have to know this one
  // exists.
  //
  // Existing revocations are back-filled as one `revoke` row each, so every
  // revoked batch has the row its own reinstatement has to follow.
  //
  // Explicitly transactional, because migrations are not (TRAPS.md): dropping
  // the old trigger and failing before the new one exists would leave a
  // revocation clearable by a bare UPDATE, with no ledger row to retry from.
  // Guarded on the batches table: a test may pin the ledger's own migration.
  if (!applied.get("add_face_batch_reinstatement")) {
    const batchesExist = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'face_assignment_batches'")
      .get()
    let committed = false
    try {
      db.exec("BEGIN")
      if (batchesExist) {
        db.exec(`
          DROP TRIGGER IF EXISTS face_assignment_batches_revocation_is_permanent;

          CREATE TABLE IF NOT EXISTS face_batch_revocations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id TEXT NOT NULL
              REFERENCES face_assignment_batches(batch_id) ON DELETE CASCADE,
            op TEXT NOT NULL,                -- revoke | reinstate
            actor TEXT NOT NULL,
            -- Written by the caller, never defaulted in practice: a 'revoke'
            -- row's created_at IS the batch's revoked_at, compared exactly.
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );

          CREATE INDEX IF NOT EXISTS idx_face_batch_revocations_batch
            ON face_batch_revocations(batch_id, id);

          INSERT INTO face_batch_revocations (batch_id, op, actor, created_at)
          SELECT b.batch_id, 'revoke', COALESCE(b.revoked_by, 'unrecorded'), b.revoked_at
          FROM face_assignment_batches b
          WHERE b.revoked_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM face_batch_revocations r WHERE r.batch_id = b.batch_id)
          ORDER BY b.rowid;

          CREATE TRIGGER IF NOT EXISTS check_face_batch_revocations_op_insert
          BEFORE INSERT ON face_batch_revocations
          FOR EACH ROW
          WHEN NEW.op NOT IN ('revoke', 'reinstate')
          BEGIN
            SELECT RAISE(ABORT, 'Invalid batch revocation op. Must be: revoke or reinstate');
          END;

          -- Revoke only a live batch; reinstate only a revoked one. "Live" is
          -- no rows at all, or a latest row that is a reinstate.
          CREATE TRIGGER IF NOT EXISTS face_batch_revocations_alternate
          BEFORE INSERT ON face_batch_revocations
          FOR EACH ROW
          WHEN NEW.op IN ('revoke', 'reinstate') AND NEW.op IS NOT (
            CASE (SELECT r.op FROM face_batch_revocations r
                  WHERE r.batch_id = NEW.batch_id ORDER BY r.id DESC LIMIT 1)
              WHEN 'revoke' THEN 'reinstate'
              ELSE 'revoke'
            END
          )
          BEGIN
            SELECT RAISE(ABORT, 'face_batch_revocations: a batch is revoked only while live and reinstated only while revoked');
          END;

          CREATE TRIGGER IF NOT EXISTS face_batch_revocations_append_only
          BEFORE UPDATE ON face_batch_revocations
          FOR EACH ROW
          BEGIN
            SELECT RAISE(ABORT, 'face_batch_revocations is append-only — a reinstatement is a new row, never an edit');
          END;

          -- The batch columns are a projection of the history's latest row.
          CREATE TRIGGER IF NOT EXISTS face_assignment_batches_revocation_follows_history
          BEFORE UPDATE ON face_assignment_batches
          FOR EACH ROW
          WHEN (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.revoked_by IS NOT OLD.revoked_by)
            AND NOT EXISTS (
              SELECT 1 FROM (
                SELECT r.op AS op, r.actor AS actor, r.created_at AS created_at
                FROM face_batch_revocations r
                WHERE r.batch_id = NEW.batch_id
                ORDER BY r.id DESC LIMIT 1
              ) latest
              WHERE (latest.op = 'revoke'
                     AND NEW.revoked_at IS latest.created_at
                     AND NEW.revoked_by IS latest.actor)
                 OR (latest.op = 'reinstate'
                     AND NEW.revoked_at IS NULL
                     AND NEW.revoked_by IS NULL)
            )
          BEGIN
            SELECT RAISE(ABORT, 'face_assignment_batches: revoked_at/revoked_by change only with a matching face_batch_revocations row (revokeBatch / reinstateBatch)');
          END;
        `)
      }
      record.run("add_face_batch_reinstatement")
      db.exec("COMMIT")
      committed = true
    } finally {
      if (!committed) {
        try {
          db.exec("ROLLBACK")
        } catch {
          /* already rolled back */
        }
      }
    }
  }

  // Gallery → Sort: when someone decided a curated photo there, shown or kept
  // hidden. NULL is "nobody has looked at it yet", which is what lets the couple
  // stop on one device and carry on from another. Its own column rather than
  // reviewed_at, which every moderation transition already stamps — the
  // importer's --apply-selection and the grid's own Hide among them — so it
  // can't tell a photo nobody has looked at from one somebody hid. A plain
  // nullable ADD COLUMN: no rebuild, nothing touches a row.
  if (!applied.get("add_media_decided_at")) {
    const haveMediaCols = new Set(
      /** @type {Array<{ name: string }>} */ (
        db.prepare("PRAGMA table_info(media)").all()
      ).map((c) => c.name),
    )
    if (!haveMediaCols.has("decided_at")) {
      db.exec(`ALTER TABLE media ADD COLUMN decided_at TEXT`)
    }
    record.run("add_media_decided_at")
  }

  // Black-and-white twins: a photographer's second, black-and-white copy of a
  // colour photo is ONE photo, not two. `media.twin_of` names the colour row
  // (the primary) the copy belongs to. NULL — every row before this — means
  // "its own photo". A twin is never its own item anywhere public: feeds,
  // counts, comment/reaction targets and card pickers all skip it, and its bytes
  // follow its primary's visibility (core/media-serve.js).
  //
  // A nullable column, not a rebuild: media_faces cascades from media, and a
  // rebuild of a live media table is the TRAPS.md hazard. ADD COLUMN may carry a
  // REFERENCES clause because its default is NULL. ON DELETE SET NULL only
  // matters for the one hard delete there is (an abandoned 'uploading' row,
  // which can never be a primary); the soft-delete path releases twins itself.
  //
  // The triggers keep the shape one level deep and image-only: a twin's primary
  // must be a live, unpaired image; a row with a twin can't itself become one;
  // and the partial unique index allows one live twin per primary. Created in
  // the same transaction as the column, so they never exist without it (TRAPS.md:
  // SQLite compiles trigger bodies lazily). Explicitly transactional, because
  // migrations are not.
  if (!applied.get("add_media_twins")) {
    let committed = false
    try {
      db.exec("BEGIN")
      const haveMediaCols = new Set(
        /** @type {Array<{ name: string }>} */ (
          db.prepare("PRAGMA table_info(media)").all()
        ).map((c) => c.name),
      )
      if (!haveMediaCols.has("twin_of")) {
        db.exec(
          `ALTER TABLE media ADD COLUMN twin_of INTEGER REFERENCES media(id) ON DELETE SET NULL`,
        )
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_media_twin_of
          ON media(twin_of) WHERE twin_of IS NOT NULL AND deleted_at IS NULL;

        DROP TRIGGER IF EXISTS check_media_twin_insert;
        DROP TRIGGER IF EXISTS check_media_twin_update;

        CREATE TRIGGER check_media_twin_insert
        BEFORE INSERT ON media
        FOR EACH ROW
        WHEN NEW.twin_of IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'A new media row cannot be a twin');
        END;

        CREATE TRIGGER check_media_twin_update
        BEFORE UPDATE OF twin_of ON media
        FOR EACH ROW
        WHEN NEW.twin_of IS NOT NULL AND (
          NEW.twin_of = NEW.id
          OR NEW.kind != 'image'
          OR NOT EXISTS (
            SELECT 1 FROM media p
            WHERE p.id = NEW.twin_of AND p.kind = 'image'
              AND p.twin_of IS NULL AND p.deleted_at IS NULL)
          OR EXISTS (
            SELECT 1 FROM media c
            WHERE c.twin_of = NEW.id AND c.deleted_at IS NULL)
        )
        BEGIN
          SELECT RAISE(ABORT, 'Invalid twin: both must be images, one level deep');
        END;
      `)
      record.run("add_media_twins")
      db.exec("COMMIT")
      committed = true
    } finally {
      if (!committed) {
        try {
          db.exec("ROLLBACK")
        } catch {
          /* already rolled back */
        }
      }
    }
  }
}
