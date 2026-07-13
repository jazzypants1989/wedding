/** @file Database schema and migrations */
/** @import * as Types from './types.js' */

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
      deleted_at TEXT DEFAULT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    -- Serves admin/status-filtered lists. The public feed's OR-disjunction
    -- (approved OR own-pending) makes SQLite prefer the PK scan for keyset
    -- id DESC at this scale; don't expect this index in that query plan.
    CREATE INDEX IF NOT EXISTS idx_guestbook_feed
      ON guestbook_entries(status, id DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_guestbook_account ON guestbook_entries(account_id);

    -- Media items (photos + short videos). file_key is the public/storage id;
    -- account_id NULL = admin/official upload. Rows stay 'uploading' until
    -- finalize, so nothing partial is ever publicly visible.
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_key TEXT UNIQUE NOT NULL,                 -- 32 lowercase hex, crypto.randomBytes(16)
      account_id INTEGER,                            -- NULL = admin/official upload
      kind TEXT NOT NULL,                            -- image|video
      section TEXT NOT NULL DEFAULT 'guest',         -- official|guest|content
      status TEXT NOT NULL DEFAULT 'uploading',      -- uploading|pending|approved|hidden|rejected
      caption TEXT,
      original_ext TEXT,                             -- derived from sniff: jpg|png|webp|heic|mp4|mov
      original_bytes INTEGER, display_bytes INTEGER, thumb_bytes INTEGER, poster_bytes INTEGER,
      w400_bytes INTEGER, w800_bytes INTEGER, w1600_bytes INTEGER, -- content-section responsive ladder (add_content_ladder migration back-fills existing DBs)
      width INTEGER, height INTEGER,
      duration_seconds REAL,                         -- video only
      needs_display INTEGER NOT NULL DEFAULT 0,      -- HEIC-decode fallback: original-only (no display/thumb)
      sort_order INTEGER NOT NULL DEFAULT 0,         -- official-section ordering (Phase 6)
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
      account_id INTEGER NOT NULL,
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
}
