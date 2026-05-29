const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const { CodexSessionMonitor } = require("./sessionMonitor");
const { deliverExternalNotifications, getNotificationChannelSettings } = require("./notificationChannels");
const { estimateCompletionCost, formatCostEstimate, formatPricingEntry, getBuiltInPricingReference, getCostSettings } = require("./pricing");

const WATCH_GLOB = "tmp/codex-task-notify/*.json";
const CLI_SOURCE_RELATIVE_DIR = path.join("resources", "notify");
const LOCAL_INSTALL_DIR = path.join(".codex-task-notify", "bin");
const WORKSPACE_INSTALL_SEGMENTS = [".vscode", "codex-task-notify", "bin"];
const MAX_RECENT_EVENTS = 20;
const RECENT_COMPLETIONS_STATE_KEY = "recentCompletions";
const RECENT_NOTIFICATIONS_STATE_KEY = "recentNotifications";
const NOTIFICATION_DEDUPE_DIR_NAME = "notification-dedupe";
const NOTIFICATION_DEDUPE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const seenEvents = new Map();
const recentNotifications = [];

function activate(context) {
  const watcherDisposables = [];
  const sessionMonitor = new CodexSessionMonitor(context, async (payload) => {
    const shown = await showNotification(context, payload);
    if (shown) {
      recordRecentNotification(payload);
      await persistRecentNotifications(context);
    }
    await persistRecentCompletions(context, sessionMonitor);
  });

  restorePersistedState(context, sessionMonitor);

  const rebuildWatchers = () => {
    while (watcherDisposables.length) {
      watcherDisposables.pop().dispose();
    }

    for (const folder of vscode.workspace.workspaceFolders || []) {
      const pattern = new vscode.RelativePattern(folder, WATCH_GLOB);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      watcher.onDidCreate((uri) => handleEventFile(context, uri), null, context.subscriptions);
      watcher.onDidChange((uri) => handleEventFile(context, uri), null, context.subscriptions);

      watcherDisposables.push(watcher);
      context.subscriptions.push(watcher);
    }
  };

  rebuildWatchers();
  void sessionMonitor.start();

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => rebuildWatchers())
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexTaskNotify.sessionsRoot") ||
          event.affectsConfiguration("codexTaskNotify.sessionPollMs") ||
          event.affectsConfiguration("codexTaskNotify.sessionLookbackDays")) {
        void sessionMonitor.restart();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.testNotification", async () => {
      const payload = {
        title: "Codex test",
        message: "Local task notification path is working.",
        level: "info",
        id: `manual-${Date.now()}`
      };
      const shown = await showNotification(context, payload);
      if (shown) {
        recordRecentNotification(payload);
        await persistRecentNotifications(context);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showDiagnostics", async () => {
      await showDiagnostics(context, sessionMonitor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showRecentHistory", async () => {
      await showRecentHistory(sessionMonitor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showRecentEvents", async () => {
      await showRecentEvents(sessionMonitor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showRecentCosts", async () => {
      await showRecentCosts(sessionMonitor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showDebugSnapshot", async () => {
      await showDebugSnapshot(sessionMonitor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.installLocalCli", async () => {
      await installLocalCli(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.installWorkspaceCli", async () => {
      await installWorkspaceCli(context);
    })
  );

  context.subscriptions.push({
    dispose: () => {
      sessionMonitor.dispose();
    }
  });
}

async function handleEventFile(context, uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString("utf8");
    const payload = JSON.parse(text);

    if (!payload || typeof payload !== "object") {
      return;
    }

    const eventId =
      typeof payload.id === "string" && payload.id.trim()
        ? payload.id.trim()
        : `${uri.toString()}::${payload.createdAt || ""}::${payload.message || ""}`;

    const previousFingerprint = seenEvents.get(uri.toString());
    if (previousFingerprint === eventId) {
      return;
    }

    seenEvents.set(uri.toString(), eventId);

    const enrichedPayload = {
      ...payload,
      id: eventId,
      source: payload.source || "workspace-event",
      eventFile: uri.toString(),
      timestamp: normalizeTimestamp(payload.createdAt) || new Date().toISOString()
    };
    const shown = await showNotification(context, enrichedPayload);
    if (shown) {
      recordRecentNotification(enrichedPayload);
      await persistRecentNotifications(context);
    }
  } catch (error) {
    console.error("[codex-task-notify] Failed to process event file", uri.toString(), error);
  }
}

async function showNotification(context, payload) {
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : "Codex task complete";
  const message =
    typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : "Task completed";
  const text = `${title}: ${message}`;
  const level = String(payload.level || "info").toLowerCase();
  const claimed = await claimNotificationDelivery(context, {
    ...payload,
    title,
    message,
    level
  });

  if (!claimed) {
    return false;
  }

  try {
    const delivery = await deliverExternalNotifications(context, {
      ...payload,
      title,
      message,
      level
    });
    payload.delivery = delivery;
  } catch (error) {
    console.error("[codex-task-notify] Failed to deliver external notifications", error);
  }

  if (await tryShowLocalWindowsNotification(context, { title, message, level, cwd: payload.cwd })) {
    return true;
  }

  await showInAppNotification(text, level);
  return true;
}

function tryShowLocalWindowsNotification(context, payload) {
  if (process.platform !== "win32") {
    return Promise.resolve(false);
  }

  const scriptPath = path.join(context.extensionPath, "scripts", "notify.ps1");
  const notificationSettings = getWindowsNotificationSettings();
  const levelMap = {
    info: "Info",
    warning: "Warning",
    warn: "Warning",
    error: "Error"
  };
  const commandArguments = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Title",
    payload.title,
    "-Message",
    payload.message,
    "-Level",
    levelMap[payload.level] || "Info",
    "-TimeoutSeconds",
    "5"
  ];

  if (notificationSettings.openVsCodeOnClick) {
    commandArguments.push("-OpenVsCodeOnClick");

    const workspacePath = resolveWindowsNotificationWorkspacePath(payload);
    if (workspacePath) {
      commandArguments.push("-WorkspacePath", workspacePath);
    }
  }

  return new Promise((resolve) => {
    childProcess.execFile(
      "powershell.exe",
      commandArguments,
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 256
      }
      ,
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            "[codex-task-notify] Failed to launch local Windows notification",
            {
              error: error.message,
              stdout: typeof stdout === "string" ? stdout.trim() : "",
              stderr: typeof stderr === "string" ? stderr.trim() : ""
            }
          );
          resolve(false);
          return;
        }

        resolve(true);
      }
    );
  });
}

