#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Deterministic (zero-LLM) refresh of the CCv3 Reporting Hub "Scheduled tasks" section.

.DESCRIPTION
  Replicates scripts/sync-tasks-dashboard-prompt.md WITHOUT calling an LLM.
  Reads the live scheduled-tasks section (ntn api, read-only), re-inventories the
  tasks (Get-ScheduledTask), recomputes each status glyph via the state-machine in
  DashboardSync.psm1 (incl. the fixed-pending rule), and either PREVIEWS the result
  (default) or performs a SCOPED block replacement of only that section (-Write).

.PARAMETER Write
  Perform the scoped section replacement via ntn api. Default is PREVIEW (writes nothing).

.PARAMETER UseLLM
  Fallback: shell out to the existing LLM job scripts/sync-tasks-dashboard.ps1 (one cycle).

.PARAMETER SelfTest
  Unit-test Resolve-TaskStatus against the state-machine cases. No ntn / Notion calls.

.NOTES
  PowerShell 7 (pwsh). Windows. Safety: default preview, never touches other sections.
#>
[CmdletBinding(DefaultParameterSetName = 'Preview')]
param(
    [Parameter(ParameterSetName = 'Write')][switch]$Write,
    [Parameter(ParameterSetName = 'UseLLM')][switch]$UseLLM,
    [Parameter(ParameterSetName = 'SelfTest')][switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- constants ---------------------------------------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ModulePath = Join-Path $PSScriptRoot 'DashboardSync.psm1'
$NtnExe = 'C:/Users/david.hayes/AppData/Local/Microsoft/WinGet/Packages/Notion.ntn_Microsoft.Winget.Source_8wekyb3d8bbwe/ntn-x86_64-pc-windows-msvc/ntn.exe'
$PageId = '38f76fd7ac8280478e50dd2956ba6e8a'
$SectionHeadingSnippet = 'Scheduled tasks'   # heading_2 that opens the section
$NtnTimeoutMs = 60000

Import-Module $ModulePath -Force -DisableNameChecking

# --- logging -----------------------------------------------------------------
$LogDir = Join-Path $RepoRoot '.claude/logs/dashboard-sync'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir ("{0}-deterministic.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format o), $Level, $Message
    $line | Tee-Object -FilePath $LogFile -Append | Out-Null
    if ($Level -eq 'ERROR') { Write-Host $line -ForegroundColor Red }
    elseif ($Level -eq 'WARN') { Write-Host $line -ForegroundColor Yellow }
    else { Write-Host $line }
}

# --- ntn wrapper (stdin closed => EOF, hard timeout, fail-loud) ---------------
function Invoke-Ntn {
    <#
      Calls ntn.exe with StandardInput closed (equivalent to `< NUL`, prevents the
      documented open-stdin hang), a timeout, and nonzero-exit -> throw.
      Returns raw stdout string.
    #>
    param([Parameter(Mandatory)][string[]]$ArgList, [int]$TimeoutMs = $NtnTimeoutMs)

    if (-not (Test-Path $NtnExe)) { throw "ntn.exe not found at $NtnExe" }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $NtnExe
    foreach ($a in $ArgList) { $psi.ArgumentList.Add($a) }
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

    $p = [System.Diagnostics.Process]::Start($psi)
    $p.StandardInput.Close()   # EOF on stdin -> no hang
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutMs)) {
        try { $p.Kill($true) } catch {}
        throw "ntn timed out after ${TimeoutMs}ms: ntn $($ArgList -join ' ')"
    }
    $out = $outTask.GetAwaiter().GetResult()
    $err = $errTask.GetAwaiter().GetResult()
    if ($p.ExitCode -ne 0) {
        throw "ntn exit $($p.ExitCode): $err`n(cmd: ntn $($ArgList -join ' '))"
    }
    return $out
}

function Get-BlockChildren {
    param([Parameter(Mandatory)][string]$BlockId)
    $json = Invoke-Ntn -ArgList @('api', "v1/blocks/$BlockId/children?page_size=100")
    return ($json | ConvertFrom-Json)
}

function Get-RichText {
    param($Block)
    $t = $Block.type
    $o = $Block.$t
    if ($o -and ($o.PSObject.Properties.Name -contains 'rich_text')) {
        return ($o.rich_text | ForEach-Object { $_.plain_text }) -join ''
    }
    return ''
}

