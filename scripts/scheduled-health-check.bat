@echo off
REM Weekly CCv3 health check
REM Registered in Windows Task Scheduler as "CCv3-Health-Check"
REM Runs every Friday at 08:03am (local time)
REM Output files land in C:\Users\david.hayes\continuous-claude\.claude\cache\health-checks\
REM Run manually: schtasks /run /tn "CCv3-Health-Check"

cd /d C:\Users\david.hayes\continuous-claude\opc
set PYTHONPATH=.

echo [%date% %time%] Starting CCv3 weekly health check...

REM --skip-slow --quiet is the documented scheduled form: the full run's slow checks + the
REM trailing claude -p step blew the 15-min ExecutionTimeLimit, so the scheduler killed the task
REM (0x41306 SCHED_S_TASK_TERMINATED). Skipping the slow checks keeps the run well inside budget.
call uv run python scripts\health_check.py --skip-slow --quiet
set EXIT_CODE=%ERRORLEVEL%

echo [%date% %time%] Health check finished. exit=%EXIT_CODE%

REM --- Notion dashboard mirror (deterministic; Stream C, approved proposal 04) ---
REM After the Python run, mirror the newest health_*.json onto the CCv3 Weekly Health
REM Checks Notion page via scripts/report-registry/health-mirror.mjs -- ntn-only, NO MCP,
REM NO claude -p. This REPLACES the old claude -p + scripts/notion-health-prompt.md step
REM (that prompt is now DEPRECATED, kept on disk for reference). The mirror is a mechanical
REM section rewrite, so the LLM round-trip added cost, non-determinism, and the headless-MCP
REM permission-grant footgun (the missing --allowedTools grant silently froze this pipeline
REM for 11 weeks -- see .claude/rules/headless-claude-mcp.md). The node path needs no key
REM clearing and no tool grant. NON-FATAL: a mirror failure NEVER alters %EXIT_CODE% (the
REM python exit captured above); the mjs exits 0 on success/partial by contract.
cd /d C:\Users\david.hayes\continuous-claude

REM node is resolved to an ABSOLUTE path because the Task Scheduler minimal PATH does not
REM include node (the registry steps below reuse these same two vars).
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
set "REGISTRY=C:\Users\david.hayes\continuous-claude\scripts\report-registry"

REM Dated-log capture (since 2026-07-16): keep full stdout+stderr so a no-op is diagnosable.
REM Resolve the date via powershell (System32, always on the Task Scheduler minimal PATH);
REM fall back to last-run.log. Set lines stay ABOVE the parenthesized block below -- batch
REM parse-time-expands every %VAR% when it parses the whole block, so a `set` INSIDE the
REM block would be too late (same mechanism as the %ERRORLEVEL% note in the registry step).
set "NLOG_DIR=C:\Users\david.hayes\.claude\logs\health-check"
if not exist "%NLOG_DIR%" mkdir "%NLOG_DIR%"
set "NLOG_DATE="
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "(Get-Date).ToString('yyyy-MM-dd')"`) do set "NLOG_DATE=%%d"
if defined NLOG_DATE (set "NLOG=%NLOG_DIR%\%NLOG_DATE%.log") else (set "NLOG=%NLOG_DIR%\last-run.log")
set "HEALTH_MIRROR=%REGISTRY%\health-mirror.mjs"

if exist "%HEALTH_MIRROR%" (
    echo [%date% %time%] Mirroring results to Notion dashboard... log=%NLOG%
    "%NODE%" "%HEALTH_MIRROR%" > "%NLOG%" 2>&1
    REM The captured log's final line (health-mirror: OK/PARTIAL ...) is the real outcome.
    echo [%date% %time%] Notion mirror step finished ^(non-fatal^). log=%NLOG%
) else (
    echo [%date% %time%] WARN: %HEALTH_MIRROR% not found -- skipping Notion mirror.
)

REM --- Report Runs registry (T3.5) ---
REM FINAL step, NON-FATAL: map the health check exit code to a registry Status, build a
REM report-run.json via make-run.mjs, then upsert it. This must NEVER change %EXIT_CODE%
REM (captured above and untouched below). %NODE% and %REGISTRY% were resolved above (the
REM Notion mirror step) to absolute paths -- the Task Scheduler minimal PATH lacks node.
REM Map exit code -> Status, DEFAULTING TO THE WORSE state (T6.1 #3): an unrecognized or
REM unexpected nonzero code (2, 3, 9009 command-not-found, or anything else) must NOT be
REM silently recorded as OK. Order matters: start OK, downgrade ANY nonzero to Failed, then
REM upgrade ONLY the known warnings-code 1 to Warn. Net: 0->OK, 1->Warn, everything-else->Failed.
set "RUNSTATUS=OK"
if not "%EXIT_CODE%"=="0" set "RUNSTATUS=Failed"
if "%EXIT_CODE%"=="1" set "RUNSTATUS=Warn"

REM period = today's date YYYY-MM-DD, built locale-independently via PowerShell (System32,
REM always on PATH). RUNJSON is cleared first so a make-run failure cannot upsert a stale file.
for /f %%D in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%D"
set "RUNJSON=%TEMP%\report-run-Health-Check.json"
if exist "%RUNJSON%" del /q "%RUNJSON%"

echo [%date% %time%] Emitting health-check report run (status=%RUNSTATUS%)...
"%NODE%" "%REGISTRY%\make-run.mjs" --type "System Health" --source "Health-Check" --status "%RUNSTATUS%" --period "%TODAY%" --artifactUrl "https://www.notion.so/innovativemusings/CCv3-Weekly-Health-Checks-34c76fd7ac8280a984afc486a9844290" --summary "health check exit=%EXIT_CODE% status=%RUNSTATUS%" --out "%RUNJSON%"
if exist "%RUNJSON%" "%NODE%" "%REGISTRY%\upsert.mjs" "%RUNJSON%"
echo [%date% %time%] Registry emit/upsert finished (non-fatal).

REM --- Report Runs drift check (T4.2 wired to schedule, T6.1 #7) ---
REM FINAL non-fatal step: run the freshness/drift detector so a report type that silently
REM stopped landing rows gets flagged here (it exits nonzero when any type is stale). This
REM must NEVER change %EXIT_CODE% -- that is captured above and untouched; the final
REM exit /b uses it regardless of what check-drift returns.
echo [%date% %time%] Running report-registry drift check...
"%NODE%" "%REGISTRY%\check-drift.mjs"
echo [%date% %time%] Drift check finished exit=%ERRORLEVEL% (non-fatal).

REM Exit code contract:
REM   0 = all pass
REM   1 = warnings only
REM   2 = HIGH severity failure
REM   3 = CRITICAL severity failure
REM The next Claude Code session will find the JSON/MD reports in .claude/cache/health-checks/
REM and the memory-awareness hook will surface any stored learnings from the run.

exit /b %EXIT_CODE%
