@echo off
REM ==========================================================================
REM  run-cleanup-round13.cmd
REM  Runs scripts\cleanup-round13.sql against the v2 Postgres DB.
REM  Purges throwaway QA use_cases named 'ZZ-QA-%%' / 'ZZ-ARCHIVED-QA%%'.
REM  The SQL is transaction-wrapped, guarded (MAX_QA_ROWS ceiling) and
REM  idempotent -- safe to run twice, never touches real data.
REM
REM  USAGE (from C:\ai-catalyst-v2\scripts):
REM      run-cleanup-round13.cmd
REM      run-cleanup-round13.cmd "postgresql://user:pass@host:port/db"
REM
REM  DB connection string is resolved in this order:
REM    1. the first argument to this script (if given)
REM    2. the DATABASE_URL environment variable
REM    3. the DATABASE_URL= line in ..\.env  (repo root)
REM
REM  Prereq: psql on PATH (comes with a PostgreSQL client install).
REM ==========================================================================
setlocal enabledelayedexpansion

REM --- locate this script's folder and the repo root (its parent) ---
set "SCRIPT_DIR=%~dp0"
set "SQL_FILE=%SCRIPT_DIR%cleanup-round13.sql"
set "ENV_FILE=%SCRIPT_DIR%..\.env"

if not exist "%SQL_FILE%" (
  echo ERROR: cannot find "%SQL_FILE%".
  echo Run this from the scripts folder of the unzipped repo.
  exit /b 1
)

REM --- resolve DATABASE_URL: arg 1 > env var > ..\.env ---
set "DBURL=%~1"
if not defined DBURL set "DBURL=%DATABASE_URL%"
if not defined DBURL (
  if exist "%ENV_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b "DATABASE_URL=" "%ENV_FILE%"`) do set "DBURL=%%B"
  )
)

if not defined DBURL (
  echo ERROR: could not determine the database connection string.
  echo Pass it as an argument, set DATABASE_URL, or ensure ..\.env has a DATABASE_URL= line.
  exit /b 1
)

REM --- verify psql is available ---
where psql >nul 2>&1
if errorlevel 1 (
  echo ERROR: 'psql' not found on PATH. Install the PostgreSQL client, or use:
  echo     railway run psql "%%DATABASE_URL%%" -f scripts/cleanup-round13.sql
  exit /b 1
)

echo Running cleanup-round13.sql ...
echo   SQL : %SQL_FILE%
echo   DB  : (resolved connection string)
echo.
psql "%DBURL%" -v ON_ERROR_STOP=1 -f "%SQL_FILE%"
if errorlevel 1 (
  echo.
  echo cleanup-round13.sql FAILED ^(see error above^). No changes were committed.
  exit /b 1
)

echo.
echo cleanup-round13.sql completed successfully.
endlocal