function getWindowsNotificationSettings() {
  const config = vscode.workspace.getConfiguration("codexTaskNotify");
  return {
    openVsCodeOnClick: Boolean(config.get("windowsNotification.openVsCodeOnClick", true))
  };
}

function resolveWindowsNotificationWorkspacePath(payload) {
  if (typeof payload.cwd === "string" && /^[A-Za-z]:[\\/]/.test(payload.cwd.trim())) {
    return payload.cwd.trim();
  }

  for (const folder of vscode.workspace.workspaceFolders || []) {
    if (folder.uri.scheme === "file" && folder.uri.fsPath) {
      return folder.uri.fsPath;
    }
  }

  return "";
}

async function claimNotificationDelivery(context, payload) {
  const dedupeKey = buildNotificationDedupeKey(payload);
  if (!dedupeKey) {
    return true;
  }

  const dedupeDir = getNotificationDedupeDir(context);
  const claimFileName = `${crypto.createHash("sha1").update(dedupeKey).digest("hex")}.json`;
  const claimPath = path.join(dedupeDir, claimFileName);

  try {
    await fs.mkdir(dedupeDir, { recursive: true });
    void pruneNotificationClaims(dedupeDir);
    await fs.writeFile(
      claimPath,
      JSON.stringify(
        {
          key: dedupeKey,
          id: typeof payload.id === "string" ? payload.id : "",
          source: typeof payload.source === "string" ? payload.source : "",
          title: typeof payload.title === "string" ? payload.title : "",
          timestamp: normalizeTimestamp(payload.timestamp) || new Date().toISOString()
        },
        null,
        2
      ),
      { encoding: "utf8", flag: "wx" }
    );
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      console.log("[codex-task-notify] Skipped duplicate notification", dedupeKey);
      return false;
    }

    console.error("[codex-task-notify] Failed to claim notification delivery", error);
    return true;
  }
}

