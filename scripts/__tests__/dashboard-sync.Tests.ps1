# Pester tests for the deterministic dashboard-sync state-machine.
# Run:  pwsh -NoProfile -Command "Invoke-Pester scripts/__tests__/dashboard-sync.Tests.ps1"
# These tests exercise Resolve-TaskStatus ONLY - no ntn / Notion / Get-ScheduledTask calls.

BeforeAll {
    $modulePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'DashboardSync.psm1'
    Import-Module $modulePath -Force -DisableNameChecking

    $script:G = Get-StatusEmoji Green
    $script:Y = Get-StatusEmoji Yellow
    $script:R = Get-StatusEmoji Red
    $script:D = Get-StatusEmoji NoEntry
}

Describe 'Resolve-TaskStatus state-machine (prompt step 5)' {

    It '(a) result 0 -> green' {
        (Resolve-TaskStatus -State 'Ready' -Result 0 -LastRunTime ([datetime]'2026-07-03') `
            -PreviousStatusText "$G healthy").Emoji | Should -Be $G
    }

    It '(b) nonzero, no annotation -> red' {
        (Resolve-TaskStatus -State 'Ready' -Result 2 -LastRunTime ([datetime]'2026-07-03') `
            -PreviousStatusText "$R failed").Emoji | Should -Be $R
    }

    It '(c) nonzero + fixed-annotation + LastRunTime BEFORE date -> stays yellow' {
        (Resolve-TaskStatus -State 'Ready' -Result 1 -LastRunTime ([datetime]'2026-06-25') `
            -PreviousStatusText "$Y fixed 2026-07-01, verifies soon").Emoji | Should -Be $Y
    }

    It '(d) fixed-annotation + fresh run AFTER date returning 0 -> green' {
        (Resolve-TaskStatus -State 'Ready' -Result 0 -LastRunTime ([datetime]'2026-07-02') `
            -PreviousStatusText "$Y fixed 2026-07-01, verifies soon").Emoji | Should -Be $G
    }

    It '(e) fixed-annotation + fresh run AFTER date returning nonzero -> red' {
        (Resolve-TaskStatus -State 'Ready' -Result 1 -LastRunTime ([datetime]'2026-07-02') `
            -PreviousStatusText "$Y fixed 2026-07-01, verifies soon").Emoji | Should -Be $R
    }

    It '(f) Disabled -> no-entry' {
        (Resolve-TaskStatus -State 'Disabled' -Result 0 -LastRunTime $null `
            -PreviousStatusText "$G healthy").Emoji | Should -Be $D
    }
}

Describe 'Resolve-TaskStatus - launch-refusal / running are not genuine runs' {

    It '0x800710E0 (refused launch) after fix date does NOT flip a fixed-pending task' {
        # Mirrors live AIWeeklyReport/FourthOS-Weekly: refused-launch code, LastRun after fix date.
        (Resolve-TaskStatus -State 'Ready' -Result 2147946720 -LastRunTime ([datetime]'2026-07-02') `
            -PreviousStatusText "$Y restored 6/30, verifies 7/9").Emoji | Should -Be $Y
    }

    It '0x41301 (running), no annotation -> keeps prior glyph (in-flight healthy)' {
        (Resolve-TaskStatus -State 'Ready' -Result 267009 -LastRunTime ([datetime]'2026-07-03') `
            -PreviousStatusText "$G healthy - this refresh in flight").Emoji | Should -Be $G
    }
}

Describe 'Resolve-TaskStatus - regression gate' {

    It 'regression-gate annotation + nonzero -> yellow (expected)' {
        (Resolve-TaskStatus -State 'Ready' -Result 1 -LastRunTime ([datetime]'2026-06-28') `
            -PreviousStatusText "$Y regression-gate? (confirm vs log)").Emoji | Should -Be $Y
    }

    It 'regression-gate annotation + result 0 -> green (gate clean)' {
        (Resolve-TaskStatus -State 'Ready' -Result 0 -LastRunTime ([datetime]'2026-07-03') `
            -PreviousStatusText "$Y regression-gate? (confirm vs log)").Emoji | Should -Be $G
    }
}
