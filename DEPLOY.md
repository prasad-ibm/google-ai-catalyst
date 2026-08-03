# Deploying Google AI Catalyst to Railway

This app is built for **one-shot, clean deploys**. There is **no manual migration
step** — on every boot the server:

1. Applies `schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS`) → the 7 data tables.
2. Ensures the auth tables and seeds the `sandboxuser` login.
3. Starts listening on Railway's injected `PORT`.
4. Answers the health check at `GET /api/health`.

So a fresh database self-provisions with zero extra commands.

---

## 1. Create the services

In your Railway project:

- **Add a PostgreSQL database** (New → Database → PostgreSQL).
- **Add this app** (New → GitHub Repo → `prasad-ibm/google-ai-catalyst`).

## 2. Set the app's environment variables

On the **app service** → **Variables**, add:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{ Postgres.DATABASE_URL }}` (reference your Postgres service) |
| `SESSION_SECRET` | a long random string — generate with:<br>`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |

> `PORT` is injected by Railway automatically — do **not** set it.
> Optional: `SEED_USER` / `SEED_PASSWORD` override the default `sandboxuser` / `IntelUser1!`.

> **Note on the reference name:** `${{ Postgres.DATABASE_URL }}` assumes your
> database service is named `Postgres`. If it's named differently (e.g.
> `Google AI Catalyst`), use that exact name: `${{ Google AI Catalyst.DATABASE_URL }}`.

## 3. Deploy

Railway reads `railway.json`:

- **Builder:** Nixpacks (auto-detects Node from `engines.node >= 20`).
- **Install:** `npm ci` (uses the committed `package-lock.json`).
- **Start:** `npm start` → `node server.js` (self-provisions, then listens).
- **Health check:** `GET /api/health` (expects `{ "ok": true, "db": true }`).

Push to `main` (or click **Deploy**). The build installs deps, the server boots,
provisions the DB, and the health check passes. Done.

## 4. Log in

Open the deployed URL → you'll be redirected to `/login.html`.

- **Username:** `sandboxuser`
- **Password:** `IntelUser1!`

## Optional: seed the Intel demo data

To populate the Intel enterprise + 5 fully-scored use cases, run once (locally
against the public `DATABASE_URL`, or as a Railway one-off command):

```bash
node scripts/seed-intel.js
```

---

## Troubleshooting

- **Build fails on `npm ci` with "Missing … from lock file":** the lockfile is out
  of sync with `package.json`. Run `npm install` locally, commit the updated
  `package-lock.json`, and redeploy. (Already fixed in this repo.)
- **Health check fails / `db:false`:** `DATABASE_URL` is wrong or the Postgres
  service isn't linked. Verify the reference variable resolves.
- **`no pg_hba.conf entry / SSL` errors:** hosted Postgres requires SSL (on by
  default here). Only set `PGSSLMODE=disable` for a local non-SSL database (CI does this).