function buildNotificationDedupeKey(payload) {
  if (payload && typeof payload === "object") {
    if (typeof payload.sessionId === "string" && payload.sessionId &&
        typeof payload.turnId === "string" && payload.turnId) {
      return `session:${payload.sessionId}:${payload.turnId}`;
    }

    if (typeof payload.id === "string" && payload.id.trim()) {
      return `id:${payload.id.trim()}`;
    }

    const eventFile = typeof payload.eventFile === "string" ? payload.eventFile.trim() : "";
    const timestamp = normalizeTimestamp(payload.timestamp) || normalizeTimestamp(payload.createdAt);
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (eventFile && timestamp && message) {
      return `event:${eventFile}:${timestamp}:${message}`;
    }
  }

  return "";
}

function getNotificationDedupeDir(context) {
  if (context.globalStorageUri && context.globalStorageUri.scheme === "file") {
    return path.join(context.globalStorageUri.fsPath, NOTIFICATION_DEDUPE_DIR_NAME);
  }

  return path.join(os.tmpdir(), "codex-task-notify", NOTIFICATION_DEDUPE_DIR_NAME);
}

async function pruneNotificationClaims(dedupeDir) {
  try {
    const entries = await fs.readdir(dedupeDir, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(dedupeDir, entry.name);
          try {
            const stat = await fs.stat(filePath);
            if (now - stat.mtimeMs > NOTIFICATION_DEDUPE_MAX_AGE_MS) {
              await fs.unlink(filePath);
            }
          } catch {
            // Ignore races with other windows pruning the same old claim file.
          }
        })
    );
  } catch {
    // Ignore cleanup failures so notification delivery is not blocked.
  }
}

async function showInAppNotification(text, level) {
  if (level === "error") {
    await vscode.window.showErrorMessage(text);
    return;
  }

  if (level === "warning" || level === "warn") {
    await vscode.window.showWarningMessage(text);
    return;
  }

  await vscode.window.showInformationMessage(text);
}

async function showDiagnostics(context, sessionMonitor) {
  const diagnostics = sessionMonitor.getDiagnostics();
  const output = getOutputChannel();
  output.clear();
  output.appendLine("===== Codex Task Notify Diagnostics =====");
  output.appendLine(`running: ${diagnostics.running}`);
  output.appendLine(`pollInFlight: ${diagnostics.pollInFlight}`);
  output.appendLine(`sessionsRoot: ${diagnostics.sessionsRoot || "(unresolved)"}`);
  output.appendLine(`lastResolvedSessionsRoot: ${diagnostics.lastResolvedSessionsRoot || "(none)"}`);
  output.appendLine(`pollMs: ${diagnostics.pollMs}`);
  output.appendLine(`lookbackDays: ${diagnostics.lookbackDays}`);
  output.appendLine(`notificationDedupeDir: ${getNotificationDedupeDir(context)}`);
  output.appendLine(`pollCount: ${diagnostics.pollCount}`);
  output.appendLine(`trackedFileCount: ${diagnostics.trackedFileCount}`);
  output.appendLine(`processedEventCount: ${diagnostics.processedEventCount}`);
  output.appendLine(`recentCompletionCount: ${diagnostics.recentCompletionCount}`);
  output.appendLine(`recentNotificationCount: ${recentNotifications.length}`);
  output.appendLine(`notificationCount: ${diagnostics.notificationCount}`);
  output.appendLine(`lastDiscoveredFileCount: ${diagnostics.lastDiscoveredFileCount}`);
  output.appendLine(`lastPollStartedAt: ${formatDisplayTimestamp(diagnostics.lastPollStartedAtIso)}`);
  output.appendLine(`lastPollCompletedAt: ${formatDisplayTimestamp(diagnostics.lastPollCompletedAtIso)}`);
  output.appendLine(`lastPollDurationMs: ${diagnostics.lastPollDurationMs}`);
  output.appendLine(`lastNotificationAt: ${formatDisplayTimestamp(diagnostics.lastNotificationAtIso)}`);
  output.appendLine(`lastNotificationTitle: ${diagnostics.lastNotificationTitle || "(none)"}`);
  output.appendLine(`lastTaskCompleteAt: ${formatDisplayTimestamp(diagnostics.lastTaskCompleteAtIso)}`);
  output.appendLine(`lastTaskCompleteSessionId: ${diagnostics.lastTaskCompleteSessionId || "(none)"}`);
  output.appendLine(`lastTaskCompleteTurnId: ${diagnostics.lastTaskCompleteTurnId || "(none)"}`);
  output.appendLine(`restartCount: ${diagnostics.restartCount}`);
  output.appendLine(`lastRestartAt: ${formatDisplayTimestamp(diagnostics.lastRestartAtIso)}`);
  output.appendLine(`missingRootWarningShown: ${diagnostics.missingRootWarningShown}`);
  output.appendLine(`lastError: ${diagnostics.lastError || "(none)"}`);
  appendCostDiagnostics(output, diagnostics.latestCompletion);

  output.appendLine("");
  output.appendLine("Latest completion:");
  if (diagnostics.latestCompletion) {
    appendHistoryEntry(output, diagnostics.latestCompletion);
  } else {
    output.appendLine("  (none)");
  }

  output.appendLine("");
  output.appendLine("Last rate_limits:");
  if (diagnostics.lastRateLimits) {
    output.appendLine(`  at: ${formatDisplayTimestamp(diagnostics.lastRateLimitsAtIso, "(unknown)")}`);
    output.appendLine(`  data: ${JSON.stringify(diagnostics.lastRateLimits)}`);
  } else {
    output.appendLine("  (none or all-null)");
  }

  output.show(true);
  await vscode.window.showInformationMessage(
    `Codex Task Notify: tracked=${diagnostics.trackedFileCount} files, recent=${diagnostics.recentCompletionCount}, lastNotify=${formatDisplayTimestamp(diagnostics.lastNotificationAtIso, "none")}`
  );
}

