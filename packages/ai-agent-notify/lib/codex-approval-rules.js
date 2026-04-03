const fs = require("fs");
const path = require("path");

const { fileExistsCaseInsensitive } = require("./shared-utils");
const {
  extractLeadingCommandTokens,
  isLikelyReadOnlyShellCommand,
  matchesApprovedCommandRule,
} = require("./shell-command-analysis");

const CODEX_APPROVAL_NOTIFY_GRACE_MS = 1000;
const CODEX_READ_ONLY_APPROVAL_NOTIFY_GRACE_MS = 5 * 1000;

function createApprovedCommandRuleCache(filePath) {
  return {
    filePath,
    mtimeMs: -1,
    size: -1,
    rules: [],
  };
}

function getApprovedCommandRules(cache, log) {
  if (!cache || !cache.filePath || !fileExistsCaseInsensitive(cache.filePath)) {
    return [];
  }

  let stat;
  try {
    stat = fs.statSync(cache.filePath);
  } catch (error) {
    if (typeof log === "function") {
      log(`approved rules stat failed file=${cache.filePath} error=${error.message}`);
    }
    return cache.rules || [];
  }

  if (cache.mtimeMs === stat.mtimeMs && cache.size === stat.size && Array.isArray(cache.rules)) {
    return cache.rules;
  }

  try {
    const content = fs.readFileSync(cache.filePath, "utf8");
    cache.rules = parseApprovedCommandRules(content);
    cache.mtimeMs = stat.mtimeMs;
    cache.size = stat.size;
  } catch (error) {
    if (typeof log === "function") {
      log(`approved rules read failed file=${cache.filePath} error=${error.message}`);
    }
  }

  return cache.rules || [];
}

function parseApprovedCommandRules(content) {
  const lines = String(content || "").split(/\r?\n/);
  const rules = [];

  lines.forEach((line) => {
    if (!line.includes('decision="allow"') || !line.includes("prefix_rule(")) {
      return;
    }

    const match = line.match(/prefix_rule\(pattern=(\[[\s\S]*\]), decision="allow"\)\s*$/);
    if (!match) {
      return;
    }

    let pattern;
    try {
      pattern = JSON.parse(match[1]);
    } catch {
      return;
    }

    if (!Array.isArray(pattern) || !pattern.every((value) => typeof value === "string")) {
      return;
    }

    const shellCommand = extractApprovedRuleShellCommand(pattern);
    rules.push({
      pattern,
      shellCommand,
      shellCommandTokens: shellCommand ? extractLeadingCommandTokens(shellCommand) : [],
    });
  });

  return rules;
}

function extractApprovedRuleShellCommand(pattern) {
  if (!Array.isArray(pattern) || pattern.length < 3) {
    return "";
  }

  const exeName = path.basename(pattern[0] || "").toLowerCase();
  const arg1 = String(pattern[1] || "").toLowerCase();
  if (
    (exeName === "powershell.exe" ||
      exeName === "powershell" ||
      exeName === "pwsh.exe" ||
      exeName === "pwsh") &&
    arg1 === "-command"
  ) {
    return String(pattern[2] || "").trim();
  }
  if ((exeName === "cmd.exe" || exeName === "cmd") && arg1 === "/c") {
    return String(pattern[2] || "").trim();
  }
  return "";
}

function getCodexApprovalNotifyGraceMs(event) {
  if (
    event &&
    event.eventType === "require_escalated_tool_call" &&
    isLikelyReadOnlyShellCommand(event.toolArgs)
  ) {
    return CODEX_READ_ONLY_APPROVAL_NOTIFY_GRACE_MS;
  }

  return CODEX_APPROVAL_NOTIFY_GRACE_MS;
}

function getCodexRequireEscalatedSuppressionReason({
  event,
  approvalPolicy,
  sandboxPolicy,
  approvedCommandRules,
}) {
  if (!event || event.eventType !== "require_escalated_tool_call" || !event.toolArgs) {
    return "";
  }

  if (approvalPolicy === "never") {
    return "approval_policy_never";
  }

  if (sandboxPolicy && sandboxPolicy.type === "danger-full-access") {
    return "danger_full_access";
  }

  if (
    isLikelyReadOnlyShellCommand(event.toolArgs) &&
    matchesApprovedCommandRule(event.toolArgs, approvedCommandRules)
  ) {
    return "approved_rule";
  }

  return "";
}

module.exports = {
  createApprovedCommandRuleCache,
  getApprovedCommandRules,
  getCodexApprovalNotifyGraceMs,
  getCodexRequireEscalatedSuppressionReason,
  parseApprovedCommandRules,
};
