# Self-host in 5 minutes

This is a zero-dependency wedding site (RSVP + guestbook + photo gallery) that
runs on Node 22+ with nothing but the standard library and a SQLite file. A
fresh install boots into a no-code **`/setup` wizard** — no editing source, no
CLI required.

There are two ways to run it: Docker (recommended) or bare Node.

---

## Option A — Docker

```bash
# 1. Build the image (from the repo root)
docker build -t wedding .

# 2. Run it with a persistent data volume
docker run -d --name wedding \
  -p 3000:3000 \
  -e BASE_URL=http://localhost:3000 \
  -v wedding-data:/app/data \
  wedding
```

The SQLite database, audit logs, and uploaded media all live under `/app/data`,
so the `wedding-data` volume is the only thing you need to back up.

**Then finish setup:**

1. Grab the one-time setup token from the logs — it's printed once on first boot:

   ```bash
   docker logs wedding
   ```

   Look for the `FIRST-RUN SETUP REQUIRED` banner and the 64-character token
   under it. (A restart before you finish prints a fresh one.)

2. Open **http://localhost:3000/** — you'll be redirected to `/setup`.

3. Paste the token, set an admin password, fill in the couple/date/theme/registry,
   and click **Finish setup**. You'll be logged straight into `/admin`.

That's it — the site is live. Everything you entered (and much more: schedule,
dress code, nav, effects) is editable any time from the admin dashboard.

### Production behind a reverse proxy

`docker-compose.yml` is a working example that fronts the container with Traefik
(automatic HTTPS via Let's Encrypt). Point the `Host(...)` rules and `BASE_URL`
at your domain, set `TRUSTED_PROXIES` to your proxy IP, and see
[`DEFERRED.md`](../DEFERRED.md) for the media-upload proxy timeout you'll need to
raise for large video uploads.

---

## Option B — Bare Node (no Docker)

Requires **Node.js 22+** (uses `node:sqlite`, `process.loadEnvFile`, and native
ESM — no build step, no `npm install` of runtime deps).

```bash
# From the repo root
cp .env.example .env          # optional — edit BASE_URL etc.
npm start                     # runs on port 3000
```

On first boot the server prints the setup token to your terminal. Open
`http://localhost:3000/` and complete the `/setup` wizard exactly as above.

Prefer the terminal? `npm run setup` sets the admin password non-interactively in
`.env` instead of via the wizard — the wizard is the no-code path, the CLI is the
fallback.

---

## Configuration

Everything content-facing is set in the wizard and editable in `/admin`. The only
things that live in the environment (`.env`, or `-e` flags / `env_file` for
Docker) are infrastructure:

| Variable | Purpose |
|---|---|
| `BASE_URL` | Public URL used in invite links + cookie `Secure` detection. **Set this.** |
| `PORT` | Listen port (default `3000`). |
| `NODE_ENV` | `production` enables HSTS + proxy warnings. |
| `TRUSTED_PROXIES` | Comma-separated proxy IPs, for correct client-IP behind a reverse proxy. |
| `ADMIN_PASSWORD_HASH` | Optional — pre-seed the admin hash instead of using the wizard. When set, `/setup` is disabled. |
| `RESEND_API_KEY`, `FROM_EMAIL` | Optional — enable invite/recovery email (no-ops when unset). |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Optional — enable SMS invites (no-ops when unset). |
| `CONTACT_EMAIL` | Reply-to / contact address surfaced to guests. |
| `MEDIA_MIN_FREE_BYTES`, `MEDIA_MAX_TOTAL_BYTES`, `MEDIA_UNTRUSTED_QUOTA_BYTES` | Media disk guards — see `CLAUDE.md`. |

See [`.env.example`](../.env.example) for the full annotated list.

> **Note:** the shipped content defaults are still this project's own wedding copy
> (schedule, dress code, sample images). The wizard overrides the essentials, and
> the rest is editable in `/admin`; a future release will ship neutral sample copy
> so a fresh install starts fully generic. Tracked in [`DEFERRED.md`](../DEFERRED.md).
