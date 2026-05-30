function normalizeGlobalHistoryStore(rawValue, maxLength) {
  const normalized = {
    version: 1,
    workspaces: {}
  };

  if (!rawValue || typeof rawValue !== "object") {
    return normalized;
  }

  if (!rawValue.workspaces || typeof rawValue.workspaces !== "object") {
    return normalized;
  }

  for (const [workspaceKey, bucket] of Object.entries(rawValue.workspaces)) {
    if (typeof workspaceKey !== "string" || !workspaceKey.trim()) {
      continue;
    }

    normalized.workspaces[workspaceKey] = normalizeHistoryBucket(bucket, maxLength);
  }

  return normalized;
}

function normalizeHistoryBucket(rawValue, maxLength) {
  const value = rawValue && typeof rawValue === "object" ? rawValue : {};
  const workspaceRoots = Array.isArray(value.workspaceRoots)
    ? value.workspaceRoots.filter((entry) => typeof entry === "string" && entry.trim())
    : [];

  return {
    workspaceLabel: typeof value.workspaceLabel === "string" ? value.workspaceLabel : "",
    workspaceRoots,
    updatedAt: normalizeTimestamp(value.updatedAt) || "",
    recentCompletions: normalizeRecentCompletionList(value.recentCompletions, maxLength),
    recentNotifications: normalizeNotificationRecordList(value.recentNotifications, maxLength)
  };
}

function normalizeRecentCompletionList(items, maxLength) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }

      if (typeof item.id !== "string" || !item.id.trim()) {
        return undefined;
      }

      return normalizeRecentCompletionRecord(item);
    })
    .filter(Boolean)
    .slice(0, Math.max(0, maxLength));
}

function normalizeRecentCompletionRecord(payload) {
  return {
    id: typeof payload.id === "string" ? payload.id : `completion-${Date.now()}`,
    title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Codex task complete",
    message: typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : "Task completed",
    level: typeof payload.level === "string" ? payload.level : "info",
    source: typeof payload.source === "string" && payload.source.trim() ? payload.source.trim() : "codex-session",
    completedAtIso:
      normalizeTimestamp(payload.completedAtIso) ||
      normalizeTimestamp(payload.timestamp) ||
      normalizeTimestamp(payload.createdAt) ||
      new Date().toISOString(),
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
    turnId: typeof payload.turnId === "string" ? payload.turnId : "",
    projectName: typeof payload.projectName === "string" ? payload.projectName : "",
    cwd: typeof payload.cwd === "string" ? payload.cwd : "",
    sessionFile: typeof payload.sessionFile === "string" ? payload.sessionFile : "",
    userMessage: typeof payload.userMessage === "string" ? payload.userMessage : "",
    lastAgentMessage: typeof payload.lastAgentMessage === "string" ? payload.lastAgentMessage : "",
    errorMessage: typeof payload.errorMessage === "string" ? payload.errorMessage : "",
    model: typeof payload.model === "string" ? payload.model : "",
    tokenUsage: copyStructuredValue(payload.tokenUsage),
    rateLimits: copyStructuredValue(payload.rateLimits),
    costEstimate: copyStructuredValue(payload.costEstimate)
  };
}

function normalizeNotificationRecordList(items, maxLength) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }

      return normalizeNotificationRecord(item);
    })
    .filter(Boolean)
    .slice(0, Math.max(0, maxLength));
}

function normalizeNotificationRecord(payload) {
  const timestamp =
    normalizeTimestamp(payload.timestamp) ||
    normalizeTimestamp(payload.completedAtIso) ||
    normalizeTimestamp(payload.createdAt) ||
    new Date().toISOString();

  return {
    id: typeof payload.id === "string" ? payload.id : `event-${Date.now()}`,
    title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Codex task complete",
    message: typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : "Task completed",
    level: typeof payload.level === "string" ? payload.level : "info",
    source: typeof payload.source === "string" && payload.source.trim() ? payload.source.trim() : "unknown",
    timestamp,
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
    turnId: typeof payload.turnId === "string" ? payload.turnId : "",
    projectName: typeof payload.projectName === "string" ? payload.projectName : "",
    sessionFile: typeof payload.sessionFile === "string" ? payload.sessionFile : "",
    tokenUsage: copyStructuredValue(payload.tokenUsage),
    costEstimate: copyStructuredValue(payload.costEstimate),
    delivery: normalizeDeliveryList(payload.delivery),
    eventFile: typeof payload.eventFile === "string" ? payload.eventFile : ""
  };
}

function normalizeDeliveryList(delivery) {
  if (!Array.isArray(delivery)) {
    return [];
  }

  return delivery
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }

      return {
        channel: typeof entry.channel === "string" ? entry.channel : "unknown",
        attempted: Boolean(entry.attempted),
        delivered: Boolean(entry.delivered),
        status: typeof entry.status === "string" ? entry.status : "unknown",
        reason: typeof entry.reason === "string" ? entry.reason : "",
        error: typeof entry.error === "string" ? entry.error : "",
        detail: typeof entry.detail === "string" ? entry.detail : "",
        statusCode: Number.isFinite(entry.statusCode) ? entry.statusCode : undefined,
        statusMessage: typeof entry.statusMessage === "string" ? entry.statusMessage : "",
        responseBody: typeof entry.responseBody === "string" ? entry.responseBody : ""
      };
    })
    .filter(Boolean);
}

function copyStructuredValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs).toISOString();
}

module.exports = {
  copyStructuredValue,
  normalizeGlobalHistoryStore,
  normalizeHistoryBucket,
  normalizeNotificationRecord,
  normalizeTimestamp
};
