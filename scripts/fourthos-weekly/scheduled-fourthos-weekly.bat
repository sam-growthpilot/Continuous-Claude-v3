@echo off
REM Weekly FourthOS sponsor update package (Carly & Christian)
REM Registered in Windows Task Scheduler as "CCv3-FourthOS-Weekly"
REM Runs every Friday at 07:00am (local time)
REM Stages an UNLISTED preview to the ai-enablement-decks GitHub Pages site and pings Dave.
REM It deliberately does NOT promote to the live sponsor URL -- that is Dave's approval step:
REM     node scripts\fourthos-weekly\promote.mjs
REM Run manually: schtasks /run /tn "CCv3-FourthOS-Weekly"

cd /d C:\Users\david.hayes\continuous-claude
set GEN_PROMPT=scripts\fourthos-weekly\generate-prompt.md

echo [%date% %time%] Starting FourthOS weekly sponsor update generation...

if not exist %GEN_PROMPT% (
    echo [%date% %time%] FAIL: %GEN_PROMPT% not found -- aborting.
    exit /b 1
)

REM Feed the generate prompt to a non-interactive claude -p session. The prompt instructs
REM Claude Code to read the FourthOS Notion cockpit, refresh the Tier-3 Update Package page,
REM render the Tier-1 dashboard + Tier-2 deep-dive, stage them to fourthos/preview/ (unlisted),
REM and notify Dave via Slack + a Notion comment. Fail-loud guards live inside the prompt.
REM claude -p must auth via the claude.ai subscription login, not a stale ANTHROPIC_API_KEY in env.
set "ANTHROPIC_API_KEY="
type %GEN_PROMPT% | call claude -p --output-format text
set EXIT_CODE=%ERRORLEVEL%

echo [%date% %time%] FourthOS weekly generation finished. exit=%EXIT_CODE%

REM Exit code contract (mirrors the prompt's final stdout line):
REM   0 = OK (preview staged + Dave notified)  OR  SKIP (Notion MCP unavailable; nothing published)
REM   1 = FAILED (see Slack/Notion notice and fourthos/preview/_ERROR.md in the decks repo)
REM The stable live sponsor deck is never overwritten by this task; promotion is manual.

REM --- Report Runs registry (T3.3): FINAL non-fatal step. -------------------------
REM Resolve an ABSOLUTE node path. A cmd .bat inherits a minimal PATH under Task
REM Scheduler and bare `node` may not resolve (same class of failure that lost 4
REM months to bare `python`). Fall back to bare `node` only if the standard path is
REM absent. This step is observability, not the report's product -- it NEVER changes
REM the exit contract above: EXIT_CODE is already captured, and we still
REM `exit /b %EXIT_CODE%` at the end regardless of what the registry step does.
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

REM Today's date (YYYY-MM-DD). Use powershell (always on the System32 PATH) rather
REM than %date% (locale-formatted) or node-in-`for /f` (the quoted spaced node path
REM breaks cmd's for/f parsing). GUARD: if the date can't be resolved, skip the
REM registry step entirely -- an empty --period would otherwise emit a garbage row.
set "RUN_DATE="
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "(Get-Date).ToString('yyyy-MM-dd')"`) do set "RUN_DATE=%%d"
if not defined RUN_DATE (
    echo [%date% %time%] could not resolve RUN_DATE -- skipping registry upsert ^(non-fatal^)
    exit /b %EXIT_CODE%
)

REM Status synthesized DETERMINISTICALLY from EXIT_CODE (not the claude -p output,
REM which is fragile). exit 0 = OK-or-SKIP -- indistinguishable from the code alone,
REM so recorded as OK; exit 1 = Failed.
if "%EXIT_CODE%"=="0" (set "RUN_STATUS=OK") else (set "RUN_STATUS=Failed")

set "RUN_EMIT=%TEMP%\report-run-FourthOS-Weekly.json"
del "%RUN_EMIT%" 2>nul
"%NODE_EXE%" scripts\report-registry\make-run.mjs --type "FourthOS Sponsor" --source "FourthOS-Weekly" --period %RUN_DATE% --status %RUN_STATUS% --artifactUrl "https://rev4nchist.github.io/ai-enablement-decks/fourthos/preview/" --summary "sponsor update staged (exit=%EXIT_CODE%)"
if exist "%RUN_EMIT%" (
    "%NODE_EXE%" scripts\report-registry\upsert.mjs "%RUN_EMIT%"
    echo [%date% %time%] report-run upsert done ^(exit=%ERRORLEVEL%, non-fatal^)
) else (
    echo [%date% %time%] no report-run.json emitted -- skipping registry upsert
)

exit /b %EXIT_CODE%
