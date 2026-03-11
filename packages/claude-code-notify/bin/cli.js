#!/usr/bin/env node

const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

if (process.platform !== "win32") {
  console.error("claude-code-notify currently only supports Windows.");
  process.exit(1);
}

// Read stdin so we can extract session_id for the log file name,
// then forward the data to notify.ps1 via pipe.
let stdinData = "";
try {
  if (!process.stdin.isTTY) {
    stdinData = fs.readFileSync(0, { encoding: "utf8" });
  }
} catch {}

let hookJson = null;
try { hookJson = JSON.parse(stdinData); } catch {}

const sessionId = (hookJson && hookJson.session_id) ? hookJson.session_id : "unknown";

const LOG_DIR = path.join(os.tmpdir(), "claude-code-notify");
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
const LOG_FILE = path.join(LOG_DIR, `session-${sessionId}.log`);

function log(msg) {
  const line = `[${new Date().toISOString()}] [node pid=${process.pid}] ${msg}\n`;
  process.stderr.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

log(`started session=${sessionId} event=${hookJson && hookJson.hook_event_name}`);
log(`log file: ${LOG_FILE}`);

// Log all environment variables for debugging
log("=== Environment Variables ===");
Object.entries(process.env).sort().forEach(([k, v]) => log(`  ${k}=${v}`));
log("=== End Environment ===")

// ---------------------------------------------------------------------------
// Walk the parent-process chain from this Node process to find the first
// ancestor with a visible window (hwnd != 0).
//
// Why do this in Node rather than inside notify.ps1?
// When Claude Code runs inside VSCode/Cursor's integrated git bash, the chain
// looks like:
//   Code.exe (hwnd=X) → Code.exe extensionHost (hwnd=0)
//     → bash (MSYS2) → node (Claude Code) → cmd.exe → node (cli.js) → powershell
// MSYS2 breaks the Windows parent-PID chain at the bash boundary, so
// PowerShell can't walk up to Code.exe from its own $PID.  But Node is a
// plain Win32 process whose parent chain is intact all the way to Code.exe,
// so find-hwnd.ps1 started by spawnSync (before any MSYS2 involvement)
// succeeds.
// ---------------------------------------------------------------------------
function findParentWindowHwnd() {
  const findScript = path.join(__dirname, "..", "scripts", "find-hwnd.ps1");
  log(`find-hwnd: StartPid=${process.pid}`);
  const result = spawnSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", findScript,
    "-StartPid", String(process.pid),
  ], { encoding: "utf8" });
  if (result.stderr) {
    result.stderr.trim().split(/\r?\n/).filter(Boolean).forEach(l => log(l));
  }
  const hwnd = parseInt((result.stdout || "").trim(), 10);
  log(`find-hwnd result: hwnd=${hwnd}`);
  return hwnd > 0 ? hwnd : null;
}

const hwnd = findParentWindowHwnd();

const scriptPath = path.join(__dirname, "..", "scripts", "notify.ps1");
const ps = spawn(
  "powershell",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
  {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      CLAUDE_NOTIFY_LOG_FILE: LOG_FILE,
      CLAUDE_NOTIFY_EVENT: (hookJson && hookJson.hook_event_name) || "",
      CLAUDE_NOTIFY_SESSION_ID: sessionId,
      ...(hwnd ? { CLAUDE_NOTIFY_HWND: String(hwnd) } : {}),
    },
  }
);

ps.on("close", (code) => {
  log(`notify.ps1 exited code=${code}`);
  process.exit(code || 0);
});

ps.on("error", (err) => {
  log(`spawn failed: ${err.message}`);
  process.exit(0);
});
