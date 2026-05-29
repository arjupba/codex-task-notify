const os = require("os");
const path = require("path");
const vscode = require("vscode");
const { estimateCompletionCost, getCostSettings } = require("./pricing");

const DEFAULT_SESSION_POLL_MS = 1500;
const DEFAULT_SESSION_LOOKBACK_DAYS = 7;
const MAX_RECENT_COMPLETIONS = 20;
const DEFAULT_SESSION_SEGMENTS = [".codex", "sessions"];
const REMOTE_HOME_CANDIDATE_ROOTS = ["/home", "/Users"];

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

      const usage = normalizeTokenUsage(payload.info?.last_token_usage || payload.info?.total_token_usage);
      if (usage) {
        tracker.latestTokenUsage = usage;
        if (turn) {
          turn.tokenUsage = usage;
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

    const completedAtMs = resolveCompletionTimestampMs(payload.completed_at, eventTimestampIso);
    const shouldNotify =
      emitNotifications ||
      shouldNotifyCompletionFromInitialScan(completedAtMs, this.notificationStartMs);

    this.processedEventIds.add(eventId);
    if (!shouldNotify) {
      return;
    }

    if (resolveWorkspacePathMatch(turn?.cwd || tracker.cwd) !== true) {
      return;
    }

    const level = turn?.errorMessage ? "error" : "info";
    const title = buildNotificationTitle(tracker, turn, level);
    const tokenUsage = turn?.tokenUsage || tracker.latestTokenUsage;
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
    await this.notify({
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

function normalizeTokenUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== "object") {
    return undefined;
  }

  const inputTokens = coerceNumber(rawUsage.input_tokens);
  const cachedInputTokens = coerceNumber(rawUsage.cached_input_tokens);
  const outputTokens = coerceNumber(rawUsage.output_tokens);
  const reasoningOutputTokens = coerceNumber(rawUsage.reasoning_output_tokens);
  const totalTokens = coerceNumber(rawUsage.total_tokens);

  if (
    inputTokens === undefined &&
    cachedInputTokens === undefined &&
    outputTokens === undefined &&
    reasoningOutputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens
  };
}

function normalizeRateLimits(rawRateLimits) {
  if (!rawRateLimits || typeof rawRateLimits !== "object") {
    return undefined;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(rawRateLimits)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      normalized[key] = value;
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        normalized[key] = trimmed;
      }
      continue;
    }

    if (typeof value === "boolean") {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

function coerceNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function normalizeFlexibleTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }

  return normalizeTimestamp(value);
}

function resolveCompletionTimestampMs(completedAt, eventTimestampIso) {
  if (typeof completedAt === "number" && Number.isFinite(completedAt)) {
    return completedAt * 1000;
  }

  if (typeof completedAt === "string" && completedAt.trim()) {
    const parsed = Date.parse(completedAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (eventTimestampIso) {
    const parsed = Date.parse(eventTimestampIso);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function shouldNotifyCompletionFromInitialScan(completedAtMs, notificationStartMs) {
  if (!Number.isFinite(completedAtMs)) {
    return false;
  }

  return completedAtMs >= notificationStartMs;
}

function createRecentCompletion(fields) {
  return {
    id: fields.id,
    title: fields.title,
    message: fields.message,
    level: fields.level,
    source: fields.source,
    completedAtIso: fields.completedAtIso,
    sessionId: fields.sessionId,
    turnId: fields.turnId,
    projectName: fields.projectName,
    cwd: fields.cwd,
    sessionFile: fields.sessionFile,
    userMessage: fields.userMessage,
    lastAgentMessage: fields.lastAgentMessage,
    errorMessage: fields.errorMessage,
    model: fields.model,
    tokenUsage: copyStructuredValue(fields.tokenUsage),
    rateLimits: copyStructuredValue(fields.rateLimits),
    costEstimate: copyStructuredValue(fields.costEstimate)
  };
}

function copyRecentCompletion(completion) {
  return createRecentCompletion(completion);
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

      const normalized = createRecentCompletion(item);
      return resolveWorkspacePathMatch(normalized.cwd) === true
        ? normalized
        : undefined;
    })
    .filter(Boolean)
    .slice(0, Math.max(0, maxLength));
}

function pushBounded(items, value, maxLength) {
  items.unshift(value);
  if (items.length > maxLength) {
    items.length = maxLength;
  }
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

function copyStructuredValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function buildNotificationTitle(tracker, turn, level) {
  const projectName = projectNameFromCwd(turn?.cwd || tracker.cwd);
  const baseTitle = level === "error" ? "Codex task error" : "Codex task complete";
  return projectName ? `${baseTitle} (${projectName})` : baseTitle;
}

function buildNotificationMessage(payload, turn, tokenUsage, costEstimate) {
  const promptText =
    turn?.userMessage ||
    payload.last_agent_message ||
    turn?.lastAgentMessage ||
    turn?.errorMessage ||
    "Task completed";
  const summary = previewText(promptText, 140);
  const tokenSummary = formatTokenUsage(tokenUsage);
  const includeCostInNotifications = getCostSettings().includeInNotifications;
  const costSummary =
    includeCostInNotifications && costEstimate?.available
      ? formatCostEstimateBrief(costEstimate)
      : "";
  if (costSummary) {
    return `${costSummary} | ${summary}`;
  }

  return tokenSummary ? `${summary} [${tokenSummary}]` : summary;
}

function previewText(value, maxLength) {
  if (typeof value !== "string") {
    return "Task completed";
  }

  const singleLine = value.replace(/\s+/g, " ").trim();
  if (!singleLine) {
    return "Task completed";
  }

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatTokenUsage(tokenUsage) {
  if (!tokenUsage || tokenUsage.totalTokens === undefined) {
    return "";
  }

  const parts = [`${formatCompactNumber(tokenUsage.totalTokens)} tok`];
  if (tokenUsage.outputTokens !== undefined) {
    parts.push(`${formatCompactNumber(tokenUsage.outputTokens)} out`);
  }
  if (tokenUsage.inputTokens !== undefined) {
    parts.push(`${formatCompactNumber(tokenUsage.inputTokens)} in`);
  }
  return parts.join(" | ");
}

function formatCompactNumber(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }

  return String(value);
}

function formatCostEstimateBrief(costEstimate) {
  if (!costEstimate || !costEstimate.available) {
    return "";
  }

  if (costEstimate.currency === "USD") {
    return `$${formatTinyDecimal(costEstimate.usdTotal)}`;
  }

  return `${costEstimate.currency} ${formatTinyDecimal(costEstimate.convertedTotal)}`;
}

function formatTinyDecimal(value) {
  if (!Number.isFinite(value)) {
    return "0.000";
  }

  return (Math.round((value + Number.EPSILON) * 1000) / 1000).toFixed(3);
}

function projectNameFromCwd(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) {
    return "";
  }

  const normalized = cwd.replace(/[\\/]+$/, "");
  if (!normalized) {
    return "";
  }

  if (/^[A-Za-z]:/.test(normalized)) {
    return path.win32.basename(normalized);
  }

  return path.posix.basename(normalized);
}

function resolveWorkspacePathMatch(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) {
    return undefined;
  }

  const normalizedCwd = normalizeComparablePath(cwd);
  if (!normalizedCwd) {
    return undefined;
  }

  const workspaceRoots = getCurrentWorkspaceRoots();
  if (!workspaceRoots.length) {
    return undefined;
  }

  return workspaceRoots.some(
    (workspaceRoot) =>
      isSameOrContainedPath(workspaceRoot, normalizedCwd) ||
      isSameOrContainedPath(normalizedCwd, workspaceRoot)
  );
}

function getCurrentWorkspaceRoots() {
  return (vscode.workspace.workspaceFolders || [])
    .map((folder) => {
      if (!folder || !folder.uri) {
        return "";
      }

      if (folder.uri.scheme === "file") {
        return normalizeComparablePath(folder.uri.fsPath);
      }

      return normalizeComparablePath(folder.uri.path);
    })
    .filter(Boolean);
}

function normalizeComparablePath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return "";
  }

  let normalized = rawPath.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, "");
  }

  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function isSameOrContainedPath(basePath, candidatePath) {
  if (!basePath || !candidatePath) {
    return false;
  }

  return basePath === candidatePath || candidatePath.startsWith(`${basePath}/`);
}

