# Interactive toast test script
# Run: powershell -EP Bypass -File test/test-toast.ps1
# Sends test toasts so you can visually verify appearance and click behavior

$notifyScript = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\notify.ps1"

function Send-Toast($json, $envVars) {
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "powershell.exe"
    $psi.Arguments = "-NoProfile -EP Bypass -File `"$notifyScript`""
    $psi.RedirectStandardInput = $true
    $psi.UseShellExecute = $false
    if ($envVars) {
        foreach ($kv in $envVars.GetEnumerator()) {
            $psi.EnvironmentVariables[$kv.Key] = $kv.Value
        }
    }
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.StandardInput.WriteLine($json)
    $proc.StandardInput.Close()
    $proc.WaitForExit(10000) | Out-Null
}

Write-Host "=== Claude Code Notify - Toast Test ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Stop event
Write-Host "[1/4] Sending 'Stop' toast..." -ForegroundColor Yellow
Send-Toast '{"hook_event_name":"Stop"}'
Write-Host "      Done. You should see: 'Claude Done (...)'" -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 2

# Test 2: PermissionRequest event
Write-Host "[2/4] Sending 'PermissionRequest' toast..." -ForegroundColor Yellow
Send-Toast '{"hook_event_name":"PermissionRequest"}'
Write-Host "      Done. You should see: 'Claude Needs Permission (...)'" -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 2

# Test 3: Unknown event (fallback)
Write-Host "[3/4] Sending unknown event toast (fallback)..." -ForegroundColor Yellow
Send-Toast '{"hook_event_name":"SomethingElse"}'
Write-Host "      Done. You should see: 'Claude Code (...)'" -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 2

# Test 4: With CLAUDE_PROJECT_DIR set
Write-Host "[4/4] Sending toast with project name..." -ForegroundColor Yellow
Send-Toast '{"hook_event_name":"Stop"}' @{ CLAUDE_PROJECT_DIR = "C:\Users\test\my-awesome-project" }
Write-Host "      Done. You should see project name 'my-awesome-project' in body" -ForegroundColor Green
Write-Host ""

Write-Host "=== All toasts sent ===" -ForegroundColor Cyan
Write-Host "Check that:"
Write-Host "  - Each toast appeared in the notification center"
Write-Host "  - Each toast has an 'Open' button"
Write-Host "  - Clicking 'Open' brings this terminal window to foreground"
Write-Host ""