async function showDebugSnapshot(sessionMonitor) {
  const diagnostics = sessionMonitor.getDiagnostics();
  const snapshotState = sessionMonitor.getSnapshotState();
  const output = getOutputChannel();
  output.clear();
  output.appendLine("===== Codex Task Notify Debug Snapshot =====");

  const snapshot = {
    capturedAt: new Date().toISOString(),
    diagnostics,
    costSettings: getCostSettings(),
    notificationSettings: getNotificationChannelSettings(),
    recentCompletions: snapshotState.recentCompletions,
    recentNotifications: JSON.parse(JSON.stringify(recentNotifications)),
    latestCompletion: snapshotState.latestCompletion || null
  };

  output.appendLine(JSON.stringify(snapshot, null, 2));
  output.show(true);
  await vscode.window.showInformationMessage("Codex Task Notify: debug snapshot captured.");
}

async function showRecentHistory(sessionMonitor) {
  const completions = getChronologicalEntries(sessionMonitor.getRecentCompletions());
  const notifications = getChronologicalEntries(recentNotifications);
  const output = getOutputChannel();
  output.clear();
  output.appendLine("===== Codex Task Notify Recent History =====");

  if (!completions.length && !notifications.length) {
    output.appendLine("(no completed Codex turns or bridge notifications observed yet)");
    output.show(true);
    await vscode.window.showInformationMessage("Codex Task Notify: no completed Codex turns or bridge notifications observed yet.");
    return;
  }

  if (completions.length) {
    output.appendLine("Completed Codex turns:");
    for (const completion of completions) {
      appendHistoryEntry(output, completion);
      output.appendLine("");
    }
  }

  if (notifications.length) {
    output.appendLine("Recent notifications:");
    for (const notification of notifications) {
      appendHistoryEntry(output, notification);
      output.appendLine("");
    }
  }

  output.show(true);
  await vscode.window.showInformationMessage(
    `Codex Task Notify: showed ${completions.length} completed turns and ${notifications.length} recent notifications.`
  );
}

async function showRecentEvents(sessionMonitor) {
  const output = getOutputChannel();
  output.clear();
  output.appendLine("===== Codex Task Notify Recent Events =====");

  const diagnostics = sessionMonitor.getDiagnostics();
  const snapshotState = sessionMonitor.getSnapshotState();
  const events = buildRecentEventList(diagnostics, snapshotState.recentCompletions, recentNotifications);

  if (!events.length) {
    output.appendLine("(no recent events observed yet)");
    output.show(true);
    await vscode.window.showInformationMessage("Codex Task Notify: no recent events observed yet.");
    return;
  }

  for (const event of events) {
    output.appendLine(`- ${event.at}`);
    output.appendLine(`  type: ${event.type}`);
    output.appendLine(`  summary: ${event.summary}`);
    output.appendLine(`  data: ${JSON.stringify(event.data)}`);
    output.appendLine("");
  }

  output.show(true);
  await vscode.window.showInformationMessage(`Codex Task Notify: showed ${events.length} recent events.`);
}

