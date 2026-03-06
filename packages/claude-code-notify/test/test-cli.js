#!/usr/bin/env node

// Unit & integration tests for claude-code-notify (zero test framework dependencies)
// Run: node test/test-cli.js

const { execFileSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "assertion failed");
}

// ---------------------------------------------------------------------------
// 1. File structure
// ---------------------------------------------------------------------------
console.log("\n--- File structure ---");

test("bin/cli.js exists", () => {
  assert(fs.existsSync(path.join(ROOT, "bin", "cli.js")));
});

test("scripts/notify.ps1 exists", () => {
  assert(fs.existsSync(path.join(ROOT, "scripts", "notify.ps1")));
});

test("scripts/register-protocol.ps1 exists", () => {
  assert(fs.existsSync(path.join(ROOT, "scripts", "register-protocol.ps1")));
});

test("postinstall.js exists", () => {
  assert(fs.existsSync(path.join(ROOT, "postinstall.js")));
});

test("bootstrap.js removed", () => {
  assert(!fs.existsSync(path.join(ROOT, "bootstrap.js")));
});

test("setup.js removed", () => {
  assert(!fs.existsSync(path.join(ROOT, "setup.js")));
});

test("activate-window-silent.vbs removed", () => {
  assert(!fs.existsSync(path.join(ROOT, "scripts", "activate-window-silent.vbs")));
});

test("activate-window.ps1 removed", () => {
  assert(!fs.existsSync(path.join(ROOT, "scripts", "activate-window.ps1")));
});

// ---------------------------------------------------------------------------
// 2. package.json
// ---------------------------------------------------------------------------
console.log("\n--- package.json ---");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("version is 2.0.0", () => {
  assert(pkg.version === "2.0.0", `got ${pkg.version}`);
});

test("has postinstall script", () => {
  assert(pkg.scripts && pkg.scripts.postinstall === "node postinstall.js");
});

test("has zero dependencies", () => {
  const deps = Object.keys(pkg.dependencies || {});
  assert(deps.length === 0, `unexpected deps: ${deps.join(", ")}`);
});

test("files includes postinstall.js", () => {
  assert(pkg.files && pkg.files.includes("postinstall.js"));
});

test("files does not include setup.js", () => {
  assert(!pkg.files || !pkg.files.includes("setup.js"));
});

test("files does not include bootstrap.js", () => {
  assert(!pkg.files || !pkg.files.includes("bootstrap.js"));
});

// ---------------------------------------------------------------------------
// 3. notify.ps1 content checks
// ---------------------------------------------------------------------------
console.log("\n--- notify.ps1 content ---");

const notifyContent = fs.readFileSync(
  path.join(ROOT, "scripts", "notify.ps1"),
  "utf8"
);

test("no BurntToast import", () => {
  assert(!notifyContent.includes("Import-Module BurntToast"));
});

test("no BurntToast module check", () => {
  assert(!notifyContent.includes("Get-Module -Name BurntToast"));
});

test("uses WinRT ToastNotificationManager", () => {
  assert(notifyContent.includes("Windows.UI.Notifications.ToastNotificationManager"));
});

test("uses XML toast template", () => {
  assert(notifyContent.includes("<toast>"));
  assert(notifyContent.includes("ToastGeneric"));
});

test("uses SecurityElement::Escape for XML safety", () => {
  assert(notifyContent.includes("SecurityElement]::Escape"));
});

test("supports protocol activation button", () => {
  assert(notifyContent.includes("activationType"));
});

test("has FlashWindowEx taskbar flash", () => {
  assert(notifyContent.includes("FlashWindowEx"));
});

test("reads stdin via Console::In", () => {
  assert(notifyContent.includes("[Console]::In"));
});

// ---------------------------------------------------------------------------
// 4. register-protocol.ps1 content checks
// ---------------------------------------------------------------------------
console.log("\n--- register-protocol.ps1 content ---");

const regContent = fs.readFileSync(
  path.join(ROOT, "scripts", "register-protocol.ps1"),
  "utf8"
);

test("no VBS/wscript reference", () => {
  assert(!regContent.includes("wscript"));
  assert(!regContent.includes(".vbs"));
});

test("uses EncodedCommand", () => {
  assert(regContent.includes("EncodedCommand"));
});

test("sets _CCN_URL env var in cmd wrapper", () => {
  assert(regContent.includes("set _CCN_URL=%1"));
});

test("includes SetForegroundWindow in activate script", () => {
  assert(regContent.includes("SetForegroundWindow"));
});

test("includes IsIconic check for minimized windows", () => {
  assert(regContent.includes("IsIconic"));
});

// ---------------------------------------------------------------------------
// 5. cli.js content checks
// ---------------------------------------------------------------------------
console.log("\n--- cli.js content ---");

const cliContent = fs.readFileSync(
  path.join(ROOT, "bin", "cli.js"),
  "utf8"
);

test("no setup subcommand", () => {
  assert(!cliContent.includes('"setup"'));
  assert(!cliContent.includes("setup.js"));
});

test("no bootstrap require", () => {
  assert(!cliContent.includes("bootstrap"));
  assert(!cliContent.includes("ensureSetup"));
});

test("spawns notify.ps1", () => {
  assert(cliContent.includes("notify.ps1"));
});

test("pipes stdin", () => {
  assert(cliContent.includes("process.stdin.pipe"));
});

// ---------------------------------------------------------------------------
// 6. postinstall.js content checks
// ---------------------------------------------------------------------------
console.log("\n--- postinstall.js content ---");

const postinstallContent = fs.readFileSync(
  path.join(ROOT, "postinstall.js"),
  "utf8"
);

test("skips on non-win32", () => {
  assert(postinstallContent.includes('process.platform !== "win32"'));
});

test("runs register-protocol.ps1", () => {
  assert(postinstallContent.includes("register-protocol.ps1"));
});

// ---------------------------------------------------------------------------
// 7. Integration: CLI process runs and exits cleanly
// ---------------------------------------------------------------------------
console.log("\n--- Integration ---");

if (process.platform === "win32") {
  test("cli.js exits cleanly with Stop event", () => {
    const result = execFileSync(
      "node",
      [path.join(ROOT, "bin", "cli.js")],
      {
        input: '{"hook_event_name":"Stop"}',
        timeout: 15000,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    // No crash = pass
  });

  test("cli.js exits cleanly with PermissionRequest event", () => {
    const result = execFileSync(
      "node",
      [path.join(ROOT, "bin", "cli.js")],
      {
        input: '{"hook_event_name":"PermissionRequest"}',
        timeout: 15000,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  });

  test("cli.js exits cleanly with empty stdin", () => {
    const result = execFileSync(
      "node",
      [path.join(ROOT, "bin", "cli.js")],
      {
        input: "",
        timeout: 15000,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  });

  test("cli.js exits cleanly with malformed JSON", () => {
    const result = execFileSync(
      "node",
      [path.join(ROOT, "bin", "cli.js")],
      {
        input: "not json at all",
        timeout: 15000,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  });

  test("protocol registry key exists", () => {
    const result = execFileSync(
      "reg",
      [
        "query",
        "HKCU\\Software\\Classes\\erica-s.claude-code-notify.activate-window\\shell\\open\\command",
      ],
      { encoding: "utf8", timeout: 5000 }
    );
    assert(result.includes("EncodedCommand"), "registry value should contain EncodedCommand");
  });
} else {
  console.log("  SKIP  (Windows-only integration tests)");
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
