const vscode = require("vscode");
const { estimateCompletionCost, getCostSettings } = require("./pricing");
const {
  collectRecentSessionFiles,
  getSessionLookbackDays,
  getSessionPollMs,
  inferSessionIdFromUri,
  isFileMissing,
  resolveSessionsRootUri,
  resolveWorkspacePathMatch
} = require("./sessionDiscovery");
const {
  buildCompletionTokenUsage,
  copyRecentCompletion,
  copyStructuredValue,
  createRecentCompletion,
  formatError,
  normalizeFlexibleTimestamp,
  normalizeRateLimits,
  normalizeRecentCompletionList,
  normalizeTimestamp,
  normalizeTokenUsage,
  pushBounded,
  resolveCompletionTimestampMs,
  shouldNotifyCompletionFromInitialScan
} = require("./sessionState");
const {
  buildNotificationMessage,
  buildNotificationTitle,
  projectNameFromCwd
} = require("./sessionNotificationContent");
const {
  createMonitorStats,
  createTracker,
  getOrCreateTurn,
  resetTrackerState,
  resolveTurnId
} = require("./sessionTracker");

const MAX_RECENT_COMPLETIONS = 20;

class CodexSessionMonitor {
  constructor(context, notify) {
    this.context = context;
    this.notify = notify;
    this.trackers = new Map();
    this.processedEventIds = new Set();
    this.recentCompletions = [];
    this.pollTimer = undefined;
    this.pollInFlight = false;
    this.sessionsRootUri = undefined;
    this.missingRootWarningShown = false;
    this.stats = createMonitorStats();
    this.notificationStartMs = Date.now();
  }

  async start() {
    await this.restart();
  }

