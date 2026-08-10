# Deploy AI-catalyst-v2 → GitHub + new Railway project

**Repo:** https://github.com/prasad-ibm/AI-catalyst-v2
**Local folder:** `C:\ai-catalyst-v2`

---

## 0. Unzip
Extract the zip so the files land directly in `C:\ai-catalyst-v2`
(you should see `server.js`, `package.json`, `schema.sql` at the top level —
NOT inside an extra nested folder).

```cmd
cd C:\ai-catalyst-v2
dir            REM confirm server.js / package.json are here
```

> The zip does NOT include `node_modules` or `.env` (you regenerate both).
> Run `npm install` locally only if you want to run/test before deploying.

---

## 1. One-shot deploy (recommended)

Everything below is pre-wired to your repo + project name — no arguments needed.

**Windows (cmd / PowerShell):**
```cmd
cd C:\ai-catalyst-v2
scripts\deploy-new.cmd
```

**macOS / Linux / WSL / Git-Bash:**
```bash
cd /path/to/ai-catalyst-v2
scripts/deploy-new.sh
```

The script runs 6 steps:
1. `git init` (if needed) → strips `.env` from staging → commit → set `origin` to
   `https://github.com/prasad-ibm/AI-catalyst-v2.git` → push `main`.
2. Install the Railway CLI (`npm i -g @railway/cli`) if it's missing.
3. `railway login` (opens a browser).
4. `railway init` (new project **ai-catalyst-v2**) + add a **Postgres** database.
5. Set env vars — `DATABASE_URL=${{Postgres.DATABASE_URL}}`, a freshly generated
   `SESSION_SECRET`, `AI_PROVIDER=scripted` — then `railway up` to deploy.
6. `railway run npm run migrate` to create the tables from `schema.sql`.

---

## 2. Manual steps (if you prefer to run them yourself)

```cmd
cd C:\ai-catalyst-v2
git init -b main
git add -A
git commit -m "v2 Scale release"
git remote add origin https://github.com/prasad-ibm/AI-catalyst-v2.git
git push -u origin main

npm i -g @railway/cli
railway login
railway init --name ai-catalyst-v2
railway add --database postgres
railway variables --set "DATABASE_URL=${{Postgres.DATABASE_URL}}" --set "SESSION_SECRET=REPLACE_WITH_LONG_RANDOM" --set "AI_PROVIDER=scripted"
railway up
railway run npm run migrate
railway domain
```

Generate a strong `SESSION_SECRET`:
```cmd
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Alternative: auto-deploy from GitHub (instead of `railway up`)
In the Railway dashboard → **New Project → Deploy from GitHub repo →**
select `prasad-ibm/AI-catalyst-v2`. Add a **PostgreSQL** service, set the same
three variables on the app service, then every `git push` auto-deploys.
Run the one-time migration from the app service shell: `npm run migrate`.

---

## 3. After it's live

| Task | Command |
|---|---|
| Get public URL | `railway domain` |
| Open in browser | `railway open` |
| Health check | visit `https://YOUR-APP.up.railway.app/api/health` (expects `{ ok: true, db: true }`) |
| Seed the demo Intel workspace | `railway run node scripts/seed-intel.js` |
| Re-run migration (safe/idempotent) | `railway run npm run migrate` |

Notes:
- The new Postgres starts **empty** — register an account in the app, then
  upload use cases (or run the seed script above).
- You do **not** need `scripts/normalize-dept-sponsor.sql` on a fresh DB — that
  was a one-time cleanup for the ~130 rows carried in the OLD database.
- Optional AI features: set `AI_PROVIDER=gemini` + `GEMINI_API_KEY=...` in
  Railway variables (see `.env.example`). Default `scripted` runs fully offline.

---

## 4. CI (already included)
`.github/workflows/ci.yml` runs every suite on push to `main` against an
ephemeral Postgres. It's advisory-only (never blocks). To make it blocking,
set `continue-on-error: false` and change the final `exit 0` to `exit $fail`.
