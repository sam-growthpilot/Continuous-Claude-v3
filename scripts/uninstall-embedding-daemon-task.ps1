<#
.SYNOPSIS
  Remove the CCv3-Embedding-Daemon Windows Task Scheduler entry.

.DESCRIPTION
  Deletes the task if it exists. No-op if already absent.
  The running daemon process (if any) is not stopped -- it exits naturally
  on reboot, or kill it by deleting $env:TEMP\ccv3-embedding.json and
  ending the process via Task Manager.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskName = 'CCv3-Embedding-Daemon'

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "Task '$taskName' does not exist -- nothing to do."
    exit 0
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Task '$taskName' removed."
Write-Host ""
Write-Host "The embedding daemon will no longer auto-start at login."
Write-Host "First prompt after reboot will pay the ~32s cold-start (spawn-on-first-hit default)."
