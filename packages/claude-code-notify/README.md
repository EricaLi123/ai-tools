# claude-code-notify

Windows Toast notifications for Claude Code and Codex.

Get notified when Claude or Codex finishes a task, or when Codex requests
approval.

## Problem It Solves

Claude Code sessions can run for a long time. Once you switch to other windows,
it becomes easy to miss state changes in the original terminal. This package
solves two core problems:

### 1. Reminder

Let you know that a session needs attention:

- Native Windows Toast notifications
- Taskbar flashing

### 2. Return To The Session

Help you find the right session and get back to it:

- Notification titles make the source and result easy to identify
- The matching terminal window flashes as a visual cue
- The notification provides an `Open` button that activates the target window

## What It Does

- Claude Code completion and permission-request notifications
- Codex completion notifications through `notify`
- Codex approval reminders through `codex-session-watch`
- Return-to-terminal helpers: toast title, taskbar flash, and `Open`

## Install

```bash
# Recommended: global install via volta or npm
volta install @erica_s/claude-code-notify
# or
npm install -g @erica_s/claude-code-notify
```

## Claude Code

Add to your `~/.claude/settings.json`:

```json
{
    "hooks": {
        "Stop": [{ "hooks": [{ "type": "command", "command": "claude-code-notify", "async": true }] }],
        "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "claude-code-notify", "async": true }] }]
    }
}
```

- Global install is recommended. `npx --yes @erica_s/claude-code-notify`
  is less reliable in async hooks.
- The click-to-activate protocol is registered automatically on install.

Manual smoke tests:

```bash
echo '{"hook_event_name":"Stop","session_id":"test-stop"}' | claude-code-notify
echo '{"hook_event_name":"PermissionRequest","session_id":"test-permission"}' | claude-code-notify
```

## Codex

Recommended `~/.codex/config.toml`:

```toml
notify = ["claude-code-notify"]

[mcp_servers.claude_code_notify_sidecar]
command = "cmd.exe"
args = ["/d", "/c", "claude-code-notify", "codex-mcp-sidecar"]
required = false
startup_timeout_sec = 5
```

### Completion

- `notify = ["claude-code-notify"]` covers completion events such as
  `agent-turn-complete`.
- Codex's current legacy `notify` hook cannot signal approval requests.
- After changing Codex `notify`, restart Codex and retest in a fresh TUI
  session. Already-running sessions keep the command they resolved at session
  start.
- Prefer a globally installed `claude-code-notify`. `npx.cmd
  @erica_s/claude-code-notify` is less reliable on Windows.

### Approval

- `codex-session-watch` is the main path for approval reminders.
- `codex-mcp-sidecar` helps approval reminders find the right terminal and will
  usually auto-start `codex-session-watch` when needed.
- Do **not** set `cwd` on the MCP server entry above.

If you are not using the MCP sidecar, start the watcher yourself:

```bash
claude-code-notify codex-session-watch
```

Optional flags:

- `--sessions-dir <path>`: override the Codex sessions directory
- `--tui-log <path>`: override the Codex TUI log path
- `--poll-ms <ms>`: change the polling interval

By itself, `codex-session-watch` may fall back to Toast-only behavior. With
`codex-mcp-sidecar`, return-to-terminal behavior is usually better.

## Common Commands

```bash
claude-code-notify --help
claude-code-notify codex-session-watch
claude-code-notify codex-mcp-sidecar
```

## Development Docs

For implementation details and design trade-offs, see
[`docs/development.md`](https://github.com/EricaLi123/claude-code-tools/blob/main/packages/claude-code-notify/docs/development.md).

## Requirements

- Windows 10 / 11
- Node.js >= 16
- PowerShell 5.1+

## Known Limitations

- **Toast source** shows as "Windows PowerShell" instead of "Claude Code"
- **Windows 10:** `Open` may not work due to OS limitations
- **macOS / Linux:** not supported

## License

MIT
