param([int]$StartPid)

$ErrorActionPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class ConsoleProcList {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern uint GetConsoleProcessList(uint[] processList, uint processCount);
}
'@ 2>$null

$shellNames = @('bash', 'powershell', 'pwsh', 'cmd', 'zsh', 'fish')

function Write-DebugLine($msg) {
    [Console]::Error.WriteLine("get-shell-pid: $msg")
}

Write-DebugLine("StartPid=$StartPid")

$size = 16
$buffer = New-Object uint[] $size
$count = [ConsoleProcList]::GetConsoleProcessList($buffer, $size)
if ($count -gt $size) {
    $size = [int]$count
    $buffer = New-Object uint[] $size
    $count = [ConsoleProcList]::GetConsoleProcessList($buffer, $size)
}

if ($count -le 0) {
    Write-DebugLine("GetConsoleProcessList failed")
    Write-Output 0
    exit
}

$consolePids = @($buffer[0..($count - 1)] | Where-Object { $_ -gt 0 })
Write-DebugLine("console pids=$($consolePids -join ',')")

$candidates = foreach ($pid in $consolePids) {
    if ($pid -eq $StartPid) { continue }
    try {
        $proc = Get-Process -Id $pid -ErrorAction Stop
        Write-DebugLine("candidate pid=$pid name=$($proc.ProcessName) start=$($proc.StartTime.ToString('o'))")
        if ($shellNames -contains $proc.ProcessName) {
            [PSCustomObject]@{
                Id = $proc.Id
                Name = $proc.ProcessName
                StartTime = $proc.StartTime
            }
        }
    } catch {
        Write-DebugLine("candidate pid=$pid dead")
    }
}

$selected = $candidates |
    Sort-Object StartTime, Id |
    Select-Object -First 1

if ($selected) {
    Write-DebugLine("selected shell pid=$($selected.Id) name=$($selected.Name)")
    Write-Output $selected.Id
    exit
}

Write-DebugLine("no shell candidate found")
Write-Output 0
