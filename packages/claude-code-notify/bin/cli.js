#!/usr/bin/env node

const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const os = require("os");
if (process.platform !== "win32") {
  console.error("claude-code-notify currently only supports Windows.");
  process.exit(1);
}

// 环境变量初值
const envVars = {
  PATH: process.env.PATH || "",
  PATHEXT: process.env.PATHEXT || "",
};

// 初始化
let sessionId, eventName, customTitle, isDev, log;

function getExplicitShellPid() {
  const argv = process.argv.slice(2);
  const argIndex = argv.indexOf("--shell-pid");
  const raw =
    (argIndex >= 0 && argIndex + 1 < argv.length ? argv[argIndex + 1] : "") ||
    process.env.CLAUDE_NOTIFY_SHELL_PID ||
    "";
  const pid = parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function detectShellPid() {
  const detectScript = path.join(__dirname, "..", "scripts", "get-shell-pid.ps1");
  const result = spawnSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", detectScript,
    "-StartPid", String(process.pid),
  ], { encoding: "utf8" });
  if (result.stderr) {
    result.stderr.trim().split(/\r?\n/).filter(Boolean).forEach(l => log(l));
  }
  const pid = parseInt((result.stdout || "").trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

try {
  // Read stdin
  let stdinData = "";
  if (!process.stdin.isTTY) {
    stdinData = fs.readFileSync(0, { encoding: "utf8" });
  }

  let hookJson = null;
  try { hookJson = JSON.parse(stdinData); } catch {}

  sessionId = (hookJson && hookJson.session_id) ? hookJson.session_id : "unknown";
  eventName = (hookJson && hookJson.hook_event_name) || "";
  customTitle = (hookJson && hookJson.title) || "";
  isDev = !fs.existsSync(path.join(__dirname, "..", ".published"));

  const LOG_DIR = path.join(os.tmpdir(), "claude-code-notify");
  fs.mkdirSync(LOG_DIR, { recursive: true });
  envVars.CLAUDE_NOTIFY_LOG_FILE = path.join(LOG_DIR, `session-${sessionId}.log`);

  // 定义 log 函数，写入文件
  log = function(msg) {
    const line = `[${new Date().toISOString()}] [node pid=${process.pid}] ${msg}\n`;
    process.stderr.write(line);
    try { fs.appendFileSync(envVars.CLAUDE_NOTIFY_LOG_FILE, line); } catch {}
  };

  log(`started session=${sessionId}`);
} catch (err) {
  console.error(`init failed: ${err.message}`);
  process.exit(1);
}

// 查找父窗口句柄、父链上的 shell PID、是否 Windows Terminal
function findParentInfo() {
  const findScript = path.join(__dirname, "..", "scripts", "find-hwnd.ps1");
  const result = spawnSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", findScript,
    "-StartPid", String(process.pid),
    "-IncludeShellPid",
  ], { encoding: "utf8" });
  if (result.stderr) {
    result.stderr.trim().split(/\r?\n/).filter(Boolean).forEach(l => log(l));
  }
  // 输出格式: hwnd|shellPid|isWindowsTerminal(1/0)
  const parts = (result.stdout || "").trim().split("|");
  const hwnd = parseInt(parts[0], 10);
  const shellPid = parseInt(parts[1], 10);
  const isWindowsTerminal = parts[2] === "1";
  return {
    hwnd: hwnd > 0 ? hwnd : null,
    shellPid: shellPid > 0 ? shellPid : null,
    isWindowsTerminal,
  };
}

const { hwnd, shellPid: parentShellPid, isWindowsTerminal } = findParentInfo();
const shellPid = getExplicitShellPid() || detectShellPid() || parentShellPid;
if (!shellPid) {
  log("no shell pid detected; tab color watcher disabled");
}

// 构建传递给 notify.ps1 的环境变量
try {
  Object.assign(envVars, {
    CLAUDE_NOTIFY_EVENT: eventName,
    CLAUDE_NOTIFY_IS_DEV: isDev ? "1" : "0",
    CLAUDE_NOTIFY_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR || "",
    ...(customTitle ? { CLAUDE_NOTIFY_TITLE: customTitle } : {}),
    ...(hwnd ? { CLAUDE_NOTIFY_HWND: String(hwnd) } : {}),
  });
} catch (err) {
  log(`buildEnvVars failed: ${err.message}`);
}

// 启动 notify.ps1
const scriptPath = path.join(__dirname, "..", "scripts", "notify.ps1");
const ps = spawn(
  "powershell",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
  { stdio: ["ignore", "inherit", "inherit"], env: envVars }
);

ps.on("close", (code) => {
  log(`notify.ps1 exited code=${code}`);
  process.exit(code || 0);
});

ps.on("error", (err) => {
  log(`spawn failed: ${err.message}`);
  process.exit(0);
});

// Windows Terminal 环境下设置 Tab 颜色
if (isWindowsTerminal) {
  // 颜色映射
  const colorMap = { Stop: "rgb:33/cc/33", PermissionRequest: "rgb:ff/99/00" };
  const tabColor = colorMap[eventName] || "rgb:33/99/ff";
  const oscSet = `\x1b]4;264;${tabColor}\x1b\\`;

  // 在当前 hook 进程仍然挂着原始终端 stdio 的情况下，直接写一遍 OSC。
  // 同时尝试 stdout/stderr，避免不同 hook 启动方式只保留其中一条流。
  try {
    if (process.stdout && !process.stdout.destroyed) {
      process.stdout.write(oscSet);
    }
    if (process.stderr && !process.stderr.destroyed) {
      process.stderr.write(oscSet);
    }
  } catch (e) {
    log(`initial tab color write failed: ${e.message}`);
  }
  if (!shellPid) {
    log("tab color watcher not started because no shell pid was detected");
    return;
  }
  try {
    const launcherScript = path.join(__dirname, "..", "scripts", "start-tab-color-watcher.ps1");
    const watcherPidFile = path.join(
      os.tmpdir(),
      "claude-code-notify",
      `watcher-${process.pid}-${Date.now()}.pid`
    );
    const result = spawnSync(
      "powershell",
      [
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", launcherScript,
        "-TargetPid", String(shellPid),
        "-HookEvent", eventName,
        ...(hwnd ? ["-TerminalHwnd", String(hwnd)] : []),
        "-WatcherPidFile", watcherPidFile,
      ],
      {
        stdio: ["ignore", "ignore", "ignore"],
        env: {
          ...process.env,
          CLAUDE_NOTIFY_LOG_FILE: envVars.CLAUDE_NOTIFY_LOG_FILE,
        },
      }
    );
    if (result.error) {
      throw result.error;
    }
    const watcherPidRaw = fs.existsSync(watcherPidFile)
      ? fs.readFileSync(watcherPidFile, "utf8").trim()
      : "";
    try {
      if (fs.existsSync(watcherPidFile)) {
        fs.unlinkSync(watcherPidFile);
      }
    } catch {}
    const watcherPid = parseInt(watcherPidRaw, 10);
    if (result.status === 0 && Number.isInteger(watcherPid) && watcherPid > 0) {
      log(`tab-color-watcher spawned pid=${watcherPid} shellPid=${shellPid}`);
    } else {
      log(`tab-color-watcher launcher exited status=${result.status} without child pid shellPid=${shellPid}`);
    }
  } catch (err) {
    log(`tab-color-watcher spawn failed: ${err.message}`);
  }
}
