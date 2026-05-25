# run-judge-batch.ps1 — daily Braintrust judge batch (Gate C, Phase 3b)
#
# Scheduled via Windows Task Scheduler job "CCv3-Judge-Batch" (daily 06:15).
# Runs judge_session.py against sessions since the previous day.
#
# MUST run locally: the judges use codex/claude subscription-OAuth CLIs
# (no API keys), which only exist on this machine. A remote /schedule
# routine or a Braintrust UI rule cannot invoke them.
#
# Inspect / control:
#   schtasks /query  /tn "CCv3-Judge-Batch" /v /fo list
#   schtasks /run    /tn "CCv3-Judge-Batch"          # trigger a live run now
#   schtasks /delete /tn "CCv3-Judge-Batch" /f       # remove
# Log: .claude/logs/judge-batch.log

$ErrorActionPreference = "Stop"

$repo    = "C:\Users\david.hayes\continuous-claude"
$opc     = Join-Path $repo "opc"
$logDir  = Join-Path $repo ".claude\logs"
$logFile = Join-Path $logDir "judge-batch.log"
$since   = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")

# Resolve uv (PATH may differ under Task Scheduler)
$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $uv) { $uv = "C:\Users\david.hayes\AppData\Local\Programs\Python\Python313\Scripts\uv.exe" }

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force $logDir | Out-Null }

function Write-Log($msg) {
    $stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
    Add-Content -Path $logFile -Value "[$stamp] $msg"
}

Write-Log "START judge batch --scan-since $since --max-sessions 10 (uv: $uv)"

Set-Location $opc
& $uv run python -m scripts.core.judge_session --scan-since $since --max-sessions 10 2>&1 |
    ForEach-Object { Add-Content -Path $logFile -Value $_ }
$code = $LASTEXITCODE

Write-Log "END exit=$code"
exit $code
