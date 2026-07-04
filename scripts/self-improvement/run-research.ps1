# CCv3 Self-Improvement Research Loop -- daily wrapper (Windows Task Scheduler entry point).
# Picks the next component (round-robin), hands a headless CCv3 session a research /goal,
# and records the resulting proposal. RESEARCH + PROPOSE ONLY -- the headless session is
# constrained to a read + write-to-docs toolset and never edits code.
#
# Manual run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\self-improvement\run-research.ps1
$ErrorActionPreference = 'Stop'

$repo = 'C:\Users\david.hayes\continuous-claude'
$si   = Join-Path $repo 'scripts\self-improvement'
Set-Location $repo

# claude -p must authenticate via the claude.ai subscription login, NOT the ANTHROPIC_API_KEY
# that is present in this environment (it is invalid / 401s and takes precedence over the login).
# Unset it for this process so the headless session falls back to the subscription. Harmless if unset.
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

# Research-session scope guard [N3]: this unattended session writes ONLY to docs/self-improvement
# (prompt-fenced) and its claude -p allowlist below excludes every Notion MCP tool. As defence in
# depth, scrub NOTION_* from the environment so nothing downstream (including any ntn reached via the
# allowed Bash tool) can pick up a Notion token. ntn is not on PATH in this context; its keychain
# creds are deliberately left untouched but are unreachable without the absolute exe path, which the
# prompt never provides. Any future digest push to Notion MUST run in THIS parent process AFTER
# claude -p returns — never inside the subprocess.
Get-ChildItem Env: | Where-Object { $_.Name -like 'NOTION_*' } | ForEach-Object { Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue }

$date   = Get-Date -Format 'yyyy-MM-dd'
$logDir = Join-Path $repo '.claude\logs\self-improvement'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "$date.log"

function Log($msg) { "[$(Get-Date -Format o)] $msg" | Tee-Object -FilePath $log -Append }

Log "Self-improvement research run starting (date=$date)"

# 1) Deterministic round-robin component selection (advances state.json)
$componentJson = & node (Join-Path $si 'select-component.mjs')
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($componentJson)) {
  Log "ABORT: select-component.mjs failed (exit=$LASTEXITCODE)"; exit 1
}
$c = $componentJson | ConvertFrom-Json
Log "Selected component: $($c.id) -- $($c.name)"

# 2) Render the research goal prompt (literal string replacement, not regex)
$tpl = Get-Content -Raw (Join-Path $si 'research-goal.md')
$prompt = $tpl.
  Replace('{{DATE}}', $date).
  Replace('{{COMPONENT_ID}}', [string]$c.id).
  Replace('{{COMPONENT_NAME}}', [string]$c.name).
  Replace('{{COMPONENT_SUMMARY}}', [string]$c.summary).
  Replace('{{CURRENT_IMPL}}', (($c.currentImpl) -join ', ')).
  Replace('{{FRONTIER_HINTS}}', (($c.frontierHints) -join ', '))

$promptFile = Join-Path $env:TEMP "ccv3-si-prompt-$date.txt"
Set-Content -Path $promptFile -Value $prompt -Encoding utf8

# 3) Headless CCv3 research session. --allowedTools is an explicit allowlist:
#    read/search/write/bash/web/delegate/skill. Edit is intentionally EXCLUDED so the
#    session cannot modify existing code; destructive Bash is still blocked by the
#    destructive-command-guard hook. Prompt fences all writes to docs/self-improvement/.
Log "Invoking headless claude -p (allowlisted toolset)"
Get-Content -Raw $promptFile |
  & claude -p --allowedTools "Read,Grep,Glob,Write,Bash,WebSearch,WebFetch,Task,Skill" 2>&1 |
  Tee-Object -FilePath $log -Append
$claudeExit = $LASTEXITCODE
Log "claude -p exited (code=$claudeExit)"

# 4) Record the INDEX row deterministically (non-fatal if the proposal is missing)
& node (Join-Path $si 'record-index.mjs') $date $c.id 2>&1 | Tee-Object -FilePath $log -Append
$recordExit = $LASTEXITCODE

$proposal = "docs/self-improvement/proposals/$date-$($c.id).md"
if ($recordExit -eq 0) {
  Log "Done. Proposal: $proposal"
  exit 0
} else {
  Log "WARN: proposal not recorded (record-index exit=$recordExit). Check the log + $proposal."
  exit $recordExit
}
