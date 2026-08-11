@echo off
REM ==========================================================================
REM  run-cleanup-round12.cmd
REM  Runs scripts\cleanup-round12.sql against the v2 Postgres DB.
REM  Purges the ONE pre-existing 'NotARealDept' junk use_cases row so
REM  /api/portfolio/facets reverts from 15 -> 14 departments.
REM  The SQL is self-guarded (aborts on >1 match) and idempotent -- a no-op
REM  if the row is already gone, safe to run twice.
REM
REM  USAGE (from C:\ai-catalyst-v2\scripts):
REM      run-cleanup-round12.cmd
REM      run-cleanup-round12.cmd "postgresql://user:pass@host:port/db"
REM
REM  DB connection string is resolved in this order:
REM    1. the first argument to this script (if given)
REM    2. the DATABASE_URL environment variable
REM    3. the DATABASE_URL= line in ..\.env  (repo root)
REM
REM  Prereq: psql on PATH (comes with a PostgreSQL client install).
REM ==========================================================================
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "SQL_FILE=%SCRIPT_DIR%cleanup-round12.sql"
set "ENV_FILE=%SCRIPT_DIR%..\.env"

if not exist "%SQL_FILE%" (
  echo ERROR: cannot find "%SQL_FILE%".
  echo Run this from the scripts folder of the unzipped repo.
  exit /b 1
)

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

where psql >nul 2>&1
if errorlevel 1 (
  echo ERROR: 'psql' not found on PATH. Install the PostgreSQL client, or use:
  echo     railway run psql "%%DATABASE_URL%%" -f scripts/cleanup-round12.sql
  exit /b 1
)

echo Running cleanup-round12.sql ...
echo   SQL : %SQL_FILE%
echo   DB  : (resolved connection string)
echo.
psql "%DBURL%" -v ON_ERROR_STOP=1 -f "%SQL_FILE%"
if errorlevel 1 (
  echo.
  echo cleanup-round12.sql FAILED ^(see error above^). No changes were committed.
  exit /b 1
)

echo.
echo cleanup-round12.sql completed successfully.
endlocal
