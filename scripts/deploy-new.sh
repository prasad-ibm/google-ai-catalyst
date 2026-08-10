#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy AI-catalyst-v2 to GitHub + a NEW Railway project (with Postgres).
# Pre-wired for:
#     Repo   : https://github.com/prasad-ibm/AI-catalyst-v2
#     Folder : C:\ai-catalyst-v2  (or wherever you unzipped)
#
# Usage (from the repo root):   scripts/deploy-new.sh
# For macOS/Linux/WSL/Git-Bash. Prereqs: git, node, npm.
# Installs the Railway CLI via npm if missing.
# Create the GitHub repo first (it can be empty OR already exist).
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_URL="https://github.com/prasad-ibm/AI-catalyst-v2.git"
PROJECT_NAME="ai-catalyst-v2"
BRANCH="main"

# Run from the repo root regardless of where the script is called from.
cd "$(dirname "$0")/.."
echo "Working dir: $(pwd)"
echo "Target repo: $REPO_URL"
echo

echo "==> [1/6] Preparing git & pushing to $REPO_URL"
[ -d .git ] || git init -b "$BRANCH"
git rm --cached .env >/dev/null 2>&1 || true          # never publish secrets
git add -A
git commit -m "v2 Scale release: filters, compare v2, delivered storyline, lazy render, M6 parity" || \
  echo "    (nothing new to commit — continuing)"
git branch -M "$BRANCH"
if git remote | grep -qx origin; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi
git push -u origin "$BRANCH"

echo "==> [2/6] Ensuring Railway CLI is installed"
if ! command -v railway >/dev/null 2>&1; then
  echo "    installing @railway/cli via npm..."
  npm i -g @railway/cli
fi
railway --version

echo "==> [3/6] Logging in to Railway (browser will open if needed)"
railway whoami >/dev/null 2>&1 || railway login

echo "==> [4/6] Creating new project '$PROJECT_NAME' + Postgres"
railway init --name "$PROJECT_NAME" || railway init      # older CLI ignores --name; will prompt
railway add --database postgres || \
  echo "    NOTE: 'railway add --database postgres' failed — add PostgreSQL from the dashboard, then re-run from step 5."

echo "==> [5/6] Setting env vars + deploying"
SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
railway variables --set "DATABASE_URL=\${{Postgres.DATABASE_URL}}"
railway variables --set "SESSION_SECRET=$SESSION_SECRET"
railway variables --set "AI_PROVIDER=scripted"
railway up

echo "==> [6/6] Running DB migration (schema.sql) against the new Postgres"
railway run npm run migrate

echo
echo "DONE. Optional next steps:"
echo "  • Seed demo data:   railway run node scripts/seed-intel.js"
echo "  • Public URL:        railway domain"
echo "  • Open it:           railway open"
echo "  • Health check:      curl -s \"\$(railway domain 2>/dev/null | tail -1)\"/api/health"
