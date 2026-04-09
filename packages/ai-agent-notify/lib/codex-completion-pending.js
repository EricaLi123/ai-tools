const {
  buildCodexCompletionReceiptKey,
  hasCodexCompletionReceipt,
} = require("./codex-completion-receipts");

const CODEX_COMPLETION_FALLBACK_GRACE_MS = 1500;

function buildPendingCompletionKey(event) {
  if (!event) {
    return "";
  }

  if (event.dedupeKey) {
    return event.dedupeKey;
  }

  return buildCodexCompletionReceiptKey({
    sessionId: event.sessionId,
    turnId: event.turnId,
    eventName: "Stop",
  });
}

function queuePendingCompletionNotification({
  runtime,
  pendingCompletionNotifications,
  emittedEventKeys,
  event,
  nowMs = Date.now(),
}) {
  if (!pendingCompletionNotifications || !event) {
    return;
  }

  const key = buildPendingCompletionKey(event);
  if (!key || (emittedEventKeys && emittedEventKeys.has(key))) {
    return;
  }
  if (pendingCompletionNotifications.has(key)) {
    return;
  }

  const pendingSinceMs = nowMs;
  const graceMs = CODEX_COMPLETION_FALLBACK_GRACE_MS;
  const pending = {
    ...event,
    pendingSinceMs,
    deadlineMs: pendingSinceMs + graceMs,
    graceMs,
    prepared: null,
  };

  pendingCompletionNotifications.set(key, pending);
  if (runtime && typeof runtime.log === "function") {
    runtime.log(
      `queued completion pending sessionId=${pending.sessionId || "unknown"} turnId=${pending.turnId || ""} graceMs=${graceMs} deadlineMs=${pending.deadlineMs}`
    );
  }
}

function flushPendingCompletionNotifications({
  runtime,
  pendingCompletionNotifications,
  emittedEventKeys,
  preparePendingCompletionNotification = defaultPreparePendingCompletionNotification,
  emitPreparedCompletionNotification = defaultEmitPreparedCompletionNotification,
  hasCompletionReceipt = hasCodexCompletionReceipt,
  nowMs = Date.now(),
}) {
  if (!pendingCompletionNotifications) {
    return;
  }

  Array.from(pendingCompletionNotifications.entries()).forEach(([key, pending]) => {
    if (!pendingCompletionNotifications.has(key) || !pending) {
      return;
    }

    if (pending.prepared === null || typeof pending.prepared === "undefined") {
      pending.prepared = preparePendingCompletionNotification({ pending });
    }

    if (Number.isFinite(pending.deadlineMs) && pending.deadlineMs > nowMs) {
      return;
    }

    const receiptExists = hasCompletionReceipt({
      sessionId: pending.sessionId,
      turnId: pending.turnId,
      eventName: "Stop",
      nowMs,
    });

    if (receiptExists) {
      pendingCompletionNotifications.delete(key);
      if (runtime && typeof runtime.log === "function") {
        runtime.log(
          `dropped completion pending sessionId=${pending.sessionId || "unknown"} turnId=${pending.turnId || ""} reason=receipt_found`
        );
      }
      return;
    }

    emitPreparedCompletionNotification({
      prepared: pending.prepared || { event: pending },
      emittedEventKeys,
      origin: "pending",
    });
    pendingCompletionNotifications.delete(key);
  });
}

function defaultPreparePendingCompletionNotification({ pending }) {
  return { event: pending };
}

function defaultEmitPreparedCompletionNotification({ prepared, emittedEventKeys }) {
  const event = prepared && prepared.event;
  if (!event || !event.dedupeKey || !emittedEventKeys || typeof emittedEventKeys.set !== "function") {
    return;
  }

  emittedEventKeys.set(event.dedupeKey, Date.now());
}

module.exports = {
  CODEX_COMPLETION_FALLBACK_GRACE_MS,
  buildPendingCompletionKey,
  flushPendingCompletionNotifications,
  queuePendingCompletionNotification,
};
