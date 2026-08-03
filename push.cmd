@echo off
REM ============================================================================
REM  Google AI Catalyst - one-shot push to GitHub (Windows Command Prompt)
REM  Double-click this file, or run:  push.cmd
REM ============================================================================
setlocal

set REPO=https://github.com/prasad-ibm/google-ai-catalyst.git

echo.
echo === Google AI Catalyst : push to GitHub ===
echo Repo: %REPO%
echo.

REM Ensure git is available
where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] git is not installed or not on PATH. Install Git for Windows: https://git-scm.com/download/win
  pause
  exit /b 1
)

REM Initialise repo if needed
if not exist ".git" (
  echo Initialising new git repository...
  git init
  git branch -M main
)

REM Safety: make sure .env is never committed
if exist ".env" (
  git rm --cached .env >nul 2>nul
)

echo Staging files...
git add -A

REM Confirm no secret is staged
git ls-files | findstr /X ".env" >nul 2>nul
if not errorlevel 1 (
  echo [ERROR] .env is tracked! Aborting to avoid leaking secrets.
  echo Run:  git rm --cached .env   then re-run this script.
  pause
  exit /b 1
)

echo Committing...
git commit -m "Deploy: clean one-shot Railway provisioning + CI" 2>nul
if errorlevel 1 echo (nothing new to commit - continuing)

REM Point origin at the repo (add or update)
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin %REPO%
) else (
  git remote set-url origin %REPO%
)

echo Pushing to origin/main...
git push -u origin main

echo.
echo === Done. Check https://github.com/prasad-ibm/google-ai-catalyst ===
echo (A sign-in / token prompt may appear on first push.)
pause
endlocal
