@echo off
REM AIWeeklyReport wrapper.
REM The "AIWeeklyReport" scheduled task (Weekly Thu 06:00) previously ran `python ...weekly_run.py`,
REM but `python` is not on the Task Scheduler's minimal PATH -- it failed every week with
REM 0x80070002 (FILE_NOT_FOUND) for ~4 months and never launched Python. This wrapper resolves the
REM full Python path, sets the working directory, and logs all stdout/stderr to a durable file.
REM
REM API-KEY POLARITY: this task is the OPPOSITE of the project-cards sweep. The VP report
REM REQUIRES ANTHROPIC_API_KEY to be SET (for AI-written narratives); the sweep requires it
REM UNSET so the claude.ai Notion connector loads. Do NOT "fix" one by copying the other's
REM env handling -- their key polarities are intentionally inverted.
set "PY=C:\Users\david.hayes\AppData\Local\Programs\Python\Python313\python.exe"
set "REPORT_DIR=C:\Users\david.hayes\continuous-claude\ai-report-card"
set "LOG=%REPORT_DIR%\logs\scheduled-run.log"

cd /d "%REPORT_DIR%"
echo [%date% %time%] AIWeeklyReport starting >> "%LOG%" 2>&1

REM mit #4: the Task Scheduler process env may lack ANTHROPIC_API_KEY if the key was set at
REM User scope AFTER last logon. If it is missing, source it from the User-scope registry
REM (HKCU\Environment) so a freshly-set key still reaches this run.
if not defined ANTHROPIC_API_KEY (
  for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v ANTHROPIC_API_KEY 2^>nul ^| findstr /i ANTHROPIC_API_KEY') do set "ANTHROPIC_API_KEY=%%B"
)

REM mit #4 + #5: fail loud (before Python) if the key is genuinely absent everywhere. Passing
REM --allow-template (forwarded via %* below) intentionally BYPASSES this preflight to force a
REM clearly-marked template report.
echo %* | findstr /i /c:"--allow-template" >nul
if errorlevel 1 (
  if not defined ANTHROPIC_API_KEY (
    echo [%date% %time%] [ERROR] ANTHROPIC_API_KEY not set -- the VP report needs it SET ^(User-scope env^). Pass --allow-template to force a template report. >> "%LOG%" 2>&1
    echo [ERROR] ANTHROPIC_API_KEY not set -- the VP report needs it SET. Pass --allow-template to force a template report.
    exit /b 3
  )
)

REM Clear any stale report-run.json from a PRIOR run so a FAILED run this week can never
REM re-upsert last week's success. weekly_run.py rewrites it only when a report is produced.
set "RUNJSON=%TEMP%\report-run-AIWeeklyReport.json"
if exist "%RUNJSON%" del /q "%RUNJSON%"

REM mit #5: forward args (%*) so --allow-template (and any future flags) actually reach
REM weekly_run.py. Previously there was no %*, so passed flags were silently dropped.
"%PY%" scripts\weekly_run.py %* >> "%LOG%" 2>&1
set "EC=%ERRORLEVEL%"
echo [%date% %time%] AIWeeklyReport finished exit=%EC% >> "%LOG%" 2>&1

REM --- Report Runs registry (T3.2) ---
REM FINAL step, NON-FATAL: if weekly_run.py emitted report-run.json, upsert it into the
REM Report Runs Notion DB. A registry outage must NEVER change this task's exit code, so we
REM never touch %EC% here. node is resolved to an ABSOLUTE path because Task Scheduler's
REM minimal PATH does not include node (same reason %PY% is hardcoded above).
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
set "REGISTRY=C:\Users\david.hayes\continuous-claude\scripts\report-registry"

REM Resolve the ISO period (YYYY-Www) ONCE so the crash-path below can synthesize a Failed
REM row even when weekly_run.py never emitted report-run.json. PowerShell is always on the
REM System32 PATH; -UFormat %%Y-W%%V yields calendar-year + ISO-week -- the SAME format
REM weekly_run.py uses (datetime.year + isocalendar week), so the row lines up. In a .bat the
REM literal percents must be doubled (%%Y/%%V); the loop var is %%P to avoid colliding with them.
set "PERIOD="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "Get-Date -UFormat '%%Y-W%%V'"`) do set "PERIOD=%%P"

if exist "%RUNJSON%" (
  echo [%date% %time%] Upserting report run into registry... >> "%LOG%" 2>&1
  "%NODE%" "%REGISTRY%\upsert.mjs" "%RUNJSON%" >> "%LOG%" 2>&1
  echo [%date% %time%] Registry upsert finished exit=%ERRORLEVEL% ^(non-fatal^) >> "%LOG%" 2>&1
) else if not "%EC%"=="0" (
  REM weekly_run.py exited nonzero and produced NO report-run.json -- a crash or an early
  REM exit BEFORE emit (e.g. the API-key sys.exit^(2^)). Synthesize a Failed row so the
  REM failure still lands in the registry. NON-FATAL: %EC% is captured above and never touched.
  if defined PERIOD (
    echo [%date% %time%] python exited %EC% with no report-run.json -- synthesizing a Failed registry row... >> "%LOG%" 2>&1
    "%NODE%" "%REGISTRY%\make-run.mjs" --type "VP Weekly" --source "AIWeeklyReport" --status "Failed" --period "%PERIOD%" --summary "weekly_run.py exited %EC% before emitting report-run.json" --out "%RUNJSON%" >> "%LOG%" 2>&1
    if exist "%RUNJSON%" "%NODE%" "%REGISTRY%\upsert.mjs" "%RUNJSON%" >> "%LOG%" 2>&1
    echo [%date% %time%] Synthesized failure-row upsert finished exit=%ERRORLEVEL% ^(non-fatal^) >> "%LOG%" 2>&1
  ) else (
    echo [%date% %time%] could not resolve PERIOD -- skipping synthesized failure row ^(non-fatal^) >> "%LOG%" 2>&1
  )
)

exit /b %EC%