# --- read the live section ---------------------------------------------------
function Get-LiveSection {
    <#
      Fetch the page, isolate the "Scheduled tasks" section (heading -> next divider),
      and parse the two grouped tables. Returns a hashtable consumable by
      Build-TasksSectionMarkdown, plus the raw block ids for the -Write path.
    #>
    Write-Log "Fetching page $PageId children (read-only)"
    $page = Get-BlockChildren -BlockId $PageId
    $blocks = @($page.results)

    $startIdx = -1
    for ($i = 0; $i -lt $blocks.Count; $i++) {
        if ($blocks[$i].type -eq 'heading_2' -and (Get-RichText $blocks[$i]) -match $SectionHeadingSnippet) {
            $startIdx = $i; break
        }
    }
    if ($startIdx -lt 0) { throw "Could not find the '$SectionHeadingSnippet' heading on page $PageId" }

    # Section runs from the heading up to (not including) the NEXT top-level divider.
    $endIdx = $blocks.Count
    for ($i = $startIdx + 1; $i -lt $blocks.Count; $i++) {
        if ($blocks[$i].type -eq 'divider') { $endIdx = $i; break }
    }
    $sectionBlocks = $blocks[$startIdx..($endIdx - 1)]
    Write-Log "Section spans blocks [$startIdx..$($endIdx-1)] ($($sectionBlocks.Count) blocks); trailing anchor = block index $endIdx"

    # captured-date paragraph + grouped tables
    $capturedLine = ''
    $groups = [System.Collections.Generic.List[object]]::new()
    $pendingTitle = $null
    foreach ($b in $sectionBlocks) {
        switch ($b.type) {
            'paragraph' {
                $txt = Get-RichText $b
                if ($txt -match 'captured') { $capturedLine = $txt }
                elseif ($txt.Trim()) { $pendingTitle = $txt.Trim() }
            }
            'table' {
                $tbl = Get-BlockChildren -BlockId $b.id
                $rows = [System.Collections.Generic.List[object]]::new()
                foreach ($r in $tbl.results) {
                    if ($r.type -ne 'table_row') { continue }
                    $cells = @($r.table_row.cells | ForEach-Object { ($_ | ForEach-Object { $_.plain_text }) -join '' })
                    $rows.Add([pscustomobject]@{ Id = $r.id; Cells = $cells })
                }
                $groups.Add([pscustomobject]@{ Title = ($pendingTitle ?? 'tasks'); TableId = $b.id; Rows = $rows })
                $pendingTitle = $null
            }
            default { }
        }
    }

    return @{
        CapturedLine  = $capturedLine
        Groups        = $groups
        HeadingId     = $blocks[$startIdx].id
        SectionBlocks = $sectionBlocks
        TrailingAnchorId = if ($endIdx -lt $blocks.Count) { $blocks[$endIdx].id } else { $null }
    }
}

# --- diff printer ------------------------------------------------------------
function Show-Diff {
    param([Parameter(Mandatory)]$Result)
    Write-Host ''
    Write-Host '================ PROPOSED NEW SECTION (Markdown) ================' -ForegroundColor Cyan
    Write-Host $Result.Markdown
    Write-Host '================ OLD -> NEW STATUS DIFF ========================' -ForegroundColor Cyan
    $anyChange = $false
    foreach ($d in $Result.Diff) {
        $map = if ($d.Mapped) { $d.TaskName } else { '(UNMAPPED)' }
        if ($d.Changed) {
            $anyChange = $true
            Write-Host ("  CHANGED  {0,-26} {1} -> {2}   [{3}]  ({4})" -f $d.Task, $d.Old, $d.New, $map, $d.Reason) -ForegroundColor Yellow
        } else {
            Write-Host ("  same     {0,-26} {1}          [{2}]  ({3})" -f $d.Task, $d.New, $map, $d.Reason)
        }
    }
    if (-not $anyChange) { Write-Host '  (no status emoji changes this cycle)' -ForegroundColor Green }
    if ($Result.Unmapped.Count -gt 0) {
        Write-Host '---------------- INVENTORY TASKS NOT IN SECTION ----------------' -ForegroundColor Magenta
        foreach ($u in $Result.Unmapped) {
            Write-Host ("  new/unlisted: {0} (no structural change auto-made)" -f $u) -ForegroundColor Magenta
        }
    }
    Write-Host '================================================================' -ForegroundColor Cyan
}

