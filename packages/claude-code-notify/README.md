# claude-code-notify

Windows Toast notifications for Claude Code and Codex.

Get notified when Claude or Codex finishes a task, or when a watcher sees an
approval request.

This package now also supports Codex integration modes for:

- handling Codex direct `notify` payloads passed as a JSON argv argument for completion notifications
- handling Codex completion payloads through an installed PowerShell wrapper when Windows shim layers are not argv-safe
- recording startup-time terminal hints through an auto-started `codex-mcp-sidecar` MCP sidecar for later approval localization
- watching local Codex rollout session files and TUI logs for approval notifications through `codex-session-watch`
- watching `waitingOnApproval` through the official `codex app-server` connection launched by this package through `codex-watch`

## 解决什么问题

Claude Code 会话可能长时间运行，用户切到其他窗口后无法感知状态变化。本工具解决两个核心问题：

### 1. 提醒 — 让用户知道某个会话需要关注

- 系统原生 Toast 通知
- 任务栏闪烁

### 2. 定位 — 帮助用户找到并回到该会话

- 通知标题包含来源和事件结果，便于识别
- 闪烁对应的终端窗口，视觉引导
- 通知提供 "Open" 按钮，点击直接激活目标窗口

## Features

- **Toast notification** — native WinRT toast, no BurntToast or other modules needed
- **Taskbar flash** — flashes the terminal window until you switch to it
- **Click to activate** — click "Open" on the toast to jump back to the terminal
- **Automatic shell PID detection for tab color** — targets the current terminal shell without requiring manual PID arguments
- **Automatic Windows Terminal tab color reset** — keeps the highlight until that same tab comes back to foreground and emits new console input, then clears it without touching the foreground shell input
- **Zero dependencies** — pure PowerShell + WinRT, nothing else to install
- **Deep process tree walk** — reliably finds the terminal window even through volta/npx/bash shim chains

## Install

```bash
# Recommended: global install via volta or npm
volta install @erica_s/claude-code-notify
# or
npm install -g @erica_s/claude-code-notify
```

If you are testing from this repo instead of the published package:

```bash
# run in packages/claude-code-notify
npm link
```

If the click-to-activate protocol is not registered yet in that local-dev
setup, run:

```bash
node postinstall.js
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

> **Note:** `npx --yes @erica_s/claude-code-notify` also works, but the download delay on first run may cause stdin data to be lost in async hooks. Global install is recommended for reliability.
>
> **Override:** `--shell-pid <pid>` and `TOAST_NOTIFY_SHELL_PID` are supported for debugging or special launchers, but normal usage no longer requires them. Shell detection now prefers current-console detection and falls back to the parent-process shell chain when needed.

The click-to-activate protocol is registered automatically on install.

Manual smoke tests:

```bash
echo '{"hook_event_name":"Stop","session_id":"test-stop"}' | claude-code-notify
echo '{"hook_event_name":"PermissionRequest","session_id":"test-permission"}' | claude-code-notify
```

## Codex Direct Notify

Codex `notify` executes a program directly and appends a JSON payload as the
final argv argument. This package now understands that payload shape in its
default mode, so you can point Codex at `claude-code-notify` directly:

```toml
notify = ["claude-code-notify"]
```

Preference constraint:

- Do not treat `node.exe + local bin/cli.js` direct wiring as the normal Codex
  configuration.
- Prefer the published package entry (`claude-code-notify`) or its installed
  shim / wrapper path, so local testing stays aligned with what real users get
  after `npm install -g` or `npm link`.
- Direct local entrypoint wiring may be used only as a short-lived diagnostic
  experiment, and should not become the documented default or a long-term user
  setup.

On Windows, if the installed shim layer rewrites or drops the JSON argv payload,
prefer the installed VBS wrapper written by `postinstall`:

```toml
notify = [
  "wscript.exe",
  "C:\\Users\\<you>\\AppData\\Local\\claude-code-notify\\codex-notify-wrapper.vbs",
]
```

That wrapper still calls the installed `claude-code-notify` package entry. It
only moves the payload through an environment variable first, so Windows
`.cmd`/shim layers do not have to forward the raw JSON argument unchanged.
The variable name is `CLAUDE_CODE_NOTIFY_PAYLOAD`.

Practical note:

- After changing Codex `notify`, restart Codex and retest in a fresh TUI
  session.
- From local logs, already-running Codex sessions continue using the
  notification command they resolved at session start, so changing
  `~/.codex/config.toml` alone is not enough for an in-place retest.

Current Codex direct-notify payloads use a shape like:

```json
{
  "type": "agent-turn-complete",
  "thread-id": "12345",
  "turn-id": "67890",
  "cwd": "D:\\XAGIT\\claude-code-tools",
  "client": "codex-tui",
  "input-messages": ["Rename foo to bar"],
  "last-assistant-message": "Rename complete."
}
```

Important limitation: Codex's current legacy `notify` hook only emits the
`after_agent` payload shape above. It cannot signal approval requests. If you
want approval notifications from normal Codex CLI usage, use
`codex-session-watch`. `codex-watch` is a narrower app-server-scoped mode and
should not be treated as the default global approval watcher. For normal Codex
CLI usage, configure the `codex-mcp-sidecar` MCP companion described below: it
will auto-start `codex-session-watch` when a Codex session begins, and it also
provides the startup terminal hints that `codex-session-watch` later reuses for
approval window / tab targeting.

If your Codex runtime cannot resolve `claude-code-notify` from `PATH`, point
`notify` to the full `.cmd` shim path or a wrapper script instead.

For example on Windows with a normal global npm install, the shim is typically:

```text
C:\Users\<you>\AppData\Roaming\npm\claude-code-notify.cmd
```

## Codex MCP Sidecar (Recommended)

`codex-session-watch` remains the actual approval detector. The MCP sidecar is
an auxiliary process that Codex auto-starts at session startup. It captures
startup-time terminal hints, then tries to resolve the exact local Codex
`sessionId`. When `codex-session-watch` later sees an approval for that exact
`sessionId`, it can reuse the saved HWND / shell PID instead of falling back to
Toast-only behavior.

This sidecar intentionally exposes no user-facing tools. It exists only to
bridge "session start time" context into the later approval watcher, and to
ensure that watcher is actually running. Completion notifications do not depend
on this sidecar.

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.claude_code_notify_sidecar]
command = "claude-code-notify"
args = ["codex-mcp-sidecar"]
required = false
startup_timeout_sec = 5
```

