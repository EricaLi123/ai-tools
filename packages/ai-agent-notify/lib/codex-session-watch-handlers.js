const {
  cancelPendingApprovalNotification,
  cancelPendingApprovalNotificationsBySuppression,
  queuePendingApprovalNotification,
} = require("./codex-approval-pending");
const { emitCodexApprovalNotification } = require("./codex-approval-notify");
const {
  getApprovedCommandRules,
  getCodexRequireEscalatedSuppressionReason,
} = require("./codex-approval-rules");
const {
  confirmSessionApprovalForRecentEvents,
  getSessionRequireEscalatedSuppressionReason,
  rememberRecentRequireEscalatedEvent,
} = require("./codex-approval-session-grants");
const {
  buildCodexSessionEvent,
  isApprovedCommandRuleSavedRecord,
} = require("./codex-session-rollout-events");
const {
  buildCodexTuiApprovalEvent,
  buildCodexTuiInputEvent,
  parseCodexTuiApprovalConfirmation,
} = require("./codex-session-tui-events");
const { parseSessionIdFromRolloutPath } = require("./codex-session-event-descriptors");
const { stripUtf8Bom } = require("./shared-utils");

function handleSessionRecord(
  state,
  line,
  {
    runtime,
    terminal,
    emittedEventKeys,
    pendingApprovalNotifications,
    pendingApprovalCallIds,
    recentRequireEscalatedEvents,
    sessionApprovalGrants,
    approvedCommandRuleCache,
  }
) {
  let record;
  try {
    record = JSON.parse(stripUtf8Bom(line));
  } catch (error) {
    runtime.log(`failed to parse session line file=${state.filePath} error=${error.message}`);
    return;
  }

  if (record.type === "session_meta" && record.payload) {
    if (record.payload.id) {
      state.sessionId = record.payload.id;
    }
    if (record.payload.cwd) {
      state.cwd = record.payload.cwd;
    }
    return;
  }

  if (record.type === "turn_context" && record.payload) {
    if (record.payload.cwd) {
      state.cwd = record.payload.cwd;
    }
    if (record.payload.turn_id) {
      state.turnId = record.payload.turn_id;
    }
    if (record.payload.approval_policy) {
      state.approvalPolicy = record.payload.approval_policy;
    }
    if (record.payload.sandbox_policy) {
      state.sandboxPolicy = record.payload.sandbox_policy;
    }
    return;
  }

  if (
    record.type === "response_item" &&
    record.payload &&
    record.payload.type === "function_call_output" &&
    record.payload.call_id
  ) {
    cancelPendingApprovalNotification({
      runtime,
      pendingApprovalNotifications,
      pendingApprovalCallIds,
      callId: record.payload.call_id,
      reason: "function_call_output",
    });
    return;
  }

  if (isApprovedCommandRuleSavedRecord(record)) {
    const sessionId = getSessionIdForState(state);
    confirmSessionApprovalForRecentEvents({
      recentRequireEscalatedEvents,
      runtime,
      sessionApprovalGrants,
      sessionId,
      source: "approved_rule_saved",
      turnId: state.turnId || "",
    });
    cancelPendingApprovalNotificationsBySuppression({
      runtime,
      pendingApprovalNotifications,
      pendingApprovalCallIds,
      sessionId,
      turnId: state.turnId || "",
      approvalPolicy: state.approvalPolicy || "",
      sandboxPolicy: state.sandboxPolicy || null,
      approvedCommandRules: getApprovedRules(approvedCommandRuleCache, runtime),
      sessionApprovalGrants,
    });
    return;
  }

  if (
    (record.type !== "event_msg" && record.type !== "response_item") ||
    !record.payload ||
    typeof record.payload.type !== "string"
  ) {
    return;
  }

  const event = buildCodexSessionEvent(state, record);
  if (!event) {
    return;
  }

  if (event.eventType !== "require_escalated_tool_call") {
    emitCodexApprovalNotification({
      event,
      runtime,
      terminal,
      emittedEventKeys,
      origin: "session",
    });
    return;
  }

  processRequireEscalatedEvent({
    event,
    runtime,
    terminal,
    emittedEventKeys,
    pendingApprovalNotifications,
    pendingApprovalCallIds,
    recentRequireEscalatedEvents,
    sessionApprovalGrants,
    approvedCommandRuleCache,
    origin: "session",
    approvalPolicy: state.approvalPolicy,
    sandboxPolicy: state.sandboxPolicy,
    allowImmediateDispatch: true,
  });
}

