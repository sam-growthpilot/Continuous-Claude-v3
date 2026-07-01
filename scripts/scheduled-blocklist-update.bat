@echo off
REM Daily package security blocklist update
REM Runs via Windows Task Scheduler at 9am
REM Updates malicious-packages.json from GitHub Advisory API, rebuilds hooks, commits, pushes, syncs

REM Self-redirect ALL output to a durable log (Task Scheduler discards the console, which is why
REM this task's daily exit-1 failures were undiagnosable). The re-invoke runs the real body below.
set "LOG=C:\Users\david.hayes\continuous-claude\.claude\logs\blocklist-update.log"
if /i not "%~1"=="__LOGGED__" (
    call "%~f0" __LOGGED__ >> "%LOG%" 2>&1
    exit /b %ERRORLEVEL%
)

echo [%date% %time%] Starting blocklist update...

cd /d C:\Users\david.hayes\continuous-claude

REM Fetch latest advisories and update the blocklist
echo Fetching advisories from GitHub...
call node scripts/update-blocklist.mjs --apply
if errorlevel 1 (
    echo [ERROR] Blocklist update failed
    exit /b 1
)

REM Rebuild hooks with updated blocklist
echo Rebuilding hooks...
cd /d C:\Users\david.hayes\continuous-claude\.claude\hooks
call npm run build
if errorlevel 1 (
    echo [ERROR] Hook build failed
    exit /b 1
)

REM Commit if there are changes
cd /d C:\Users\david.hayes\continuous-claude
git add .claude/hooks/src/shared/malicious-packages.json .claude/hooks/dist/package-install-guard.mjs
git diff --cached --quiet
if errorlevel 1 (
    echo Committing updated blocklist...
    git commit -m "chore(security): daily blocklist update [automated]"
    git push fork main
    echo Pushed to fork/main
) else (
    echo No blocklist changes detected
)

REM Sync to active ~/.claude/
echo Syncing to active directory...
bash scripts/sync-to-active.sh

echo [%date% %time%] Blocklist update complete
