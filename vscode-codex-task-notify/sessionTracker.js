function createTracker(uri) {
  return {
    uri,
    offset: 0,
    remainder: "",
    lastKnownSize: 0,
    lastKnownMtimeMs: 0,
    sessionId: undefined,
    cwd: undefined,
    activeTurnId: undefined,
    latestTokenUsage: undefined,
    lastCompletedTokenUsage: undefined,
    latestRateLimits: undefined,
    turns: new Map()
  };
}

function resetTrackerState(tracker) {
  tracker.offset = 0;
  tracker.remainder = "";
  tracker.lastKnownSize = 0;
  tracker.lastKnownMtimeMs = 0;
  tracker.activeTurnId = undefined;
  tracker.latestTokenUsage = undefined;
  tracker.lastCompletedTokenUsage = undefined;
  tracker.latestRateLimits = undefined;
  tracker.turns.clear();
}

function getOrCreateTurn(tracker, turnId) {
  const existing = tracker.turns.get(turnId);
  if (existing) {
    return existing;
  }

  const created = {
    turnId,
    cwd: undefined,
    userMessage: undefined,
    lastAgentMessage: undefined,
    errorMessage: undefined,
    model: undefined,
    tokenUsage: undefined,
    rateLimits: undefined
  };
  tracker.turns.set(turnId, created);
  return created;
}

function resolveTurnId(tracker, payload) {
  if (typeof payload.turn_id === "string") {
    tracker.activeTurnId = payload.turn_id;
    return payload.turn_id;
  }

  return tracker.activeTurnId;
}

function createMonitorStats() {
  return {
    pollCount: 0,
    trackedFileCount: 0,
    notificationCount: 0,
    lastResolvedSessionsRoot: "",
    lastDiscoveredFileCount: 0,
    lastPollStartedAtIso: "",
    lastPollCompletedAtIso: "",
    lastPollDurationMs: 0,
    lastNotificationAtIso: "",
    lastNotificationTitle: "",
    lastTaskCompleteAtIso: "",
    lastTaskCompleteSessionId: "",
    lastTaskCompleteTurnId: "",
    lastRateLimits: undefined,
    lastRateLimitsAtIso: "",
    lastError: "",
    restartCount: 0,
    lastRestartAtIso: ""
  };
}

module.exports = {
  createMonitorStats,
  createTracker,
  getOrCreateTurn,
  resetTrackerState,
  resolveTurnId
};
