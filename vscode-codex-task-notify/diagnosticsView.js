const vscode = require("vscode");
const { getNotificationDedupeDir } = require("./notificationPresenter");
const { estimateCompletionCost, getCostSettings } = require("./pricing");
const {
  getCurrentWorkspaceHistoryDescriptor,
  readGlobalHistoryStore
} = require("./historyStore");
const {
  appendCostDiagnostics,
  appendHistoryEntry,
  buildRecentEventList,
  formatCostSummary,
  formatDisplayTimestamp,
  formatTinyDecimal,
  formatTokenUsageSummary,
  getChronologicalEntries,
  getOutputChannel
} = require("./diagnosticsFormatter");

async function showDiagnostics(context, sessionMonitor, recentNotifications) {
  const diagnostics = sessionMonitor.getDiagnostics();
  const workspaceHistory = getCurrentWorkspaceHistoryDescriptor();
  const historyStore = readGlobalHistoryStore(context);
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
  output.appendLine("historyStorage: globalState");
  output.appendLine(`historyWorkspaceKey: ${workspaceHistory.key}`);
  output.appendLine(`historyWorkspaceLabel: ${workspaceHistory.label}`);
  output.appendLine(`historyWorkspaceCount: ${Object.keys(historyStore.workspaces).length}`);
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

async function showDebugSnapshot(context, sessionMonitor, recentNotifications) {
  const diagnostics = sessionMonitor.getDiagnostics();
  const snapshotState = sessionMonitor.getSnapshotState();
  const workspaceHistory = getCurrentWorkspaceHistoryDescriptor();
  const output = getOutputChannel();
  output.clear();
  output.appendLine("===== Codex Task Notify Debug Snapshot =====");

  const snapshot = {
    capturedAt: new Date().toISOString(),
    history: {
      storage: "globalState",
      workspaceKey: workspaceHistory.key,
      workspaceLabel: workspaceHistory.label
    },
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

async function showRecentHistory(sessionMonitor, recentNotifications) {
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

async function showRecentEvents(sessionMonitor, recentNotifications) {
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

module.exports = {
  showDebugSnapshot,
  showDiagnostics,
  showRecentCosts,
  showRecentEvents,
  showRecentHistory
};
