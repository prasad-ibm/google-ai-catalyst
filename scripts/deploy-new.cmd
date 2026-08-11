@echo off
REM ==========================================================================
REM  Deploy AI-catalyst-v2 to GitHub + a NEW Railway project (with Postgres).
REM  Pre-wired for:
REM     Repo   : https://github.com/prasad-ibm/AI-catalyst-v2
REM     Folder : C:\ai-catalyst-v2   (run this script from there)
REM
REM  Usage (from C:\ai-catalyst-v2):   scripts\deploy-new.cmd
REM  Prereqs: git, node, npm on PATH. Installs the Railway CLI via npm if missing.
REM  Create the GitHub repo first (it can be empty OR already exist).
REM ==========================================================================
setlocal enabledelayedexpansion

set "REPO_URL=https://github.com/prasad-ibm/AI-catalyst-v2.git"
set "PROJECT_NAME=ai-catalyst-v2"
set "BRANCH=main"

REM cd to repo root (parent of this script's folder) so it works from anywhere.
cd /d "%~dp0.."
echo Working dir: %CD%
echo Target repo: %REPO_URL%
echo.

echo ==^> [1/6] Preparing git ^& pushing to %REPO_URL%
if not exist ".git" ( git init -b %BRANCH% )
git rm --cached .env >nul 2>&1
git add -A
git commit -m "v2 Scale release: filters, compare v2, delivered storyline, lazy render, M6 parity" || echo    (nothing new to commit - continuing)
git branch -M %BRANCH%
git remote | findstr /x origin >nul 2>&1 && (git remote set-url origin "%REPO_URL%") || (git remote add origin "%REPO_URL%")
git push -u origin %BRANCH% || goto :fail

echo ==^> [2/6] Ensuring Railway CLI is installed
where railway >nul 2>&1 || (echo    installing @railway/cli via npm... & npm i -g @railway/cli)
railway --version || goto :fail

echo ==^> [3/6] Logging in to Railway (browser opens if needed)
railway whoami >nul 2>&1 || railway login

echo ==^> [4/6] Creating new project "%PROJECT_NAME%" + Postgres
railway init --name "%PROJECT_NAME%" || railway init
railway add --database postgres || echo    NOTE: if this failed, add PostgreSQL from the dashboard, then re-run env/deploy steps.

echo ==^> [5/6] Setting env vars + deploying
for /f "delims=" %%S in ('node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"') do set "SESSION_SECRET=%%S"
railway variables --set "DATABASE_URL=${{Postgres.DATABASE_URL}}"
railway variables --set "SESSION_SECRET=!SESSION_SECRET!"
railway variables --set "AI_PROVIDER=scripted"
railway up || goto :fail

echo ==^> [6/7] Running DB migration (schema.sql) against the new Postgres
railway run npm run migrate || goto :fail

REM -------------------------------------------------------------------------
REM [7/7] OPTIONAL, GUARDED one-time cleanup (DEF-13 round-12 junk row).
REM scripts\cleanup-round12.sql purges the ONE pre-existing junk use_cases row
REM ('NotARealDept' / id 66fceda0...) that inflated /api/portfolio/facets from
REM 14 -> 15 departments. Only needed on a DB migrated from the round-12
REM snapshot; a brand-new Postgres created by this script does NOT contain it,
REM so this step is OPT-IN and OFF by default. The SQL is self-guarded and
REM idempotent (aborts on >1 match, no-op if the row is absent), safe to re-run.
REM Enable by setting RUN_CLEANUP_ROUND12=1 before running this script:
REM     set RUN_CLEANUP_ROUND12=1 ^&^& scripts\deploy-new.cmd
REM -------------------------------------------------------------------------
if "%RUN_CLEANUP_ROUND12%"=="1" (
  echo ==^> [7/8] Running GUARDED cleanup-round12.sql (RUN_CLEANUP_ROUND12=1)
  railway run psql "%%DATABASE_URL%%" -f scripts/cleanup-round12.sql || goto :fail
) else (
  echo ==^> [7/8] Skipping optional cleanup-round12.sql ^(set RUN_CLEANUP_ROUND12=1 to run it^)
  echo            Only needed if this DB still has the round-12 'NotARealDept' junk row.
)

REM -------------------------------------------------------------------------
REM [8/8] OPTIONAL, GUARDED round-13 QA cleanup.
REM scripts\cleanup-round13.sql hard-deletes throwaway QA use_cases left by
REM round-13 testing, matched by sentinel name prefixes 'ZZ-QA-%%' /
REM 'ZZ-ARCHIVED-QA%%'. Transaction-wrapped with a MAX_QA_ROWS ceiling guard;
REM safe + idempotent. Only needed on a DB that carried round-13 QA scratch
REM data. OPT-IN / OFF by default. Enable with RUN_CLEANUP_ROUND13=1:
REM     set RUN_CLEANUP_ROUND13=1 ^&^& scripts\deploy-new.cmd
REM -------------------------------------------------------------------------
if "%RUN_CLEANUP_ROUND13%"=="1" (
  echo ==^> [8/8] Running GUARDED cleanup-round13.sql (RUN_CLEANUP_ROUND13=1)
  railway run psql "%%DATABASE_URL%%" -f scripts/cleanup-round13.sql || goto :fail
) else (
  echo ==^> [8/8] Skipping optional cleanup-round13.sql ^(set RUN_CLEANUP_ROUND13=1 to run it^)
  echo            Only needed if this DB still has round-13 QA scratch rows (ZZ-QA-* names).
)

echo.
echo DONE. Optional next steps:
echo   * Seed demo data:  railway run node scripts/seed-intel.js
echo   * Public URL:       railway domain
echo   * Open it:          railway open
echo   * Health check:     open https://YOUR-APP.up.railway.app/api/health
goto :eof

:fail
echo.
echo DEPLOY FAILED at the step above. Fix the reported error and re-run.
exit /b 1