function handleCodexTuiLogLine(
  tuiState,
  line,
  {
    runtime,
    terminal,
    emittedEventKeys,
    sessionProjectDirs,
    sessionApprovalContexts,
    pendingApprovalNotifications,
    pendingApprovalCallIds,
    recentRequireEscalatedEvents,
    sessionApprovalGrants,
    approvedCommandRuleCache,
  }
) {
  if (!line || !line.trim()) {
    return;
  }

  const confirmation = parseCodexTuiApprovalConfirmation(line);
  if (confirmation) {
    const approvalContext = sessionApprovalContexts.get(confirmation.sessionId || "");
    confirmSessionApprovalForRecentEvents({
      recentRequireEscalatedEvents,
      runtime,
      sessionApprovalGrants,
      sessionId: confirmation.sessionId,
      source: confirmation.source,
    });
    cancelPendingApprovalNotificationsBySuppression({
      runtime,
      pendingApprovalNotifications,
      pendingApprovalCallIds,
      sessionId: confirmation.sessionId,
      approvalPolicy: (approvalContext && approvalContext.approvalPolicy) || "",
      sandboxPolicy: (approvalContext && approvalContext.sandboxPolicy) || null,
      sessionApprovalGrants,
    });
    return;
  }

  const event =
    buildCodexTuiApprovalEvent(tuiState, line, {
      sessionProjectDirs,
      sessionApprovalContexts,
    }) ||
    buildCodexTuiInputEvent(tuiState, line, {
      sessionProjectDirs,
    });
  if (!event) {
    return;
  }

  if (event.eventType !== "require_escalated_tool_call") {
    emitCodexApprovalNotification({
      event,
      runtime,
      terminal,
      emittedEventKeys,
      origin: "tui",
    });
    return;
  }

  const approvalContext = sessionApprovalContexts.get(event.sessionId || "");
  processRequireEscalatedEvent({
    event,
    runtime,
    terminal,
    emittedEventKeys,
    pendingApprovalNotifications,
    pendingApprovalCallIds,
    recentRequireEscalatedEvents,
    sessionApprovalGrants,
    approvedCommandRuleCache,
    origin: "tui",
    approvalPolicy: approvalContext && approvalContext.approvalPolicy,
    sandboxPolicy: approvalContext && approvalContext.sandboxPolicy,
    allowImmediateDispatch: false,
  });
}

function processRequireEscalatedEvent({
  event,
  runtime,
  terminal,
  emittedEventKeys,
  pendingApprovalNotifications,
  pendingApprovalCallIds,
  recentRequireEscalatedEvents,
  sessionApprovalGrants,
  approvedCommandRuleCache,
  origin,
  approvalPolicy,
  sandboxPolicy,
  allowImmediateDispatch,
}) {
  const suppressionReason = getCodexRequireEscalatedSuppressionReason({
    event,
    approvalPolicy,
    sandboxPolicy,
    approvedCommandRules: getApprovedRules(approvedCommandRuleCache, runtime),
  });
  if (suppressionReason) {
    logSuppressedRequireEscalated(runtime, origin, event, suppressionReason);
    return;
  }

  const sessionSuppressionReason = getSessionRequireEscalatedSuppressionReason({
    event,
    sessionApprovalGrants,
  });
  if (sessionSuppressionReason) {
    logSuppressedRequireEscalated(runtime, origin, event, sessionSuppressionReason);
    return;
  }

  rememberRecentRequireEscalatedEvent(recentRequireEscalatedEvents, event);

  if (allowImmediateDispatch && event.approvalDispatch === "immediate") {
    emitCodexApprovalNotification({
      event,
      runtime,
      terminal,
      emittedEventKeys,
      origin,
    });
    return;
  }

  queuePendingApprovalNotification({
    runtime,
    pendingApprovalNotifications,
    pendingApprovalCallIds,
    emittedEventKeys,
    event,
  });
}

function getApprovedRules(approvedCommandRuleCache, runtime) {
  return getApprovedCommandRules(approvedCommandRuleCache, runtime.log);
}

function getSessionIdForState(state) {
  return state.sessionId || parseSessionIdFromRolloutPath(state.filePath) || "";
}

function logSuppressedRequireEscalated(runtime, origin, event, reason) {
  runtime.log(
    `suppressed ${origin} require_escalated sessionId=${event.sessionId || "unknown"} turnId=${event.turnId || ""} reason=${reason}`
  );
}

module.exports = {
  handleCodexTuiLogLine,
  handleSessionRecord,
};
