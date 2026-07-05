@echo off
REM AIWeeklyReport wrapper.
REM The "AIWeeklyReport" scheduled task (Weekly Fri 06:00) previously ran `python ...weekly_run.py`,
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

REM mit #5: forward args (%*) so --allow-template (and any future flags) actually reach
REM weekly_run.py. Previously there was no %*, so passed flags were silently dropped.
"%PY%" scripts\weekly_run.py %* >> "%LOG%" 2>&1
set "EC=%ERRORLEVEL%"
echo [%date% %time%] AIWeeklyReport finished exit=%EC% >> "%LOG%" 2>&1
exit /b %EC%
