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

# Every Tee-Object below pins -Encoding utf8: Windows PowerShell 5.1's Tee-Object
# defaults to UTF-16 (Unicode) for a NEW file, which made these daily logs
# unreadable to grep/`cat`/Node's fs.readFileSync('utf8') without an explicit
# iconv/PowerShell-based read (same fix as project-cards/run-sweep.ps1).
"[$(Get-Date -Format o)] dashboard-sync starting" | Tee-Object -FilePath $log -Append -Encoding utf8
Get-Content -Raw $prompt |
  & claude -p --allowedTools "Bash,ReadMcpResourceTool,mcp__claude_ai_Notion__notion-fetch,mcp__claude_ai_Notion__notion-update-page" 2>&1 |
  Tee-Object -FilePath $log -Append -Encoding utf8
# Capture the claude -p exit code FIRST -- before any cmdlet/native call below can
# perturb $LASTEXITCODE (premortem X3: the registry Status needs a reliable signal).
$code = $LASTEXITCODE
"[$(Get-Date -Format o)] dashboard-sync finished (exit=$code)" | Tee-Object -FilePath $log -Append -Encoding utf8

# --- Post-write verification (non-fatal, read-only): confirm the write actually
# landed server-side before the registry records OK. A `claude -p` exit=0 proves
# the session finished, not that the Notion write happened (a no-op/skip inside
# the session still exits 0). Read the page back via ntn (stdin closed -> no
# hang, per notion-cli-safety.md) and look for the section's own capture-stamp
# marker line (sync-tasks-dashboard-prompt.md step 4: the italic
# "*Statuses below captured <date>*" line) carrying TODAY's date.
$verifyOk = $false
$verifyReason = 'not-attempted'
if ($code -eq 0) {
  try {
    $ntnExe = 'C:/Users/david.hayes/AppData/Local/Microsoft/WinGet/Packages/Notion.ntn_Microsoft.Winget.Source_8wekyb3d8bbwe/ntn-x86_64-pc-windows-msvc/ntn.exe'
    $pageId = '38f76fd7ac8280478e50dd2956ba6e8a'
    if (-not (Test-Path $ntnExe)) {
      $verifyReason = "ntn.exe not found at $ntnExe"
    } else {
      $psi = [System.Diagnostics.ProcessStartInfo]::new()
      $psi.FileName = $ntnExe
      foreach ($a in @('pages', 'get', $pageId)) { $psi.ArgumentList.Add($a) }
      $psi.RedirectStandardInput = $true
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      $psi.UseShellExecute = $false
      $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
      $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
      $p = [System.Diagnostics.Process]::Start($psi)
      $p.StandardInput.Close() # EOF on stdin -- prevents the documented ntn open-stdin hang
      $outTask = $p.StandardOutput.ReadToEndAsync()
      $errTask = $p.StandardError.ReadToEndAsync()
      if (-not $p.WaitForExit(30000)) {
        try { $p.Kill($true) } catch {}
        $verifyReason = 'ntn pages get timed out after 30000ms'
      } else {
        $pageMd = $outTask.GetAwaiter().GetResult()
        $ntnErr = $errTask.GetAwaiter().GetResult()
        if ($p.ExitCode -ne 0) {
          $verifyReason = "ntn pages get exit=$($p.ExitCode): $ntnErr"
        } else {
          $markerLine = ($pageMd -split "`r?`n") | Where-Object { $_ -match 'Statuses below captured' } | Select-Object -First 1
          # Accept either date rendering the prompt might produce -- ISO (yyyy-MM-dd,
          # what $date already is) or a humanized "d MMM yyyy" -- rather than assume
          # one exact literal format never drifts.
          $todayHuman = Get-Date -Format 'd MMM yyyy'
          if ($markerLine -and ($markerLine -match [regex]::Escape($date) -or $markerLine -match [regex]::Escape($todayHuman))) {
            $verifyOk = $true
            $verifyReason = 'capture stamp confirmed'
          } elseif ($markerLine) {
            $verifyReason = "capture stamp stale/unrecognized: $markerLine"
          } else {
            $verifyReason = 'capture-stamp marker line not found on page'
          }
        }
      }
    }
  } catch {
    $verifyReason = "verify threw (non-fatal): $_"
  }
} else {
  $verifyReason = "claude -p exited nonzero ($code) -- skipped verify"
}
"[$(Get-Date -Format o)] post-write verify: ok=$verifyOk reason=$verifyReason" | Tee-Object -FilePath $log -Append -Encoding utf8

