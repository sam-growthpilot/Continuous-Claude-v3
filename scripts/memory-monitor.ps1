<#
.SYNOPSIS
  Memory snapshot logger for diagnosing AFK / active memory growth on Windows.

.DESCRIPTION
  Each snapshot writes one row to memory-snapshots.csv (system totals + per-class
  rollups) and N rows to memory-processes.csv (top-N processes detail).

  Two modes:
    1. Single shot (default) — fire once, exit. Use with Task Scheduler.
    2. Loop — run indefinitely with -Loop, snapshot every -IntervalSec seconds.

.PARAMETER OutDir
  Directory to write CSVs into. Defaults to <repo>\.claude\logs.

.PARAMETER TopN
  Number of top-memory processes to record per snapshot. Default 25.

.PARAMETER Loop
  If set, runs indefinitely until Ctrl+C.

.PARAMETER IntervalSec
  Seconds between snapshots in loop mode. Default 300 (5 min).

.PARAMETER MaxIterations
  Stop after this many snapshots in loop mode. 0 = infinite. Default 0.

.EXAMPLE
  .\memory-monitor.ps1
  Single snapshot, default location.

.EXAMPLE
  .\memory-monitor.ps1 -Loop -IntervalSec 30 -MaxIterations 20
  20 snapshots, 30s apart (10 min total).
#>

[CmdletBinding()]
param(
    [string]$OutDir = $null,
    [int]$TopN = 25,
    [switch]$Loop,
    [int]$IntervalSec = 300,
    [int]$MaxIterations = 0
)

if (-not $OutDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoRoot = Split-Path -Parent $scriptDir
    $OutDir = Join-Path $repoRoot '.claude\logs'
}
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$summaryCsv = Join-Path $OutDir 'memory-snapshots.csv'
$processCsv = Join-Path $OutDir 'memory-processes.csv'

