const childProcess = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const { CodexSessionMonitor } = require("./sessionMonitor");

const WATCH_GLOB = "tmp/codex-task-notify/*.json";
const CLI_SOURCE_RELATIVE_DIR = path.join("resources", "notify");
const LOCAL_INSTALL_DIR = path.join(".codex-task-notify", "bin");
const WORKSPACE_INSTALL_SEGMENTS = [".vscode", "codex-task-notify", "bin"];
const MAX_RECENT_EVENTS = 50;
const seenEvents = new Map();
const recentNotifications = [];

function activate(context) {
  const watcherDisposables = [];
  const sessionMonitor = new CodexSessionMonitor(context, async (payload) => {
    recordRecentNotification(payload);
    await showNotification(context, payload);
  });

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
      recordRecentNotification(payload);
      await showNotification(context, payload);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showDiagnostics", async () => {
      await showDiagnostics(sessionMonitor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.showRecentHistory", async () => {
      await showRecentHistory(sessionMonitor);
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

    recordRecentNotification({
      ...payload,
      id: eventId,
      source: payload.source || "workspace-event",
      eventFile: uri.toString(),
      timestamp: normalizeTimestamp(payload.createdAt) || new Date().toISOString()
    });
    await showNotification(context, payload);
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

  if (await tryShowLocalWindowsNotification(context, { title, message, level })) {
    return;
  }

  await showInAppNotification(text, level);
}

function tryShowLocalWindowsNotification(context, payload) {
  if (process.platform !== "win32") {
    return Promise.resolve(false);
  }

  const scriptPath = path.join(context.extensionPath, "scripts", "notify.ps1");
  const levelMap = {
    info: "Info",
    warning: "Warning",
    warn: "Warning",
    error: "Error"
  };

  return new Promise((resolve) => {
    childProcess.execFile(
      "powershell.exe",
      [
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
      ],
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

async function showDiagnostics(sessionMonitor) {
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
  output.appendLine(`pollCount: ${diagnostics.pollCount}`);
  output.appendLine(`trackedFileCount: ${diagnostics.trackedFileCount}`);
  output.appendLine(`processedEventCount: ${diagnostics.processedEventCount}`);
  output.appendLine(`recentCompletionCount: ${diagnostics.recentCompletionCount}`);
  output.appendLine(`recentNotificationCount: ${recentNotifications.length}`);
  output.appendLine(`notificationCount: ${diagnostics.notificationCount}`);
  output.appendLine(`lastDiscoveredFileCount: ${diagnostics.lastDiscoveredFileCount}`);
  output.appendLine(`lastPollStartedAt: ${diagnostics.lastPollStartedAtIso || "(none)"}`);
  output.appendLine(`lastPollCompletedAt: ${diagnostics.lastPollCompletedAtIso || "(none)"}`);
  output.appendLine(`lastPollDurationMs: ${diagnostics.lastPollDurationMs}`);
  output.appendLine(`lastNotificationAt: ${diagnostics.lastNotificationAtIso || "(none)"}`);
  output.appendLine(`lastNotificationTitle: ${diagnostics.lastNotificationTitle || "(none)"}`);
  output.appendLine(`lastTaskCompleteAt: ${diagnostics.lastTaskCompleteAtIso || "(none)"}`);
  output.appendLine(`lastTaskCompleteSessionId: ${diagnostics.lastTaskCompleteSessionId || "(none)"}`);
  output.appendLine(`lastTaskCompleteTurnId: ${diagnostics.lastTaskCompleteTurnId || "(none)"}`);
  output.appendLine(`restartCount: ${diagnostics.restartCount}`);
  output.appendLine(`lastRestartAt: ${diagnostics.lastRestartAtIso || "(none)"}`);
  output.appendLine(`missingRootWarningShown: ${diagnostics.missingRootWarningShown}`);
  output.appendLine(`lastError: ${diagnostics.lastError || "(none)"}`);

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
    output.appendLine(`  at: ${diagnostics.lastRateLimitsAtIso || "(unknown)"}`);
    output.appendLine(`  data: ${JSON.stringify(diagnostics.lastRateLimits)}`);
  } else {
    output.appendLine("  (none or all-null)");
  }

  output.show(true);
  await vscode.window.showInformationMessage(
    `Codex Task Notify: tracked=${diagnostics.trackedFileCount} files, recent=${diagnostics.recentCompletionCount}, lastNotify=${diagnostics.lastNotificationAtIso || "none"}`
  );
}

async function showRecentHistory(sessionMonitor) {
  const completions = sessionMonitor.getRecentCompletions();
  const output = getOutputChannel();
  output.clear();
  output.appendLine("===== Codex Task Notify Recent History =====");

  if (!completions.length && !recentNotifications.length) {
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

  if (recentNotifications.length) {
    output.appendLine("Recent notifications:");
    for (const notification of recentNotifications) {
      appendHistoryEntry(output, notification);
      output.appendLine("");
    }
  }

  output.show(true);
  await vscode.window.showInformationMessage(
    `Codex Task Notify: showed ${completions.length} completed turns and ${recentNotifications.length} recent notifications.`
  );
}

function recordRecentNotification(payload) {
  const normalized = normalizeNotificationRecord(payload);
  recentNotifications.unshift(normalized);
  if (recentNotifications.length > MAX_RECENT_EVENTS) {
    recentNotifications.length = MAX_RECENT_EVENTS;
  }
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
    eventFile: typeof payload.eventFile === "string" ? payload.eventFile : ""
  };
}

function appendHistoryEntry(output, completion) {
  output.appendLine(`- ${completion.completedAtIso || completion.timestamp || "(unknown time)"} | ${completion.title}`);
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
