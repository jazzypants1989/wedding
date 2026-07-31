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
}
