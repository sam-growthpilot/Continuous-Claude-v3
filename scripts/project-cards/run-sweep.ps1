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

# Every Tee-Object below pins -Encoding utf8: Windows PowerShell 5.1's Tee-Object
# defaults to UTF-16 (Unicode) for a NEW file, which made these daily logs
# unreadable to grep/`cat`/Node's fs.readFileSync('utf8') without an explicit
# iconv/PowerShell-based read. Log filenames are date-stamped (one file/day), so
# the switch takes effect cleanly on the next new day's file -- no mid-file
# encoding split on existing logs.
"[$(Get-Date -Format o)] CCv3-Project-Cards sweep starting" | Tee-Object -FilePath $log -Append -Encoding utf8

# T3.1: the sweep emits a Project Portfolio report-run.json to $TEMP for the
# registry spine. Remove any stale emit from a prior run FIRST so the final
# upsert step below only fires when THIS run actually emitted (a --dry-run or a
# mobile-cockpit/triage sub-target emits nothing -- the file stays absent and the
# upsert is skipped, never re-upserting a stale record).
$emitFile = Join-Path $env:TEMP 'report-run-Project-Cards.json'
Remove-Item $emitFile -ErrorAction SilentlyContinue

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
    ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append -Encoding utf8
$code = $LASTEXITCODE
"[$(Get-Date -Format o)] sweep exited (code=$code)" | Tee-Object -FilePath $log -Append -Encoding utf8

# T3.1 FINAL step: upsert the emitted report-run.json into the Report Runs
# registry. NON-FATAL by contract -- the registry is observability, not the
# sweep's product, so a registry outage must NEVER change the sweep's exit code.
# Only runs when the sweep actually emitted the file (full real sweep); wrapped in
# try/catch and never touches $code.
# T6.1 #8: resolve an absolute node path for the registry call (the .bat wrappers
# hardcode it because Task Scheduler's minimal PATH omits node; the .ps1 empirically
# resolves bare node today, but harden for parity).
$node = if (Test-Path 'C:\Program Files\nodejs\node.exe') { 'C:\Program Files\nodejs\node.exe' } else { 'node' }
if (Test-Path $emitFile) {
    try {
        & $node (Join-Path $repo 'scripts\report-registry\upsert.mjs') $emitFile 2>&1 |
            ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append -Encoding utf8
        "[$(Get-Date -Format o)] report-run upsert exit=$LASTEXITCODE (non-fatal)" | Tee-Object -FilePath $log -Append -Encoding utf8
    } catch {
        "[$(Get-Date -Format o)] report-run upsert threw (non-fatal): $_" | Tee-Object -FilePath $log -Append -Encoding utf8
    }

    # T7.1 FINAL step: refresh the 6 report child pages' "Current run" callouts +
    # the Reports hub launcher from the newest registry row per type. Deterministic
    # (ntn-only, NO MCP), READ-then-splice -- never touches the human hub narrative
    # or the History linked views. NON-FATAL by the same contract as the upsert: the
    # page refresh is observability, not the sweep's product, so it must NEVER change
    # $code. Runs only on a full real sweep (gated by $emitFile, same as the upsert)
    # and AFTER the upsert, so it reflects this run's just-upserted Project Portfolio
    # row. Wrapped in try/catch; never touches $code.
    try {
        & $node (Join-Path $repo 'scripts\report-registry\refresh-pages.mjs') 2>&1 |
            ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append -Encoding utf8
        "[$(Get-Date -Format o)] report-page refresh exit=$LASTEXITCODE (non-fatal)" | Tee-Object -FilePath $log -Append -Encoding utf8
    } catch {
        "[$(Get-Date -Format o)] report-page refresh threw (non-fatal): $_" | Tee-Object -FilePath $log -Append -Encoding utf8
    }
} else {
    "[$(Get-Date -Format o)] no report-run.json emitted (dry-run or sub-target) -- skipping registry upsert + page refresh" | Tee-Object -FilePath $log -Append -Encoding utf8
}

exit $code
