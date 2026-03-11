# 开发说明

## 架构

```
Claude Hook (stdin JSON)
  → bin/cli.js
      ├─ 读 stdin → 提取 session_id、hook_event_name
      ├─ 建 log 文件：%TEMP%\claude-code-notify\session-<id>.log
      ├─ spawnSync scripts/find-hwnd.ps1（从 Node PID 向上找有窗口的祖先进程）
      │     └─ 返回 hwnd（或 0）
      └─ spawn scripts/notify.ps1（通过环境变量传入 hwnd、event、log 路径）
            ├─ 用 CLAUDE_NOTIFY_HWND 发 toast
            └─ flash 任务栏
```

**为什么 hwnd 查找在 Node 侧（cli.js）而不是在 notify.ps1 里做：**
VSCode 集成 git bash 场景下，MSYS2 bash fork 会断开 PowerShell 自身的父进程链，
但 Node.exe 是纯 Win32 进程，其父链完整，因此在 Node 侧查找更可靠。

## 环境变量（cli.js → notify.ps1）

| 变量 | 说明 |
|------|------|
| `CLAUDE_NOTIFY_LOG_FILE` | log 文件完整路径 |
| `CLAUDE_NOTIFY_EVENT` | hook 事件名（Stop / PermissionRequest） |
| `CLAUDE_NOTIFY_SESSION_ID` | 会话 ID |
| `CLAUDE_NOTIFY_HWND` | 终端窗口句柄（找不到时不设置） |

## 已知问题及解决方案

### VSCode/Cursor 集成 git bash — 窗口检测

**现象：** toast 标题显示 `(Terminal)`，任务栏无闪烁。

**根本原因：** MSYS2 bash fork 导致 Windows 父进程链在 bash 边界断开，
从 Node 进程向上走，depth=12 时遇到已退出进程，链断，走不到 `Code.exe`。

**否决的方案：**

- ❌ 进程名匹配（搜索所有 `Code.exe` / `Cursor.exe`）— 多窗口时会选错，不可靠
- ❌ `VSCODE_PID` 环境变量 — VSCode 集成 git bash 场景下实测不注入此变量

**最终方案：** `VSCODE_GIT_IPC_HANDLE` 命名管道

VSCode 在所有集成终端中注入 `VSCODE_GIT_IPC_HANDLE`（named pipe 路径）。
用 Win32 API `GetNamedPipeServerProcessId` 获取该 pipe 的服务端 PID（即当前
VSCode 实例的 extension host），再向上一步即到主窗口。

```
VSCODE_GIT_IPC_HANDLE=\\.\pipe\vscode-git-ec9a16cdec-sock
  → GetNamedPipeServerProcessId → pid=25792（Code.exe extensionHost，hwnd=0）
  → parent → pid=19056（Code.exe 主窗口，hwnd=394950）✓
```

实现位置：`scripts/find-hwnd.ps1` 主链断后的 fallback 块。