function recordRecentNotification(payload) {
  const normalized = normalizeNotificationRecord(payload);
  recentNotifications.unshift(normalized);
  if (recentNotifications.length > MAX_RECENT_EVENTS) {
    recentNotifications.length = MAX_RECENT_EVENTS;
  }
}

function restorePersistedState(context, sessionMonitor) {
  const savedCompletions = context.workspaceState.get(RECENT_COMPLETIONS_STATE_KEY, []);
  const savedNotifications = context.workspaceState.get(RECENT_NOTIFICATIONS_STATE_KEY, []);

  sessionMonitor.restoreRecentCompletions(savedCompletions);

  recentNotifications.length = 0;
  recentNotifications.push(...normalizeNotificationRecordList(savedNotifications, MAX_RECENT_EVENTS));
}

async function persistRecentNotifications(context) {
  await context.workspaceState.update(
    RECENT_NOTIFICATIONS_STATE_KEY,
    JSON.parse(JSON.stringify(recentNotifications.slice(0, MAX_RECENT_EVENTS)))
  );
}

async function persistRecentCompletions(context, sessionMonitor) {
  await context.workspaceState.update(
    RECENT_COMPLETIONS_STATE_KEY,
    sessionMonitor.getRecentCompletions().slice(0, MAX_RECENT_EVENTS)
  );
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
    tokenUsage: payload.tokenUsage && typeof payload.tokenUsage === "object" ? JSON.parse(JSON.stringify(payload.tokenUsage)) : undefined,
    costEstimate: payload.costEstimate && typeof payload.costEstimate === "object" ? JSON.parse(JSON.stringify(payload.costEstimate)) : undefined,
    delivery: normalizeDeliveryList(payload.delivery),
    eventFile: typeof payload.eventFile === "string" ? payload.eventFile : ""
  };
}

function appendHistoryEntry(output, completion) {
  output.appendLine(`- ${formatDisplayTimestamp(completion.completedAtIso || completion.timestamp, "(unknown time)")} | ${completion.title}`);
  output.appendLine(`  source: ${completion.source || "unknown"} | level: ${completion.level || "info"}`);

  if (completion.projectName) {
    output.appendLine(`  project: ${completion.projectName}`);
  }
  if (completion.sessionId) {
    output.appendLine(`  session: ${completion.sessionId}`);
  }
  if (completion.turnId) {
    output.appendLine(`  turn: ${completion.turnId}`);
  }
  if (completion.sessionFile) {
    output.appendLine(`  file: ${completion.sessionFile}`);
  }

  output.appendLine(`  message: ${completion.message || "(none)"}`);

  const tokenSummary = formatTokenUsageSummary(completion.tokenUsage);
  if (tokenSummary) {
    output.appendLine(`  tokens: ${tokenSummary}`);
  }

  if (completion.model) {
    output.appendLine(`  model: ${completion.model}`);
  }

  const costSummary = formatCostSummary(completion.costEstimate);
  if (costSummary) {
    output.appendLine(`  cost: ${costSummary}`);
  }

  const deliverySummary = formatDeliverySummary(completion.delivery);
  if (deliverySummary) {
    output.appendLine(`  delivery: ${deliverySummary}`);
    const deliveryFailure = formatDeliveryFailureDetail(completion.delivery);
    if (deliveryFailure) {
      output.appendLine(`  deliveryDetail: ${deliveryFailure}`);
    }
  }

  if (completion.errorMessage) {
    output.appendLine(`  error: ${completion.errorMessage}`);
  }
}

function formatTokenUsageSummary(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== "object") {
    return "";
  }

  const parts = [];
  if (typeof tokenUsage.totalTokens === "number") {
    parts.push(`total=${tokenUsage.totalTokens}`);
  }
  if (typeof tokenUsage.outputTokens === "number") {
    parts.push(`output=${tokenUsage.outputTokens}`);
  }
  if (typeof tokenUsage.inputTokens === "number") {
    parts.push(`input=${tokenUsage.inputTokens}`);
  }
  if (typeof tokenUsage.cachedInputTokens === "number") {
    parts.push(`cached=${tokenUsage.cachedInputTokens}`);
  }
  if (typeof tokenUsage.reasoningOutputTokens === "number") {
    parts.push(`reasoning=${tokenUsage.reasoningOutputTokens}`);
  }
  return parts.join(", ");
}