function Take-Snapshot {
    param([string]$SummaryPath, [string]$ProcessPath, [int]$TopN)

    $now = Get-Date
    $iso = $now.ToString('yyyy-MM-ddTHH:mm:ss')

    $os = Get-CimInstance Win32_OperatingSystem
    $totalMB = [math]::Round($os.TotalVisibleMemorySize/1024, 0)
    $freeMB  = [math]::Round($os.FreePhysicalMemory/1024, 0)
    $usedMB  = $totalMB - $freeMB
    $pctUsed = [math]::Round(($usedMB/$totalMB)*100, 2)

    $memCompProc = Get-Process -Name 'Memory Compression' -ErrorAction SilentlyContinue
    $memCompMB   = if ($memCompProc) { [math]::Round($memCompProc.WorkingSet64/1MB, 1) } else { 0 }

    $pf   = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue
    $pfMB = if ($pf) { $pf.CurrentUsage } else { 0 }

    # Kernel-side memory: Pool Nonpaged, Pool Paged, Standby Cache
    # (Pool Nonpaged is the "AFK driver leak" signal we cannot see in per-process tables.)
    $poolNonpagedMB = 0
    $poolPagedMB    = 0
    $standbyTotalMB = 0
    try {
        $cnt = Get-Counter -Counter @(
            '\Memory\Pool Nonpaged Bytes',
            '\Memory\Pool Paged Bytes',
            '\Memory\Standby Cache Normal Priority Bytes',
            '\Memory\Standby Cache Reserve Bytes',
            '\Memory\Standby Cache Core Bytes'
        ) -ErrorAction Stop
        foreach ($s in $cnt.CounterSamples) {
            $p = $s.Path.ToLower()
            if     ($p -like '*pool nonpaged bytes*') { $poolNonpagedMB = [math]::Round($s.CookedValue/1MB, 1) }
            elseif ($p -like '*pool paged bytes*')    { $poolPagedMB    = [math]::Round($s.CookedValue/1MB, 1) }
            else                                       { $standbyTotalMB += [math]::Round($s.CookedValue/1MB, 1) }
        }
    } catch {}

    # WSL2 VM working set (vmmemWSL) — previously invisible to this script
    $vmmemWSL   = Get-Process -Name 'vmmemWSL' -ErrorAction SilentlyContinue
    $vmmemWSLMB = if ($vmmemWSL) { [math]::Round($vmmemWSL.WorkingSet64/1MB, 1) } else { 0 }

    # Generic vmmem (Hyper-V VMs / WSL1)
    $vmmem   = Get-Process -Name 'vmmem' -ErrorAction SilentlyContinue
    $vmmemMB = if ($vmmem) { [math]::Round($vmmem.WorkingSet64/1MB, 1) } else { 0 }

    # Per-class rollups (find sprawl quickly)
    $procs = Get-Process

    function Get-ClassMB {
        param($name)
        $sum = ($procs | Where-Object { $_.Name -eq $name } | Measure-Object WorkingSet64 -Sum).Sum
        if ($sum) { [math]::Round($sum/1MB, 1) } else { 0 }
    }
    function Get-ClassCount {
        param($name)
        ($procs | Where-Object { $_.Name -eq $name }).Count
    }

    $summary = [PSCustomObject]@{
        Timestamp        = $iso
        TotalMB          = $totalMB
        UsedMB           = $usedMB
        FreeMB           = $freeMB
        PctUsed          = $pctUsed
        MemCompressionMB = $memCompMB
        PageFileMB       = $pfMB
        PoolNonpagedMB   = $poolNonpagedMB
        PoolPagedMB      = $poolPagedMB
        StandbyTotalMB   = $standbyTotalMB
        VmmemWSLMB       = $vmmemWSLMB
        VmmemMB          = $vmmemMB
        NodeCount        = Get-ClassCount 'node'
        NodeMB           = Get-ClassMB    'node'
        ClaudeCount      = Get-ClassCount 'claude'
        ClaudeMB         = Get-ClassMB    'claude'
        ChromeCount      = Get-ClassCount 'chrome'
        ChromeMB         = Get-ClassMB    'chrome'
        MsedgeCount      = Get-ClassCount 'msedge'
        MsedgeMB         = Get-ClassMB    'msedge'
        SvchostCount     = Get-ClassCount 'svchost'
        SvchostMB        = Get-ClassMB    'svchost'
        PythonCount      = Get-ClassCount 'python'
        PythonMB         = Get-ClassMB    'python'
        TotalProcCount   = $procs.Count
    }

    $writeHeader = -not (Test-Path $SummaryPath)
    if ($writeHeader) {
        $summary | Export-Csv -Path $SummaryPath -NoTypeInformation -Encoding UTF8
    } else {
        $summary | Export-Csv -Path $SummaryPath -NoTypeInformation -Append -Encoding UTF8
    }

    # Per-process detail rows
    $top = $procs | Sort-Object WorkingSet64 -Descending | Select-Object -First $TopN
    $procRows = foreach ($p in $top) {
        [PSCustomObject]@{
            Timestamp    = $iso
            Name         = $p.Name
            ProcessId    = $p.Id
            WorkingSetMB = [math]::Round($p.WorkingSet64/1MB, 1)
            PrivateMB    = [math]::Round($p.PrivateMemorySize64/1MB, 1)
            Handles      = $p.HandleCount
            Threads      = $p.Threads.Count
            StartTime    = if ($p.StartTime) { $p.StartTime.ToString('yyyy-MM-ddTHH:mm:ss') } else { '' }
        }
    }

    $writeProcHeader = -not (Test-Path $ProcessPath)
    if ($writeProcHeader) {
        $procRows | Export-Csv -Path $ProcessPath -NoTypeInformation -Encoding UTF8
    } else {
        $procRows | Export-Csv -Path $ProcessPath -NoTypeInformation -Append -Encoding UTF8
    }

    return $summary
}

# Main
if ($Loop) {
    Write-Host "memory-monitor: loop mode, every $IntervalSec sec -> $OutDir (Ctrl+C to stop)"
    $i = 0
    while ($true) {
        $r = Take-Snapshot -SummaryPath $summaryCsv -ProcessPath $processCsv -TopN $TopN
        Write-Host ("[{0}] used={1}MB ({2}%) | pool_np={3}MB pool_p={4}MB stby={5}MB vmWSL={6}MB compr={7}MB pf={8}MB | node={9}/{10}MB chrome={11}/{12}MB" -f `
            $r.Timestamp, $r.UsedMB, $r.PctUsed, $r.PoolNonpagedMB, $r.PoolPagedMB, $r.StandbyTotalMB, $r.VmmemWSLMB, $r.MemCompressionMB, $r.PageFileMB, $r.NodeCount, $r.NodeMB, $r.ChromeCount, $r.ChromeMB)
        $i++
        if ($MaxIterations -gt 0 -and $i -ge $MaxIterations) {
            Write-Host "memory-monitor: reached MaxIterations=$MaxIterations, exiting."
            break
        }
        Start-Sleep -Seconds $IntervalSec
    }
} else {
    $r = Take-Snapshot -SummaryPath $summaryCsv -ProcessPath $processCsv -TopN $TopN
    Write-Host ("[{0}] used={1}MB ({2}%) free={3}MB | -> {4}" -f $r.Timestamp, $r.UsedMB, $r.PctUsed, $r.FreeMB, $summaryCsv)
}
