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
"[$(Get-Date -Format o)] dashboard-sync finished (exit=$LASTEXITCODE)" | Tee-Object -FilePath $log -Append
