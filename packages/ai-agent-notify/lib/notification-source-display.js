"use strict";

function createNotificationSpec(spec) {
  const sourceId = spec.sourceId || spec.source || "unknown";
  const eventName = spec.eventName || "";

  return {
    sourceId,
    sourceFamily: getSourceFamily(sourceId),
    source: canonicalizeDisplaySource(spec.source || inferDisplaySource(sourceId)),
    transport: spec.transport || "",
    sessionId: spec.sessionId || "unknown",
    turnId: spec.turnId || "",
    eventName,
    title: canonicalizeNotificationTitle(spec.title || inferNotificationTitle(eventName)),
    message: canonicalizeNotificationMessage(spec.message || inferNotificationMessage(eventName)),
    projectDir: spec.projectDir || "",
    rawEventType: spec.rawEventType || "",
    payloadKeys: Array.isArray(spec.payloadKeys) ? spec.payloadKeys : [],
    client: spec.client || "",
    debugSummary: spec.debugSummary || "",
  };
}

function applyExplicitDisplayOverrides(spec, overrides) {
  return {
    ...spec,
    source: canonicalizeDisplaySource(overrides.source || spec.source),
    title: canonicalizeNotificationTitle(overrides.title || spec.title),
    message: canonicalizeNotificationMessage(overrides.message || spec.message),
  };
}

function getExplicitDisplayOverrides(env) {
  return {
    source: getStringField(env, ["TOAST_NOTIFY_SOURCE"]),
    title: getStringField(env, ["TOAST_NOTIFY_TITLE"]),
    message: getStringField(env, ["TOAST_NOTIFY_MESSAGE"]),
  };
}

function inferDisplaySource(sourceId) {
  if (typeof sourceId === "string" && sourceId.startsWith("codex")) {
    return "Codex";
  }

  if (typeof sourceId === "string" && sourceId.startsWith("claude")) {
    return "Claude";
  }

  return "";
}

function inferNotificationTitle(eventName) {
  switch (eventName) {
    case "Stop":
      return "Done";
    case "PermissionRequest":
      return "Needs Approval";
    case "InputRequest":
      return "Input Needed";
    default:
      return "Notification";
  }
}

function inferNotificationMessage(eventName) {
  switch (eventName) {
    case "Stop":
      return "Task finished";
    case "PermissionRequest":
      return "Waiting for your approval";
    case "InputRequest":
      return "Waiting for your input";
    default:
      return "Notification";
  }
}

function canonicalizeDisplaySource(source) {
  const trimmed = typeof source === "string" ? source.trim() : "";
  if (!trimmed) {
    return "";
  }

  if (/^claude(?:-hook)?$/i.test(trimmed)) {
    return "Claude";
  }

  if (/^codex(?:[- ].+)?$/i.test(trimmed)) {
    return "Codex";
  }

  if (/^(unknown|notification)$/i.test(trimmed)) {
    return "";
  }

  return trimmed;
}

function canonicalizeNotificationTitle(title) {
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (!trimmed) {
    return "Notification";
  }

  return trimmed
    .replace(/^\[(Claude|Codex|Agent)\]\s*/i, "")
    .replace(/Needs Permission/g, "Needs Approval")
    .replace(/^(Claude|Codex|Agent)\s+Needs Approval$/i, "Needs Approval")
    .replace(/^(Claude|Codex|Agent)\s+Input Needed$/i, "Input Needed")
    .replace(/^(Claude|Codex|Agent)\s+Done$/i, "Done")
    .replace(/^(Claude|Codex|Agent)$/i, "Notification");
}

function canonicalizeNotificationMessage(message) {
  const trimmed = typeof message === "string" ? message.trim() : "";
  return trimmed || "Notification";
}

function getSourceFamily(sourceId) {
  if (typeof sourceId === "string" && sourceId.startsWith("codex")) {
    return "codex";
  }

  if (typeof sourceId === "string" && sourceId.startsWith("claude")) {
    return "claude";
  }

  return "generic";
}

function getStringField(payload, keys) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

module.exports = {
  applyExplicitDisplayOverrides,
  createNotificationSpec,
  getExplicitDisplayOverrides,
  getSourceFamily,
};
