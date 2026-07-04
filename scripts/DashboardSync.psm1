# DashboardSync.psm1
# Deterministic (zero-LLM) helpers for the CCv3 scheduled-tasks dashboard sync.
# Exported: Get-TaskInventory, Resolve-TaskStatus, Build-TasksSectionMarkdown
# Plus helpers used by the main script + Pester tests.
#
# PowerShell 7 (pwsh). Emoji are built via ConvertFromUtf32 so this file is
# encoding-robust regardless of how the host reads the .psm1.

Set-StrictMode -Version Latest

# --- status glyph constants (astral codepoints -> ConvertFromUtf32) ----------
$script:EMOJI = [ordered]@{
    Green   = [System.Char]::ConvertFromUtf32(0x1F7E2)  # green circle
    Yellow  = [System.Char]::ConvertFromUtf32(0x1F7E1)  # yellow circle
    Red     = [System.Char]::ConvertFromUtf32(0x1F534)  # red circle
    NoEntry = [System.Char]::ConvertFromUtf32(0x26D4)   # no-entry (disabled)
}

# Windows Task Scheduler result codes that are NOT a genuine terminal script run.
# NOTE: typed [long] decimals - the 0x800710E0 hex literal overflows Int32 and would
# mis-compare against the [long] inventory value if written as a bare hex literal.
$script:RESULT_RUNNING = [long]267009      # 0x41301   - task currently running / last still-running
$script:RESULT_REFUSED = [long]2147946720  # 0x800710E0 - "operator refused request" (launch refusal, not a run)

function Get-StatusEmoji {
    param([Parameter(Mandatory)][ValidateSet('Green','Yellow','Red','NoEntry')][string]$Name)
    return $script:EMOJI[$Name]
}

function Get-LeadingStatusEmoji {
    <#  Returns the leading status glyph of a cell string, or '' if none. #>
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    foreach ($e in $script:EMOJI.Values) {
        if ($Text.StartsWith($e)) { return $e }
    }
    return ''
}

