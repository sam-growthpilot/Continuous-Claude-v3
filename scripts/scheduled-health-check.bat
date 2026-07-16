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

REM --- Notion dashboard update ---
REM After the Python run, mirror the results onto the CCv3 Weekly Health Checks Notion page.
REM This runs claude -p in non-interactive mode with the prompt at scripts/notion-health-prompt.md.
REM The prompt is deliberately read-only from the health check's perspective (it only touches
REM Notion). If claude -p fails, we log but do not alter EXIT_CODE -- the Python artifacts on
REM disk remain authoritative and the scheduled task still reports health status correctly.
cd /d C:\Users\david.hayes\continuous-claude
set NOTION_PROMPT=scripts\notion-health-prompt.md

REM Log capture (since 2026-07-16): the claude -p Notion step discarded stdout for ~11
REM weeks, hiding a silent failure. Every run recorded SKIP reason=mcp-unavailable, which
REM was actually a PERMISSION-DENIED on the claude.ai Notion MCP tool in non-interactive
REM mode (the connector loads and OAuth is valid, but headless claude -p auto-denies any
REM tool not granted via --allowedTools / a settings allow-list). Capture full stdout+stderr
REM to a dated log so a no-op is diagnosable. Resolve the date via powershell (System32,
REM always on the Task Scheduler minimal PATH); fall back to last-run.log. This capture
REM NEVER alters %EXIT_CODE% (the python exit captured above); the Notion step stays non-fatal.
set "NLOG_DIR=C:\Users\david.hayes\.claude\logs\health-check"
if not exist "%NLOG_DIR%" mkdir "%NLOG_DIR%"
set "NLOG_DATE="
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "(Get-Date).ToString('yyyy-MM-dd')"`) do set "NLOG_DATE=%%d"
if defined NLOG_DATE (set "NLOG=%NLOG_DIR%\%NLOG_DATE%.log") else (set "NLOG=%NLOG_DIR%\last-run.log")

if exist %NOTION_PROMPT% (
    echo [%date% %time%] Posting results to Notion dashboard... log=%NLOG%
    REM claude -p must auth via the claude.ai subscription login, NOT the invalid ANTHROPIC_API_KEY
    REM in the environment (it 401s and takes precedence). Clear it for this process only.
    REM NOTE: clearing the key is necessary but NOT sufficient -- headless claude -p also
    REM needs the Notion MCP tools granted, or the call is auto-denied (see the dated log).
    set "ANTHROPIC_API_KEY="
    REM Scoped grant (root-caused 2026-07-16): headless claude -p auto-denies ungranted
    REM MCP tools; this permission gap -- not connector unavailability -- froze the
    REM Notion mirror for 11 weeks.
    set "HEALTH_TOOLS=mcp__claude_ai_Notion__notion-fetch,mcp__claude_ai_Notion__notion-search,mcp__claude_ai_Notion__notion-update-page"
    type %NOTION_PROMPT% | call claude -p --output-format text --allowedTools "%HEALTH_TOOLS%,Read,Glob,Grep,Bash" > "%NLOG%" 2>&1
    REM %ERRORLEVEL% inside this block parse-time-expands to the pre-block value, so it is
    REM not echoed; the captured log's final line (OK/SKIP/FAILED) is the real outcome.
    echo [%date% %time%] Notion update step finished ^(non-fatal^). log=%NLOG%
) else (
    echo [%date% %time%] WARN: %NOTION_PROMPT% not found -- skipping Notion update.
)

REM --- Report Runs registry (T3.5) ---
REM FINAL step, NON-FATAL: map the health check exit code to a registry Status, build a
REM report-run.json via make-run.mjs, then upsert it. This must NEVER change %EXIT_CODE%
REM (captured above and untouched below). node is resolved to an ABSOLUTE path because the
REM Task Scheduler minimal PATH does not include node.
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
set "REGISTRY=C:\Users\david.hayes\continuous-claude\scripts\report-registry"
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
