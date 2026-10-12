# Run from a Windows PowerShell profile after Node is on PATH.
param(
    [ValidateSet('start', 'stop', 'restart', 'status', 'supervise')]
    [string]$Command = 'start'
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Use bin/herdr-presence in WSL.' }
$RepoDir = Split-Path -Parent $PSScriptRoot
$EntryPath = Join-Path $RepoDir 'src\index.ts'
$ProfileDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$StateDir = Join-Path $ProfileDir '.local\state\herdr-presence'
$PidFile = Join-Path $StateDir 'supervisor.pid'
$StopFile = Join-Path $StateDir 'supervisor.stop'
$LogFile = Join-Path $StateDir 'launcher.log'
$ShellPath = (Get-Process -Id $PID).Path
[void](New-Item -ItemType Directory -Force -Path $StateDir)

function Write-Log([string]$Message) {
    Add-Content -LiteralPath $LogFile -Value "[herdr-presence launcher] $Message" -Encoding UTF8
}

function Get-Supervisor {
    try {
        $record = [IO.File]::ReadAllText($PidFile).Trim()
        if ($record -notmatch '^(\d+) (\d+)$') { return }
        $supervisorId = [int]$Matches[1]
        $started = [long]$Matches[2]
        $process = Get-Process -Id $supervisorId -ErrorAction Stop
        if ($process.StartTime.ToUniversalTime().Ticks -ne $started) { return }
        $info = Get-CimInstance Win32_Process -Filter "ProcessId = $supervisorId"
        if ($info.CommandLine.EndsWith("-File `"$PSCommandPath`" supervise", [StringComparison]::OrdinalIgnoreCase)) {
            return $process
        }
    } catch {
        # A stale PID must never cause an unrelated process to be stopped.
        return
    }
}

function Start-Companion {
    if (Get-Supervisor) { return }
    [void](Start-Process -FilePath $ShellPath -WindowStyle Hidden -ArgumentList (
        "-NoLogo -NoProfile -NonInteractive -File `"$PSCommandPath`" supervise"
    ))
}

function Stop-Companion {
    $supervisor = Get-Supervisor
    if (-not $supervisor) { return }
    $token = "$($supervisor.Id) $($supervisor.StartTime.ToUniversalTime().Ticks)"
    [IO.File]::WriteAllText($StopFile, $token)
    if (-not $supervisor.WaitForExit(10000)) {
        throw "Timed out waiting for supervisor $($supervisor.Id) to stop; see $LogFile."
    }
}

function Supervise {
    try {
        $lock = [IO.File]::Open((Join-Path $StateDir 'supervisor.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [IO.IOException] {
        return
    }
    $child = $null
    $token = "$PID $((Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks)"
    try {
        $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
        [IO.File]::WriteAllText($PidFile, $token)
        Write-Log 'Started supervisor.'
        $delays = @(1, 2, 5, 10, 30)
        $attempt = 0
        while ($true) {
            if (Test-Stopping $token) { return }
            $child = Start-Process -FilePath $node -ArgumentList "`"$EntryPath`"" -WorkingDirectory $RepoDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $StateDir 'companion.log') -RedirectStandardError (Join-Path $StateDir 'companion-error.log')
            while (-not $child.WaitForExit(200)) {
                if (Test-Stopping $token) { return }
            }
            $delay = $delays[[Math]::Min($attempt, $delays.Length - 1)]
            Write-Log "Companion exited ($($child.ExitCode)); restarting in ${delay}s."
            $child.Dispose()
            $child = $null
            $attempt++
            for ($tick = 0; $tick -lt $delay * 5; $tick++) {
                if (Test-Stopping $token) { return }
                Start-Sleep -Milliseconds 200
            }
        }
    } catch {
        Write-Log "Cannot run companion: $_. Require Windows Node.js 24 on PATH."
    } finally {
        if ($child) {
            if (-not $child.HasExited) {
                $child.Kill()
                [void]$child.WaitForExit(5000)
            }
            $child.Dispose()
        }
        if ((Test-Path -LiteralPath $PidFile) -and [IO.File]::ReadAllText($PidFile).Trim() -eq $token) {
            Remove-Item -LiteralPath $PidFile
        }
        if (Test-Stopping $token) { Remove-Item -LiteralPath $StopFile }
        $lock.Dispose()
    }
}

function Test-Stopping([string]$Token) {
    return (Test-Path -LiteralPath $StopFile) -and [IO.File]::ReadAllText($StopFile).Trim() -eq $Token
}

switch ($Command) {
    'start' { Start-Companion }
    'stop' { Stop-Companion }
    'restart' { Stop-Companion; Start-Companion }
    'status' {
        $supervisor = Get-Supervisor
        if ($supervisor) { "running (pid $($supervisor.Id))" } else { 'stopped'; exit 3 }
    }
    'supervise' { Supervise }
}