Important setup note:

- Do **not** set `cwd` on this MCP server entry. Leaving `cwd` unset lets the
  sidecar inherit the real Codex project directory, which is how it matches the
  correct rollout session later.

If `claude-code-notify` is not resolvable from `PATH` in your Codex runtime,
use the full shim path instead:

```toml
[mcp_servers.claude_code_notify_sidecar]
command = "C:\\Users\\<you>\\AppData\\Roaming\\npm\\claude-code-notify.cmd"
args = ["codex-mcp-sidecar"]
required = false
startup_timeout_sec = 5
```

Behavior and limits:

- On session startup, the sidecar will hidden-launch `codex-session-watch` if
  that watcher is not already running.
- The sidecar still does **not** replace `codex-session-watch`; it only ensures
  the watcher exists and contributes localization hints for later approval
  reminders.
- The sidecar may exit quickly after the MCP handshake. Its resolved
  `sessionId -> terminal` record is intentionally retained under `%TEMP%` and
  later pruned by TTL, so approval localization can still work after the
  sidecar process itself is gone.
- The watcher only trusts exact `sessionId` matches from the sidecar. If no
  exact mapping is resolved, behavior normally falls back to the existing global
  Toast-only watcher path.
- There is one narrower fallback for resumed sessions: if no exact `sessionId`
  mapping exists but a live unresolved sidecar record has an ancestor/descendant
  `cwd` match with the approval event's project directory, the watcher may reuse
  that record's `hwnd` for window-level localization.
- That resumed-session fallback is intentionally window-only. It does **not**
  reuse the unresolved record's `shellPid`, so it can restore flash / Open
  targeting without risking coloring the wrong Windows Terminal tab.

## Reminder + Localization Responsibilities

This project intentionally splits "detect the event" from "locate the terminal
that should light up", and the split is different for completion vs approval:

| Channel | What it reliably knows | What it does not reliably know | Primary use |
| --- | --- | --- | --- |
| `codex-mcp-sidecar` | startup timing, inherited `cwd`, local parent-process chain, locally probed `hwnd` / `shellPid` | official `sessionId` at process birth, `threadId`, `turnId`, approval events, official tab id | approval-localization bridge from session start |
| Codex legacy `notify` | one completion payload such as `agent-turn-complete`, plus `thread-id` / `turn-id` when provided by Codex | approval requests | completion notifications + completion-time localization |
| `codex-session-watch` | rollout `sessionId`, approval events, `cwd`, early TUI approval lines | startup-time terminal handles | approval detection + reminder triggering |
| `codex-watch` / app-server | `threadId`, `turnId`, approval request payloads, command preview, optional `cwd` | startup-time local terminal identity, `hwnd`, tab handle | protocol-grade approval semantics |

In practice there are two different paths:

Completion path:

1. Codex fires `notify` with the completion payload.
2. `claude-code-notify` resolves the current terminal context in that same
   completion invocation.
3. Toast / flash / Open target the completion session directly.
4. This path does not depend on `codex-mcp-sidecar`.

