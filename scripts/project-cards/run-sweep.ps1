# CCv3 Project Cards daily sweep -- Windows Task Scheduler entry point.
# Refreshes every FourthOS project card (zero-LLM deterministic assemble) and, for any
# card that changed or is unpublished, republishes its interactive embed; then refreshes
# the Reporting Hub gallery table. The one non-deterministic step (bind HTML upload to a
# Notion embed) runs via headless `claude -p` + the claude.ai Notion connector.
#
# Manual run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\project-cards\run-sweep.ps1
# Any extra args (e.g. --target mobile-cockpit) pass straight through to sweep.mjs.
$ErrorActionPreference = 'Stop'

$repo = 'C:\Users\david.hayes\continuous-claude'
Set-Location $repo

# The Notion connector is DISABLED whenever ANTHROPIC_API_KEY is set (it takes precedence
# over the claude.ai subscription login). Unset it so `claude -p` loads the connector.
# sweep.mjs also strips it for each spawned claude; unsetting here matches the CCv3
# scheduled-task convention and keeps the whole process tree clean. Harmless if unset.
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

$date   = Get-Date -Format 'yyyy-MM-dd'
$logDir = Join-Path $repo '.claude\logs\project-cards'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "$date.log"

"[$(Get-Date -Format o)] CCv3-Project-Cards sweep starting" | Tee-Object -FilePath $log -Append

# sweep.mjs logs progress to stderr and spawns claude/ntn that also write stderr. Under
# ErrorActionPreference='Stop', a native command's stderr (via 2>&1) is raised as a
# terminating NativeCommandError and would abort the wrapper on benign log output. Gate
# success on the process exit code instead, so real failures still surface (code != 0).
$ErrorActionPreference = 'Continue'
# 2>&1 also wraps each stderr line as an ErrorRecord; Tee/host then renders it with error
# formatting (red "NativeCommandError" + CategoryInfo block) even under 'Continue', making
# benign progress logs look like failures. Stringify each record ("$_") before Tee so it
# lands as a plain log line. $LASTEXITCODE still reflects node's exit code (cmdlets don't
# reset it), so exit-code gating below is unaffected.
& node (Join-Path $repo 'scripts\project-cards\sweep.mjs') @args 2>&1 |
    ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
"[$(Get-Date -Format o)] sweep exited (code=$code)" | Tee-Object -FilePath $log -Append
exit $code
