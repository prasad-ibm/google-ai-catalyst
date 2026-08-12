# Deploy to a NEW GitHub repo + NEW Railway project

This app is already Railway-ready: `Procfile` (`web: npm start`), `railway.json`
(NIXPACKS + healthcheck `/api/health`), `nixpacks.toml` (Node 20), idempotent
`npm run migrate` (applies `schema.sql`), and `scripts/seed-intel.js`.

Runtime env vars the app reads:
- `DATABASE_URL`  (required — Postgres)
- `SESSION_SECRET` (required in prod — sign cookies)
- `PORT` (Railway injects it automatically)
- `AI_PROVIDER` (optional; default `scripted` = fully offline, no key)
- `GEMINI_API_KEY` / Vertex vars (only if you set `AI_PROVIDER=gemini|vertex`)

> ⚠️ Never commit `.env`. It's already in `.gitignore`. Your current `.env` points at the
> OLD Railway DB — the new project gets its own fresh `DATABASE_URL`.

---

## STEP 1 — Point the working copy at a brand-new GitHub repo

You currently have `origin → github.com/prasad-ibm/google-ai-catalyst.git`. To deploy from a
NEW repo, create the repo and re-point `origin` (or add a second remote). Pick ONE path.

### 1a. With the GitHub CLI (`gh`) — creates the repo for you
```bash
cd /path/to/google-ai-catalyst

# (Optional) start truly fresh git history:
#   rm -rf .git && git init -b main

# Make sure secrets aren't staged, then commit current state:
git rm --cached .env 2>/dev/null || true
git add -A
git commit -m "v2 Scale release: filters, compare v2, delivered storyline, lazy render, M6 parity"

# Create a NEW GitHub repo and push (change OWNER/NAME):
gh repo create YOUR_GH_USER/ai-catalyst-v2 --private --source=. --remote=neworigin --push
git branch -M main
git push -u neworigin main
```

### 1b. Without `gh` — create the empty repo in the GitHub UI first
Create an EMPTY repo at github.com (no README/license), copy its URL, then:
```bash
cd /path/to/google-ai-catalyst
git rm --cached .env 2>/dev/null || true
git add -A
git commit -m "v2 Scale release"

# Re-point origin to the new repo (replace URL):
git remote set-url origin https://github.com/YOUR_GH_USER/ai-catalyst-v2.git
#   ...or keep the old one and add a second remote instead:
# git remote add neworigin https://github.com/YOUR_GH_USER/ai-catalyst-v2.git

git branch -M main
git push -u origin main    # (or: git push -u neworigin main)
```

---

## STEP 2 — Create a NEW Railway project + Postgres, deploy from the new repo

Two paths. The **CLI path** is fully scriptable; the **dashboard path** is click-through.

### 2a. Railway CLI path (recommended, scriptable)
```bash
# Install the CLI if you don't have it:
#   macOS/Linux:  bash <(curl -fsSL https://railway.app/install.sh)
#   npm (any OS): npm i -g @railway/cli
railway --version

# Log in (opens a browser):
railway login

# From the repo root, create a NEW project and link this dir to it:
cd /path/to/google-ai-catalyst
railway init            # prompts for a new project name, e.g. "ai-catalyst-v2"

# Add a Postgres database to the project:
railway add --database postgres     # (older CLI: `railway add` then pick PostgreSQL)

# Set required runtime env vars on the app service.
# DATABASE_URL is provided by the Postgres plugin — reference it so it's always in sync:
railway variables --set "DATABASE_URL=\${{Postgres.DATABASE_URL}}"
railway variables --set "SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
railway variables --set "AI_PROVIDER=scripted"
# (Only if going live with AI:)
# railway variables --set "AI_PROVIDER=gemini" --set "GEMINI_API_KEY=YOUR_KEY"

# Deploy the current code:
railway up

# Run the DB migration ONCE against the new Postgres (creates tables from schema.sql):
railway run npm run migrate

# (Optional) seed the demo "Intel" workspace data:
railway run node scripts/seed-intel.js

# Open the live site + generate a public domain if needed:
railway domain
railway open
```

### 2b. Railway dashboard path (no CLI)
1. railway.app → **New Project** → **Deploy from GitHub repo** → pick your new repo → **main**.
   Railway auto-detects NIXPACKS + `npm start` from `railway.json`.
2. In the project → **New** → **Database** → **Add PostgreSQL**.
3. Open the **app service → Variables** and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`  (reference the DB service)
   - `SESSION_SECRET` = a long random string (generate with the node one-liner above)
   - `AI_PROVIDER` = `scripted`
4. Redeploy (Variables change triggers one). Wait for the healthcheck at `/api/health` to pass.
5. Run the migration once — either:
   - locally: `railway run npm run migrate` (after `railway link` to this project), OR
   - add a one-off: service → **Settings → Deploy** → temporarily set start to
     `npm run migrate && npm start`, deploy once, then revert to `npm start`.
6. Service → **Settings → Networking → Generate Domain** for a public URL.

---

## STEP 3 — Verify the live deploy
```bash
# Replace with your Railway domain:
curl -s https://YOUR-APP.up.railway.app/api/health
#   expect JSON like {"ok":true,"db":true,...}
```
Then log in via the site and run the smoke checklist in
`plan_output/V2-VERIFICATION-AND-STAGING-CHECKLIST.md` (sections B–F).

Run the one-time data normalization if this DB carries over the old ~130 rows
(not needed for a fresh/empty DB):
```bash
railway run node -e "require('dotenv').config();const fs=require('fs');const{query,pool}=require('./db');query(fs.readFileSync('scripts/normalize-dept-sponsor.sql','utf8')).then(()=>{console.log('normalized');return pool.end();})"
```

---

## Notes
- `railway up` deploys your LOCAL working tree. If you'd rather have Railway auto-deploy on every
  `git push`, use the dashboard **Deploy from GitHub** path (2b) instead of `railway up`.
- If `railway add --database postgres` isn't recognized, update the CLI (`npm i -g @railway/cli`)
  or add Postgres from the dashboard (2b step 2).
- The healthcheck path is `/api/health`; Railway waits for it before marking the deploy live.