Approval path:

1. `codex-mcp-sidecar` starts with the Codex session and records local terminal
   hints.
2. `codex-session-watch` later sees a real approval event in rollout JSONL or
   `codex-tui.log`.
3. The watcher reuses the sidecar record only when it can match the exact
   `sessionId`.
4. The localized approval reminder therefore depends on both pieces together:
   watcher for approval semantics, sidecar for original terminal context.
5. If no exact mapping exists, the watcher falls back to the neutral Toast-only
   path instead of guessing.

You can think of the approval split this way:

- `codex-mcp-sidecar` is the startup-time probe. It knows local terminal facts
  such as `cwd`, `hwnd`, `shellPid`, startup timing, and parent-process-chain
  context, but it does not receive official approval semantics directly.
- `codex-session-watch` is the approval-time observer. It sees `sessionId`,
  `turnId`, approval events, and shell-escalation signals from rollout / TUI
  logs, but it does not naturally know the original terminal handle.

That is why the project keeps both pieces for approval:

- sidecar captures terminal-localization hints early
- watcher detects the later approval event
- exact `sessionId` matching is the bridge between them

For resumed or older sessions, there is also a conservative fallback:

- sidecar candidate resolution now considers rollout filename time, file
  `mtime`, and the newest event timestamp found near the end of the rollout
  file
- if exact `sessionId` mapping is still unavailable, watcher may reuse only the
  unresolved record's `hwnd` when the approval event's project directory has a
  strong ancestor/descendant `cwd` match

That fallback is intentionally window-only. It does not reuse `shellPid`,
because weak matching is acceptable for window activation but too risky for
Windows Terminal tab coloring.

For a "configure once, then keep using stock `codex` normally" workflow, this
project does not treat `codex app-server` as the default path. App-server has
the most precise live approval transport, but it is a better fit when you are
hosting Codex yourself or building a custom integration around that protocol.
It is not the default "global observer" for arbitrary stock Codex TUI sessions.

This project also does not treat `tui.notifications` /
`tui.notification_method` as the primary automation hook. Those settings control
the TUI's own terminal notification behavior, but they are not exposed as a
stable external command hook and they do not provide a local persisted signal
that this package can reliably tail.

There is also a `features.codex_hooks` flag in Codex config reference, but it is
documented as under development and off by default. At the time of writing,
there is no public Codex lifecycle-hook documentation that would justify
replacing the current `notify` / watcher split with that flag.

For normal CLI users, the default split is therefore:

- `notify` for direct completion notifications and completion-time localization
- `codex-session-watch` for approval detection and approval reminder triggering
- `codex-mcp-sidecar` for the startup-time terminal hints that make approval
  localization possible later

In short, completion does not need `codex-mcp-sidecar`, while localized
approval reminders rely on `codex-session-watch` and `codex-mcp-sidecar`
together.

That is also why `codex-mcp-sidecar` and the localization bridge remain useful
even if Codex's own TUI reminder strategy evolves.

## Codex Session Watcher (Recommended For Approval Notifications)

Start a long-running watcher that tails local Codex rollout files under
`~/.codex/sessions` and the Codex TUI log under `~/.codex/log/codex-tui.log`.
This is the primary approval-watcher path for normal Codex CLI usage. It sends
a notification when Codex requests approval:

```bash
claude-code-notify codex-session-watch
```

If you configured `codex-mcp-sidecar`, you usually do **not** need to start
this manually. The first Codex session in the current Windows login will
auto-start it in the background.

If you want it to exist even before the first Codex session starts, or you are
not using the MCP sidecar, you can still enable Windows logon autostart once:

```bash
claude-code-notify autostart enable
```

Useful companion commands:

```bash
claude-code-notify autostart status
claude-code-notify autostart disable
```

Optional flags:

- `--sessions-dir <path>`: override the Codex sessions directory
- `--tui-log <path>`: override the Codex TUI log path
- `--poll-ms <ms>`: change the polling interval

You can also persist those watcher flags into autostart itself:

```bash
claude-code-notify autostart enable --poll-ms 2000
```

This mode watches these local Codex signals:

- rollout approval events when present:
  - `exec_approval_request`
  - `request_permissions`
  - `apply_patch_approval_request`
- rollout tool calls that request sandbox escalation:
  - `response_item` with `type == "function_call"`
  - function-call arguments contain `"sandbox_permissions":"require_escalated"`
- TUI early approval signals:
  - `ToolCall: shell_command { ... "sandbox_permissions":"require_escalated" ... }`

It intentionally does not rely on `op.dispatch.exec_approval` or
`op.dispatch.patch_approval`, because those lines appear when the approval is
handled, not when the approval prompt first appears.

