const { emitCodexApprovalNotification } = require("./codex-approval-notify");
const {
  getCodexApprovalNotifyGraceMs,
  getCodexRequireEscalatedSuppressionReason,
} = require("./codex-approval-rules");
const {
  extractCommandApprovalRoots,
  isLikelyReadOnlyShellCommand,
  isPathWithinRoot,
  normalizeShellCommandPath,
} = require("./shell-command-analysis");

const CODEX_APPROVAL_BATCH_WINDOW_MS = 500;
const RECENT_REQUIRE_ESCALATED_TTL_MS = 30 * 60 * 1000;
const SESSION_APPROVAL_CONFIRM_LOOKBACK_MS = 5 * 60 * 1000;
const SESSION_APPROVAL_GRANT_TTL_MS = 30 * 60 * 1000;
const MAX_RECENT_REQUIRE_ESCALATED_EVENTS_PER_SESSION = 64;
const MAX_SESSION_APPROVAL_GRANTS_PER_SESSION = 128;

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
    });
  });
}

function rememberRecentRequireEscalatedEvent(
  recentRequireEscalatedEvents,
  event,
  nowMs = Date.now()
) {
  if (
    !recentRequireEscalatedEvents ||
    !event ||
    event.eventType !== "require_escalated_tool_call" ||
    !event.sessionId ||
    !event.toolArgs
  ) {
    return;
  }

  const sessionId = event.sessionId;
  const recent = pruneRecentRequireEscalatedEvents(
    recentRequireEscalatedEvents,
    sessionId,
    nowMs
  ).filter((item) => item.dedupeKey !== event.dedupeKey);

  recent.push({
    dedupeKey: event.dedupeKey || "",
    projectDir: event.projectDir || "",
    sessionId,
    seenAtMs: nowMs,
    toolArgs: event.toolArgs,
    turnId: event.turnId || "",
  });

  while (recent.length > MAX_RECENT_REQUIRE_ESCALATED_EVENTS_PER_SESSION) {
    recent.shift();
  }

  recentRequireEscalatedEvents.set(sessionId, recent);
}

function confirmSessionApprovalForRecentEvents({
  recentRequireEscalatedEvents,
  runtime,
  sessionApprovalGrants,
  sessionId,
  source,
  turnId,
  nowMs = Date.now(),
}) {
  if (!sessionId || !recentRequireEscalatedEvents || !sessionApprovalGrants) {
    return 0;
  }

  const recent = pruneRecentRequireEscalatedEvents(recentRequireEscalatedEvents, sessionId, nowMs);
  if (!recent.length) {
    return 0;
  }

  const roots = Array.from(
    new Set(
      recent
        .filter(
          (item) =>
            item &&
            item.seenAtMs + SESSION_APPROVAL_CONFIRM_LOOKBACK_MS >= nowMs &&
            (!turnId || !item.turnId || item.turnId === turnId)
        )
        .flatMap((item) => extractCommandApprovalRoots(item.toolArgs))
    )
  );

  const added = rememberSessionApprovalRoots(sessionApprovalGrants, sessionId, roots, {
    confirmedAtMs: nowMs,
    source,
    turnId,
  });

  if (added > 0 && runtime && typeof runtime.log === "function") {
    runtime.log(
      `confirmed session approval sessionId=${sessionId} turnId=${turnId || ""} source=${source || ""} roots=${roots.join(";")}`
    );
  }

  return added;
}

function getSessionRequireEscalatedSuppressionReason({
  event,
  nowMs = Date.now(),
  sessionApprovalGrants,
}) {
  if (
    !event ||
    event.eventType !== "require_escalated_tool_call" ||
    !event.sessionId ||
    !event.toolArgs ||
    !isLikelyReadOnlyShellCommand(event.toolArgs)
  ) {
    return "";
  }

  const grants = pruneSessionApprovalGrants(sessionApprovalGrants, event.sessionId, nowMs);
  if (!grants.length) {
    return "";
  }

  const roots = extractCommandApprovalRoots(event.toolArgs);
  if (!roots.length) {
    return "";
  }

  const matched = roots.some((root) => grants.some((grant) => isPathWithinRoot(root, grant.root)));
  return matched ? "session_recent_read_grant" : "";
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

function pruneRecentRequireEscalatedEvents(
  recentRequireEscalatedEvents,
  sessionId,
  nowMs = Date.now()
) {
  if (!recentRequireEscalatedEvents || !sessionId) {
    return [];
  }

  const recent = recentRequireEscalatedEvents.get(sessionId);
  if (!Array.isArray(recent) || !recent.length) {
    recentRequireEscalatedEvents.delete(sessionId);
    return [];
  }

  const next = recent.filter(
    (item) =>
      item &&
      typeof item.seenAtMs === "number" &&
      item.seenAtMs + RECENT_REQUIRE_ESCALATED_TTL_MS >= nowMs
  );
  if (next.length) {
    recentRequireEscalatedEvents.set(sessionId, next);
  } else {
    recentRequireEscalatedEvents.delete(sessionId);
  }

  return next;
}

function pruneSessionApprovalGrants(sessionApprovalGrants, sessionId, nowMs = Date.now()) {
  if (!sessionApprovalGrants || !sessionId) {
    return [];
  }

  const grants = sessionApprovalGrants.get(sessionId);
  if (!Array.isArray(grants) || !grants.length) {
    sessionApprovalGrants.delete(sessionId);
    return [];
  }

  const next = grants.filter(
    (item) =>
      item &&
      typeof item.confirmedAtMs === "number" &&
      item.confirmedAtMs + SESSION_APPROVAL_GRANT_TTL_MS >= nowMs
  );
  if (next.length) {
    sessionApprovalGrants.set(sessionId, next);
  } else {
    sessionApprovalGrants.delete(sessionId);
  }

  return next;
}

function rememberSessionApprovalRoots(
  sessionApprovalGrants,
  sessionId,
  roots,
  { confirmedAtMs = Date.now(), source = "", turnId = "" } = {}
) {
  if (!sessionApprovalGrants || !sessionId || !Array.isArray(roots) || !roots.length) {
    return 0;
  }

  const grants = pruneSessionApprovalGrants(sessionApprovalGrants, sessionId, confirmedAtMs);
  let added = 0;

  roots.forEach((root) => {
    const normalizedRoot = normalizeShellCommandPath(root);
    if (!normalizedRoot) {
      return;
    }

    const existing = grants.find((item) => item.root === normalizedRoot);
    if (existing) {
      existing.confirmedAtMs = confirmedAtMs;
      existing.source = source || existing.source || "";
      existing.turnId = turnId || existing.turnId || "";
      return;
    }

    grants.push({
      confirmedAtMs,
      root: normalizedRoot,
      source,
      turnId,
    });
    added += 1;
  });

  while (grants.length > MAX_SESSION_APPROVAL_GRANTS_PER_SESSION) {
    grants.shift();
  }

  if (grants.length) {
    sessionApprovalGrants.set(sessionId, grants);
  }

  return added;
}

module.exports = {
  buildPendingApprovalBatchKey,
  cancelPendingApprovalNotification,
  cancelPendingApprovalNotificationsBySuppression,
  confirmSessionApprovalForRecentEvents,
  drainPendingApprovalBatch,
  flushPendingApprovalNotifications,
  getSessionRequireEscalatedSuppressionReason,
  queuePendingApprovalNotification,
  rememberRecentRequireEscalatedEvent,
  shouldBatchPendingApproval,
};
