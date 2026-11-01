# Jordana & Jesse's Wedding

Wedding RSVP website for April 26, 2026 in Portland, OR.

Built with Node.js 22+ and zero npm dependencies. Uses native SQLite for the database, built-in ESM modules, and raw `node:http` for the server.

## Quick Start

```bash
# Set up admin password
npm run setup

# Seed test data for previewing
npm run seed

# Start the server
npm start
```

Then open http://localhost:3000

## Setup

**Prerequisites:** Node.js 22 or later.

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Set the admin password (interactive prompt):
   ```bash
   npm run setup
   ```

3. Start the server:
   ```bash
   npm start
   ```

The database is created automatically on first run at `data/wedding.db`.

### Optional: External Services

SMS and email are optional. Without them, the admin dashboard can still manage guests and RSVPs, but invitation sending and guest lookup link delivery won't work.

- **SMS (Twilio):** Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` in `.env`
- **Email (Resend):** Set `RESEND_API_KEY` and `FROM_EMAIL` in `.env`

### Production

Set these additional variables in `.env`:

```
NODE_ENV=production
BASE_URL=https://yourdomain.com
TRUSTED_PROXIES=127.0.0.1
```

## How It Works

**For guests:**

1. Guest receives an invite link via email or SMS (e.g., `https://site.com/rsvp?code=AbCd1234`)
2. The link opens a personalized RSVP form with their name and party size
3. Guest submits their response (attending/declining, party size, dietary needs)
4. Guest can revisit the same link to update their RSVP at any time

**For guests without a link:**

1. Visit `/rsvp` without a code to access the lookup form
2. Enter name + email or phone to receive a new invite link
3. If not found on the guest list, submit a petition requesting an invitation

**For the admin:**

1. Log in at `/admin` with the password set during setup
2. Manage the guest list (add, edit, import/export CSV)
3. Send invitations via email or SMS
4. Review RSVPs and export responses
5. Approve or deny guest petitions
6. Manage a blocklist for the petition system

## Preview

Seed the database with test guests to walk through the RSVP experience:

```bash
npm run seed
```

This creates 4 test guests covering different scenarios (solo, group, already accepted, already declined) and prints URLs you can visit. Safe to re-run.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server (port 3000) |
| `npm test` | Run the full suite — unit **and** integration (integration spins a real server on port 3001 with a separate test DB) |
| `npm run test:unit` | Run unit tests only |
| `npm run test:integration` | Run integration tests only (real server + separate DB) |
| `npm run typecheck` | Type-check both configs (server + `public/`) via TypeScript `checkJs` — no build step |
| `npm run dev` | Run with `--watch` (auto-restart on source changes) |
| `npm run doctor` | Preflight config check — `.env` drift, prod-required vars, disk headroom (exits non-zero on failure) |
| `npm run setup` | Set admin password (interactive) |
| `npm run seed` | Seed preview data (`--gallery N` also adds media rows) |
| `npm run export` | Export a self-contained sunset archive (JSON + CSV + media tree) |
| `npm run deploy` | Prints how to deploy (deploys run from the homelab repo) |

## Architecture

- **Zero dependencies** -- only Node.js built-in modules (`node:http`, `node:sqlite`, `node:crypto`, `node:fs`, etc.)
- **No regex** -- all string manipulation uses string methods
- **SQLite** -- single-file database with WAL mode, foreign keys, and trigger-based validation
- **ESM only** -- no CommonJS, all imports use `.js` extensions
- **Declarative routing** -- all API routes registered in a single route table
- **Soft deletes** -- guest records use `deleted_at` instead of hard delete

For a fuller tour — request lifecycle, the media pipeline, auth, and how full type
safety is achieved without a TypeScript build step — see
[docs/architecture.md](docs/architecture.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
