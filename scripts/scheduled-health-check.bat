@echo off
REM Weekly CCv3 health check
REM Registered in Windows Task Scheduler as "CCv3-Health-Check"
REM Runs every Friday at 08:03am (local time)
REM Output files land in C:\Users\david.hayes\continuous-claude\.claude\cache\health-checks\
REM Run manually: schtasks /run /tn "CCv3-Health-Check"

cd /d C:\Users\david.hayes\continuous-claude\opc
set PYTHONPATH=.

echo [%date% %time%] Starting CCv3 weekly health check...

call uv run python scripts\health_check.py
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

if exist %NOTION_PROMPT% (
    echo [%date% %time%] Posting results to Notion dashboard...
    type %NOTION_PROMPT% | call claude -p --output-format text
    echo [%date% %time%] Notion update step finished.
) else (
    echo [%date% %time%] WARN: %NOTION_PROMPT% not found -- skipping Notion update.
)

REM Exit code contract:
REM   0 = all pass
REM   1 = warnings only
REM   2 = HIGH severity failure
REM   3 = CRITICAL severity failure
REM The next Claude Code session will find the JSON/MD reports in .claude/cache/health-checks/
REM and the memory-awareness hook will surface any stored learnings from the run.

exit /b %EXIT_CODE%