function appendCostDiagnostics(output, completion) {
  const settings = getCostSettings();
  const notificationSettings = getNotificationChannelSettings();
  output.appendLine("");
  output.appendLine("Cost estimation:");
  output.appendLine(`  enabled: ${settings.enabled}`);
  output.appendLine(`  currency: ${settings.outputCurrency}`);
  output.appendLine(`  exchangeRate: ${settings.exchangeRate}`);
  output.appendLine(`  builtInOpenAI: ${settings.useBuiltInOpenAIPricing}`);
  output.appendLine(`  includeInNotifications: ${settings.includeInNotifications}`);
  output.appendLine(`  customModels: ${Object.keys(settings.customModelPricing).length}`);

  const builtInReference = getBuiltInPricingReference();
  output.appendLine(`  builtInReferenceVerifiedAt: ${builtInReference.verifiedAt}`);
  output.appendLine(`  builtInReferenceSources: ${builtInReference.sourceUrls.join(", ")}`);

  if (completion?.costEstimate?.available) {
    output.appendLine(`  latestCost: ${formatCostSummary(completion.costEstimate)}`);
  } else {
    const reason = completion?.costEstimate?.reason || "missing-or-disabled";
    output.appendLine(`  latestCost: (unavailable: ${reason})`);
  }

  output.appendLine("");
  output.appendLine("External notifications:");
  output.appendLine(`  webhookEnabled: ${notificationSettings.webhook.enabled}`);
  output.appendLine(`  webhookUrl: ${notificationSettings.webhook.url || "(none)"}`);
  output.appendLine(`  soundEnabled: ${notificationSettings.sound.enabled}`);
  output.appendLine(`  sound: ${notificationSettings.sound.windowsSound}`);
  output.appendLine(`  ntfyEnabled: ${notificationSettings.ntfy.enabled}`);
  output.appendLine(`  ntfyTopicUrl: ${notificationSettings.ntfy.topicUrl || "(none)"}`);
  output.appendLine(`  ntfyPriority: ${notificationSettings.ntfy.priority}`);
  output.appendLine(`  ntfyTags: ${notificationSettings.ntfy.tags || "(none)"}`);

  const deliverySummary = formatDeliverySummary(completion?.delivery);
  output.appendLine(`  latestDelivery: ${deliverySummary || "(none)"}`);
}

async function showRecentCosts(sessionMonitor) {
  const completions = getChronologicalEntries(sessionMonitor.getRecentCompletions());
  const output = getOutputChannel();
  output.clear();
  output.appendLine("===== Codex Task Notify Recent Costs =====");

  const costed = completions
    .map((completion) => ({
      completion,
      costEstimate: completion.costEstimate || estimateCompletionCost(completion, getCostSettings())
    }))
    .filter((entry) => entry.costEstimate?.available);

  if (!costed.length) {
    output.appendLine("(no cost estimates available yet)");
    output.show(true);
    await vscode.window.showInformationMessage("Codex Task Notify: no cost estimates available yet.");
    return;
  }

  let totalUsd = 0;
  let totalConverted = 0;
  for (const entry of costed) {
    totalUsd += entry.costEstimate.usdTotal || 0;
    totalConverted += entry.costEstimate.convertedTotal || 0;
    output.appendLine(`- ${formatDisplayTimestamp(entry.completion.completedAtIso || entry.completion.timestamp, "(unknown time)")}`);
    output.appendLine(`  model: ${entry.completion.model || "(unknown)"}`);
    output.appendLine(`  cost: ${formatCostSummary(entry.costEstimate)}`);
    output.appendLine(`  tokens: ${formatTokenUsageSummary(entry.completion.tokenUsage) || "(none)"}`);
    output.appendLine("");
  }

  output.appendLine(`Total USD: $${formatTinyDecimal(totalUsd)}`);
  if (getCostSettings().outputCurrency !== "USD") {
    output.appendLine(`Total ${getCostSettings().outputCurrency}: ${getCostSettings().outputCurrency} ${formatTinyDecimal(totalConverted)}`);
  }

  output.show(true);
  await vscode.window.showInformationMessage(`Codex Task Notify: showed ${costed.length} costed completions.`);
}

