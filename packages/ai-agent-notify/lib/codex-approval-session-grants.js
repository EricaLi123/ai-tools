const {
  extractCommandApprovalRoots,
  isLikelyReadOnlyShellCommand,
  isPathWithinRoot,
  normalizeShellCommandPath,
} = require("./shell-command-analysis");

const RECENT_REQUIRE_ESCALATED_TTL_MS = 30 * 60 * 1000;
const SESSION_APPROVAL_CONFIRM_LOOKBACK_MS = 5 * 60 * 1000;
const SESSION_APPROVAL_GRANT_TTL_MS = 30 * 60 * 1000;
const MAX_RECENT_REQUIRE_ESCALATED_EVENTS_PER_SESSION = 64;
const MAX_SESSION_APPROVAL_GRANTS_PER_SESSION = 128;

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
  confirmSessionApprovalForRecentEvents,
  getSessionRequireEscalatedSuppressionReason,
  rememberRecentRequireEscalatedEvent,
};
