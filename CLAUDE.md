# Wedding RSVP System

## Core Principles

### No Regex
All string manipulation must use string methods (`split`, `indexOf`, `includes`, `startsWith`, `replaceAll`, etc.). No `RegExp` constructors or regex literals (`/pattern/`) allowed.

### Zero Dependencies
Only Node.js built-in modules. No npm packages.

### Node.js 22+ Required
Uses native SQLite (`node:sqlite`), ESM modules, and `process.loadEnvFile()`.

## Commands

- `npm start` - Run server on port 3000
- `npm test` - Run integration tests
- `npm run setup` - Set admin password

## Code Style

- ESM only (no CommonJS)
- Always use `.js` extensions in imports
- Soft-delete pattern (`deleted_at` instead of hard delete)
- CSRF protection via double-submit cookie

## Database

SQLite with tables: guests, rsvps, sessions, communications, blocklist, petitions

## Security

- Rate limiting on all public endpoints
- Scrypt password hashing
- Session tokens with 24-hour expiration
- Input sanitization and length limits