function formatCostSummary(costEstimate) {
  if (!costEstimate || !costEstimate.available) {
    return "";
  }

  return formatCostEstimate(costEstimate, { includeUsd: true, includeSource: false });
}

function formatDeliverySummary(delivery) {
  if (!Array.isArray(delivery) || !delivery.length) {
    return "";
  }

  return delivery
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }

      const channel = typeof entry.channel === "string" ? entry.channel : "unknown";
      const status = typeof entry.status === "string" ? entry.status : "unknown";
      if (status === "delivered" && Number.isFinite(entry.statusCode)) {
        return `${channel}=ok(${entry.statusCode})`;
      }
      if (status === "failed") {
        return `${channel}=failed(${entry.error || "error"})`;
      }
      if (status === "skipped") {
        return `${channel}=skipped(${entry.reason || "disabled"})`;
      }
      return `${channel}=${status}`;
    })
    .filter(Boolean)
    .join(", ");
}

function formatDeliveryFailureDetail(delivery) {
  if (!Array.isArray(delivery) || !delivery.length) {
    return "";
  }

  const failures = delivery.filter((entry) => entry && entry.delivered === false && entry.status !== "skipped");
  if (!failures.length) {
    return "";
  }

  return failures
    .map((entry) => {
      const channel = typeof entry.channel === "string" ? entry.channel : "unknown";
      const reason = entry.reason || entry.error || entry.detail || "failed";
      return `${channel}:${reason}`;
    })
    .join(" | ");
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

function buildRecentEventList(diagnostics, completions, notifications) {
  const events = [];
  if (diagnostics?.latestCompletion) {
    events.push({
      at: formatDisplayTimestamp(diagnostics.latestCompletion.completedAtIso || diagnostics.lastNotificationAtIso || diagnostics.lastTaskCompleteAtIso, "(unknown)"),
      type: "latestCompletion",
      summary: diagnostics.latestCompletion.title || diagnostics.latestCompletion.message || "(none)",
      data: diagnostics.latestCompletion
    });
  }

  if (Array.isArray(completions)) {
    for (const completion of completions.slice(-5)) {
      events.push({
        at: formatDisplayTimestamp(completion.completedAtIso || completion.timestamp, "(unknown)"),
        type: "completion",
        summary: completion.title || completion.message || "(none)",
        data: completion
      });
    }
  }

  if (Array.isArray(notifications)) {
    for (const notification of notifications.slice(-5)) {
      events.push({
        at: formatDisplayTimestamp(notification.timestamp, "(unknown)"),
        type: "notification",
        summary: notification.title || notification.message || "(none)",
        data: notification
      });
    }
  }

  return events.reverse();
}

function getChronologicalEntries(entries) {
  return Array.isArray(entries) ? [...entries].reverse() : [];
}

function formatTinyDecimal(value) {
  if (!Number.isFinite(value)) {
    return "0.000";
  }

  return (Math.round((value + Number.EPSILON) * 1000) / 1000).toFixed(3);
}

function getOutputChannel() {
  if (!getOutputChannel.channel) {
    getOutputChannel.channel = vscode.window.createOutputChannel("Codex Task Notify");
  }

  return getOutputChannel.channel;
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

function formatDisplayTimestamp(value, fallback = "(none)") {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return value;
  }

  return new Date(timestampMs).toLocaleString();
}

async function installLocalCli(context) {
  try {
    const sourceDir = path.join(context.extensionPath, CLI_SOURCE_RELATIVE_DIR);
    const targetDir = path.join(os.homedir(), LOCAL_INSTALL_DIR);

    await copyLocalDirectory(sourceDir, targetDir);
    await writeLocalWrapperScripts(targetDir);

    const exampleCommand =
      process.platform === "win32"
        ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(targetDir, "codex-notify.ps1")}" -Title "Codex complete" -Message "Task completed"`
        : `bash "${path.join(targetDir, "codex-notify.sh")}" -Title "Codex complete" -Message "Task completed"`;

    const action = await vscode.window.showInformationMessage(
      `Codex Task Notify CLI installed to ${targetDir}`,
      "Copy Example"
    );

    if (action === "Copy Example") {
      await vscode.env.clipboard.writeText(exampleCommand);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Failed to install local CLI: ${detail}`);
  }
}

async function installWorkspaceCli(context) {
  try {
    const folder = await pickWorkspaceFolder();
    if (!folder) {
      return;
    }

    const targetDir = WORKSPACE_INSTALL_SEGMENTS.reduce(
      (uri, segment) => vscode.Uri.joinPath(uri, segment),
      folder.uri
    );
    const sourceDir = path.join(context.extensionPath, CLI_SOURCE_RELATIVE_DIR);

    await copyLocalDirectoryToWorkspace(sourceDir, targetDir);
    await writeWorkspaceWrapperScripts(targetDir);

    const exampleCommand =
      vscode.env.remoteName || process.platform !== "win32"
        ? `bash ./.vscode/codex-task-notify/bin/codex-notify.sh -Title "Codex complete" -Message "Task completed"`
        : `powershell -NoProfile -ExecutionPolicy Bypass -File .\\.vscode\\codex-task-notify\\bin\\codex-notify.ps1 -Title "Codex complete" -Message "Task completed"`;

    const action = await vscode.window.showInformationMessage(
      `Codex Task Notify CLI installed to ${folder.name}/.vscode/codex-task-notify/bin`,
      "Copy Example"
    );

    if (action === "Copy Example") {
      await vscode.env.clipboard.writeText(exampleCommand);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Failed to install workspace CLI: ${detail}`);
  }
}

