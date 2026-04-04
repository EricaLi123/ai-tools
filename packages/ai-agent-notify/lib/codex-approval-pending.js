const { emitCodexApprovalNotification } = require("./codex-approval-notify");
const {
  getCodexApprovalNotifyGraceMs,
  getCodexRequireEscalatedSuppressionReason,
} = require("./codex-approval-rules");
const { getSessionRequireEscalatedSuppressionReason } = require("./codex-approval-session-grants");

const CODEX_APPROVAL_BATCH_WINDOW_MS = 500;

function queuePendingApprovalNotification({
  runtime,
  pendingApprovalNotifications,
  pendingApprovalCallIds,
  emittedEventKeys,
  event,
}) {
  const key = event.dedupeKey || `${event.sessionId || "unknown"}|${event.turnId || "unknown"}`;
  if (key && emittedEventKeys && emittedEventKeys.has(key)) {
    return;
  }
  const existing = pendingApprovalNotifications.get(key);

  if (existing) {
    if (!existing.callId && event.callId) {
      existing.callId = event.callId;
      pendingApprovalCallIds.set(event.callId, key);
    }
    return;
  }

  const graceMs = getCodexApprovalNotifyGraceMs(event);
  const pending = {
    ...event,
    pendingSinceMs: Date.now(),
    deadlineMs: Date.now() + graceMs,
    graceMs,
  };

  pendingApprovalNotifications.set(key, pending);
  if (pending.callId) {
    pendingApprovalCallIds.set(pending.callId, key);
  }

  runtime.log(
    `queued approval pending sessionId=${pending.sessionId || "unknown"} turnId=${pending.turnId || ""} callId=${pending.callId || ""} graceMs=${graceMs} deadlineMs=${pending.deadlineMs}`
  );
}

function cancelPendingApprovalNotification({
  runtime,
  pendingApprovalNotifications,
  pendingApprovalCallIds,
  callId,
  reason,
}) {
  if (!callId) {
    return false;
  }

  const key = pendingApprovalCallIds.get(callId);
  if (!key) {
    return false;
  }

  return cancelPendingApprovalNotificationByKey({
    runtime,
    pendingApprovalNotifications,
    pendingApprovalCallIds,
    key,
    reason,
  });
}

function cancelPendingApprovalNotificationsBySuppression({
  runtime,
  pendingApprovalNotifications,
  pendingApprovalCallIds,
  sessionId,
  turnId = "",
  approvalPolicy = "",
  sandboxPolicy = null,
  approvedCommandRules = [],
  sessionApprovalGrants,
  nowMs = Date.now(),
}) {
  if (!runtime || !pendingApprovalNotifications || !sessionId) {
    return 0;
  }

  let cancelled = 0;
  Array.from(pendingApprovalNotifications.entries()).forEach(([key, pending]) => {
    if (!pending || pending.sessionId !== sessionId) {
      return;
    }
    if (turnId && pending.turnId && pending.turnId !== turnId) {
      return;
    }

    const suppressionReason =
      getCodexRequireEscalatedSuppressionReason({
        event: pending,
        approvalPolicy,
        sandboxPolicy,
        approvedCommandRules,
      }) ||
      getSessionRequireEscalatedSuppressionReason({
        event: pending,
        nowMs,
        sessionApprovalGrants,
      });

    if (!suppressionReason) {
      return;
    }

    if (
      cancelPendingApprovalNotificationByKey({
        runtime,
        pendingApprovalNotifications,
        pendingApprovalCallIds,
        key,
        reason: suppressionReason,
      })
    ) {
      cancelled += 1;
    }
  });

  return cancelled;
}

function buildPendingApprovalBatchKey(event) {
  if (!event) {
    return "";
  }

  if (event.eventType === "require_escalated_tool_call") {
    return [event.sessionId || "unknown", event.turnId || "unknown", event.eventType].join("|");
  }

  return (
    event.dedupeKey ||
    [event.sessionId || "unknown", event.turnId || "unknown", event.eventType || ""].join("|")
  );
}

