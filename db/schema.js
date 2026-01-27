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
export function runMigrations(_db) {
  // Future migrations go here. Example:
  //
  // const applied = db.prepare("SELECT 1 FROM migrations WHERE name = ?")
  // const record = db.prepare("INSERT INTO migrations (name) VALUES (?)")
  //
  // if (!applied.get('migration_name')) {
  //   db.exec("ALTER TABLE guests ADD COLUMN new_col TEXT")
  //   record.run('migration_name')
  // }
}
