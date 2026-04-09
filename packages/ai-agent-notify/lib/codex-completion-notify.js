const {
  resolveApprovalTerminalContext,
  shouldEmitEventKey,
} = require("./codex-approval-notify");
const { emitNotification } = require("./notify-runtime");

function prepareCodexCompletionNotification({
  event,
  runtime,
  terminal,
  sessionsDir,
  resolveTerminalContext = resolveApprovalTerminalContext,
}) {
  return {
    event,
    notificationTerminal: resolveTerminalContext({
      sessionId: event && event.sessionId,
      projectDir: event && event.projectDir,
      fallbackTerminal: terminal,
      log: runtime && runtime.log,
      sessionsDir,
    }),
  };
}

function emitPreparedCodexCompletionNotification({
  prepared,
  runtime,
  emittedEventKeys,
  origin,
  emitNotificationImpl = emitNotification,
}) {
  const event = prepared && prepared.event;
  if (!event || !shouldEmitEventKey(emittedEventKeys, event.dedupeKey)) {
    return false;
  }

  runtime.log(
    `${origin} completion fallback matched type=${event.eventType} sessionId=${event.sessionId || "unknown"} turnId=${event.turnId || ""} cwd=${event.projectDir || ""}`
  );

  const child = emitNotificationImpl({
    source: event.source,
    eventName: event.eventName,
    title: event.title,
    message: event.message,
    rawEventType: event.eventType,
    runtime,
    terminal: prepared.notificationTerminal,
  });

  if (child && typeof child.on === "function") {
    child.on("close", (code) => {
      runtime.log(
        `notify.ps1 exited code=${code} sessionId=${event.sessionId || "unknown"} eventType=${event.eventType}`
      );
    });

    child.on("error", (error) => {
      runtime.log(
        `notify.ps1 spawn failed sessionId=${event.sessionId || "unknown"} eventType=${event.eventType} error=${error.message}`
      );
    });
  }

  return true;
}

module.exports = {
  emitPreparedCodexCompletionNotification,
  prepareCodexCompletionNotification,
};
