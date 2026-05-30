const vscode = require("vscode");
const { installLocalCli, installWorkspaceCli } = require("./cliInstaller");
const {
  showDebugSnapshot,
  showDiagnostics,
  showRecentCosts,
  showRecentEvents,
  showRecentHistory
} = require("./diagnosticsView");
const {
  normalizeTimestamp,
  persistWorkspaceHistory,
  recordRecentNotification,
  restorePersistedState
} = require("./historyStore");
const { showNotification } = require("./notificationPresenter");
const { CodexSessionMonitor } = require("./sessionMonitor");

const WATCH_GLOB = "tmp/codex-task-notify/*.json";
const seenEvents = new Map();
const recentNotifications = [];

function activate(context) {
  const watcherDisposables = [];
  const sessionMonitor = new CodexSessionMonitor(context, async (payload) => {
    const shown = await showNotification(context, payload);
    if (shown) {
      recordRecentNotification(recentNotifications, payload);
    }
    await persistWorkspaceHistory(context, sessionMonitor, recentNotifications);
  });

  restorePersistedState(context, sessionMonitor, recentNotifications);

  const rebuildWatchers = () => {
    while (watcherDisposables.length) {
      watcherDisposables.pop().dispose();
    }

    for (const folder of vscode.workspace.workspaceFolders || []) {
      const pattern = new vscode.RelativePattern(folder, WATCH_GLOB);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      watcher.onDidCreate((uri) => handleEventFile(context, sessionMonitor, uri), null, context.subscriptions);
      watcher.onDidChange((uri) => handleEventFile(context, sessionMonitor, uri), null, context.subscriptions);

      watcherDisposables.push(watcher);
      context.subscriptions.push(watcher);
    }
  };

  rebuildWatchers();
  void persistWorkspaceHistory(context, sessionMonitor, recentNotifications);
  void sessionMonitor.start();

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      rebuildWatchers();
      restorePersistedState(context, sessionMonitor, recentNotifications);
      void persistWorkspaceHistory(context, sessionMonitor, recentNotifications);
      void sessionMonitor.restart();
    })
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
        recordRecentNotification(recentNotifications, payload);
      }
      await persistWorkspaceHistory(context, sessionMonitor, recentNotifications);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showDiagnostics", async () => {
      await showDiagnostics(context, sessionMonitor, recentNotifications);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showRecentHistory", async () => {
      await showRecentHistory(sessionMonitor, recentNotifications);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showRecentEvents", async () => {
      await showRecentEvents(sessionMonitor, recentNotifications);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showRecentCosts", async () => {
      await showRecentCosts(sessionMonitor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showDebugSnapshot", async () => {
      await showDebugSnapshot(context, sessionMonitor, recentNotifications);
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

async function handleEventFile(context, sessionMonitor, uri) {
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
      recordRecentNotification(recentNotifications, enrichedPayload);
    }
    await persistWorkspaceHistory(context, sessionMonitor, recentNotifications);
  } catch (error) {
    console.error("[codex-task-notify] Failed to process event file", uri.toString(), error);
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
