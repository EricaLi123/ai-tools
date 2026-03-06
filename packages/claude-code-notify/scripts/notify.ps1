# Claude Code Notification Script — Native WinRT Toast (zero module dependencies)
# Send notification FIRST, then do other operations

function Write-Log($msg) { [Console]::Error.WriteLine("claude-code-notify: $msg") }

# 1. Read stdin JSON quickly
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
    default             { $Title = 'Claude Code';             $Message = 'Notification' }
}
Write-Log "event=$eventName title=$Title"

# 3. Quick window detection using WMI (faster than Get-CimInstance loop)
$hwnd = $null
$terminalName = 'Terminal'
try {
    $currentPID = $PID
    for ($i = 0; $i -lt 10; $i++) {
        $proc = Get-Process -Id $currentPID -ErrorAction Stop
        if ($proc.MainWindowHandle -ne 0) {
            $hwnd = $proc.MainWindowHandle
            $terminalName = $proc.ProcessName
            break
        }
        $wmi = Get-WmiObject Win32_Process -Filter "ProcessId = $currentPID" -ErrorAction Stop
        if (-not $wmi -or $wmi.ParentProcessId -eq 0) { break }
        $currentPID = $wmi.ParentProcessId
    }
} catch { Write-Log "window detection failed: $_" }
Write-Log "hwnd=$hwnd terminal=$terminalName"

# 4. Build notification title with terminal name and project info
$notificationTitle = "$Title ($terminalName)"
$projectDir = $env:CLAUDE_PROJECT_DIR
if ($projectDir) {
    $projectName = Split-Path $projectDir -Leaf
    $Message = "$Message`n$projectName"
}

Write-Log "notify: title=$notificationTitle message=$Message"

# 5. Send native WinRT Toast notification
try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    # Escape XML special characters
    $escapedTitle = [System.Security.SecurityElement]::Escape($notificationTitle)
    $escapedMessage = [System.Security.SecurityElement]::Escape($Message)

    $actionsXml = ''
    if ($hwnd) {
        $activateUrl = "erica-s.claude-code-notify.activate-window://$hwnd"
        $actionsXml = "<actions><action activationType=`"protocol`" arguments=`"$activateUrl`" content=`"Open`"/></actions>"
    }
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
    Write-Log "appId=$appId"
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    Write-Log "toast sent"
} catch { Write-Log "toast failed: $_" }

# 6. Flash taskbar (after notification sent)
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
