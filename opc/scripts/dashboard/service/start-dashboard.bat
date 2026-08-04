@echo off
REM Start the Session Dashboard service
REM Called by Task Scheduler on logon

cd /d ~\continuous-claude\opc\scripts
~\.local\bin\uv.exe run python -m dashboard.main
