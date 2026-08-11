@echo off
REM ==========================================================================
REM  run-cleanup-all.cmd
REM  Convenience wrapper: runs BOTH cleanup scripts in order against the v2 DB
REM    1) cleanup-round12.sql  (removes the 'NotARealDept' junk row, facets 15->14)
REM    2) cleanup-round13.sql  (removes ZZ-QA-* / ZZ-ARCHIVED-QA* QA scratch rows)
REM  Both SQL files are guarded + idempotent, so this is safe to run any time.
REM
REM  USAGE (from C:\ai-catalyst-v2\scripts):
REM      run-cleanup-all.cmd
REM      run-cleanup-all.cmd "postgresql://user:pass@host:port/db"
REM
REM  Connection string resolves as: arg 1 > DATABASE_URL env > ..\.env
REM ==========================================================================
setlocal
set "SCRIPT_DIR=%~dp0"

call "%SCRIPT_DIR%run-cleanup-round12.cmd" %*
if errorlevel 1 (
  echo.
  echo Stopped: cleanup-round12 failed. Not running round13.
  exit /b 1
)

echo.
call "%SCRIPT_DIR%run-cleanup-round13.cmd" %*
if errorlevel 1 (
  echo.
  echo Stopped: cleanup-round13 failed.
  exit /b 1
)

echo.
echo ALL cleanup scripts completed successfully.
endlocal