async function resolveSessionsRootUri() {
  const configuredRoot = String(vscode.workspace.getConfiguration("codexTaskNotify").get("sessionsRoot", "") || "").trim();
  if (configuredRoot) {
    return resolveConfiguredSessionsRootUri(configuredRoot);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder && workspaceFolder.uri.scheme !== "file") {
    return resolveRemoteSessionsRootUri(workspaceFolder.uri);
  }

  return vscode.Uri.file(path.join(os.homedir(), ...DEFAULT_SESSION_SEGMENTS));
}

async function resolveConfiguredSessionsRootUri(configuredRoot) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder && workspaceFolder.uri.scheme !== "file") {
    if (configuredRoot.startsWith("~")) {
      const remoteHomeUri = await resolveRemoteHomeUri(workspaceFolder.uri);
      if (!remoteHomeUri) {
        return undefined;
      }

      const relativeSegments = splitPathSegments(configuredRoot.slice(1));
      return relativeSegments.length
        ? vscode.Uri.joinPath(remoteHomeUri, ...relativeSegments)
        : remoteHomeUri;
    }

    if (isPosixAbsolutePath(configuredRoot)) {
      return workspaceFolder.uri.with({ path: normalizePosixPath(configuredRoot) });
    }

    return vscode.Uri.joinPath(workspaceFolder.uri, ...splitPathSegments(configuredRoot));
  }

  if (configuredRoot.startsWith("~")) {
    return vscode.Uri.file(path.join(os.homedir(), configuredRoot.slice(1)));
  }

  if (path.isAbsolute(configuredRoot)) {
    return vscode.Uri.file(configuredRoot);
  }

  if (workspaceFolder && workspaceFolder.uri.scheme === "file") {
    return vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, configuredRoot));
  }

  return vscode.Uri.file(path.resolve(configuredRoot));
}

