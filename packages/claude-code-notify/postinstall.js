#!/usr/bin/env node

if (process.platform !== "win32") {
  process.exit(0);
}

const { execFileSync } = require("child_process");
const path = require("path");

const script = path.join(__dirname, "scripts", "register-protocol.ps1");
try {
  execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    { stdio: "inherit" }
  );
} catch {
  // Non-fatal — protocol registration is nice-to-have
  console.warn("claude-code-notify: protocol registration skipped (non-fatal)");
}