function shouldBatchPendingApproval(representative, pending) {
  if (!representative || !pending) {
    return false;
  }

  if (buildPendingApprovalBatchKey(representative) !== buildPendingApprovalBatchKey(pending)) {
    return false;
  }

  if (representative.eventType !== "require_escalated_tool_call") {
    return representative.dedupeKey === pending.dedupeKey;
  }

  const representativePendingSince = Number.isFinite(representative.pendingSinceMs)
    ? representative.pendingSinceMs
    : 0;
  const pendingSince = Number.isFinite(pending.pendingSinceMs) ? pending.pendingSinceMs : 0;

  return Math.abs(pendingSince - representativePendingSince) <= CODEX_APPROVAL_BATCH_WINDOW_MS;
}

function drainPendingApprovalBatch({
  pendingApprovalNotifications,
  pendingApprovalCallIds,
  representativeKey,
}) {
  if (!pendingApprovalNotifications || !representativeKey) {
    return { batchKey: "", count: 0, representative: null };
  }

  const representative = pendingApprovalNotifications.get(representativeKey);
  if (!representative) {
    return { batchKey: "", count: 0, representative: null };
  }

  const batchKey = buildPendingApprovalBatchKey(representative);
  const removed = [];

  Array.from(pendingApprovalNotifications.entries()).forEach(([key, pending]) => {
    if (!shouldBatchPendingApproval(representative, pending)) {
      return;
    }

    pendingApprovalNotifications.delete(key);
    if (pending.callId) {
      pendingApprovalCallIds.delete(pending.callId);
    }
    removed.push({ key, pending });
  });

  return {
    batchKey,
    count: removed.length,
    representative,
  };
}

function flushPendingApprovalNotifications({
  runtime,
  terminal,
  emittedEventKeys,
  pendingApprovalNotifications,
  pendingApprovalCallIds,
  sessionsDir,
}) {
  const now = Date.now();
  Array.from(pendingApprovalNotifications.entries()).forEach(([key, pending]) => {
    if (!pendingApprovalNotifications.has(key)) {
      return;
    }
    if (pending.deadlineMs > now) {
      return;
    }

    const batch = drainPendingApprovalBatch({
      pendingApprovalNotifications,
      pendingApprovalCallIds,
      representativeKey: key,
    });
    if (!batch.representative) {
      return;
    }

    if (batch.count > 1) {
      runtime.log(
        `grouped approval batch sessionId=${batch.representative.sessionId || "unknown"} turnId=${batch.representative.turnId || ""} batchSize=${batch.count}`
      );
    }

    emitCodexApprovalNotification({
      event: batch.representative,
      runtime,
      terminal,
      emittedEventKeys,
      origin: "pending",
      sessionsDir,
    });
  });
}

function cancelPendingApprovalNotificationByKey({
  runtime,
  pendingApprovalNotifications,
  pendingApprovalCallIds,
  key,
  reason,
}) {
  if (!key) {
    return false;
  }

  const pending = pendingApprovalNotifications.get(key);
  if (!pending) {
    pendingApprovalCallIds.forEach((mappedKey, mappedCallId) => {
      if (mappedKey === key) {
        pendingApprovalCallIds.delete(mappedCallId);
      }
    });
    return false;
  }

  pendingApprovalNotifications.delete(key);
  if (pending.callId) {
    pendingApprovalCallIds.delete(pending.callId);
  }
  runtime.log(
    `cancelled approval pending sessionId=${pending.sessionId || "unknown"} turnId=${pending.turnId || ""} callId=${pending.callId || ""} reason=${reason || "unknown"}`
  );
  return true;
}

module.exports = {
  buildPendingApprovalBatchKey,
  cancelPendingApprovalNotification,
  cancelPendingApprovalNotificationsBySuppression,
  drainPendingApprovalBatch,
  flushPendingApprovalNotifications,
  queuePendingApprovalNotification,
  shouldBatchPendingApproval,
};