Signal quality differs by source:

| Source | Strongest fields | Main role | Confidence |
| --- | --- | --- | --- |
| rollout JSONL | `sessionId`, `turnId`, `cwd`, `event_msg`, `response_item.function_call`, `function_call_output` | primary approval truth and false-positive suppression | high |
| `codex-tui.log` | early `ToolCall: shell_command` lines and some text ids | early hinting and shell-escalation backup | lower than rollout |

In short:

- rollout is the structured truth source
- `codex-tui.log` is earlier but more heuristic

It also intentionally does not infer approval from `ToolCall: apply_patch`
lines in `codex-tui.log`. Real Codex sessions can emit cross-workspace
`apply_patch` tool calls that execute successfully without any user approval
prompt, and that heuristic caused false positive `Needs Approval` toasts.

For `require_escalated` shell calls, the watcher uses a split policy:

- if rollout JSONL already contains the structured
  `response_item.function_call` with
  `"sandbox_permissions":"require_escalated"`, that is treated as the earliest
  strong local signal and is emitted immediately
- if the command already matches an approved rule in `~/.codex/rules/default.rules`,
  it suppresses the approval notification
- if only the TUI fallback signal exists
  (`ToolCall: shell_command { ... "sandbox_permissions":"require_escalated" ... }`),
  it waits through a 1-second grace window before notifying
- if a matching `function_call_output` arrives during that grace window, the
  pending TUI-fallback notification is cancelled

That combination is meant to suppress the most common false positives from
auto-approved or very fast read-only escalated commands without muting real
approval prompts that remain pending.

> **Note:** by itself, session-watcher mode runs outside the original Codex
> terminal process, so it may have to fall back to Toast-only behavior. If you
> also configure `codex-mcp-sidecar`, the watcher can reuse exact terminal
> context for sessions whose sidecar resolved a matching `sessionId`. That same
> sidecar also auto-starts the watcher when a Codex session begins.

## Common Commands

```bash
claude-code-notify --help
claude-code-notify autostart enable
claude-code-notify autostart status
claude-code-notify codex-session-watch
claude-code-notify codex-mcp-sidecar
claude-code-notify codex-watch
```

## Codex App-Server Watcher (Scoped / Advanced)

Start a long-running watcher that launches the official `codex app-server`
and sends a notification whenever a Codex thread enters
`waitingOnApproval`:

```bash
claude-code-notify codex-watch
```

By default, `codex-watch` only watches threads whose cwd matches the current
directory. To watch every interactive Codex thread instead:

```bash
claude-code-notify codex-watch --all-cwds
```

Optional flags:

- `--cwd <path>`: watch a specific project directory
- `--codex-bin <path>`: override the Codex executable
- `--shell-pid <pid>`: keep the existing manual shell PID override behavior

This mode is kept for app-server-scoped workflows and protocol debugging. In
this project's end-to-end validation, a watcher that launched its own
`codex app-server` did not behave as a global observer for approval requests
originating in other Codex sessions. For stock Codex CLI usage, prefer
`codex-session-watch`.

If your hard requirement is "users configure it once and then keep using the
official Codex CLI with no wrapper," that is another reason not to make
`codex-watch` the primary path. It is closer to a host-side integration mode
than to a seamless add-on for existing CLI sessions.

Under the hood this mode:

1. Starts the official `codex app-server`
2. Sends `initialize`
3. Bootstraps existing threads with `thread/list`
4. Watches `thread/status/changed`
5. Triggers the existing Windows toast flow when `activeFlags` contains `waitingOnApproval`

## Notification Example

**生产版本：**
```
Title:   [Claude] Done (Windows Terminal)
Body:    Task finished
Button:  [Open]
```

**开发版本（本地 npm link）：**
```
Title:   [DEV] [Claude] Done (Windows Terminal)
Body:    Task finished
Button:  [Open]
```

## How It Works

1. Reads notification payload JSON from stdin or argv
2. Walks the process tree (ToolHelp32 snapshot) to find the terminal window
3. Detects the current console shell PID for Windows Terminal tab tracking
4. Writes a WT tab-color OSC immediately in the current process
5. Starts a background watcher that attaches to the target console, re-applies color for async-hook cases, and later resets it only after that tab returns to foreground and produces new console input
6. Sends a native WinRT toast notification (using PowerShell's registered AppUserModelId)
7. Flashes the terminal taskbar button

## Requirements

- Windows 10 / 11
- Node.js >= 16
- PowerShell 5.1+

## Known Limitations

- **Toast source** shows as "Windows PowerShell" instead of "Claude Code" (required for toast to display on Windows 10)
- **Windows 10**: Click-to-activate ("Open" button) may not work due to OS limitations
- **macOS / Linux**: Not supported

## License

MIT