function Parse-StatusAnnotation {
    <#
      Classify the annotation carried by a status cell / toggle summary.
      Kinds:
        'fixed' - carries a "fixed / restored / verifies <date>" pending annotation
        'gate'  - expected-nonzero regression gate ("regression", "gate", "expected")
        'none'  - no special annotation
      Returns [pscustomobject]@{ Kind; Date (nullable datetime) }
    #>
    param([string]$Text)
    $result = [pscustomobject]@{ Kind = 'none'; Date = $null }
    if ([string]::IsNullOrWhiteSpace($Text)) { return $result }

    $isFixed = $Text -match '\b(fixed|restored|verif\w*)\b'
    $isGate  = $Text -match '\b(regression|regression-gate|expected|gate)\b'

    if ($isFixed) { $result.Kind = 'fixed' }
    elseif ($isGate) { $result.Kind = 'gate' }

    # Extract a date near the annotation. Accept YYYY-MM-DD or M/D[/YY[YY]].
    $m = [regex]::Match($Text, '(?<iso>\d{4}-\d{2}-\d{2})|(?<us>\d{1,2}/\d{1,2}(?:/\d{2,4})?)')
    if ($m.Success) {
        [datetime]$parsed = [datetime]::MinValue
        $ok = $false
        if ($m.Groups['iso'].Success) {
            $ok = [datetime]::TryParseExact($m.Groups['iso'].Value, 'yyyy-MM-dd',
                [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsed)
        } else {
            $raw = $m.Groups['us'].Value
            if ($raw -notmatch '/\d{2,4}$') { $raw = "$raw/$((Get-Date).Year)" }
            $ok = [datetime]::TryParse($raw, [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::None, [ref]$parsed)
        }
        if ($ok) { $result.Date = $parsed }
    }
    return $result
}

function Resolve-TaskStatus {
    <#
      Deterministic status state-machine (mirrors sync-tasks-dashboard-prompt.md step 5).

      Returns [pscustomobject]@{ Emoji; Reason }

      Rules:
        Disabled                                -> NoEntry
        result 0 (no annotation)                -> Green
        nonzero, no annotation                  -> Red
        "fixed/restored/verifies <date>" pending:
            no genuine fresh run since <date>    -> keep prior glyph (default Yellow) [fixed-pending]
            fresh terminal run AFTER <date> == 0 -> Green
            fresh terminal run AFTER <date> != 0 -> Red
        "regression-gate / expected" annotation:
            result 0                             -> Green
            nonzero                              -> Yellow (expected-nonzero)
        running (0x41301) no annotation          -> keep prior glyph or Green (in-flight)
      A result of 0x41301 (running) or 0x800710E0 (refused launch) is NOT a
      genuine terminal run and never flips a fixed-pending task.
    #>
    param(
        [Parameter(Mandatory)][string]$State,
        [Parameter(Mandatory)][AllowNull()][long]$Result,
        [AllowNull()][Nullable[datetime]]$LastRunTime = $null,
        [string]$PreviousStatusText = ''
    )

    if ($State -eq 'Disabled') {
        return [pscustomobject]@{ Emoji = Get-StatusEmoji NoEntry; Reason = 'task Disabled' }
    }

    $isRunning         = ($Result -eq $script:RESULT_RUNNING)
    $isRefused         = ($Result -eq $script:RESULT_REFUSED)
    $isSuccess         = ($Result -eq 0)
    $isGenuineTerminal = -not ($isRunning -or $isRefused)
    $isFail            = $isGenuineTerminal -and -not $isSuccess

    $ann       = Parse-StatusAnnotation $PreviousStatusText
    $prevEmoji = Get-LeadingStatusEmoji $PreviousStatusText

    if ($ann.Kind -eq 'fixed') {
        $freshRun = $isGenuineTerminal -and $LastRunTime -and $ann.Date -and ($LastRunTime.Date -gt $ann.Date.Date)
        if ($freshRun) {
            if ($isSuccess) {
                return [pscustomobject]@{ Emoji = Get-StatusEmoji Green; Reason = 'fresh run after fix returned 0' }
            }
            return [pscustomobject]@{ Emoji = Get-StatusEmoji Red; Reason = 'fresh run after fix failed' }
        }
        $keep = if ($prevEmoji) { $prevEmoji } else { Get-StatusEmoji Yellow }
        return [pscustomobject]@{ Emoji = $keep; Reason = 'fix pending - no genuine fresh run since annotation' }
    }

    if ($ann.Kind -eq 'gate') {
        if ($isSuccess) {
            return [pscustomobject]@{ Emoji = Get-StatusEmoji Green; Reason = 'regression gate now clean (0)' }
        }
        return [pscustomobject]@{ Emoji = Get-StatusEmoji Yellow; Reason = 'expected-nonzero regression gate' }
    }

    # no annotation
    if ($isSuccess) {
        return [pscustomobject]@{ Emoji = Get-StatusEmoji Green; Reason = 'result 0' }
    }
    if ($isRunning) {
        $keep = if ($prevEmoji) { $prevEmoji } else { Get-StatusEmoji Green }
        return [pscustomobject]@{ Emoji = $keep; Reason = 'in flight (0x41301)' }
    }
    if ($isRefused) {
        # 0x800710E0 = Task Scheduler "operator refused request": the task never
        # launched, so this is NOT a script failure. Keep the prior glyph (neutral
        # Yellow if none) rather than flipping to Red on a scheduler refusal.
        $keep = if ($prevEmoji) { $prevEmoji } else { Get-StatusEmoji Yellow }
        return [pscustomobject]@{ Emoji = $keep; Reason = 'launch refused (0x800710E0) - not a script failure' }
    }
    return [pscustomobject]@{ Emoji = Get-StatusEmoji Red; Reason = "failing unexpectedly (0x$($Result.ToString('X')))" }
}

function Get-TaskInventory {
    <#
      Live inventory via Get-ScheduledTask. Returns a hashtable keyed by TaskName:
        @{ State; LastRunTime; LastTaskResult; NextRunTime }
      Not used by -SelfTest (which passes synthetic values straight to Resolve-TaskStatus).
    #>
    param([string]$Filter = 'CCv3|AIWeeklyReport')
    $inv = @{}
    Get-ScheduledTask | Where-Object { $_.TaskName -match $Filter } | ForEach-Object {
        $info = $_ | Get-ScheduledTaskInfo
        $inv[$_.TaskName] = [pscustomobject]@{
            Name           = $_.TaskName
            State          = [string]$_.State
            LastRunTime    = $info.LastRunTime
            LastTaskResult = [long]$info.LastTaskResult
            NextRunTime    = $info.NextRunTime
        }
    }
    return $inv
}

function Format-TaskResult {
    <# Render a result code the way the page does: 0, or 0xHEX (+ "(running)"). #>
    param([Parameter(Mandatory)][long]$Result)
    if ($Result -eq 0) { return '0' }
    $hex = '0x' + $Result.ToString('X')
    if ($Result -eq $script:RESULT_RUNNING) { $hex += ' (running)' }
    return $hex
}

function Format-LastRun {
    param([AllowNull()][Nullable[datetime]]$Dt)
    if (-not $Dt) { return 'n/a' }
    return $Dt.ToString('yyyy-MM-dd HH:mm')
}

# Friendly table label -> real scheduled TaskName. Preserves the live section's
# two-group membership; the caller reads the live tables and resolves each row.
$script:NAME_MAP = @{
    'Self-Improvement Research' = 'CCv3-Self-Improvement-Research'
    'Judge-Batch'               = 'CCv3-Judge-Batch'
    'Embedding-Daemon (logon)'  = 'CCv3-Embedding-Daemon'
    'Embedding-Daemon-Daily'    = 'CCv3-Embedding-Daemon-Daily'
    'Dashboard-Sync'            = 'CCv3-Dashboard-Sync'
    'Blocklist-Update'          = 'CCv3-Blocklist-Update'
    'Health-Check'              = 'CCv3-Health-Check'
    'AIWeeklyReport'            = 'AIWeeklyReport'
    'FourthOS-Weekly'           = 'CCv3-FourthOS-Weekly'
    'Outcome-Tagger'            = 'CCv3-Outcome-Tagger'
    'UW-Daily-Snapshot'         = 'CCv3-UW-Daily-Snapshot'
    'Finance-Eval-Weekly'       = 'CCv3-Finance-Eval-Weekly'
}

function Expand-RowCells {
    <#
      Return a copy of a table row's cell array padded to at least $Min entries with
      empty strings. Protects the scoped-write path from crashing (index out of range
      under Set-StrictMode) when a malformed/short row carries fewer than 5 cells.
      Always returns an array (comma operator prevents scalar unrolling on 1-cell rows).
    #>
    param([AllowNull()][string[]]$Cells, [int]$Min = 5)
    $list = [System.Collections.Generic.List[string]]::new()
    if ($Cells) { foreach ($c in $Cells) { $list.Add([string]$c) } }
    while ($list.Count -lt $Min) { $list.Add('') }
    return , ($list.ToArray())
}

# "Reports & Dashboards" row-label prefix -> scheduled TaskName that produces it.
# Rows not listed here (event-driven/continuous reports) are never touched.
$script:REPORT_TASK_MAP = [ordered]@{
    'CCv3 Scheduled Tasks'            = 'CCv3-Dashboard-Sync'
    'CCv3 Weekly Health Checks'       = 'CCv3-Health-Check'
    'Braintrust session scores'       = 'CCv3-Judge-Batch'
    'AI Enablement Exec Presentation' = 'AIWeeklyReport'
    'AI Enablement Weekly Report'     = 'AIWeeklyReport'
    'FourthOS Sponsor Decks'          = 'CCv3-FourthOS-Weekly'
    'FourthOS Update Package'         = 'CCv3-FourthOS-Weekly'
    'Self-Improvement Proposals'      = 'CCv3-Self-Improvement-Research'
}

function Resolve-ReportTaskName {
    <# Map a Reports & Dashboards row label (which carries an inline description)
       to a scheduled TaskName via prefix match. $null = row is not task-backed. #>
    param([Parameter(Mandatory)][string]$Label, [Parameter(Mandatory)][hashtable]$Inventory)
    foreach ($k in $script:REPORT_TASK_MAP.Keys) {
        if ($Label.StartsWith($k)) {
            $n = $script:REPORT_TASK_MAP[$k]
            if ($Inventory.ContainsKey($n)) { return $n }
        }
    }
    return $null
}

function Build-LastSuccessRichText {
    <#
      Build the replacement rich_text array for a "Last success" cell: fresh
      success timestamp, then every link token preserved from the old cell
      (result links survive the refresh). Pure — no API calls.
    #>
    param([Parameter(Mandatory)][datetime]$LastRunTime, [AllowNull()]$OldTokens)
    $out = [System.Collections.Generic.List[object]]::new()
    $out.Add(@{ type = 'text'; text = @{ content = (Format-LastRun $LastRunTime) } })
    if ($OldTokens) {
        foreach ($t in $OldTokens) {
            if ($t.PSObject.Properties.Name -contains 'href' -and $t.href) {
                $out.Add(@{ type = 'text'; text = @{ content = ' · ' } })
                $out.Add(@{ type = 'text'; text = @{ content = [string]$t.plain_text; link = @{ url = [string]$t.href } } })
            }
        }
    }
    return , ($out.ToArray())
}

function Resolve-TaskName {
    <# Map a friendly table label to a real TaskName present in the inventory. #>
    param([Parameter(Mandatory)][string]$Label, [Parameter(Mandatory)][hashtable]$Inventory)
    if ($script:NAME_MAP.ContainsKey($Label)) {
        $n = $script:NAME_MAP[$Label]
        if ($Inventory.ContainsKey($n)) { return $n }
    }
    # Fallback: try CCv3-<label> and the label verbatim.
    foreach ($cand in @("CCv3-$Label", $Label)) {
        if ($Inventory.ContainsKey($cand)) { return $cand }
    }
    return $null
}

function Build-TasksSectionMarkdown {
    <#
      Deterministically rebuild the "Scheduled tasks" section as human-readable
      Markdown for PREVIEW, and compute an old->new status diff.

      -Section : parsed live section:
          @{ CapturedLine; Groups = @( @{ Title; Rows = @(@{Cells=@(...)}) } ... ) }
        Rows[0] of each group is the header row. Cells order: Task, Schedule, Last run, Result, Status.
      -Inventory : hashtable from Get-TaskInventory.
      -Today : datetime for the captured line.

      Returns @{ Markdown; Diff = @(@{Task; TaskName; Old; New; Changed; Reason; Mapped}) ; Unmapped=@(taskNames) }
    #>
    param(
        [Parameter(Mandatory)][hashtable]$Section,
        [Parameter(Mandatory)][hashtable]$Inventory,
        [datetime]$Today = (Get-Date)
    )

    $todayStr = $Today.ToString('yyyy-MM-dd')
    $sb = [System.Text.StringBuilder]::new()
    $diff = [System.Collections.Generic.List[object]]::new()
    $mappedNames = [System.Collections.Generic.HashSet[string]]::new()

    [void]$sb.AppendLine("## Scheduled tasks - health & reliability")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("Auto-refreshed nightly by CCv3-Dashboard-Sync (20:00) from Get-ScheduledTask. Statuses below captured $todayStr.")
    [void]$sb.AppendLine()

    foreach ($group in $Section.Groups) {
        [void]$sb.AppendLine("### $($group.Title)")
        [void]$sb.AppendLine()
        $rows = @($group.Rows)
        if ($rows.Count -eq 0) { continue }
        $header = @($rows[0].Cells)
        [void]$sb.AppendLine('| ' + ($header -join ' | ') + ' |')
        [void]$sb.AppendLine('|' + (($header | ForEach-Object { '---' }) -join '|') + '|')

        foreach ($row in $rows[1..($rows.Count - 1)]) {
            $cells   = @($row.Cells)
            $label   = $cells[0]
            $oldLast = if ($cells.Count -gt 2) { $cells[2] } else { '' }
            $oldRes  = if ($cells.Count -gt 3) { $cells[3] } else { '' }
            $oldStat = if ($cells.Count -gt 4) { $cells[4] } else { '' }
            $oldEmoji = Get-LeadingStatusEmoji $oldStat

            $taskName = Resolve-TaskName -Label $label -Inventory $Inventory
            if ($taskName) {
                [void]$mappedNames.Add($taskName)
                $t = $Inventory[$taskName]
                $res = Resolve-TaskStatus -State $t.State -Result $t.LastTaskResult `
                        -LastRunTime $t.LastRunTime -PreviousStatusText $oldStat
                $newEmoji = $res.Emoji
                # Preserve the human phrase; swap only the leading glyph.
                $phrase = $oldStat
                if ($oldEmoji) { $phrase = $oldStat.Substring($oldEmoji.Length).TrimStart() }
                $newStat = if ($phrase) { "$newEmoji $phrase" } else { $newEmoji }
                $newLast = Format-LastRun $t.LastRunTime
                $newRes  = Format-TaskResult $t.LastTaskResult
                # Preserve any parenthetical the human curated when numeric core matches.
                # Only for a genuine nonzero result: on recovery ($LastTaskResult -eq 0)
                # newRes is '0', and a loose StartsWith('0') would wrongly retain a stale
                # failing hex like '0x5 (failed)'. Exact-zero success never preserves.
                if ($t.LastTaskResult -ne 0 -and $oldRes -and $oldRes.StartsWith($newRes)) { $newRes = $oldRes }

                $changed = ($newEmoji -ne $oldEmoji)
                $diff.Add([pscustomobject]@{
                    Task = $label; TaskName = $taskName; Old = $oldEmoji; New = $newEmoji
                    Changed = $changed; Reason = $res.Reason; Mapped = $true
                })
                $out = @($label, $cells[1], $newLast, $newRes, $newStat)
                [void]$sb.AppendLine('| ' + ($out -join ' | ') + ' |')
            } else {
                # Not found in inventory - leave row byte-for-byte, flag it.
                $diff.Add([pscustomobject]@{
                    Task = $label; TaskName = $null; Old = $oldEmoji; New = $oldEmoji
                    Changed = $false; Reason = 'no matching scheduled task in inventory - left unchanged'; Mapped = $false
                })
                [void]$sb.AppendLine('| ' + ($cells -join ' | ') + ' |')
            }
        }
        [void]$sb.AppendLine()
    }

    # New tasks present in inventory but absent from the section (structural change NOT auto-made).
    $unmapped = @($Inventory.Keys | Where-Object { -not $mappedNames.Contains($_) } | Sort-Object)

    return @{
        Markdown = $sb.ToString()
        Diff     = $diff
        Unmapped = $unmapped
    }
}

Export-ModuleMember -Function `
    Get-TaskInventory, Resolve-TaskStatus, Build-TasksSectionMarkdown, `
    Parse-StatusAnnotation, Get-LeadingStatusEmoji, Get-StatusEmoji, `
    Format-TaskResult, Format-LastRun, Resolve-TaskName, Expand-RowCells, `
    Resolve-ReportTaskName, Build-LastSuccessRichText