# --- scoped write (implemented; guarded) -------------------------------------
function Invoke-ScopedWrite {
    param([Parameter(Mandatory)]$Section, [Parameter(Mandatory)]$Result, [Parameter(Mandatory)]$Inventory, [datetime]$Today)

    Write-Log "SCOPED WRITE requested. Re-verifying section anchors before mutating." 'WARN'
    # Re-fetch to guarantee anchors are still valid (no drift since preview fetch).
    $fresh = Get-LiveSection
    if ($fresh.HeadingId -ne $Section.HeadingId) { throw "Section heading id drifted; aborting write." }

    $todayStr = $Today.ToString('yyyy-MM-dd')

    # 1) Update the captured-date paragraph in place (targeted, low blast radius).
    $capBlock = $fresh.SectionBlocks | Where-Object { $_.type -eq 'paragraph' -and (Get-RichText $_) -match 'captured' } | Select-Object -First 1
    if ($capBlock) {
        $newCap = ($capBlock | ForEach-Object { Get-RichText $_ }) -replace 'captured\s+\d{4}-\d{2}-\d{2}', "captured $todayStr"
        $body = @{ paragraph = @{ rich_text = @(@{ type = 'text'; text = @{ content = $newCap } }) } } | ConvertTo-Json -Depth 12 -Compress
        $tmp = [IO.Path]::GetTempFileName()
        Set-Content -Path $tmp -Value $body -Encoding utf8
        Write-Log "PATCH captured-date block $($capBlock.id)"
        Invoke-Ntn -ArgList @('api', '-X', 'PATCH', "v1/blocks/$($capBlock.id)", '-d', "@$tmp") | Out-Null
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }

    # 2) Update each table row's Last run / Result / Status cell text in place.
    #    (Cell-level PATCH keeps table structure and other sections untouched.)
    foreach ($group in $fresh.Groups) {
        $rows = @($group.Rows)
        for ($ri = 1; $ri -lt $rows.Count; $ri++) {
            $row = $rows[$ri]
            $cells = @($row.Cells)
            # Guard: a malformed/empty row must not abort the whole write.
            if ($cells.Count -eq 0) { Write-Log "skipping empty table_row $($row.Id)" 'WARN'; continue }
            $label = $cells[0]
            $taskName = Resolve-TaskName -Label $label -Inventory $Inventory
            if (-not $taskName) { continue }
            $t = $Inventory[$taskName]
            # Pad short rows to >=5 cells so index writes below can't throw under StrictMode.
            $newCells = Expand-RowCells $cells 5
            $oldStat = $newCells[4]
            $res = Resolve-TaskStatus -State $t.State -Result $t.LastTaskResult -LastRunTime $t.LastRunTime -PreviousStatusText $oldStat
            $oldEmoji = Get-LeadingStatusEmoji $oldStat
            $phrase = if ($oldEmoji) { $oldStat.Substring($oldEmoji.Length).TrimStart() } else { $oldStat }
            $newStat = if ($phrase) { "$($res.Emoji) $phrase" } else { $res.Emoji }
            $newCells[2] = Format-LastRun $t.LastRunTime
            $newRes = Format-TaskResult $t.LastTaskResult
            # Same fix as Build-TasksSectionMarkdown: only preserve a curated parenthetical
            # for a genuine nonzero result; on recovery (result 0) never keep a stale hex.
            if ($t.LastTaskResult -ne 0 -and $newCells[3] -and $newCells[3].StartsWith($newRes)) { $newRes = $newCells[3] }
            $newCells[3] = $newRes
            $newCells[4] = $newStat

            $cellsPayload = @()
            foreach ($c in $newCells) { $cellsPayload += , @(@{ type = 'text'; text = @{ content = [string]$c } }) }
            $body = @{ table_row = @{ cells = $cellsPayload } } | ConvertTo-Json -Depth 15 -Compress
            $tmp = [IO.Path]::GetTempFileName()
            Set-Content -Path $tmp -Value $body -Encoding utf8
            Write-Log "PATCH table_row $($row.Id) ($label)"
            Invoke-Ntn -ArgList @('api', '-X', 'PATCH', "v1/blocks/$($row.Id)", '-d', "@$tmp") | Out-Null
            Remove-Item $tmp -ErrorAction SilentlyContinue
        }
    }
    Write-Log "Scoped write complete." 'INFO'
}

