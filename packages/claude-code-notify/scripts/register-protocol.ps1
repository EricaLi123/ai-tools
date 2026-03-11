# Register erica-s.claude-code-notify.activate-window:// protocol handler
# Uses EncodedCommand to inline the activate-window logic — zero file dependencies

# The PowerShell script that will run when the protocol is invoked.
# It reads the URL from $_CCN_URL env var (set by cmd /c wrapper).
$activateScript = @'
$url = $env:_CCN_URL
$handleString = $url -replace '^[^:]+://', '' -replace '[/\\"]', ''
$handleString = $handleString.Trim()
if (-not $handleString) { exit 1 }
try {
    $handleInt = [long]$handleString
    $hwnd = [IntPtr]$handleInt
} catch { exit 1 }
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@ -ErrorAction SilentlyContinue
if (-not [WinAPI]::IsWindow($hwnd)) { exit 1 }
if ([WinAPI]::IsIconic($hwnd)) { [WinAPI]::ShowWindow($hwnd, 9) | Out-Null }
[WinAPI]::SetForegroundWindow($hwnd) | Out-Null
'@

# Encode to Base64 for -EncodedCommand
$bytes = [System.Text.Encoding]::Unicode.GetBytes($activateScript)
$encoded = [Convert]::ToBase64String($bytes)

# Build the command string: cmd /c sets the URL env var, then calls powershell
$command = "cmd /c ""set _CCN_URL=%1 && powershell.exe -NoProfile -WindowStyle Hidden -EP Bypass -EncodedCommand $encoded"""

# Write registry entries
$regPath = "HKCU:\Software\Classes\erica-s.claude-code-notify.activate-window"
New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(default)" -Value "URL:Claude Code Activate Window Protocol" -Force
New-ItemProperty -Path $regPath -Name "URL Protocol" -Value "" -Force -ErrorAction SilentlyContinue | Out-Null
Set-ItemProperty -Path "$regPath\shell\open\command" -Name "(default)" -Value $command -Force

Write-Host "Protocol registered: erica-s.claude-code-notify.activate-window"
