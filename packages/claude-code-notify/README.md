# claude-code-notify

Windows Toast notifications for Claude Code.

Get notified when Claude finishes a task or needs your permission.

## Features

- **Toast notification** — popup when Claude is done or waiting for approval
- **Taskbar flash** — flashes the terminal window until you switch to it
- **Click to activate** — click "Open" on the toast to jump back to the terminal
- **Zero dependencies** — just install and use, nothing else needed

## Usage

Add to your `~/.claude/settings.json`:

```json
{
    "hooks": {
        "Stop": [{ "hooks": [{ "type": "command", "command": "cmd /c npx -y @erica_s/claude-code-notify@latest", "async": true }] }],
        "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "cmd /c npx -y @erica_s/claude-code-notify@latest", "async": true }] }]
    }
}
```

That's it. The click-to-activate protocol is registered automatically on install.

## Notification Example

```
Title:   Claude Done (WindowsTerminal)
Body:    Task finished
         my-project
Button:  [Open]
```

## Requirements

- Windows 10 / 11
- Node.js >= 16
- PowerShell 5.1+

## Known Limitations

- **Windows 10**: Click-to-activate ("Open" button) may not work due to OS limitations.
- **macOS / Linux**: Not supported.

## License

MIT