async function resolveRemoteSessionsRootUri(referenceUri) {
  const directHomeUri = await resolveRemoteHomeUri(referenceUri);
  if (directHomeUri) {
    return vscode.Uri.joinPath(directHomeUri, ...DEFAULT_SESSION_SEGMENTS);
  }

  return undefined;
}

async function resolveRemoteHomeUri(referenceUri) {
  const candidatePaths = new Set();
  const inferredHomePath = inferHomePathFromWorkspace(referenceUri.path);
  if (inferredHomePath) {
    candidatePaths.add(inferredHomePath);
  }

  candidatePaths.add("/root");

  for (const basePath of REMOTE_HOME_CANDIDATE_ROOTS) {
    const baseUri = referenceUri.with({ path: normalizePosixPath(basePath) });
    const entries = await readDirectorySafe(baseUri);
    for (const [name, type] of entries) {
      if ((type & vscode.FileType.Directory) === 0) {
        continue;
      }

      candidatePaths.add(normalizePosixPath(path.posix.join(basePath, name)));
    }
  }

  for (const candidatePath of candidatePaths) {
    const candidateHomeUri = referenceUri.with({ path: normalizePosixPath(candidatePath) });
    const sessionsUri = vscode.Uri.joinPath(candidateHomeUri, ...DEFAULT_SESSION_SEGMENTS);
    if (await directoryExists(sessionsUri)) {
      return candidateHomeUri;
    }
  }

  return undefined;
}

function inferHomePathFromWorkspace(workspacePath) {
  if (!workspacePath) {
    return undefined;
  }

  const homeMatch = workspacePath.match(/^\/(home|Users)\/([^/]+)/);
  if (homeMatch) {
    return `/${homeMatch[1]}/${homeMatch[2]}`;
  }

  if (workspacePath === "/root" || workspacePath.startsWith("/root/")) {
    return "/root";
  }

  return undefined;
}

async function collectRecentSessionFiles(sessionsRootUri, lookbackDays) {
  const files = new Map();
  for (let dayOffset = 0; dayOffset < lookbackDays; dayOffset += 1) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - dayOffset);

    const directoryUri = vscode.Uri.joinPath(
      sessionsRootUri,
      String(targetDate.getFullYear()),
      String(targetDate.getMonth() + 1).padStart(2, "0"),
      String(targetDate.getDate()).padStart(2, "0")
    );

    for (const fileUri of await collectJsonlFiles(directoryUri)) {
      files.set(fileUri.toString(), fileUri);
    }
  }

  return Array.from(files.values()).sort((left, right) => left.toString().localeCompare(right.toString()));
}

async function collectJsonlFiles(directoryUri) {
  const files = [];
  const entries = await readDirectorySafe(directoryUri);
  for (const [name, type] of entries) {
    const childUri = vscode.Uri.joinPath(directoryUri, name);
    if ((type & vscode.FileType.Directory) !== 0) {
      files.push(...await collectJsonlFiles(childUri));
      continue;
    }

    if ((type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith(".jsonl")) {
      files.push(childUri);
    }
  }

  return files;
}

async function readDirectorySafe(directoryUri) {
  try {
    return await vscode.workspace.fs.readDirectory(directoryUri);
  } catch {
    return [];
  }
}

async function directoryExists(uri) {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

function splitPathSegments(rawPath) {
  return rawPath.split(/[\\/]+/).filter(Boolean);
}

function isPosixAbsolutePath(rawPath) {
  return rawPath.startsWith("/");
}

function normalizePosixPath(rawPath) {
  return rawPath.replace(/\\/g, "/");
}

function inferSessionIdFromUri(uri) {
  const match = uri.path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl)?$/i);
  return match ? match[1] : path.basename(uri.path, path.extname(uri.path));
}

function getSessionPollMs() {
  const rawValue = Number(vscode.workspace.getConfiguration("codexTaskNotify").get("sessionPollMs", DEFAULT_SESSION_POLL_MS));
  return Number.isFinite(rawValue) ? Math.max(500, rawValue) : DEFAULT_SESSION_POLL_MS;
}

function getSessionLookbackDays() {
  const rawValue = Number(vscode.workspace.getConfiguration("codexTaskNotify").get("sessionLookbackDays", DEFAULT_SESSION_LOOKBACK_DAYS));
  return Number.isFinite(rawValue) ? Math.max(1, Math.min(7, Math.floor(rawValue))) : DEFAULT_SESSION_LOOKBACK_DAYS;
}

function isFileMissing(error) {
  return Boolean(error && typeof error === "object" && error.code === "FileNotFound");
}

module.exports = {
  CodexSessionMonitor
};
