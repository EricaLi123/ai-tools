# Claude Code Notification Script — Native WinRT Toast (zero module dependencies)
# Toast fires FIRST (fast), then window detection + flash (slower)
#
# All hook data (event, session_id, log file path, hwnd) is passed via environment
# variables by cli.js, which reads stdin once before spawning this script.

$sessionId = if ($env:CLAUDE_NOTIFY_SESSION_ID) { $env:CLAUDE_NOTIFY_SESSION_ID } else { 'unknown' }
$LogDir = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "claude-code-notify")
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = if ($env:CLAUDE_NOTIFY_LOG_FILE) { $env:CLAUDE_NOTIFY_LOG_FILE } else {
    [System.IO.Path]::Combine($LogDir, "session-$sessionId.log")
}
function Write-Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fff')] [ps1 pid=$PID] $msg"
    [Console]::Error.WriteLine($line)
    try { Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 } catch {}
}

Write-Log "started session=$sessionId"

# 1. Determine title/message from env vars set by cli.js
$eventName = if ($env:CLAUDE_NOTIFY_EVENT) { $env:CLAUDE_NOTIFY_EVENT } else { '' }
switch ($eventName) {
    'Stop'              { $Title = 'Claude Done';             $Message = 'Task finished' }
    'PermissionRequest' { $Title = 'Claude Needs Permission'; $Message = 'Waiting for your approval' }
    default             { $Title = 'Claude';                  $Message = 'Notification' }
}
$projectDir = $env:CLAUDE_PROJECT_DIR
if ($projectDir) {
    $projectName = Split-Path $projectDir -Leaf
    $Message = "$Message`n$projectName"
}
Write-Log "event=$eventName title=$Title"

# 2. Window detection
$hwnd = $null
$terminalName = 'Terminal'

# 3a. 优先使用 cli.js 预先找好的 hwnd（通过 find-hwnd.ps1 在 Node 侧查父链得到）。
# 这样可以绕过 MSYS2 断链问题：git bash 里 PowerShell 自身的父链走不到编辑器窗口，
# 但 Node → cmd → Claude Code Node → Code.exe 这条链在 Node 侧是完整的。
if ($env:CLAUDE_NOTIFY_HWND) {
    $hwnd = [IntPtr][long]$env:CLAUDE_NOTIFY_HWND
    try {
        $proc = Get-Process -Id (Get-Process | Where-Object { $_.MainWindowHandle -eq $hwnd } | Select-Object -First 1 -ExpandProperty Id) -ErrorAction Stop
        $terminalName = if ($proc.Product) { $proc.Product } elseif ($proc.Description) { $proc.Description } else { $proc.ProcessName }
    } catch {}
    Write-Log "hwnd from cli.js: $hwnd terminal=$terminalName"
}

Write-Log "hwnd=$hwnd terminal=$terminalName"

# 按事件类型选取图标（随包一起分发，存放在 assets/icons/）
$iconName = switch ($eventName) {
    'Stop'              { 'stop' }
    'PermissionRequest' { 'permission' }
    default             { 'info' }
}
$iconPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, "..", "assets", "icons", "$iconName.png"))

# 3. Build toast payload
$notificationTitle = "$Title ($terminalName)"
$escapedTitle = [System.Security.SecurityElement]::Escape($notificationTitle)
$escapedMessage = [System.Security.SecurityElement]::Escape($Message)

$actionsXml = ''
if ($hwnd) {
    $activateUrl = "erica-s.claude-code-notify.activate-window://$hwnd"
    $actionsXml = "<actions><action activationType=`"protocol`" arguments=`"$activateUrl`" content=`"Open`"/></actions>"
}

# 图标 XML（路径无效时为空字符串，保证降级安全）
$iconXml = ''
if ($iconPath -and (Test-Path $iconPath)) {
    $uriPath = $iconPath.Replace('\', '/')
    $escapedIconSrc = [System.Security.SecurityElement]::Escape("file:///$uriPath")
    $iconXml = "<image placement=`"appLogoOverride`" src=`"$escapedIconSrc`" hint-crop=`"circle`"/>"
}

# 4. Send toast
try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    $toastXml = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      $iconXml
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

# 5. Flash taskbar
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