# --- Report Runs registry (T3.4): non-fatal final step. --------------------------
# Status is synthesized DETERMINISTICALLY from the captured exit code AND the
# post-write verification above (0 exit alone is NOT sufficient for OK -- a
# verify failure records Warn with the verify reason so a silent no-op doesn't
# read as a healthy sync).
try {
  # T6.1 #8: resolve an absolute node path for the registry make-run/upsert calls
  # (parity with the .bat wrappers, which must hardcode it under Task Scheduler's
  # minimal PATH). Harmless when bare node already resolves.
  $node = if (Test-Path 'C:\Program Files\nodejs\node.exe') { 'C:\Program Files\nodejs\node.exe' } else { 'node' }
  $status = if ($code -eq 0 -and $verifyOk) { 'OK' } else { 'Warn' }
  $summary = "scheduled-tasks section refreshed (exit=$code); verify: $verifyReason"
  $emit = & $node (Join-Path $repo 'scripts\report-registry\make-run.mjs') `
    --type 'Team Dashboard' --source 'Dashboard-Sync' --period $date --status $status `
    --artifactUrl 'https://www.notion.so/38f76fd7ac8280478e50dd2956ba6e8a' `
    --summary $summary
  $emit = ($emit | Select-Object -Last 1)
  if ($LASTEXITCODE -eq 0 -and $emit) {
    & $node (Join-Path $repo 'scripts\report-registry\upsert.mjs') $emit 2>&1 |
      ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append -Encoding utf8
    "[$(Get-Date -Format o)] report-run upsert exit=$LASTEXITCODE (non-fatal)" | Tee-Object -FilePath $log -Append -Encoding utf8
  } else {
    "[$(Get-Date -Format o)] make-run emitted no path (exit=$LASTEXITCODE) -- skipping upsert" | Tee-Object -FilePath $log -Append -Encoding utf8
  }
} catch {
  "[$(Get-Date -Format o)] report-run registry step threw (non-fatal): $_" | Tee-Object -FilePath $log -Append -Encoding utf8
}

# --- Silent-miss watchdog (T5): non-fatal final step, NEVER touches $code. -------
# Sweeps ALL 6 report types (not just Team Dashboard's own row above) -- checks
# each type's expected-period-by-deadline+grace and upserts a Failed miss-row
# when a scheduled run never launched or was killed mid-flight, leaving ZERO
# registry rows (the append-per-attempt model otherwise makes that absence
# invisible). Real run (writes miss-rows when it finds one); wrapped in
# try/catch and its own exit code is only logged, never propagated, so a
# watchdog outage can NEVER change $code or this task's Last Run Result.
try {
  & $node (Join-Path $repo 'scripts\report-registry\watchdog.mjs') 2>&1 |
    ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append -Encoding utf8
  "[$(Get-Date -Format o)] watchdog sweep exit=$LASTEXITCODE (non-fatal)" | Tee-Object -FilePath $log -Append -Encoding utf8
} catch {
  "[$(Get-Date -Format o)] watchdog sweep threw (non-fatal): $_" | Tee-Object -FilePath $log -Append -Encoding utf8
}

# X3 fix: the script previously logged $LASTEXITCODE but never `exit`ed with it, so
# Task Scheduler always recorded success. Exit with the captured claude -p code so
# the scheduler's Last Run Result and the registry Status agree on the outcome.
exit $code
