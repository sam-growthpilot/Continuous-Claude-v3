@echo off
REM AIWeeklyReport wrapper.
REM The "AIWeeklyReport" scheduled task (Weekly Fri 06:00) previously ran `python ...weekly_run.py`,
REM but `python` is not on the Task Scheduler's minimal PATH -- it failed every week with
REM 0x80070002 (FILE_NOT_FOUND) for ~4 months and never launched Python. This wrapper resolves the
REM full Python path, sets the working directory, and logs all stdout/stderr to a durable file.
set "PY=C:\Users\david.hayes\AppData\Local\Programs\Python\Python313\python.exe"
set "REPORT_DIR=C:\Users\david.hayes\continuous-claude\ai-report-card"
set "LOG=%REPORT_DIR%\logs\scheduled-run.log"

cd /d "%REPORT_DIR%"
echo [%date% %time%] AIWeeklyReport starting >> "%LOG%" 2>&1
"%PY%" scripts\weekly_run.py >> "%LOG%" 2>&1
set "EC=%ERRORLEVEL%"
echo [%date% %time%] AIWeeklyReport finished exit=%EC% >> "%LOG%" 2>&1
exit /b %EC%
