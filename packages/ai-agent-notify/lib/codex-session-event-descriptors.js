const path = require("path");

function parseJsonObjectMaybe(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return typeof value === "object" && !Array.isArray(value) ? value : null;
}

function getCodexExecApprovalDescriptor(toolName, args) {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (command) {
    return `${toolName || "tool"}:${command}`;
  }

  return toolName || "tool";
}

function getCodexInputRequestDescriptor(args) {
  const questions = getCodexInputRequestQuestions(args);
  if (!questions.length) {
    return "request_user_input";
  }

  const parts = questions.slice(0, 3).map((question, index) => {
    return (
      sanitizeDedupeDescriptorPart(question.id) ||
      sanitizeDedupeDescriptorPart(question.header) ||
      sanitizeDedupeDescriptorPart(question.question) ||
      `q${index + 1}`
    );
  });

  return `request_user_input:${parts.join(",")}:${questions.length}`;
}

function getCodexInputRequestMessage(args) {
  const questions = getCodexInputRequestQuestions(args);
  if (!questions.length) {
    return "Waiting for your input";
  }

  const firstQuestion =
    normalizeInlineText(questions[0].question) || normalizeInlineText(questions[0].header);

  if (!firstQuestion) {
    return "Waiting for your input";
  }

  return questions.length > 1 ? `${firstQuestion} (+${questions.length - 1} more)` : firstQuestion;
}

function buildApprovalDedupeKey({
  sessionId,
  turnId,
  callId,
  approvalId,
  fallbackId,
  approvalKind,
  descriptor,
}) {
  return [
    sessionId || "unknown",
    approvalKind || "permission",
    turnId || approvalId || callId || fallbackId || "unknown",
    descriptor || "",
  ].join("|");
}

function parseSessionIdFromRolloutPath(filePath) {
  const match = path
    .basename(filePath)
    .match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/i);
  return match ? match[1] : "";
}

function getSubagentParentSessionId(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }

  if (typeof payload.forked_from_id === "string" && payload.forked_from_id.trim()) {
    return payload.forked_from_id.trim();
  }

  const source = payload.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return "";
  }

  const subagent = source.subagent;
  if (!subagent || typeof subagent !== "object" || Array.isArray(subagent)) {
    return "";
  }

  const threadSpawn = subagent.thread_spawn;
  if (!threadSpawn || typeof threadSpawn !== "object" || Array.isArray(threadSpawn)) {
    return "";
  }

  return typeof threadSpawn.parent_thread_id === "string" ? threadSpawn.parent_thread_id.trim() : "";
}

function normalizeInlineText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sanitizeDedupeDescriptorPart(value) {
  return normalizeInlineText(value).replace(/[|]/g, "/").slice(0, 80);
}

function getCodexInputRequestQuestions(args) {
  return Array.isArray(args && args.questions)
    ? args.questions.filter(
        (question) => question && typeof question === "object" && !Array.isArray(question)
      )
    : [];
}

module.exports = {
  buildApprovalDedupeKey,
  getCodexExecApprovalDescriptor,
  getCodexInputRequestDescriptor,
  getCodexInputRequestMessage,
  getSubagentParentSessionId,
  parseJsonObjectMaybe,
  parseSessionIdFromRolloutPath,
};
