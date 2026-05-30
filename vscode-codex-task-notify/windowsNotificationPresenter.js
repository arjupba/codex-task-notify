const childProcess = require("child_process");
const path = require("path");
const vscode = require("vscode");

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
      },
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

module.exports = {
  tryShowLocalWindowsNotification
};
