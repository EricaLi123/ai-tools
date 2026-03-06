# Claude Code Notification Script — Native WinRT Toast (zero module dependencies)
# Toast fires FIRST (fast), then window detection + flash (slower)

function Write-Log($msg) { [Console]::Error.WriteLine("claude-code-notify: $msg") }

# 1. Read stdin JSON
$hookData = $null
try {
    if ([Console]::In.Peek() -ne -1) {
        $hookData = [Console]::In.ReadToEnd() | ConvertFrom-Json
        Write-Log "stdin received"
    } else {
        Write-Log "stdin empty"
    }
} catch { Write-Log "stdin parse failed: $_" }

# 2. Determine title/message
$eventName = if ($hookData.hook_event_name) { $hookData.hook_event_name } else { '' }
switch ($eventName) {
    'Stop'              { $Title = 'Claude Done';             $Message = 'Task finished' }
    'PermissionRequest' { $Title = 'Claude Needs Permission'; $Message = 'Waiting for your approval' }
    default             { $Title = 'Claude';             $Message = 'Notification' }
}
$projectDir = $env:CLAUDE_PROJECT_DIR
if ($projectDir) {
    $projectName = Split-Path $projectDir -Leaf
    $Message = "$Message`n$projectName"
}
Write-Log "event=$eventName title=$Title"

# 3. Window detection
$hwnd = $null
$terminalName = 'Terminal'

# 3a. Walk process tree using kernel API (CreateToolhelp32Snapshot — faster than CIM, may bridge MSYS2 gap)
try {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class ToolHelp {
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateToolhelp32Snapshot(uint f, uint pid);
    [DllImport("kernel32.dll")]
    static extern bool Process32First(IntPtr h, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll")]
    static extern bool Process32Next(IntPtr h, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct PROCESSENTRY32 {
        public uint dwSize; public uint cntUsage; public uint th32ProcessID;
        public IntPtr th32DefaultHeapID; public uint th32ModuleID; public uint cntThreads;
        public uint th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }
    public static Dictionary<int, int> GetParentMap() {
        var map = new Dictionary<int, int>();
        IntPtr snap = CreateToolhelp32Snapshot(2, 0);
        PROCESSENTRY32 pe = new PROCESSENTRY32();
        pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
        if (Process32First(snap, ref pe)) {
            do { map[(int)pe.th32ProcessID] = (int)pe.th32ParentProcessID; }
            while (Process32Next(snap, ref pe));
        }
        CloseHandle(snap);
        return map;
    }
}
'@ -ErrorAction SilentlyContinue

    $procMap = [ToolHelp]::GetParentMap()
    $currentPID = $PID
    for ($i = 0; $i -lt 50; $i++) {
        try {
            $proc = Get-Process -Id $currentPID -ErrorAction Stop
            if ($proc.MainWindowHandle -ne 0) {
                $hwnd = $proc.MainWindowHandle
                $terminalName = if ($proc.Product) { $proc.Product } elseif ($proc.Description) { $proc.Description } else { $proc.ProcessName }
                Write-Log "found window at depth=$i pid=$currentPID name=$terminalName"
                break
            }
        } catch {}
        if (-not $procMap.ContainsKey($currentPID) -or $procMap[$currentPID] -eq 0) { break }
        $currentPID = $procMap[$currentPID]
    }
} catch { Write-Log "tree walk failed: $_" }

# 3b. Fallbacks when tree walk fails (MSYS2 gap, conhost sibling, etc.)
if (-not $hwnd) {
    # Fallback 1: VSCODE_PID — set by VS Code / Cursor in integrated terminals
    $vscodePid = $env:VSCODE_PID
    if ($vscodePid) {
        try {
            $proc = Get-Process -Id $vscodePid -ErrorAction Stop
            if ($proc.MainWindowHandle -ne 0) {
                $hwnd = $proc.MainWindowHandle
                $terminalName = if ($proc.Product) { $proc.Product } elseif ($proc.Description) { $proc.Description } else { $proc.ProcessName }
                Write-Log "fallback VSCODE_PID=$vscodePid name=$terminalName"
            }
        } catch { Write-Log "VSCODE_PID fallback failed: $_" }
    }
}

Write-Log "hwnd=$hwnd terminal=$terminalName"

# 4. Build notification
$notificationTitle = "$Title ($terminalName)"
$escapedTitle = [System.Security.SecurityElement]::Escape($notificationTitle)
$escapedMessage = [System.Security.SecurityElement]::Escape($Message)

$actionsXml = ''
if ($hwnd) {
    $activateUrl = "erica-s.claude-code-notify.activate-window://$hwnd"
    $actionsXml = "<actions><action activationType=`"protocol`" arguments=`"$activateUrl`" content=`"Open`"/></actions>"
}

# 5. Send toast
try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    $toastXml = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$escapedTitle</text>
      <text>$escapedMessage</text>
    </binding>
  </visual>
  $actionsXml
</toast>
"@

    $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
    $xml.LoadXml($toastXml)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    Write-Log "toast sent: $notificationTitle"
} catch { Write-Log "toast failed: $_" }

# 6. Flash taskbar
if ($hwnd) {
    try {
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class FlashW { [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO p); [StructLayout(LayoutKind.Sequential)] public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; } }' -ErrorAction SilentlyContinue
        $flash = New-Object FlashW+FLASHWINFO
        $flash.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($flash)
        $flash.hwnd = $hwnd
        $flash.dwFlags = 15
        $flash.uCount = 0
        $flash.dwTimeout = 0
        [FlashW]::FlashWindowEx([ref]$flash) | Out-Null
        Write-Log "flash sent"
    } catch { Write-Log "flash failed: $_" }
}
