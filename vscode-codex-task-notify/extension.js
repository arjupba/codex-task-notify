const childProcess = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const vscode = require("vscode");

const WATCH_GLOB = "tmp/codex-task-notify/*.json";
const CLI_SOURCE_RELATIVE_DIR = path.join("resources", "notify");
const LOCAL_INSTALL_DIR = path.join(".codex-task-notify", "bin");
const WORKSPACE_INSTALL_SEGMENTS = [".vscode", "codex-task-notify", "bin"];
const seenEvents = new Map();

function activate(context) {
  const watcherDisposables = [];

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

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => rebuildWatchers())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexTaskNotify.testNotification", async () => {
      await showNotification(context, {
        title: "Codex test",
        message: "Local task notification path is working.",
        level: "info",
        id: `manual-${Date.now()}`
      });
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

  if (tryShowLocalWindowsNotification(context, { title, message, level })) {
    return;
  }

  await showInAppNotification(text, level);
}

function tryShowLocalWindowsNotification(context, payload) {
  if (process.platform !== "win32") {
    return false;
  }

  const scriptPath = path.join(context.extensionPath, "scripts", "notify.ps1");
  const levelMap = {
    info: "Info",
    warning: "Warning",
    warn: "Warning",
    error: "Error"
  };

  try {
    const child = childProcess.spawn(
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
        detached: true,
        stdio: "ignore",
        windowsHide: true
      }
    );

    child.unref();
    return true;
  } catch (error) {
    console.error("[codex-task-notify] Failed to launch local Windows notification", error);
    return false;
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