async function pickWorkspaceFolder() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) {
    await vscode.window.showWarningMessage("Open a workspace folder before installing the workspace CLI.");
    return undefined;
  }

  if (folders.length === 1) {
    return folders[0];
  }

  return vscode.window.showWorkspaceFolderPick({
    placeHolder: "Select a workspace folder for Codex Task Notify CLI"
  });
}

async function copyLocalDirectory(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of await fs.readdir(sourceDir, { withFileTypes: true })) {
    if (!shouldCopyCliEntry(entry.name, entry.isDirectory())) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyLocalDirectory(sourcePath, targetPath);
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
}

async function copyLocalDirectoryToWorkspace(sourceDir, targetUri) {
  await vscode.workspace.fs.createDirectory(targetUri);

  for (const entry of await fs.readdir(sourceDir, { withFileTypes: true })) {
    if (!shouldCopyCliEntry(entry.name, entry.isDirectory())) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = vscode.Uri.joinPath(targetUri, entry.name);

    if (entry.isDirectory()) {
      await copyLocalDirectoryToWorkspace(sourcePath, targetPath);
      continue;
    }

    const content = await fs.readFile(sourcePath);
    await vscode.workspace.fs.writeFile(targetPath, content);
  }
}

async function writeLocalWrapperScripts(targetDir) {
  if (process.platform === "win32") {
    return;
  }

  const wrapperPath = path.join(targetDir, "codex-notify");
  const wrapperContent = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'bash "$SCRIPT_DIR/codex-notify.sh" "$@"',
    ""
  ].join("\n");

  await fs.writeFile(wrapperPath, wrapperContent, "utf8");
  await fs.chmod(wrapperPath, 0o755);

  for (const fileName of ["codex-notify.sh", "notify.sh", "vscode-notify.sh"]) {
    await fs.chmod(path.join(targetDir, fileName), 0o755);
  }
}

async function writeWorkspaceWrapperScripts(targetDir) {
  const wrapperContent = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'bash "$SCRIPT_DIR/codex-notify.sh" "$@"',
    ""
  ].join("\n");

  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(targetDir, "codex-notify"),
    Buffer.from(wrapperContent, "utf8")
  );

  const usageText = [
    "Codex Task Notify workspace CLI",
    "",
    "PowerShell:",
    'powershell -NoProfile -ExecutionPolicy Bypass -File .\\.vscode\\codex-task-notify\\bin\\codex-notify.ps1 -Title "Codex complete" -Message "Task completed"',
    "",
    "bash:",
    'bash ./.vscode/codex-task-notify/bin/codex-notify.sh -Title "Codex complete" -Message "Task completed"',
    ""
  ].join("\n");

  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(targetDir, "USAGE.txt"),
    Buffer.from(usageText, "utf8")
  );
}

function shouldCopyCliEntry(name, isDirectory) {
  if (isDirectory) {
    return true;
  }

  return !name.toLowerCase().endsWith(".md");
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