  async restart() {
    this.disposeTimer();
    this.trackers.clear();
    this.processedEventIds.clear();
    this.sessionsRootUri = undefined;
    this.missingRootWarningShown = false;
    this.notificationStartMs = Date.now();
    this.stats.restartCount += 1;
    this.stats.lastRestartAtIso = new Date().toISOString();

    await this.poll();

    const pollMs = getSessionPollMs();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, pollMs);
  }

  dispose() {
    this.disposeTimer();
  }

  isRunning() {
    return Boolean(this.pollTimer);
  }

  getDiagnostics() {
    const latestCompletion = this.recentCompletions[0];
    return {
      running: this.isRunning(),
      pollInFlight: this.pollInFlight,
      sessionsRoot: this.sessionsRootUri ? this.sessionsRootUri.toString() : "",
      lastResolvedSessionsRoot: this.stats.lastResolvedSessionsRoot,
      pollMs: getSessionPollMs(),
      lookbackDays: getSessionLookbackDays(),
      pollCount: this.stats.pollCount,
      trackedFileCount: this.trackers.size,
      processedEventCount: this.processedEventIds.size,
      recentCompletionCount: this.recentCompletions.length,
      notificationCount: this.stats.notificationCount,
      lastDiscoveredFileCount: this.stats.lastDiscoveredFileCount,
      lastPollStartedAtIso: this.stats.lastPollStartedAtIso,
      lastPollCompletedAtIso: this.stats.lastPollCompletedAtIso,
      lastPollDurationMs: this.stats.lastPollDurationMs,
      lastNotificationAtIso: this.stats.lastNotificationAtIso,
      lastNotificationTitle: this.stats.lastNotificationTitle,
      lastTaskCompleteAtIso: this.stats.lastTaskCompleteAtIso,
      lastTaskCompleteSessionId: this.stats.lastTaskCompleteSessionId,
      lastTaskCompleteTurnId: this.stats.lastTaskCompleteTurnId,
      lastRateLimits: copyStructuredValue(this.stats.lastRateLimits),
      lastRateLimitsAtIso: this.stats.lastRateLimitsAtIso,
      lastError: this.stats.lastError,
      missingRootWarningShown: this.missingRootWarningShown,
      restartCount: this.stats.restartCount,
      lastRestartAtIso: this.stats.lastRestartAtIso,
      latestCompletion: latestCompletion ? copyRecentCompletion(latestCompletion) : undefined
    };
  }

  getRecentCompletions() {
    return this.recentCompletions.map((completion) => copyRecentCompletion(completion));
  }

  getSnapshotState() {
    return {
      recentCompletions: this.getRecentCompletions(),
      latestCompletion: this.recentCompletions[0] ? copyRecentCompletion(this.recentCompletions[0]) : undefined
    };
  }

  restoreRecentCompletions(items) {
    this.recentCompletions = normalizeRecentCompletionList(items, MAX_RECENT_COMPLETIONS);
  }

  async poll() {
    if (this.pollInFlight) {
      return;
    }

    const pollStartedAtMs = Date.now();
    this.pollInFlight = true;
    this.stats.pollCount += 1;
    this.stats.lastPollStartedAtIso = new Date(pollStartedAtMs).toISOString();
    try {
      if (!this.sessionsRootUri) {
        this.sessionsRootUri = await resolveSessionsRootUri();
      }

      this.stats.lastError = "";
      this.stats.lastResolvedSessionsRoot = this.sessionsRootUri ? this.sessionsRootUri.toString() : "";

      if (!this.sessionsRootUri) {
        this.stats.lastDiscoveredFileCount = 0;
        this.maybeWarnAboutMissingSessionsRoot();
        return;
      }

      const files = await collectRecentSessionFiles(this.sessionsRootUri, getSessionLookbackDays());
      this.stats.lastDiscoveredFileCount = files.length;
      for (const fileUri of files) {
        await this.refreshFile(fileUri);
      }
    } catch (error) {
      this.stats.lastError = formatError(error);
      console.error("[codex-task-notify] Failed to poll Codex sessions", error);
    } finally {
      this.stats.trackedFileCount = this.trackers.size;
      this.stats.lastPollCompletedAtIso = new Date().toISOString();
      this.stats.lastPollDurationMs = Date.now() - pollStartedAtMs;
      this.pollInFlight = false;
    }
  }

  async refreshFile(fileUri) {
    const key = fileUri.toString();
    let tracker = this.trackers.get(key);
    if (!tracker) {
      tracker = createTracker(fileUri);
      this.trackers.set(key, tracker);
      await this.processWholeFile(tracker, false);
      return;
    }

    let stat;
    try {
      stat = await vscode.workspace.fs.stat(fileUri);
    } catch (error) {
      if (isFileMissing(error)) {
        this.trackers.delete(key);
        return;
      }

      throw error;
    }

    if (stat.size === tracker.lastKnownSize && stat.mtime <= tracker.lastKnownMtimeMs) {
      return;
    }

    await this.processWholeFile(tracker, true);
  }

  async processWholeFile(tracker, emitNotifications) {
    let stat;
    let bytes;
    try {
      stat = await vscode.workspace.fs.stat(tracker.uri);
      bytes = await vscode.workspace.fs.readFile(tracker.uri);
    } catch (error) {
      if (isFileMissing(error)) {
        this.trackers.delete(tracker.uri.toString());
        return;
      }

      throw error;
    }

    const text = Buffer.from(bytes).toString("utf8");

    if (text.length < tracker.offset) {
      resetTrackerState(tracker);
    }

    const combined = `${tracker.remainder}${text.slice(tracker.offset)}`;
    tracker.offset = text.length;
    tracker.lastKnownSize = stat.size;
    tracker.lastKnownMtimeMs = stat.mtime;

    if (!combined.length) {
      return;
    }

    const lines = combined.split(/\r?\n/);
    if (combined.endsWith("\n")) {
      tracker.remainder = "";
    } else {
      tracker.remainder = lines.pop() ?? "";
    }

    for (const line of lines) {
      await this.processLine(tracker, line, emitNotifications);
    }
  }

  async processLine(tracker, line, emitNotifications) {
    if (!line.trim()) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (parsed.type === "session_meta") {
      tracker.sessionId = typeof parsed.payload?.id === "string" ? parsed.payload.id : tracker.sessionId;
      tracker.cwd = typeof parsed.payload?.cwd === "string" ? parsed.payload.cwd : tracker.cwd;
      return;
    }

    if (parsed.type === "turn_context") {
      const turnId = typeof parsed.payload?.turn_id === "string" ? parsed.payload.turn_id : undefined;
      if (!turnId) {
        return;
      }

      tracker.activeTurnId = turnId;
      const turn = getOrCreateTurn(tracker, turnId);
      if (typeof parsed.payload?.cwd === "string") {
        turn.cwd = parsed.payload.cwd;
      }
      if (typeof parsed.payload?.model === "string") {
        turn.model = parsed.payload.model;
      }
      return;
    }

    if (parsed.type !== "event_msg" || !parsed.payload || typeof parsed.payload !== "object") {
      return;
    }

    const eventTimestampIso = normalizeTimestamp(parsed.timestamp);
    await this.processEventPayload(tracker, parsed.payload, emitNotifications, eventTimestampIso);
  }

  async processEventPayload(tracker, payload, emitNotifications, eventTimestampIso) {
    const payloadType = payload.type;
    const turnId = resolveTurnId(tracker, payload);
    const turn = turnId ? getOrCreateTurn(tracker, turnId) : undefined;

    if (payloadType === "task_started" && turnId) {
      tracker.activeTurnId = turnId;
      return;
    }

    if (payloadType === "user_message" && turn) {
      if (typeof payload.message === "string") {
        turn.userMessage = payload.message;
      }
      return;
    }

    if (payloadType === "agent_message" && turn) {
      if (typeof payload.message === "string") {
        turn.lastAgentMessage = payload.message;
      }
      return;
    }

    if (payloadType === "error" && turn) {
      if (typeof payload.message === "string") {
        turn.errorMessage = payload.message;
      }
      return;
    }

    if (payloadType === "token_count") {
      const workspaceMatch = resolveWorkspacePathMatch(turn?.cwd || tracker.cwd);
      if (workspaceMatch === false) {
        return;
      }

      const totalUsage = normalizeTokenUsage(payload.info?.total_token_usage);
      if (totalUsage) {
        tracker.latestTokenUsage = totalUsage;
        if (turn) {
          turn.tokenUsage = totalUsage;
        }
      }

      const rateLimits = normalizeRateLimits(payload.rate_limits);
      if (rateLimits) {
        tracker.latestRateLimits = rateLimits;
        if (turn) {
          turn.rateLimits = rateLimits;
        }
        if (workspaceMatch === true) {
          this.stats.lastRateLimits = copyStructuredValue(rateLimits);
          this.stats.lastRateLimitsAtIso = eventTimestampIso || new Date().toISOString();
        }
      }
      return;
    }

    if (payloadType !== "task_complete" || !turnId) {
      return;
    }

    const sessionId = tracker.sessionId || inferSessionIdFromUri(tracker.uri);
    const eventId = `${sessionId}:${turnId}`;
    if (this.processedEventIds.has(eventId)) {
      return;
    }

    const workspaceMatch = resolveWorkspacePathMatch(turn?.cwd || tracker.cwd);
    if (workspaceMatch === false) {
      return;
    }

    const totalTokenUsage = turn?.tokenUsage || tracker.latestTokenUsage;
    const tokenUsage = buildCompletionTokenUsage(totalTokenUsage, tracker.lastCompletedTokenUsage);
    if (totalTokenUsage) {
      tracker.lastCompletedTokenUsage = totalTokenUsage;
    }

    const completedAtMs = resolveCompletionTimestampMs(payload.completed_at, eventTimestampIso);
    const shouldNotify =
      emitNotifications ||
      shouldNotifyCompletionFromInitialScan(completedAtMs, this.notificationStartMs);

    this.processedEventIds.add(eventId);
    if (!shouldNotify) {
      return;
    }

    if (workspaceMatch !== true) {
      return;
    }

    const level = turn?.errorMessage ? "error" : "info";
    const title = buildNotificationTitle(tracker, turn, level);
    const rateLimits = turn?.rateLimits || tracker.latestRateLimits;
    const model = turn?.model;
    const completedAtIso =
      normalizeFlexibleTimestamp(payload.completed_at) ||
      eventTimestampIso ||
      new Date().toISOString();
    const costEstimate = estimateCompletionCost({ model, tokenUsage }, getCostSettings());
    const message = buildNotificationMessage(payload, turn, tokenUsage, costEstimate);
    const projectName = projectNameFromCwd(turn?.cwd || tracker.cwd);
    const completion = createRecentCompletion({
      id: eventId,
      title,
      message,
      level,
      source: "codex-session",
      completedAtIso,
      sessionId,
      turnId,
      projectName,
      cwd: turn?.cwd || tracker.cwd,
      sessionFile: tracker.uri.toString(),
      userMessage: turn?.userMessage,
      lastAgentMessage: turn?.lastAgentMessage || payload.last_agent_message,
      errorMessage: turn?.errorMessage,
      model,
      tokenUsage,
      rateLimits,
      costEstimate
    });
    pushBounded(this.recentCompletions, completion, MAX_RECENT_COMPLETIONS);
    this.stats.notificationCount += 1;
    this.stats.lastNotificationAtIso = completedAtIso;
    this.stats.lastNotificationTitle = title;
    this.stats.lastTaskCompleteAtIso = completedAtIso;
    this.stats.lastTaskCompleteSessionId = sessionId;
    this.stats.lastTaskCompleteTurnId = turnId;
    void this.notify({
      id: eventId,
      title,
      message,
      level,
      source: "codex-session",
      timestamp: completedAtIso,
      sessionId,
      turnId,
      projectName,
      cwd: turn?.cwd || tracker.cwd,
      sessionFile: tracker.uri.toString(),
      model,
      tokenUsage: copyStructuredValue(tokenUsage),
      rateLimits: copyStructuredValue(rateLimits),
      costEstimate: copyStructuredValue(costEstimate)
    });
  }

  maybeWarnAboutMissingSessionsRoot() {
    const config = vscode.workspace.getConfiguration("codexTaskNotify");
    const configuredRoot = String(config.get("sessionsRoot", "") || "").trim();
    const shouldWarn = configuredRoot.length > 0 || Boolean(vscode.env.remoteName);
    if (!shouldWarn || this.missingRootWarningShown) {
      return;
    }

    this.missingRootWarningShown = true;
    const message = configuredRoot
      ? `Codex Task Notify could not read sessions from "${configuredRoot}".`
      : "Codex Task Notify could not auto-locate the remote .codex/sessions directory.";

    void vscode.window.showWarningMessage(
      `${message} Set "codexTaskNotify.sessionsRoot" if you want automatic session monitoring.`
    );
  }

  disposeTimer() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
}

module.exports = {
  CodexSessionMonitor
};
