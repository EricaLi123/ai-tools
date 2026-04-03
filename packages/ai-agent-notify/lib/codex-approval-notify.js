const {
  findSidecarTerminalContextForProjectDir,
  findSidecarTerminalContextForSession,
} = require("./codex-sidecar-state");
const { emitNotification } = require("./notify-runtime");

function emitCodexApprovalNotification({ event, runtime, terminal, emittedEventKeys, origin }) {
  if (!shouldEmitEventKey(emittedEventKeys, event.dedupeKey)) {
    return false;
  }

  runtime.log(
    `${origin} event matched type=${event.eventType} sessionId=${event.sessionId || "unknown"} turnId=${event.turnId || ""} cwd=${event.projectDir || ""}`
  );

  const notificationTerminal = resolveApprovalTerminalContext({
    sessionId: event.sessionId,
    projectDir: event.projectDir,
    fallbackTerminal: terminal,
    log: runtime.log,
  });

  const child = emitNotification({
    source: event.source,
    eventName: event.eventName,
    title: event.title,
    message: event.message,
    rawEventType: event.eventType,
    runtime,
    terminal: notificationTerminal,
  });

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

  return true;
}

function shouldEmitEventKey(emittedEventKeys, eventKey) {
  if (!eventKey) {
    return true;
  }

  if (emittedEventKeys.has(eventKey)) {
    return false;
  }

  emittedEventKeys.set(eventKey, Date.now());
  return true;
}

function resolveApprovalTerminalContext({ sessionId, projectDir, fallbackTerminal, log }) {
  const terminal = findSidecarTerminalContextForSession(sessionId, log);
  if (!terminal || (!terminal.hwnd && !terminal.shellPid)) {
    const projectFallback = findSidecarTerminalContextForProjectDir(projectDir, log);
    if (!projectFallback || !projectFallback.hwnd) {
      if (typeof log === "function") {
        log(
          `approval terminal fallback used sessionId=${sessionId || "unknown"} projectDir=${projectDir || ""} reason=no_sidecar_match`
        );
      }
      return fallbackTerminal;
    }

    if (typeof log === "function") {
      log(
        `approval terminal project fallback used sessionId=${sessionId || "unknown"} projectDir=${projectDir || ""} hwnd=${projectFallback.hwnd || ""}`
      );
    }

    return {
      hwnd: projectFallback.hwnd,
      shellPid: null,
      isWindowsTerminal: false,
    };
  }

  if (typeof log === "function") {
    log(
      `sidecar terminal matched sessionId=${sessionId} shellPid=${terminal.shellPid || ""} hwnd=${terminal.hwnd || ""}`
    );
  }

  return {
    hwnd: terminal.hwnd,
    shellPid: terminal.shellPid,
    isWindowsTerminal: terminal.isWindowsTerminal,
  };
}

module.exports = {
  emitCodexApprovalNotification,
  resolveApprovalTerminalContext,
  shouldEmitEventKey,
};
