# CCv3 Scheduled-Tasks dashboard daily refresh.
# Registered as the "CCv3-Dashboard-Sync" task (daily 20:00). Pipes the refresh prompt into a headless
# claude -p that re-inventories the tasks (Get-ScheduledTask) and updates the Notion "Reports" dashboard
# (page 38f76fd7...) via the claude.ai Notion MCP -- reachability proven 2026-06-30.
#
# Manual run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sync-tasks-dashboard.ps1
$ErrorActionPreference = 'Continue'

$repo = 'C:\Users\david.hayes\continuous-claude'
Set-Location $repo

# claude -p must auth via the claude.ai subscription login (the Notion MCP rides that OAuth), NOT a
# stale ANTHROPIC_API_KEY in the environment.
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

$date   = Get-Date -Format 'yyyy-MM-dd'
$logDir = Join-Path $repo '.claude\logs\dashboard-sync'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log    = Join-Path $logDir "$date.log"
$prompt = Join-Path $repo 'scripts\sync-tasks-dashboard-prompt.md'

"[$(Get-Date -Format o)] dashboard-sync starting" | Tee-Object -FilePath $log -Append
Get-Content -Raw $prompt |
  & claude -p --allowedTools "Bash,ReadMcpResourceTool,mcp__claude_ai_Notion__notion-fetch,mcp__claude_ai_Notion__notion-update-page" 2>&1 |
  Tee-Object -FilePath $log -Append
# Capture the claude -p exit code FIRST -- before any cmdlet/native call below can
# perturb $LASTEXITCODE (premortem X3: the registry Status needs a reliable signal).
$code = $LASTEXITCODE
"[$(Get-Date -Format o)] dashboard-sync finished (exit=$code)" | Tee-Object -FilePath $log -Append

# --- Report Runs registry (T3.4): non-fatal final step. --------------------------
# Status is synthesized DETERMINISTICALLY from the captured exit code (0 -> OK,
# nonzero -> Warn), NOT from the claude -p prompt output. Wrapped in try/catch so a
# registry outage can NEVER change $code -- the registry is observability, not the
# dashboard's product.
try {
  $status = if ($code -eq 0) { 'OK' } else { 'Warn' }
  $emit = & node (Join-Path $repo 'scripts\report-registry\make-run.mjs') `
    --type 'Team Dashboard' --source 'Dashboard-Sync' --period $date --status $status `
    --artifactUrl 'https://www.notion.so/38f76fd7ac8280478e50dd2956ba6e8a' `
    --summary "scheduled-tasks section refreshed (exit=$code)"
  $emit = ($emit | Select-Object -Last 1)
  if ($LASTEXITCODE -eq 0 -and $emit) {
    & node (Join-Path $repo 'scripts\report-registry\upsert.mjs') $emit 2>&1 |
      ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append
    "[$(Get-Date -Format o)] report-run upsert exit=$LASTEXITCODE (non-fatal)" | Tee-Object -FilePath $log -Append
  } else {
    "[$(Get-Date -Format o)] make-run emitted no path (exit=$LASTEXITCODE) -- skipping upsert" | Tee-Object -FilePath $log -Append
  }
} catch {
  "[$(Get-Date -Format o)] report-run registry step threw (non-fatal): $_" | Tee-Object -FilePath $log -Append
}

# X3 fix: the script previously logged $LASTEXITCODE but never `exit`ed with it, so
# Task Scheduler always recorded success. Exit with the captured claude -p code so
# the scheduler's Last Run Result and the registry Status agree on the outcome.
exit $code