# --- self-test ---------------------------------------------------------------
function Invoke-SelfTest {
    $G = Get-StatusEmoji Green; $Y = Get-StatusEmoji Yellow; $R = Get-StatusEmoji Red; $D = Get-StatusEmoji NoEntry
    $cases = @(
        @{ Name = '(a) result 0 -> green'; Expect = $G;
           Args = @{ State = 'Ready'; Result = [long]0; LastRunTime = [datetime]'2026-07-03'; PreviousStatusText = "$G healthy" } }
        @{ Name = '(b) nonzero no annotation -> red'; Expect = $R;
           Args = @{ State = 'Ready'; Result = [long]2; LastRunTime = [datetime]'2026-07-03'; PreviousStatusText = "$R failed" } }
        @{ Name = '(c) nonzero + fixed-annotation, run BEFORE date -> stays yellow'; Expect = $Y;
           Args = @{ State = 'Ready'; Result = [long]1; LastRunTime = [datetime]'2026-06-25'; PreviousStatusText = "$Y fixed 2026-07-01, verifies soon" } }
        @{ Name = '(d) fixed-annotation + fresh run AFTER date == 0 -> green'; Expect = $G;
           Args = @{ State = 'Ready'; Result = [long]0; LastRunTime = [datetime]'2026-07-02'; PreviousStatusText = "$Y fixed 2026-07-01, verifies soon" } }
        @{ Name = '(e) fixed-annotation + fresh run AFTER date != 0 -> red'; Expect = $R;
           Args = @{ State = 'Ready'; Result = [long]1; LastRunTime = [datetime]'2026-07-02'; PreviousStatusText = "$Y fixed 2026-07-01, verifies soon" } }
        @{ Name = '(f) Disabled -> no-entry'; Expect = $D;
           Args = @{ State = 'Disabled'; Result = [long]0; LastRunTime = $null; PreviousStatusText = "$G healthy" } }
        # CORR#1: refused launch (0x800710E0) is a scheduler refusal, not a script failure.
        @{ Name = '(g) refused 0x800710E0 no annotation, prior green -> keep green (NOT red)'; Expect = $G;
           Args = @{ State = 'Ready'; Result = [long]2147946720; LastRunTime = [datetime]'2026-07-03'; PreviousStatusText = "$G healthy" } }
        @{ Name = '(h) refused 0x800710E0 no annotation, no prior glyph -> neutral yellow (NOT red)'; Expect = $Y;
           Args = @{ State = 'Ready'; Result = [long]2147946720; LastRunTime = [datetime]'2026-07-03'; PreviousStatusText = 'launched, no glyph yet' } }
        # CORR#1 (regression guard): a real nonzero failure with no annotation still -> red.
        @{ Name = '(i) genuine nonzero (5) no annotation -> red'; Expect = $R;
           Args = @{ State = 'Ready'; Result = [long]5; LastRunTime = [datetime]'2026-07-03'; PreviousStatusText = "$G healthy" } }
    )
    $pass = 0; $fail = 0
    Write-Host ''
    Write-Host '================ Resolve-TaskStatus SELF-TEST ==================' -ForegroundColor Cyan
    foreach ($c in $cases) {
        $splat = $c.Args
        $got = Resolve-TaskStatus @splat
        $ok = ($got.Emoji -eq $c.Expect)
        if ($ok) { $pass++; Write-Host ("  PASS  {0}  => {1}" -f $c.Name, $got.Emoji) -ForegroundColor Green }
        else { $fail++; Write-Host ("  FAIL  {0}  expected {1} got {2} ({3})" -f $c.Name, $c.Expect, $got.Emoji, $got.Reason) -ForegroundColor Red }
    }

    # --- CORR#2: recovered task must show '0', never a stale failing hex ------
    # Build-TasksSectionMarkdown is pure (no ntn/Notion); drive it with a synthetic
    # section whose old Result cell is '0x5 (failed)' while inventory now returns 0.
    $secCorr2 = @{
        CapturedLine = 'captured 2026-07-03'
        Groups = @(
            [pscustomobject]@{ Title = 'core'; Rows = @(
                [pscustomobject]@{ Cells = @('Task', 'Schedule', 'Last run', 'Result', 'Status') }
                [pscustomobject]@{ Cells = @('Health-Check', 'daily', '2026-06-01', '0x5 (failed)', "$R failed") }
            ) }
        )
    }
    $invCorr2 = @{ 'CCv3-Health-Check' = [pscustomobject]@{
        Name = 'CCv3-Health-Check'; State = 'Ready'; LastRunTime = [datetime]'2026-07-03'
        LastTaskResult = [long]0; NextRunTime = $null } }
    $bCorr2 = Build-TasksSectionMarkdown -Section $secCorr2 -Inventory $invCorr2 -Today ([datetime]'2026-07-03')
    if ($bCorr2.Markdown -match '0x5') {
        $fail++; Write-Host "  FAIL  (j) CORR#2 recovered task -> result cell kept stale '0x5' hex" -ForegroundColor Red
    } elseif ($bCorr2.Markdown -match '\|\s*0\s*\|') {
        $pass++; Write-Host "  PASS  (j) CORR#2 recovered task -> result cell shows '0' (stale hex dropped)" -ForegroundColor Green
    } else {
        $fail++; Write-Host "  FAIL  (j) CORR#2 recovered task -> expected clean '0' result cell not found" -ForegroundColor Red
    }

    # --- CORR#3: Expand-RowCells pads a short/empty row without throwing -------
    try {
        $padShort = Expand-RowCells @('only', 'two') 5
        $padEmpty = Expand-RowCells @() 5
        $padOne   = Expand-RowCells @('solo') 5
        if ($padShort.Count -eq 5 -and $padEmpty.Count -eq 5 -and $padOne.Count -eq 5 `
                -and $padShort[0] -eq 'only' -and $padShort[4] -eq '' -and $padOne[0] -eq 'solo') {
            $pass++; Write-Host "  PASS  (k) CORR#3 Expand-RowCells pads short/empty/1-cell rows to 5 (no crash)" -ForegroundColor Green
        } else {
            $fail++; Write-Host "  FAIL  (k) CORR#3 Expand-RowCells padded shape unexpected" -ForegroundColor Red
        }
    } catch {
        $fail++; Write-Host ("  FAIL  (k) CORR#3 Expand-RowCells threw: {0}" -f $_.Exception.Message) -ForegroundColor Red
    }

    Write-Host ("---------------- {0} passed / {1} failed ----------------" -f $pass, $fail) -ForegroundColor Cyan
    if ($fail -gt 0) { exit 1 }
    Write-Host 'SELF-TEST GREEN' -ForegroundColor Green
    exit 0
}

# =============================== main ========================================
Write-Log "sync-tasks-dashboard-deterministic starting (mode=$($PSCmdlet.ParameterSetName))"

if ($SelfTest) { Invoke-SelfTest; return }

if ($UseLLM) {
    $llm = Join-Path $PSScriptRoot 'sync-tasks-dashboard.ps1'
    Write-Log "UseLLM: delegating one cycle to $llm" 'WARN'
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $llm
    Write-Log "UseLLM cycle finished (exit=$LASTEXITCODE)"
    return
}

# Log ntn version once (fail-loud if the exe is unreachable).
$ver = (Invoke-Ntn -ArgList @('--version')).Trim()
Write-Log "ntn version: $ver"

$today = Get-Date
$inventory = Get-TaskInventory
Write-Log "Inventory: $($inventory.Count) tasks matched"

$section = Get-LiveSection
$result = Build-TasksSectionMarkdown -Section @{ CapturedLine = $section.CapturedLine; Groups = $section.Groups } -Inventory $inventory -Today $today

Show-Diff -Result $result

if ($Write) {
    Invoke-ScopedWrite -Section $section -Result $result -Inventory $inventory -Today $today
    Write-Log "WRITE mode complete."
} else {
    Write-Log "PREVIEW mode: nothing written. Re-run with -Write to apply (scoped to the tasks section only)."
}
