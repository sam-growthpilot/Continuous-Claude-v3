<#
.SYNOPSIS
  Pre-warm the CCv3 BGE embedding daemon.

.DESCRIPTION
  Checks if the daemon is already running (PID alive + responds to ping).
  If not, spawns a detached daemon process. Logs to ~/.claude/logs/.

.PARAMETER DryRun
  Parse and validate the script without spawning anything.
#>
param(
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Repo root resolution (portable -- no hardcoded user path)
# ---------------------------------------------------------------------------
$repoRoot = $null
if ($env:CLAUDE_PROJECT_DIR) {
    $repoRoot = $env:CLAUDE_PROJECT_DIR
} elseif ($PSScriptRoot) {
    $resolved = Resolve-Path (Join-Path $PSScriptRoot '..') -ErrorAction SilentlyContinue
    if ($resolved) { $repoRoot = $resolved.Path }
}
if (-not $repoRoot -or -not (Test-Path $repoRoot)) {
    $repoRoot = Join-Path $HOME 'continuous-claude'
}

# ---------------------------------------------------------------------------
# Logging helpers (rotate at 1 MB, keep 3 prior)
# ---------------------------------------------------------------------------
$logDir  = Join-Path $HOME '.claude' 'logs'
$logFile = Join-Path $logDir 'embedding-daemon-launcher.log'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] $Message"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Rotate-Log {
    if (-not (Test-Path $logFile)) { return }
    if ((Get-Item $logFile).Length -lt 1MB) { return }
    for ($i = 3; $i -ge 1; $i--) {
        $src = if ($i -eq 1) { $logFile } else { "$logFile.$($i-1)" }
        $dst = "$logFile.$i"
        if (Test-Path $src) { Move-Item $src $dst -Force }
    }
}

Rotate-Log

if ($DryRun) {
    Write-Log 'DryRun flag set -- exiting without spawning.'
    exit 0
}

# ---------------------------------------------------------------------------
# Check if daemon is already alive
# ---------------------------------------------------------------------------
$infoPath   = Join-Path $env:TEMP 'ccv3-embedding.json'
$needsSpawn = $true

if (Test-Path $infoPath) {
    try {
        $info    = Get-Content $infoPath -Raw | ConvertFrom-Json
        $daemonPid  = [int]$info.pid
        $daemonPort = [int]$info.port

        # PID alive?
        $existingProc = Get-Process -Id $daemonPid -ErrorAction SilentlyContinue
        if ($existingProc) {
            # Daemon responds to ping? (4-byte big-endian length prefix + JSON)
            $payload  = [System.Text.Encoding]::UTF8.GetBytes('{"op":"ping"}')
            $lenBytes = [System.BitConverter]::GetBytes([uint32]$payload.Length)
            if ([System.BitConverter]::IsLittleEndian) { [Array]::Reverse($lenBytes) }
            $client    = [System.Net.Sockets.TcpClient]::new()
            $connected = $client.ConnectAsync('127.0.0.1', $daemonPort).Wait(2000)
            if ($connected) {
                $stream = $client.GetStream()
                $stream.Write($lenBytes, 0, 4)
                $stream.Write($payload,  0, $payload.Length)
                $buf  = New-Object byte[] 4
                $readBytes = $stream.Read($buf, 0, 4)
                if ($readBytes -eq 4) {
                    $needsSpawn = $false
                    Write-Log "Daemon already running (pid=$daemonPid port=$daemonPort) -- no-op."
                }
                $client.Close()
            } else {
                $client.Close()
            }
        }
    } catch {
        Write-Log "Stale/unreadable info file -- will respawn. ($_)"
    }
}

if (-not $needsSpawn) { exit 0 }

# ---------------------------------------------------------------------------
# Spawn detached daemon
# ---------------------------------------------------------------------------
Write-Log "Spawning embedding daemon from repo root: $repoRoot"
$daemonScript = Join-Path $repoRoot 'opc' 'scripts' 'core' 'embedding_daemon.py'
if (-not (Test-Path $daemonScript)) {
    Write-Log "ERROR: daemon script not found at $daemonScript"
    exit 1
}

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName         = 'uv'
$psi.Arguments        = "run --project opc python opc/scripts/core/embedding_daemon.py --daemon"
$psi.WorkingDirectory = $repoRoot
$psi.UseShellExecute  = $false
$psi.CreateNoWindow   = $true

$spawnedProc = [System.Diagnostics.Process]::Start($psi)
if (-not $spawnedProc) {
    Write-Log 'ERROR: failed to start daemon process.'
    exit 1
}

Write-Log "Daemon spawned (pid=$($spawnedProc.Id)) - will be ready when $infoPath appears."
exit 0
