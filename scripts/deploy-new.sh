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

echo "==> [6/7] Running DB migration (schema.sql) against the new Postgres"
railway run npm run migrate

# ---------------------------------------------------------------------------
# [7/7] OPTIONAL, GUARDED one-time cleanup (DEF-13 round-12 junk row).
#
# scripts/cleanup-round12.sql purges the ONE pre-existing junk use_cases row
# ('NotARealDept' / id 66fceda0…) that inflated /api/portfolio/facets from
# 14 -> 15 departments. It is only needed on a DB that already contains that
# row (i.e. a DB migrated from the round-12 snapshot). A brand-new Postgres
# created by this script does NOT contain it, so this step is OPT-IN and OFF
# by default. The SQL is self-guarded and idempotent: it aborts if it would
# match more than one row and is a harmless no-op if the row is absent, so it
# is safe to run twice.
#
# Enable it by exporting RUN_CLEANUP_ROUND12=1 before running this script:
#     RUN_CLEANUP_ROUND12=1 scripts/deploy-new.sh
# ---------------------------------------------------------------------------
if [ "${RUN_CLEANUP_ROUND12:-0}" = "1" ]; then
  echo "==> [7/8] Running GUARDED cleanup-round12.sql (RUN_CLEANUP_ROUND12=1)"
  railway run psql "\$DATABASE_URL" -f scripts/cleanup-round12.sql
else
  echo "==> [7/8] Skipping optional cleanup-round12.sql (set RUN_CLEANUP_ROUND12=1 to run it)"
  echo "          Only needed if this DB still has the round-12 'NotARealDept' junk row."
fi

# ---------------------------------------------------------------------------
# [8/8] OPTIONAL, GUARDED round-13 QA cleanup.
#
# scripts/cleanup-round13.sql hard-deletes throwaway QA use_cases left behind
# by round-13 testing, identified by the sentinel name prefixes
# 'ZZ-QA-%' / 'ZZ-ARCHIVED-QA%'. No real use case uses the 'ZZ-' prefix, and
# the script is transaction-wrapped with a MAX_QA_ROWS ceiling guard, so it is
# safe and idempotent. Only needed on a DB that carried round-13 QA scratch
# data; a brand-new Postgres does NOT contain it, so this is OPT-IN / OFF by
# default. Enable with RUN_CLEANUP_ROUND13=1:
#     RUN_CLEANUP_ROUND13=1 scripts/deploy-new.sh
# ---------------------------------------------------------------------------
if [ "${RUN_CLEANUP_ROUND13:-0}" = "1" ]; then
  echo "==> [8/8] Running GUARDED cleanup-round13.sql (RUN_CLEANUP_ROUND13=1)"
  railway run psql "\$DATABASE_URL" -f scripts/cleanup-round13.sql
else
  echo "==> [8/8] Skipping optional cleanup-round13.sql (set RUN_CLEANUP_ROUND13=1 to run it)"
  echo "          Only needed if this DB still has round-13 QA scratch rows (ZZ-QA-* names)."
fi

echo
echo "DONE. Optional next steps:"
echo "  • Seed demo data:   railway run node scripts/seed-intel.js"
echo "  • Public URL:        railway domain"
echo "  • Open it:           railway open"
echo "  • Health check:      curl -s \"\$(railway domain 2>/dev/null | tail -1)\"/api/health"
